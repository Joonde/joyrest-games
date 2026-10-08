// «Шашки»: противоборство двух команд. Ход получает команда, верно и быстрее ответившая на вопрос.

export type CheckersKind = "choice" | "open";

export interface CheckersQuestion {
  id: string;
  kind: CheckersKind;
  text: string;
  /** Варианты (choice): верный — `correct`. */
  options: string[];
  correct: number;
  /** Верные ответы (open): любой засчитывается. */
  answers: string[];
  imageId: string | null;
}

export interface CheckersContent {
  questions: CheckersQuestion[];
  /** Секунд на ответ. */
  timeLimit: number;
}

export const CHECKERS_LIMITS = {
  questions: 200,
  text: 300,
  option: 120,
  minOptions: 2,
  maxOptions: 4,
  answers: 6,
  minTime: 10,
  maxTime: 120,
} as const;

function id(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "q" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

export function newCheckersQuestion(kind: CheckersKind = "choice"): CheckersQuestion {
  return { id: id(), kind, text: "", options: kind === "choice" ? ["", ""] : [], correct: 0, answers: kind === "open" ? [""] : [], imageId: null };
}

export function createCheckers(): CheckersContent {
  return { questions: [newCheckersQuestion()], timeLimit: 30 };
}

function rec(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export function parseCheckers(raw: unknown): CheckersContent {
  const d = rec(raw);
  const seen = new Set<string>();
  const questions = (Array.isArray(d.questions) ? d.questions : []).slice(0, CHECKERS_LIMITS.questions).map((item, i) => {
    const q = rec(item);
    let qid = typeof q.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(q.id) ? q.id : `q${i + 1}`;
    while (seen.has(qid)) qid += "_";
    seen.add(qid);
    const kind: CheckersKind = q.kind === "open" ? "open" : "choice";
    const options = (Array.isArray(q.options) ? q.options : []).slice(0, CHECKERS_LIMITS.maxOptions).map((o) => str(o, CHECKERS_LIMITS.option));
    const correct = typeof q.correct === "number" && Number.isInteger(q.correct) && q.correct >= 0 && q.correct < Math.max(1, options.length) ? q.correct : 0;
    return {
      id: qid,
      kind,
      text: str(q.text, CHECKERS_LIMITS.text),
      options: kind === "choice" ? options : [],
      correct,
      answers: kind === "open" ? (Array.isArray(q.answers) ? q.answers : []).slice(0, CHECKERS_LIMITS.answers).map((a) => str(a, CHECKERS_LIMITS.option)) : [],
      imageId: typeof q.imageId === "string" && q.imageId ? q.imageId.slice(0, 64) : null,
    };
  });
  const t = typeof d.timeLimit === "number" && Number.isFinite(d.timeLimit) ? Math.round(d.timeLimit) : 30;
  return { questions, timeLimit: Math.min(CHECKERS_LIMITS.maxTime, Math.max(CHECKERS_LIMITS.minTime, t)) };
}

export function checkersMediaIds(content: CheckersContent): string[] {
  return [...new Set(content.questions.flatMap((q) => (q.imageId ? [q.imageId] : [])))];
}

/** Импорт списком, как в квизе: вопрос с новой строки, варианты с «-», верный с «*», открытый — «= ответ | ответ». */
export function parseCheckersList(text: string): CheckersQuestion[] {
  const out: CheckersQuestion[] = [];
  let current: CheckersQuestion | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[-*]/.test(line) && current) {
      const right = line.startsWith("*");
      current.kind = "choice";
      if (current.options.length < CHECKERS_LIMITS.maxOptions) {
        if (right) current.correct = current.options.length;
        current.options.push(line.replace(/^[-*]\s*/, "").slice(0, CHECKERS_LIMITS.option));
      }
    } else if (line.startsWith("=") && current) {
      current.kind = "open";
      current.options = [];
      current.answers = line
        .slice(1)
        .split("|")
        .map((a) => a.trim().slice(0, CHECKERS_LIMITS.option))
        .filter(Boolean)
        .slice(0, CHECKERS_LIMITS.answers);
    } else {
      current = { ...newCheckersQuestion(), options: [], text: line.slice(0, CHECKERS_LIMITS.text) };
      out.push(current);
    }
  }
  return out;
}
