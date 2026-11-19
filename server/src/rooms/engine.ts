/**
 * Игровая комната быстрого канала (CLAUDE.md, «Быстрый канал (комнаты)», логика — docs/fast-room.md): состояние игры
 * с непрерывными нажатиями живёт в памяти сервера, телефоны шлют пачки событий, обратно — личный поток телефона,
 * сводка экрана (до 5 раз в секунду) и сводка пульта (раз в секунду). Здесь — только чистая логика без базы и HTTP:
 * комнату ведёт `server/src/room.ts`. Время — только часы сервера; событие пачки помнит, сколько мс назад оно
 * случилось (`ago`): не раньше прихода предыдущей принятой пачки этого потока (минус запас), без неё — не дальше
 * интервала пачки с запасом, и в любом случае не дальше 4 с. Пачка, пришедшая не в свой черёд (повтор, не по порядку),
 * помечает события `delayed`: им можно верить меньше в играх «кто первый».
 */
import { createHash, randomBytes } from "node:crypto";
import type { RoomClosedReason, RoomInputEvent, RoomLoopStats, RoomOfflinePlayer, RoomStreamEvent } from "../../../src/data/types";

/** Событию из повторённой пачки верим не старше этого: интервал пачки + разброс сети + запас. Старше — `late`. */
export const MAX_AGO_MS = 4000;
/** Запас к интервалу пачки для `ago` свежей пачки (разброс отправки 0–300 мс и сеть). */
export const FRESH_AGO_SLACK_MS = 500;
/** Пачка пришла позже предыдущей больше чем на интервал + столько — не в свой черёд (`delayed`). */
export const DELAYED_SLACK_MS = 1000;
/** Событий в одной пачке — не больше. */
export const MAX_EVENTS_PER_BATCH = 64;
/** Сколько номеров пачек одного потока телефона помним (повтор и пачки не по порядку). */
export const SEQ_WINDOW = 64;
/** Сколько потоков пачек одного телефона помним (перезагрузка страницы — новый поток); вытесняется давно молчащий. */
export const STREAMS_PER_PLAYER = 3;
/** Запросов в секунду с телефона (пачки и отдельные движения): запас и ровная скорость. */
export const REQUESTS_BURST = 20;
export const REQUESTS_PER_SECOND = 10;
/** Сколько последних команд пульта помним по id (повтор после обрыва не выполняется дважды). */
/** Сводка экрана без перемен — раз в секунду (живой поток для экрана: см. `tick`). */
export const SCREEN_KEEPALIVE_MS = 1000;
const COMMAND_MEMORY = 20;
/** Отключившихся в сводке пульта — не больше. */
const OFFLINE_LIST_MAX = 100;
const EVENT_TYPE = /^[a-z][a-z0-9_-]{0,23}$/;
const STREAM_ID = /^[A-Za-z0-9_-]{1,32}$/;
const COMMAND = /^[a-z][a-z0-9_-]{0,31}$/;
const MOMENT = /^[A-Za-z0-9_:.#-]{0,64}$/;

/** Игрок комнаты: устройство (uid) — участник сессии: сам игрок или член команды. */
export interface RoomPlayer {
  pid: string;
  name: string;
  /** Команда телефона в режиме команд; иначе null. */
  team: string | null;
}

/**
 * Событие пачки после проверки: `at` — момент события по часам сервера, `late` — `ago` больше допустимого (обрезан),
 * `delayed` — пачка пришла не в свой черёд (повтор после обрыва, не по порядку): `at` может быть раньше на до 4 с,
 * и подделать это нельзя отличить от честного повтора — игра «кто первый» решает сама, верить ли.
 */
export interface RoomEvent {
  t: string;
  at: number;
  late: boolean;
  delayed: boolean;
  /**
   * Только у игр с `stampedTime`: `at` взят из отметки телефона `st` (часы сервера, сверенные телефоном), а не из `ago` —
   * без дороги запроса (docs/fast-room.md, «Отметка времени»). Нет — время по `ago`, как у всех.
   */
  stamped?: boolean;
  [field: string]: unknown;
}

/** Что игра видит о комнате при расчёте сводок. */
export interface RoomView {
  now: number;
  paused: boolean;
  players: readonly RoomPlayer[];
  teams: ReadonlyMap<string, string>;
  online(pid: string): boolean;
  onlineCount: number;
}

/** Что игра может сделать из своих обработчиков. */
export interface RoomContext extends RoomView {
  /** Личное событие одному телефону (личный поток). */
  send(pid: string, data: unknown): void;
  /** Сводки экрана и пульта изменились — разослать (не чаще своего темпа). */
  changed(): void;
  /** Контрольная точка: снимок комнаты в базу сейчас (начало шага, конец испытания). */
  checkpoint(): void;
  /** Случайное число [0, 1) из зерна комнаты и ключа: зерно на телефоны не уходит, результат повторяем. */
  random(key: string): number;
}

export type CommandOutcome = { ok: true; result?: unknown } | { ok: false; error: string };

/**
 * Игра быстрого канала. Обработчики меняют `state` на месте; что изменилось — сообщают через `ctx.changed()`.
 * Сводка экрана — только общее и без тайн; личное — в `personal`, всё для ведущего — в `host`.
 */
export interface RoomGame<S> {
  id: string;
  /** Кто ничего не прислал столько мс — «без связи» (обычно 3000, «Бубликатор» — 4000). */
  offlineMs: number;
  /** Событий в секунду с одного телефона (лишние срезаются). */
  eventsPerSecond: number;
  /** Сводок экрана в секунду — не больше (по умолчанию 5). */
  screenHz?: number;
  /** Как часто телефон шлёт пачку при таком числе игроков, мс. */
  batchMs(players: number): number;
  /**
   * Телефон ставит событию отметку `st` — момент по часам сервера (сверены `GET /api/time`): время события — она, а не
   * «приход − ago» (в `ago` нет дороги запроса). Отметка принимается в тех же пределах, что `ago`: не позже прихода и не
   * раньше «приход − предел», поэтому задним числом она даёт не больше, чем `ago`. Нет — как раньше (по `ago`).
   */
  stampedTime?: boolean;
  create(input: { snapshot: unknown; playMode: "solo" | "teams"; now: number }, ctx: RoomContext): S;
  /**
   * Пачка телефона. true — в ней было игровое действие, которое игра приняла: только тогда пачка отмечает «играл в раунде»
   * (`playUnit`). Игре без раундов отвечать не нужно.
   */
  onInput(state: S, player: RoomPlayer, events: RoomEvent[], ctx: RoomContext): boolean | void;
  onCommand(state: S, cmd: string, args: unknown, ctx: RoomContext): CommandOutcome;
  /**
   * Этап игры для команд пульта (`expect`): шаг или фаза, а не счётчик нажатий. Команда с другим этапом —
   * отказ `moved`, как `apply` медленного пути. Нет — этапа нет, команды без проверки.
   */
  moment?(state: S): string;
  tick?(state: S, ctx: RoomContext): void;
  onPause?(state: S, ctx: RoomContext): void;
  /** Пауза кончилась: `pausedMs` — сколько стояли (сдвинуть свои назначенные моменты). */
  onResume?(state: S, pausedMs: number, ctx: RoomContext): void;
  onJoin?(state: S, player: RoomPlayer, ctx: RoomContext): void;
  /**
   * Раунд игры для баллов ведущему (`room_play`): пачка с событиями, дошедшая до игры в этом раунде, отмечает телефон
   * «играл в раунде N». null — сейчас не раунд (лобби, тренировка, привал). Нет метода — игра баллов по раундам не считает.
   */
  playUnit?(state: S): number | null;
  /**
   * Игра сыграна до конца (по состоянию комнаты): баллы ведущему — вместо «не меньше 40 минут» (решение владельца 13 ноября 2026).
   * Нет метода — баллы по минутам, как у остальных игр.
   */
  playedToEnd?(state: S): boolean;
  screen(state: S, view: RoomView): unknown;
  personal(state: S, pid: string, view: RoomView): unknown;
  host(state: S, view: RoomView): unknown;
  snapshot(state: S): unknown;
  /** Состояние из снимка; не подходит — null (комната начнётся заново). */
  restore(data: unknown): S | null;
}

// ------------------------------------------------------------------ разбор пачки

export interface ParsedInput {
  stream: string;
  /** Телефон повторяет пачку (прошлая попытка не дошла или ответ потерялся). */
  retry: boolean;
  /** Номер пачки с событиями; у пустой пачки («я на связи») номера нет — null. */
  seq: number | null;
  events: RoomInputEvent[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Пачка телефона: `{ stream?, seq?, events }` (у пачки с событиями `seq` обязателен). Неверная — null. */
export function parseInput(body: unknown): ParsedInput | null {
  if (!isRecord(body)) return null;
  const { seq, events } = body;
  const stream = body.stream === undefined ? "" : body.stream;
  if (typeof stream !== "string" || (stream !== "" && !STREAM_ID.test(stream))) return null;
  if (!Array.isArray(events) || events.length > MAX_EVENTS_PER_BATCH) return null;
  if (seq !== undefined && (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0)) return null;
  if (events.length > 0 && seq === undefined) return null;
  if (body.retry !== undefined && typeof body.retry !== "boolean") return null;
  const parsed: RoomInputEvent[] = [];
  for (const raw of events) {
    if (!isRecord(raw) || typeof raw.t !== "string" || !EVENT_TYPE.test(raw.t)) return null;
    if (raw.ago !== undefined && (typeof raw.ago !== "number" || !Number.isFinite(raw.ago) || raw.ago < 0)) return null;
    parsed.push(raw as RoomInputEvent);
  }
  return { stream, retry: body.retry === true, seq: typeof seq === "number" ? seq : null, events: parsed };
}

/**
 * Событие по часам сервера: `ago` сверх `maxAgo` не принимается — момент не раньше `now − maxAgo`, пометка `late`.
 * `stamped` (игра с `stampedTime`) и у события число `st` — момент из отметки телефона в тех же пределах: не позже `now`, не
 * раньше `now − maxAgo` (раньше — на пределе и `late`).
 */
export function timedEvent(event: RoomInputEvent, now: number, maxAgo = MAX_AGO_MS, delayed = false, stamped = false): RoomEvent {
  const bound = Math.max(0, maxAgo);
  const fields: Record<string, unknown> = { ...event };
  delete fields.ago;
  delete fields.at;
  delete fields.late;
  delete fields.delayed;
  delete fields.stamped;
  const st = event.st;
  if (stamped) delete fields.st;
  if (stamped && typeof st === "number" && Number.isFinite(st)) {
    const claimed = Math.round(st);
    return { ...fields, t: event.t, at: Math.min(now, Math.max(now - bound, claimed)), late: claimed < now - bound, delayed, stamped: true };
  }
  const ago = Math.round(event.ago ?? 0);
  return { ...fields, t: event.t, at: now - Math.min(ago, bound), late: ago > maxAgo, delayed };
}

/**
 * Предел `ago` для пачки (docs/fast-room.md, «Время событий»).
 * - Пачка в свой черёд (самый новый номер, не повтор): события случились после прошлой отправки этой страницы — а она
 *   (пачка или «я на связи») пришла `prevRequestAt`; предел — max(интервал, время с прошлого запроса) + 0,5 с, не больше
 *   4 с. Прошлый запрос был давно (телефон молчал, а не слал «я на связи» раз в интервал) — `delayed`.
 * - Повтор (`retry`) или пачка не по порядку: события случились после того, как ушла ближайшая меньшая принятая пачка
 *   (`prevBatchAt`); предел — время с её прихода + 0,5 с, не больше 4 с; нет такой — как у свежей. Всегда `delayed`.
 * Так подделка (номер 1000, потом 999, 998 с `ago` 4000) не даёт раннего времени без пометки, а честный повтор
 * потерянной пачки после 8 с ожидания не обрезается до 1,5 с.
 */
export function agoLimit(input: {
  now: number;
  every: number;
  status: "newest" | "new";
  retry: boolean;
  prevBatchAt: number | null;
  prevRequestAt: number | null;
  /** Когда пришла самая свежая (с наибольшим номером) пачка потока. */
  newestAt?: number | null;
}): { maxAgo: number; delayed: boolean } {
  const { now, every, status, retry, prevBatchAt, prevRequestAt } = input;
  const fresh = every + FRESH_AGO_SLACK_MS;
  // Честный обгон: «сейчас» и обычная пачка ушли почти вместе и пришли в другом порядке. Пачка не по порядку без
  // повтора в пределах интервала после самой свежей — как свежая: предел интервала, без `delayed` (раньше интервала
  // это время не уводит, поэтому подделке номерами ничего не даёт).
  if (status === "new" && !retry && input.newestAt != null && now - input.newestAt <= fresh) {
    return { maxAgo: Math.min(MAX_AGO_MS, fresh), delayed: false };
  }
  if (status === "new" || retry) {
    const maxAgo = prevBatchAt === null ? fresh : Math.max(fresh, now - prevBatchAt + FRESH_AGO_SLACK_MS);
    return { maxAgo: Math.min(MAX_AGO_MS, maxAgo), delayed: true };
  }
  const since = prevRequestAt === null ? 0 : Math.max(0, now - prevRequestAt);
  return { maxAgo: Math.min(MAX_AGO_MS, Math.max(every, since) + FRESH_AGO_SLACK_MS), delayed: since > every + DELAYED_SLACK_MS };
}

// ------------------------------------------------------------------ повторы и лимиты

/**
 * Номер пачки: `newest` — новая и самая свежая в потоке, `new` — новая, но не по порядку (повтор после обрыва,
 * параллельное «движение»), `dup` — уже была, `stale` — слишком старая (окно 64 номера ушло): сервер не знает, была ли.
 */
export type SeqStatus = "newest" | "new" | "dup" | "stale";

/** Номера пачек одного потока: повтор и пачки не по порядку — без повторной обработки. */
export class SeqWindow {
  private max = -1;
  /** Принятые номера → когда пришли (часы сервера). */
  private readonly seen = new Map<number, number>();
  lastUsed: number;

  constructor(now = 0) {
    this.lastUsed = now;
  }

  check(seq: number): SeqStatus {
    if (this.seen.has(seq)) return "dup";
    if (seq <= this.max - SEQ_WINDOW) return "stale";
    return seq > this.max ? "newest" : "new";
  }

  /** Когда пришла пачка с наибольшим номером; не было — null. */
  newestArrival(): number | null {
    return this.seen.get(this.max) ?? null;
  }

  /** Когда пришла ближайшая меньшая принятая пачка; нет такой в окне — null. */
  prevArrival(seq: number): number | null {
    let best = -1;
    let at: number | null = null;
    for (const [n, t] of this.seen) {
      if (n < seq && n > best) {
        best = n;
        at = t;
      }
    }
    return at;
  }

  /** Пачка обработана — номер запомнен (с временем прихода). */
  commit(seq: number, now = this.lastUsed): void {
    this.seen.set(seq, now);
    if (seq > this.max) {
      this.max = seq;
      for (const old of this.seen.keys()) if (old <= this.max - SEQ_WINDOW) this.seen.delete(old);
    }
  }

  /** check + commit: true — пачка новая. */
  take(seq: number, now = this.lastUsed): boolean {
    const status = this.check(seq);
    if (status === "dup" || status === "stale") return false;
    this.commit(seq, now);
    return true;
  }
}

/** Ведро жетонов: `capacity` сразу, дальше `perSecond`. */
export class TokenBucket {
  private tokens: number;
  private at: number;

  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
    now: number,
  ) {
    this.tokens = capacity;
    this.at = now;
  }

  /** Сколько из `want` можно взять сейчас (столько и взято). */
  take(want: number, now: number): number {
    if (now > this.at) {
      this.tokens = Math.min(this.capacity, this.tokens + ((now - this.at) / 1000) * this.perSecond);
      this.at = now;
    }
    const got = Math.max(0, Math.min(want, Math.floor(this.tokens)));
    this.tokens -= got;
    return got;
  }
}

/** Случайное число [0, 1) из зерна и ключа (sha256): одинаково при повторе, на телефоны зерно не уходит. */
export function seededRandom(seed: string, key: string): number {
  const digest = createHash("sha256").update(`${seed}:${key}`).digest();
  return digest.readUIntBE(0, 6) / 2 ** 48;
}

// ------------------------------------------------------------------ комната

export interface RoomListener {
  send(event: RoomStreamEvent): void;
  end(): void;
  /** Сколько байт ждёт отправки (поток по HTTP); нет — 0. */
  backlog?(): number;
  /** Оборвать поток без «закрыто» (отставший — переподключится со свежим снимком). */
  destroy?(): void;
  /** Поток уже закрыт совсем (нечего учитывать). */
  closed?(): boolean;
}

interface PlayerRuntime extends RoomPlayer {
  lastSeen: number;
  online: boolean;
  streams: Map<string, SeqWindow>;
  requests: TokenBucket;
  events: TokenBucket;
  /**
   * Интервал пачки, сказанный телефону в последнем ответе, и прежний (с момента смены): у порога числа игроков телефон
   * ещё одну-две пачки шлёт по старому интервалу — его следующий таймер уже назначен.
   */
  toldEvery: number;
  prevEvery: number;
  everyChangedAt: number;
}

export type InputResult =
  | {
      ok: true;
      at: number;
      every: number;
      paused: boolean;
      dropped: number;
      dup: boolean;
      stale: boolean;
      /** События дошли до игры — это активность (отметка для выкладки, выгрузка). Пустая пачка — нет. */
      active: boolean;
    }
  | { ok: false; status: 403 | 429; error: string };

/** Снимок комнаты в базе (`room_snapshots.data`). */
export interface RoomSnapshotData {
  v: 1;
  game: string;
  key: string;
  seed: string;
  state: unknown;
  /** Когда записан (часы сервера): после перезапуска простой считается от него. */
  savedAt: number;
  /** Номер изменения комнаты — продолжается после восстановления. */
  version: number;
  /** Последняя активность (пачка, дошедшая до игры, или команда): забытую комнату подписка не поднимает. */
  activeAt: number;
  paused: boolean;
  /** С какого момента стоит пауза (если `paused`). */
  pausedAt: number;
  /**
   * Комната выгружена спокойно (15 минут без пачек, команд и подписчиков) — после загрузки та же пауза, что была.
   * Иначе (перезапуск, сбой, остановка посреди игры) — комната поднимается на паузе.
   */
  clean: boolean;
}

export interface RoomInit {
  id: string;
  /** Механика и блок вечера: снимок другой игры не подходит. */
  key: string;
  hostId: string;
  phase?: "lobby" | "playing";
  game: RoomGame<unknown>;
  players: RoomPlayer[];
  teams: Array<[string, string]>;
  snapshot: unknown;
  playMode: "solo" | "teams";
  now: number;
  /** Снимок из базы: комната поднимается из него на паузе (ведущий продолжает командой). */
  restoreFrom?: RoomSnapshotData | null;
  /** Задержка общего цикла и память (для сводки пульта). */
  loop?: () => RoomLoopStats;
  /** Исключение в коде игры: что упало (журнал — с ограничением частоты). */
  onError?: (where: string, error: unknown) => void;
}

export class Room {
  readonly id: string;
  readonly key: string;
  readonly hostId: string;
  readonly game: RoomGame<unknown>;
  readonly seed: string;
  /** Фаза сессии по событиям Hub (`lobby` / `playing`); завершённая комната выгружается. */
  phase: "lobby" | "playing";
  state: unknown;
  paused = false;
  /** Поднята из снимка после перезапуска или сбоя — пульту это видно. */
  restored = false;
  /** Номер изменения: растёт на каждое `changed()`. */
  version = 0;
  /** Последняя пачка с событиями или команда — для выгрузки (создание комнаты считается её началом). Пустые пачки не в счёт. */
  lastActivity: number;
  /** Сколько раз была активность (пачки, дошедшие до игры, и команды) — для отметки `updated_at`; создание — не активность. */
  activityCount = 0;
  /**
   * Последняя настоящая активность (пачка, дошедшая до игры, или команда; без неё — создание комнаты). Хранится в снимке:
   * забытая на 12 часов комната закрывается (`abandoned`), и переподключение экрана её не продлевает.
   */
  activeAt: number;
  /** «Телефон играл в раунде» (`playUnit`): ещё не записанные в базу и все уже отмеченные (без повторов). */
  private playedNew: Array<{ pid: string; unit: number }> = [];
  private playedSeen = new Set<string>();
  /** Номер изменения, записанный в последний снимок. */
  savedVersion = -1;
  /** Ждёт контрольная точка (запись снимка вне очереди 10 с). */
  checkpointWanted = false;

  private readonly players = new Map<string, PlayerRuntime>();
  private readonly teams = new Map<string, string>();
  private playerList: RoomPlayer[] | null = null;
  private onlineCount = 0;
  private pausedAt = 0;
  private screenDirty = true;
  private lastScreenAt = -Infinity;
  private lastHostAt = -Infinity;
  private readonly me = new Map<string, Set<RoomListener>>();
  private readonly screens = new Set<RoomListener>();
  private readonly hosts = new Set<RoomListener>();
  private readonly commands = new Map<string, CommandOutcome>();
  private readonly loop: () => RoomLoopStats;
  private readonly onError: (where: string, error: unknown) => void;
  private readonly playMode: "solo" | "teams";

  constructor(init: RoomInit) {
    this.id = init.id;
    this.key = init.key;
    this.hostId = init.hostId;
    this.phase = init.phase ?? "lobby";
    this.game = init.game;
    this.playMode = init.playMode;
    this.lastActivity = init.now;
    this.activeAt = init.now;
    this.loop = init.loop ?? (() => ({ lagMs: 0, maxLagMs: 0, memoryMb: 0 }));
    this.onError = init.onError ?? (() => undefined);
    for (const [id, name] of init.teams) this.teams.set(id, name);
    for (const player of init.players) this.addPlayer(player, init.now);
    const restore = init.restoreFrom;
    let restored: unknown = null;
    if (restore && restore.game === init.game.id && restore.key === init.key) {
      try {
        restored = init.game.restore(restore.state);
      } catch (error) {
        this.onError("restore", error);
      }
    }
    if (restore && restored !== null) {
      this.seed = restore.seed;
      this.state = restored;
      this.version = restore.version;
      this.savedVersion = restore.version;
      this.activeAt = Math.min(init.now, restore.activeAt);
      if (restore.clean) {
        // Спокойная выгрузка: никто не играл — та же пауза, что была.
        this.paused = restore.paused;
        this.pausedAt = restore.pausedAt;
      } else {
        // Перезапуск или сбой посреди игры: на паузе, простой — с момента снимка (или с начала паузы).
        this.restored = true;
        this.paused = true;
        this.pausedAt = restore.paused ? restore.pausedAt : restore.savedAt;
      }
    } else {
      this.seed = randomBytes(16).toString("hex");
      this.state = init.game.create({ snapshot: init.snapshot, playMode: init.playMode, now: init.now }, this.context(init.now));
    }
  }

  // -------------------------------------------------------------- участники

  private addPlayer(player: RoomPlayer, now: number): PlayerRuntime {
    const runtime: PlayerRuntime = {
      ...player,
      lastSeen: -Infinity,
      online: false,
      streams: new Map(),
      requests: new TokenBucket(REQUESTS_BURST, REQUESTS_PER_SECOND, now),
      events: new TokenBucket(this.game.eventsPerSecond * 2, this.game.eventsPerSecond, now),
      toldEvery: 0,
      prevEvery: 0,
      everyChangedAt: -Infinity,
    };
    this.players.set(player.pid, runtime);
    this.playerList = null;
    return runtime;
  }

  has(pid: string): boolean {
    return this.players.has(pid);
  }

  /** Новый или изменённый участник сессии (события Hub `participants:<id>`). */
  upsertParticipant(p: { id: string; name: string; kind: "player" | "team"; teamId: string | null }, now: number): void {
    if (p.kind === "team") {
      if (this.teams.get(p.id) === p.name) return;
      this.teams.set(p.id, p.name);
      this.changed();
      return;
    }
    const known = this.players.get(p.id);
    if (known) {
      // «Я на связи» медленного пути (seenAt) приходит тем же событием — без перемен в имени и команде сводки не трогаем.
      if (known.name === p.name && known.team === p.teamId) return;
      known.name = p.name;
      known.team = p.teamId;
      this.playerList = null;
    } else {
      const runtime = this.addPlayer({ pid: p.id, name: p.name, team: p.teamId }, now);
      this.safely("join", () => this.game.onJoin?.(this.state, { pid: runtime.pid, name: runtime.name, team: runtime.team }, this.context(now)));
    }
    this.changed();
  }

  /** Участника убрали: он не в составе, не «на связи», его личный поток закрыт (`removed`). */
  removeParticipant(id: string, now: number): void {
    if (this.teams.delete(id)) {
      this.changed();
      return;
    }
    const player = this.players.get(id);
    if (!player) return;
    if (player.online) this.onlineCount -= 1;
    this.players.delete(id);
    this.playerList = null;
    this.closePersonal(id, "removed", now);
    this.changed();
  }

  /** За этого игрока вошёл другой телефон («Вы уже играли?»): прежний поток закрыт, номера пачек — с чистого листа. */
  deviceMoved(pid: string, now: number): void {
    const player = this.players.get(pid);
    if (player) player.streams.clear();
    this.closePersonal(pid, "removed", now);
  }

  private closePersonal(pid: string, reason: RoomClosedReason, now: number): void {
    const set = this.me.get(pid);
    if (!set) return;
    this.me.delete(pid);
    const event: RoomStreamEvent = { type: "closed", at: now, reason };
    for (const l of set) {
      l.send(event);
      l.end();
    }
  }

  /** Кто сейчас на связи (для `participants.seen_at`: «Вы уже играли?» не отдаёт играющего в комнате). */
  onlinePids(): string[] {
    const pids: string[] = [];
    for (const p of this.players.values()) if (p.online) pids.push(p.pid);
    return pids;
  }

  get playersCount(): number {
    return this.players.size;
  }

  get online(): number {
    return this.onlineCount;
  }

  private list(): RoomPlayer[] {
    this.playerList ??= [...this.players.values()].map((p) => ({ pid: p.pid, name: p.name, team: p.team }));
    return this.playerList;
  }

  // -------------------------------------------------------------- вид и действия игры

  private view(now: number): RoomView {
    return {
      now,
      paused: this.paused,
      players: this.list(),
      teams: this.teams,
      online: (pid) => this.players.get(pid)?.online === true,
      onlineCount: this.onlineCount,
    };
  }

  private context(now: number): RoomContext {
    return {
      ...this.view(now),
      send: (pid, data) => this.sendPersonal(pid, { type: "event", at: now, data }),
      changed: () => this.changed(),
      checkpoint: () => {
        this.checkpointWanted = true;
      },
      random: (key) => seededRandom(this.seed, key),
    };
  }

  /** Код игры не валит комнату: исключение — в журнал, комната живёт дальше. */
  private safely<T>(where: string, run: () => T): T | undefined {
    try {
      return run();
    } catch (error) {
      this.onError(where, error);
      return undefined;
    }
  }

  changed(): void {
    this.version += 1;
    this.screenDirty = true;
  }

  every(): number {
    return this.game.batchMs(this.players.size);
  }

  moment(): string {
    const value = this.game.moment ? this.safely("moment", () => this.game.moment?.(this.state)) : "";
    return typeof value === "string" ? value : "";
  }

  /** Пачка телефона `uid`. Не участник — отказ; повтор номера — «уже было», без обработки. */
  input(uid: string, input: ParsedInput, now: number): InputResult {
    const player = this.players.get(uid);
    if (!player) return { ok: false, status: 403, error: "permission-denied" };
    if (player.requests.take(1, now) === 0) return { ok: false, status: 429, error: "resource-exhausted" };
    this.seen(player, now);
    const every = this.every();
    // Интервал, по которому телефон формировал эту пачку: порог игроков мог смениться — тогда и прежний, пока не
    // прошло двух прежних интервалов.
    if (player.toldEvery !== every) {
      player.prevEvery = player.toldEvery;
      player.everyChangedAt = now;
      player.toldEvery = every;
    }
    const recentPrev = now - player.everyChangedAt <= 2 * player.prevEvery + FRESH_AGO_SLACK_MS ? player.prevEvery : 0;
    const formedEvery = Math.max(every, recentPrev);
    const reply = { ok: true as const, at: now, every, paused: this.paused, dropped: 0, dup: false, stale: false, active: false };
    // Поток страницы — и для «я на связи»: время прошлого запроса — граница `ago` следующей пачки.
    let window = player.streams.get(input.stream);
    const prevRequestAt = window ? window.lastUsed : null;
    if (!window) {
      window = new SeqWindow(now);
      player.streams.set(input.stream, window);
      if (player.streams.size > STREAMS_PER_PLAYER) {
        // Вытесняется давно молчащий поток (страница, которую закрыли), а не первый по порядку.
        let oldest: string | null = null;
        let at = Infinity;
        for (const [key, w] of player.streams) {
          if (key !== input.stream && w.lastUsed < at) {
            at = w.lastUsed;
            oldest = key;
          }
        }
        if (oldest !== null) player.streams.delete(oldest);
      }
    }
    window.lastUsed = now;
    // «Я на связи»: номер не нужен и не тратится.
    if (input.events.length === 0 || input.seq === null) return reply;
    const status = window.check(input.seq);
    if (status === "dup") return { ...reply, dup: true };
    if (status === "stale") return { ...reply, stale: true };
    // На паузе события не идут в игру: время стоит (пачка — только «я на связи»), жетоны лимита не тратятся.
    if (this.paused) {
      window.commit(input.seq, now);
      return { ...reply, dropped: input.events.length };
    }
    const allowed = player.events.take(input.events.length, now);
    const dropped = input.events.length - allowed;
    if (allowed === 0) {
      window.commit(input.seq, now);
      return { ...reply, dropped };
    }
    // События — не раньше прихода предыдущей принятой пачки (без неё — интервал пачки с запасом), не старше 4 с.
    const { maxAgo, delayed } = agoLimit({
      now,
      every: formedEvery,
      status,
      retry: input.retry,
      prevBatchAt: window.prevArrival(input.seq),
      prevRequestAt,
      newestAt: window.newestArrival(),
    });
    const events = input.events.slice(0, allowed).map((e) => timedEvent(e, now, maxAgo, delayed, this.game.stampedTime === true));
    // Раунд — на момент прихода пачки (до того, как игра её обработала).
    const unit = this.game.playUnit?.(this.state) ?? null;
    let failed = false;
    let played = false;
    try {
      played = this.game.onInput(this.state, { pid: player.pid, name: player.name, team: player.team }, events, this.context(now)) === true;
    } catch (error) {
      failed = true;
      this.onError("input", error);
    }
    // Номер учтён и при ошибке игры: повтор той же пачки упал бы так же; события — в `dropped`, телефон узнает.
    window.commit(input.seq, now);
    if (failed) return { ...reply, dropped: input.events.length };
    // «Играл в раунде» — только если игра приняла в пачке игровое действие (мусор `{ t: "zzz" }` не в счёт; проверка 2d, №4).
    if (unit !== null && played) this.markPlayed(player.pid, unit);
    this.activity(now);
    return { ...reply, dropped, active: true };
  }

  private markPlayed(pid: string, unit: number): void {
    const key = `${pid}:${unit}`;
    if (this.playedSeen.has(key)) return;
    this.playedSeen.add(key);
    this.playedNew.push({ pid, unit });
  }

  /** Новые отметки «играл в раунде» для базы (`room_play`); забираются один раз. Не записались — `returnPlayed`. */
  takePlayed(): Array<{ pid: string; unit: number }> {
    const out = this.playedNew;
    this.playedNew = [];
    return out;
  }

  /** Запись не удалась — отметки вернутся к следующей попытке. */
  returnPlayed(marks: Array<{ pid: string; unit: number }>): void {
    this.playedNew.push(...marks);
  }

  /** Действие пульта по сессии (запись состояния, смена фазы): игра жива — комната не «забытая». Активностью для выкладки не считается (пульт сам обновляет `updated_at`). */
  sessionActive(now: number): void {
    this.activeAt = Math.max(this.activeAt, now);
  }

  private activity(now: number): void {
    this.lastActivity = now;
    this.activeAt = now;
    this.activityCount += 1;
  }

  /**
   * Команда пульта; `id` — повтор после обрыва возвращает прежний итог. `expect` — этап игры, который видел ведущий:
   * игра ушла дальше (второй пульт, двойное касание) — отказ `moved`. Пауза и продолжение повторяемы и без этапа.
   */
  command(cmd: string, args: unknown, id: string | null, now: number, expect: string | null = null): CommandOutcome {
    if (!COMMAND.test(cmd)) return { ok: false, error: "invalid-argument" };
    if (expect !== null && !MOMENT.test(expect)) return { ok: false, error: "invalid-argument" };
    if (id !== null) {
      const known = this.commands.get(id);
      if (known) return known;
    }
    this.activity(now);
    let outcome: CommandOutcome;
    if (cmd === "pause") outcome = this.pause(now);
    else if (cmd === "resume") outcome = this.resume(now);
    else if (expect !== null && expect !== this.moment()) outcome = { ok: false, error: "moved" };
    else outcome = this.safely("command", () => this.game.onCommand(this.state, cmd, args, this.context(now))) ?? { ok: false, error: "game-error" };
    if (id !== null) {
      this.commands.set(id, outcome);
      if (this.commands.size > COMMAND_MEMORY) this.commands.delete(this.commands.keys().next().value ?? "");
    }
    return outcome;
  }

  private pause(now: number): CommandOutcome {
    if (this.paused) return { ok: true };
    this.paused = true;
    this.pausedAt = now;
    this.safely("pause", () => this.game.onPause?.(this.state, this.context(now)));
    this.afterPauseChange(now);
    return { ok: true };
  }

  private resume(now: number): CommandOutcome {
    if (!this.paused) return { ok: true };
    this.paused = false;
    this.restored = false;
    const pausedMs = Math.max(0, now - this.pausedAt);
    this.safely("resume", () => this.game.onResume?.(this.state, pausedMs, this.context(now)));
    this.afterPauseChange(now);
    return { ok: true };
  }

  private afterPauseChange(now: number): void {
    this.changed();
    this.checkpointWanted = true;
    const event: RoomStreamEvent = { type: "room", at: now, paused: this.paused };
    for (const set of this.me.values()) for (const l of set) l.send(event);
  }

  private seen(player: PlayerRuntime, now: number): void {
    player.lastSeen = now;
    if (!player.online) {
      player.online = true;
      this.onlineCount += 1;
      this.changed();
    }
  }

  /** Шаг общего цикла: игра, «без связи», рассылка сводок в своём темпе. */
  tick(now: number): void {
    for (const player of this.players.values()) {
      const online = now - player.lastSeen <= this.game.offlineMs;
      if (online !== player.online) {
        player.online = online;
        this.onlineCount += online ? 1 : -1;
        this.changed();
      }
    }
    if (!this.paused && this.game.tick) this.safely("tick", () => this.game.tick?.(this.state, this.context(now)));
    const screenEvery = 1000 / (this.game.screenHz ?? 5);
    // Экрану — при переменах не чаще `screenHz`, а без перемен — раз в секунду: по непрерывности сводок экран отличает живой
    // поток от снимка после обрыва (разрыв больше 3 с — снимок, без пропущенных моментов; аудит 2c, второй круг).
    const screenDue = this.screenDirty ? screenEvery : SCREEN_KEEPALIVE_MS;
    if (this.screens.size > 0 && now - this.lastScreenAt >= screenDue) this.flushScreen(now);
    // Пульт — раз в секунду всегда (задержка цикла и память меняются и без игры), чаще не надо.
    if (this.hosts.size > 0 && now - this.lastHostAt >= 1000) this.flushHost(now);
  }

  // -------------------------------------------------------------- потоки

  screenEvent(now: number): RoomStreamEvent {
    return {
      type: "screen",
      at: now,
      version: this.version,
      paused: this.paused,
      players: this.players.size,
      online: this.onlineCount,
      data: this.safely("screen", () => this.game.screen(this.state, this.view(now))) ?? null,
    };
  }

  hostEvent(now: number): RoomStreamEvent {
    const offline: RoomOfflinePlayer[] = [];
    for (const p of this.players.values()) {
      if (!p.online && offline.length < OFFLINE_LIST_MAX) offline.push({ pid: p.pid, name: p.name });
    }
    return {
      type: "host",
      at: now,
      version: this.version,
      moment: this.moment(),
      paused: this.paused,
      restored: this.restored,
      players: this.players.size,
      online: this.onlineCount,
      offline,
      loop: this.loop(),
      data: this.safely("host", () => this.game.host(this.state, this.view(now))) ?? null,
    };
  }

  meEvent(pid: string, now: number): RoomStreamEvent {
    return {
      type: "snapshot",
      at: now,
      paused: this.paused,
      every: this.every(),
      offlineMs: this.game.offlineMs,
      data: this.safely("personal", () => this.game.personal(this.state, pid, this.view(now))) ?? null,
    };
  }

  private flushScreen(now: number): void {
    this.screenDirty = false;
    this.lastScreenAt = now;
    // Одно событие на всех: строка для потока собирается один раз (sseFrame).
    const event = this.screenEvent(now);
    for (const l of this.screens) l.send(event);
  }

  private flushHost(now: number): void {
    this.lastHostAt = now;
    const event = this.hostEvent(now);
    for (const l of this.hosts) l.send(event);
  }

  private sendPersonal(pid: string, event: RoomStreamEvent): void {
    for (const l of this.me.get(pid) ?? []) l.send(event);
  }

  /** Подписка: снимок сразу, дальше события. Возвращает отписку. */
  listen(kind: "me" | "screen" | "host", listener: RoomListener, now: number, pid = ""): () => void {
    if (kind === "me") {
      let set = this.me.get(pid);
      if (!set) {
        set = new Set();
        this.me.set(pid, set);
      }
      const target = set;
      target.add(listener);
      listener.send(this.meEvent(pid, now));
      return () => {
        target.delete(listener);
        if (target.size === 0 && this.me.get(pid) === target) this.me.delete(pid);
      };
    }
    const target = kind === "screen" ? this.screens : this.hosts;
    target.add(listener);
    listener.send(kind === "screen" ? this.screenEvent(now) : this.hostEvent(now));
    return () => target.delete(listener);
  }

  get listeners(): number {
    let n = this.screens.size + this.hosts.size;
    for (const set of this.me.values()) n += set.size;
    return n;
  }

  /** Комната выгружается: всем «закрыто», потоки закрываются (телефоны переподключатся). */
  close(reason: RoomClosedReason, now: number): void {
    const event: RoomStreamEvent = { type: "closed", at: now, reason };
    const all = [...this.screens, ...this.hosts, ...[...this.me.values()].flatMap((s) => [...s])];
    this.screens.clear();
    this.hosts.clear();
    this.me.clear();
    for (const l of all) {
      l.send(event);
      l.end();
    }
  }

  // -------------------------------------------------------------- снимок

  /** Снимок для базы; `clean` — спокойная выгрузка (после загрузки пауза та же, что была). */
  snapshotData(now: number, clean = false): RoomSnapshotData {
    return {
      v: 1,
      game: this.game.id,
      key: this.key,
      seed: this.seed,
      state: this.game.snapshot(this.state),
      savedAt: now,
      version: this.version,
      activeAt: this.activeAt,
      paused: this.paused,
      pausedAt: this.pausedAt,
      clean,
    };
  }

  /** Режим участников комнаты (для игр). */
  get mode(): "solo" | "teams" {
    return this.playMode;
  }
}

/** Снимок из базы как `RoomSnapshotData`; не тот формат — null. */
export function parseSnapshotData(value: unknown): RoomSnapshotData | null {
  if (!isRecord(value) || value.v !== 1) return null;
  const { game, key, seed } = value;
  if (typeof game !== "string" || typeof key !== "string" || typeof seed !== "string") return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    v: 1,
    game,
    key,
    seed,
    state: value.state ?? null,
    savedAt: num(value.savedAt),
    version: Math.max(0, Math.floor(num(value.version))),
    // Снимки до этой правки — без метки активности: считаем от времени снимка.
    activeAt: typeof value.activeAt === "number" && Number.isFinite(value.activeAt) ? value.activeAt : num(value.savedAt),
    paused: value.paused === true,
    pausedAt: num(value.pausedAt),
    clean: value.clean === true,
  };
}
