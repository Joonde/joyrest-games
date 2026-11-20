import type { DanceAttemptsRepository } from "../contracts";
import type { DanceAttemptSummary } from "../types";
import { api, asRecord } from "./api";

const text = (value: unknown) => (typeof value === "string" ? value : "");
const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

function parseAttempt(value: unknown): DanceAttemptSummary | null {
  const d = asRecord(value);
  const id = text(d.id);
  const sessionId = text(d.sessionId);
  const tileId = text(d.tileId);
  const songKey = text(d.songKey);
  if (!id || !sessionId || !tileId || !songKey) return null;
  return {
    id,
    sessionId,
    tileId,
    songKey,
    dancer: number(d.dancer),
    pid: text(d.pid),
    teamId: typeof d.teamId === "string" ? d.teamId : null,
    playerName: text(d.playerName),
    percent: number(d.percent),
    points: number(d.points),
    maxPoints: number(d.maxPoints),
    createdAt: number(d.createdAt),
  };
}

export const serverDanceAttemptsRepository: DanceAttemptsRepository = {
  async list(sessionId, tileId) {
    const data = asRecord(await api("GET", `/api/dance-attempts?sessionId=${encodeURIComponent(sessionId)}&tileId=${encodeURIComponent(tileId)}`));
    return (Array.isArray(data.attempts) ? data.attempts : []).map(parseAttempt).filter((attempt): attempt is DanceAttemptSummary => attempt !== null);
  },
};
