// Ход квиза на пульте: «Показать вопрос» → таймер → «Показать ответ» → «Таблица» →
// следующий вопрос, и «Назад» на шаг. Чистые функции: пульт отправляет результат в базу,
// «Репетиция» и симулятор применяют его в памяти.
import { leaderboardAdditions } from "../../core/leaderboard";
import type { Answer, LeaderboardEntry, Participant, Session, SessionChange } from "../../data/types";
import type { QuizContent } from "./content";
import { emptyResult, parseResult, resultOf, score, steps } from "./logic";

export type QuizAction = "show" | "reveal" | "board" | "next" | "finish";

/** Какое действие главное на этом этапе (одна главная кнопка пульта). */
export function primaryAction(session: Session, content: QuizContent): QuizAction {
  const { stage, step } = session.state;
  if (stage === "ready") return "show";
  if (stage === "question") return "reveal";
  if (stage === "reveal") return "board";
  return step >= content.questions.length - 1 ? "finish" : "next";
}

export const ACTION_LABELS: Record<QuizAction, string> = {
  show: "Показать вопрос",
  reveal: "Показать ответ",
  board: "Таблица",
  next: "Следующий вопрос",
  finish: "Завершить игру",
};

/** Открыть вопрос: время старта ставит сервер, с ним считается скорость. */
export function showQuestion(session: Session, content: QuizContent): SessionChange {
  const q = content.questions[session.state.step];
  return {
    state: {
      stage: "question",
      startedAt: "server",
      timeLimit: q?.timeLimit ?? null,
      revealed: false,
      answered: 0,
      result: emptyResult(),
    },
  };
}

/** Засчитать или снять открытый ответ гостя (до показа ответа). */
export function toggleAccepted(session: Session, key: string): SessionChange {
  const result = parseResult(session.state.result);
  const accepted = result.accepted.includes(key) ? result.accepted.filter((k) => k !== key) : [...result.accepted, key];
  return { state: { result: { ...result, accepted } } };
}

/**
 * Показать ответ: очки за шаг прибавляются к таблице, «last» хранит прибавку, чтобы
 * экран показал «+100», а «Назад» мог её снять. Участники, которых пульт ещё не успел
 * внести в таблицу, вносятся здесь же.
 */
export function reveal(
  session: Session,
  content: QuizContent,
  answers: Answer[],
  participants: Participant[],
): SessionChange {
  const step = steps(content)[session.state.step];
  if (!step) return {};
  const own = answers.filter((a) => a.step === session.state.step);
  const board: Record<string, LeaderboardEntry> = {
    ...session.leaderboard,
    ...leaderboardAdditions(session.leaderboard, participants, session.playMode),
  };
  const deltas = new Map(score(step, own, { state: session.state }).map((d) => [d.pid, d.delta]));
  const leaderboard: Record<string, LeaderboardEntry> = {};
  for (const [pid, entry] of Object.entries(board)) {
    const delta = deltas.get(pid) ?? 0;
    if (delta === 0 && (entry.last ?? 0) === 0 && session.leaderboard[pid]) continue;
    leaderboard[pid] = { ...entry, score: entry.score + delta, last: delta };
  }
  const accepted = parseResult(session.state.result).accepted;
  return {
    state: { stage: "reveal", revealed: true, answered: own.length, result: resultOf(step.question, own, accepted) },
    leaderboard,
  };
}

export function showBoard(): SessionChange {
  return { state: { stage: "board", revealed: true } };
}

/** Следующий вопрос: сначала «готовы?», вопрос показывает ведущий. */
export function nextQuestion(session: Session): SessionChange {
  return {
    state: {
      step: session.state.step + 1,
      stage: "ready",
      startedAt: null,
      timeLimit: null,
      revealed: false,
      answered: 0,
      result: null,
    },
  };
}

export interface BackPlan {
  change: SessionChange;
  /** Убрать ответы этого шага (вопрос закрыт до показа ответа). */
  clearAnswers?: number;
}

/** «Назад» на один этап. null — назад некуда (первый вопрос ещё не показан). */
export function back(session: Session): BackPlan | null {
  const { stage, step } = session.state;
  if (stage === "board") return { change: { state: { stage: "reveal", revealed: true } } };
  if (stage === "reveal") {
    // Снимаем очки этого шага: при повторном показе ответа они посчитаются заново.
    const leaderboard: Record<string, LeaderboardEntry> = {};
    for (const [pid, entry] of Object.entries(session.leaderboard)) {
      if (entry.last) leaderboard[pid] = { ...entry, score: entry.score - entry.last, last: 0 };
    }
    const result = parseResult(session.state.result);
    return {
      change: { state: { stage: "question", revealed: false, result: { ...emptyResult(), accepted: result.accepted } }, leaderboard },
    };
  }
  if (stage === "question") {
    return {
      change: { state: { stage: "ready", startedAt: null, timeLimit: null, revealed: false, answered: 0, result: null } },
      clearAnswers: step,
    };
  }
  if (step === 0) return null;
  // С «готовы?» — на таблицу предыдущего вопроса.
  return { change: { state: { step: step - 1, stage: "board", revealed: true, answered: 0, result: null } } };
}
