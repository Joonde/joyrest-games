import { EMPTY_BUZZ, parseBuzz, type BuzzState } from "../../core/buzz";
import type { Answer } from "../../data/types";
import type { ScoreContext, ScoreDelta, Step } from "../types";
import { correctSet, type QuizContent, type QuizQuestion } from "./content";
import { normalizeAnswer } from "./normalize";

/** Шаг квиза — один вопрос. Показ, ответ и таблица — этапы шага (state.stage). */
export interface QuizStep extends Step {
  question: QuizQuestion;
}

export function steps(content: QuizContent): QuizStep[] {
  return content.questions.map((question) => ({ id: question.id, answerable: true, question }));
}

/**
 * Итоги шага в state.result: распределение ответов для экрана и открытые ответы,
 * которые ведущий засчитал вручную (опечатки). Видны экрану и телефонам.
 */
export interface QuizResult {
  /** Сколько гостей выбрали каждый вариант. */
  counts: number[];
  /** Сколько ответили верно. */
  correct: number;
  /** Сколько ответили всего. */
  total: number;
  /** Засчитанные ведущим открытые ответы (в нормализованном виде; у картинок — «номер:ответ»). */
  accepted: string[];
  /** Гонка: кнопка — порядок нажатий, у кого слово, «мимо», победитель. */
  buzz?: BuzzState;
  /** Несколько картинок: сколько угадали каждую. */
  right?: number[];
}

export function emptyResult(): QuizResult {
  return { counts: [], correct: 0, total: 0, accepted: [] };
}

/** Начальный итог шага: у гонки — пустая кнопка. */
export function startResult(q: QuizQuestion | undefined): QuizResult {
  return q?.kind === "buzz" ? { ...emptyResult(), buzz: EMPTY_BUZZ } : emptyResult();
}

export function parseResult(raw: unknown): QuizResult {
  if (typeof raw !== "object" || raw === null) return emptyResult();
  const r = raw as Record<string, unknown>;
  const nums = (v: unknown) => (Array.isArray(v) ? v.map((n) => (typeof n === "number" ? n : 0)) : []);
  const result: QuizResult = {
    counts: nums(r.counts),
    correct: typeof r.correct === "number" ? r.correct : 0,
    total: typeof r.total === "number" ? r.total : 0,
    accepted: Array.isArray(r.accepted) ? r.accepted.filter((a): a is string => typeof a === "string") : [],
  };
  if (r.buzz !== undefined) result.buzz = parseBuzz(r.buzz);
  if (Array.isArray(r.right)) result.right = nums(r.right);
  return result;
}

/** Совпадает ли текст с одним из верных ответов (или засчитан ведущим под этим ключом). */
function textMatches(answers: string[], value: unknown, accepted: string[], prefix = ""): boolean {
  if (typeof value !== "string") return false;
  const key = normalizeAnswer(value);
  return key.length > 0 && (answers.some((a) => normalizeAnswer(a) === key) || accepted.includes(prefix + key));
}

/** Несколько картинок: какие из ответов гостя верны (по номеру картинки). */
export function picturesRight(q: QuizQuestion, value: unknown, accepted: string[] = []): boolean[] {
  const list = Array.isArray(value) ? value : [];
  return (q.pictures ?? []).map((p, i) => textMatches(p.answers, list[i], accepted, `${i}:`));
}

/** Верен ли ответ: номер варианта или открытый ответ (в том числе засчитанный ведущим). */
export function isCorrect(question: QuizQuestion, value: unknown, accepted: string[] = []): boolean {
  if (question.kind === "open") return textMatches(question.answers, value, accepted);
  // Картинки: верно, если угаданы все (для «Верно!» на телефоне; очки — за каждую).
  if (question.kind === "pictures") {
    const right = picturesRight(question, value, accepted);
    return right.length > 0 && right.every(Boolean);
  }
  if (question.kind === "buzz") return false;
  return typeof value === "number" && correctSet(question).includes(value);
}

/** Время ответа по часам сервера; без отметки — как ответ в последнюю секунду. */
function answerTime(answer: Answer, startedAt: number | null, limitMs: number): number {
  if (answer.submittedAt === null || startedAt === null) return limitMs;
  return Math.min(limitMs, Math.max(0, answer.submittedAt - startedAt));
}

/**
 * Очки за шаг. Обычный вопрос: верный ответ — очки вопроса. На скорость: самый быстрый
 * верный ответ получает максимум, ответ в последнюю секунду — половину, между ними — по
 * прямой. Время ответа = submittedAt − startedAt, оба значения ставит сервер.
 */
export function score(step: QuizStep, answers: Answer[], { state }: ScoreContext): ScoreDelta[] {
  const q = step.question;
  const result = parseResult(state.result);
  const accepted = result.accepted;
  // Гонка: очки только тому, кому ведущий сказал «Верно».
  if (q.kind === "buzz") {
    const winner = (result.buzz ?? EMPTY_BUZZ).winner;
    return winner ? [{ pid: winner, delta: q.points }] : [];
  }
  // Картинки: доля очков за каждую угаданную.
  if (q.kind === "pictures") {
    const n = (q.pictures ?? []).length;
    if (n === 0) return [];
    return answers.flatMap((a) => {
      const k = picturesRight(q, a.value, accepted).filter(Boolean).length;
      return k > 0 ? [{ pid: a.pid, delta: Math.round((q.points * k) / n) }] : [];
    });
  }
  const right = answers.filter((a) => isCorrect(q, a.value, accepted));
  if (q.kind !== "speed") return right.map((a) => ({ pid: a.pid, delta: q.points }));

  const limitMs = (state.timeLimit ?? q.timeLimit) * 1000;
  const times = right.map((a) => answerTime(a, state.startedAt, limitMs));
  const fastest = Math.min(...times);
  return right.map((a, i) => {
    const t = times[i] ?? limitMs;
    const share = limitMs > fastest ? (t - fastest) / (limitMs - fastest) : 0;
    return { pid: a.pid, delta: Math.round(q.points * (1 - 0.5 * share)) };
  });
}

/** Распределение ответов для экрана зала. */
export function resultOf(q: QuizQuestion, answers: Answer[], accepted: string[], buzz?: BuzzState): QuizResult {
  if (q.kind === "buzz") {
    const b = buzz ?? EMPTY_BUZZ;
    return { counts: [], correct: b.winner ? 1 : 0, total: b.order.length, accepted, buzz: b };
  }
  if (q.kind === "pictures") {
    const per = answers.map((a) => picturesRight(q, a.value, accepted));
    const right = (q.pictures ?? []).map((_, i) => per.filter((r) => r[i]).length);
    return { counts: [], correct: per.filter((r) => r.length > 0 && r.every(Boolean)).length, total: answers.length, accepted, right };
  }
  const counts = q.kind === "open" ? [] : q.options.map((_, i) => answers.filter((a) => a.value === i).length);
  return {
    counts,
    correct: answers.filter((a) => isCorrect(q, a.value, accepted)).length,
    total: answers.length,
    accepted,
  };
}

export interface OpenAnswerGroup {
  /** Нормализованный ответ: ключ группы. */
  key: string;
  /** Как написал первый гость. */
  text: string;
  count: number;
  status: "correct" | "accepted" | "wrong";
}

/**
 * Уникальные открытые ответы гостей для пульта: одинаковые после нормализации
 * собираются в одну строку, частые — сверху.
 */
export function groupOpenAnswers(q: QuizQuestion, answers: Answer[], accepted: string[], picture?: number): OpenAnswerGroup[] {
  const groups = new Map<string, OpenAnswerGroup>();
  const source = picture === undefined ? q.answers : (q.pictures?.[picture]?.answers ?? []);
  const correct = new Set(source.map(normalizeAnswer));
  const prefix = picture === undefined ? "" : `${picture}:`;
  for (const a of answers) {
    const raw = picture === undefined ? a.value : Array.isArray(a.value) ? a.value[picture] : undefined;
    if (typeof raw !== "string") continue;
    const norm = normalizeAnswer(raw);
    const key = norm ? prefix + norm : "";
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.count++;
    else {
      const status = correct.has(norm) ? "correct" : accepted.includes(key) ? "accepted" : "wrong";
      groups.set(key, { key, text: raw.trim(), count: 1, status });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, "ru"));
}
