// «Мероприятие из блоков» в студии: 1–5 игр по порядку (`src/core/program.ts`). В игре хранятся ссылки на
// игры (id) и запомненные название и механика — для списка; при запуске каждая игра копируется в снимок.
import { PROGRAM_LIMITS, type ProgramBlockRef } from "../../core/program";

export interface EveningContent {
  blocks: ProgramBlockRef[];
}

export function createEvening(): EveningContent {
  return { blocks: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseEvening(raw: unknown): EveningContent {
  const blocks = isRecord(raw) && Array.isArray(raw.blocks) ? raw.blocks : [];
  return {
    blocks: blocks
      .filter(isRecord)
      .filter((b) => typeof b.gameId === "string" && b.gameId.length > 0)
      .slice(0, PROGRAM_LIMITS.maxBlocks)
      .map((b) => ({
        gameId: String(b.gameId).slice(0, 64),
        title: typeof b.title === "string" ? b.title.slice(0, PROGRAM_LIMITS.title) : "",
        mechanic: typeof b.mechanic === "string" ? b.mechanic.slice(0, 40) : "",
      })),
  };
}

/** Игры, которые нельзя ставить блоком: сам вечер и игры со своим видом («Олимп» — целый вечер сам по себе). */
export const NOT_IN_EVENING = new Set(["evening", "olymp"]);
