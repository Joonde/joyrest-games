import type { Answer } from "../../data/types";
import type { ScoreContext, ScoreDelta, Step } from "../types";
import type { QuizContent, QuizQuestion } from "./content";
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
  /** Засчитанные ведущим открытые ответы (в нормализованном виде). */
  accepted: string[];
}

export function emptyResult(): QuizResult {
  return { counts: [], correct: 0, total: 0, accepted: [] };
}

export function parseResult(raw: unknown): QuizResult {
  if (typeof raw !== "object" || raw === null) return emptyResult();
  const r = raw as Record<string, unknown>;
  const nums = (v: unknown) => (Array.isArray(v) ? v.map((n) => (typeof n === "number" ? n : 0)) : []);
  return {
    counts: nums(r.counts),
    correct: typeof r.correct === "number" ? r.correct : 0,
    total: typeof r.total === "number" ? r.total : 0,
    accepted: Array.isArray(r.accepted) ? r.accepted.filter((a): a is string => typeof a === "string") : [],
  };
}

/** Верен ли ответ: номер варианта или открытый ответ (в том числе засчитанный ведущим). */
export function isCorrect(question: QuizQuestion, value: unknown, accepted: string[] = []): boolean {
  if (question.kind === "open") {
    if (typeof value !== "string") return false;
    const key = normalizeAnswer(value);
    return key.length > 0 && (question.answers.some((a) => normalizeAnswer(a) === key) || accepted.includes(key));
  }
  return typeof value === "number" && value === question.correct;
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
  const accepted = parseResult(state.result).accepted;
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
export function resultOf(q: QuizQuestion, answers: Answer[], accepted: string[]): QuizResult {
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
export function groupOpenAnswers(q: QuizQuestion, answers: Answer[], accepted: string[]): OpenAnswerGroup[] {
  const groups = new Map<string, OpenAnswerGroup>();
  const correct = new Set(q.answers.map(normalizeAnswer));
  for (const a of answers) {
    if (typeof a.value !== "string") continue;
    const key = normalizeAnswer(a.value);
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.count++;
    else {
      const status = correct.has(key) ? "correct" : accepted.includes(key) ? "accepted" : "wrong";
      groups.set(key, { key, text: a.value.trim(), count: 1, status });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, "ru"));
}
