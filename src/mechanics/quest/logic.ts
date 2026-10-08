// Ход «Активной настолки» — чистые функции.
//
// Ход команды: шаг броска (`question`, режим `roll`) — капитан жмёт «Бросить кубик» (`{ roll: true }`),
// число 1–6 считает пульт из времени нажатия по часам сервера (телефон его не выбирает) → фишка идёт
// (`reveal`, режим `cell`: задание клетки; бонус и ловушка двигают сразу, пропуск — со следующего хода)
// → ведущий: «Выполнено» (+очки клетки) / «Не выполнено» → следующая команда. Первая на финише —
// бонус финиша и награждение.
import { leaderboardAdditions, scoringParticipants } from "../../core/leaderboard";
import { hasPodium, podiumBack, podiumDone } from "../../core/podium";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import type { ScoreDelta, Step } from "../types";
import type { QuestCell, QuestContent } from "./content";

export type QuestMode = "roll" | "cell" | "done" | "finish";

interface Prev {
  turn: number;
  pos: Record<string, number>;
  skip: string[];
  points: number;
  mover: string | null;
}

export interface QuestResult {
  order: string[];
  turn: number;
  /** Позиции: 0 — старт, клетки 1..N, N+1 — финиш. */
  pos: Record<string, number>;
  /** Пропускают следующий ход. */
  skip: string[];
  mode: QuestMode;
  mover: string | null;
  roll: number | null;
  /** Откуда шла фишка (для анимации) и где встала. */
  from: number;
  at: number;
  /** Выполнено / не выполнено / ещё не решено. */
  outcome: "ok" | "fail" | null;
  points: number;
  winner: string | null;
  prev: Prev | null;
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && ID.test(x)))].slice(0, 100) : []);
const pid = (v: unknown) => (typeof v === "string" && ID.test(v) ? v : null);
const nat = (v: unknown, def = 0) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : def);
function nums(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(rec(v))) if (ID.test(k) && typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 200) out[k] = n;
  return out;
}

export function parseQuestResult(raw: unknown): QuestResult {
  const d = rec(raw);
  const p = rec(d.prev);
  return {
    order: ids(d.order),
    turn: nat(d.turn),
    pos: nums(d.pos),
    skip: ids(d.skip),
    mode: d.mode === "cell" || d.mode === "done" || d.mode === "finish" ? d.mode : "roll",
    mover: pid(d.mover),
    roll: typeof d.roll === "number" && d.roll >= 1 && d.roll <= 6 ? d.roll : null,
    from: nat(d.from),
    at: nat(d.at),
    outcome: d.outcome === "ok" || d.outcome === "fail" ? d.outcome : null,
    points: typeof d.points === "number" ? d.points : 0,
    winner: pid(d.winner),
    prev: Object.keys(p).length > 0 ? { turn: nat(p.turn), pos: nums(p.pos), skip: ids(p.skip), points: typeof p.points === "number" ? p.points : 0, mover: pid(p.mover) } : null,
  };
}

const write = (r: QuestResult): Record<string, unknown> => ({ ...r });

export function questSteps(content: QuestContent): Step[] {
  return content.cells.map((c) => ({ id: c.id, answerable: true }));
}

export function score(): ScoreDelta[] {
  return [];
}

/** Финиш — клетка за последней. */
export const finishOf = (content: QuestContent) => content.cells.length + 1;

/** Клетка по позиции (1..N), старт и финиш — null. */
export function cellAt(content: QuestContent, at: number): QuestCell | null {
  return at >= 1 && at <= content.cells.length ? (content.cells[at - 1] ?? null) : null;
}

/** Кубик из нажатия: время сервера и id ответа — телефон число не выбирает. */
export function dieOf(answer: Pick<Answer, "id" | "submittedAt">): number {
  const text = `${answer.id}:${answer.submittedAt ?? 0}`;
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (Math.abs(h) % 6) + 1;
}

/** Чья очередь (с учётом пропусков — их пропускает `nextTurn`). */
export function moverOf(r: QuestResult): string | null {
  return r.order.length > 0 ? (r.order[r.turn % r.order.length] ?? null) : null;
}

function orderOf(session: Session, participants: Participant[], r: QuestResult): string[] {
  const joined = [...scoringParticipants(participants, session.playMode)].sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0) || a.id.localeCompare(b.id)).map((p) => p.id);
  return [...new Set([...r.order, ...joined, ...Object.keys(session.leaderboard)])];
}

export type QuestAction = "start" | "waitRoll" | "judge" | "next" | "podium" | "podiumNext" | "finish";

export function questPrimary(session: Session): QuestAction {
  const { stage } = session.state;
  const r = parseQuestResult(session.state.result);
  if (stage === "podium") return podiumDone(session) ? "finish" : "podiumNext";
  if (stage === "ready") return "start";
  if (r.mode === "finish") return hasPodium(session.leaderboard) ? "podium" : "finish";
  if (r.mode === "roll") return "waitRoll";
  if (r.mode === "cell") return "judge";
  return "next";
}

/** «Начать игру»: все на старте, ходит первая подключившаяся команда. */
export function startQuest(session: Session, participants: Participant[]): SessionChange {
  const r = parseQuestResult(session.state.result);
  const order = orderOf(session, participants, r);
  const pos = Object.fromEntries(order.map((p) => [p, r.pos[p] ?? 0]));
  return {
    state: { stage: "question", startedAt: "server", timeLimit: null, revealed: false, answered: 0, result: write({ ...r, order, pos, mode: "roll", mover: moverOf({ ...r, order }), roll: null, outcome: null, points: 0 }) },
    leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode),
  };
}

/** Клетка, на которую встали: бонус и ловушка сдвигают один раз (без цепочек). */
function land(content: QuestContent, from: number, roll: number): { at: number; moved: number } {
  const finish = finishOf(content);
  const at = Math.min(finish, from + roll);
  const cell = cellAt(content, at);
  if (cell && (cell.kind === "bonus" || cell.kind === "trap") && cell.move !== 0) {
    return { at: Math.max(0, Math.min(finish, at + cell.move)), moved: cell.move };
  }
  return { at, moved: 0 };
}

/** Бросок пришёл (капитан команды, чья очередь) → фишка идёт, открывается клетка. */
export function rollChange(session: Session, content: QuestContent, answers: Answer[], participants: Participant[]): SessionChange | null {
  if (session.state.stage !== "question") return null;
  const r = parseQuestResult(session.state.result);
  if (r.mode !== "roll" || !r.mover) return null;
  const answer = answers.find((a) => a.step === session.state.step && a.pid === r.mover && rec(a.value).roll === true);
  if (!answer) return null;
  return applyRoll(session, content, dieOf(answer), participants);
}

/** Ведущий бросает за команду (кубик на пульте или в репетиции). */
export function applyRoll(session: Session, content: QuestContent, roll: number, participants: Participant[]): SessionChange {
  const r = parseQuestResult(session.state.result);
  const mover = r.mover;
  if (!mover) return {};
  const from = r.pos[mover] ?? 0;
  const { at } = land(content, from, roll);
  const finish = finishOf(content);
  const cell = cellAt(content, at);
  const pos = { ...r.pos, [mover]: at };
  const finished = at >= finish;
  // Пропуск хода — со следующего круга.
  const skip = cell?.kind === "skip" && !r.skip.includes(mover) ? [...r.skip, mover] : r.skip;
  const prev: Prev = { turn: r.turn, pos: r.pos, skip: r.skip, points: 0, mover };
  const base: QuestResult = { ...r, pos, skip, roll, from, at, outcome: null, points: 0, prev };
  if (finished) {
    const change: SessionChange = {
      state: { stage: "reveal", revealed: true, result: write({ ...base, mode: "finish", winner: mover, points: content.finishPoints }) },
      leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode),
    };
    if (content.finishPoints > 0) change.addScore = { [mover]: content.finishPoints };
    return change;
  }
  // Пустая клетка, бонус, ловушка и пропуск — заданий нет, сразу «Следующая команда».
  const task = cell && (cell.kind === "task" || cell.kind === "question" || cell.kind === "dance" || cell.kind === "karaoke");
  return {
    state: { stage: "reveal", revealed: true, result: write({ ...base, mode: task ? "cell" : "done" }) },
    leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode),
  };
}

/** «Выполнено» / «Не выполнено». */
export function judge(session: Session, content: QuestContent, ok: boolean): SessionChange {
  const r = parseQuestResult(session.state.result);
  const cell = cellAt(content, r.at);
  const points = ok && cell ? cell.points : 0;
  const change: SessionChange = { state: { result: write({ ...r, mode: "done", outcome: ok ? "ok" : "fail", points, prev: r.prev ? { ...r.prev, points } : null }) } };
  if (points > 0 && r.mover) change.addScore = { [r.mover]: points };
  return change;
}

/** Следующая команда (кто пропускает ход — пропускает его, метка снимается). */
export function nextTurn(session: Session): SessionChange {
  const r = parseQuestResult(session.state.result);
  let turn = r.turn + 1;
  const skip = [...r.skip];
  for (let guard = 0; guard < r.order.length; guard++) {
    const who = r.order[turn % Math.max(1, r.order.length)];
    if (!who || !skip.includes(who) || who === r.mover) break;
    skip.splice(skip.indexOf(who), 1);
    turn += 1;
  }
  // Свою метку «пропуск» команда получила на этом ходу — она сработает на её следующем ходу.
  const next: QuestResult = { ...r, turn, skip, mode: "roll", mover: null, roll: null, outcome: null, points: 0 };
  next.mover = moverOf(next);
  return { state: { step: session.state.step + 1, stage: "question", startedAt: "server", timeLimit: null, revealed: false, answered: 0, result: write(next) } };
}

export interface QuestBack {
  change: SessionChange;
  clear?: number[];
}

export function questBack(session: Session): QuestBack | null {
  const { stage, step } = session.state;
  const r = parseQuestResult(session.state.result);
  if (stage === "podium") return { change: podiumBack(session) };
  if (stage === "ready") return null;
  if (stage === "reveal" && r.prev) {
    // Отменить ход: фишка обратно, очки сняты, команда бросает заново.
    const p = r.prev;
    const change: SessionChange = {
      state: { stage: "question", revealed: false, result: write({ ...r, turn: p.turn, pos: p.pos, skip: p.skip, mode: "roll", mover: p.mover, roll: null, outcome: null, points: 0, winner: null, prev: null }) },
    };
    const minus = r.mode === "finish" ? r.points : r.outcome === "ok" ? r.points : 0;
    if (minus > 0 && p.mover) change.addScore = { [p.mover]: -minus };
    return { change, clear: [step] };
  }
  return null;
}
