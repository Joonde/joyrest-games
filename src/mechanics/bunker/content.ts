// «Бункер» — настройки игры. Правила — docs/bunker-rules.md и CLAUDE.md (раздел «Бункер»).
import { CATASTROPHES } from "./decks";

export interface BunkerContent {
  /** Раундов (по классике 5). */
  rounds: number;
  /** Речь игрока: первый раунд (профессия) и следующие, секунд. */
  firstSpeechSeconds: number;
  speechSeconds: number;
  /** Общее обсуждение перед голосованием. */
  discussSeconds: number;
  /** Голосование и оправдательная речь при ничьей. */
  voteSeconds: number;
  justifySeconds: number;
  /** Голос изгнанных: нет или один общий голос всех изгнанных (по большинству). */
  exiledVote: "none" | "common";
  /** Сколько раз за игру ведущий может пропустить голосование (изгнание переносится). */
  skipVotes: number;
  /** Особые условия: по карте каждому игроку. */
  specials: boolean;
  /** «Возрождение»: среди спасшихся должна быть пара мужчина и женщина 18–55 лет без бесплодия. */
  rebirth: boolean;
  /** «История выживания»: сколько угроз в финале (0 — без угроз). */
  threats: number;
  /** Катастрофа: номер или null — случайная. */
  catastrophe: number | null;
  /** Очки: каждому, кто пережил раунд, и каждому спасшемуся при победе бункера. */
  roundPoints: number;
  winPoints: number;
}

export const BUNKER_LIMITS = { minPlayers: 4, maxPlayers: 16, maxSeconds: 300, maxPoints: 1000, bunkerCards: 5 } as const;

export function createBunker(): BunkerContent {
  return {
    rounds: 5,
    firstSpeechSeconds: 60,
    speechSeconds: 30,
    discussSeconds: 60,
    voteSeconds: 30,
    justifySeconds: 30,
    exiledVote: "none",
    skipVotes: 1,
    specials: true,
    rebirth: false,
    threats: 2,
    catastrophe: null,
    roundPoints: 10,
    winPoints: 100,
  };
}

function rec(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function int(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
}

export function parseBunker(raw: unknown): BunkerContent {
  const d = rec(raw);
  const b = createBunker();
  return {
    rounds: int(d.rounds, b.rounds, 3, 7),
    firstSpeechSeconds: int(d.firstSpeechSeconds, b.firstSpeechSeconds, 10, BUNKER_LIMITS.maxSeconds),
    speechSeconds: int(d.speechSeconds, b.speechSeconds, 10, BUNKER_LIMITS.maxSeconds),
    discussSeconds: int(d.discussSeconds, b.discussSeconds, 0, 600),
    voteSeconds: int(d.voteSeconds, b.voteSeconds, 10, BUNKER_LIMITS.maxSeconds),
    justifySeconds: int(d.justifySeconds, b.justifySeconds, 10, BUNKER_LIMITS.maxSeconds),
    exiledVote: d.exiledVote === "common" ? "common" : "none",
    skipVotes: int(d.skipVotes, b.skipVotes, 0, 3),
    specials: typeof d.specials === "boolean" ? d.specials : b.specials,
    rebirth: typeof d.rebirth === "boolean" ? d.rebirth : b.rebirth,
    threats: int(d.threats, b.threats, 0, 3),
    catastrophe: typeof d.catastrophe === "number" && CATASTROPHES.some((c) => c.id === d.catastrophe) ? d.catastrophe : null,
    roundPoints: int(d.roundPoints, b.roundPoints, 0, BUNKER_LIMITS.maxPoints),
    winPoints: int(d.winPoints, b.winPoints, 0, BUNKER_LIMITS.maxPoints),
  };
}

/** Мест в бункере — половина игроков (округление вниз), как в таблице правил: 4 → 2, 5 → 2, 16 → 8. */
export function placesFor(players: number): number {
  return Math.max(1, Math.floor(players / 2));
}

/**
 * Сколько изгнать в этом раунде: оставшихся лишних делим на оставшиеся раунды, остаток — в последние
 * раунды (6 игроков: 0, 0, 1, 1, 1; 16: 1, 1, 2, 2, 2). `done` — уже изгнано в этом раунде; пропуск
 * голосования, «Лишняя койка» и «Обвал» пересчитывают план сами.
 */
export function quotaNow(round: number, rounds: number, alive: number, places: number, done: number): number {
  const left = Math.max(1, rounds - round + 1);
  const extra = alive + done - places;
  if (extra <= 0) return 0;
  const plan = round >= rounds ? extra : Math.floor(extra / left);
  return Math.max(0, plan - done);
}
