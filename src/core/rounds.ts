// Раунды и табло (CLAUDE.md, раздел 6, «Раунды и табло»): общий для механик счёт раунда,
// стрелки движения в таблице и «лучший в раунде». Механика решает, где начинаются раунды;
// здесь — только арифметика над таблицей лидеров.
import type { Leaderboard, LeaderboardEntry } from "../data/types";
import { rankedLeaderboard } from "./leaderboard";

/** Очки за текущий раунд: сколько набрано с начала раунда. */
export function roundScore(entry: LeaderboardEntry): number {
  return entry.score - (entry.roundBase ?? 0);
}

/** Таблица раунда: та же таблица, но очки — только за раунд. */
export function roundLeaderboard(leaderboard: Leaderboard): Leaderboard {
  const board: Leaderboard = {};
  for (const [id, entry] of Object.entries(leaderboard)) board[id] = { ...entry, score: roundScore(entry), last: undefined };
  return board;
}

/** Новый раунд: запомнить очки на старте, чтобы считать очки раунда. Только изменённые записи. */
export function startRoundEntries(leaderboard: Leaderboard): Record<string, LeaderboardEntry> {
  const changes: Record<string, LeaderboardEntry> = {};
  for (const [id, entry] of Object.entries(leaderboard)) {
    if ((entry.roundBase ?? 0) !== entry.score) changes[id] = { ...entry, roundBase: entry.score };
  }
  return changes;
}

/** Места до и после: на сколько мест поднялся участник (+2 — на два вверх, −1 — на одно вниз). */
export function placeMoves(before: Leaderboard, after: Leaderboard): Map<string, number> {
  const was = new Map(rankedLeaderboard(before).map((e) => [e.id, e.place]));
  const moves = new Map<string, number>();
  for (const e of rankedLeaderboard(after)) {
    const old = was.get(e.id);
    moves.set(e.id, old === undefined ? 0 : old - e.place);
  }
  return moves;
}

/** Подпись стрелки: «↑2», «↓1» или пусто. */
export function moveLabel(move: number | undefined): string {
  if (!move) return "";
  return move > 0 ? `↑${move}` : `↓${-move}`;
}

/** Лучшие в раунде: больше всех очков за раунд (при равенстве — все), только если очки есть. */
export function bestInRound(leaderboard: Leaderboard): Set<string> {
  let best = 0;
  for (const entry of Object.values(leaderboard)) best = Math.max(best, roundScore(entry));
  if (best <= 0) return new Set();
  return new Set(Object.entries(leaderboard).filter(([, e]) => roundScore(e) === best).map(([id]) => id));
}
