// Ход «Активной настолки» — чистые функции.
//
// Ход команды: шаг броска (`question`, режим `roll`) — капитан жмёт «Бросить кубик» (`{ roll: true }`),
// число 1–6 считает пульт из времени нажатия по часам сервера (телефон его не выбирает) → фишка идёт
// (`reveal`, режим `cell`: задание клетки; бонус и ловушка двигают сразу, пропуск — со следующего хода)
// → ведущий: «Выполнено» (+очки клетки) / «Не выполнено» → следующая команда.
// Финиш (решение владельца 4 ноября 2026): первая команда на финише открывает «последний круг» — круг доигрывают
// до конца, чтобы ходов у всех было поровну (`final.left` — кто ещё ходит). Дошедшие получают бонус финиша по
// месту прихода (`finishBonus`: 100% · 75% · 50% · 25%), уже финишировавшие больше не ходят. Круг доигран — режим
// `over` и награждение по очкам. Ведущий может объявить последний круг и сам («Последний круг» на пульте).
import { leaderboardAdditions, scoringParticipants } from "../../core/leaderboard";
import { beforeChange, makeBefore, parseBefore, type Before } from "../../core/backStack";
import { hasPodium, podiumBack, podiumDone } from "../../core/podium";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import type { ScoreDelta, Step } from "../types";
import type { QuestCell, QuestContent } from "./content";

export type QuestMode = "roll" | "cell" | "done" | "finish" | "over";

/** Последний круг: кто ещё ходит в нём (по очереди) и почему он начался. */
export interface QuestFinal {
  left: string[];
  why: "finish" | "host";
}

interface Prev {
  turn: number;
  pos: Record<string, number>;
  skip: string[];
  points: number;
  mover: string | null;
  finished: string[];
  final: QuestFinal | null;
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
  /** Клетка, куда привёл кубик (до бонуса или ловушки), и на сколько сдвинуло. */
  hit: number;
  moved: number;
  /** Выполнено / не выполнено / ещё не решено. */
  outcome: "ok" | "fail" | null;
  points: number;
  winner: string | null;
  /** Кто дошёл до финиша — в порядке прихода. */
  finished: string[];
  /** Последний круг (после первого финиша или по кнопке ведущего). */
  final: QuestFinal | null;
  /** Кто пропустил ход при последней смене хода (для экрана и телефонов). */
  skipped: string[];
  prev: Prev | null;
  /** Итог прошлого хода целиком — «Назад» с броска следующей команды (`core/backStack`). */
  before: Before | null;
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

function parseFinal(raw: unknown): QuestFinal | null {
  const f = rec(raw);
  if (f.why !== "finish" && f.why !== "host") return null;
  return { left: ids(f.left), why: f.why };
}

export function parseQuestResult(raw: unknown): QuestResult {
  const d = rec(raw);
  const p = rec(d.prev);
  return {
    order: ids(d.order),
    turn: nat(d.turn),
    pos: nums(d.pos),
    skip: ids(d.skip),
    mode: d.mode === "cell" || d.mode === "done" || d.mode === "finish" || d.mode === "over" ? d.mode : "roll",
    mover: pid(d.mover),
    roll: typeof d.roll === "number" && d.roll >= 1 && d.roll <= 6 ? d.roll : null,
    from: nat(d.from),
    at: nat(d.at),
    hit: nat(d.hit),
    moved: typeof d.moved === "number" && Number.isInteger(d.moved) ? d.moved : 0,
    outcome: d.outcome === "ok" || d.outcome === "fail" ? d.outcome : null,
    points: typeof d.points === "number" ? d.points : 0,
    winner: pid(d.winner),
    finished: ids(d.finished),
    final: parseFinal(d.final),
    skipped: ids(d.skipped),
    prev:
      Object.keys(p).length > 0
        ? { turn: nat(p.turn), pos: nums(p.pos), skip: ids(p.skip), points: typeof p.points === "number" ? p.points : 0, mover: pid(p.mover), finished: ids(p.finished), final: parseFinal(p.final) }
        : null,
    before: parseBefore(d.before),
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

/** Доля бонуса финиша по месту прихода: первый — весь, дальше 75%, 50%, остальным — 25%. */
export const FINISH_SHARES = [1, 0.75, 0.5, 0.25] as const;

/** Бонус финиша за место прихода (0 — первый), кратно 5. */
export function finishBonus(points: number, place: number): number {
  const share = FINISH_SHARES[Math.min(Math.max(0, place), FINISH_SHARES.length - 1)] ?? 0.25;
  return Math.round((points * share) / 5) * 5;
}

/** Сколько примерно идёт игра: бросков у команды до финиша × команды × ~1¼ минуты на ход (задание, бросок, шаги). */
export function questMinutes(cells: number, teams: number): number {
  const moves = (cells + 1) / 3.5 + 1;
  return Math.max(5, Math.round((moves * Math.max(1, teams) * 1.25) / 5) * 5);
}

/** Кто ещё ходит в последнем круге (без убранных ведущим и уже финишировавших). */
export function finalLeft(r: QuestResult): string[] {
  return r.final ? r.final.left.filter((p) => r.order.includes(p) && !r.finished.includes(p)) : [];
}

/** Кто ходит после `mover` до конца очереди — остаток круга (без финишировавших). */
function restOfRound(order: string[], mover: string | null, finished: string[]): string[] {
  const at = mover ? order.indexOf(mover) : -1;
  return at < 0 ? [] : order.slice(at + 1).filter((p) => !finished.includes(p));
}

/**
 * Через сколько ходов очередь этого участника: 0 — ходит сейчас, «skip» — пропустит свой ход,
 * null — в этой игре (или в последнем круге) больше не ходит.
 */
export function movesBefore(r: QuestResult, pid: string): number | "skip" | null {
  if (r.mode === "over" || r.finished.includes(pid) || !r.order.includes(pid)) return null;
  if (r.mover === pid && r.mode === "roll") return 0;
  let queue: string[];
  if (r.final) queue = finalLeft(r);
  else {
    const at = r.mover ? r.order.indexOf(r.mover) : -1;
    queue = [...r.order.slice(at + 1), ...r.order.slice(0, at + 1)].filter((p) => !r.finished.includes(p));
  }
  const at = queue.indexOf(pid);
  if (at < 0) return null;
  if (r.skip.includes(pid)) return "skip";
  return queue.slice(0, at).filter((p) => !r.skip.includes(p)).length + (r.mode === "roll" ? 1 : 0);
}

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
  const known = new Set([...joined, ...Object.keys(session.leaderboard)]);
  // Новые встают в конец очереди (на старт), убранные ведущим — выпадают.
  return [...new Set([...r.order.filter((p) => known.has(p)), ...joined, ...Object.keys(session.leaderboard)])];
}

/** Сколько команд сможет играть (для кнопки «Начать игру»). */
export function questTeams(session: Session, participants: Participant[]): number {
  return orderOf(session, participants, parseQuestResult(session.state.result)).length;
}

export type QuestAction = "start" | "waitRoll" | "judge" | "next" | "podium" | "podiumNext" | "finish";

export function questPrimary(session: Session): QuestAction {
  const { stage } = session.state;
  const r = parseQuestResult(session.state.result);
  if (stage === "podium") return podiumDone(session) ? "finish" : "podiumNext";
  if (stage === "ready") return "start";
  const award: QuestAction = hasPodium(session.leaderboard) ? "podium" : "finish";
  if (r.mode === "over") return award;
  // Финиш: круг доигрывают, если в нём ещё кто-то ходит.
  if (r.mode === "finish") return finalLeft(r).length > 0 ? "next" : award;
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
    state: {
      stage: "question",
      startedAt: "server",
      timeLimit: null,
      revealed: false,
      answered: 0,
      result: write({ ...r, order, pos, mode: "roll", mover: moverOf({ ...r, order }), roll: null, outcome: null, points: 0, finished: [], final: null, skipped: [], winner: null, before: null }),
    },
    leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode),
  };
}

/** Клетка, на которую встали: бонус и ловушка сдвигают один раз (без цепочек). */
function land(content: QuestContent, from: number, roll: number): { at: number; hit: number; moved: number } {
  const finish = finishOf(content);
  const hit = Math.min(finish, from + roll);
  const cell = cellAt(content, hit);
  if (cell && (cell.kind === "bonus" || cell.kind === "trap") && cell.move !== 0) {
    const at = Math.max(0, Math.min(finish, hit + cell.move));
    return { at, hit, moved: at - hit };
  }
  return { at: hit, hit, moved: 0 };
}

/** Бросок пришёл (капитан команды, чья очередь) → фишка идёт, открывается клетка. */
export function rollChange(session: Session, content: QuestContent, answers: Answer[], participants: Participant[]): SessionChange | null {
  if (session.state.stage !== "question") return null;
  const r = parseQuestResult(session.state.result);
  if (r.mode !== "roll" || !r.mover) return null;
  // Бросок до «Назад» (раньше нового времени шага) не считается.
  const since = session.state.startedAt ?? 0;
  const answer = answers.find((a) => a.step === session.state.step && a.pid === r.mover && rec(a.value).roll === true && (a.submittedAt ?? 0) >= since);
  if (!answer) return null;
  const change = applyRoll(session, content, dieOf(answer), participants);
  // Пустая запись (ходить некому) — записывать нечего.
  return change.state ? change : null;
}

/** Ведущий бросает за команду (кубик на пульте или в репетиции). */
export function applyRoll(session: Session, content: QuestContent, roll: number, participants: Participant[]): SessionChange {
  const r = parseQuestResult(session.state.result);
  const mover = r.mover;
  if (!mover) return {};
  const from = r.pos[mover] ?? 0;
  const { at, hit, moved } = land(content, from, roll);
  const finish = finishOf(content);
  const cell = cellAt(content, at);
  const pos = { ...r.pos, [mover]: at };
  const finished = at >= finish;
  // Пропуск хода — со следующего круга.
  const skip = cell?.kind === "skip" && !r.skip.includes(mover) ? [...r.skip, mover] : r.skip;
  const prev: Prev = { turn: r.turn, pos: r.pos, skip: r.skip, points: 0, mover, finished: r.finished, final: r.final };
  const base: QuestResult = { ...r, pos, skip, roll, from, at, hit, moved, outcome: null, points: 0, skipped: [], prev };
  if (finished) {
    // Место прихода и бонус; первый финиш открывает последний круг — доходят те, кто в очереди после него.
    const before = r.finished.filter((p) => p !== mover);
    const bonus = finishBonus(content.finishPoints, before.length);
    const done = [...before, mover];
    const final: QuestFinal = r.final ?? { why: "finish", left: restOfRound(r.order, mover, done) };
    const change: SessionChange = {
      state: { stage: "reveal", revealed: true, result: write({ ...base, mode: "finish", winner: done[0] ?? mover, finished: done, final, points: bonus }) },
      leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode),
    };
    if (bonus > 0) change.addScore = { [mover]: bonus };
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

/** Следующая команда (кто пропускает ход — пропускает его, метка снимается). В последнем круге — следующий из `final.left`. */
export function nextTurn(session: Session, participants: Participant[] = []): SessionChange {
  const r = parseQuestResult(session.state.result);
  // Очередь обновляется при смене хода: опоздавшие встают на старт, убранные выпадают.
  const order = orderOf(session, participants, r);
  const pos: Record<string, number> = {};
  for (const p of order) pos[p] = r.pos[p] ?? 0;
  const skip = r.skip.filter((p) => order.includes(p));
  const skipped: string[] = [];
  const before = makeBefore("reveal", write(r), session.state.answered);
  const roll = (next: QuestResult): SessionChange => ({
    state: { step: session.state.step + 1, stage: "question", startedAt: "server", timeLimit: null, revealed: false, answered: 0, result: write(next) },
  });
  if (r.final) {
    // Последний круг: ходят по очереди те, кто остался; пропуск хода в нём тоже действует.
    const left = r.final.left.filter((p) => order.includes(p) && !r.finished.includes(p));
    let mover: string | null = null;
    while (left.length > 0) {
      const who = left.shift() as string;
      if (!skip.includes(who)) {
        mover = who;
        break;
      }
      skip.splice(skip.indexOf(who), 1);
      skipped.push(who);
    }
    const final: QuestFinal = { ...r.final, left };
    const common = { ...r, order, pos, skip, skipped, final, roll: null, outcome: null, points: 0, before };
    if (!mover) {
      // Круг доигран — итоги и награждение («Назад» вернёт прошлый ход через `before`).
      return {
        state: { step: session.state.step + 1, stage: "reveal", startedAt: null, timeLimit: null, revealed: true, answered: 0, result: write({ ...common, mode: "over", mover: null, prev: null }) },
      };
    }
    return roll({ ...common, mode: "roll", mover, turn: order.indexOf(mover) });
  }
  const at = r.mover ? order.indexOf(r.mover) : -1;
  let turn = (at >= 0 ? at : r.turn) + 1;
  for (let guard = 0; guard < order.length; guard++) {
    const who = order[turn % Math.max(1, order.length)];
    if (!who || !skip.includes(who)) break;
    skip.splice(skip.indexOf(who), 1);
    skipped.push(who);
    // Одна команда — пропуск просто снимается, ходит она же.
    if (order.length === 1) break;
    turn += 1;
  }
  const next: QuestResult = { ...r, order, pos, turn, skip, skipped, mode: "roll", mover: null, roll: null, outcome: null, points: 0, before };
  next.mover = moverOf(next);
  return roll(next);
}

/** Ведущий объявляет последний круг: доходят те, кто в очереди после текущего хода, потом награждение. */
export function declareFinal(session: Session): SessionChange | null {
  const { stage } = session.state;
  const r = parseQuestResult(session.state.result);
  if (r.final || stage === "ready" || stage === "podium" || r.mode === "finish" || r.mode === "over" || !r.mover) return null;
  return { state: { result: write({ ...r, final: { why: "host", left: restOfRound(r.order, r.mover, r.finished) } }) } };
}

/** Отменить последний круг, объявленный ведущим (пока никто не финишировал). */
export function cancelFinal(session: Session): SessionChange | null {
  const r = parseQuestResult(session.state.result);
  if (!r.final || r.final.why !== "host" || r.finished.length > 0 || r.mode === "over") return null;
  return { state: { result: write({ ...r, final: null }) } };
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
  // Итоги круга — к последнему ходу (как он был).
  if (stage === "reveal" && r.mode === "over") return r.before ? { change: beforeChange(step, r.before), clear: [step] } : null;
  if (stage === "reveal" && r.prev) {
    // Отменить ход: фишка обратно, очки сняты, команда бросает заново. Финиш отменяется вместе с последним кругом,
    // который он открыл; круг, объявленный ведущим после броска, остаётся.
    const p = r.prev;
    const final = r.mode === "finish" ? p.final : r.final;
    const change: SessionChange = {
      state: {
        stage: "question",
        revealed: false,
        startedAt: "server",
        result: write({ ...r, turn: p.turn, pos: p.pos, skip: p.skip, finished: p.finished, final, mode: "roll", mover: p.mover, roll: null, outcome: null, points: 0, winner: p.finished[0] ?? null, skipped: [], prev: null }),
      },
    };
    const minus = r.mode === "finish" ? r.points : r.outcome === "ok" ? r.points : 0;
    if (minus > 0 && p.mover) change.addScore = { [p.mover]: -minus };
    return { change, clear: [step] };
  }
  if (stage === "question" && r.mode === "roll") {
    // Бросок следующей команды — к итогу прошлого хода (бросок очков не начислял, прошлый ход — целиком как был).
    if (r.before) return { change: beforeChange(step, r.before), clear: [step] };
    // Первый бросок партии — к «Начать игру»: все на старте, пропусков нет — терять нечего.
    if (!r.prev && r.skip.length === 0 && Object.values(r.pos).every((n) => n === 0)) return { change: { state: { stage: "ready", startedAt: null, timeLimit: null, revealed: false, answered: 0, result: {} } }, clear: [step] };
  }
  return null;
}
