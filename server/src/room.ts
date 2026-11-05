/**
 * Быстрый канал своего сервера (CLAUDE.md, «Быстрый канал (комнаты)», логика — docs/fast-room.md): игровые комнаты в
 * памяти процесса app.
 *
 * Комната создаётся лениво — при первой пачке, команде или подписке — и только для сессии, механика которой есть в
 * реестре комнатных игр (`rooms/registry.ts`). Состав (устройство → участник) берётся из базы при создании и дальше
 * обновляется событиями Hub `participants:<id>` (и `device:<id>` — за игрока вошёл другой телефон); завершение
 * сессии и смена блока вечера приходят событиями `session:<id>`. Один общий цикл (~100 мс) на все комнаты: игра,
 * «без связи», сводки экрана (до 5 раз в секунду) и пульта (раз в секунду), снимки в `room_snapshots` (на контрольных
 * точках и раз в 10 с, если менялось; не на паузе и без перемен — метка «жив» `savedAt` раз в 10 с), отметка активности
 * в `sessions.updated_at` раз в минуту — только пока идут
 * пачки с событиями и команды (выкладка ждёт конца игры, брошенная вкладка её не держит), выгрузка через 15 минут без
 * активности и подписчиков. После перезапуска комната поднимается из снимка на паузе — ведущий продолжает `resume`.
 *
 * Маршруты: `POST /api/rooms/:id/input` (пачка телефона, ≤ 4 КБ), `POST /api/rooms/:id/command` (только ведущий),
 * `GET /api/rooms/:id/me|screen|host` (снимок для опроса без потока), потоки `GET /api/stream/room/:id/me|screen|host`.
 * Права — функции `src/data/permissions.ts`. В журнал — только числа и виды действий, без имён.
 */
import { createHash } from "node:crypto";
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { parseProgram } from "../../src/core/program";
import * as permissions from "../../src/data/permissions";
import type { RoomClosedReason, RoomLoopStats, RoomStreamEvent, RoomStreamKind } from "../../src/data/types";
import { apiGuard, DEVICE_COOKIE, identityOf, readCookie, SESSION_COOKIE } from "./auth";
import { DEVICES_CHANNEL, sseFrame, type Hub } from "./live";
import { parseInput, parseSnapshotData, Room, TokenBucket, type RoomGame, type RoomListener } from "./rooms/engine";
import { roomGames } from "./rooms/registry";

export interface RoomsOptions {
  sql: Sql;
  hub: Hub;
  isSite?: (request: FastifyRequest) => boolean;
  now?: () => number;
  /** «Я жив» в потоках, мс. */
  keepAliveMs?: number;
  /** Шаг общего цикла, мс; 0 — без таймера (тесты зовут `step()` сами). */
  loopMs?: number;
  /** Без пачек с событиями, команд и подписчиков столько — комната выгружается (со снимком). */
  idleMs?: number;
  /** Без пачек с событиями и команд столько — выгружается и с открытыми потоками (забытая вкладка). */
  abandonedMs?: number;
  /** Снимок в базу не реже, если что-то менялось. */
  snapshotEveryMs?: number;
  /** Отметка активности в `sessions.updated_at` не чаще. */
  touchEveryMs?: number;
  /** Комнат в памяти — не больше. */
  maxRooms?: number;
  /** Личных потоков (`me`) у одной комнаты — не больше (по умолчанию `STREAMS_PER_ROOM`; тесты ставят меньше). */
  streamsPerRoom?: number;
  /** Экранов не ведущего у комнаты и с одного адреса — не больше (`SCREENS_PER_ROOM`, `SCREENS_PER_IP`). */
  screensPerRoom?: number;
  screensPerIp?: number;
  /** Включить проверочную игру `room-check` (только test: `roomCheckEnabled`). */
  check?: boolean;
  /** Игры комнат (тесты подменяют; по умолчанию — `roomGames({ check })`). */
  games?: ReadonlyMap<string, RoomGame<unknown>>;
  /** Тестам — доступ к комнатам. */
  onManager?: (manager: RoomManager) => void;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const COMMAND_ID = /^[A-Za-z0-9_-]{1,40}$/;
export const ROOM_BODY = 4 * 1024;
/** Задержка цикла больше этого — в журнал (не чаще раза в минуту). */
export const LOOP_LAG_WARN_MS = 100;
const LAG_WINDOW = 100;
/** Устройство по cookie помним столько: пачки идут раз в секунду, а в базу за каждой не ходим. */
export const IDENTITY_TTL_MS = 30_000;
const IDENTITY_MAX = 20_000;
/** Неизвестный комнате телефон проверяем по базе не чаще (вошёл, а событие Hub ещё не дошло). */
export const MEMBER_RECHECK_MS = 1000;
/**
 * Потоков одного вида у одного устройства (ТЗ: не больше двух на телефон; третий — переподключение): лишний — старый
 * закрыт (`replaced`). Устройство гостя — его uid (неверная cookie сеанса рядом с cookie устройства ничего не меняет);
 * у вошедшего — отпечаток cookie сеанса, по которой он вошёл: у ведущего один uid на пульт в телефоне, планшете и экран
 * на ноутбуке, и переподключение пульта не должно закрывать экран.
 */
export const STREAMS_PER_DEVICE = 3;
/** Личных потоков игроков у одной комнаты: 500 гостей по два потока и запас. Экраны и ведущий — в своих запасах. */
export const STREAMS_PER_ROOM = 1100;
/**
 * Экранов не ведущего (`screen` открывает любое вошедшее устройство — чужой телевизор по коду) у комнаты и с одного адреса:
 * настоящих экранов 1–3, а сотни выданных устройств иначе заняли бы места игроков.
 */
export const SCREENS_PER_ROOM = 50;
export const SCREENS_PER_IP = 10;
/** Поток закрыт (`end()`), а клиент не дочитал — через столько он обрывается (буфер не живёт вечно). */
export const END_GRACE_MS = 5000;
/** Отдельный запас потоков ведущего этой сессии (пульты и экраны) — вне общего предела: гости его не займут. */
export const HOST_STREAMS_PER_ROOM = 30;
/** Поток комнаты, у которого ждёт отправки больше этого, обрывается (переподключится со свежим снимком). */
export const ROOM_STREAM_BACKLOG_BYTES = 128 * 1024;
/** Сколько всего может ждать отправки в потоках одной комнаты и всех комнат: дальше обрываются самые отставшие. */
export const ROOM_BACKLOG_BYTES = 16 * 1024 * 1024;
export const ROOMS_BACKLOG_BYTES = 48 * 1024 * 1024;
/** Кто на связи в комнате — в `participants.seen_at` не реже (у «Вы уже играли?» порог 75 с). */
export const SEEN_EVERY_MS = 30_000;
/** Опросов снимка без потока с устройства: запас 5 и один в секунду (клиент опрашивает раз в 2 с). */
const POLL_BURST = 5;
const POLL_PER_SECOND = 1;
/** Ошибка в коде игры — в журнал не чаще раза в минуту на комнату и место. */
const ERROR_LOG_MS = 60_000;

interface SessionRoomRow {
  id: string;
  host_id: string;
  mechanic: string | null;
  game_snapshot: unknown;
  play_mode: string;
  phase: string;
  program: unknown;
  /** `updated_at` моложе 12 часов (по часам базы): пульт что-то делал — сессия не забыта. */
  fresh: boolean;
}

interface ParticipantRoomRow {
  id: string;
  name: string;
  kind: string;
  team_id: string | null;
}

interface Entry {
  room: Room;
  lastSnapAt: number;
  /** Когда последний раз писали снимок или метку «жив» (после сбоя простой считается от неё). */
  lastAliveAt: number;
  lastTouchAt: number;
  /** Сколько активностей комнаты уже отмечено в `updated_at` (создание комнаты — не активность). */
  touchedActivity: number;
  /** Когда последний раз писали `participants.seen_at` тех, кто на связи; идёт ли запись (не накладываются). */
  lastSeenAt: number;
  seenBusy: boolean;
  saving: Promise<void> | null;
  again: boolean;
  /** Следующий снимок — «спокойная выгрузка» (`clean`). */
  clean: boolean;
  stop: () => void;
  errorsAt: Map<string, number>;
}

type LoadResult = Entry | "missing" | "finished" | "no-room" | "full" | "closing" | "abandoned";

/** Чьё место занимает поток: ведущего сессии, экрана не ведущего, личный поток игрока. */
export type StreamPool = "host" | "screen" | "me";

/** Поток комнаты в менеджере: чей (у каждого вида мест свой предел), какого устройства и адреса, отписка от комнаты. */
interface StreamItem {
  room: string;
  device: string;
  pool: StreamPool;
  ip: string;
  listener: RoomListener;
  detach: () => void;
}

/** Механика и блок вечера: другой блок — другая комната, снимок прежнего не подходит. */
export function roomKey(mechanic: string | null, program: unknown): string {
  const parsed = parseProgram(program ?? null);
  return parsed ? `${mechanic ?? ""}#${parsed.index}` : (mechanic ?? "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200);
}

/** Нарушение внешнего ключа: сессию удалили, а комната ещё в памяти. */
function isForeignKeyError(error: unknown): boolean {
  return isRecord(error) && error.code === "23503";
}

export class RoomManager {
  private readonly rooms = new Map<string, Entry>();
  private readonly loading = new Map<string, Promise<LoadResult>>();
  /** Выгружаемые комнаты: пока снимок пишется, новая загрузка ждёт его (иначе поднимется прежний снимок). */
  private readonly unloading = new Map<string, Promise<void>>();
  /** Потоки устройств: `комната:вид:устройство` → открытые (старые первыми). */
  private readonly deviceStreams = new Map<string, StreamItem[]>();
  /** Все потоки по комнатам (предел числа и общего буфера). */
  private readonly roomStreams = new Map<string, Set<StreamItem>>();
  private lastBacklogCheck = -Infinity;
  /** Закрытые (вытесненные, выгруженные) потоки, которые ещё не дописаны: их буфер тоже в счёте, пока не оборвутся. */
  private readonly ending = new Set<RoomListener>();
  private readonly stopDevices: () => void;
  /** Кто шлёт пачки: cookie → uid (без базы на каждую пачку); uid → ключи cookie (сбросить при перехвате). */
  private readonly identities = new Map<string, { uid: string; until: number }>();
  private readonly identityKeys = new Map<string, Set<string>>();
  private readonly polls = new Map<string, TokenBucket>();
  private readonly lags: number[] = [];
  private lastLagWarn = -Infinity;
  private timer: ReturnType<typeof setInterval> | null = null;
  private closing = false;
  private readonly now: () => number;
  private readonly games: ReadonlyMap<string, RoomGame<unknown>>;
  private readonly idleMs: number;
  private readonly abandonedMs: number;
  private readonly snapshotEveryMs: number;
  private readonly touchEveryMs: number;
  private readonly maxRooms: number;

  constructor(
    private readonly sql: Sql,
    /** Hub сессий (тесты публикуют в него события). */
    readonly hub: Hub,
    private readonly log: FastifyBaseLogger,
    options: Omit<RoomsOptions, "sql" | "hub" | "isSite">,
  ) {
    this.now = options.now ?? Date.now;
    this.games = options.games ?? roomGames({ check: options.check === true });
    this.idleMs = options.idleMs ?? 15 * 60_000;
    this.abandonedMs = options.abandonedMs ?? 12 * 60 * 60_000;
    this.snapshotEveryMs = options.snapshotEveryMs ?? 10_000;
    this.touchEveryMs = options.touchEveryMs ?? 60_000;
    this.maxRooms = options.maxRooms ?? 500;
    // За игрока вошёл другой телефон — кэш входа сбрасывается сразу, даже если комната выгружена.
    this.stopDevices = hub.subscribe(DEVICES_CHANNEL, (event) => {
      if (isRecord(event) && event.type === "moved" && typeof event.pid === "string") this.forgetDevice(event.pid);
    });
    const loopMs = options.loopMs ?? 100;
    if (loopMs > 0) {
      let last = performance.now();
      this.timer = setInterval(() => {
        const t = performance.now();
        this.lag(Math.max(0, t - last - loopMs));
        last = t;
        this.step();
      }, loopMs);
      this.timer.unref?.();
    }
  }

  /** Задержка цикла (последняя и худшая за ~10 с) и память процесса. */
  loopStats(): RoomLoopStats {
    const last = this.lags[this.lags.length - 1] ?? 0;
    return {
      lagMs: Math.round(last),
      maxLagMs: Math.round(this.lags.reduce((a, b) => Math.max(a, b), 0)),
      memoryMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    };
  }

  /** Замер задержки общего цикла (тесты передают свои числа). */
  lag(ms: number): void {
    this.lags.push(ms);
    if (this.lags.length > LAG_WINDOW) this.lags.shift();
    const now = this.now();
    if (ms > LOOP_LAG_WARN_MS && now - this.lastLagWarn >= 60_000) {
      this.lastLagWarn = now;
      this.log.warn({ roomLoopLagMs: Math.round(ms), rooms: this.rooms.size }, "rooms loop lag");
    }
  }

  get size(): number {
    return this.rooms.size;
  }

  get isClosing(): boolean {
    return this.closing;
  }

  loaded(id: string): Room | null {
    return this.rooms.get(id)?.room ?? null;
  }

  /**
   * Комната сессии: загруженная или новая (из снимка, если он есть). Два запроса сразу — одна комната. `revive` — запрос с
   * игрой (пачка с событиями, команда ведущего): только он поднимает комнату, в которой 12 часов не было игры; подписка,
   * опрос и «я на связи» получают `abandoned`.
   */
  async get(id: string, revive = false): Promise<LoadResult> {
    if (this.closing) return "closing";
    const known = this.rooms.get(id);
    if (known) return known;
    let pending = this.loading.get(id);
    if (!pending) {
      pending = this.load(id, revive).finally(() => this.loading.delete(id));
      this.loading.set(id, pending);
    }
    const result = await pending;
    // Попали на загрузку подписки (без игры), а этот запрос с игрой: забытую комнату поднимаем своей загрузкой.
    if (revive && result === "abandoned") return this.get(id, true);
    return result;
  }

  private async load(id: string, revive: boolean): Promise<LoadResult> {
    await this.unloading.get(id);
    if (this.closing) return "closing";
    // Подписка раньше чтения сессии и состава: завершение или вход, случившиеся между запросом и созданием
    // комнаты, не потеряются (события копятся и применяются к готовой комнате).
    const buffered: Array<{ channel: "participants" | "session" | "device"; event: object }> = [];
    let entry: Entry | null = null;
    const deliver = (channel: "participants" | "session" | "device", event: object) => {
      if (entry) this.onHub(entry, channel, event);
      else buffered.push({ channel, event });
    };
    const stops = [
      this.hub.subscribe(`participants:${id}`, (e) => deliver("participants", e)),
      this.hub.subscribe(`session:${id}`, (e) => deliver("session", e)),
      this.hub.subscribe(`device:${id}`, (e) => deliver("device", e)),
    ];
    const stop = () => stops.forEach((s) => s());
    try {
      const [row] = await this.sql<SessionRoomRow[]>`
        select id, host_id, mechanic, game_snapshot, play_mode, phase, program,
          updated_at > now() - make_interval(secs => ${this.abandonedMs / 1000}) as fresh
        from sessions where id = ${id}`;
      if (!row) return this.cancel(stop, "missing");
      if (row.phase === "finished") return this.cancel(stop, "finished");
      const game = row.mechanic ? this.games.get(row.mechanic) : undefined;
      if (!game) return this.cancel(stop, "no-room");
      if (this.rooms.size >= this.maxRooms) return this.cancel(stop, "full");
      const participants = await this.sql<ParticipantRoomRow[]>`
        select id, name, kind, team_id from participants where session_id = ${id}`;
      const [snap] = await this.sql<{ data: unknown }[]>`select data from room_snapshots where session_id = ${id}`;
      if (this.closing) return this.cancel(stop, "closing");
      const now = this.now();
      const restoreFrom = snap ? parseSnapshotData(snap.data) : null;
      // Забыта — только если и в комнате 12 часов не было игры, и пульт сессии 12 часов ничего не делал (лобби с утра, а игра
      // вечером — не забыта: «Начать игру» обновляет `updated_at`).
      if (!revive && !row.fresh && restoreFrom && now - restoreFrom.activeAt >= this.abandonedMs) return this.cancel(stop, "abandoned");
      const errorsAt = new Map<string, number>();
      const room = new Room({
        id,
        key: roomKey(row.mechanic, row.program),
        hostId: row.host_id,
        phase: row.phase === "playing" ? "playing" : "lobby",
        game,
        players: participants.filter((p) => p.kind === "player").map((p) => ({ pid: p.id, name: p.name, team: p.team_id })),
        teams: participants.filter((p) => p.kind === "team").map((p) => [p.id, p.name] as [string, string]),
        snapshot: row.game_snapshot ?? null,
        playMode: row.play_mode === "teams" ? "teams" : "solo",
        now,
        restoreFrom,
        loop: () => this.loopStats(),
        onError: (where, error) => this.gameError(errorsAt, where, error),
      });
      const created: Entry = {
        room,
        lastSnapAt: now,
        lastAliveAt: now,
        lastTouchAt: -Infinity,
        touchedActivity: room.activityCount,
        lastSeenAt: now,
        seenBusy: false,
        saving: null,
        again: false,
        clean: false,
        stop,
        errorsAt,
      };
      entry = created;
      this.rooms.set(id, created);
      for (const b of buffered) this.onHub(created, b.channel, b.event);
      if (room.restored) this.log.info({ room: "restored", players: room.playersCount }, "rooms");
      return this.rooms.get(id) === created ? created : "finished";
    } catch (error) {
      stop();
      throw error;
    }
  }

  private cancel(stop: () => void, result: Exclude<LoadResult, Entry>): Exclude<LoadResult, Entry> {
    stop();
    return result;
  }

  /** Ошибка в коде игры: комната живёт дальше, в журнал — не чаще раза в минуту на место. */
  private gameError(errorsAt: Map<string, number>, where: string, error: unknown): void {
    const now = this.now();
    const last = errorsAt.get(where) ?? -Infinity;
    if (now - last < ERROR_LOG_MS) return;
    errorsAt.set(where, now);
    this.log.error({ room: where, err: message(error) }, "rooms game error");
  }

  private onHub(entry: Entry, channel: "participants" | "session" | "device", raw: object): void {
    if (!isRecord(raw) || this.rooms.get(entry.room.id) !== entry) return;
    const now = this.now();
    const room = entry.room;
    if (channel === "device") {
      // За игрока вошёл другой телефон: прежний телефон больше не он — поток закрыт, кэш входа сброшен.
      if (raw.type === "moved" && typeof raw.pid === "string") {
        room.deviceMoved(raw.pid, now);
        this.forgetDevice(raw.pid);
      }
      return;
    }
    if (channel === "participants") {
      const upsert = (p: unknown) => {
        if (isRecord(p) && typeof p.id === "string" && typeof p.name === "string") {
          room.upsertParticipant({ id: p.id, name: p.name, kind: p.kind === "team" ? "team" : "player", teamId: typeof p.teamId === "string" ? p.teamId : null }, now);
        }
      };
      if (raw.type === "upsert") upsert(raw.participant);
      else if (raw.type === "remove" && typeof raw.id === "string") {
        room.removeParticipant(raw.id, now);
        this.forgetDevice(raw.id);
      } else if (raw.type === "snapshot" && Array.isArray(raw.participants)) raw.participants.forEach(upsert);
      return;
    }
    // Сессия: действие пульта (запись состояния, смена фазы) — игра жива, комната не «забытая».
    room.sessionActive(now);
    // Завершили — комната выгружается; сменился блок вечера или механика — тоже (новая игра с чистого листа).
    const state = raw.type === "patch" ? raw.state : isRecord(raw.session) ? raw.session.state : null;
    if (isRecord(state) && state.phase === "finished") {
      void this.unload(room.id, "finished");
      return;
    }
    if (isRecord(state) && (state.phase === "lobby" || state.phase === "playing")) room.phase = state.phase;
    if (raw.type === "snapshot" && isRecord(raw.session)) {
      const mechanic = typeof raw.session.mechanic === "string" ? raw.session.mechanic : null;
      if (roomKey(mechanic, raw.session.program) !== room.key) void this.unload(room.id, "unloaded");
    }
  }

  // ---------------------------------------------------------------- кто шлёт

  identity(key: string, now: number): string | null {
    const known = this.identities.get(key);
    return known && known.until > now ? known.uid : null;
  }

  rememberIdentity(key: string, uid: string, now: number): void {
    if (this.identities.size > IDENTITY_MAX) {
      this.identities.clear();
      this.identityKeys.clear();
    }
    this.identities.set(key, { uid, until: now + IDENTITY_TTL_MS });
    let keys = this.identityKeys.get(uid);
    if (!keys) {
      keys = new Set();
      this.identityKeys.set(uid, keys);
    }
    keys.add(key);
  }

  /** Устройство больше не этот игрок (перехват, удаление): следующая пачка проверит вход по базе. */
  forgetDevice(uid: string): void {
    for (const key of this.identityKeys.get(uid) ?? []) this.identities.delete(key);
    this.identityKeys.delete(uid);
  }

  /** Опрос снимка без потока: не чаще раза в секунду на комнату, вид и устройство (запас 5). */
  pollAllowed(key: string, now: number): boolean {
    let bucket = this.polls.get(key);
    if (!bucket) {
      if (this.polls.size > IDENTITY_MAX) this.polls.clear();
      bucket = new TokenBucket(POLL_BURST, POLL_PER_SECOND, now);
      this.polls.set(key, bucket);
    }
    return bucket.take(1, now) === 1;
  }

  /** Неизвестный телефон: вдруг он только что вошёл (событие Hub ещё не дошло) — запрос к базе не чаще раза в секунду. */
  private readonly rechecked = new Map<string, number>();
  async knowMember(room: Room, uid: string): Promise<boolean> {
    if (room.has(uid)) return true;
    const key = `${room.id}:${uid}`;
    const now = this.now();
    const last = this.rechecked.get(key);
    if (last !== undefined && now - last < MEMBER_RECHECK_MS) return false;
    if (this.rechecked.size > 20_000) this.rechecked.clear();
    this.rechecked.set(key, now);
    const [p] = await this.sql<ParticipantRoomRow[]>`
      select id, name, kind, team_id from participants where session_id = ${room.id} and id = ${uid}`;
    if (!p || p.kind !== "player") return false;
    room.upsertParticipant({ id: p.id, name: p.name, kind: "player", teamId: p.team_id }, this.now());
    return room.has(uid);
  }

  /**
   * Можно ли открыть ещё поток. У каждого вида мест свой предел: ведущий сессии — `HOST_STREAMS_PER_ROOM`, экраны не
   * ведущего — `screens` на комнату и `screensPerIp` с адреса, личные потоки игроков — `limit`. Если у этого устройства уже
   * `STREAMS_PER_DEVICE` таких потоков, новый вытеснит старый — число не вырастет, и переподключение на место своего
   * повисшего потока проходит и при полной комнате.
   */
  streamAllowed(
    room: Room,
    device: string,
    pool: StreamPool,
    options: { ip?: string; limit?: number; screens?: number; screensPerIp?: number } = {},
  ): boolean {
    if ((this.deviceStreams.get(`${room.id}:${device}`)?.length ?? 0) >= STREAMS_PER_DEVICE) return true;
    let count = 0;
    let fromIp = 0;
    for (const item of this.roomStreams.get(room.id) ?? []) {
      if (item.pool !== pool) continue;
      count += 1;
      if (options.ip !== undefined && item.ip === options.ip) fromIp += 1;
    }
    if (pool === "host") return count < HOST_STREAMS_PER_ROOM;
    if (pool === "screen") return count < (options.screens ?? SCREENS_PER_ROOM) && fromIp < (options.screensPerIp ?? SCREENS_PER_IP);
    return count < (options.limit ?? STREAMS_PER_ROOM);
  }

  /** Сколько потоков комнаты в учёте (тестам). */
  streamCount(id: string): number {
    return this.roomStreams.get(id)?.size ?? 0;
  }

  /**
   * Поток устройства: не больше `STREAMS_PER_DEVICE` одного вида у одного устройства в комнате — лишний (обычно
   * «повисший» после смены сети) сначала отписывается от комнаты (в закрытый поток сводки больше не пишутся), потом
   * получает «закрыто» (`replaced`) и закрывается. Число потоков комнаты проверяет маршрут до ответа (`streamAllowed`).
   */
  attachStream(room: Room, device: string, listener: RoomListener, attach: () => () => void, pool: StreamPool = "me", ip = ""): () => void {
    const key = `${room.id}:${device}`;
    const list = this.deviceStreams.get(key) ?? [];
    while (list.length >= STREAMS_PER_DEVICE) {
      const old = list.shift();
      if (!old) break;
      this.dropStream(old);
      old.listener.send({ type: "closed", at: this.now(), reason: "replaced" });
      old.listener.end();
      this.ending.add(old.listener);
    }
    const item: StreamItem = { room: room.id, device: key, pool, ip, listener, detach: attach() };
    list.push(item);
    this.deviceStreams.set(key, list);
    let set = this.roomStreams.get(room.id);
    if (!set) {
      set = new Set();
      this.roomStreams.set(room.id, set);
    }
    set.add(item);
    return () => this.dropStream(item);
  }

  /** Поток больше не в комнате и не в учёте (повторный вызов ничего не делает). */
  private dropStream(item: StreamItem): void {
    item.detach();
    const current = this.deviceStreams.get(item.device);
    if (current) {
      const rest = current.filter((l) => l !== item);
      if (rest.length > 0) this.deviceStreams.set(item.device, rest);
      else this.deviceStreams.delete(item.device);
    }
    const set = this.roomStreams.get(item.room);
    if (set) {
      set.delete(item);
      if (set.size === 0) this.roomStreams.delete(item.room);
    }
  }

  /** Комнату выгрузили: её потоки (уже получившие «закрыто») — вне учёта мест сразу, их недописанный буфер — в `ending`. */
  private releaseStreams(id: string): void {
    for (const item of [...(this.roomStreams.get(id) ?? [])]) {
      this.dropStream(item);
      this.ending.add(item.listener);
    }
  }

  /**
   * Буфер потоков: у комнаты больше `ROOM_BACKLOG_BYTES` или у всех комнат (вместе с закрытыми недописанными) больше
   * `ROOMS_BACKLOG_BYTES` ждёт отправки — обрываются самые отставшие потоки (переподключатся со свежим снимком), кроме
   * пульта ведущего. Иначе тысяча нечитаемых потоков заняла бы память процесса. Буфер сокета ядра здесь не виден.
   */
  trimBacklog(): number {
    let dropped = 0;
    for (const l of [...this.ending]) if (l.closed?.() !== false || (l.backlog?.() ?? 0) === 0) this.ending.delete(l);
    type Sized = { listener: RoomListener; item: StreamItem | null; size: number };
    const sizedOf = (items: StreamItem[]): Sized[] =>
      items.filter((item) => item.pool !== "host").map((item) => ({ listener: item.listener, item, size: item.listener.backlog?.() ?? 0 }));
    const cut = (all: Sized[], limit: number) => {
      const sized = all.filter((x) => x.size > 0);
      let total = sized.reduce((a, x) => a + x.size, 0);
      if (total <= limit) return;
      sized.sort((a, b) => b.size - a.size);
      for (const x of sized) {
        if (total <= limit) break;
        if (x.item) this.dropStream(x.item);
        this.ending.delete(x.listener);
        x.listener.destroy?.();
        total -= x.size;
        dropped += 1;
      }
    };
    for (const set of [...this.roomStreams.values()]) cut(sizedOf([...set]), ROOM_BACKLOG_BYTES);
    const closing: Sized[] = [...this.ending].map((listener) => ({ listener, item: null, size: listener.backlog?.() ?? 0 }));
    cut([...sizedOf([...this.roomStreams.values()].flatMap((set) => [...set])), ...closing], ROOMS_BACKLOG_BYTES);
    if (dropped > 0) this.log.warn({ room: "backlog", dropped }, "rooms");
    return dropped;
  }

  // ---------------------------------------------------------------- цикл

  /** Шаг общего цикла. */
  step(now = this.now()): void {
    for (const entry of [...this.rooms.values()]) {
      const room = entry.room;
      room.tick(now);
      if (room.checkpointWanted || (room.version !== room.savedVersion && now - entry.lastSnapAt >= this.snapshotEveryMs)) void this.save(entry);
      // Не на паузе и без перемен — метка «жив» раз в 10 с: после сбоя простой считается от неё, а не от снимка,
      // записанного, может быть, задолго до сбоя (иначе тихое время до сбоя прибавилось бы к дедлайнам). Забытой комнате
      // (12 часов без игры) метка не нужна.
      else if (!room.paused && room.savedVersion >= 0 && now - entry.lastAliveAt >= this.snapshotEveryMs && now - room.activeAt < this.abandonedMs) void this.alive(entry, now);
      // Кто играет в комнате — «на связи» и для медленного пути: «Вы уже играли?» не отдаст его новому телефону.
      if (now - entry.lastSeenAt >= SEEN_EVERY_MS && !entry.seenBusy) {
        entry.lastSeenAt = now;
        const pids = room.onlinePids();
        if (pids.length > 0) void this.markSeen(entry, pids, now);
      }
      // Игра идёт (пачки с событиями и команды) — сессия «живая» для выкладки: раз в минуту обновляем updated_at.
      // Пустые пачки («я на связи»), опросы, подписки и само создание комнаты — не игра: забытая вкладка не держит
      // выкладку и после выгрузки, подняв комнату снова, тоже.
      if (room.activityCount > entry.touchedActivity && now - entry.lastTouchAt >= this.touchEveryMs) {
        entry.touchedActivity = room.activityCount;
        entry.lastTouchAt = now;
        void this.touch(room.id);
      }
      if (now - room.activeAt >= this.abandonedMs) {
        // Забыта: 12 часов без игры. Потоки — `abandoned` (не переподключаются), подписка снова не поднимет.
        entry.clean = true;
        void this.unload(room.id, "abandoned");
      } else if (now - room.lastActivity >= this.idleMs && room.listeners === 0) {
        entry.clean = true;
        void this.unload(room.id, "unloaded");
      }
    }
    if (now - this.lastBacklogCheck >= 1000) {
      this.lastBacklogCheck = now;
      this.trimBacklog();
    }
  }

  private async markSeen(entry: Entry, pids: string[], now: number): Promise<void> {
    entry.seenBusy = true;
    try {
      await this.sql`update participants set seen_at = ${new Date(now)} where session_id = ${entry.room.id} and kind = 'player' and id in ${this.sql(pids)}`;
    } catch (error) {
      this.log.warn({ room: "seen", err: message(error) }, "rooms");
    } finally {
      entry.seenBusy = false;
    }
  }

  private async touch(id: string): Promise<void> {
    try {
      await this.sql`update sessions set updated_at = now() where id = ${id} and phase in ('lobby', 'playing')`;
    } catch (error) {
      this.log.warn({ room: "touch", err: message(error) }, "rooms");
    }
  }

  /** Метка «жив»: в снимке только `savedAt` (без игры — дёшево). Пишется снимок — метка не нужна. */
  private alive(entry: Entry, now: number): Promise<void> {
    entry.lastAliveAt = now;
    if (entry.saving) return entry.saving;
    const id = entry.room.id;
    entry.saving = (async () => {
      try {
        // Метка не «спокойная»: комната живёт, после сбоя — на паузе (`clean` сбрасывается вместе с `savedAt`).
        const mark = { savedAt: now, clean: false, activeAt: entry.room.activeAt };
        await this.sql`update room_snapshots set data = data || ${this.sql.json(mark as never)}::jsonb where session_id = ${id}`;
      } catch (error) {
        this.log.warn({ room: "alive", err: message(error) }, "rooms");
      } finally {
        entry.saving = null;
        if (entry.again) {
          entry.again = false;
          await this.save(entry);
        }
      }
    })();
    return entry.saving;
  }

  /** Снимок в базу; пока пишется прошлый — следующий встанет в очередь (не больше одного). */
  save(entry: Entry): Promise<void> {
    if (entry.saving) {
      entry.again = true;
      return entry.saving;
    }
    const room = entry.room;
    room.checkpointWanted = false;
    const version = room.version;
    const now = this.now();
    let data;
    try {
      data = room.snapshotData(now, entry.clean);
    } catch (error) {
      this.gameError(entry.errorsAt, "snapshot", error);
      return Promise.resolve();
    }
    entry.lastSnapAt = now;
    entry.lastAliveAt = now;
    entry.saving = (async () => {
      try {
        await this.sql`
          insert into room_snapshots (session_id, data, version, updated_at)
          values (${room.id}, ${this.sql.json(data as never)}, ${version % 2_000_000_000}, now())
          on conflict (session_id) do update set data = excluded.data, version = excluded.version, updated_at = now()`;
        room.savedVersion = version;
      } catch (error) {
        if (isForeignKeyError(error)) {
          // Сессию удалили (уборка, 30 дней), а комната ещё в памяти — выгружаем, писать некуда.
          this.dropDeleted(room.id);
        } else this.log.warn({ room: "snapshot", err: message(error) }, "rooms");
      } finally {
        entry.saving = null;
        if (entry.again) {
          entry.again = false;
          await this.save(entry);
        }
      }
    })();
    return entry.saving;
  }

  private dropDeleted(id: string): void {
    const entry = this.rooms.get(id);
    if (!entry) return;
    this.rooms.delete(id);
    entry.again = false;
    entry.stop();
    entry.room.close("finished", this.now());
    this.releaseStreams(id);
  }

  /** Выгрузить комнату: снимок, «закрыто» в потоки, отписка от Hub. */
  async unload(id: string, reason: RoomClosedReason): Promise<void> {
    const entry = this.rooms.get(id);
    if (!entry) return;
    this.rooms.delete(id);
    entry.stop();
    entry.room.close(reason, this.now());
    this.releaseStreams(id);
    const saved = this.save(entry);
    this.unloading.set(id, saved);
    try {
      await saved;
    } finally {
      if (this.unloading.get(id) === saved) this.unloading.delete(id);
    }
  }

  /**
   * Остановка приложения (хук `preClose`, до закрытия сервера): потоки закрываются (иначе сервер ждал бы их до
   * принудительной остановки), снимки всех комнат пишутся, новые загрузки — 503 (браузер повторит).
   */
  async close(): Promise<void> {
    this.closing = true;
    this.stopDevices();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.all([...this.loading.values()].map((p) => p.catch(() => undefined)));
    await Promise.all([...this.rooms.keys()].map((id) => this.unload(id, "unloaded")));
    await Promise.all([...this.unloading.values()]);
  }
}

// ------------------------------------------------------------------ маршруты

export function registerRooms(app: FastifyInstance, options: RoomsOptions): RoomManager {
  const { sql } = options;
  const now = options.now ?? Date.now;
  const keepAliveMs = options.keepAliveMs ?? 25_000;
  const streamLimits = { limit: options.streamsPerRoom, screens: options.screensPerRoom, screensPerIp: options.screensPerIp };
  const manager = new RoomManager(sql, options.hub, app.log, options);
  options.onManager?.(manager);
  // preClose, а не onClose: Fastify закрывает сервер раньше onClose и ждёт открытые соединения — поток событий
  // не закрылся бы сам, и снимков бы не было (сервер ждал бы до принудительной остановки контейнера).
  app.addHook("preClose", async () => manager.close());

  app.register(async (api) => {
    api.addHook("onRequest", apiGuard(options.isSite));

    function fail(reply: FastifyReply, status: number, code: string, reason?: string) {
      return reply.code(status).send(reason ? { error: code, reason } : { error: code });
    }

    /**
     * Устройство запроса — по той cookie, по которой реально вошли: вошедший (ведущий) — отпечаток cookie сеанса (она
     * проверена: случайную не подставить), гость — его uid (cookie устройства). Случайная cookie сеанса рядом с cookie
     * устройства ключ не меняет — лимит потоков не обойти.
     */
    function deviceKeyOf(request: FastifyRequest, who: { uid: string; user: unknown }): string {
      if (!who.user) return `u:${who.uid}`;
      const token = readCookie(request.headers.cookie, SESSION_COOKIE) ?? "";
      return `s:${createHash("sha256").update(token).digest("base64url").slice(0, 22)}`;
    }

    async function quickUid(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
      const cookie = request.headers.cookie;
      const key = `${readCookie(cookie, SESSION_COOKIE) ?? ""}|${readCookie(cookie, DEVICE_COOKIE) ?? ""}`;
      const at = now();
      const known = key !== "|" ? manager.identity(key, at) : null;
      if (known) return known;
      const who = await identityOf(sql, request, reply);
      if (!who) return null;
      if (key !== "|") manager.rememberIdentity(key, who.uid, at);
      return who.uid;
    }

    /** Комната или уже отправленный отказ. `revive` — запрос с игрой (поднимает и забытую комнату). */
    async function roomOf(id: string, reply: FastifyReply, revive = false): Promise<Room | null> {
      if (!ID.test(id)) {
        fail(reply, 404, "not-found");
        return null;
      }
      const found = await manager.get(id, revive);
      if (found === "missing" || found === "no-room") fail(reply, 404, "not-found");
      else if (found === "finished") fail(reply, 409, "failed-precondition", "finished");
      // 12 часов без игры: подписка, опрос и «я на связи» её не поднимают (клиент перестаёт).
      else if (found === "abandoned") fail(reply, 409, "failed-precondition", "abandoned");
      // Мест нет или сервер останавливается — повторяемо (не «нет такой игры»: клиент не сдастся).
      else if (found === "full" || found === "closing") fail(reply, 503, "unavailable");
      else return found.room;
      return null;
    }

    /** Комната, в которой состоит телефон: пока проверяли вход, её могли выгрузить — тогда берём новую. */
    async function memberRoom(id: string, uid: string, reply: FastifyReply, revive = false): Promise<{ room: Room; member: boolean } | null> {
      for (let attempt = 0; attempt < 2; attempt++) {
        const room = await roomOf(id, reply, revive);
        if (!room) return null;
        const member = await manager.knowMember(room, uid);
        if (manager.loaded(id) === room) return { room, member };
      }
      fail(reply, 503, "unavailable");
      return null;
    }

    api.post<{ Params: { id: string }; Body: unknown }>("/api/rooms/:id/input", { bodyLimit: ROOM_BODY }, async (request, reply) => {
      const uid = await quickUid(request, reply);
      if (!uid) return fail(reply, 401, "unauthenticated");
      const input = parseInput(request.body);
      if (!input) return fail(reply, 400, "invalid-argument");
      const found = await memberRoom(request.params.id, uid, reply, input.events.length > 0);
      if (!found) return reply;
      const { room, member } = found;
      if (!permissions.canSendRoomInput(uid, { phase: room.phase }, member ? { kind: "player" } : null)) return fail(reply, 403, "permission-denied");
      const result = room.input(uid, input, now());
      if (!result.ok) return fail(reply, result.status, result.error);
      return { at: result.at, every: result.every, paused: result.paused, dropped: result.dropped, dup: result.dup, stale: result.stale };
    });

    api.post<{ Params: { id: string }; Body: unknown }>("/api/rooms/:id/command", { bodyLimit: ROOM_BODY }, async (request, reply) => {
      const who = await identityOf(sql, request, reply);
      if (!who) return fail(reply, 401, "unauthenticated");
      const body = isRecord(request.body) ? request.body : {};
      const cmd = typeof body.cmd === "string" ? body.cmd : "";
      const commandId = body.id === undefined || body.id === null ? null : typeof body.id === "string" && COMMAND_ID.test(body.id) ? body.id : undefined;
      const expect = body.expect === undefined || body.expect === null ? null : typeof body.expect === "string" ? body.expect : undefined;
      if (!cmd || commandId === undefined || expect === undefined) return fail(reply, 400, "invalid-argument");
      for (let attempt = 0; attempt < 2; attempt++) {
        const room = await roomOf(request.params.id, reply, true);
        if (!room) return reply;
        if (!permissions.canCommandRoom(who.uid, { hostId: room.hostId, phase: room.phase })) return fail(reply, 403, "permission-denied");
        // Пока проверяли вход, комнату могли выгрузить — команда уйдёт в новую.
        if (manager.loaded(room.id) !== room) continue;
        const outcome = room.command(cmd, body.args ?? null, commandId, now(), expect);
        if (!outcome.ok) {
          if (outcome.error === "invalid-argument") return fail(reply, 400, "invalid-argument");
          // Игра ушла дальше (второй пульт, двойное касание) — как `apply` медленного пути.
          return fail(reply, 409, "failed-precondition", outcome.error);
        }
        request.log.info({ room: "command", cmd }, "rooms");
        return { ok: true, result: outcome.result ?? null, moment: room.moment() };
      }
      return fail(reply, 503, "unavailable");
    });

    /** Право на поток или снимок; отказ уже отправлен — null. */
    async function watchable(kind: RoomStreamKind, request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<{ room: Room; uid: string; device: string } | null> {
      const who = await identityOf(sql, request, reply);
      if (!who) {
        fail(reply, 401, "unauthenticated");
        return null;
      }
      const found = await memberRoom(request.params.id, who.uid, reply);
      if (!found) return null;
      const { room, member } = found;
      const allowed =
        kind === "me"
          ? permissions.canWatchRoomMe(who.uid, member ? { kind: "player" } : null)
          : kind === "screen"
            ? permissions.canWatchRoomScreen(who.uid)
            : permissions.canWatchRoomHost(who.uid, { hostId: room.hostId });
      if (!allowed) {
        fail(reply, 403, "permission-denied");
        return null;
      }
      return { room, uid: who.uid, device: deviceKeyOf(request, who) };
    }

    function snapshotOf(kind: RoomStreamKind, room: Room, uid: string): RoomStreamEvent {
      const at = now();
      return kind === "me" ? room.meEvent(uid, at) : kind === "screen" ? room.screenEvent(at) : room.hostEvent(at);
    }

    for (const kind of ["me", "screen", "host"] as const) {
      // Снимок без потока: опрос, когда поток не открывается (прокси, старый браузер). Не чаще раза в секунду.
      api.get<{ Params: { id: string } }>(`/api/rooms/:id/${kind}`, async (request, reply) => {
        const ok = await watchable(kind, request, reply);
        if (!ok) return reply;
        if (!manager.pollAllowed(`${ok.room.id}:${kind}:${ok.device}`, now())) return fail(reply, 429, "resource-exhausted");
        return snapshotOf(kind, ok.room, ok.uid);
      });

      api.get<{ Params: { id: string } }>(`/api/stream/room/:id/${kind}`, async (request, reply) => {
        const ok = await watchable(kind, request, reply);
        if (!ok) return reply;
        // Проверка до ответа: дальше до подключения нет ожиданий, число не изменится (отказ — 429, а не молчаливое закрытие).
        // Ведущий этой сессии — в своём запасе мест; своё повисшее место устройство занимает и при полной комнате.
        const device = `${kind}:${ok.device}`;
        // Места: ведущий — свой запас; экран не ведущего — свой (на комнату и адрес); личные потоки игроков — общий.
        const pool: StreamPool = ok.uid === ok.room.hostId ? "host" : kind === "screen" ? "screen" : "me";
        if (!manager.streamAllowed(ok.room, device, pool, { ...streamLimits, ip: request.ip })) return fail(reply, 429, "resource-exhausted");
        openRoomStream(reply, keepAliveMs, (listener) => {
          // Комнату выгрузили, пока проверяли вход: «закрыто» — браузер переподключится к новой.
          if (manager.loaded(ok.room.id) !== ok.room) {
            listener.send({ type: "closed", at: now(), reason: "unloaded" });
            listener.end();
            return () => undefined;
          }
          return manager.attachStream(ok.room, device, listener, () => ok.room.listen(kind, listener, now(), ok.uid), pool, request.ip);
        });
        return reply;
      });
    }
  });

  return manager;
}

/**
 * Поток событий комнаты: как в live.ts — `no-store, no-transform`, `X-Accel-Buffering: no`, «я жив» событием `ping`,
 * отставший больше чем на 128 КБ отключается (переподключится со свежим снимком). Сводки экрана и пульта на медленной сети
 * не копятся: пока прошлое не ушло в сеть (`writableNeedDrain`), держим одну последнюю и отправляем её по `drain`. Закрытый
 * (`end()`) и не дочитанный за `endGraceMs` поток обрывается: буфер не живёт, пока клиент не прочтёт.
 */
export function openRoomStream(reply: FastifyReply, keepAliveMs: number, attach: (listener: RoomListener) => () => void, endGraceMs = END_GRACE_MS): void {
  const cookie = reply.getHeader("set-cookie");
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    "X-Accel-Buffering": "no",
    Connection: "keep-alive",
    ...(cookie !== undefined ? { "Set-Cookie": cookie as string | string[] } : {}),
  });
  // Запись в закрытый поток (`end()` уже вызван, а «close» придёт, только когда буфер допишется — у плохой сети через
  // минуты) — не исключение процесса: проверяем `writableEnded`, а ошибки ответа гасим здесь.
  res.on("error", () => undefined);
  let closed = false;
  let grace: ReturnType<typeof setTimeout> | null = null;
  const gone = () => closed || res.destroyed || res.writableEnded;
  let held: RoomStreamEvent | null = null;
  let waiting = false;
  const listener: RoomListener = {
    send(event) {
      if (gone()) return;
      if (res.writableLength > ROOM_STREAM_BACKLOG_BYTES) {
        res.destroy();
        return;
      }
      if ((event.type === "screen" || event.type === "host") && res.writableNeedDrain) {
        // Сеть не успевает: прошлую сводку заменит свежая, когда буфер уйдёт.
        held = event;
        if (!waiting) {
          waiting = true;
          res.once("drain", () => {
            waiting = false;
            const latest = held;
            held = null;
            if (latest) listener.send(latest);
          });
        }
        return;
      }
      res.write(sseFrame(event));
    },
    end() {
      if (gone()) return;
      res.end();
      if (!res.destroyed && grace === null) {
        grace = setTimeout(() => {
          if (!res.destroyed) res.destroy();
        }, endGraceMs);
        grace.unref?.();
      }
    },
    // Закрытый, но не дописанный — тоже в счёте: его буфер занимает память, пока поток не оборван.
    backlog: () => (res.destroyed ? 0 : res.writableLength),
    destroy: () => {
      if (!res.destroyed) res.destroy();
    },
    closed: () => closed || res.destroyed,
  };
  const ping = setInterval(() => {
    if (!gone() && !res.writableNeedDrain) res.write("event: ping\ndata:1\n\n");
  }, keepAliveMs);
  let detach: () => void = () => undefined;
  const close = () => {
    closed = true;
    clearInterval(ping);
    if (grace) clearTimeout(grace);
    detach();
  };
  res.on("close", close);
  if (res.destroyed) {
    close();
    return;
  }
  detach = attach(listener);
}
