/** Участники на своём сервере: телефон гостя (id = uid), команды; список слушает только пульт. */
import type { ParticipantsRepository } from "../contracts";
import { errorCodeOf } from "../retry";
import type { Participant } from "../types";
import { api, asRecord, asText, newId } from "./api";
import { openStream } from "./stream";

export function parseParticipant(value: unknown): Participant | null {
  const d = asRecord(value);
  const id = asText(d.id);
  if (!id) return null;
  return {
    id,
    name: asText(d.name),
    kind: d.kind === "team" ? "team" : "player",
    teamId: typeof d.teamId === "string" ? d.teamId : null,
    captainUid: asText(d.captainUid),
    joinedAt: typeof d.joinedAt === "number" ? d.joinedAt : null,
    seenAt: typeof d.seenAt === "number" ? d.seenAt : null,
  };
}

function parseList(value: unknown): Participant[] {
  return (Array.isArray(value) ? value : []).map(parseParticipant).filter((p): p is Participant => p !== null);
}

const base = (sessionId: string) => `/api/sessions/${encodeURIComponent(sessionId)}`;
const one = (sessionId: string, pid: string) => `${base(sessionId)}/participants/${encodeURIComponent(pid)}`;

export const serverParticipantsRepository: ParticipantsRepository = {
  async getMine(sessionId, uid) {
    try {
      return parseParticipant(await api("GET", one(sessionId, uid)));
    } catch (error) {
      if (errorCodeOf(error) === "not-found") return null;
      throw error;
    }
  },

  async joinAsPlayer(sessionId, uid, name, teamId) {
    await api("POST", `${one(sessionId, uid)}/join`, { name, teamId });
  },

  async createTeam(sessionId, _captainUid, name) {
    const data = asRecord(await api("POST", `${base(sessionId)}/teams`, { id: newId(), name }));
    return asText(data.id);
  },

  async listTeams(sessionId) {
    return parseList(await api("GET", `${base(sessionId)}/teams`));
  },

  async rename(sessionId, pid, name) {
    await api("POST", `${one(sessionId, pid)}/rename`, { name });
  },

  async remove(sessionId, pid) {
    await api("DELETE", one(sessionId, pid));
  },

  async setCaptain(sessionId, teamId, uid) {
    await api("POST", `${one(sessionId, teamId)}/captain`, { uid });
  },

  async touch(sessionId, uid) {
    await api("POST", `${one(sessionId, uid)}/touch`);
  },

  async listOffline(sessionId) {
    const data = await api("GET", `/api/sessions/${encodeURIComponent(sessionId)}/offline`);
    return (Array.isArray(data) ? data : []).flatMap((item) => {
      const d = asRecord(item);
      const pid = asText(d.pid);
      return pid ? [{ pid, name: asText(d.name), team: typeof d.team === "string" ? d.team : null }] : [];
    });
  },

  async claim(sessionId, pid) {
    await api("POST", `${one(sessionId, pid)}/claim`);
  },

  watch(sessionId, onChange, onError) {
    const all = new Map<string, Participant>();
    const emit = () => onChange([...all.values()]);
    const onEvent = (event: { type?: string; participants?: unknown; participant?: unknown; id?: unknown }) => {
      if (event.type === "snapshot") {
        all.clear();
        for (const p of parseList(event.participants)) all.set(p.id, p);
      } else if (event.type === "upsert") {
        const p = parseParticipant(event.participant);
        if (p) all.set(p.id, p);
      } else if (event.type === "remove") {
        all.delete(asText(event.id));
      } else return;
      emit();
    };
    return openStream({
      url: `/api/stream/participants/${encodeURIComponent(sessionId)}`,
      onEvent,
      onError,
      poll: async () => onEvent({ type: "snapshot", participants: await api("GET", `${base(sessionId)}/participants`) }),
    });
  },
};
