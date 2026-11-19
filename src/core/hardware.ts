/**
 * Физические кнопки «кто первый». Аппаратные адаптеры передают только источник и событие;
 * допустимость шага проверяет сервер по свежему состоянию, чтобы нельзя было ответить на обычный
 * вопрос, чужой разыгрыш или клетку, для которой отсчёт ещё не запущен.
 */
import type { SessionState } from "../data/types";

export type HardwareSource = "bluetooth" | "usb";
export type AnswerSource = "phone" | HardwareSource;

export interface HardwareBinding {
  id: string;
  sessionId: string;
  participantId: string;
  source: HardwareSource;
  hardwareId: string;
  alias: string;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function quizBuzzStep(snapshot: unknown, step: number): boolean {
  const content = record(record(snapshot).content);
  const questions = Array.isArray(content.questions) ? content.questions : [];
  return record(questions[step]).kind === "buzz";
}

/** Может ли этот участник нажать физическую кнопку именно на текущем шаге. */
export function canHardwareBuzz(mechanic: string | null, snapshot: unknown, state: SessionState, participantId: string): boolean {
  if (state.phase !== "playing" || state.stage !== "question" || state.revealed) return false;
  const result = record(state.result);
  if (mechanic === "quiz") return quizBuzzStep(snapshot, state.step);
  if (mechanic === "board") {
    if (result.mode !== "buzz" || result.armed !== true) return false;
    // «Кот в мешке»: отвечает только участник, которому передали кота и который сделал ставку.
    if (result.catStep === true && record(result.bets)[participantId] !== undefined && typeof record(result.bets)[participantId] !== "number") return false;
    if (result.catStep === true && !(Number(record(result.bets)[participantId]) > 0)) return false;
    return true;
  }
  if (mechanic === "hundred") {
    return result.mode === "face" && result.armed === true && Array.isArray(result.pair) && result.pair.includes(participantId);
  }
  return false;
}
