import { LIMITS, newQuestion, type QuizQuestion } from "./content";
import { validateQuestion } from "./validate";

/** Пример формата: показывается прямо в окне импорта. */
export const IMPORT_EXAMPLE = `Какой город называют Северной столицей?
- Москва
* Санкт-Петербург
- Казань

Сколько свечей на торте у юбиляра?
= 30 | тридцать`;

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
}

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

  if (hasAnswers && !hasOptions) {
    question = { ...newQuestion("open"), answers: draft.answers.slice(0, LIMITS.answers) };
    if (draft.answers.length > LIMITS.answers) problems.push(`Больше ${LIMITS.answers} ответов — лишние не добавлены.`);
  } else {
    if (hasAnswers) problems.push("Есть и варианты, и открытый ответ — оставлены варианты.");
    const options = draft.options.slice(0, LIMITS.maxOptions);
    if (draft.options.length > LIMITS.maxOptions) {
      problems.push(`Больше ${LIMITS.maxOptions} вариантов — лишние не добавлены.`);
    }
    const marked = options.flatMap((o, i) => (o.correct ? [i] : []));
    if (marked.length > 1) problems.push("Отмечено несколько верных вариантов — оставлен первый.");
    if (!hasOptions) problems.push("Нет ни вариантов («-»), ни ответа («=»).");
    question = {
      ...newQuestion("choice"),
      options: options.length > 0 ? options.map((o) => o.text.slice(0, LIMITS.option)) : ["", ""],
      correct: hasOptions ? (marked[0] ?? -1) : 0,
    };
  }
  question.text = draft.text.slice(0, LIMITS.text);
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
 * верный помечен «*», открытый ответ — «= ответ1 | ответ2». Пустые строки не важны.
 */
export function parseImport(input: string): ImportResult {
  const drafts: Draft[] = [];
  const skipped: number[] = [];
  let current: Draft | null = null;

  input.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    const lineNo = index + 1;
    if (!line) return;

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

    current = { line: lineNo, text: line.replace(NUMBERING, "").trim(), options: [], answers: [] };
    drafts.push(current);
  });

  return { questions: drafts.slice(0, LIMITS.questions).map(toQuestion), skipped };
}
