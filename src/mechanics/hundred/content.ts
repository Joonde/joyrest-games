// «Что скажет большинство»: игра ведётся раундами. Обычный раунд (простая, двойная, тройная игра, игра наоборот) — один
// вопрос с табло из 4–8 ответов, у каждого ответа очки — доля опрошенных (сумма не больше 100) и синонимы для
// ведущего. «Большая игра» — финал команды-лидера: 5 вопросов, два игрока по очереди на время.
// Очки ответов — либо оценка JoyRest (шаблоны библиотеки, `source: "estimate"` — НЕ опрос, так и подписываем),
// либо опрос гостей заранее (`source: "poll"`, `src/core/polls.ts`): проценты из числа ответивших.
import { DEFAULT_SHOW_LOOK, parseShowLook, TABLE_LOOKS, type ShowLook } from "../showLook";

export type RoundKind = "simple" | "double" | "triple" | "reverse" | "big";
/** classic — две команды у табло, кнопка «Жми первым!»; hall — «Весь зал»: все пишут до трёх ответов с телефона. */
export type HundredMode = "classic" | "hall";
export type AnswerSource = "estimate" | "poll";

export interface HundredAnswer {
  id: string;
  text: string;
  /** Очки — доля опрошенных, назвавших этот ответ (1–100). */
  points: number;
  /** Что ещё засчитать за этот ответ: «конверт», «деньги». */
  synonyms: string[];
}

export interface HundredQuestion {
  id: string;
  text: string;
  answers: HundredAnswer[];
  /** Откуда очки: оценка JoyRest (не опрос) или опрос гостей. */
  source: AnswerSource;
  /** Опрос: сколько человек ответили на этот вопрос. */
  pollCount: number;
}

export interface HundredRound {
  id: string;
  kind: RoundKind;
  /** Обычный раунд — один вопрос, «Большая игра» — пять. */
  questions: HundredQuestion[];
}

export interface HundredContent {
  mode: HundredMode;
  rounds: HundredRound[];
  /** Секунд жать «Жми первым!» после «Запустить отсчёт». */
  buzzTime: number;
  /** «Весь зал»: секунд на ответы с телефона. */
  hallTime: number;
  /** «Большая игра»: секунд первому и второму игроку. */
  bigTimes: [number, number];
  /** «Большая игра»: сколько очков набрать вдвоём. */
  bigGoal: number;
  /** «Большая игра»: бонус команде, если набрала `bigGoal`. */
  bigBonus: number;
  /** Оформление экрана зала (`../showLook.ts`). */
  look: ShowLook;
  /** Опрос гостей заранее (только свой сервер): id опроса. */
  pollId: string | null;
}

export const HUNDRED_LIMITS = {
  minAnswers: 4,
  maxAnswers: 8,
  defaultAnswers: 6,
  bigQuestions: 5,
  maxRounds: 10,
  question: 200,
  answer: 60,
  synonym: 40,
  synonyms: 12,
  maxPoints: 100,
  minBuzz: 5,
  maxBuzz: 30,
  minHall: 20,
  maxHall: 180,
  minBigTime: 10,
  maxBigTime: 90,
  maxGoal: 500,
  maxBonus: 2000,
  /** Ошибок в обычном раунде до «шанса» соперника. */
  strikes: 3,
  /** «Весь зал»: ответов с одного телефона. */
  hallWords: 3,
} as const;

export const ROUND_TITLES: Record<RoundKind, string> = {
  simple: "Простая игра",
  double: "Двойная игра",
  triple: "Тройная игра",
  reverse: "Игра наоборот",
  big: "Большая игра",
};

export const ROUND_KINDS: RoundKind[] = ["simple", "double", "triple", "reverse", "big"];

/** Множитель банка раунда. */
export function multiplierOf(kind: RoundKind): number {
  return kind === "double" ? 2 : kind === "triple" ? 3 : 1;
}

/** «Двойная игра · очки ×2», «Игра наоборот · редкие ответы дороже». */
export function roundLine(kind: RoundKind): string {
  if (kind === "reverse") return "Игра наоборот · редкие ответы дороже";
  if (kind === "big") return "Большая игра";
  const m = multiplierOf(kind);
  return m > 1 ? `${ROUND_TITLES[kind]} · очки ×${m}` : ROUND_TITLES[kind];
}

/**
 * «Игра наоборот» как в передаче: самый популярный ответ — 15 очков, дальше 30, 60, 120, 180, самый редкий — 240.
 * На табло меньше шести ответов — берём самые дорогие хвостом (редкий всегда 240), больше — дешевле в голове.
 */
export const REVERSE_POINTS = [5, 10, 15, 30, 60, 120, 180, 240] as const;

export function reversePoints(count: number, rank: number): number {
  const n = Math.max(1, Math.min(REVERSE_POINTS.length, count));
  return REVERSE_POINTS[REVERSE_POINTS.length - n + Math.max(0, Math.min(n - 1, rank))] ?? 0;
}

/** Ответы табло по местам: самые популярные сверху (при равных — как ввёл ведущий). */
export function ranked(question: HundredQuestion): HundredAnswer[] {
  return question.answers.map((a, i) => ({ a, i })).sort((x, y) => y.a.points - x.a.points || x.i - y.i).map(({ a }) => a);
}

/** Очки ответа в раунде (без множителя): в «Игре наоборот» — по месту снизу вверх. */
export function answerPoints(kind: RoundKind, question: HundredQuestion, answerId: string): number {
  const list = ranked(question);
  const rank = list.findIndex((a) => a.id === answerId);
  if (rank < 0) return 0;
  if (kind === "reverse") return reversePoints(list.length, rank);
  return list[rank]?.points ?? 0;
}

/** Строка источника под заголовком: опрос никогда не выдаём за настоящий, если его не было. */
export function sourceLine(question: HundredQuestion): string {
  if (question.source === "poll" && question.pollCount > 0) return `Опрос гостей · ${question.pollCount} ${people(question.pollCount)} · очки — в пересчёте на 100`;
  return "Оценка JoyRest, не опрос";
}

function people(n: number): string {
  const d10 = n % 10;
  const d100 = n % 100;
  return d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14) ? "человека" : "человек";
}

// ---------------------------------------------------------------- новые элементы

function id(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return prefix + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

export function newAnswer(text = "", points = 0, synonyms: string[] = []): HundredAnswer {
  return { id: id("a"), text, points, synonyms };
}

export function newQuestion(text = ""): HundredQuestion {
  return { id: id("q"), text, answers: Array.from({ length: HUNDRED_LIMITS.defaultAnswers }, () => newAnswer()), source: "estimate", pollCount: 0 };
}

export function newRound(kind: RoundKind): HundredRound {
  const count = kind === "big" ? HUNDRED_LIMITS.bigQuestions : 1;
  return { id: id("r"), kind, questions: Array.from({ length: count }, () => newQuestion()) };
}

export function createHundred(): HundredContent {
  return {
    mode: "classic",
    rounds: ROUND_KINDS.map((kind) => newRound(kind)),
    buzzTime: 10,
    hallTime: 60,
    bigTimes: [20, 25],
    bigGoal: 200,
    bigBonus: 100,
    look: DEFAULT_SHOW_LOOK,
    pollId: null,
  };
}

/** Все вопросы игры по порядку (с раундом). */
export function allQuestions(content: HundredContent): Array<{ round: HundredRound; roundIndex: number; question: HundredQuestion; q: number }> {
  return content.rounds.flatMap((round, roundIndex) => round.questions.map((question, q) => ({ round, roundIndex, question, q })));
}

export function findQuestion(content: HundredContent, questionId: string): HundredQuestion | null {
  return allQuestions(content).find((x) => x.question.id === questionId)?.question ?? null;
}

// ---------------------------------------------------------------- разбор

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

function uniqueId(raw: unknown, fallback: string, seen: Set<string>): string {
  let value = typeof raw === "string" && ID.test(raw) ? raw : fallback;
  while (seen.has(value)) value = `${value}_`;
  seen.add(value);
  return value;
}

function parseAnswer(raw: unknown, i: number, seen: Set<string>): HundredAnswer {
  const d = rec(raw);
  const synonyms = Array.isArray(d.synonyms)
    ? d.synonyms
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.trim().slice(0, HUNDRED_LIMITS.synonym))
        .filter(Boolean)
        .slice(0, HUNDRED_LIMITS.synonyms)
    : [];
  return { id: uniqueId(d.id, `a${i + 1}`, seen), text: text(d.text, HUNDRED_LIMITS.answer), points: int(d.points, 0, 0, HUNDRED_LIMITS.maxPoints), synonyms };
}

function parseQuestion(raw: unknown, i: number, seen: Set<string>): HundredQuestion {
  const d = rec(raw);
  const qid = uniqueId(d.id, `q${i + 1}`, seen);
  const answers = Array.isArray(d.answers) ? d.answers.slice(0, HUNDRED_LIMITS.maxAnswers).map((a, k) => parseAnswer(a, k, seen)) : [];
  return {
    id: qid,
    text: text(d.text, HUNDRED_LIMITS.question),
    answers,
    source: d.source === "poll" ? "poll" : "estimate",
    pollCount: int(d.pollCount, 0, 0, 100_000),
  };
}

function isKind(value: unknown): value is RoundKind {
  return typeof value === "string" && (ROUND_KINDS as string[]).includes(value);
}

/** Содержимое из базы → игра. Ничего не бросает: мусор заменяется значениями по умолчанию. */
export function parseHundred(raw: unknown): HundredContent {
  const d = rec(raw);
  const seen = new Set<string>();
  let qn = 0;
  const rounds = Array.isArray(d.rounds)
    ? d.rounds.slice(0, HUNDRED_LIMITS.maxRounds).map((r, i): HundredRound => {
        const rd = rec(r);
        const kind = isKind(rd.kind) ? rd.kind : "simple";
        const max = kind === "big" ? HUNDRED_LIMITS.bigQuestions : 1;
        const questions = Array.isArray(rd.questions) ? rd.questions.slice(0, max).map((q) => parseQuestion(q, qn++, seen)) : [];
        return { id: uniqueId(rd.id, `r${i + 1}`, seen), kind, questions };
      })
    : [];
  const times = Array.isArray(d.bigTimes) ? d.bigTimes : [];
  return {
    mode: d.mode === "hall" ? "hall" : "classic",
    rounds,
    buzzTime: int(d.buzzTime, 10, HUNDRED_LIMITS.minBuzz, HUNDRED_LIMITS.maxBuzz),
    hallTime: int(d.hallTime, 60, HUNDRED_LIMITS.minHall, HUNDRED_LIMITS.maxHall),
    bigTimes: [int(times[0], 20, HUNDRED_LIMITS.minBigTime, HUNDRED_LIMITS.maxBigTime), int(times[1], 25, HUNDRED_LIMITS.minBigTime, HUNDRED_LIMITS.maxBigTime)],
    bigGoal: int(d.bigGoal, 200, 1, HUNDRED_LIMITS.maxGoal),
    bigBonus: int(d.bigBonus, 100, 0, HUNDRED_LIMITS.maxBonus),
    look: parseShowLook(d.look, TABLE_LOOKS),
    pollId: typeof d.pollId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(d.pollId) ? d.pollId : null,
  };
}

// ---------------------------------------------------------------- импорт списком

/** Пример формата — показывается в окне импорта. */
export const IMPORT_EXAMPLE = `# Двойная игра
Что чаще всего дарят на свадьбу?
- Деньги в конверте = 39 | конверт, деньги
- Посуду = 14 | сервиз, тарелки
- Бытовую технику = 12 | технику, чайник, пылесос
- Постельное бельё = 10 | бельё
- Цветы = 8 | букет
- Путёвку = 5 | путешествие`;

export interface ImportedQuestion {
  question: HundredQuestion;
  /** Строка «# Двойная игра» перед вопросом — с него начинается раунд этого вида. */
  kind: RoundKind | null;
  line: number;
  problems: string[];
}

const KIND_WORDS: Array<[RegExp, RoundKind]> = [
  [/больш/i, "big"],
  [/наоборот|обратн/i, "reverse"],
  [/тройн/i, "triple"],
  [/двойн/i, "double"],
  [/прост/i, "simple"],
];

function kindOfHeader(line: string): RoundKind | null {
  for (const [re, kind] of KIND_WORDS) if (re.test(line)) return kind;
  return null;
}

/** «- Деньги в конверте = 39 | конверт, деньги» → ответ. */
function parseAnswerLine(line: string): { answer: HundredAnswer; problem: string | null } {
  const body = line.replace(/^[-–—•*]\s*/, "");
  const [main = "", syn = ""] = body.split("|");
  const m = /^(.*?)(?:=\s*(\d{1,3})\s*%?)?\s*$/.exec(main.trim());
  const answerText = (m?.[1] ?? main).trim().slice(0, HUNDRED_LIMITS.answer);
  const points = m?.[2] ? Math.min(HUNDRED_LIMITS.maxPoints, Number(m[2])) : 0;
  const synonyms = syn
    .split(/[,;]/)
    .map((s) => s.trim().slice(0, HUNDRED_LIMITS.synonym))
    .filter(Boolean)
    .slice(0, HUNDRED_LIMITS.synonyms);
  return { answer: newAnswer(answerText, points, synonyms), problem: points > 0 ? null : `«${answerText || "ответ"}»: нет очков — допишите «= 25»` };
}

/**
 * Вопрос — с новой строки, ответы — строками «- текст = очки | синоним, синоним». Строка «# Двойная игра»
 * перед вопросом задаёт вид раунда. Пустые строки — между вопросами, необязательны.
 */
export function importHundred(input: string): { questions: ImportedQuestion[]; skipped: number[] } {
  const questions: ImportedQuestion[] = [];
  const skipped: number[] = [];
  let pendingKind: RoundKind | null = null;
  let current: ImportedQuestion | null = null;
  input.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith("#")) {
      pendingKind = kindOfHeader(line);
      if (!pendingKind) skipped.push(i + 1);
      return;
    }
    if (/^[-–—•*]\s*/.test(line)) {
      if (!current) {
        skipped.push(i + 1);
        return;
      }
      if (current.question.answers.length >= HUNDRED_LIMITS.maxAnswers) {
        current.problems.push(`больше ${HUNDRED_LIMITS.maxAnswers} ответов — лишние не добавлены`);
        return;
      }
      const { answer, problem } = parseAnswerLine(line);
      current.question.answers.push(answer);
      if (problem) current.problems.push(problem);
      return;
    }
    const question: HundredQuestion = { ...newQuestion(line.replace(/^\d{1,3}\s*[.)]\s*/, "").slice(0, HUNDRED_LIMITS.question)), answers: [] };
    current = { question, kind: pendingKind, line: i + 1, problems: [] };
    pendingKind = null;
    questions.push(current);
  });
  for (const q of questions) {
    if (q.question.answers.length < HUNDRED_LIMITS.minAnswers) q.problems.push(`ответов меньше ${HUNDRED_LIMITS.minAnswers}`);
    const sum = q.question.answers.reduce((s, a) => s + a.points, 0);
    if (sum > 100) q.problems.push(`сумма очков ${sum} — больше 100`);
  }
  return { questions, skipped };
}

/** Порядок видов раундов, если заголовков нет: простая, двойная, тройная, наоборот, дальше — простые. */
const AUTO_KINDS: RoundKind[] = ["simple", "double", "triple", "reverse"];

/**
 * Импорт всей игры: «# Большая игра» собирает следующие вопросы (до пяти) в финал, остальные заголовки
 * начинают обычный раунд с одним вопросом. Без заголовков — простая, двойная, тройная, наоборот, дальше простые.
 */
export function roundsFromImport(list: ImportedQuestion[]): HundredRound[] {
  const rounds: HundredRound[] = [];
  let big: HundredRound | null = null;
  let auto = 0;
  for (const item of list) {
    const kind = item.kind ?? (big && big.questions.length < HUNDRED_LIMITS.bigQuestions ? "big" : null);
    if (kind === "big") {
      if (!big || item.kind === "big" || big.questions.length >= HUNDRED_LIMITS.bigQuestions) {
        big = { id: id("r"), kind: "big", questions: [] };
        rounds.push(big);
      }
      big.questions.push(item.question);
      continue;
    }
    big = null;
    const k: RoundKind = kind ?? AUTO_KINDS[auto] ?? "simple";
    auto++;
    rounds.push({ id: id("r"), kind: k, questions: [item.question] });
  }
  return rounds.slice(0, HUNDRED_LIMITS.maxRounds);
}
