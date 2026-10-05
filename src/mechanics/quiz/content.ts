// Формат содержимого квиза. Хранится в games/{id}.content и в снимке сессии.
// Картинок здесь нет — только imageId (документ games/{id}/media/{imageId}).

export type QuestionKind = "choice" | "open" | "speed";

export interface QuizQuestion {
  /** Постоянный id вопроса: ключ в списке и в путях ошибок. */
  id: string;
  kind: QuestionKind;
  text: string;
  /** Варианты для «выбора» и «на скорость». */
  options: string[];
  /** Номер правильного варианта; -1 — ещё не выбран. */
  correct: number;
  /** Верные ответы на открытый вопрос: подходит любой. */
  answers: string[];
  /** Время на ответ, секунды. */
  timeLimit: number;
  /** Очки за верный ответ (на скорость — максимум за самый быстрый). */
  points: number;
  imageId: string | null;
}

export interface QuizContent {
  questions: QuizQuestion[];
}

export const LIMITS = {
  questions: 100,
  text: 300,
  option: 100,
  minOptions: 2,
  maxOptions: 6,
  answers: 10,
  answer: 100,
  minTime: 5,
  maxTime: 300,
  minPoints: 1,
  maxPoints: 1000,
} as const;

export const DEFAULTS: Record<QuestionKind, { timeLimit: number; points: number }> = {
  choice: { timeLimit: 30, points: 100 },
  open: { timeLimit: 45, points: 100 },
  speed: { timeLimit: 15, points: 200 },
};

export const KIND_TITLES: Record<QuestionKind, string> = {
  choice: "Выбор варианта",
  open: "Открытый ответ",
  speed: "На скорость",
};

export const KIND_HINTS: Record<QuestionKind, string> = {
  choice: "От 2 до 6 вариантов, один верный.",
  open: "Гости пишут ответ сами. Регистр, ё/е, пробелы и знаки препинания не важны.",
  speed: "Варианты ответа; чем быстрее верный ответ, тем больше очков.",
};

export function newQuestionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "q" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

export function newQuestion(kind: QuestionKind = "choice"): QuizQuestion {
  return {
    id: newQuestionId(),
    kind,
    text: "",
    options: kind === "open" ? [] : ["", ""],
    correct: kind === "open" ? -1 : 0,
    answers: kind === "open" ? [""] : [],
    ...DEFAULTS[kind],
    imageId: null,
  };
}

export function createContent(): QuizContent {
  return { questions: [] };
}

/** Смена типа вопроса сохраняет всё, что можно сохранить. */
export function changeKind(question: QuizQuestion, kind: QuestionKind): QuizQuestion {
  if (question.kind === kind) return question;
  const next: QuizQuestion = { ...question, kind };
  if (kind !== "open" && next.options.length < LIMITS.minOptions) {
    next.options = [...next.options, "", ""].slice(0, Math.max(LIMITS.minOptions, next.options.length));
    if (next.correct < 0) next.correct = 0;
  }
  if (kind === "open" && next.answers.length === 0) {
    const fromOption = question.options[question.correct];
    next.answers = [fromOption ?? ""];
  }
  // Время и очки по умолчанию меняются, только если ведущий их не трогал.
  const before = DEFAULTS[question.kind];
  if (question.timeLimit === before.timeLimit) next.timeLimit = DEFAULTS[kind].timeLimit;
  if (question.points === before.points) next.points = DEFAULTS[kind].points;
  return next;
}

/** Копия вопроса с новым id; картинка общая (тот же imageId). */
export function duplicateQuestion(question: QuizQuestion): QuizQuestion {
  return { ...question, id: newQuestionId(), options: [...question.options], answers: [...question.answers] };
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

// ---------- Разбор сырого содержимого ----------

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function strings(value: unknown, maxItems: number, maxLength: number): string[] {
  return Array.isArray(value) ? value.slice(0, maxItems).map((v) => text(v, maxLength)) : [];
}

function parseKind(value: unknown): QuestionKind {
  return value === "open" || value === "speed" ? value : "choice";
}

function parseQuestion(raw: unknown, index: number, seen: Set<string>): QuizQuestion {
  const data = record(raw);
  const kind = parseKind(data.kind);
  let id = typeof data.id === "string" && data.id.length > 0 ? data.id.slice(0, 40) : `q${index + 1}`;
  // Ключи в списке должны быть уникальны даже в испорченных данных.
  while (seen.has(id)) id = `${id}_`;
  seen.add(id);
  const options = strings(data.options, LIMITS.maxOptions, LIMITS.option);
  const correct = typeof data.correct === "number" && Number.isInteger(data.correct) ? data.correct : -1;
  return {
    id,
    kind,
    text: text(data.text, LIMITS.text),
    options,
    correct: correct >= 0 && correct < options.length ? correct : -1,
    answers: strings(data.answers, LIMITS.answers, LIMITS.answer),
    timeLimit: int(data.timeLimit, DEFAULTS[kind].timeLimit, LIMITS.minTime, LIMITS.maxTime),
    points: int(data.points, DEFAULTS[kind].points, LIMITS.minPoints, LIMITS.maxPoints),
    imageId: typeof data.imageId === "string" && data.imageId.length > 0 ? data.imageId : null,
  };
}

/** Содержимое из базы → квиз. Ничего не бросает: мусор заменяется значениями по умолчанию. */
export function parseContent(raw: unknown): QuizContent {
  const data = record(raw);
  const list = Array.isArray(data.questions) ? data.questions.slice(0, LIMITS.questions) : [];
  const seen = new Set<string>();
  return { questions: list.map((q, i) => parseQuestion(q, i, seen)) };
}

export function mediaIds(content: QuizContent): string[] {
  return [...new Set(content.questions.flatMap((q) => (q.imageId ? [q.imageId] : [])))];
}
