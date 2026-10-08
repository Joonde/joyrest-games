/** Итоги прошедших игр на своём сервере: по ссылке — без входа, списком — ведущему и admin. */
import type { ResultsRepository } from "../contracts";
import { errorCodeOf } from "../retry";
import type { GameResult, ResultRow } from "../types";
import { api, asRecord, asText } from "./api";

function parseBoard(value: unknown): ResultRow[] {
  return (Array.isArray(value) ? value : []).map((raw) => {
    const e = asRecord(raw);
    const row: ResultRow = { name: asText(e.name), score: typeof e.score === "number" ? e.score : 0 };
    if (typeof e.colorIndex === "number") row.colorIndex = e.colorIndex;
    return row;
  });
}

function parseResult(value: unknown): GameResult | null {
  const d = asRecord(value);
  const id = asText(d.id);
  if (!id) return null;
  return {
    id,
    hostId: asText(d.hostId),
    code: asText(d.code),
    gameTitle: asText(d.gameTitle),
    mechanic: typeof d.mechanic === "string" ? d.mechanic : null,
    themeId: asText(d.themeId) || "joyrest",
    playMode: d.playMode === "teams" ? "teams" : "solo",
    playedAt: typeof d.playedAt === "number" ? d.playedAt : null,
    participantsCount: typeof d.participantsCount === "number" ? d.participantsCount : 0,
    board: parseBoard(d.board),
    startedAt: typeof d.startedAt === "number" ? d.startedAt : null,
    finishedAt: typeof d.finishedAt === "number" ? d.finishedAt : null,
    breaksMs: typeof d.breaksMs === "number" && d.breaksMs > 0 ? d.breaksMs : 0,
    breaksCount: typeof d.breaksCount === "number" && d.breaksCount > 0 ? d.breaksCount : 0,
  };
}

export const serverResultsRepository: ResultsRepository = {
  async get(resultId) {
    try {
      return parseResult(await api("GET", `/api/results/${encodeURIComponent(resultId)}`));
    } catch (error) {
      if (errorCodeOf(error) === "not-found") return null;
      throw error;
    }
  },

  async listByHost(hostId) {
    const data = await api("GET", `/api/results?host=${encodeURIComponent(hostId)}`);
    return (Array.isArray(data) ? data : [])
      .map(parseResult)
      .filter((r): r is GameResult => r !== null)
      .sort((a, b) => (b.playedAt ?? 0) - (a.playedAt ?? 0));
  },
};
