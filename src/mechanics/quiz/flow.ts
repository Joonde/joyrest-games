// Ход квиза на пульте: «Показать вопрос» → таймер → «Показать ответ» → «Таблица» →
// следующий вопрос, и «Назад» на шаг. Чистые функции: пульт отправляет результат в базу,
// «Репетиция» и симулятор применяют его в памяти.
import { leaderboardAdditions } from "../../core/leaderboard";
import { hasPodium, podiumBack, podiumDone, podiumLabel } from "../../core/podium";
import { placeMoves, startRoundEntries } from "../../core/rounds";
import type { Answer, LeaderboardEntry, Participant, Session, SessionChange } from "../../data/types";
import { roundAt, type QuizContent } from "./content";
import { emptyResult, parseResult, resultOf, score, steps } from "./logic";

export type QuizAction = "show" | "reveal" | "board" | "total" | "next" | "podium" | "podiumNext" | "finish";

/** Какое табло на экране после шага: обычное, итоги раунда или общий счёт после раунда. */
export type BoardView = "plain" | "round" | "total";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function boardView(session: Pick<Session, "state">): BoardView {
  const view = asRecord(session.state.result).board;
  return view === "round" || view === "total" ? view : "plain";
}

/** Шаг закрывает раунд (раунды есть, это его последний вопрос). */
export function endsRound(content: QuizContent, step: number): boolean {
  return roundAt(content, step)?.to === step;
}

/** С этого шага начинается раунд (кроме первого раунда игры). */
export function startsRound(content: QuizContent, step: number): boolean {
  return step > 0 && roundAt(content, step)?.from === step;
}

/** Какое действие главное на этом этапе (одна главная кнопка пульта). */
export function primaryAction(session: Session, content: QuizContent): QuizAction {
  const { stage, step } = session.state;
  if (stage === "ready") return "show";
  if (stage === "question") return "reveal";
  if (stage === "reveal") return "board";
  if (stage === "podium") return podiumDone(session) ? "finish" : "podiumNext";
  if (boardView(session) === "round") return "total";
  if (step < content.questions.length - 1) return "next";
  // После таблицы последнего вопроса — награждение, если есть кого награждать.
  return hasPodium(session.leaderboard) ? "podium" : "finish";
}

export const ACTION_LABELS: Record<QuizAction, string> = {
  show: "Показать вопрос",
  reveal: "Показать ответ",
  board: "Таблица",
  total: "Общий счёт",
  next: "Следующий вопрос",
  podium: "Награждение",
  podiumNext: "Показать место",
  finish: "Завершить игру",
};

/** Подпись главной кнопки: на пьедестале — какое место откроется, в конце раунда — «Итоги раунда». */
export function actionLabel(session: Session, content: QuizContent, action: QuizAction): string {
  if (action === "podiumNext") return podiumLabel(session);
  if (action === "board" && endsRound(content, session.state.step)) return "Итоги раунда";
  if (action === "show" && startsRound(content, session.state.step)) return "Начать раунд";
  return ACTION_LABELS[action];
}

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
  const after: Record<string, LeaderboardEntry> = {};
  for (const [pid, entry] of Object.entries(board)) {
    const delta = deltas.get(pid) ?? 0;
    after[pid] = { ...entry, score: entry.score + delta, last: delta };
  }
  // Стрелки «↑2»: на сколько мест сдвинулся участник после этого ответа.
  const moves = placeMoves(board, after);
  const leaderboard: Record<string, LeaderboardEntry> = {};
  for (const [pid, entry] of Object.entries(board)) {
    const delta = deltas.get(pid) ?? 0;
    const move = moves.get(pid) ?? 0;
    if (delta === 0 && (entry.last ?? 0) === 0 && (entry.move ?? 0) === move && session.leaderboard[pid]) continue;
    leaderboard[pid] = { ...(after[pid] as LeaderboardEntry), move };
  }
  const accepted = parseResult(session.state.result).accepted;
  return {
    state: { stage: "reveal", revealed: true, answered: own.length, result: resultOf(step.question, own, accepted) },
    leaderboard,
  };
}

/** Таблица после шага; в конце раунда — сначала итоги раунда, потом общий счёт. */
export function showBoard(session: Session, content: QuizContent): SessionChange {
  const { board: _view, ...rest } = asRecord(session.state.result);
  const result = endsRound(content, session.state.step) ? { ...rest, board: "round" } : rest;
  return { state: { stage: "board", revealed: true, result } };
}

/** После итогов раунда — общий счёт. */
export function showTotal(session: Session): SessionChange {
  return { state: { result: { ...asRecord(session.state.result), board: "total" } } };
}

/** Следующий вопрос: сначала «готовы?», вопрос показывает ведущий. С новым раундом — счёт раунда с нуля. */
export function nextQuestion(session: Session, content: QuizContent): SessionChange {
  const step = session.state.step + 1;
  return {
    ...(startsRound(content, step) ? { leaderboard: startRoundEntries(session.leaderboard) } : {}),
    state: {
      step,
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
  if (stage === "podium") return { change: podiumBack(session) };
  if (stage === "board") {
    const { board: view, ...rest } = asRecord(session.state.result);
    if (view === "total") return { change: { state: { result: { ...rest, board: "round" } } } };
    return { change: { state: { stage: "reveal", revealed: true, result: rest } } };
  }
  if (stage === "reveal") {
    // Снимаем очки этого шага: при повторном показе ответа они посчитаются заново.
    const leaderboard: Record<string, LeaderboardEntry> = {};
    for (const [pid, entry] of Object.entries(session.leaderboard)) {
      if (entry.last) leaderboard[pid] = { ...entry, score: entry.score - entry.last, last: 0, move: 0 };
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
