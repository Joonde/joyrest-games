import type { Answer, AnswersMark, ChangeExpect, Leaderboard, Session, SessionChange, SessionState } from "../data/types";

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
  if (expect.slide !== undefined && (state.slide?.id ?? null) !== expect.slide) return false;
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

/** Самое долгое время на ответ после продлений, пока таймер ещё идёт, секунды. */
export const MAX_TIME_LIMIT = 900;

/**
 * Потолок, когда время уже вышло и ведущий открывает ответы заново (12 часов): только чтобы число оставалось разумным.
 * Обычный потолок тут не действует — иначе после долгого перерыва при открытом вопросе кнопка не работала бы
 * (паспорт общей части, Н-4).
 */
export const MAX_REOPEN_LIMIT = 12 * 60 * 60;

/**
 * «+10 секунд» на пульте: продлить время открытого вопроса. Время ещё идёт — прибавляет `seconds`, но не дальше
 * `MAX_TIME_LIMIT`. Время уже вышло — ответы снова принимаются ещё `seconds` секунд с этой минуты (гости не успели),
 * сколько бы ни прошло с показа вопроса. null — продлевать нечего (вопрос не открыт, без таймера или таймер идёт и
 * упёрся в потолок).
 */
export function addTimeChange(state: SessionState, serverNow: number, seconds = 10): SessionChange | null {
  if (state.phase !== "playing" || state.stage !== "question" || state.revealed || state.startedAt === null || state.timeLimit === null) return null;
  const elapsed = Math.max(0, Math.ceil((serverNow - state.startedAt) / 1000));
  const expired = state.startedAt + state.timeLimit * 1000 <= serverNow;
  const next = expired ? Math.min(MAX_REOPEN_LIMIT, elapsed + seconds) : Math.min(MAX_TIME_LIMIT, state.timeLimit + seconds);
  // Продление должно дать время с этой минуты, иначе кнопка «сработает» впустую (потолок близко).
  if (next <= state.timeLimit || state.startedAt + next * 1000 <= serverNow) return null;
  return { state: { timeLimit: next }, expect: { phase: "playing", step: state.step, stage: "question" } };
}

/** Принимаются ли ответы сейчас (тот же смысл, что в firestore.rules, без запаса на сеть). */
export function acceptsAnswers(state: SessionState, serverNow: number): boolean {
  if (state.phase !== "playing" || state.stage !== "question" || state.revealed) return false;
  const deadline = answerDeadline(state);
  return deadline === null || serverNow <= deadline;
}

/** Открыт ли приём ответов на шаге (без учёта таймера). */
export function answersOpen(state: Pick<SessionState, "phase" | "step" | "stage" | "revealed">, step: number): boolean {
  return state.phase === "playing" && state.stage === "question" && !state.revealed && state.step === step;
}

/** Где окажется игра после записи пульта — только то, от чего зависит приём ответов. */
export function placeAfter(state: SessionState, change: SessionChange): Pick<SessionState, "phase" | "step" | "stage" | "revealed"> {
  const next = change.state ?? {};
  return {
    phase: next.phase ?? state.phase,
    step: next.step ?? state.step,
    stage: next.stage ?? state.stage,
    revealed: next.revealed ?? state.revealed,
  };
}

/** Запись закрывает приём ответов на шаге: сейчас он открыт, после записи — нет («Показать ответ», следующий шаг). */
export function closesAnswers(state: SessionState, change: SessionChange, step: number): boolean {
  return answersOpen(state, step) && !answersOpen(placeAfter(state, change), step);
}

/**
 * Отметка списка ответов шага, по которому пульт считает очки: сколько их и когда пришёл последний. Сервер пропустит
 * запись, закрывающую вопрос, только если на шаге те же ответы (`expect.answers`): ответ, пришедший, пока пульт считал,
 * не останется принятым, но не посчитанным (паспорт общей части, Н-1).
 */
export function answersMark(step: number, answers: readonly Pick<Answer, "step" | "submittedAt">[]): AnswersMark {
  const own = answers.filter((a) => a.step === step);
  let last: number | null = null;
  for (const a of own) if (a.submittedAt !== null && (last === null || a.submittedAt > last)) last = a.submittedAt;
  return { step, count: own.length, last };
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
