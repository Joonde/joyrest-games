// «Своя игра»: поле категорий (строки) × стоимостей (колонки). В клетке — вопрос, трек, картинка
// или «Кот в мешке». Команда выбирает клетку, у всех кнопка «кто первый», ведущий решает «Верно» или
// «Неверно». Сыгранная клетка гаснет, пока не закроется всё поле.
import { clipFields, parseClip, type Clip } from "../../core/clip";

export type CellKind = "question" | "track" | "picture" | "cat";

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
}

export interface BoardContent {
  categories: BoardCategory[];
  /** Неверный ответ снимает стоимость клетки. */
  penalty: boolean;
  /** Сколько секунд на ставку в «Коте в мешке». */
  betTime: number;
}

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
};

/** Метка клетки на поле ведущего (гости её не видят). */
export const CELL_MARKS: Record<CellKind, string> = { question: "", track: "♪", picture: "фото", cat: "кот" };

function id(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return prefix + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

export function newCell(points: number): BoardCell {
  return { id: id("c"), points, kind: "question", text: "", answer: "", imageId: null, ...(clipFields({ ...parseClip({}) }) as Pick<BoardCell, "trackId" | "trackStart" | "trackLength" | "fadeIn" | "fadeOut" | "chorusStart" | "chorusLength" | "join" | "confetti">) };
}

/** Стоимость по умолчанию в колонке: 100, 200, 300… */
export function defaultPoints(column: number): number {
  return (column + 1) * 100;
}

export function newCategory(columns: number, title = ""): BoardCategory {
  return { id: id("k"), title, cells: Array.from({ length: columns }, (_, i) => newCell(defaultPoints(i))) };
}

export function createBoard(): BoardContent {
  return {
    categories: Array.from({ length: 4 }, (_, i) => newCategory(5, `Категория ${i + 1}`)),
    penalty: false,
    betTime: 30,
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

/** Поменять число строк или колонок: новые клетки — со стоимостью колонки, лишние убираются. */
export function resizeBoard(content: BoardContent, rows: number, cols: number): BoardContent {
  const r = Math.min(BOARD_LIMITS.maxRows, Math.max(BOARD_LIMITS.minRows, rows));
  const c = Math.min(BOARD_LIMITS.maxCols, Math.max(BOARD_LIMITS.minCols, cols));
  const categories = content.categories.slice(0, r).map((cat) => ({
    ...cat,
    cells: Array.from({ length: c }, (_, i) => cat.cells[i] ?? newCell(defaultPoints(i))),
  }));
  while (categories.length < r) categories.push(newCategory(c, `Категория ${categories.length + 1}`));
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
  const kind: CellKind = d.kind === "track" || d.kind === "picture" || d.kind === "cat" ? d.kind : "question";
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
  const cats = Array.isArray(d.categories) ? d.categories.slice(0, BOARD_LIMITS.maxRows) : [];
  return {
    categories: cats.map((c, i) => {
      const cd = rec(c);
      const cells = Array.isArray(cd.cells) ? cd.cells.slice(0, BOARD_LIMITS.maxCols) : [];
      return {
        id: typeof cd.id === "string" && ID.test(cd.id) ? cd.id : `k${i + 1}`,
        title: text(cd.title, BOARD_LIMITS.title),
        cells: cells.map((cell, col) => parseCell(cell, col, seen)),
      };
    }),
    penalty: d.penalty === true,
    betTime: int(d.betTime, 30, BOARD_LIMITS.minBetTime, BOARD_LIMITS.maxBetTime),
  };
}

export function boardMediaIds(content: BoardContent): string[] {
  return [...new Set(allCells(content).flatMap(({ cell }) => (cell.imageId ? [cell.imageId] : [])))];
}

export function boardTrackIds(content: BoardContent): string[] {
  return [...new Set(allCells(content).flatMap(({ cell }) => (cell.trackId ? [cell.trackId] : [])))];
}
