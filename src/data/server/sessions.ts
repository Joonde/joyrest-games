/**
 * Сессии на своём сервере: `/api/sessions/...` и поток `/api/stream/session/:id`
 * (снимок + изменения: состояние шага целиком и изменённые записи таблицы лидеров).
 */
import type { SessionsRepository } from "../contracts";
import { parseCue, parseMix, parseMusic, parsePeek, parseSlide, parseTeams } from "../cues";
import { errorCodeOf } from "../retry";
import type { Leaderboard, LeaderboardEntry, ScreenMode, Session, SessionPhase, SessionState, SessionSummary, StepStage } from "../types";
import { api, asRecord, asText, newId } from "./api";
import { openStream } from "./stream";

type Versioned = Session & { version: number };

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseStage(value: unknown, revealed: boolean): StepStage {
  if (value === "ready" || value === "question" || value === "reveal" || value === "board" || value === "podium") return value;
  return revealed ? "reveal" : "ready";
}

function parsePhase(value: unknown): SessionPhase {
  return value === "playing" || value === "finished" ? value : "lobby";
}

export function parseState(value: unknown): SessionState {
  const s = asRecord(value);
  const revealed = s.revealed === true;
  return {
    phase: parsePhase(s.phase),
    step: num(s.step),
    startedAt: typeof s.startedAt === "number" ? s.startedAt : null,
    revealed,
    stage: parseStage(s.stage, revealed),
    timeLimit: typeof s.timeLimit === "number" ? s.timeLimit : null,
    answered: num(s.answered),
    result: s.result ?? null,
    cue: parseCue(s.cue),
    music: parseMusic(s.music),
    mix: parseMix(s.mix),
    slide: parseSlide(s.slide),
    teams: parseTeams(s.teams),
    peek: parsePeek(s.peek),
  };
}

function parseEntry(value: unknown): LeaderboardEntry {
  const e = asRecord(value);
  const entry: LeaderboardEntry = { name: asText(e.name), kind: e.kind === "team" ? "team" : "player", score: num(e.score) };
  if (typeof e.colorIndex === "number") entry.colorIndex = e.colorIndex;
  if (typeof e.last === "number") entry.last = e.last;
  if (typeof e.captainUid === "string") entry.captainUid = e.captainUid;
  if (typeof e.roundBase === "number") entry.roundBase = e.roundBase;
  if (typeof e.move === "number") entry.move = e.move;
  if (typeof e.race === "number") entry.race = e.race;
  return entry;
}

function parseBoard(value: unknown): Leaderboard {
  const board: Leaderboard = {};
  for (const [id, raw] of Object.entries(asRecord(value))) board[id] = parseEntry(raw);
  return board;
}

export function parseSession(value: unknown): Versioned | null {
  const d = asRecord(value);
  const id = asText(d.id);
  if (!id) return null;
  return {
    id,
    code: asText(d.code),
    hostId: asText(d.hostId),
    gameId: typeof d.gameId === "string" ? d.gameId : null,
    gameTitle: asText(d.gameTitle),
    mechanic: typeof d.mechanic === "string" ? d.mechanic : null,
    gameSnapshot: d.gameSnapshot ?? null,
    themeId: asText(d.themeId) || "joyrest",
    playMode: d.playMode === "teams" ? "teams" : "solo",
    screenMode: d.screenMode === "remote" || d.screenMode === "none" ? d.screenMode : "laptop",
    state: parseState(d.state),
    leaderboard: parseBoard(d.leaderboard),
    createdAt: typeof d.createdAt === "number" ? d.createdAt : null,
    version: num(d.version),
  };
}

/** Изменение из потока: новое состояние и изменённые записи таблицы (null — убрать). */
export function applyPatch(session: Versioned, patch: { version?: unknown; state?: unknown; leaderboard?: unknown }): Versioned {
  const leaderboard: Leaderboard = { ...session.leaderboard };
  for (const [pid, entry] of Object.entries(asRecord(patch.leaderboard))) {
    if (entry === null) delete leaderboard[pid];
    else leaderboard[pid] = parseEntry(entry);
  }
  return { ...session, version: num(patch.version), state: parseState(patch.state), leaderboard };
}

/** Для экранов — без служебной версии. */
function plain(session: Versioned | null): Session | null {
  if (!session) return null;
  const { version: _version, ...rest } = session;
  return rest;
}

async function getOrNull(path: string): Promise<Session | null> {
  try {
    return plain(parseSession(await api("GET", path)));
  } catch (error) {
    if (errorCodeOf(error) === "not-found") return null;
    throw error;
  }
}

const base = (id: string) => `/api/sessions/${encodeURIComponent(id)}`;

export const serverSessionsRepository: SessionsRepository = {
  async create(_hostId, options) {
    const data = asRecord(await api("POST", "/api/sessions", { id: newId(), ...options }));
    return { id: asText(data.id), code: asText(data.code) };
  },

  findByCode(code) {
    return getOrNull(`/api/sessions/by-code/${encodeURIComponent(code)}`);
  },

  findHostSessionByCode(code, hostId) {
    return getOrNull(`/api/sessions/by-code/${encodeURIComponent(code)}?host=${encodeURIComponent(hostId)}`);
  },

  get(sessionId) {
    return getOrNull(base(sessionId));
  },

  watch(sessionId, onChange, onError) {
    let current: Versioned | null = null;
    let lastJson = "";
    const emit = () => {
      const session = plain(current);
      const json = JSON.stringify(session);
      if (json === lastJson) return;
      lastJson = json;
      onChange(session);
    };
    const onEvent = (event: { type?: string; session?: unknown; version?: unknown; state?: unknown; leaderboard?: unknown }) => {
      if (event.type === "snapshot") {
        const next = parseSession(event.session);
        // Снимок, запрошенный раньше последнего изменения, не откатывает состояние назад.
        if (next && current && next.id === current.id && next.version < current.version) return;
        current = next;
        emit();
      } else if (event.type === "patch" && current) {
        const previous = current.version;
        // Старое изменение (уже вошло в снимок) пропускаем.
        if (num(event.version) <= current.version) return;
        current = applyPatch(current, event);
        emit();
        // Пропущено изменение (версия перескочила) — в таблице могло не хватать записей: берём снимок.
        if (num(event.version) > previous + 1) void refresh();
      }
    };
    const refresh = async () => {
      try {
        onEvent({ type: "snapshot", session: await api("GET", base(sessionId)) });
      } catch {
        // Следующее изменение или переподключение принесут свежий снимок.
      }
    };
    return openStream({
      url: `/api/stream/session/${encodeURIComponent(sessionId)}`,
      onEvent,
      onError,
      poll: async () => {
        try {
          onEvent({ type: "snapshot", session: await api("GET", base(sessionId)) });
        } catch (error) {
          if (errorCodeOf(error) !== "not-found") throw error;
          current = null;
          emit();
        }
      },
    });
  },

  async overview() {
    const data = await api("GET", "/api/sessions/overview");
    return (Array.isArray(data) ? data : []).flatMap((raw): SessionSummary[] => {
      const d = asRecord(raw);
      const id = asText(d.id);
      const code = asText(d.code);
      if (!id || !/^\d{6}$/.test(code)) return [];
      const phase: SessionPhase = d.phase === "playing" || d.phase === "finished" ? d.phase : "lobby";
      const screenMode: ScreenMode = d.screenMode === "none" || d.screenMode === "remote" ? d.screenMode : "laptop";
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
      return [{ id, code, hostId: asText(d.hostId), hostName: asText(d.hostName), gameTitle: asText(d.gameTitle), mechanic: typeof d.mechanic === "string" ? d.mechanic : null, phase, screenMode, players: num(d.players), createdAt: num(d.createdAt), updatedAt: num(d.updatedAt), startedAt: typeof d.startedAt === "number" ? d.startedAt : null }];
    });
  },

  async listByHost(hostId) {
    const data = await api("GET", `/api/sessions?host=${encodeURIComponent(hostId)}`);
    return (Array.isArray(data) ? data : [])
      .map(parseSession)
      .map(plain)
      .filter((s): s is Session => s !== null);
  },

  async setPhase(sessionId, phase) {
    await api("POST", `${base(sessionId)}/phase`, { phase });
  },

  async upsertLeaderboard(sessionId, entries) {
    if (Object.keys(entries).length === 0) return;
    await api("POST", `${base(sessionId)}/leaderboard`, { entries });
  },

  async apply(sessionId, change) {
    await api("POST", `${base(sessionId)}/apply`, change);
  },

  async finish(session, participantsCount) {
    await api("POST", `${base(session.id)}/finish`, { participantsCount });
  },

  // Автоочистка при входе admin: сервер не удалит сессии свежее 30 дней, даже если попросить.
  async removeExpired(cutoff) {
    const data = asRecord(await api("POST", "/api/sessions/cleanup", { cutoff }));
    return { deleted: typeof data.deleted === "number" ? data.deleted : 0, more: data.more === true };
  },
};
