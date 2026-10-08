// Ход «Шашек» на пульте — чистые функции.
//
// Вопрос (`ready` → `question` с таймером → `reveal`: кто ходит) → шаг хода (`question` без таймера:
// капитан команды-победителя делает ход на телефоне, пульт проверяет его по правилам и записывает,
// `reveal` — ход на доске, очки) → следующий вопрос. Белые — первая подключившаяся команда, чёрные — вторая.
import { leaderboardAdditions, scoringParticipants } from "../../core/leaderboard";
import { matchesAnswer } from "../quiz/normalize";
import { hasPodium, podiumBack, podiumDone } from "../../core/podium";
import type { Answer, LeaderboardEntry, Participant, Session, SessionChange } from "../../data/types";
import type { ScoreDelta, Step } from "../types";
import type { CheckersContent, CheckersQuestion } from "./content";
import { applyMove, capturePoints, findMove, initialBoard, isLost, opponent, parseBoardString, POINTS, type Color } from "./rules";

export type CheckersMode = "question" | "move" | "over";

export interface CheckersResult {
  board: string;
  white: string | null;
  black: string | null;
  /** Номер вопроса. */
  q: number;
  mode: CheckersMode;
  /** Кто ходит (ответил верно и быстрее). */
  mover: string | null;
  last: { path: number[]; captured: number[] } | null;
  /** Очки за последний ход (для «Назад»). */
  points: number;
  /** Доска до последнего хода (для «Назад»). */
  prev: string | null;
  /** Партия выиграна на доске. */
  winner: string | null;
  /** «Завершить партию»: откуда — «Назад» вернёт туда же. */
  overFrom: { mode: "question" | "move"; stage: "ready" | "question" | "reveal" } | null;
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const pid = (v: unknown) => (typeof v === "string" && ID.test(v) ? v : null);
const cells = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x) && x >= 0 && x < 64).slice(0, 20) : []);

export function parseCheckersResult(raw: unknown): CheckersResult {
  const d = rec(raw);
  const last = rec(d.last);
  return {
    board: parseBoardString(d.board),
    white: pid(d.white),
    black: pid(d.black),
    q: typeof d.q === "number" && Number.isInteger(d.q) && d.q >= 0 ? d.q : 0,
    mode: d.mode === "move" || d.mode === "over" ? d.mode : "question",
    mover: pid(d.mover),
    last: Array.isArray(last.path) ? { path: cells(last.path), captured: cells(last.captured) } : null,
    points: typeof d.points === "number" && Number.isFinite(d.points) ? d.points : 0,
    prev: typeof d.prev === "string" ? parseBoardString(d.prev) : null,
    winner: pid(d.winner),
    overFrom: parseOverFrom(d.overFrom),
  };
}

function parseOverFrom(v: unknown): CheckersResult["overFrom"] {
  const d = rec(v);
  const mode = d.mode === "move" ? "move" : d.mode === "question" ? "question" : null;
  const stage = d.stage === "ready" || d.stage === "question" || d.stage === "reveal" ? d.stage : null;
  return mode && stage ? { mode, stage } : null;
}

const write = (r: CheckersResult): Record<string, unknown> => ({ ...r });

export function colorOfPid(result: CheckersResult, p: string | null): Color | null {
  if (!p) return null;
  return p === result.white ? "w" : p === result.black ? "b" : null;
}

export function currentQuestion(content: CheckersContent, result: CheckersResult): CheckersQuestion | undefined {
  return content.questions[result.q];
}

export function isRight(q: CheckersQuestion, value: unknown): boolean {
  if (q.kind === "choice") return value === q.correct;
  return typeof value === "string" && matchesAnswer(value, q.answers.filter((a) => a.trim()));
}

export function checkersSteps(content: CheckersContent): Step[] {
  return content.questions.map((q) => ({ id: q.id, answerable: true }));
}

export function score(): ScoreDelta[] {
  return [];
}

/** Стороны: первые два участника по времени входа. */
function sides(session: Session, participants: Participant[], result: CheckersResult): Pick<CheckersResult, "white" | "black"> {
  if (result.white && result.black) return { white: result.white, black: result.black };
  const order = [...scoringParticipants(participants, session.playMode)].sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0) || a.id.localeCompare(b.id)).map((p) => p.id);
  const fromBoard = Object.keys(session.leaderboard);
  const all = [...new Set([...order, ...fromBoard])];
  const white = result.white ?? all[0] ?? null;
  const black = result.black ?? all.find((p) => p !== white) ?? null;
  return { white, black };
}

function board(session: Session, participants: Participant[]): Record<string, LeaderboardEntry> {
  return leaderboardAdditions(session.leaderboard, participants, session.playMode);
}

export type CheckersAction = "show" | "reveal" | "toMove" | "waitMove" | "next" | "end" | "podium" | "podiumNext" | "finish";

export function checkersPrimary(session: Session, content: CheckersContent): CheckersAction {
  const { stage } = session.state;
  const r = parseCheckersResult(session.state.result);
  if (stage === "podium") return podiumDone(session) ? "finish" : "podiumNext";
  if (r.mode === "over") return hasPodium(session.leaderboard) ? "podium" : "finish";
  const more = r.q + 1 < content.questions.length;
  if (stage === "ready") return content.questions[r.q] ? "show" : "end";
  if (stage === "question") return r.mode === "move" ? "waitMove" : "reveal";
  // reveal
  if (r.mode === "question" && r.mover) return "toMove";
  return more ? "next" : "end";
}

export function showQuestion(session: Session, content: CheckersContent, participants: Participant[]): SessionChange {
  const r = parseCheckersResult(session.state.result);
  const s = sides(session, participants, r);
  return {
    state: {
      stage: "question",
      startedAt: "server",
      timeLimit: content.timeLimit,
      revealed: false,
      answered: 0,
      result: write({ ...r, ...s, board: r.board || initialBoard(), mode: "question", mover: null }),
    },
    leaderboard: board(session, participants),
  };
}

/** Кто ходит: верный ответ белых или чёрных, раньше по часам сервера. */
export function moverOf(content: CheckersContent, result: CheckersResult, answers: Answer[], step: number): string | null {
  const q = currentQuestion(content, result);
  if (!q) return null;
  const right = answers
    .filter((a) => a.step === step && (a.pid === result.white || a.pid === result.black) && isRight(q, a.value))
    .sort((a, b) => (a.submittedAt ?? Number.MAX_SAFE_INTEGER) - (b.submittedAt ?? Number.MAX_SAFE_INTEGER));
  return right[0]?.pid ?? null;
}

export function revealQuestion(session: Session, content: CheckersContent, answers: Answer[], participants: Participant[]): SessionChange {
  const r = parseCheckersResult(session.state.result);
  const mover = moverOf(content, r, answers, session.state.step);
  const color = colorOfPid(r, mover);
  // Ходить некуда (все шашки заперты) — по правилам это поражение: победа сопернику.
  if (color && isLost(r.board, color)) {
    const winner = color === "w" ? r.black : r.white;
    const change: SessionChange = { state: { stage: "reveal", revealed: true, result: write({ ...r, mover, mode: "over", winner, points: POINTS.win }) }, leaderboard: board(session, participants) };
    if (winner) change.addScore = { [winner]: POINTS.win };
    return change;
  }
  return { state: { stage: "reveal", revealed: true, result: write({ ...r, mover }) }, leaderboard: board(session, participants) };
}

export function toMove(session: Session): SessionChange {
  const r = parseCheckersResult(session.state.result);
  return { state: { step: session.state.step + 1, stage: "question", startedAt: "server", timeLimit: null, revealed: false, answered: 0, result: write({ ...r, mode: "move", last: null, points: 0, prev: null }) } };
}

/** Ход капитана (ответ `{ path }`) → доска, очки; null — хода нет или он не по правилам. */
export function moveChange(session: Session, answers: Answer[]): SessionChange | null {
  if (session.state.stage !== "question") return null;
  const r = parseCheckersResult(session.state.result);
  if (r.mode !== "move" || !r.mover) return null;
  const color = colorOfPid(r, r.mover);
  // Ход, сделанный до «Назад» (до нового времени шага), не считается.
  const since = session.state.startedAt ?? 0;
  const answer = answers.find((a) => a.step === session.state.step && a.pid === r.mover && (a.submittedAt ?? 0) >= since);
  const path = cellsOfValue(answer?.value);
  if (!color || !path) return null;
  const move = findMove(r.board, color, path);
  if (!move) return null;
  const next = applyMove(r.board, move);
  const won = isLost(next, opponent(color));
  const points = capturePoints(r.board, move) + (won ? POINTS.win : 0);
  const change: SessionChange = {
    state: {
      stage: "reveal",
      revealed: true,
      result: write({ ...r, board: next, prev: r.board, last: { path: move.path, captured: move.captured }, points, mode: won ? "over" : "move", winner: won ? r.mover : null }),
    },
  };
  if (points > 0) change.addScore = { [r.mover]: points };
  return change;
}

export function cellsOfValue(value: unknown): number[] | null {
  const path = rec(value).path;
  if (!Array.isArray(path) || path.length < 2 || path.length > 20) return null;
  return path.every((x) => Number.isInteger(x) && x >= 0 && x < 64) ? (path as number[]) : null;
}

/** Ведущий пропускает ход (капитан не успевает) — доска без изменений. */
export function skipMove(session: Session): SessionChange {
  const r = parseCheckersResult(session.state.result);
  return { state: { stage: "reveal", revealed: true, result: write({ ...r, last: null, points: 0, prev: null }) } };
}

export function nextQuestion(session: Session): SessionChange {
  const r = parseCheckersResult(session.state.result);
  return {
    state: { step: session.state.step + 1, stage: "ready", startedAt: null, timeLimit: null, revealed: false, answered: 0, result: write({ ...r, q: r.q + 1, mode: "question", mover: null, last: null, points: 0, prev: null }) },
  };
}

/** Вопросы кончились — партия окончена, побеждает больший счёт (дальше — общий пьедестал). */
export function endGame(session: Session): SessionChange {
  const r = parseCheckersResult(session.state.result);
  const stage = session.state.stage === "ready" || session.state.stage === "question" || session.state.stage === "reveal" ? session.state.stage : "reveal";
  const from = r.mode === "move" ? "move" : "question";
  return { state: { result: write({ ...r, mode: "over", winner: null, overFrom: { mode: from, stage } }) } };
}

export interface CheckersBack {
  change: SessionChange;
  clear?: number[];
}

export function checkersBack(session: Session): CheckersBack | null {
  const { stage, step } = session.state;
  const r = parseCheckersResult(session.state.result);
  if (stage === "podium") return { change: podiumBack(session) };
  // «Завершить партию» — назад туда, откуда завершили.
  if (r.mode === "over" && !r.winner && r.overFrom) return { change: { state: { stage: r.overFrom.stage, result: write({ ...r, mode: r.overFrom.mode, overFrom: null }) } } };
  // Победа «нет ходов» на ответе — назад к ответу без победы.
  if (r.mode === "over" && r.winner && !r.last && stage === "reveal") {
    const change: SessionChange = { state: { stage: "question", revealed: false, result: write({ ...r, mode: "question", winner: null, mover: null, points: 0 }) } };
    if (r.points > 0) change.addScore = { [r.winner]: -r.points };
    return { change };
  }
  if (r.mode === "move" || r.mode === "over") {
    if (stage === "reveal") {
      // Отменить ход: доска как была, очки сняты, капитан ходит заново.
      // Новое время шага: телефон капитана забывает прошлый ход и снова показывает доску.
      const change: SessionChange = {
        state: { stage: "question", revealed: false, startedAt: "server", result: write({ ...r, board: r.prev ?? r.board, prev: null, last: null, points: 0, mode: "move", winner: null }) },
      };
      if (r.points > 0 && r.mover) change.addScore = { [r.mover]: -r.points };
      return { change, clear: [step] };
    }
    // Ход ещё не сделан — к ответу на вопрос.
    return { change: { state: { step: step - 1, stage: "reveal", revealed: true, startedAt: null, timeLimit: null, result: write({ ...r, mode: "question" }) } }, clear: [step] };
  }
  // Ответ, открытый «Назад» с хода: время вопроса не вернуть — вопрос не открываем бессрочно, а возвращаем
  // к заставке (ответы убираются, ведущий задаст вопрос заново с полным таймером).
  if (stage === "reveal" && session.state.startedAt === null) {
    return { change: { state: { stage: "ready", startedAt: null, timeLimit: null, revealed: false, answered: 0, result: write({ ...r, mover: null }) } }, clear: [step] };
  }
  if (stage === "reveal") return { change: { state: { stage: "question", revealed: false, result: write({ ...r, mover: null }) } } };
  if (stage === "question") return { change: { state: { stage: "ready", startedAt: null, timeLimit: null, revealed: false, answered: 0 } }, clear: [step] };
  return null;
}
