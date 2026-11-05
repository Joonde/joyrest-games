/**
 * Игровая комната быстрого канала (CLAUDE.md, «Быстрый канал (комнаты)»): состояние игры с непрерывными
 * нажатиями живёт в памяти сервера, телефоны шлют пачки событий, обратно — личный поток телефона, сводка экрана
 * (до 5 раз в секунду) и сводка пульта (раз в секунду). Здесь — только чистая логика без базы и HTTP: комнату
 * ведёт `server/src/room.ts`. Время — только часы сервера; событие пачки помнит, сколько мс назад оно случилось
 * (`ago`), но верим не дальше `MAX_AGO_MS`.
 */
import { createHash, randomBytes } from "node:crypto";
import type { RoomInputEvent, RoomOfflinePlayer, RoomStreamEvent } from "../../../src/data/types";

/** Событию из пачки верим не старше этого: интервал пачки + разброс сети + запас. Старше — `late`. */
export const MAX_AGO_MS = 4000;
/** Событий в одной пачке — не больше. */
export const MAX_EVENTS_PER_BATCH = 64;
/** Сколько номеров пачек одного потока телефона помним (повтор и пачки не по порядку). */
const SEQ_WINDOW = 64;
/** Сколько потоков пачек одного телефона помним (перезагрузка страницы — новый поток). */
const STREAMS_PER_PLAYER = 3;
/** Запросов в секунду с телефона (пачки и отдельные движения): запас и ровная скорость. */
export const REQUESTS_BURST = 20;
export const REQUESTS_PER_SECOND = 10;
/** Сколько последних команд пульта помним по id (повтор после обрыва не выполняется дважды). */
const COMMAND_MEMORY = 20;
/** Отключившихся в сводке пульта — не больше. */
const OFFLINE_LIST_MAX = 100;
const EVENT_TYPE = /^[a-z][a-z0-9_-]{0,23}$/;
const STREAM_ID = /^[A-Za-z0-9_-]{1,32}$/;
const COMMAND = /^[a-z][a-z0-9_-]{0,31}$/;

/** Игрок комнаты: устройство (uid) — участник сессии: сам игрок или член команды. */
export interface RoomPlayer {
  pid: string;
  name: string;
  /** Команда телефона в режиме команд; иначе null. */
  team: string | null;
}

/** Событие пачки после проверки: `at` — момент события по часам сервера, `late` — пришло старше 4 с. */
export interface RoomEvent {
  t: string;
  at: number;
  late: boolean;
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
  create(input: { snapshot: unknown; playMode: "solo" | "teams"; now: number }, ctx: RoomContext): S;
  onInput(state: S, player: RoomPlayer, events: RoomEvent[], ctx: RoomContext): void;
  onCommand(state: S, cmd: string, args: unknown, ctx: RoomContext): CommandOutcome;
  tick?(state: S, ctx: RoomContext): void;
  onPause?(state: S, ctx: RoomContext): void;
  /** Пауза кончилась: `pausedMs` — сколько стояли (сдвинуть свои назначенные моменты). */
  onResume?(state: S, pausedMs: number, ctx: RoomContext): void;
  onJoin?(state: S, player: RoomPlayer, ctx: RoomContext): void;
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
  seq: number;
  events: RoomInputEvent[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Пачка телефона: `{ stream?, seq, events }`. Неверная — null. */
export function parseInput(body: unknown): ParsedInput | null {
  if (!isRecord(body)) return null;
  const { seq, events } = body;
  const stream = body.stream === undefined ? "" : body.stream;
  if (typeof stream !== "string" || (stream !== "" && !STREAM_ID.test(stream))) return null;
  if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) return null;
  if (!Array.isArray(events) || events.length > MAX_EVENTS_PER_BATCH) return null;
  const parsed: RoomInputEvent[] = [];
  for (const raw of events) {
    if (!isRecord(raw) || typeof raw.t !== "string" || !EVENT_TYPE.test(raw.t)) return null;
    if (raw.ago !== undefined && (typeof raw.ago !== "number" || !Number.isFinite(raw.ago) || raw.ago < 0)) return null;
    parsed.push(raw as RoomInputEvent);
  }
  return { stream, seq, events: parsed };
}

/** Событие по часам сервера: `ago` сверх 4 с не принимается — момент не раньше `now − 4 с`, пометка `late`. */
export function timedEvent(event: RoomInputEvent, now: number): RoomEvent {
  const ago = Math.round(event.ago ?? 0);
  const late = ago > MAX_AGO_MS;
  const fields: Record<string, unknown> = { ...event };
  delete fields.ago;
  delete fields.at;
  delete fields.late;
  return { ...fields, t: event.t, at: now - Math.min(ago, MAX_AGO_MS), late };
}

// ------------------------------------------------------------------ повторы и лимиты

/** Номера пачек одного потока: повтор и пачки не по порядку — без повторной обработки. */
export class SeqWindow {
  private max = -1;
  private readonly seen = new Set<number>();

  /** true — пачка новая (учтена); false — уже была или слишком старая. */
  take(seq: number): boolean {
    if (seq <= this.max - SEQ_WINDOW || this.seen.has(seq)) return false;
    this.seen.add(seq);
    if (seq > this.max) {
      this.max = seq;
      for (const old of this.seen) if (old <= this.max - SEQ_WINDOW) this.seen.delete(old);
    }
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
}

interface PlayerRuntime extends RoomPlayer {
  lastSeen: number;
  online: boolean;
  streams: Map<string, SeqWindow>;
  requests: TokenBucket;
  events: TokenBucket;
}

export type InputResult =
  | { ok: true; at: number; every: number; paused: boolean; dropped: number; dup: boolean }
  | { ok: false; status: 403 | 429; error: string };

/** Снимок комнаты в базе (`room_snapshots.data`). */
export interface RoomSnapshotData {
  v: 1;
  game: string;
  key: string;
  seed: string;
  state: unknown;
}

export interface RoomInit {
  id: string;
  /** Механика и блок вечера: снимок другой игры не подходит. */
  key: string;
  hostId: string;
  game: RoomGame<unknown>;
  players: RoomPlayer[];
  teams: Array<[string, string]>;
  snapshot: unknown;
  playMode: "solo" | "teams";
  now: number;
  /** Снимок из базы: комната поднимается из него на паузе (ведущий продолжает командой). */
  restoreFrom?: RoomSnapshotData | null;
  /** Задержка общего цикла (для сводки пульта). */
  loop?: () => { lagMs: number; maxLagMs: number };
}

export class Room {
  readonly id: string;
  readonly key: string;
  readonly hostId: string;
  readonly game: RoomGame<unknown>;
  readonly seed: string;
  state: unknown;
  paused = false;
  /** Поднята из снимка после перезапуска или выгрузки — пульту это видно. */
  restored = false;
  /** Номер изменения: растёт на каждое `changed()`. */
  version = 0;
  /** Последний вход пачки или команды — для отметки активности и выгрузки. */
  lastActivity: number;
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
  private hostDirty = true;
  private lastScreenAt = 0;
  private lastHostAt = 0;
  private readonly me = new Map<string, Set<RoomListener>>();
  private readonly screens = new Set<RoomListener>();
  private readonly hosts = new Set<RoomListener>();
  private readonly commands = new Map<string, CommandOutcome>();
  private readonly loop: () => { lagMs: number; maxLagMs: number };
  private readonly playMode: "solo" | "teams";

  constructor(init: RoomInit) {
    this.id = init.id;
    this.key = init.key;
    this.hostId = init.hostId;
    this.game = init.game;
    this.playMode = init.playMode;
    this.lastActivity = init.now;
    this.loop = init.loop ?? (() => ({ lagMs: 0, maxLagMs: 0 }));
    for (const [id, name] of init.teams) this.teams.set(id, name);
    for (const player of init.players) this.addPlayer(player, init.now);
    const restore = init.restoreFrom;
    const restored = restore && restore.game === init.game.id && restore.key === init.key ? init.game.restore(restore.state) : null;
    if (restore && restored !== null) {
      this.seed = restore.seed;
      this.state = restored;
      this.restored = true;
      this.paused = true;
      this.pausedAt = init.now;
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
      this.game.onJoin?.(this.state, { pid: runtime.pid, name: runtime.name, team: runtime.team }, this.context(now));
    }
    this.changed();
  }

  removeParticipant(id: string): void {
    if (this.teams.delete(id) || this.players.delete(id)) {
      this.playerList = null;
      this.changed();
    }
  }

  get playersCount(): number {
    return this.players.size;
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

  changed(): void {
    this.version += 1;
    this.screenDirty = true;
    this.hostDirty = true;
  }

  every(): number {
    return this.game.batchMs(this.players.size);
  }

  /** Пачка телефона `uid`. Не участник — отказ; повтор номера — «уже было», без обработки. */
  input(uid: string, input: ParsedInput, now: number): InputResult {
    const player = this.players.get(uid);
    if (!player) return { ok: false, status: 403, error: "permission-denied" };
    if (player.requests.take(1, now) === 0) return { ok: false, status: 429, error: "resource-exhausted" };
    this.lastActivity = now;
    this.seen(player, now);
    let window = player.streams.get(input.stream);
    if (!window) {
      window = new SeqWindow();
      player.streams.set(input.stream, window);
      if (player.streams.size > STREAMS_PER_PLAYER) player.streams.delete(player.streams.keys().next().value ?? "");
    }
    const reply = { ok: true as const, at: now, every: this.every(), paused: this.paused };
    if (!window.take(input.seq)) return { ...reply, dropped: 0, dup: true };
    if (input.events.length === 0) return { ...reply, dropped: 0, dup: false };
    const allowed = player.events.take(input.events.length, now);
    const dropped = input.events.length - allowed;
    // На паузе события не идут в игру: время стоит (пачка — только «я на связи»).
    if (!this.paused && allowed > 0) {
      const events = input.events.slice(0, allowed).map((e) => timedEvent(e, now));
      this.game.onInput(this.state, { pid: player.pid, name: player.name, team: player.team }, events, this.context(now));
    }
    return { ...reply, dropped, dup: false };
  }

  /** Команда пульта; `id` — повтор после обрыва возвращает прежний итог. */
  command(cmd: string, args: unknown, id: string | null, now: number): CommandOutcome {
    if (!COMMAND.test(cmd)) return { ok: false, error: "invalid-argument" };
    if (id !== null) {
      const known = this.commands.get(id);
      if (known) return known;
    }
    this.lastActivity = now;
    let outcome: CommandOutcome;
    if (cmd === "pause") outcome = this.pause(now);
    else if (cmd === "resume") outcome = this.resume(now);
    else outcome = this.game.onCommand(this.state, cmd, args, this.context(now));
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
    this.game.onPause?.(this.state, this.context(now));
    this.afterPauseChange(now);
    return { ok: true };
  }

  private resume(now: number): CommandOutcome {
    if (!this.paused) return { ok: true };
    this.paused = false;
    this.restored = false;
    this.game.onResume?.(this.state, Math.max(0, now - this.pausedAt), this.context(now));
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
    if (!this.paused) this.game.tick?.(this.state, this.context(now));
    const screenEvery = 1000 / (this.game.screenHz ?? 5);
    if (this.screenDirty && this.screens.size > 0 && now - this.lastScreenAt >= screenEvery) this.flushScreen(now);
    if (this.hostDirty && this.hosts.size > 0 && now - this.lastHostAt >= 1000) this.flushHost(now);
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
      data: this.game.screen(this.state, this.view(now)),
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
      paused: this.paused,
      restored: this.restored,
      players: this.players.size,
      online: this.onlineCount,
      offline,
      loop: this.loop(),
      data: this.game.host(this.state, this.view(now)),
    };
  }

  meEvent(pid: string, now: number): RoomStreamEvent {
    return {
      type: "snapshot",
      at: now,
      paused: this.paused,
      every: this.every(),
      offlineMs: this.game.offlineMs,
      data: this.game.personal(this.state, pid, this.view(now)),
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
    this.hostDirty = false;
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
      set.add(listener);
      listener.send(this.meEvent(pid, now));
      return () => {
        set.delete(listener);
        if (set.size === 0) this.me.delete(pid);
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
  close(reason: "finished" | "unloaded", now: number): void {
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

  snapshotData(): RoomSnapshotData {
    return { v: 1, game: this.game.id, key: this.key, seed: this.seed, state: this.game.snapshot(this.state) };
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
  return { v: 1, game, key, seed, state: value.state ?? null };
}
