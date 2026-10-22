import { LIMITS, newQuestion, parseRound, type QuizQuestion } from "./content";
import { validateQuestion } from "./validate";
import { isQuestionHeader, listedOption, markedText, newListedRun, nextLines, parseNumberText, parseOption, QUESTION_NUMBERING, splitAnswers, splitLines, stripBold, type ListedRun } from "./listText";

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

const NUMBERING = QUESTION_NUMBERING;

interface Draft {
  line: number;
  text: string;
  options: Array<{ text: string; correct: boolean }>;
  /** Как пронумерованы варианты «а)» / «1.». */
  run: ListedRun;
  /** Есть варианты «- …», «* …» или «**…**»: строка «N. …» дальше — уже новый вопрос. */
  dashed: boolean;
  answers: string[];
  /** «> карточка» — «Расставь по порядку», карточки в верном порядке. */
  cards: string[];
  /** «~ 1665 ступеней» — «Угадай число». */
  number: { value: number | null; unit: string } | null;
  /** Перед вопросом была строка «# Раунд: …» — с него начинается раунд. */
  round: string | null;
}

/** «# Раунд: Кино», «# Кино», «#1 Раунд: Кино», «#2 Кино» → «Кино»; «#1 раунд» → без названия. */
const ROUND_LINE = /^#+\s*(?:\d{1,3}(?:\s*[.)]\s*|\s+))?(?:раунд(?:\s*\d+)?\s*[:.—-]?\s*)?/i;

/**
 * «#1 Какой город?», «#1. Назовите город?», «# 2) Город?» — номер вопроса, а не раунд: только с «?» в конце. Без «?»
 * («#1. Кино», «#2 Музыка») и со словом «раунд» («#1 раунд», «#1 Раунд: Кино») — раунд, как раньше.
 */
function isNumberedQuestion(line: string): boolean {
  if (/раунд/i.test(line)) return false;
  return /^#+\s*\d{1,3}\s*[.):]?\s*\S/.test(line) && /[?？]\s*$/.test(line);
}

/** У вопроса уже есть варианты «-», ответ, карточки или число — строка «N. …» дальше не вариант. */
function listRun(draft: Draft | null): ListedRun | null {
  if (!draft || draft.dashed || draft.answers.length > 0 || draft.cards.length > 0 || draft.number) return null;
  return draft.run;
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
  /** Была строка «Вопрос 1» без текста: следующая строка — текст этого вопроса. */
  let header = false;

  const startQuestion = (text: string, lineNo: number) => {
    current = {
      line: lineNo,
      text: text.replace(NUMBERING, "").trim(),
      options: [],
      run: newListedRun(),
      dashed: false,
      answers: [],
      cards: [],
      number: null,
      round,
    };
    round = null;
    drafts.push(current);
  };

  const lines = splitLines(input);
  const ahead = nextLines(lines);
  lines.forEach((raw, index) => {
    const lineNo = index + 1;
    const original = raw.trim();
    if (!original) return;
    const bold = original.startsWith("**") || original.startsWith("__");
    const line = stripBold(original).trim();
    if (!line) return;

    // «Вопрос 1» отдельной строкой — заголовок: текст вопроса — следующая строка (не пустой вопрос «Вопрос 1»).
    if (isQuestionHeader(line)) {
      header = true;
      return;
    }
    if (header) {
      header = false;
      if (!/^[-–—•*=~≈>#]/.test(line)) return startQuestion(line, lineNo);
    }

    if (line.startsWith("#") && !isNumberedQuestion(line)) {
      // Название раунда: «# Раунд 2: Кино». Без названия — «Раунд N».
      round = parseRound(line.replace(ROUND_LINE, "")) ?? `Раунд ${drafts.filter((d) => d.round !== null).length + 1}`;
      // Новый раунд — нумерация вопросов начинается заново: «1. …» после заголовка — вопрос, а не вариант.
      current = null;
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
      const draft: Draft = current;
      draft.dashed = true;
      if (marked.text) draft.options.push(marked);
      return;
    }

    const listed = listedOption(line, listRun(current), ahead[index]);
    if (listed && current) {
      const draft: Draft = current;
      if (listed.text) draft.options.push(listed);
      return;
    }

    const option = bold ? null : parseOption(line);
    if (option) {
      if (!current) {
        // «— Как зовут кота?» в самом начале — это вопрос с тире, а не вариант.
        if (/[?？]\s*$/.test(option.text) && !option.correct) return startQuestion(option.text, lineNo);
        return skipped.push(lineNo);
      }
      const draft: Draft = current;
      draft.dashed = true;
      if (option.text) draft.options.push(option);
      return;
    }

    startQuestion(line, lineNo);
  });

  return { questions: drafts.slice(0, LIMITS.questions).map(toQuestion), skipped };
}
