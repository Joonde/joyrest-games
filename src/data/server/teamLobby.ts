/**
 * Управляемое командное лобби на своём сервере (`server/src/teamLobby.ts`, ТЗ 13.1–13.2). Действие ведущего получает
 * свой `actionId` один раз: обрыв связи или ответ 5xx — тот же запрос ещё два раза, сервер вернёт прежний результат и не
 * перемешает людей заново. Отказы с кодом (`team-full`, `formation-changed`…) не повторяются.
 */
import type { TeamFormationResult, TeamLobbyRepository } from "../contracts";
import { errorCodeOf } from "../retry";
import type { PublicLobbyTeam, TeamFormation, TeamLobbyPublic, TeamLobbySnapshot } from "../types";
import { api, asRecord, asText, newId } from "./api";
import { openStream } from "./stream";

const base = (sessionId: string) => `/api/sessions/${encodeURIComponent(sessionId)}`;
const RETRY_MS = [700, 1500];

/** Обрыв или 5xx — повтор с тем же телом; отказ сервера по существу — сразу наверх. */
async function retried<T>(send: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (error) {
      const delay = RETRY_MS[attempt];
      if (errorCodeOf(error) !== "unavailable" || delay === undefined) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : []);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

export function parseFormation(value: unknown): TeamFormation | null {
  const d = asRecord(value);
  if (d.mode !== "self" && d.mode !== "randomTeams") return null;
  const formation: TeamFormation = {
    mode: d.mode,
    teamCount: num(d.teamCount),
    maxMembers: num(d.maxMembers),
    revision: num(d.revision),
    distributed: d.distributed === true,
  };
  if (Array.isArray(d.excluded)) formation.excluded = ids(d.excluded);
  return formation;
}

function parseTeams(value: unknown): PublicLobbyTeam[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => {
      const d = asRecord(raw);
      return { id: asText(d.id), name: asText(d.name), memberCount: num(d.memberCount), captainName: typeof d.captainName === "string" ? d.captainName : null };
    })
    .filter((t) => t.id !== "");
}

export function parseLobby(value: unknown): TeamLobbyPublic | null {
  const d = asRecord(value);
  const formation = parseFormation(d.formation);
  if (!formation) return null;
  return { formation, teams: parseTeams(d.teams), joinedCount: num(d.joinedCount), onlineCount: num(d.onlineCount), waitingCount: num(d.waitingCount) };
}

function parseSnapshot(value: unknown): TeamLobbySnapshot | null {
  const lobby = parseLobby(value);
  if (!lobby) return null;
  const d = asRecord(value);
  const me = asRecord(d.me);
  const snapshot: TeamLobbySnapshot = {
    ...lobby,
    me: d.me ? { teamId: typeof me.teamId === "string" ? me.teamId : null, isCaptain: me.isCaptain === true, noCaptain: me.noCaptain === true } : null,
  };
  if (Array.isArray(d.ownTeamMembers)) {
    snapshot.ownTeamMembers = d.ownTeamMembers.map((raw) => {
      const m = asRecord(raw);
      return { name: asText(m.name), isCaptain: m.isCaptain === true, online: m.online === true };
    });
  }
  return snapshot;
}

function parseResult(value: unknown): TeamFormationResult {
  const d = asRecord(value);
  const result: TeamFormationResult = { revision: num(d.revision) };
  if (d.assigned && typeof d.assigned === "object") {
    result.assigned = Object.fromEntries(Object.entries(asRecord(d.assigned)).filter((e): e is [string, string] => typeof e[1] === "string"));
  }
  for (const key of ["rest", "skippedOffline", "skippedExcluded", "ignored"] as const) if (Array.isArray(d[key])) result[key] = ids(d[key]);
  if (Array.isArray(d.teams)) {
    result.teams = d.teams.map((raw) => {
      const t = asRecord(raw);
      return { id: asText(t.id), captain: asText(t.captain), unwilling: t.unwilling === true };
    });
  }
  return result;
}

/** Действие ведущего: один `actionId` на все повторы. */
function hostAction(path: string, expectedRevision: number, body: object = {}): Promise<TeamFormationResult> {
  const payload = { ...body, actionId: newId(), expectedRevision };
  return retried(async () => parseResult(await api("POST", path, payload)));
}

export const serverTeamLobbyRepository: TeamLobbyRepository = {
  watch(sessionId, onChange, onError) {
    let last = "";
    const onEvent = (event: { type?: string; lobby?: unknown }) => {
      if (event.type !== "snapshot" && event.type !== "closed") return;
      const lobby = event.type === "snapshot" ? parseLobby(event.lobby) : null;
      const json = JSON.stringify(lobby);
      if (json === last) return;
      last = json;
      onChange(lobby);
    };
    return openStream({
      url: `/api/stream/team-lobby/${encodeURIComponent(sessionId)}`,
      onEvent,
      onError,
      poll: async () => {
        try {
          onEvent({ type: "snapshot", lobby: await api("GET", `${base(sessionId)}/team-lobby`) });
        } catch (error) {
          // Лобби вернули в прежнее — не ошибка, а «лобби нет».
          if (errorCodeOf(error) === "not-found") onEvent({ type: "closed" });
          else throw error;
        }
      },
    });
  },

  async get(sessionId) {
    try {
      return parseSnapshot(await api("GET", `${base(sessionId)}/team-lobby`));
    } catch (error) {
      if (errorCodeOf(error) === "not-found") return null;
      throw error;
    }
  },

  settings(sessionId, expectedRevision, settings) {
    return hostAction(`${base(sessionId)}/team-formation`, expectedRevision, settings);
  },

  async exclude(sessionId, pid, excluded) {
    const data = asRecord(await retried(() => api("POST", `${base(sessionId)}/team-formation/exclude`, { pid, excluded })));
    return ids(data.excluded);
  },

  distribute(sessionId, expectedRevision, includeOffline) {
    return hostAction(`${base(sessionId)}/team-formation/distribute`, expectedRevision, { includeOffline });
  },

  autoAssign(sessionId, expectedRevision, includeOffline) {
    return hostAction(`${base(sessionId)}/team-formation/auto-assign`, expectedRevision, { includeOffline });
  },

  reset(sessionId, expectedRevision) {
    return hostAction(`${base(sessionId)}/team-formation/reset`, expectedRevision);
  },

  move(sessionId, pid, teamId, expectedRevision) {
    return hostAction(`${base(sessionId)}/participants/${encodeURIComponent(pid)}/move`, expectedRevision, { teamId });
  },

  addTeam(sessionId, expectedRevision, captainPid, name) {
    return hostAction(`${base(sessionId)}/team-formation/team`, expectedRevision, name ? { captainPid, name } : { captainPid });
  },

  async leave(sessionId, pid) {
    await retried(() => api("POST", `${base(sessionId)}/participants/${encodeURIComponent(pid)}/leave`));
  },

  async captainPreference(sessionId, pid, noCaptain) {
    await retried(() => api("POST", `${base(sessionId)}/participants/${encodeURIComponent(pid)}/captain-pref`, { noCaptain }));
  },

  async renameTeam(sessionId, teamId, name) {
    await retried(() => api("POST", `${base(sessionId)}/teams/${encodeURIComponent(teamId)}/profile`, { name }));
  },
};
