/**
 * Скрытые названия команд и «Представить команды» (пульт): пока названия скрыты, экран зала и
 * чужие телефоны видят «Команда 1» и звёздочки подключённых телефонов; на представлении команды
 * открываются по одной в порядке подключения, дальше названия видны до конца игры.
 */
import type { LeaderboardEntry, SessionState, TeamsReveal } from "../data/types";

export interface OrderedTeam {
  id: string;
  entry: LeaderboardEntry;
  /** Номер команды по порядку подключения, с 1. */
  number: number;
}

/** Команды по порядку подключения (цвет выдаётся по порядку и больше не меняется). */
export function teamOrder(leaderboard: Record<string, LeaderboardEntry>): OrderedTeam[] {
  return Object.entries(leaderboard)
    .filter(([, e]) => e.kind === "team")
    .sort(([a, x], [b, y]) => (x.colorIndex ?? 999) - (y.colorIndex ?? 999) || a.localeCompare(b))
    .map(([id, entry], i) => ({ id, entry, number: i + 1 }));
}

/**
 * Скрыты ли названия: по умолчанию — да (решение владельца 11 октября 2026: интрига до «Представить
 * команды», чтобы зал посмеялся). Ведущий может открыть их галочкой на пульте.
 */
export function teamsReveal(state: Pick<SessionState, "teams">): TeamsReveal {
  return state.teams ?? { hidden: true, shown: null };
}

/** Название звёздочками: длина и пробелы видны, буквы — нет («✱✱✱✱ ✱✱✱»). */
export function maskedName(name: string): string {
  const letters = [...name.replace(/^\P{L}+/u, "").trim()];
  const masked = letters.map((ch) => (/\s/.test(ch) ? " " : "✱")).join("").replace(/ +/g, " ");
  return [...masked].slice(0, 18).join("") || "✱✱✱";
}

/**
 * Видно ли название команды. Скрыто — пока ведущий не открыл её на представлении (команды до
 * `shown` уже показаны) или не начал игру.
 */
export function teamNameVisible(state: Pick<SessionState, "teams" | "phase">, number: number): boolean {
  const reveal = teamsReveal(state);
  if (!reveal.hidden || state.phase !== "lobby") return true;
  return reveal.shown !== null && number <= reveal.shown + 1;
}

/** Как показывать команду всем: название или «Команда N». */
export function publicTeamName(state: Pick<SessionState, "teams" | "phase">, team: OrderedTeam): string {
  return teamNameVisible(state, team.number) ? team.entry.name : `Команда ${team.number}`;
}

/** Представление закончено: показаны все команды (на экране — общая табличка). */
export function presentationDone(state: Pick<SessionState, "teams">, total: number): boolean {
  const shown = teamsReveal(state).shown;
  return shown !== null && shown >= total;
}
