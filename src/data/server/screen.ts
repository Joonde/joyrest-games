/** Экран зала сообщает пульту о себе: `/api/sessions/:id/screen` (CLAUDE.md, раздел 7, «Звуки»). */
import type { ScreenStatusRepository } from "../contracts";
import { parseScreenReport } from "../cues";
import { api, asRecord } from "./api";

export const serverScreenStatusRepository: ScreenStatusRepository = {
  async report(sessionId, report) {
    await api("POST", `/api/sessions/${encodeURIComponent(sessionId)}/screen`, report);
  },
  async get(sessionId) {
    const data = asRecord(await api("GET", `/api/sessions/${encodeURIComponent(sessionId)}/screen`));
    const screen = asRecord(data.screen);
    const report = parseScreenReport(screen);
    if (!report || typeof screen.seenAt !== "number") return null;
    return { ...report, seenAt: screen.seenAt };
  },
};
