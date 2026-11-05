/**
 * Быстрый канал своего сервера (CLAUDE.md, «Быстрый канал (комнаты)»): игровые комнаты в памяти процесса app.
 *
 * Комната создаётся лениво — при первой пачке, команде или подписке — и только для сессии, механика которой есть в
 * реестре комнатных игр (`rooms/registry.ts`). Состав (устройство → участник) берётся из базы при создании и дальше
 * обновляется событиями Hub `participants:<id>`; завершение сессии и смена блока вечера приходят событиями
 * `session:<id>`. Один общий цикл (~100 мс) на все комнаты: игра, «без связи», сводки экрана (до 5 раз в секунду) и
 * пульта (раз в секунду), снимки в `room_snapshots` (на контрольных точках и раз в 10 с, если менялось), отметка
 * активности в `sessions.updated_at` раз в минуту (выкладка ждёт конца игры), выгрузка через 15 минут без пачек и
 * команд. После перезапуска комната поднимается из снимка на паузе — ведущий продолжает командой `resume`.
 *
 * Маршруты: `POST /api/rooms/:id/input` (пачка телефона, ≤ 4 КБ), `POST /api/rooms/:id/command` (только ведущий),
 * `GET /api/rooms/:id/me|screen|host` (снимок для опроса без потока), потоки `GET /api/stream/room/:id/me|screen|host`.
 * Права — функции `src/data/permissions.ts`. В журнал — только числа, без имён.
 */
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { parseProgram } from "../../src/core/program";
import * as permissions from "../../src/data/permissions";
import type { RoomStreamEvent, RoomStreamKind } from "../../src/data/types";
import { apiGuard, DEVICE_COOKIE, identityOf, readCookie, SESSION_COOKIE } from "./auth";
import { STREAM_BACKLOG_BYTES, sseFrame, type Hub } from "./live";
import { parseInput, parseSnapshotData, Room, type RoomGame, type RoomListener } from "./rooms/engine";
import { ROOM_GAMES } from "./rooms/registry";

export interface RoomsOptions {
  sql: Sql;
  hub: Hub;
  isSite?: (request: FastifyRequest) => boolean;
  now?: () => number;
  /** «Я жив» в потоках, мс. */
  keepAliveMs?: number;
  /** Шаг общего цикла, мс; 0 — без таймера (тесты зовут `step()` сами). */
  loopMs?: number;
  /** Без пачек и команд столько — комната выгружается (со снимком). */
  idleMs?: number;
  /** Снимок в базу не реже, если что-то менялось. */
  snapshotEveryMs?: number;
  /** Отметка активности в `sessions.updated_at` не чаще. */
  touchEveryMs?: number;
  /** Комнат в памяти — не больше. */
  maxRooms?: number;
  /** Игры комнат (тесты подменяют). */
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
const IDENTITY_TTL_MS = 30_000;
const IDENTITY_MAX = 20_000;
/** Неизвестный комнате телефон проверяем по базе не чаще (вошёл, а событие Hub ещё не дошло). */
const MEMBER_RECHECK_MS = 3000;

interface SessionRoomRow {
  id: string;
  host_id: string;
  mechanic: string | null;
  game_snapshot: unknown;
  play_mode: string;
  phase: string;
  program: unknown;
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
  lastTouchAt: number;
  saving: Promise<void> | null;
  again: boolean;
  stop: () => void;
}

type LoadResult = Entry | "missing" | "finished" | "no-room" | "full";

/** Механика и блок вечера: другой блок — другая комната, снимок прежнего не подходит. */
export function roomKey(mechanic: string | null, program: unknown): string {
  const parsed = parseProgram(program ?? null);
  return parsed ? `${mechanic ?? ""}#${parsed.index}` : (mechanic ?? "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class RoomManager {
  private readonly rooms = new Map<string, Entry>();
  private readonly loading = new Map<string, Promise<LoadResult>>();
  /** Выгружаемые комнаты: пока снимок пишется, новая загрузка ждёт его (иначе поднимется прежний снимок). */
  private readonly unloading = new Map<string, Promise<void>>();
  private readonly lags: number[] = [];
  private lastLagWarn = -Infinity;
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private readonly now: () => number;
  private readonly games: ReadonlyMap<string, RoomGame<unknown>>;
  private readonly idleMs: number;
  private readonly snapshotEveryMs: number;
  private readonly touchEveryMs: number;
  private readonly maxRooms: number;

  constructor(
    private readonly sql: Sql,
    private readonly hub: Hub,
    private readonly log: FastifyBaseLogger,
    options: Omit<RoomsOptions, "sql" | "hub" | "isSite">,
  ) {
    this.now = options.now ?? Date.now;
    this.games = options.games ?? ROOM_GAMES;
    this.idleMs = options.idleMs ?? 15 * 60_000;
    this.snapshotEveryMs = options.snapshotEveryMs ?? 10_000;
    this.touchEveryMs = options.touchEveryMs ?? 60_000;
    this.maxRooms = options.maxRooms ?? 500;
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

  /** Задержка цикла: последняя и худшая за ~10 с. */
  loopStats(): { lagMs: number; maxLagMs: number } {
    const last = this.lags[this.lags.length - 1] ?? 0;
    return { lagMs: Math.round(last), maxLagMs: Math.round(this.lags.reduce((a, b) => Math.max(a, b), 0)) };
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

  loaded(id: string): Room | null {
    return this.rooms.get(id)?.room ?? null;
  }

  /** Комната сессии: загруженная или новая (из снимка, если он есть). */
  get(id: string): Promise<LoadResult> {
    const known = this.rooms.get(id);
    if (known) return Promise.resolve(known);
    let pending = this.loading.get(id);
    if (!pending) {
      pending = this.load(id).finally(() => this.loading.delete(id));
      this.loading.set(id, pending);
    }
    return pending;
  }

  private async load(id: string): Promise<LoadResult> {
    if (this.closed) return "missing";
    await this.unloading.get(id);
    const [row] = await this.sql<SessionRoomRow[]>`
      select id, host_id, mechanic, game_snapshot, play_mode, phase, program from sessions where id = ${id}`;
    if (!row) return "missing";
    if (row.phase === "finished") return "finished";
    const game = row.mechanic ? this.games.get(row.mechanic) : undefined;
    if (!game) return "no-room";
    if (this.rooms.size >= this.maxRooms) return "full";
    // Подписка раньше чтения состава: участник, вошедший между запросом и созданием комнаты, не потеряется.
    const buffered: Array<{ channel: "participants" | "session"; event: object }> = [];
    let entry: Entry | null = null;
    const deliver = (channel: "participants" | "session", event: object) => {
      if (entry) this.onHub(entry, channel, event);
      else buffered.push({ channel, event });
    };
    const stopParticipants = this.hub.subscribe(`participants:${id}`, (e) => deliver("participants", e));
    const stopSession = this.hub.subscribe(`session:${id}`, (e) => deliver("session", e));
    const stop = () => {
      stopParticipants();
      stopSession();
    };
    try {
      const participants = await this.sql<ParticipantRoomRow[]>`
        select id, name, kind, team_id from participants where session_id = ${id}`;
      const [snap] = await this.sql<{ data: unknown }[]>`select data from room_snapshots where session_id = ${id}`;
      const now = this.now();
      const room = new Room({
        id,
        key: roomKey(row.mechanic, row.program),
        hostId: row.host_id,
        game,
        players: participants.filter((p) => p.kind === "player").map((p) => ({ pid: p.id, name: p.name, team: p.team_id })),
        teams: participants.filter((p) => p.kind === "team").map((p) => [p.id, p.name] as [string, string]),
        snapshot: row.game_snapshot ?? null,
        playMode: row.play_mode === "teams" ? "teams" : "solo",
        now,
        restoreFrom: snap ? parseSnapshotData(snap.data) : null,
        loop: () => this.loopStats(),
      });
      const created: Entry = { room, lastSnapAt: now, lastTouchAt: -Infinity, saving: null, again: false, stop };
      entry = created;
      this.rooms.set(id, created);
      for (const b of buffered) this.onHub(created, b.channel, b.event);
      if (room.restored) this.log.info({ room: "restored", players: room.playersCount }, "rooms");
      return created;
    } catch (error) {
      stop();
      throw error;
    }
  }

  private onHub(entry: Entry, channel: "participants" | "session", raw: object): void {
    if (!isRecord(raw) || this.rooms.get(entry.room.id) !== entry) return;
    const now = this.now();
    if (channel === "participants") {
      if (raw.type === "upsert" && isRecord(raw.participant)) {
        const p = raw.participant;
        if (typeof p.id === "string" && typeof p.name === "string") {
          entry.room.upsertParticipant({ id: p.id, name: p.name, kind: p.kind === "team" ? "team" : "player", teamId: typeof p.teamId === "string" ? p.teamId : null }, now);
        }
      } else if (raw.type === "remove" && typeof raw.id === "string") entry.room.removeParticipant(raw.id);
      else if (raw.type === "snapshot" && Array.isArray(raw.participants)) {
        for (const p of raw.participants) if (isRecord(p) && typeof p.id === "string" && typeof p.name === "string") entry.room.upsertParticipant({ id: p.id, name: p.name, kind: p.kind === "team" ? "team" : "player", teamId: typeof p.teamId === "string" ? p.teamId : null }, now);
      }
      return;
    }
    // Сессия: завершили — комната выгружается; сменился блок вечера или механика — тоже (новая игра с чистого листа).
    const state = raw.type === "patch" ? raw.state : isRecord(raw.session) ? raw.session.state : null;
    if (isRecord(state) && state.phase === "finished") {
      void this.unload(entry.room.id, "finished");
      return;
    }
    if (raw.type === "snapshot" && isRecord(raw.session)) {
      const mechanic = typeof raw.session.mechanic === "string" ? raw.session.mechanic : null;
      if (roomKey(mechanic, raw.session.program) !== entry.room.key) void this.unload(entry.room.id, "unloaded");
    }
  }

  /** Неизвестный телефон: вдруг он только что вошёл (событие Hub ещё не дошло) — один запрос к базе. */
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

  /** Шаг общего цикла. */
  step(now = this.now()): void {
    for (const entry of [...this.rooms.values()]) {
      const room = entry.room;
      try {
        room.tick(now);
      } catch (error) {
        this.log.error({ room: "tick", err: error instanceof Error ? error.message : String(error) }, "rooms");
      }
      if (room.checkpointWanted || (room.version !== room.savedVersion && now - entry.lastSnapAt >= this.snapshotEveryMs)) void this.save(entry);
      // Игра идёт (пачки и команды) — сессия «живая» для выкладки: раз в минуту обновляем updated_at.
      if (room.lastActivity > entry.lastTouchAt && now - entry.lastTouchAt >= this.touchEveryMs) {
        entry.lastTouchAt = now;
        void this.touch(room.id);
      }
      if (now - room.lastActivity >= this.idleMs) void this.unload(room.id, "unloaded");
    }
  }

  private async touch(id: string): Promise<void> {
    try {
      await this.sql`update sessions set updated_at = now() where id = ${id} and phase in ('lobby', 'playing')`;
    } catch (error) {
      this.log.warn({ room: "touch", err: error instanceof Error ? error.message : String(error) }, "rooms");
    }
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
    const data = room.snapshotData();
    entry.lastSnapAt = this.now();
    entry.saving = (async () => {
      try {
        await this.sql`
          insert into room_snapshots (session_id, data, version, updated_at)
          values (${room.id}, ${this.sql.json(data as never)}, ${version % 2_000_000_000}, now())
          on conflict (session_id) do update set data = excluded.data, version = excluded.version, updated_at = now()`;
        room.savedVersion = version;
      } catch (error) {
        // Сессию удалили или база моргнула — следующий снимок через 10 с.
        this.log.warn({ room: "snapshot", err: error instanceof Error ? error.message : String(error) }, "rooms");
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

  /** Выгрузить комнату: снимок, «закрыто» в потоки, отписка от Hub. */
  async unload(id: string, reason: "finished" | "unloaded"): Promise<void> {
    const entry = this.rooms.get(id);
    if (!entry) return;
    this.rooms.delete(id);
    entry.stop();
    entry.room.close(reason, this.now());
    const saved = this.save(entry);
    this.unloading.set(id, saved);
    try {
      await saved;
    } finally {
      if (this.unloading.get(id) === saved) this.unloading.delete(id);
    }
  }

  /** Остановка приложения: снимки всех комнат и закрытие потоков. */
  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.all([...this.rooms.keys()].map((id) => this.unload(id, "unloaded")));
  }
}

// ------------------------------------------------------------------ маршруты

export function registerRooms(app: FastifyInstance, options: RoomsOptions): RoomManager {
  const { sql } = options;
  const now = options.now ?? Date.now;
  const keepAliveMs = options.keepAliveMs ?? 25_000;
  const manager = new RoomManager(sql, options.hub, app.log, options);
  options.onManager?.(manager);
  app.addHook("onClose", async () => manager.close());

  /** Кто шлёт пачки: по cookie, без базы на каждую пачку (раз в 30 с — проверка). */
  const identities = new Map<string, { uid: string; until: number }>();

  app.register(async (api) => {
    api.addHook("onRequest", apiGuard(options.isSite));

    function fail(reply: FastifyReply, status: number, code: string, reason?: string) {
      return reply.code(status).send(reason ? { error: code, reason } : { error: code });
    }

    async function quickUid(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
      const cookie = request.headers.cookie;
      const key = `${readCookie(cookie, SESSION_COOKIE) ?? ""}|${readCookie(cookie, DEVICE_COOKIE) ?? ""}`;
      const at = now();
      const known = key !== "|" ? identities.get(key) : undefined;
      if (known && known.until > at) return known.uid;
      const who = await identityOf(sql, request, reply);
      if (!who) return null;
      if (identities.size > IDENTITY_MAX) identities.clear();
      if (key !== "|") identities.set(key, { uid: who.uid, until: at + IDENTITY_TTL_MS });
      return who.uid;
    }

    /** Комната или уже отправленный отказ. */
    async function roomOf(id: string, reply: FastifyReply): Promise<Room | null> {
      if (!ID.test(id)) {
        fail(reply, 404, "not-found");
        return null;
      }
      const found = await manager.get(id);
      if (found === "missing" || found === "no-room") fail(reply, 404, "not-found");
      else if (found === "finished") fail(reply, 409, "failed-precondition", "finished");
      else if (found === "full") fail(reply, 503, "unavailable");
      else return found.room;
      return null;
    }

    api.post<{ Params: { id: string }; Body: unknown }>("/api/rooms/:id/input", { bodyLimit: ROOM_BODY }, async (request, reply) => {
      const uid = await quickUid(request, reply);
      if (!uid) return fail(reply, 401, "unauthenticated");
      const input = parseInput(request.body);
      if (!input) return fail(reply, 400, "invalid-argument");
      const room = await roomOf(request.params.id, reply);
      if (!room) return reply;
      const member = (await manager.knowMember(room, uid)) ? { kind: "player" as const } : null;
      // Комната в памяти — только у незавершённой сессии (завершение выгружает её).
      if (!permissions.canSendRoomInput(uid, { phase: "playing" }, member)) return fail(reply, 403, "permission-denied");
      const result = room.input(uid, input, now());
      if (!result.ok) return fail(reply, result.status, result.error);
      return { at: result.at, every: result.every, paused: result.paused, dropped: result.dropped, dup: result.dup };
    });

    api.post<{ Params: { id: string }; Body: unknown }>("/api/rooms/:id/command", { bodyLimit: ROOM_BODY }, async (request, reply) => {
      const who = await identityOf(sql, request, reply);
      if (!who) return fail(reply, 401, "unauthenticated");
      const body = isRecord(request.body) ? request.body : {};
      const cmd = typeof body.cmd === "string" ? body.cmd : "";
      const commandId = body.id === undefined ? null : typeof body.id === "string" && COMMAND_ID.test(body.id) ? body.id : undefined;
      if (!cmd || commandId === undefined) return fail(reply, 400, "invalid-argument");
      const room = await roomOf(request.params.id, reply);
      if (!room) return reply;
      if (!permissions.canCommandRoom(who.uid, { hostId: room.hostId, phase: "playing" })) return fail(reply, 403, "permission-denied");
      const outcome = room.command(cmd, body.args ?? null, commandId, now());
      if (!outcome.ok) return outcome.error === "invalid-argument" ? fail(reply, 400, "invalid-argument") : fail(reply, 409, "failed-precondition", outcome.error);
      request.log.info({ room: "command", cmd }, "rooms");
      return { ok: true, result: outcome.result ?? null };
    });

    /** Право на поток или снимок; отказ уже отправлен — null. */
    async function watchable(kind: RoomStreamKind, request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<{ room: Room; uid: string } | null> {
      const who = await identityOf(sql, request, reply);
      if (!who) {
        fail(reply, 401, "unauthenticated");
        return null;
      }
      const room = await roomOf(request.params.id, reply);
      if (!room) return null;
      const allowed =
        kind === "me"
          ? permissions.canWatchRoomMe(who.uid, (await manager.knowMember(room, who.uid)) ? { kind: "player" } : null)
          : kind === "screen"
            ? permissions.canWatchRoomScreen(who.uid)
            : permissions.canWatchRoomHost(who.uid, { hostId: room.hostId });
      if (!allowed) {
        fail(reply, 403, "permission-denied");
        return null;
      }
      return { room, uid: who.uid };
    }

    function snapshotOf(kind: RoomStreamKind, room: Room, uid: string): RoomStreamEvent {
      const at = now();
      return kind === "me" ? room.meEvent(uid, at) : kind === "screen" ? room.screenEvent(at) : room.hostEvent(at);
    }

    for (const kind of ["me", "screen", "host"] as const) {
      // Снимок без потока: опрос, когда поток не открывается (прокси, старый браузер).
      api.get<{ Params: { id: string } }>(`/api/rooms/:id/${kind}`, async (request, reply) => {
        const ok = await watchable(kind, request, reply);
        if (!ok) return reply;
        return snapshotOf(kind, ok.room, ok.uid);
      });

      api.get<{ Params: { id: string } }>(`/api/stream/room/:id/${kind}`, async (request, reply) => {
        const ok = await watchable(kind, request, reply);
        if (!ok) return reply;
        openRoomStream(reply, keepAliveMs, (listener) => {
          // Комнату выгрузили, пока проверяли вход: «закрыто» — браузер переподключится к новой.
          if (manager.loaded(ok.room.id) !== ok.room) {
            listener.send({ type: "closed", at: now(), reason: "unloaded" });
            listener.end();
            return () => undefined;
          }
          return ok.room.listen(kind, listener, now(), ok.uid);
        });
        return reply;
      });
    }
  });

  return manager;
}

/**
 * Поток событий комнаты: как в live.ts — `no-store, no-transform`, `X-Accel-Buffering: no`, «я жив» событием `ping`,
 * отставший больше чем на 512 КБ отключается (переподключится со свежим снимком).
 */
function openRoomStream(reply: FastifyReply, keepAliveMs: number, attach: (listener: RoomListener) => () => void): void {
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
  const listener: RoomListener = {
    send(event) {
      if (res.destroyed) return;
      if (res.writableLength > STREAM_BACKLOG_BYTES) {
        res.destroy();
        return;
      }
      res.write(sseFrame(event));
    },
    end() {
      if (!res.destroyed) res.end();
    },
  };
  const ping = setInterval(() => {
    if (!res.destroyed) res.write("event: ping\ndata:1\n\n");
  }, keepAliveMs);
  let detach: () => void = () => undefined;
  const close = () => {
    clearInterval(ping);
    detach();
  };
  res.on("close", close);
  if (res.destroyed) {
    close();
    return;
  }
  detach = attach(listener);
}
