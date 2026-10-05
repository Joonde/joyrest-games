import type { Session, SessionChange, SessionState } from "../data/types";

/** Состояние в начале игры: первый шаг, вопрос ещё не показан. */
export function startState(): SessionState {
  return { phase: "playing", step: 0, startedAt: null, revealed: false, stage: "ready", timeLimit: null, answered: 0, result: null };
}

/** Когда заканчивается время на ответ (по часам сервера); null — без ограничения или вопрос не открыт. */
export function answerDeadline(state: SessionState): number | null {
  if (state.stage !== "question" || state.startedAt === null || state.timeLimit === null) return null;
  return state.startedAt + state.timeLimit * 1000;
}

/** Сколько секунд осталось на ответ (целых, вверх); null — без таймера. */
export function secondsLeft(state: SessionState, serverNow: number): number | null {
  const deadline = answerDeadline(state);
  if (deadline === null) return null;
  return Math.max(0, Math.ceil((deadline - serverNow) / 1000));
}

/** Принимаются ли ответы сейчас (тот же смысл, что в firestore.rules, без запаса на сеть). */
export function acceptsAnswers(state: SessionState, serverNow: number): boolean {
  if (state.phase !== "playing" || state.stage !== "question" || state.revealed) return false;
  const deadline = answerDeadline(state);
  return deadline === null || serverNow <= deadline;
}

/** Применяет запись пульта к сессии в памяти: так работает «Репетиция» без сервера. */
export function applyChange(session: Session, change: SessionChange, now: number): Session {
  const { startedAt, ...rest } = change.state ?? {};
  const state: SessionState = { ...session.state, ...rest };
  if (startedAt !== undefined) state.startedAt = startedAt === "server" ? now : startedAt;
  const leaderboard = { ...session.leaderboard };
  for (const [pid, entry] of Object.entries(change.leaderboard ?? {})) {
    if (entry === null) delete leaderboard[pid];
    else leaderboard[pid] = entry;
  }
  return { ...session, state, leaderboard };
}
