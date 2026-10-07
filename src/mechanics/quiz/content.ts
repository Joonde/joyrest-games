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
  /** Ещё верные варианты (кроме `correct`): засчитывается любой из отмеченных. */
  alsoCorrect?: number[];
  /** Верные ответы на открытый вопрос: подходит любой. */
  answers: string[];
  /** Время на ответ, секунды. */
  timeLimit: number;
  /** Очки за верный ответ (на скорость — максимум за самый быстрый). */
  points: number;
  imageId: string | null;
  /** С этого вопроса начинается раунд с таким названием; null — продолжается прежний. */
  round: string | null;
}

/** Как ведущий проводит квиз (настройки игры в конструкторе). */
export interface QuizSettings {
  /** Заставка «Вопрос 2 из 8» перед вопросом; false — «Следующий вопрос» сразу открывает вопрос. */
  intro: boolean;
  /**
   * Таблица после ответа: `each` — после каждого вопроса, `rounds` — только в конце раунда
   * (без раундов — только в конце игры), `manual` — по кнопке ведущего.
   */
  board: "each" | "rounds" | "manual";
  /** Картинка вопроса на телефонах гостей и при экране зала (без экрана — всегда). */
  phoneImages: boolean;
}

export const DEFAULT_SETTINGS: QuizSettings = { intro: true, board: "each", phoneImages: false };

export interface QuizContent {
  questions: QuizQuestion[];
  /** Нет — настройки по умолчанию (игры, созданные до настроек). */
  settings?: QuizSettings;
}

export function settingsOf(content: QuizContent): QuizSettings {
  return content.settings ?? DEFAULT_SETTINGS;
}

/** Все верные варианты вопроса с вариантами (по возрастанию). */
export function correctSet(q: Pick<QuizQuestion, "correct" | "alsoCorrect" | "options">): number[] {
  const all = new Set<number>([q.correct, ...(q.alsoCorrect ?? [])]);
  return [...all].filter((i) => i >= 0 && i < q.options.length).sort((a, b) => a - b);
}

/** Отметить или снять верный вариант: первый отмеченный — `correct`, остальные — `alsoCorrect`. */
export function toggleCorrect(q: QuizQuestion, index: number): QuizQuestion {
  const set = new Set(correctSet(q));
  if (set.has(index)) set.delete(index);
  else set.add(index);
  const sorted = [...set].sort((a, b) => a - b);
  return { ...q, correct: sorted[0] ?? -1, alsoCorrect: sorted.slice(1) };
}

/** Раунд квиза: вопросы с from по to включительно. */
export interface QuizRound {
  /** Номер раунда с 1. */
  number: number;
  /** Название; пусто — у первого раунда, если ведущий его не назвал. */
  title: string;
  from: number;
  to: number;
}

/**
 * Раунды квиза. Нет ни одного названия раунда — раундов нет (пустой список, игра как раньше).
 * Вопросы до первого названного раунда — безымянный первый раунд.
 */
export function quizRounds(content: QuizContent): QuizRound[] {
  const starts: Array<{ from: number; title: string }> = [];
  content.questions.forEach((q, i) => {
    if (q.round !== null) starts.push({ from: i, title: q.round });
  });
  if (starts.length === 0) return [];
  if (starts[0]?.from !== 0) starts.unshift({ from: 0, title: "" });
  return starts.map((start, i) => ({
    number: i + 1,
    title: start.title,
    from: start.from,
    to: (starts[i + 1]?.from ?? content.questions.length) - 1,
  }));
}

/** Раунд, в котором этот шаг; null — раундов нет. */
export function roundAt(content: QuizContent, step: number): QuizRound | null {
  return quizRounds(content).find((r) => step >= r.from && step <= r.to) ?? null;
}

/** «Раунд 2: Кино» или «Раунд 1». */
export function roundTitle(round: QuizRound): string {
  const plain = !round.title || /^раунд\s*\d*$/i.test(round.title);
  return plain ? `Раунд ${round.number}` : `Раунд ${round.number}: ${round.title}`;
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
  round: 60,
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
  choice: "От 2 до 6 вариантов, верных — один или несколько.",
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
    alsoCorrect: [],
    answers: kind === "open" ? [""] : [],
    ...DEFAULTS[kind],
    imageId: null,
    round: null,
  };
}

export function createContent(): QuizContent {
  return { questions: [], settings: { ...DEFAULT_SETTINGS } };
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
  // Копия продолжает раунд, а не начинает новый с тем же названием.
  return { ...question, id: newQuestionId(), options: [...question.options], alsoCorrect: [...(question.alsoCorrect ?? [])], answers: [...question.answers], round: null };
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

/** Название раунда: одна строка без управляющих символов; пусто — раунд не начинается. */
export function parseRound(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, LIMITS.round);
  return title.length > 0 ? title : null;
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
  const alsoCorrect = Array.isArray(data.alsoCorrect)
    ? [...new Set(data.alsoCorrect.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < options.length && i !== correct))].sort((a, b) => a - b)
    : [];
  return {
    id,
    kind,
    text: text(data.text, LIMITS.text),
    options,
    correct: correct >= 0 && correct < options.length ? correct : -1,
    alsoCorrect: kind === "open" ? [] : alsoCorrect,
    answers: strings(data.answers, LIMITS.answers, LIMITS.answer),
    timeLimit: int(data.timeLimit, DEFAULTS[kind].timeLimit, LIMITS.minTime, LIMITS.maxTime),
    points: int(data.points, DEFAULTS[kind].points, LIMITS.minPoints, LIMITS.maxPoints),
    imageId: typeof data.imageId === "string" && data.imageId.length > 0 ? data.imageId : null,
    round: parseRound(data.round),
  };
}

export function parseSettings(raw: unknown): QuizSettings {
  const data = record(raw);
  return {
    intro: data.intro !== false,
    board: data.board === "rounds" || data.board === "manual" ? data.board : "each",
    phoneImages: data.phoneImages === true,
  };
}

/** Содержимое из базы → квиз. Ничего не бросает: мусор заменяется значениями по умолчанию. */
export function parseContent(raw: unknown): QuizContent {
  const data = record(raw);
  const list = Array.isArray(data.questions) ? data.questions.slice(0, LIMITS.questions) : [];
  const seen = new Set<string>();
  return { questions: list.map((q, i) => parseQuestion(q, i, seen)), settings: parseSettings(data.settings) };
}

export function mediaIds(content: QuizContent): string[] {
  return [...new Set(content.questions.flatMap((q) => (q.imageId ? [q.imageId] : [])))];
}
