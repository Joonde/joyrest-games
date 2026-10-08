// Ход «Шашек» на пульте — чистые функции (решение владельца 8 октября 2026).
//
// Обычная партия: белые и чёрные ходят по очереди (белые — первая подключившаяся команда, чёрные — вторая).
// Ход: капитан выбирает его на телефоне (или ведущий на пульте), пульт проверяет по правилам. Съели шашку —
// команда, которая её потеряла, получает вопрос из игры: ответила верно — +20 очков. Очки: 10 за шашку,
// 30 за дамку, 50 за победу на доске; вопросы кончились — дальше просто партия.
import { leaderboardAdditions, scoringParticipants } from "../../core/leaderboard";
import { matchesAnswer } from "../quiz/normalize";
import { hasPodium, podiumBack, podiumDone } from "../../core/podium";
import type { Answer, LeaderboardEntry, Participant, Session, SessionChange } from "../../data/types";
import type { ScoreDelta, Step } from "../types";
import type { CheckersContent, CheckersQuestion } from "./content";
import { applyMove, capturePoints, findMove, initialBoard, isLost, opponent, parseBoardString, POINTS, type Color } from "./rules";

export type CheckersMode = "move" | "task" | "over";

export interface CheckersResult {
  board: string;
  white: string | null;
  black: string | null;
  /** Следующий вопрос для задания. */
  q: number;
  mode: CheckersMode;
  /** Чей ход (null — партия ещё не началась). */
  mover: string | null;
  last: { path: number[]; captured: number[] } | null;
  /** Очки за последний ход (для «Назад»). */
  points: number;
  /** Доска до последнего хода (для «Назад»). */
  prev: string | null;
  /** Задание: кто отвечает (потерял шашку), какой вопрос, засчитал ли ведущий сам, сколько начислено. */
  victim: string | null;
  task: number | null;
  taskOk: boolean | null;
  taskPoints: number;
  /** Партия выиграна на доске. */
  winner: string | null;
  /** «Завершить партию»: откуда — «Назад» вернёт туда же. */
  overFrom: { mode: "move" | "task"; stage: "ready" | "question" | "reveal" } | null;
  /** Итог прошлого этапа — «Назад» с начала хода или задания (до трёх шагов назад). */
  undo: Record<string, unknown> | null;
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const pid = (v: unknown) => (typeof v === "string" && ID.test(v) ? v : null);
const cells = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x) && x >= 0 && x < 64).slice(0, 20) : []);

export function parseCheckersResult(raw: unknown): CheckersResult {
  const d = rec(raw);
  const last = rec(d.last);
  const nat = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
  return {
    board: parseBoardString(d.board),
    white: pid(d.white),
    black: pid(d.black),
    q: nat(d.q) ?? 0,
    mode: d.mode === "task" || d.mode === "over" ? d.mode : "move",
    mover: pid(d.mover),
    last: Array.isArray(last.path) ? { path: cells(last.path), captured: cells(last.captured) } : null,
    points: typeof d.points === "number" && Number.isFinite(d.points) ? d.points : 0,
    prev: typeof d.prev === "string" ? parseBoardString(d.prev) : null,
    victim: pid(d.victim),
    task: nat(d.task),
    taskOk: typeof d.taskOk === "boolean" ? d.taskOk : null,
    taskPoints: typeof d.taskPoints === "number" && Number.isFinite(d.taskPoints) ? d.taskPoints : 0,
    winner: pid(d.winner),
    overFrom: parseOverFrom(d.overFrom),
    undo: typeof d.undo === "object" && d.undo !== null && !Array.isArray(d.undo) ? (d.undo as Record<string, unknown>) : null,
  };
}

function parseOverFrom(v: unknown): CheckersResult["overFrom"] {
  const d = rec(v);
  const mode = d.mode === "task" ? "task" : d.mode === "move" ? "move" : null;
  const stage = d.stage === "ready" || d.stage === "question" || d.stage === "reveal" ? d.stage : null;
  return mode && stage ? { mode, stage } : null;
}

const write = (r: CheckersResult): Record<string, unknown> => ({ ...r });

/** Снимок для «Назад»: не глубже трёх шагов, чтобы итог шага не рос всю партию. */
function snapshot(r: CheckersResult, depth = 3): Record<string, unknown> {
  const inner = depth > 1 && r.undo ? snapshot(parseCheckersResult(r.undo), depth - 1) : null;
  return { ...r, undo: inner };
}

export function colorOfPid(result: CheckersResult, p: string | null): Color | null {
  if (!p) return null;
  return p === result.white ? "w" : p === result.black ? "b" : null;
}

/** Вопрос текущего задания (команде, что потеряла шашку). */
export function currentQuestion(content: CheckersContent, result: CheckersResult): CheckersQuestion | undefined {
  return result.task !== null ? content.questions[result.task] : undefined;
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

export type CheckersAction = "start" | "waitMove" | "task" | "taskReveal" | "turn" | "end" | "podium" | "podiumNext" | "finish";

export function checkersPrimary(session: Session, content: CheckersContent): CheckersAction {
  const { stage } = session.state;
  const r = parseCheckersResult(session.state.result);
  if (stage === "podium") return podiumDone(session) ? "finish" : "podiumNext";
  if (r.mode === "over") return hasPodium(session.leaderboard) ? "podium" : "finish";
  if (!r.mover || stage === "ready") return "start";
  if (r.mode === "task") return stage === "question" ? "taskReveal" : "turn";
  if (stage === "question") return "waitMove";
  // Ход показан: съели шашку и вопросы ещё есть — задание потерявшим.
  if ((r.last?.captured.length ?? 0) > 0 && content.questions[r.q]) return "task";
  return "turn";
}

/** «Начать партию»: стороны, доска, ходят белые. */
export function startGame(session: Session, participants: Participant[]): SessionChange {
  const r = parseCheckersResult(session.state.result);
  const s = sides(session, participants, r);
  return {
    state: {
      step: session.state.step + 1,
      stage: "question",
      startedAt: "server",
      timeLimit: null,
      revealed: false,
      answered: 0,
      result: write({ ...r, ...s, board: initialBoard(), mode: "move", mover: s.white, last: null, points: 0, prev: null, victim: null, task: null, taskOk: null, taskPoints: 0, winner: null, overFrom: null, undo: null }),
    },
    leaderboard: board(session, participants),
  };
}

/** Ход капитана (ответ `{ path }`) → доска, очки; null — хода нет или он не по правилам. */
export function moveChange(session: Session, answers: Answer[]): SessionChange | null {
  if (session.state.stage !== "question") return null;
  const r = parseCheckersResult(session.state.result);
  if (r.mode !== "move" || !r.mover) return null;
  // Ход, сделанный до «Назад» (до нового времени шага), не считается.
  const since = session.state.startedAt ?? 0;
  const answer = answers.find((a) => a.step === session.state.step && a.pid === r.mover && (a.submittedAt ?? 0) >= since);
  const path = cellsOfValue(answer?.value);
  return path ? pathChange(session, path) : null;
}

/**
 * Ход по клеткам (с телефона капитана или ведущий на пульте — капитан без телефона, репетиция):
 * доска, очки; null — хода нет или он не по правилам.
 */
export function pathChange(session: Session, path: number[]): SessionChange | null {
  if (session.state.stage !== "question") return null;
  const r = parseCheckersResult(session.state.result);
  if (r.mode !== "move" || !r.mover) return null;
  const color = colorOfPid(r, r.mover);
  if (!color) return null;
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

/** Ведущий пропускает ход (капитан не успевает) — доска без изменений, ход переходит сопернику. */
export function skipMove(session: Session): SessionChange {
  const r = parseCheckersResult(session.state.result);
  return { state: { stage: "reveal", revealed: true, result: write({ ...r, last: null, points: 0, prev: null }) } };
}

/** Задание команде, которая потеряла шашку: вопрос из игры с таймером. */
export function toTask(session: Session, content: CheckersContent): SessionChange {
  const r = parseCheckersResult(session.state.result);
  const color = colorOfPid(r, r.mover);
  if (!color || !content.questions[r.q]) return {};
  const victim = color === "w" ? r.black : r.white;
  return {
    state: { step: session.state.step + 1, stage: "question", startedAt: "server", timeLimit: content.timeLimit, revealed: false, answered: 0, result: write({ ...r, mode: "task", victim, task: r.q, q: r.q + 1, taskOk: null, taskPoints: 0, undo: snapshot(r) }) },
  };
}

/** Ведущий сам засчитывает ответ (сказали вслух или задание): true / false, null — по телефону. */
export function markTask(session: Session, ok: boolean | null): SessionChange {
  const r = parseCheckersResult(session.state.result);
  if (r.mode !== "task" || session.state.stage !== "question") return {};
  return { state: { result: write({ ...r, taskOk: ok }) } };
}

export function taskRight(content: CheckersContent, r: CheckersResult, answers: Answer[], step: number): boolean {
  if (r.taskOk !== null) return r.taskOk;
  const q = r.task !== null ? content.questions[r.task] : undefined;
  const a = answers.find((x) => x.step === step && x.pid === r.victim);
  return Boolean(q && a && isRight(q, a.value));
}

/** «Показать ответ»: верно — +20 команде, что потеряла шашку. */
export function revealTask(session: Session, content: CheckersContent, answers: Answer[]): SessionChange {
  const r = parseCheckersResult(session.state.result);
  if (r.mode !== "task" || !r.victim) return {};
  const ok = taskRight(content, r, answers, session.state.step);
  const taskPoints = ok ? POINTS.task : 0;
  const change: SessionChange = { state: { stage: "reveal", revealed: true, result: write({ ...r, taskOk: ok, taskPoints }) } };
  if (taskPoints > 0) change.addScore = { [r.victim]: taskPoints };
  return change;
}

/** Ход сопернику (после хода или задания). */
export function nextTurn(session: Session): SessionChange {
  const r = parseCheckersResult(session.state.result);
  // После задания ходит тот, кто его выполнял (соперник того, кто съел); после хода — соперник ходившего.
  const after = r.mode === "task" ? r.victim : r.mover === r.white ? r.black : r.white;
  return {
    state: { step: session.state.step + 1, stage: "question", startedAt: "server", timeLimit: null, revealed: false, answered: 0, result: write({ ...r, mode: "move", mover: after, last: null, points: 0, prev: null, victim: null, task: null, taskOk: null, taskPoints: 0, undo: snapshot(r) }) },
  };
}

/** Партия окончена досрочно — побеждает больший счёт (дальше — общий пьедестал). */
export function endGame(session: Session): SessionChange {
  const r = parseCheckersResult(session.state.result);
  const stage = session.state.stage === "ready" || session.state.stage === "question" || session.state.stage === "reveal" ? session.state.stage : "reveal";
  const from = r.mode === "task" ? "task" : "move";
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
  // Показанный ход (и победа им) — отменить: доска как была, очки сняты, капитан ходит заново.
  if ((r.mode === "move" || r.mode === "over") && stage === "reveal") {
    const change: SessionChange = {
      state: { stage: "question", revealed: false, startedAt: "server", result: write({ ...r, board: r.prev ?? r.board, prev: null, last: null, points: 0, mode: "move", winner: null }) },
    };
    if (r.points > 0 && r.mover) change.addScore = { [r.mover]: -r.points };
    return { change, clear: [step] };
  }
  // Показанный ответ на задание — к вопросу, очки сняты.
  if (r.mode === "task" && stage === "reveal") {
    const change: SessionChange = { state: { stage: "question", revealed: false, result: write({ ...r, taskPoints: 0 }) } };
    if (r.taskPoints > 0 && r.victim) change.addScore = { [r.victim]: -r.taskPoints };
    return { change };
  }
  // Начало хода или задания — к прошлому показу.
  if (stage === "question" && r.undo) {
    return { change: { state: { step: step - 1, stage: "reveal", revealed: true, startedAt: null, timeLimit: null, answered: 0, result: r.undo } }, clear: [step] };
  }
  // Первый ход партии — к началу.
  if (stage === "question" && r.mode === "move") {
    return { change: { state: { stage: "ready", startedAt: null, timeLimit: null, revealed: false, answered: 0, result: write({ ...r, mover: null }) } }, clear: [step] };
  }
  return null;
}
