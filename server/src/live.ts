/**
 * Игра в реальном времени на своём сервере (PR 4.1, CLAUDE.md, «Платформа на своём сервере»):
 * сессии, участники, ответы, итоги, часы и потоки изменений.
 *
 * Изменения — обычные запросы (REST), подписки — поток событий сервера (Server-Sent Events,
 * `GET /api/stream/...`): снимок при подписке, дальше только изменения. Браузер сам
 * переподключается к потоку; если поток не работает — опрос раз в 2 секунды.
 * Права — функции src/data/permissions.ts; время старта шага и ответа ставит сервер,
 * `canSubmitAnswer` проверяется по его часам. Все записи повторяемы: id создаёт браузер,
 * ответ — ключ (сессия, шаг, участник).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql, TransactionSql } from "postgres";
import { generateSessionCode } from "../../src/core/code";
import { cleanName, NAME_MAX_LENGTH } from "../../src/core/names";
import { adjustBoard, MAX_SCORE_DELTA, meetsExpect } from "../../src/core/session";
import { compactBoard } from "../../src/core/results";
import { retentionCutoff } from "../../src/core/retention";
import { parseCue, parseMix, parseMusic, parseScreenReport, parseSlide, SCREEN_STALE_MS } from "../../src/data/cues";
import * as permissions from "../../src/data/permissions";
import type { ChangeExpect, Leaderboard, LeaderboardEntry, Participant, ScreenStatus, SessionPhase, SessionState, StepStage } from "../../src/data/types";
import { awardGamePoints } from "./staff";
import { WindowLimiter } from "./lead";
import { actorOf, apiGuard, identityOf, type Identity } from "./auth";

export interface LiveOptions {
  sql: Sql;
  isSite?: (request: FastifyRequest) => boolean;
  /** Часы сервера (подменяются в тестах). */
  now?: () => number;
  /** Пауза между «я жив» в потоке, мс. */
  keepAliveMs?: number;
}

// ------------------------------------------------------------------ рассылка

type Listener = (event: object) => void;

/** Событие сериализуется один раз на всех подписчиков (500 гостей — одна строка, а не 500). */
const frames = new WeakMap<object, string>();
export function sseFrame(event: object): string {
  let frame = frames.get(event);
  if (frame === undefined) {
    frame = `data: ${JSON.stringify(event)}\n\n`;
    frames.set(event, frame);
  }
  return frame;
}

/** Медленный телефон, у которого накопилось больше этого, отключается — переподключится со свежим снимком. */
export const STREAM_BACKLOG_BYTES = 512 * 1024;

/** Подписчики по каналам: session:<id>, participants:<id>, answers:<id>. Один процесс app. */
export class Hub {
  private readonly channels = new Map<string, Set<Listener>>();

  subscribe(channel: string, listener: Listener): () => void {
    let set = this.channels.get(channel);
    if (!set) {
      set = new Set();
      this.channels.set(channel, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.channels.delete(channel);
    };
  }

  publish(channel: string, event: object): void {
    for (const listener of this.channels.get(channel) ?? []) listener(event);
  }

  count(channel: string): number {
    return this.channels.get(channel)?.size ?? 0;
  }
}

// ------------------------------------------------------------------ данные

interface SessionRow {
  id: string;
  code: string;
  host_id: string;
  game_id: string | null;
  game_title: string;
  mechanic: string | null;
  game_snapshot: unknown;
  theme_id: string;
  play_mode: string;
  screen_mode: string;
  state: unknown;
  leaderboard: unknown;
  version: number;
  created_at: Date | null;
}

const SESSION_COLUMNS = ["id", "code", "host_id", "game_id", "game_title", "mechanic", "game_snapshot", "theme_id", "play_mode", "screen_mode", "state", "leaderboard", "created_at"];
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const CODE = /^\d{6}$/;
const PHASES = new Set<SessionPhase>(["lobby", "playing", "finished"]);
const STAGES = new Set<StepStage>(["ready", "question", "reveal", "board", "podium"]);
const SMALL_BODY = 16 * 1024;
/** Команд в одной сессии. */
const MAX_TEAMS = 100;
/** Сколько сессий с экраном зала помним (старые вытесняются). */
const SCREENS_MAX = 5000;
const SNAPSHOT_BODY = 1024 * 1024;
/** Сколько старых сессий удаляется за один вход admin; остальные — в следующий раз. */
export const CLEANUP_LIMIT = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normalizeState(value: unknown): SessionState {
  const s = isRecord(value) ? value : {};
  const revealed = s.revealed === true;
  return {
    phase: PHASES.has(s.phase as SessionPhase) ? (s.phase as SessionPhase) : "lobby",
    step: num(s.step),
    startedAt: typeof s.startedAt === "number" ? s.startedAt : null,
    revealed,
    stage: STAGES.has(s.stage as StepStage) ? (s.stage as StepStage) : revealed ? "reveal" : "ready",
    timeLimit: typeof s.timeLimit === "number" ? s.timeLimit : null,
    answered: num(s.answered),
    result: s.result ?? null,
    cue: parseCue(s.cue),
    music: parseMusic(s.music),
    mix: parseMix(s.mix),
    slide: parseSlide(s.slide),
  };
}

export function parseEntry(value: unknown): LeaderboardEntry | null {
  if (!isRecord(value) || typeof value.name !== "string" || value.name.length > 120) return null;
  const entry: LeaderboardEntry = { name: value.name, kind: value.kind === "team" ? "team" : "player", score: num(value.score) };
  if (typeof value.colorIndex === "number") entry.colorIndex = value.colorIndex;
  if (typeof value.last === "number") entry.last = value.last;
  if (typeof value.captainUid === "string" && ID.test(value.captainUid)) entry.captainUid = value.captainUid;
  // Раунды и стрелки (CLAUDE.md, раздел 6, «Раунды и табло»).
  if (typeof value.roundBase === "number" && Number.isFinite(value.roundBase)) entry.roundBase = value.roundBase;
  if (typeof value.move === "number" && Number.isInteger(value.move)) entry.move = value.move;
  return entry;
}

function normalizeBoard(value: unknown): Leaderboard {
  const board: Leaderboard = {};
  if (!isRecord(value)) return board;
  for (const [id, raw] of Object.entries(value)) {
    const entry = parseEntry(raw);
    if (entry) board[id] = entry;
  }
  return board;
}

function sessionOf(row: SessionRow) {
  return {
    id: row.id,
    code: row.code,
    hostId: row.host_id,
    gameId: row.game_id,
    gameTitle: row.game_title,
    mechanic: row.mechanic,
    gameSnapshot: row.game_snapshot ?? null,
    themeId: row.theme_id,
    playMode: row.play_mode === "teams" ? "teams" : "solo",
    screenMode: row.screen_mode === "remote" || row.screen_mode === "none" ? row.screen_mode : "laptop",
    state: normalizeState(row.state),
    leaderboard: normalizeBoard(row.leaderboard),
    createdAt: row.created_at ? row.created_at.getTime() : null,
    version: row.version,
  };
}

/** Изменение пульта: какие поля состояния и записи таблицы меняются. */
export interface CheckedChange {
  state: Partial<Omit<SessionState, "startedAt">> & { startedAt?: "server" | null };
  leaderboard: Record<string, LeaderboardEntry | null>;
  expect?: ChangeExpect;
  addScore?: Record<string, number>;
  rename?: Record<string, string>;
}

/** После «Завершить игру» пульт управляет только музыкой, звуками и слайдами. */
const AFTER_FINISH = new Set(["cue", "music", "mix", "slide"]);

export function allowedAfterFinish(change: CheckedChange): boolean {
  return (
    Object.keys(change.state).every((key) => AFTER_FINISH.has(key)) &&
    Object.keys(change.leaderboard).length === 0 &&
    Object.keys(change.addScore ?? {}).length === 0 &&
    Object.keys(change.rename ?? {}).length === 0
  );
}

/** Проверяет изменение пульта; неверное — null. Лишние поля состояния отбрасываются. */
export function checkChange(value: unknown): CheckedChange | null {
  if (!isRecord(value)) return null;
  const state: CheckedChange["state"] = {};
  const raw = value.state === undefined ? {} : value.state;
  if (!isRecord(raw)) return null;
  if (raw.phase !== undefined) {
    if (!PHASES.has(raw.phase as SessionPhase)) return null;
    state.phase = raw.phase as SessionPhase;
  }
  if (raw.step !== undefined) {
    if (!Number.isInteger(raw.step) || (raw.step as number) < 0) return null;
    state.step = raw.step as number;
  }
  if (raw.startedAt !== undefined) {
    if (raw.startedAt !== "server" && raw.startedAt !== null) return null;
    state.startedAt = raw.startedAt;
  }
  if (raw.revealed !== undefined) state.revealed = raw.revealed === true;
  if (raw.stage !== undefined) {
    if (!STAGES.has(raw.stage as StepStage)) return null;
    state.stage = raw.stage as StepStage;
  }
  if (raw.timeLimit !== undefined) {
    if (raw.timeLimit !== null && typeof raw.timeLimit !== "number") return null;
    state.timeLimit = raw.timeLimit as number | null;
  }
  if (raw.answered !== undefined) state.answered = num(raw.answered);
  if ("result" in raw) state.result = raw.result ?? null;
  if ("cue" in raw) {
    if (raw.cue !== null && parseCue(raw.cue) === null) return null;
    state.cue = parseCue(raw.cue);
  }
  if ("music" in raw) {
    if (raw.music !== null && parseMusic(raw.music) === null) return null;
    state.music = parseMusic(raw.music);
  }
  if ("mix" in raw) {
    if (raw.mix !== null && parseMix(raw.mix) === null) return null;
    state.mix = parseMix(raw.mix);
  }
  if ("slide" in raw) {
    if (raw.slide !== null && parseSlide(raw.slide) === null) return null;
    state.slide = parseSlide(raw.slide);
  }

  const leaderboard: CheckedChange["leaderboard"] = {};
  const board = value.leaderboard === undefined ? {} : value.leaderboard;
  if (!isRecord(board)) return null;
  for (const [pid, entry] of Object.entries(board)) {
    if (!ID.test(pid)) return null;
    if (entry === null) leaderboard[pid] = null;
    else {
      const parsed = parseEntry(entry);
      if (!parsed) return null;
      leaderboard[pid] = parsed;
    }
  }

  const checked: CheckedChange = { state, leaderboard };
  if (value.expect !== undefined) {
    if (!isRecord(value.expect)) return null;
    const { phase, step, stage } = value.expect;
    const expect: ChangeExpect = {};
    if (phase !== undefined) {
      if (!PHASES.has(phase as SessionPhase)) return null;
      expect.phase = phase as SessionPhase;
    }
    if (step !== undefined) {
      if (!Number.isInteger(step) || (step as number) < 0) return null;
      expect.step = step as number;
    }
    if (stage !== undefined) {
      if (!STAGES.has(stage as StepStage)) return null;
      expect.stage = stage as StepStage;
    }
    checked.expect = expect;
  }
  if (value.addScore !== undefined) {
    if (!isRecord(value.addScore)) return null;
    const addScore: Record<string, number> = {};
    for (const [pid, delta] of Object.entries(value.addScore)) {
      if (!ID.test(pid) || typeof delta !== "number" || !Number.isFinite(delta) || Math.abs(delta) > MAX_SCORE_DELTA) return null;
      addScore[pid] = delta;
    }
    checked.addScore = addScore;
  }
  if (value.rename !== undefined) {
    if (!isRecord(value.rename)) return null;
    const rename: Record<string, string> = {};
    for (const [pid, name] of Object.entries(value.rename)) {
      const clean = typeof name === "string" ? cleanName(name).slice(0, NAME_MAX_LENGTH) : "";
      if (!ID.test(pid) || !clean) return null;
      rename[pid] = clean;
    }
    checked.rename = rename;
  }
  return checked;
}

/** Новое состояние и таблица после изменения; время старта шага — по часам сервера. */
export function applyChange(state: SessionState, board: Leaderboard, change: CheckedChange, now: number): { state: SessionState; leaderboard: Leaderboard } {
  const { startedAt, ...rest } = change.state;
  const next: SessionState = { ...state, ...rest };
  if (startedAt !== undefined) next.startedAt = startedAt === "server" ? now : null;
  const leaderboard: Leaderboard = { ...board };
  for (const [pid, entry] of Object.entries(change.leaderboard)) {
    if (entry === null) delete leaderboard[pid];
    else leaderboard[pid] = entry;
  }
  return { state: next, leaderboard: adjustBoard(leaderboard, change.addScore, change.rename) };
}

/** Начало игры: шаг 0, как у Firebase-версии (sessions.setPhase). */
export const PLAYING_RESET: CheckedChange["state"] = {
  phase: "playing",
  step: 0,
  startedAt: null,
  revealed: false,
  stage: "ready",
  timeLimit: null,
  answered: 0,
  result: null,
};

interface ParticipantRow {
  id: string;
  name: string;
  kind: string;
  team_id: string | null;
  captain_uid: string;
  joined_at: Date | null;
  seen_at: Date | null;
}

const PARTICIPANT_COLUMNS = ["id", "name", "kind", "team_id", "captain_uid", "joined_at", "seen_at"];

function participantOf(row: ParticipantRow): Participant {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind === "team" ? "team" : "player",
    teamId: row.team_id,
    captainUid: row.captain_uid,
    joinedAt: row.joined_at ? row.joined_at.getTime() : null,
    seenAt: row.seen_at ? row.seen_at.getTime() : null,
  };
}

interface AnswerRow {
  step: number;
  pid: string;
  uid: string;
  value: unknown;
  submitted_at: Date | null;
}

function answerOf(row: AnswerRow) {
  return {
    id: `${row.step}_${row.pid}`,
    step: row.step,
    pid: row.pid,
    uid: row.uid,
    value: row.value ?? null,
    submittedAt: row.submitted_at ? row.submitted_at.getTime() : null,
  };
}

interface ResultRow {
  id: string;
  host_id: string;
  code: string;
  game_title: string;
  mechanic: string | null;
  theme_id: string;
  play_mode: string;
  played_at: Date | null;
  participants_count: number;
  board: unknown;
}

function resultOf(row: ResultRow) {
  return {
    id: row.id,
    hostId: row.host_id,
    code: row.code,
    gameTitle: row.game_title,
    mechanic: row.mechanic,
    themeId: row.theme_id,
    playMode: row.play_mode === "teams" ? "teams" : "solo",
    playedAt: row.played_at ? row.played_at.getTime() : null,
    participantsCount: row.participants_count,
    board: Array.isArray(row.board) ? row.board : [],
  };
}

/** Имя игрока или команды: как validName в firestore.rules — непустое, не длиннее NAME_MAX_LENGTH. */
function validName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= NAME_MAX_LENGTH;
}

/** Итоги сессии для истории — по таблице лидеров на сервере. `replace` — завершение (обновить). */
async function saveResult(db: Sql | TransactionSql, row: SessionRow, participantsCount: number, replace: boolean): Promise<void> {
  // В транзакции и вне её запросы пишутся одинаково.
  const sql = db as Sql;
  const board = sql.json(compactBoard(normalizeBoard(row.leaderboard)) as never);
  const title = row.game_title.slice(0, 80);
  if (replace) {
    await sql`
      insert into results (id, host_id, code, game_title, mechanic, theme_id, play_mode, played_at, participants_count, board)
      values (${row.id}, ${row.host_id}, ${row.code}, ${title}, ${row.mechanic}, ${row.theme_id}, ${row.play_mode},
              ${row.created_at}, ${participantsCount}, ${board})
      on conflict (id) do update set participants_count = excluded.participants_count, board = excluded.board, saved_at = now()`;
  } else {
    await sql`
      insert into results (id, host_id, code, game_title, mechanic, theme_id, play_mode, played_at, participants_count, board)
      values (${row.id}, ${row.host_id}, ${row.code}, ${title}, ${row.mechanic}, ${row.theme_id}, ${row.play_mode},
              ${row.created_at}, ${participantsCount}, ${board})
      on conflict (id) do nothing`;
  }
}

// ------------------------------------------------------------------ маршруты

export function registerLive(app: FastifyInstance, options: LiveOptions): Hub {
  const { sql } = options;
  const now = options.now ?? Date.now;
  const keepAliveMs = options.keepAliveMs ?? 25_000;
  const hub = new Hub();
  const codeMissesByDevice = new WindowLimiter(20, 10 * 60_000);
  const codeMissesByIp = new WindowLimiter(200, 10 * 60_000);
  /** Последнее сообщение экрана зала по каждой сессии (см. `/screen`). */
  const screens = new Map<string, ScreenStatus>();

  app.register(async (api) => {
    api.addHook("onRequest", apiGuard(options.isSite));

    function fail(reply: FastifyReply, status: number, code: string) {
      return reply.code(status).send({ error: code });
    }

    async function requireIdentity(request: FastifyRequest, reply: FastifyReply): Promise<Identity | null> {
      const who = await identityOf(sql, request, reply);
      if (!who) fail(reply, 401, "unauthenticated");
      return who;
    }

    const actor = (who: Identity) => (who.user ? actorOf(who.user) : null);

    async function loadSession(id: string): Promise<SessionRow | null> {
      if (!ID.test(id)) return null;
      const rows = await sql<SessionRow[]>`select ${sql(SESSION_COLUMNS)}, version::int as version from sessions where id = ${id}`;
      return rows[0] ?? null;
    }

    /** Сессия, которой управляет этот ведущий; иначе ответ уже отправлен. */
    async function hostedSession(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<{ who: Identity; row: SessionRow } | null> {
      const who = await requireIdentity(request, reply);
      if (!who) return null;
      const row = await loadSession(request.params.id);
      if (!row) {
        fail(reply, 404, "not-found");
        return null;
      }
      if (!permissions.canControlSession(who.uid, { hostId: row.host_id })) {
        fail(reply, 403, "permission-denied");
        return null;
      }
      return { who, row };
    }

    /** Одно изменение сессии под блокировкой строки; рассылка — после записи. */
    async function change(
      sessionId: string,
      update: (state: SessionState, board: Leaderboard) => CheckedChange | null | "conflict",
    ): Promise<"ok" | "missing" | "conflict"> {
      const event = await sql.begin(async (tx) => {
        const rows = await tx<SessionRow[]>`select ${tx(SESSION_COLUMNS)}, version::int as version from sessions where id = ${sessionId} for update`;
        const row = rows[0];
        if (!row) return null;
        const state = normalizeState(row.state);
        const board = normalizeBoard(row.leaderboard);
        const checked = update(state, board);
        if (checked === "conflict") return "conflict" as const;
        if (!checked) return null;
        const next = applyChange(state, board, checked, now());
        const [updated] = await tx<{ version: number }[]>`
          update sessions set state = ${tx.json(next.state as never)}, leaderboard = ${tx.json(next.leaderboard as never)},
            version = version + 1, updated_at = now()
          where id = ${sessionId} returning version::int as version`;
        // Подписчикам — изменённые записи таблицы целиком (с прибавкой и новым именем).
        const changed: Record<string, LeaderboardEntry | null> = { ...checked.leaderboard };
        for (const pid of [...Object.keys(checked.addScore ?? {}), ...Object.keys(checked.rename ?? {})]) {
          changed[pid] = next.leaderboard[pid] ?? null;
        }
        return { type: "patch", version: updated?.version ?? row.version + 1, state: next.state, leaderboard: changed };
      });
      if (event === "conflict") return "conflict";
      if (!event) return "missing";
      hub.publish(`session:${sessionId}`, event);
      return "ok";
    }

    // ---------------------------------------------------------------- часы

    api.get("/api/time", async () => ({ now: now() }));

    // ---------------------------------------------------------------- сессии

    api.post<{ Body: unknown }>("/api/sessions", { bodyLimit: SNAPSHOT_BODY }, async (request, reply) => {
      const who = await requireIdentity(request, reply);
      if (!who) return reply;
      if (!who.user || !permissions.canCreateSession(actor(who))) return fail(reply, 403, "permission-denied");
      const body = isRecord(request.body) ? request.body : {};
      const id = typeof body.id === "string" && ID.test(body.id) ? body.id : null;
      if (!id) return fail(reply, 400, "invalid-argument");
      const existing = await loadSession(id);
      if (existing) {
        // Повтор после обрыва связи — та же сессия.
        return existing.host_id === who.uid ? { id, code: existing.code } : fail(reply, 409, "already-exists");
      }
      const text = (value: unknown, max: number) => (typeof value === "string" && value.length <= max ? value : "");
      const state = { ...normalizeState({}), phase: "lobby" };
      for (let attempt = 0; attempt < 10; attempt++) {
        const code = generateSessionCode();
        // Код занят незавершённой сессией — уникальный индекс не даст записать, пробуем другой.
        const rows = await sql`
          insert into sessions (id, code, host_id, game_id, game_title, mechanic, game_snapshot, theme_id, play_mode, screen_mode, state)
          values (${id}, ${code}, ${who.uid}, ${typeof body.gameId === "string" ? body.gameId : null}, ${text(body.gameTitle, 200)},
                  ${typeof body.mechanic === "string" ? body.mechanic : null}, ${sql.json((body.gameSnapshot ?? null) as never)},
                  ${text(body.themeId, 40) || "joyrest"}, ${body.playMode === "teams" ? "teams" : "solo"},
                  ${body.screenMode === "remote" || body.screenMode === "none" ? body.screenMode : "laptop"}, ${sql.json(state as never)})
          on conflict do nothing returning id`;
        if (rows.length > 0) return { id, code };
        const again = await loadSession(id);
        if (again) return again.host_id === who.uid ? { id, code: again.code } : fail(reply, 409, "already-exists");
      }
      return fail(reply, 503, "unavailable");
    });

    api.get<{ Params: { code: string }; Querystring: { host?: string } }>("/api/sessions/by-code/:code", async (request, reply) => {
      const who = await requireIdentity(request, reply);
      if (!who) return reply;
      const code = request.params.code;
      if (!CODE.test(code)) return fail(reply, 404, "not-found");
      const host = request.query.host;
      if (host !== undefined) {
        // Пульт: своя сессия с этим кодом, в том числе завершённая.
        if (host !== who.uid) return fail(reply, 403, "permission-denied");
        const rows = await sql<SessionRow[]>`
          select ${sql(SESSION_COLUMNS)}, version::int as version from sessions
          where code = ${code} and host_id = ${host} order by (phase <> 'finished') desc, created_at desc limit 1`;
        return rows[0] ? sessionOf(rows[0]) : fail(reply, 404, "not-found");
      }
      // Гости и экран зала: по коду — только незавершённая сессия. Перебор кодов ограничен числом
      // промахов: 20 за 10 минут на устройство, 200 на адрес (весь зал за одним Wi‑Fi не промахивается).
      const at = now();
      if (!codeMissesByDevice.allowed(who.uid, at) || !codeMissesByIp.allowed(request.ip, at)) {
        return fail(reply, 429, "resource-exhausted");
      }
      const rows = await sql<SessionRow[]>`
        select ${sql(SESSION_COLUMNS)}, version::int as version from sessions
        where code = ${code} and phase in ('lobby', 'playing') order by created_at desc limit 1`;
      if (rows[0]) return sessionOf(rows[0]);
      codeMissesByDevice.take(who.uid, at);
      codeMissesByIp.take(request.ip, at);
      return fail(reply, 404, "not-found");
    });

    api.get<{ Querystring: { host?: string } }>("/api/sessions", async (request, reply) => {
      const who = await requireIdentity(request, reply);
      if (!who) return reply;
      const host = request.query.host ?? "";
      if (!ID.test(host)) return fail(reply, 400, "invalid-argument");
      if (host !== who.uid && !permissions.isAdmin(actor(who))) return fail(reply, 403, "permission-denied");
      const rows = await sql<SessionRow[]>`
        select ${sql(SESSION_COLUMNS)}, version::int as version from sessions where host_id = ${host} order by created_at desc limit 50`;
      return rows.map(sessionOf);
    });

    api.get<{ Params: { id: string }; Querystring: { since?: string } }>("/api/sessions/:id", async (request, reply) => {
      const who = await requireIdentity(request, reply);
      if (!who) return reply;
      const row = await loadSession(request.params.id);
      if (!row) return fail(reply, 404, "not-found");
      // Опрос без потока: не изменилось — пустой ответ.
      if (request.query.since !== undefined && Number(request.query.since) === row.version) return reply.code(204).send();
      return sessionOf(row);
    });

    api.post<{ Params: { id: string }; Body: unknown }>("/api/sessions/:id/apply", { bodyLimit: SMALL_BODY * 8 }, async (request, reply) => {
      const hosted = await hostedSession(request, reply);
      if (!hosted) return reply;
      const checked = checkChange(request.body);
      if (!checked) return fail(reply, 400, "invalid-argument");
      const result = await change(hosted.row.id, (state) =>
        !meetsExpect(state, checked.expect) || (state.phase === "finished" && !allowedAfterFinish(checked)) ? "conflict" : checked,
      );
      // Игра ушла вперёд (второй пульт, двойное касание) — пульт получит свежее состояние и не повторит.
      if (result === "conflict") return fail(reply, 409, "failed-precondition");
      return { ok: true };
    });

    api.post<{ Params: { id: string }; Body: unknown }>("/api/sessions/:id/phase", { bodyLimit: SMALL_BODY }, async (request, reply) => {
      const hosted = await hostedSession(request, reply);
      if (!hosted) return reply;
      const phase = isRecord(request.body) ? request.body.phase : null;
      if (!PHASES.has(phase as SessionPhase)) return fail(reply, 400, "invalid-argument");
      await change(hosted.row.id, () => ({ state: phase === "playing" ? PLAYING_RESET : { phase: phase as SessionPhase }, leaderboard: {} }));
      // «Начать игру» — отсюда считаются 40 минут для баллов ведущего (первый раз).
      if (phase === "playing") {
        await sql`update sessions set started_at = coalesce(started_at, ${new Date(now())}) where id = ${hosted.row.id}`;
      }
      return { ok: true };
    });

    api.post<{ Params: { id: string }; Body: unknown }>("/api/sessions/:id/leaderboard", { bodyLimit: SMALL_BODY * 8 }, async (request, reply) => {
      const hosted = await hostedSession(request, reply);
      if (!hosted) return reply;
      const entries = isRecord(request.body) ? request.body.entries : null;
      const checked = checkChange({ leaderboard: entries });
      if (!checked || Object.values(checked.leaderboard).some((e) => e === null)) return fail(reply, 400, "invalid-argument");
      // Только новые участники: уже записанные (с очками) не перезаписываются запоздавшим запросом.
      if (Object.keys(checked.leaderboard).length > 0) {
        await change(hosted.row.id, (_state, board) => {
          const fresh = Object.fromEntries(Object.entries(checked.leaderboard).filter(([pid]) => !board[pid]));
          return Object.keys(fresh).length > 0 ? { state: {}, leaderboard: fresh } : null;
        });
      }
      return { ok: true };
    });

    api.post<{ Params: { id: string }; Body: unknown }>("/api/sessions/:id/finish", { bodyLimit: SMALL_BODY }, async (request, reply) => {
      const hosted = await hostedSession(request, reply);
      if (!hosted) return reply;
      const count = isRecord(request.body) ? request.body.participantsCount : 0;
      const participantsCount = Number.isInteger(count) && (count as number) >= 0 ? (count as number) : 0;
      await change(hosted.row.id, () => ({ state: { phase: "finished" }, leaderboard: {} }));
      // Итоги — по таблице на сервере, а не по присланной.
      const row = await loadSession(hosted.row.id);
      if (row) {
        await saveResult(sql, row, participantsCount, true);
        await awardGamePoints(sql, row.id, now());
      }
      return { ok: true };
    });

    // Автоочистка: при входе admin в /admin удаляются сессии старше 30 дней вместе с участниками
    // и ответами. Незавершённую игру с участниками сначала сохраняем в историю.
    api.post<{ Body: unknown }>("/api/sessions/cleanup", { bodyLimit: SMALL_BODY }, async (request, reply) => {
      const who = await requireIdentity(request, reply);
      if (!who) return reply;
      if (!permissions.canCleanupSessions(actor(who))) return fail(reply, 403, "permission-denied");
      const asked = isRecord(request.body) && typeof request.body.cutoff === "number" ? request.body.cutoff : 0;
      // Не свежее срока хранения, даже если браузер попросил иначе.
      const cutoff = new Date(Math.min(asked, retentionCutoff(now())));
      const rows = await sql<SessionRow[]>`
        select ${sql(SESSION_COLUMNS)}, version::int as version from sessions
        where created_at < ${cutoff} order by created_at limit ${CLEANUP_LIMIT + 1}`;
      const batch = rows.slice(0, CLEANUP_LIMIT);
      for (const row of batch) {
        await sql.begin(async (tx) => {
          if (Object.keys(normalizeBoard(row.leaderboard)).length > 0) {
            const [{ count }] = await tx<{ count: number }[]>`
              select count(*)::int as count from participants where session_id = ${row.id} and kind = 'player'`;
            await saveResult(tx, row, count, false);
          }
          await tx`delete from answers where session_id = ${row.id}`;
          await tx`delete from participants where session_id = ${row.id}`;
          await tx`delete from sessions where id = ${row.id}`;
        });
      }
      request.log.info({ cleanup: batch.length }, "sessions cleanup");
      return { deleted: batch.length, more: rows.length > CLEANUP_LIMIT };
    });

    // ---------------------------------------------------------------- участники

    async function loadParticipant(sessionId: string, pid: string): Promise<ParticipantRow | null> {
      if (!ID.test(pid)) return null;
      const rows = await sql<ParticipantRow[]>`
        select ${sql(PARTICIPANT_COLUMNS)} from participants where session_id = ${sessionId} and id = ${pid}`;
      return rows[0] ?? null;
    }

    function publishParticipant(sessionId: string, row: ParticipantRow | null, removed?: string) {
      hub.publish(`participants:${sessionId}`, row ? { type: "upsert", participant: participantOf(row) } : { type: "remove", id: removed });
    }

    api.get<{ Params: { id: string } }>("/api/sessions/:id/participants", async (request, reply) => {
      const hosted = await hostedSession(request, reply);
      if (!hosted) return reply;
      const rows = await sql<ParticipantRow[]>`select ${sql(PARTICIPANT_COLUMNS)} from participants where session_id = ${hosted.row.id}`;
      return rows.map(participantOf);
    });

    api.get<{ Params: { id: string; pid: string } }>("/api/sessions/:id/participants/:pid", async (request, reply) => {
      const who = await requireIdentity(request, reply);
      if (!who) return reply;
      const row = await loadParticipant(request.params.id, request.params.pid);
      return row ? participantOf(row) : fail(reply, 404, "not-found");
    });

    api.get<{ Params: { id: string } }>("/api/sessions/:id/teams", async (request, reply) => {
      const who = await requireIdentity(request, reply);
      if (!who) return reply;
      const rows = await sql<ParticipantRow[]>`
        select ${sql(PARTICIPANT_COLUMNS)} from participants where session_id = ${request.params.id} and kind = 'team'`;
      return rows.map(participantOf).sort((a, b) => a.name.localeCompare(b.name, "ru"));
    });

    /** Есть ли команда с таким id в этой сессии. */
    async function isTeam(sessionId: string, teamId: string): Promise<boolean> {
      const row = await loadParticipant(sessionId, teamId);
      return row?.kind === "team";
    }

    api.post<{ Params: { id: string; pid: string }; Body: unknown }>("/api/sessions/:id/participants/:pid/join", { bodyLimit: SMALL_BODY }, async (request, reply) => {
      const who = await requireIdentity(request, reply);
      if (!who) return reply;
      const { id, pid } = request.params;
      // Телефон гостя — участник с id = uid: повторный вход не создаёт дубль.
      if (pid !== who.uid) return fail(reply, 403, "permission-denied");
      const session = await loadSession(id);
      if (!session) return fail(reply, 404, "not-found");
      if (normalizeState(session.state).phase === "finished") return fail(reply, 403, "permission-denied");
      const body = isRecord(request.body) ? request.body : {};
      const teamId = typeof body.teamId === "string" ? body.teamId : null;
      if (!validName(body.name) || (teamId !== null && !(await isTeam(id, teamId)))) return fail(reply, 400, "invalid-argument");
      const existing = await loadParticipant(id, pid);
      if (existing && existing.kind !== "player") return fail(reply, 403, "permission-denied");
      const [row] = await sql<ParticipantRow[]>`
        insert into participants (session_id, id, name, kind, team_id, captain_uid)
        values (${id}, ${pid}, ${body.name}, 'player', ${teamId}, ${who.uid})
        on conflict (session_id, id) do update set name = excluded.name, team_id = excluded.team_id
        returning ${sql(PARTICIPANT_COLUMNS)}`;
      publishParticipant(id, row ?? null);
      return { ok: true };
    });

    api.post<{ Params: { id: string }; Body: unknown }>("/api/sessions/:id/teams", { bodyLimit: SMALL_BODY }, async (request, reply) => {
      const who = await requireIdentity(request, reply);
      if (!who) return reply;
      const session = await loadSession(request.params.id);
      if (!session) return fail(reply, 404, "not-found");
      const body = isRecord(request.body) ? request.body : {};
      const teamId = typeof body.id === "string" && ID.test(body.id) ? body.id : null;
      if (session.play_mode !== "teams" || normalizeState(session.state).phase === "finished") return fail(reply, 403, "permission-denied");
      if (!teamId || !validName(body.name)) return fail(reply, 400, "invalid-argument");
      // Одно устройство — одна команда; в сессии — не больше MAX_TEAMS команд (спам на большом экране).
      const [counts] = await sql<{ mine: number; total: number }[]>`
        select count(*) filter (where captain_uid = ${who.uid} and id <> ${teamId})::int as mine, count(*)::int as total
        from participants where session_id = ${session.id} and kind = 'team'`;
      if ((counts?.mine ?? 0) > 0) return fail(reply, 409, "already-exists");
      if ((counts?.total ?? 0) >= MAX_TEAMS) return fail(reply, 429, "resource-exhausted");
      const rows = await sql<ParticipantRow[]>`
        insert into participants (session_id, id, name, kind, team_id, captain_uid)
        values (${session.id}, ${teamId}, ${body.name}, 'team', null, ${who.uid})
        on conflict (session_id, id) do nothing returning ${sql(PARTICIPANT_COLUMNS)}`;
      if (rows[0]) publishParticipant(session.id, rows[0]);
      else {
        const existing = await loadParticipant(session.id, teamId);
        if (!existing || existing.captain_uid !== who.uid) return fail(reply, 409, "already-exists");
      }
      return { id: teamId };
    });

    api.post<{ Params: { id: string; pid: string }; Body: unknown }>("/api/sessions/:id/participants/:pid/rename", { bodyLimit: SMALL_BODY }, async (request, reply) => {
      const hosted = await hostedSession(request, reply);
      if (!hosted) return reply;
      const name = isRecord(request.body) ? request.body.name : null;
      if (!validName(name)) return fail(reply, 400, "invalid-argument");
      const [row] = await sql<ParticipantRow[]>`
        update participants set name = ${name} where session_id = ${hosted.row.id} and id = ${request.params.pid}
        returning ${sql(PARTICIPANT_COLUMNS)}`;
      if (!row) return fail(reply, 404, "not-found");
      publishParticipant(hosted.row.id, row);
      return { ok: true };
    });

    api.post<{ Params: { id: string; pid: string }; Body: unknown }>("/api/sessions/:id/participants/:pid/captain", { bodyLimit: SMALL_BODY }, async (request, reply) => {
      const hosted = await hostedSession(request, reply);
      if (!hosted) return reply;
      const uid = isRecord(request.body) ? request.body.uid : null;
      if (typeof uid !== "string" || !ID.test(uid)) return fail(reply, 400, "invalid-argument");
      const [row] = await sql<ParticipantRow[]>`
        update participants set captain_uid = ${uid} where session_id = ${hosted.row.id} and id = ${request.params.pid}
        returning ${sql(PARTICIPANT_COLUMNS)}`;
      if (!row) return fail(reply, 404, "not-found");
      publishParticipant(hosted.row.id, row);
      return { ok: true };
    });

    api.post<{ Params: { id: string; pid: string } }>("/api/sessions/:id/participants/:pid/touch", async (request, reply) => {
      const who = await requireIdentity(request, reply);
      if (!who) return reply;
      const { id, pid } = request.params;
      if (pid !== who.uid) return fail(reply, 403, "permission-denied");
      const [row] = await sql<ParticipantRow[]>`
        update participants set seen_at = ${new Date(now())} where session_id = ${id} and id = ${pid} and kind = 'player'
        returning ${sql(PARTICIPANT_COLUMNS)}`;
      if (!row) return fail(reply, 404, "not-found");
      publishParticipant(id, row);
      return { ok: true };
    });

    // ---------------------------------------------------------------- экран зала → пульт

    // Экран зала (любое вошедшее устройство с кодом) раз в 20 с сообщает о себе: на связи, звук
    // разрешён, не выключен. Только в памяти: после перезапуска экран сообщит снова.
    api.post<{ Params: { id: string }; Body: unknown }>("/api/sessions/:id/screen", { bodyLimit: 1024 }, async (request, reply) => {
      const who = await requireIdentity(request, reply);
      if (!who) return reply;
      const report = parseScreenReport(request.body);
      if (!report) return fail(reply, 400, "invalid-argument");
      const row = await loadSession(request.params.id);
      if (!row || normalizeState(row.state).phase === "finished") return fail(reply, 404, "not-found");
      const at = now();
      if (screens.size >= SCREENS_MAX) {
        for (const [key, value] of screens) if (at - value.seenAt > SCREEN_STALE_MS) screens.delete(key);
        if (screens.size >= SCREENS_MAX) screens.delete(screens.keys().next().value ?? "");
      }
      screens.set(row.id, { ...report, seenAt: at });
      return { ok: true };
    });

    api.get<{ Params: { id: string } }>("/api/sessions/:id/screen", async (request, reply) => {
      const hosted = await hostedSession(request, reply);
      if (!hosted) return reply;
      reply.header("cache-control", "no-store");
      const screen = screens.get(hosted.row.id);
      return { screen: screen && now() - screen.seenAt <= SCREEN_STALE_MS ? screen : null };
    });

    api.delete<{ Params: { id: string; pid: string } }>("/api/sessions/:id/participants/:pid", async (request, reply) => {
      const hosted = await hostedSession(request, reply);
      if (!hosted) return reply;
      await sql`delete from participants where session_id = ${hosted.row.id} and id = ${request.params.pid}`;
      publishParticipant(hosted.row.id, null, request.params.pid);
      return { ok: true };
    });

    // ---------------------------------------------------------------- ответы

    api.post<{ Params: { id: string }; Body: unknown }>("/api/sessions/:id/answers", { bodyLimit: SMALL_BODY }, async (request, reply) => {
      const who = await requireIdentity(request, reply);
      if (!who) return reply;
      const body = isRecord(request.body) ? request.body : {};
      const step = body.step;
      const pid = body.pid;
      if (!Number.isInteger(step) || typeof pid !== "string" || !ID.test(pid)) return fail(reply, 400, "invalid-argument");
      const session = await loadSession(request.params.id);
      if (!session) return fail(reply, 404, "not-found");
      // Только на текущий открытый вопрос и пока не вышло время — по часам сервера.
      const time = now();
      if (!permissions.canSubmitAnswer(normalizeState(session.state), step as number, time)) return { result: "rejected" };
      // Отвечает сам игрок или капитан своей команды.
      const participant = await loadParticipant(session.id, pid);
      if (!participant || participant.captain_uid !== who.uid) return { result: "rejected" };
      const [row] = await sql<AnswerRow[]>`
        insert into answers (session_id, step, pid, uid, value, submitted_at)
        values (${session.id}, ${step as number}, ${pid}, ${who.uid}, ${sql.json((body.value ?? null) as never)}, ${new Date(time)})
        on conflict (session_id, step, pid) do nothing returning step, pid, uid, value, submitted_at`;
      // Повторное нажатие ничего не меняет.
      if (!row) return { result: "rejected" };
      hub.publish(`answers:${session.id}`, { type: "answer", answer: answerOf(row) });
      return { result: "sent" };
    });

    api.get<{ Params: { id: string; step: string } }>("/api/sessions/:id/answers/:step", async (request, reply) => {
      const hosted = await hostedSession(request, reply);
      if (!hosted) return reply;
      const rows = await sql<AnswerRow[]>`
        select step, pid, uid, value, submitted_at from answers where session_id = ${hosted.row.id} and step = ${Number(request.params.step) || 0}`;
      return rows.map(answerOf);
    });

    api.get<{ Params: { id: string; step: string; pid: string } }>("/api/sessions/:id/answers/:step/:pid", async (request, reply) => {
      const who = await requireIdentity(request, reply);
      if (!who) return reply;
      const session = await loadSession(request.params.id);
      if (!session) return fail(reply, 404, "not-found");
      const rows = await sql<AnswerRow[]>`
        select step, pid, uid, value, submitted_at from answers
        where session_id = ${session.id} and step = ${Number(request.params.step) || 0} and pid = ${request.params.pid}`;
      const row = rows[0];
      if (!row) return fail(reply, 404, "not-found");
      // Ответы видит пульт; телефон — свой ответ или ответ своей команды.
      const mine = await loadParticipant(session.id, who.uid);
      const allowed = permissions.canReadAnswer(who.uid, { hostId: session.host_id }, { uid: row.uid, pid: row.pid }, mine ? { teamId: mine.team_id } : null);
      return allowed ? answerOf(row) : fail(reply, 404, "not-found");
    });

    api.delete<{ Params: { id: string; step: string } }>("/api/sessions/:id/answers/:step", async (request, reply) => {
      const hosted = await hostedSession(request, reply);
      if (!hosted) return reply;
      const step = Number(request.params.step) || 0;
      await sql`delete from answers where session_id = ${hosted.row.id} and step = ${step}`;
      hub.publish(`answers:${hosted.row.id}`, { type: "clear", step });
      return { ok: true };
    });

    // ---------------------------------------------------------------- итоги

    api.get<{ Params: { id: string } }>("/api/results/:id", async (request, reply) => {
      // Итоги по ссылке открываются без входа: в них только названия и очки.
      if (!ID.test(request.params.id)) return fail(reply, 404, "not-found");
      const rows = await sql<ResultRow[]>`select * from results where id = ${request.params.id}`;
      return rows[0] ? resultOf(rows[0]) : fail(reply, 404, "not-found");
    });

    api.get<{ Querystring: { host?: string } }>("/api/results", async (request, reply) => {
      const who = await requireIdentity(request, reply);
      if (!who) return reply;
      const host = request.query.host ?? "";
      if (!permissions.canListResults(actor(who), host)) return fail(reply, 403, "permission-denied");
      const rows = await sql<ResultRow[]>`select * from results where host_id = ${host} order by played_at desc nulls last limit 200`;
      return rows.map(resultOf);
    });

    // ---------------------------------------------------------------- потоки

    /**
     * Поток событий: подписка раньше снимка (ничего не теряется), снимок, дальше изменения.
     * «Я жив» — комментарий раз в keepAliveMs: прокси и мобильные сети не рвут тихое соединение.
     */
    async function stream(request: FastifyRequest, reply: FastifyReply, channel: string, filter: (event: object) => boolean, snapshot: () => Promise<object>) {
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
        Connection: "keep-alive",
      });
      const send = (event: object) => {
        if (res.destroyed) return;
        if (res.writableLength > STREAM_BACKLOG_BYTES) {
          res.destroy();
          return;
        }
        res.write(sseFrame(event));
      };
      let ready = false;
      const queued: object[] = [];
      const unsubscribe = hub.subscribe(channel, (event) => {
        if (!filter(event)) return;
        if (ready) send(event);
        else queued.push(event);
      });
      const ping = setInterval(() => {
        if (!res.destroyed) res.write(": ping\n\n");
      }, keepAliveMs);
      const close = () => {
        clearInterval(ping);
        unsubscribe();
      };
      // Закрытие ответа надёжнее закрытия запроса; телефон мог уйти, пока мы проверяли вход.
      res.on("close", close);
      if (res.destroyed) {
        close();
        return;
      }
      try {
        send(await snapshot());
        ready = true;
        for (const event of queued) send(event);
      } catch {
        close();
        res.end();
      }
    }

    api.get<{ Params: { id: string } }>("/api/stream/session/:id", async (request, reply) => {
      const who = await requireIdentity(request, reply);
      if (!who) return reply;
      const row = await loadSession(request.params.id);
      if (!row) return fail(reply, 404, "not-found");
      return stream(request, reply, `session:${row.id}`, () => true, async () => {
        const fresh = await loadSession(row.id);
        return { type: "snapshot", session: fresh ? sessionOf(fresh) : null };
      });
    });

    api.get<{ Params: { id: string } }>("/api/stream/participants/:id", async (request, reply) => {
      const hosted = await hostedSession(request, reply);
      if (!hosted) return reply;
      return stream(request, reply, `participants:${hosted.row.id}`, () => true, async () => {
        const rows = await sql<ParticipantRow[]>`select ${sql(PARTICIPANT_COLUMNS)} from participants where session_id = ${hosted.row.id}`;
        return { type: "snapshot", participants: rows.map(participantOf) };
      });
    });

    api.get<{ Params: { id: string; step: string } }>("/api/stream/answers/:id/:step", async (request, reply) => {
      const hosted = await hostedSession(request, reply);
      if (!hosted) return reply;
      const step = Number(request.params.step) || 0;
      const onStep = (event: object) => {
        const e = event as { type?: string; step?: number; answer?: { step: number } };
        return e.type === "clear" ? e.step === step : e.answer?.step === step;
      };
      return stream(request, reply, `answers:${hosted.row.id}`, onStep, async () => {
        const rows = await sql<AnswerRow[]>`
          select step, pid, uid, value, submitted_at from answers where session_id = ${hosted.row.id} and step = ${step}`;
        return { type: "snapshot", answers: rows.map(answerOf) };
      });
    });
  });

  return hub;
}
