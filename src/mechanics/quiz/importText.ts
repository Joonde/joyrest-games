import { LIMITS, newQuestion, parseRound, type QuizQuestion } from "./content";
import { validateQuestion } from "./validate";
import { markedText, parseNumberText, parseOption, splitAnswers, splitLines, stripBold } from "./listText";

export { markedText, parseNumberText, parseOption, splitAnswers, splitLines, stripBold };

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

/** Нумерация в начале вопроса: «1.», «2)», «Вопрос 3:», «#4», «№ 5.». */
const NUMBERING = /^\s*(?:(?:вопрос|#|№)\s*\d{1,3}\s*[.):]?|\d{1,3}\s*[.):])\s*/i;

/** Вариант с буквой или цифрой: «а) Москва», «Б. Питер», «1) Казань», «2. Самара». */
const LISTED = /^(\*\s*)?([a-zа-яё]|\d{1,2})\s*[).]\s+(.*)$/i;

type ListStyle = "letter" | "digit";

interface Draft {
  line: number;
  text: string;
  options: Array<{ text: string; correct: boolean }>;
  /** Как пронумерованы варианты: «а)» или «1.»; последний номер цифрой. */
  listStyle: ListStyle | null;
  lastDigit: number;
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

/** «#1 Какой город?», «#1. …», «# 2) …» — это номер вопроса, а не раунд. */
function isNumberedQuestion(line: string): boolean {
  if (/^#\d/.test(line)) return true;
  return /^#+\s*\d{1,3}\s*[.):]?\s+\S/.test(line) && /[?？]\s*$/.test(line);
}

/** Строку «а) …» / «1. …» считаем вариантом текущего вопроса, а не новым вопросом. */
function listedOption(line: string, current: Draft | null): { text: string; correct: boolean; style: ListStyle; n: number } | null {
  if (!current) return null;
  const match = LISTED.exec(line);
  if (!match) return null;
  const body = match[3] ?? "";
  // Вопрос обычно заканчивается «?» — «2. Какой город?» остаётся вопросом.
  if (/[?？]\s*\*?\s*$/.test(body)) return null;
  if (current.answers.length > 0 || current.cards.length > 0 || current.number) return null;
  const marker = match[2] ?? "";
  const style: ListStyle = /\d/.test(marker) ? "digit" : "letter";
  const n = style === "digit" ? Number(marker) : 0;
  if (current.listStyle && current.listStyle !== style) return null;
  if (style === "digit") {
    // Варианты цифрами идут с 1 подряд; «2.» без «1.» — следующий вопрос.
    const expected = current.listStyle === "digit" ? current.lastDigit + 1 : 1;
    if (n !== expected) return null;
  }
  const marked = markedText(body);
  return { text: marked.text, correct: Boolean(match[1]) || marked.correct, style, n };
}

function toQuestion(draft: Draft): ImportedQuestion {
  const problems: string[] = [];
  const hasOptions = draft.options.length > 0;
  const hasAnswers = draft.answers.length > 0;
  let question: QuizQuestion;

  if (draft.number) {
    question = { ...newQuestion("number"), number: draft.number.value, unit: draft.number.unit.slice(0, LIMITS.unit) };
    if (draft.number.value === null) problems.push("После «~» не нашли число — напишите его цифрами, например «~ 1665 ступеней».");
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
      correct: marked[0] ?? -1,
      // Несколько «*» — несколько верных вариантов: засчитывается любой.
      alsoCorrect: marked.slice(1),
    };
  }
  question.text = draft.text.slice(0, LIMITS.text);
  question.round = draft.round;
  if (draft.text.length > LIMITS.text) problems.push(`Вопрос длиннее ${LIMITS.text} символов — обрезан.`);

  for (const error of validateQuestion(question)) {
    const duplicate = problems.includes(error.message) || (draft.number?.value === null && error.path.endsWith("/number"));
    if (!duplicate && !((error.path.endsWith("/options") || error.path.endsWith("/correct")) && !hasOptions && !hasAnswers)) {
      problems.push(error.message);
    }
  }
  return { question, line: draft.line, problems };
}

/**
 * Разбор вопросов, вставленных списком: каждый вопрос с новой строки, варианты — с «-» (или «а)», «1.»),
 * верный помечен «*», открытый ответ — «= ответ1 | ответ2», карточки «по порядку» — «> …» в верном
 * порядке, число — «~ 1665 ступеней», раунд — «# Раунд: Кино» перед первым вопросом раунда.
 * Пустые строки не важны.
 */
export function parseImport(input: string): ImportResult {
  const drafts: Draft[] = [];
  const skipped: number[] = [];
  let current: Draft | null = null;
  let round: string | null = null;

  const startQuestion = (text: string, lineNo: number) => {
    current = {
      line: lineNo,
      text: text.replace(NUMBERING, "").trim(),
      options: [],
      listStyle: null,
      lastDigit: 0,
      answers: [],
      cards: [],
      number: null,
      round,
    };
    round = null;
    drafts.push(current);
  };

  splitLines(input).forEach((raw, index) => {
    const lineNo = index + 1;
    const original = raw.trim();
    if (!original) return;
    const bold = original.startsWith("**") || original.startsWith("__");
    const line = stripBold(original).trim();
    if (!line) return;

    if (line.startsWith("#") && !isNumberedQuestion(line)) {
      // Название раунда: «# Раунд 2: Кино». Без названия — «Раунд N».
      round = parseRound(line.replace(ROUND_LINE, "")) ?? `Раунд ${drafts.filter((d) => d.round !== null).length + 1}`;
      return;
    }

    if (line.startsWith("~") || line.startsWith("≈")) {
      if (!current) return skipped.push(lineNo);
      current.number = parseNumberText(line.slice(1));
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
      current.answers.push(...splitAnswers(line.slice(1)).map((a) => a.slice(0, LIMITS.answer)));
      return;
    }

    // «**Москва**» под вопросом — вариант (жирный — не пометка верного).
    if (bold && current !== null && !/[?？]\s*$/.test(line)) {
      const marked = markedText(line);
      if (marked.text) (current as Draft).options.push(marked);
      return;
    }

    const listed = listedOption(line, current);
    if (listed && current) {
      const draft: Draft = current;
      draft.listStyle = listed.style;
      if (listed.style === "digit") draft.lastDigit = listed.n;
      if (listed.text) draft.options.push({ text: listed.text, correct: listed.correct });
      return;
    }

    const option = bold ? null : parseOption(line);
    if (option) {
      if (!current) {
        // «— Как зовут кота?» в самом начале — это вопрос с тире, а не вариант.
        if (/[?？]\s*$/.test(option.text) && !option.correct) return startQuestion(option.text, lineNo);
        return skipped.push(lineNo);
      }
      if (option.text) current.options.push(option);
      return;
    }

    startQuestion(line, lineNo);
  });

  return { questions: drafts.slice(0, LIMITS.questions).map(toQuestion), skipped };
}
