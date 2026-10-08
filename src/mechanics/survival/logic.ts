// Ход «Гонки на выживание» — чистые функции.
//
// Раунд: заставка (`ready`) → [аукцион билета, если ведущий поставил его на этот раунд] → вопрос или
// задание (`question`) → «Показать ответ» / «Засчитать» (`reveal`) → следующий раунд. Раунд-войнушка:
// заставка → ставки на телефонах капитанов (`{ bet }` или `{ ticket: true }` — билет освобождения) →
// «Ставки приняты» (у кого ставки нет или она меньше половины счёта — ставится половина) → вопрос
// «кто первый верно» → победитель забирает банк (все ставки + приз), остальные теряют ставку; верных нет —
// ставки сгорают. Никто не выбывает: после последнего раунда — награждение по очкам.
import { leaderboardAdditions, scoringParticipants } from "../../core/leaderboard";
import { hasPodium, podiumBack, podiumDone } from "../../core/podium";
import { MAX_SCORE_DELTA } from "../../core/session";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import { matchesAnswer } from "../quiz/normalize";
import type { ScoreDelta, Step } from "../types";
import { acceptedAnswers, isWar, warIndex, type SurvivalContent, type SurvivalRound } from "./content";

export type SurvivalPhase = "intro" | "auction" | "auctionDone" | "play" | "bet" | "war" | "reveal" | "over";

export interface SurvivalResult {
  /** Номер раунда с 0. */
  round: number;
  phase: SurvivalPhase;
  order: string[];
  /** Билеты освобождения у команд. */
  tickets: Record<string, number>;
  /** Раунды (с 1), где аукцион уже прошёл. */
  auctioned: number[];
  /** Войнушка: принятые ставки, кто пропустил по билету, банк, приз, победитель. */
  bets: Record<string, number>;
  freed: string[];
  bank: number;
  prize: number;
  winner: string | null;
  /** Аукцион: кто купил билет и за сколько. */
  bid: { pid: string; amount: number } | null;
  /** Задание / открытый вопрос: кому ведущий засчитал. */
  marks: string[];
  /** Начисленное на показе (для «Назад»). */
  deltas: Record<string, number>;
  /** Билеты до ставок (для «Назад» с вопроса войнушки). */
  prevTickets: Record<string, number> | null;
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && ID.test(x)))].slice(0, 200) : []);
const pid = (v: unknown) => (typeof v === "string" && ID.test(v) ? v : null);
const nat = (v: unknown, def = 0) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : def);
function counts(v: unknown, signed = false): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(rec(v))) if (ID.test(k) && typeof n === "number" && Number.isFinite(n) && (signed || n >= 0)) out[k] = Math.round(n);
  return out;
}
const PHASES: SurvivalPhase[] = ["intro", "auction", "auctionDone", "play", "bet", "war", "reveal", "over"];

export function parseSurvivalResult(raw: unknown): SurvivalResult {
  const d = rec(raw);
  const b = rec(d.bid);
  const prev = d.prevTickets;
  return {
    round: nat(d.round),
    phase: PHASES.includes(d.phase as SurvivalPhase) ? (d.phase as SurvivalPhase) : "intro",
    order: ids(d.order),
    tickets: counts(d.tickets),
    auctioned: Array.isArray(d.auctioned) ? [...new Set(d.auctioned.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0))] : [],
    bets: counts(d.bets),
    freed: ids(d.freed),
    bank: nat(d.bank),
    prize: nat(d.prize),
    winner: pid(d.winner),
    bid: pid(b.pid) ? { pid: b.pid as string, amount: nat(b.amount) } : null,
    marks: ids(d.marks),
    deltas: counts(d.deltas, true),
    prevTickets: prev && typeof prev === "object" ? counts(prev) : null,
  };
}

const write = (r: SurvivalResult): Record<string, unknown> => ({ ...r });

export function survivalSteps(content: SurvivalContent): Step[] {
  return content.rounds.map((r) => ({ id: r.id, answerable: true }));
}

export function score(): ScoreDelta[] {
  return [];
}

export function roundOf(content: SurvivalContent, r: SurvivalResult): SurvivalRound | null {
  return content.rounds[r.round] ?? null;
}

/** Номер раунда с 1. */
export const roundNumber = (r: SurvivalResult) => r.round + 1;

export function isWarRound(content: SurvivalContent, r: SurvivalResult): boolean {
  return isWar(content, roundNumber(r));
}

/** Будет ли перед этим раундом аукцион (и он ещё не прошёл). */
export function auctionPending(content: SurvivalContent, r: SurvivalResult): boolean {
  return content.tickets.includes(roundNumber(r)) && !r.auctioned.includes(roundNumber(r));
}

/** Минимальная ставка в войнушке — половина счёта (вверх). */
export function minBet(score: number): number {
  return Math.max(0, Math.ceil(Math.max(0, score) / 2));
}

function orderOf(session: Session, participants: Participant[], r: SurvivalResult): string[] {
  const joined = [...scoringParticipants(participants, session.playMode)].sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0) || a.id.localeCompare(b.id)).map((p) => p.id);
  const known = new Set([...joined, ...Object.keys(session.leaderboard)]);
  return [...new Set([...r.order.filter((p) => known.has(p)), ...joined, ...Object.keys(session.leaderboard)])];
}

const scoreOf = (session: Session, p: string) => session.leaderboard[p]?.score ?? 0;

/** Изменение очков: прибавкой, а суммы больше лимита прибавки — записью таблицы целиком. */
function applyDeltas(session: Session, participants: Participant[], deltas: Record<string, number>): Pick<SessionChange, "addScore" | "leaderboard"> {
  const additions = leaderboardAdditions(session.leaderboard, participants, session.playMode);
  const nonzero = Object.fromEntries(Object.entries(deltas).filter(([, n]) => n !== 0));
  if (Object.values(nonzero).every((n) => Math.abs(n) <= MAX_SCORE_DELTA)) {
    return Object.keys(nonzero).length > 0 ? { addScore: nonzero, leaderboard: additions } : { leaderboard: additions };
  }
  const board = { ...additions };
  for (const [p, n] of Object.entries(nonzero)) {
    const entry = board[p] ?? session.leaderboard[p];
    if (entry) board[p] = { ...entry, score: entry.score + n, last: n };
  }
  return { leaderboard: board };
}

const negate = (d: Record<string, number>) => Object.fromEntries(Object.entries(d).map(([k, n]) => [k, -n]));

export type SurvivalAction = "start" | "auction" | "auctionDone" | "afterAuction" | "bets" | "betsDone" | "show" | "reveal" | "next" | "podium" | "podiumNext" | "finish";

export function survivalPrimary(session: Session, content: SurvivalContent): SurvivalAction {
  const { stage } = session.state;
  const r = parseSurvivalResult(session.state.result);
  if (stage === "podium") return podiumDone(session) ? "finish" : "podiumNext";
  if (r.phase === "over") return hasPodium(session.leaderboard) ? "podium" : "finish";
  if (r.order.length === 0) return "start";
  if (r.phase === "intro") return auctionPending(content, r) ? "auction" : isWarRound(content, r) ? "bets" : "show";
  if (r.phase === "auction") return "auctionDone";
  if (r.phase === "auctionDone") return "afterAuction";
  if (r.phase === "bet") return "betsDone";
  if (r.phase === "play" || r.phase === "war") return "reveal";
  return "next";
}

function fresh(r: SurvivalResult): SurvivalResult {
  return { ...r, bets: {}, freed: [], bank: 0, prize: 0, winner: null, bid: null, marks: [], deltas: {}, prevTickets: null };
}

/** «Начать игру»: команды в порядке подключения, раунд 1. */
export function startSurvival(session: Session, participants: Participant[]): SessionChange {
  const r = parseSurvivalResult(session.state.result);
  const order = orderOf(session, participants, r);
  return {
    state: { stage: "ready", startedAt: null, timeLimit: null, revealed: false, answered: 0, result: write({ ...fresh(r), round: 0, phase: "intro", order, tickets: {}, auctioned: [] }) },
    leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode),
  };
}

const open = (step: number, timeLimit: number | null, result: SurvivalResult): SessionChange => ({
  state: { step: step + 1, stage: "question", startedAt: "server", timeLimit, revealed: false, answered: 0, result: write(result) },
});

/** Аукцион билета: ставки на телефонах. */
export function openAuction(session: Session, content: SurvivalContent): SessionChange {
  const r = parseSurvivalResult(session.state.result);
  return open(session.state.step, content.auctionSeconds, { ...fresh(r), phase: "auction" });
}

function since(session: Session, answers: Answer[]): Answer[] {
  const from = session.state.startedAt ?? 0;
  return answers.filter((a) => a.step === session.state.step && (a.submittedAt ?? 0) >= from);
}

/** Итоги аукциона: больше всех поставивший (при равных — кто раньше) платит ставку и берёт билет. */
export function finishAuction(session: Session, answers: Answer[], participants: Participant[]): SessionChange {
  const r = parseSurvivalResult(session.state.result);
  let best: { pid: string; amount: number; at: number } | null = null;
  for (const a of since(session, answers)) {
    if (!r.order.includes(a.pid)) continue;
    const raw = rec(a.value).bid;
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    const amount = Math.min(Math.max(0, Math.floor(raw)), Math.max(0, scoreOf(session, a.pid)));
    if (amount <= 0) continue;
    const at = a.submittedAt ?? 0;
    if (!best || amount > best.amount || (amount === best.amount && at < best.at)) best = { pid: a.pid, amount, at };
  }
  const number = roundNumber(r);
  const auctioned = [...r.auctioned, number];
  if (!best) return { state: { stage: "reveal", revealed: true, result: write({ ...r, phase: "auctionDone", auctioned, bid: null, deltas: {} }) } };
  const deltas = { [best.pid]: -best.amount };
  const tickets = { ...r.tickets, [best.pid]: (r.tickets[best.pid] ?? 0) + 1 };
  return {
    state: { stage: "reveal", revealed: true, result: write({ ...r, phase: "auctionDone", auctioned, tickets, bid: { pid: best.pid, amount: best.amount }, deltas }) },
    ...applyDeltas(session, participants, deltas),
  };
}

/** После аукциона — к самому раунду (заставка). */
export function afterAuction(session: Session): SessionChange {
  const r = parseSurvivalResult(session.state.result);
  return { state: { step: session.state.step + 1, stage: "ready", startedAt: null, timeLimit: null, revealed: false, answered: 0, result: write({ ...fresh(r), phase: "intro" }) } };
}

/** Войнушка: открыть ставки. */
export function openBets(session: Session, content: SurvivalContent): SessionChange {
  const r = parseSurvivalResult(session.state.result);
  return open(session.state.step, content.betSeconds, { ...fresh(r), phase: "bet", prize: content.warPrize * warIndex(content, roundNumber(r)) });
}

/** Ставка команды по её ответу: не меньше половины счёта и не больше счёта. */
export function betOf(score: number, value: unknown): number {
  const raw = rec(value).bet;
  const max = Math.max(0, score);
  const min = minBet(score);
  return typeof raw === "number" && Number.isFinite(raw) ? Math.min(max, Math.max(min, Math.floor(raw))) : min;
}

/** «Ставки приняты»: билет освобождения — без ставки; нет ставки — половина счёта. Открывается вопрос. */
export function closeBets(session: Session, content: SurvivalContent, answers: Answer[], participants: Participant[]): SessionChange {
  const r = parseSurvivalResult(session.state.result);
  const order = orderOf(session, participants, r);
  const got = new Map(since(session, answers).map((a) => [a.pid, a.value]));
  const bets: Record<string, number> = {};
  const freed: string[] = [];
  const tickets = { ...r.tickets };
  for (const p of order) {
    const value = got.get(p);
    if (rec(value).ticket === true && (tickets[p] ?? 0) > 0) {
      freed.push(p);
      tickets[p] = (tickets[p] ?? 0) - 1;
      continue;
    }
    bets[p] = betOf(scoreOf(session, p), value);
  }
  const bank = Object.values(bets).reduce((a, b) => a + b, 0) + r.prize;
  const round = roundOf(content, r);
  return open(session.state.step, round && round.seconds > 0 ? round.seconds : null, { ...r, order, phase: "war", bets, freed, tickets, bank, prevTickets: r.tickets });
}

/** Показать вопрос или задание раунда. */
export function showRound(session: Session, content: SurvivalContent, participants: Participant[]): SessionChange | null {
  const r = parseSurvivalResult(session.state.result);
  const round = roundOf(content, r);
  if (!round) return null;
  const change = open(session.state.step, round.kind !== "task" && round.seconds > 0 ? round.seconds : null, { ...fresh(r), order: orderOf(session, participants, r), phase: "play" });
  return { ...change, leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode) };
}

/** Ведущий отмечает команду (задание выполнено / открытый ответ засчитан). */
export function toggleMark(session: Session, team: string): SessionChange {
  const r = parseSurvivalResult(session.state.result);
  const marks = r.marks.includes(team) ? r.marks.filter((p) => p !== team) : [...r.marks, team];
  return { state: { result: write({ ...r, marks }) } };
}

/** Кто ответил верно на вопрос раунда (без отметок ведущего). */
export function rightTeams(session: Session, content: SurvivalContent, answers: Answer[]): Answer[] {
  const r = parseSurvivalResult(session.state.result);
  const round = roundOf(content, r);
  if (!round || round.kind === "task") return [];
  return since(session, answers)
    .filter((a) => r.order.includes(a.pid))
    .filter((a) => {
      const v = rec(a.value);
      return round.kind === "choice" ? v.choice === round.correct : typeof v.text === "string" && matchesAnswer(v.text, acceptedAnswers(round));
    })
    .sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0));
}

/** «Показать ответ» / «Засчитать»: очки раунда или банк войнушки. */
export function revealRound(session: Session, content: SurvivalContent, answers: Answer[], participants: Participant[]): SessionChange | null {
  const r = parseSurvivalResult(session.state.result);
  const round = roundOf(content, r);
  if (!round) return null;
  const deltas: Record<string, number> = {};
  let winner: string | null = null;
  if (r.phase === "war") {
    const first = rightTeams(session, content, answers).find((a) => a.pid in r.bets);
    winner = first?.pid ?? null;
    for (const [p, bet] of Object.entries(r.bets)) deltas[p] = p === winner ? r.bank - bet : -bet;
  } else {
    const right = new Set([...rightTeams(session, content, answers).map((a) => a.pid), ...r.marks]);
    for (const p of right) if (r.order.includes(p) && round.points > 0) deltas[p] = round.points;
  }
  return {
    state: { stage: "reveal", revealed: true, result: write({ ...r, phase: "reveal", winner, deltas }) },
    ...applyDeltas(session, participants, deltas),
  };
}

/** Следующий раунд или конец гонки. */
export function nextRound(session: Session, content: SurvivalContent, participants: Participant[]): SessionChange {
  const r = parseSurvivalResult(session.state.result);
  const round = r.round + 1;
  const over = round >= content.rounds.length;
  return {
    state: { step: session.state.step + 1, stage: over ? "reveal" : "ready", startedAt: null, timeLimit: null, revealed: over, answered: 0, result: write({ ...fresh(r), round: over ? r.round : round, phase: over ? "over" : "intro", order: orderOf(session, participants, r) }) },
    leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode),
  };
}

export interface SurvivalBack {
  change: SessionChange;
  clear?: number[];
}

export function survivalBack(session: Session, content: SurvivalContent, participants: Participant[]): SurvivalBack | null {
  const { stage, step } = session.state;
  const r = parseSurvivalResult(session.state.result);
  if (stage === "podium") return { change: podiumBack(session) };
  if (r.phase === "reveal") {
    // Снять начисленное и вернуться к вопросу (ведущий может поправить отметки и показать снова).
    return { change: { state: { stage: "question", revealed: false, result: write({ ...r, phase: isWarRound(content, r) ? "war" : "play", winner: null, deltas: {} }) }, ...applyDeltas(session, participants, negate(r.deltas)) } };
  }
  if (r.phase === "auctionDone") {
    const tickets = { ...r.tickets };
    if (r.bid) tickets[r.bid.pid] = Math.max(0, (tickets[r.bid.pid] ?? 0) - 1);
    const number = roundNumber(r);
    return {
      change: { state: { stage: "question", revealed: false, result: write({ ...r, phase: "auction", tickets, auctioned: r.auctioned.filter((n) => n !== number), bid: null, deltas: {} }) }, ...applyDeltas(session, participants, negate(r.deltas)) },
    };
  }
  if (r.phase === "war") {
    // К заставке войнушки: ставки снова открываются заново, билеты возвращаются.
    return { change: { state: { stage: "ready", startedAt: null, timeLimit: null, revealed: false, answered: 0, result: write({ ...fresh(r), phase: "intro", tickets: r.prevTickets ?? r.tickets }) } }, clear: [step] };
  }
  if (r.phase === "play" || r.phase === "bet" || r.phase === "auction") {
    return { change: { state: { stage: "ready", startedAt: null, timeLimit: null, revealed: false, answered: 0, result: write({ ...fresh(r), phase: "intro" }) } }, clear: [step] };
  }
  return null;
}
