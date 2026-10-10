import type { ChangeExpect, Leaderboard, Session, SessionChange, SessionState } from "../data/types";

/** Ручная правка очков за раз: от −100 000 до 100 000. */
export const MAX_SCORE_DELTA = 100_000;

/** JSON с ключами по алфавиту: порядок ключей в базе (jsonb) и в браузере разный. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    return `{${Object.keys(rec)
      .filter((k) => rec[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(rec[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Короткий отпечаток итогов шага (`state.result`) для `expect.result`. */
export function resultKey(result: unknown): string {
  const text = canonical(result ?? null);
  let a = 5381;
  let b = 52711;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = (Math.imul(a, 33) ^ c) >>> 0;
    b = (Math.imul(b, 31) + c) >>> 0;
  }
  return `${a.toString(36)}.${b.toString(36)}.${text.length.toString(36)}`;
}

/** Игра там, где её видел пульт? Без ожидания — да. */
export function meetsExpect(state: SessionState, expect: ChangeExpect | undefined): boolean {
  if (!expect) return true;
  if (expect.result !== undefined && resultKey(state.result) !== expect.result) return false;
  if (expect.phase !== undefined && state.phase !== expect.phase) return false;
  if (expect.step !== undefined && state.step !== expect.step) return false;
  if (expect.stage !== undefined && state.stage !== expect.stage) return false;
  return true;
}

/** Прибавка очков и переименование — только у тех, кто уже в таблице. */
export function adjustBoard(board: Leaderboard, addScore?: Record<string, number>, rename?: Record<string, string>): Leaderboard {
  const next = { ...board };
  for (const [pid, delta] of Object.entries(addScore ?? {})) {
    const entry = next[pid];
    if (entry && Number.isFinite(delta)) next[pid] = { ...entry, score: entry.score + delta };
  }
  for (const [pid, name] of Object.entries(rename ?? {})) {
    const entry = next[pid];
    if (entry && name) next[pid] = { ...entry, name };
  }
  return next;
}

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

/** Самое долгое время на ответ после продлений, секунды. */
export const MAX_TIME_LIMIT = 900;

/**
 * «+10 секунд» на пульте: продлить время открытого вопроса. Если время уже вышло — ответы снова
 * принимаются ещё `seconds` секунд с этой минуты (гости не успели). null — продлевать нечего
 * (вопрос не открыт, без таймера или дальше потолка).
 */
export function addTimeChange(state: SessionState, serverNow: number, seconds = 10): SessionChange | null {
  if (state.phase !== "playing" || state.stage !== "question" || state.revealed || state.startedAt === null || state.timeLimit === null) return null;
  const elapsed = Math.max(0, Math.ceil((serverNow - state.startedAt) / 1000));
  const next = Math.min(MAX_TIME_LIMIT, Math.max(state.timeLimit, elapsed) + seconds);
  if (next <= state.timeLimit) return null;
  return { state: { timeLimit: next }, expect: { phase: "playing", step: state.step, stage: "question" } };
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
  // Как на сервере: игра пошла дальше — таблица «посмотреть сейчас» уходит с экрана.
  if (!("peek" in rest) && (rest.step !== undefined || rest.stage !== undefined || rest.phase !== undefined)) state.peek = null;
  if (startedAt !== undefined) state.startedAt = startedAt === "server" ? now : startedAt;
  const board = { ...session.leaderboard };
  for (const [pid, entry] of Object.entries(change.leaderboard ?? {})) {
    if (entry === null) delete board[pid];
    else board[pid] = entry;
  }
  return { ...session, state, leaderboard: adjustBoard(board, change.addScore, change.rename) };
}
