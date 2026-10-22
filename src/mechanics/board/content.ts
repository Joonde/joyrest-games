// «Ставка на знания»: поле категорий (строки) × стоимостей (колонки). В клетке — вопрос, трек, картинка,
// «Кот в мешке» или «Аукцион». Команда выбирает клетку, у всех кнопка «кто первый», ведущий решает
// «Верно» или «Неверно». Сыгранная клетка гаснет, пока не закроется всё поле раунда. Раундов 1–3
// (решение владельца 11 октября 2026: как в передаче, минимум два): у каждой категории свой `round`,
// поле раунда — его категории; во втором раунде стоимость по умолчанию вдвое выше.
import { clipFields, parseClip, type Clip } from "../../core/clip";
import { DEFAULT_BOARD_LOOK, parseShowLook, TABLE_LOOKS, type ShowLook } from "../showLook";

export type CellKind = "question" | "track" | "picture" | "cat" | "auction";

export interface BoardCell {
  id: string;
  points: number;
  kind: CellKind;
  /** Текст вопроса (у трека — подсказка «Угадайте песню»). */
  text: string;
  /** Правильный ответ — видит только ведущий. */
  answer: string;
  imageId: string | null;
  /** Трек клетки: угадывание, припев, звучание (`src/core/clip.ts`). */
  trackId: string | null;
  trackStart: number;
  trackLength: number;
  fadeIn: number;
  fadeOut: number;
  chorusStart: number | null;
  chorusLength: number;
  join: Clip["join"];
  confetti: boolean;
}

export interface BoardCategory {
  id: string;
  title: string;
  cells: BoardCell[];
  /** Раунд категории: 1–3. */
  round: number;
}

export const MAX_ROUNDS = 3;

export interface BoardContent {
  categories: BoardCategory[];
  /** Неверный ответ снимает стоимость клетки. */
  penalty: boolean;
  /** Сколько секунд на ставки в «Аукционе». */
  betTime: number;
  /** Сколько секунд жать кнопку после «Запустить отсчёт» (ведущий сначала читает вопрос). */
  buzzTime: number;
  /** Оформление экрана зала (`../showLook.ts`). Старые игры без поля — «Классика». */
  look: ShowLook;
}

/** Время на вопрос после «Запустить отсчёт» — выбор ведущего в конструкторе. */
export const BUZZ_TIMES = [5, 10, 15, 20, 30] as const;

export const BOARD_LIMITS = {
  minRows: 1,
  maxRows: 8,
  minCols: 1,
  maxCols: 8,
  title: 40,
  text: 300,
  answer: 120,
  minPoints: 0,
  maxPoints: 5000,
  minBetTime: 10,
  maxBetTime: 120,
} as const;

export const CELL_TITLES: Record<CellKind, string> = {
  question: "Вопрос",
  track: "Трек",
  picture: "Картинка",
  cat: "Кот в мешке",
  auction: "Аукцион",
};

/** Метка клетки на поле ведущего (гости её не видят). */
export const CELL_MARKS: Record<CellKind, string> = { question: "", track: "♪", picture: "фото", cat: "кот", auction: "аукц." };

function id(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return prefix + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

export function newCell(points: number): BoardCell {
  return { id: id("c"), points, kind: "question", text: "", answer: "", imageId: null, ...(clipFields({ ...parseClip({}) }) as Pick<BoardCell, "trackId" | "trackStart" | "trackLength" | "fadeIn" | "fadeOut" | "chorusStart" | "chorusLength" | "join" | "confetti">) };
}

/** Стоимость по умолчанию в колонке: 100, 200, 300… (во втором раунде — 200, 400…, в третьем — 300…). */
export function defaultPoints(column: number, round = 1): number {
  return (column + 1) * 100 * Math.max(1, round);
}

export function newCategory(columns: number, title = "", round = 1): BoardCategory {
  return { id: id("k"), title, round, cells: Array.from({ length: columns }, (_, i) => newCell(defaultPoints(i, round))) };
}

/** Сколько раундов в игре. */
export function roundsOf(content: BoardContent): number {
  return Math.max(1, ...content.categories.map((c) => c.round));
}

/** Категории раунда по порядку. */
export function roundCategories(content: BoardContent, round: number): BoardCategory[] {
  return content.categories.filter((c) => c.round === round);
}

/**
 * Поменять число раундов: новые раунды — того же размера, что первый, с удвоенной (утроенной) стоимостью;
 * лишние раунды убираются.
 */
export function setRounds(content: BoardContent, rounds: number): BoardContent {
  const n = Math.min(MAX_ROUNDS, Math.max(1, rounds));
  const first = roundCategories(content, 1);
  const rows = Math.max(1, first.length);
  const cols = Math.max(1, ...first.map((c) => c.cells.length));
  const categories = content.categories.filter((c) => c.round <= n);
  for (let r = 2; r <= n; r++) {
    if (categories.some((c) => c.round === r)) continue;
    for (let i = 0; i < rows; i++) categories.push(newCategory(cols, `Категория ${i + 1}`, r));
  }
  return { ...content, categories };
}

export function createBoard(): BoardContent {
  return {
    // Как в передаче — два раунда; второй дороже.
    categories: [1, 2].flatMap((round) => Array.from({ length: 4 }, (_, i) => newCategory(5, `Категория ${i + 1}`, round))),
    penalty: false,
    betTime: 30,
    buzzTime: 15,
    look: DEFAULT_BOARD_LOOK,
  };
}

export function columnsOf(content: BoardContent): number {
  return Math.max(0, ...content.categories.map((c) => c.cells.length));
}

/** Все клетки поля по порядку: строка за строкой. */
export function allCells(content: BoardContent): Array<{ cell: BoardCell; category: BoardCategory; row: number; col: number }> {
  return content.categories.flatMap((category, row) => category.cells.map((cell, col) => ({ cell, category, row, col })));
}

export function findCell(content: BoardContent, cellId: string | null): { cell: BoardCell; category: BoardCategory } | null {
  if (!cellId) return null;
  for (const category of content.categories) {
    const cell = category.cells.find((c) => c.id === cellId);
    if (cell) return { cell, category };
  }
  return null;
}

/** Поменять число строк (в каждом раунде) или колонок: новые клетки — со стоимостью колонки, лишние убираются. */
export function resizeBoard(content: BoardContent, rows: number, cols: number): BoardContent {
  const r = Math.min(BOARD_LIMITS.maxRows, Math.max(BOARD_LIMITS.minRows, rows));
  const c = Math.min(BOARD_LIMITS.maxCols, Math.max(BOARD_LIMITS.minCols, cols));
  const categories: BoardCategory[] = [];
  for (let round = 1; round <= roundsOf(content); round++) {
    const list = roundCategories(content, round)
      .slice(0, r)
      .map((cat) => ({ ...cat, cells: Array.from({ length: c }, (_, i) => cat.cells[i] ?? newCell(defaultPoints(i, round))) }));
    while (list.length < r) list.push(newCategory(c, `Категория ${list.length + 1}`, round));
    categories.push(...list);
  }
  return { ...content, categories };
}

// ---------- Разбор ----------

function rec(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

const ID = /^[A-Za-z0-9_-]{1,40}$/;

function parseCell(raw: unknown, col: number, seen: Set<string>): BoardCell {
  const d = rec(raw);
  let cellId = typeof d.id === "string" && ID.test(d.id) ? d.id : `c${seen.size + 1}`;
  while (seen.has(cellId)) cellId = `${cellId}_`;
  seen.add(cellId);
  const kind: CellKind = d.kind === "track" || d.kind === "picture" || d.kind === "cat" || d.kind === "auction" ? d.kind : "question";
  return {
    id: cellId,
    points: int(d.points, defaultPoints(col), BOARD_LIMITS.minPoints, BOARD_LIMITS.maxPoints),
    kind,
    text: text(d.text, BOARD_LIMITS.text),
    answer: text(d.answer, BOARD_LIMITS.answer),
    imageId: typeof d.imageId === "string" && d.imageId.length > 0 ? d.imageId.slice(0, 64) : null,
    ...(clipFields(parseClip(d)) as Pick<BoardCell, "trackId" | "trackStart" | "trackLength" | "fadeIn" | "fadeOut" | "chorusStart" | "chorusLength" | "join" | "confetti">),
  };
}

/** Содержимое из базы → поле. Ничего не бросает. */
export function parseBoard(raw: unknown): BoardContent {
  const d = rec(raw);
  const seen = new Set<string>();
  const cats = Array.isArray(d.categories) ? d.categories.slice(0, BOARD_LIMITS.maxRows * MAX_ROUNDS) : [];
  return {
    categories: cats.map((c, i) => {
      const cd = rec(c);
      const cells = Array.isArray(cd.cells) ? cd.cells.slice(0, BOARD_LIMITS.maxCols) : [];
      return {
        id: typeof cd.id === "string" && ID.test(cd.id) ? cd.id : `k${i + 1}`,
        title: text(cd.title, BOARD_LIMITS.title),
        cells: cells.map((cell, col) => parseCell(cell, col, seen)),
        round: int(cd.round, 1, 1, MAX_ROUNDS),
      };
    }),
    penalty: d.penalty === true,
    betTime: int(d.betTime, 30, BOARD_LIMITS.minBetTime, BOARD_LIMITS.maxBetTime),
    buzzTime: (BUZZ_TIMES as readonly number[]).includes(d.buzzTime as number) ? (d.buzzTime as number) : 15,
    look: parseShowLook(d.look, TABLE_LOOKS),
  };
}

export function boardMediaIds(content: BoardContent): string[] {
  return [...new Set(allCells(content).flatMap(({ cell }) => (cell.imageId ? [cell.imageId] : [])))];
}

export function boardTrackIds(content: BoardContent): string[] {
  return [...new Set(allCells(content).flatMap(({ cell }) => (cell.trackId ? [cell.trackId] : [])))];
}
