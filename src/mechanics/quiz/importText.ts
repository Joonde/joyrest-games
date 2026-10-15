import { LIMITS, newQuestion, parseRound, type QuizQuestion } from "./content";
import { validateQuestion } from "./validate";

/** Пример формата: показывается прямо в окне импорта. */
export const IMPORT_EXAMPLE = `# Раунд: География
Какой город называют Северной столицей?
- Москва
* Санкт-Петербург
- Казань

Какие из этих городов на Волге?
* Казань
* Самара
- Пермь

Сколько свечей на торте у юбиляра?
= 30 | тридцать

Расставьте фильмы по году выхода
> Бриллиантовая рука
> Ирония судьбы
> Москва слезам не верит

Сколько ступеней на вершину Эйфелевой башни?
~ 1665 ступеней`;

export interface ImportedQuestion {
  question: QuizQuestion;
  /** Номер строки с текстом вопроса (с 1). */
  line: number;
  /** Что не так: вопрос добавится, но запустить игру можно будет после исправления. */
  problems: string[];
}

export interface ImportResult {
  questions: ImportedQuestion[];
  /** Строки, которые не удалось привязать к вопросу. */
  skipped: number[];
}

const NUMBERING = /^\s*(?:вопрос\s*)?\d{1,3}\s*[.)]\s*/i;

interface Draft {
  line: number;
  text: string;
  options: Array<{ text: string; correct: boolean }>;
  answers: string[];
  /** «> карточка» — «Расставь по порядку», карточки в верном порядке. */
  cards: string[];
  /** «~ 1665 ступеней» — «Угадай число». */
  number: { value: number | null; unit: string } | null;
  /** Перед вопросом была строка «# Раунд: …» — с него начинается раунд. */
  round: string | null;
}

/** «# Раунд: Кино», «# Кино» → «Кино». */
const ROUND_LINE = /^#+\s*(?:раунд(?:\s*\d+)?\s*[:.—-]?\s*)?/i;

/** Строка варианта: «- текст», «* текст» (верный), «-* текст» или «- текст *» (тоже верный). */
function parseOption(line: string): { text: string; correct: boolean } | null {
  const match = /^([-–—•*])\s*(\*)?\s*(.*)$/.exec(line);
  if (!match) return null;
  let text = (match[3] ?? "").trim();
  let correct = match[1] === "*" || match[2] === "*";
  if (text.endsWith("*")) {
    correct = true;
    text = text.slice(0, -1).trim();
  }
  return { text, correct };
}

function toQuestion(draft: Draft): ImportedQuestion {
  const problems: string[] = [];
  const hasOptions = draft.options.length > 0;
  const hasAnswers = draft.answers.length > 0;
  let question: QuizQuestion;

  if (draft.number) {
    question = { ...newQuestion("number"), number: draft.number.value, unit: draft.number.unit.slice(0, LIMITS.unit) };
    if (draft.number.value === null) problems.push("После «~» нужно число, например «~ 1665 ступеней».");
  } else if (draft.cards.length > 0) {
    question = { ...newQuestion("order"), options: draft.cards.slice(0, LIMITS.maxOptions).map((c) => c.slice(0, LIMITS.option)) };
    if (draft.cards.length > LIMITS.maxOptions) problems.push(`Больше ${LIMITS.maxOptions} карточек — лишние не добавлены.`);
  } else if (hasAnswers && !hasOptions) {
    question = { ...newQuestion("open"), answers: draft.answers.slice(0, LIMITS.answers) };
    if (draft.answers.length > LIMITS.answers) problems.push(`Больше ${LIMITS.answers} ответов — лишние не добавлены.`);
  } else {
    if (hasAnswers) problems.push("Есть и варианты, и открытый ответ — оставлены варианты.");
    const options = draft.options.slice(0, LIMITS.maxOptions);
    if (draft.options.length > LIMITS.maxOptions) {
      problems.push(`Больше ${LIMITS.maxOptions} вариантов — лишние не добавлены.`);
    }
    const marked = options.flatMap((o, i) => (o.correct ? [i] : []));
    if (!hasOptions) problems.push("Нет ни вариантов («-»), ни ответа («=»).");
    question = {
      ...newQuestion("choice"),
      options: options.length > 0 ? options.map((o) => o.text.slice(0, LIMITS.option)) : ["", ""],
      correct: hasOptions ? (marked[0] ?? -1) : 0,
      // Несколько «*» — несколько верных вариантов: засчитывается любой.
      alsoCorrect: marked.slice(1),
    };
  }
  question.text = draft.text.slice(0, LIMITS.text);
  question.round = draft.round;
  if (draft.text.length > LIMITS.text) problems.push(`Вопрос длиннее ${LIMITS.text} символов — обрезан.`);

  for (const error of validateQuestion(question)) {
    if (!problems.includes(error.message) && !(error.path.endsWith("/options") && !hasOptions && !hasAnswers)) {
      problems.push(error.message);
    }
  }
  return { question, line: draft.line, problems };
}

/**
 * Разбор вопросов, вставленных списком: каждый вопрос с новой строки, варианты — с «-»,
 * верный помечен «*», открытый ответ — «= ответ1 | ответ2», карточки «по порядку» — «> …» в верном
 * порядке, число — «~ 1665 ступеней», раунд — «# Раунд: Кино» перед первым вопросом раунда.
 * Пустые строки не важны.
 */
export function parseImport(input: string): ImportResult {
  const drafts: Draft[] = [];
  const skipped: number[] = [];
  let current: Draft | null = null;
  let round: string | null = null;

  input.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    const lineNo = index + 1;
    if (!line) return;

    if (line.startsWith("#")) {
      // Название раунда: «# Раунд 2: Кино». Без названия — «Раунд N».
      round = parseRound(line.replace(ROUND_LINE, "")) ?? `Раунд ${drafts.filter((d) => d.round !== null).length + 1}`;
      return;
    }

    if (line.startsWith("~") || line.startsWith("≈")) {
      if (!current) return skipped.push(lineNo);
      const match = /^[~≈]\s*(-?[\d\s\u00a0]+(?:[.,]\d+)?)\s*(.*)$/.exec(line);
      const value = match ? Number((match[1] ?? "").replace(/[\s\u00a0]/g, "").replace(",", ".")) : NaN;
      current.number = { value: Number.isFinite(value) ? value : null, unit: (match?.[2] ?? "").trim() };
      return;
    }

    if (line.startsWith(">")) {
      if (!current) return skipped.push(lineNo);
      const card = line.slice(1).trim();
      if (card) current.cards.push(card);
      return;
    }

    if (line.startsWith("=")) {
      if (!current) return skipped.push(lineNo);
      const answers = line
        .slice(1)
        .split("|")
        .map((a) => a.trim().slice(0, LIMITS.answer))
        .filter(Boolean);
      current.answers.push(...answers);
      return;
    }

    const option = parseOption(line);
    if (option) {
      if (!current) return skipped.push(lineNo);
      if (option.text) current.options.push(option);
      return;
    }

    current = { line: lineNo, text: line.replace(NUMBERING, "").trim(), options: [], answers: [], cards: [], number: null, round };
    round = null;
    drafts.push(current);
  });

  return { questions: drafts.slice(0, LIMITS.questions).map(toQuestion), skipped };
}
