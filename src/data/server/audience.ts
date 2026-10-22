/** «Помощь зала» по QR: `/api/sessions/:id/audience` (CLAUDE.md, раздел 6, «Миллион на кону»). */
import type { AudienceRepository } from "../contracts";
import { api, asRecord } from "./api";

export const serverAudienceRepository: AudienceRepository = {
  async vote(sessionId, step, choice) {
    const data = asRecord(await api("POST", `/api/sessions/${encodeURIComponent(sessionId)}/audience`, { step, vote: choice }));
    return data.result === "ok" ? "ok" : "rejected";
  },
  async counts(sessionId) {
    const data = asRecord(await api("GET", `/api/sessions/${encodeURIComponent(sessionId)}/audience`));
    const counts = Array.isArray(data.counts) ? data.counts.map((n) => (typeof n === "number" && n >= 0 ? Math.floor(n) : 0)).slice(0, 10) : [];
    return { step: typeof data.step === "number" ? data.step : null, counts };
  },
};
