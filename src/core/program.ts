// Мероприятие из блоков (решение владельца 11 октября 2026): один код на весь вечер, 1–5 игр подряд.
// Гости входят один раз; «Завершить блок» на пульте — перерыв с победителями блока и общим счётом вечера,
// «Начать блок N» — экран и телефоны сами переключаются на следующую игру.
//
// Как устроено: у сессии есть `program` (сервер, jsonb). Во время блока у сессии механика и снимок этого
// блока, а в таблице — очки только этого блока (механики работают с таблицей «с нуля», как в обычной игре).
// Очки прошлых блоков — в `totals`. В перерыве и в финале механика сессии — `evening` (этот модуль даёт её
// содержимое), а в таблице — общий счёт вечера: по нему и пьедестал, и «История игр».
import type { Leaderboard, LeaderboardEntry } from "../data/types";
import { rankedLeaderboard } from "./leaderboard";

export const EVENING_MECHANIC = "evening";

/** `results` — строк в итогах блока: все участники, чтобы в конце вечера у каждого были очки по блокам. */
export const PROGRAM_LIMITS = { minBlocks: 1, maxBlocks: 5, title: 80, results: 200 } as const;

/** Блок вечера в студии: ссылка на игру и запомненные название и механика (для списка). */
export interface ProgramBlockRef {
  gameId: string;
  title: string;
  mechanic: string;
}

/** Блок вечера, который видят пульт, экран и телефоны (без снимка игры). */
export interface ProgramBlockInfo {
  title: string;
  mechanic: string;
}

export interface BlockResultRow {
  pid: string;
  name: string;
  score: number;
  colorIndex?: number;
}

export interface BlockResult {
  index: number;
  title: string;
  /** По убыванию очков блока, не больше `PROGRAM_LIMITS.results`. */
  board: BlockResultRow[];
}

/** Где вечер: идёт блок `index`, перерыв после блока `index` или финал. */
export type ProgramAt = "block" | "break" | "final";

/** Программа вечера у сессии — то, что получают браузеры. */
export interface SessionProgram {
  title: string;
  blocks: ProgramBlockInfo[];
  at: ProgramAt;
  index: number;
  results: BlockResult[];
  /** Очки вечера до текущего блока. */
  totals: Record<string, number>;
}

/** Программа на сервере: блоки со снимками игр. */
export interface StoredProgram extends SessionProgram {
  snapshots: unknown[];
}

/** Что просит пульт: закончить блок (перерыв), начать следующий, к итогам вечера. */
export type ProgramAction = "break" | "next" | "final";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseRow(value: unknown): BlockResultRow | null {
  if (!isRecord(value) || typeof value.pid !== "string") return null;
  const row: BlockResultRow = { pid: value.pid.slice(0, 64), name: text(value.name, 120), score: finite(value.score) };
  if (typeof value.colorIndex === "number" && Number.isInteger(value.colorIndex)) row.colorIndex = value.colorIndex;
  return row;
}

/** Программа из базы или из документа сессии; битая — null. Ничего не бросает. */
export function parseProgram(raw: unknown): SessionProgram | null {
  if (!isRecord(raw) || !Array.isArray(raw.blocks)) return null;
  const blocks = raw.blocks
    .filter(isRecord)
    .slice(0, PROGRAM_LIMITS.maxBlocks)
    .map((b) => ({ title: text(b.title, PROGRAM_LIMITS.title), mechanic: text(b.mechanic, 40) }));
  if (blocks.length === 0) return null;
  const at: ProgramAt = raw.at === "break" || raw.at === "final" ? raw.at : "block";
  const index = Math.min(Math.max(0, Math.floor(finite(raw.index))), blocks.length - 1);
  const results = (Array.isArray(raw.results) ? raw.results : [])
    .filter(isRecord)
    .slice(0, PROGRAM_LIMITS.maxBlocks)
    .map((r) => ({
      index: Math.floor(finite(r.index)),
      title: text(r.title, PROGRAM_LIMITS.title),
      board: (Array.isArray(r.board) ? r.board : []).map(parseRow).filter((x): x is BlockResultRow => x !== null).slice(0, PROGRAM_LIMITS.results),
    }));
  const totals: Record<string, number> = {};
  if (isRecord(raw.totals)) for (const [pid, v] of Object.entries(raw.totals)) totals[pid] = finite(v);
  return { title: text(raw.title, PROGRAM_LIMITS.title), blocks, at, index, results, totals };
}

/** Снимки игр блоков (только сервер). */
export function storedSnapshots(raw: unknown): unknown[] {
  return isRecord(raw) && Array.isArray(raw.snapshots) ? raw.snapshots : [];
}

/** Новая программа: вечер начинается с первого блока. */
export function newProgram(title: string, blocks: Array<ProgramBlockInfo & { snapshot: unknown }>): StoredProgram {
  return {
    title: title.slice(0, PROGRAM_LIMITS.title),
    blocks: blocks.slice(0, PROGRAM_LIMITS.maxBlocks).map((b) => ({ title: b.title.slice(0, PROGRAM_LIMITS.title), mechanic: b.mechanic })),
    snapshots: blocks.slice(0, PROGRAM_LIMITS.maxBlocks).map((b) => b.snapshot),
    at: "block",
    index: 0,
    results: [],
    totals: {},
  };
}

/** Очки вечера участника: прошлые блоки плюс текущая таблица (во время блока). */
export function eveningScore(program: SessionProgram, pid: string, entry: LeaderboardEntry | undefined): number {
  if (program.at !== "block") return entry?.score ?? 0;
  return (program.totals[pid] ?? 0) + (entry?.score ?? 0);
}

/** Итоговая таблица вечера: очки каждого по блокам и сумма (по убыванию суммы, места с учётом равных). */
export function eveningTable(program: SessionProgram, board: Leaderboard): Array<{ pid: string; name: string; colorIndex?: number; place: number; total: number; blocks: Array<number | null> }> {
  return rankedLeaderboard(board).map((e) => {
    const row: { pid: string; name: string; colorIndex?: number; place: number; total: number; blocks: Array<number | null> } = {
      pid: e.id,
      name: e.name,
      place: e.place,
      total: e.score,
      // null — блок не сыгран (вечер закончили раньше), 0 — играл без очков или пришёл позже.
      blocks: program.blocks.map((_, i) => {
        const result = program.results.find((r) => r.index === i);
        return result ? (result.board.find((r) => r.pid === e.id)?.score ?? 0) : null;
      }),
    };
    if (e.colorIndex !== undefined) row.colorIndex = e.colorIndex;
    return row;
  });
}

/** Победители блока (места с очками больше нуля, равные — вместе). */
export function blockWinners(result: BlockResult): BlockResultRow[] {
  const top = result.board[0];
  if (!top || top.score <= 0) return [];
  return result.board.filter((r) => r.score === top.score);
}

/** Следующий блок после перерыва; null — блоки кончились. */
export function nextBlockIndex(program: SessionProgram): number | null {
  if (program.at !== "break") return null;
  const next = program.index + 1;
  return next < program.blocks.length ? next : null;
}

function cleanEntry(entry: LeaderboardEntry, score: number): LeaderboardEntry {
  const next: LeaderboardEntry = { name: entry.name, kind: entry.kind, score };
  if (entry.colorIndex !== undefined) next.colorIndex = entry.colorIndex;
  if (entry.captainUid !== undefined) next.captainUid = entry.captainUid;
  return next;
}

export interface ProgramMove {
  program: StoredProgram;
  leaderboard: Leaderboard;
  /** Механика и снимок, которые станут у сессии. */
  mechanic: string;
  snapshot: unknown;
}

/**
 * Переход вечера. `break`: блок закончен — его итоги и очки в общий счёт, на экране перерыв с общим
 * счётом. `next`: из перерыва — следующий блок, таблица блока с нуля. `final`: итоги вечера (из блока —
 * сначала его итоги). Неподходящий переход (повтор, второй пульт) — null.
 */
export function moveProgram(stored: StoredProgram, board: Leaderboard, action: ProgramAction, from: number): ProgramMove | null {
  const program = stored;
  if (from !== program.index || program.at === "final") return null;
  const closeBlock = (): { results: BlockResult[]; totals: Record<string, number> } => {
    const rows = rankedLeaderboard(board).map((e) => {
      const row: BlockResultRow = { pid: e.id, name: e.name, score: e.score };
      if (e.colorIndex !== undefined) row.colorIndex = e.colorIndex;
      return row;
    });
    const totals = { ...program.totals };
    for (const [pid, entry] of Object.entries(board)) totals[pid] = (totals[pid] ?? 0) + entry.score;
    const results = [...program.results.filter((r) => r.index !== program.index), { index: program.index, title: program.blocks[program.index]?.title ?? "", board: rows.slice(0, PROGRAM_LIMITS.results) }];
    return { results, totals };
  };
  const totalsBoard = (totals: Record<string, number>): Leaderboard =>
    Object.fromEntries(Object.entries(board).map(([pid, entry]) => [pid, cleanEntry(entry, totals[pid] ?? 0)]));

  if (action === "break" || action === "final") {
    if (program.at === "block") {
      const { results, totals } = closeBlock();
      const last = program.index >= program.blocks.length - 1;
      const at: ProgramAt = action === "final" || last ? "final" : "break";
      const next: StoredProgram = { ...program, at, results, totals };
      return { program: next, leaderboard: totalsBoard(totals), mechanic: EVENING_MECHANIC, snapshot: eveningSnapshot(next) };
    }
    if (action === "final" && program.at === "break") {
      const next: StoredProgram = { ...program, at: "final" };
      return { program: next, leaderboard: totalsBoard(program.totals), mechanic: EVENING_MECHANIC, snapshot: eveningSnapshot(next) };
    }
    return null;
  }
  // action === "next"
  const target = nextBlockIndex(program);
  if (target === null) return null;
  const leaderboard: Leaderboard = Object.fromEntries(Object.entries(board).map(([pid, entry]) => [pid, cleanEntry(entry, 0)]));
  const next: StoredProgram = { ...program, at: "block", index: target };
  return { program: next, leaderboard, mechanic: program.blocks[target]?.mechanic ?? "", snapshot: stored.snapshots[target] ?? null };
}

/** Снимок для перерыва и финала: механика `evening` показывает программу из самой сессии. */
export function eveningSnapshot(program: SessionProgram): { title: string; mechanic: string; themeId: string; content: unknown } {
  return { title: program.title, mechanic: EVENING_MECHANIC, themeId: "", content: { title: program.title } };
}

/** Программа для браузера: без снимков игр. */
export function publicProgram(raw: unknown): SessionProgram | null {
  return parseProgram(raw);
}
