// «Активная настолка»: поле из 40–100 клеток на экране зала, фишки команд, кубик. В клетке —
// задание, вопрос, танец, караоке, бонус («+3»), ловушка («−2») или пропуск хода. Ведущий решает,
// выполнено ли задание.
import { clipFields, parseClip, type Clip } from "../../core/clip";

export type QuestKind = "task" | "question" | "dance" | "karaoke" | "bonus" | "trap" | "skip" | "empty";

export interface QuestCell {
  id: string;
  kind: QuestKind;
  /** Задание или вопрос. */
  text: string;
  /** Ответ на вопрос — видит ведущий. */
  answer: string;
  /** Очки за выполненное задание. */
  points: number;
  /** Бонус и ловушка: на сколько клеток вперёд (+) или назад (−). */
  move: number;
  /** Танец, караоке: ссылка на ролик (YouTube, VK, Rutube). */
  videoUrl: string;
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

export type QuestStyle = "classic" | "party" | "kids" | "adult";

export interface QuestContent {
  cells: QuestCell[];
  style: QuestStyle;
  /** Очки первой команде на финише. */
  finishPoints: number;
}

export const QUEST_LIMITS = { minCells: 40, maxCells: 100, text: 240, answer: 120, maxPoints: 1000, maxMove: 6, url: 500 } as const;

export const QUEST_TITLES: Record<QuestKind, string> = {
  task: "Задание",
  question: "Вопрос",
  dance: "Танец",
  karaoke: "Караоке",
  bonus: "Бонус",
  trap: "Ловушка",
  skip: "Пропуск хода",
  empty: "Пустая",
};

export const QUEST_EMOJI: Record<QuestKind, string> = { task: "⭐", question: "❓", dance: "💃", karaoke: "🎤", bonus: "🚀", trap: "🕳️", skip: "⏸️", empty: "" };

export const STYLE_TITLES: Record<QuestStyle, string> = { classic: "Классика", party: "Вечеринка", kids: "Детская", adult: "18+" };

function id(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "p" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

const CLIP = () => clipFields(parseClip({})) as Pick<QuestCell, "trackId" | "trackStart" | "trackLength" | "fadeIn" | "fadeOut" | "chorusStart" | "chorusLength" | "join" | "confetti">;

export function newQuestCell(kind: QuestKind = "task", text = ""): QuestCell {
  return { id: id(), kind, text, answer: "", points: kind === "task" || kind === "question" || kind === "dance" || kind === "karaoke" ? 50 : 0, move: kind === "bonus" ? 2 : kind === "trap" ? -2 : 0, videoUrl: "", ...CLIP() };
}

export function createQuest(): QuestContent {
  return { cells: Array.from({ length: QUEST_LIMITS.minCells }, (_, i) => newQuestCell(i % 5 === 4 ? "question" : "task")), style: "classic", finishPoints: 200 };
}

function rec(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const int = (v: unknown, def: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def);
const KINDS: QuestKind[] = ["task", "question", "dance", "karaoke", "bonus", "trap", "skip", "empty"];

export function parseQuest(raw: unknown): QuestContent {
  const d = rec(raw);
  const seen = new Set<string>();
  const cells = (Array.isArray(d.cells) ? d.cells : []).slice(0, QUEST_LIMITS.maxCells).map((item, i) => {
    const c = rec(item);
    let cid = typeof c.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(c.id) ? c.id : `p${i + 1}`;
    while (seen.has(cid)) cid += "_";
    seen.add(cid);
    const kind = KINDS.includes(c.kind as QuestKind) ? (c.kind as QuestKind) : "task";
    return {
      id: cid,
      kind,
      text: str(c.text, QUEST_LIMITS.text),
      answer: str(c.answer, QUEST_LIMITS.answer),
      points: int(c.points, 0, 0, QUEST_LIMITS.maxPoints),
      move: int(c.move, 0, -QUEST_LIMITS.maxMove, QUEST_LIMITS.maxMove),
      videoUrl: str(c.videoUrl, QUEST_LIMITS.url),
      ...(clipFields(parseClip(c)) as ReturnType<typeof CLIP>),
    };
  });
  const style: QuestStyle = d.style === "party" || d.style === "kids" || d.style === "adult" ? d.style : "classic";
  return { cells, style, finishPoints: int(d.finishPoints, 200, 0, QUEST_LIMITS.maxPoints) };
}

/** Поменять число клеток (40–100): новые — пустые задания в конце, лишние с конца убираются. */
export function resizeQuest(content: QuestContent, n: number): QuestContent {
  const size = Math.min(QUEST_LIMITS.maxCells, Math.max(QUEST_LIMITS.minCells, Math.round(n)));
  const cells = content.cells.slice(0, size);
  while (cells.length < size) cells.push(newQuestCell("task"));
  return { ...content, cells };
}

/**
 * «Заполнить из списка»: строка — клетка по порядку. «Вопрос: текст = ответ», «Танец: …»,
 * «Караоке: …», «+3» / «Бонус +3», «−2» / «Ловушка −2», «Пропуск», «Пусто», иначе — задание.
 * «… (50)» в конце — очки.
 */
export function parseQuestList(text: string): QuestCell[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, QUEST_LIMITS.maxCells)
    .map((line) => {
      const pts = line.match(/\((\d{1,4})\)\s*$/);
      const body = pts ? line.slice(0, pts.index).trim() : line;
      const points = pts ? Math.min(QUEST_LIMITS.maxPoints, Number(pts[1])) : undefined;
      const lower = body.toLowerCase();
      const move = body.match(/^(?:бонус|ловушка)?\s*([+\-−])\s*(\d)\b/i);
      let cell: QuestCell;
      if (move) {
        const n = Math.min(QUEST_LIMITS.maxMove, Number(move[2]));
        const back = move[1] !== "+";
        cell = { ...newQuestCell(back ? "trap" : "bonus"), move: back ? -n : n, text: body.replace(move[0], "").trim() };
      } else if (/^пропуск/.test(lower)) cell = { ...newQuestCell("skip"), text: body.replace(/^пропуск(\s*хода)?[:.\s]*/i, "") };
      else if (/^пуст/.test(lower)) cell = newQuestCell("empty");
      else if (/^вопрос\s*[:.]/.test(lower)) {
        const [q, a] = body.replace(/^вопрос\s*[:.]\s*/i, "").split("=");
        cell = { ...newQuestCell("question"), text: (q ?? "").trim().slice(0, QUEST_LIMITS.text), answer: (a ?? "").trim().slice(0, QUEST_LIMITS.answer) };
      } else if (/^танец\s*[:.]/.test(lower)) cell = { ...newQuestCell("dance"), text: body.replace(/^танец\s*[:.]\s*/i, "") };
      else if (/^караоке\s*[:.]/.test(lower)) cell = { ...newQuestCell("karaoke"), text: body.replace(/^караоке\s*[:.]\s*/i, "") };
      else cell = { ...newQuestCell("task"), text: body.replace(/^задание\s*[:.]\s*/i, "") };
      cell.text = cell.text.slice(0, QUEST_LIMITS.text);
      if (points !== undefined) cell.points = points;
      return cell;
    });
}

export function questTrackIds(content: QuestContent): string[] {
  return [...new Set(content.cells.flatMap((c) => (c.trackId ? [c.trackId] : [])))];
}
