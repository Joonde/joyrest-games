import type { Answer } from "../../data/types";
import type { ScoreDelta, Step } from "../types";
import type { QuizContent, QuizQuestion } from "./content";
import { matchesAnswer } from "./normalize";

/** Шаг квиза — один вопрос. Показ ответа и таблица — состояние шага (state.revealed). */
export interface QuizStep extends Step {
  question: QuizQuestion;
}

export function steps(content: QuizContent): QuizStep[] {
  return content.questions.map((question) => ({ id: question.id, answerable: true, question }));
}

/** Верен ли ответ гостя: номер варианта или текст открытого ответа. */
export function isCorrect(question: QuizQuestion, value: unknown): boolean {
  if (question.kind === "open") return typeof value === "string" && matchesAnswer(value, question.answers);
  return typeof value === "number" && value === question.correct;
}

/**
 * Очки за шаг: верный ответ — очки вопроса. Начисление за скорость по времени ответа
 * (submittedAt − state.startedAt) добавит этап 4 вместе с пультом.
 */
export function score(step: QuizStep, answers: Answer[]): ScoreDelta[] {
  return answers
    .filter((a) => isCorrect(step.question, a.value))
    .map((a) => ({ pid: a.pid, delta: step.question.points }));
}
