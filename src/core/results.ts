import type { GameResult, Leaderboard, ResultRow } from "../data/types";
import { sortedLeaderboard } from "./leaderboard";
import { formatDate } from "./format";

/** Таблица лидеров в компактном виде для истории: только имя, очки и цвет команды. */
export function compactBoard(leaderboard: Leaderboard): ResultRow[] {
  return sortedLeaderboard(leaderboard).map((entry) => {
    const row: ResultRow = { name: entry.name, score: entry.score };
    if (entry.colorIndex !== undefined) row.colorIndex = entry.colorIndex;
    if (entry.group !== undefined) row.group = entry.group;
    return row;
  });
}

/**
 * Места с учётом равных очков: 10, 10, 7 → 1, 1, 3. Строки одной группы (`group`: команды одного экипажа «Бубликатора») — одно
 * место и считаются за одного: экипаж 1200 из двух команд и экипаж 800 → 1, 1, 2.
 */
export function places(board: ResultRow[]): number[] {
  return groupPlaces(board.map((row, i) => ({ score: row.score, group: row.group ?? `#${i}` })));
}

/** Место = 1 + сколько разных групп набрали больше. Без групп — обычные общие места (10, 10, 7 → 1, 1, 3). */
export function groupPlaces(rows: ReadonlyArray<{ score: number; group: string }>): number[] {
  const higher = new Map<string, number>();
  for (const r of rows) higher.set(r.group, Math.max(higher.get(r.group) ?? -Infinity, r.score));
  const best = [...higher.entries()];
  return rows.map((row) => best.filter(([group, score]) => group !== row.group && score > row.score).length + 1);
}

/** Сколько строк итогов попадает в текст, чтобы сообщение не было бесконечным. */
export const SHARE_TEXT_ROWS = 20;

/** Итоги текстом для мессенджера. */
export function formatResultsText(result: GameResult, link?: string): string {
  const title = result.gameTitle || "Игра";
  const lines = [`Итоги игры «${title}»`];
  const meta = [
    result.playedAt ? formatDate(result.playedAt) : "",
    result.participantsCount > 0 ? participantsLabel(result.participantsCount) : "",
  ].filter(Boolean);
  if (meta.length > 0) lines.push(meta.join(" · "));
  lines.push("");
  const rows = result.board.slice(0, SHARE_TEXT_ROWS);
  const placeList = places(result.board);
  if (rows.length === 0) lines.push("Очков никто не набрал.");
  rows.forEach((row, i) => lines.push(`${placeList[i] ?? i + 1}. ${row.name} — ${pointsLabel(row.score)}`));
  if (result.board.length > rows.length) lines.push(`…и ещё ${result.board.length - rows.length}`);
  if (link) lines.push("", link);
  lines.push("", "JoyRest — радость без хлопот");
  return lines.join("\n");
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = Math.abs(n) % 10;
  const mod100 = Math.abs(n) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function pointsLabel(n: number): string {
  return `${n} ${plural(n, "очко", "очка", "очков")}`;
}

export function participantsLabel(n: number): string {
  return `${n} ${plural(n, "участник", "участника", "участников")}`;
}

export function questionsLabel(n: number): string {
  return `${n} ${plural(n, "вопрос", "вопроса", "вопросов")}`;
}
