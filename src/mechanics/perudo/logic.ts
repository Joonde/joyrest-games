// Ход «Перудо» — чистые функции.
//
// Партия: «Собрать стаканы» (шаг раздачи — телефоны присылают ключи `{ key }`) → «Бросить кости» (новый шаг
// раунда, `nonce` — число раунда; ответы на шаге можно менять, ход телефона помечен номером `n` = `seq`) →
// по кругу ставки `{ n, bid: { q, f } }` → «Не верю!» `{ n, dudo: true }` или «Ровно!» `{ n, calza: true }` →
// вскрытие (`reveal`: все кости на экран, кто теряет кость) → следующий раунд → один стакан остался — итог
// партии (очки) → следующая партия или награждение. «Назад» — одно действие (`prev`).
import { leaderboardAdditions, scoringParticipants } from "../../core/leaderboard";
import { hasPodium, podiumBack, podiumDone } from "../../core/podium";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import type { ScoreDelta, Step } from "../types";
import { PERUDO_LIMITS, type PerudoContent } from "./content";

export interface Bid {
  /** Сколько костей. */
  q: number;
  /** Грань 1…6 (1 — «пако», джокер). */
  f: number;
}

export interface Call {
  kind: "dudo" | "calza";
  by: string;
  bidder: string;
  bid: Bid;
  /** Сколько костей с гранью оказалось (с джокерами, если они действуют). */
  count: number;
  /** Ставка подтвердилась (dudo) / ровно угадано (calza). */
  ok: boolean;
  /** Кто теряет кость; null — никто (calza угадано). */
  loser: string | null;
  /** Кто получает кость назад (calza угадано). */
  gainer: string | null;
  /** Кто выбыл после этого вскрытия. */
  out: string | null;
  /** Очки за вскрытие (выбывшему и победителю) — «Назад» их снимает. */
  points: Record<string, number>;
}

export type PerudoMode = "deal" | "bid" | "reveal" | "over";

export interface PerudoResult {
  mode: PerudoMode;
  party: number;
  /** Стаканы по порядку за столом. */
  seats: string[];
  /** Не поместились за стол (больше 10 стаканов) — ждут следующей партии. */
  waiting: string[];
  /** Шаг, на котором телефоны прислали ключи. */
  keysStep: number | null;
  /** Число раунда: из него и ключа считаются кости. */
  nonce: string;
  round: number;
  /** Сколько костей у каждого стакана. */
  dice: Record<string, number>;
  /** Порядок выбывания в этой партии. */
  out: string[];
  /** Чей ход. */
  turn: string | null;
  /** Последняя ставка и кто её сделал. */
  bid: Bid | null;
  bidder: string | null;
  /** Ставки раунда по порядку. */
  history: Array<{ pid: string; q: number; f: number }>;
  /** Этот раунд — «Палифико». */
  palifico: boolean;
  /** Следующий раунд — «Палифико». */
  palificoNext: boolean;
  /** У кого уже было «Палифико» (раз за партию). */
  palificoDone: string[];
  /** Кто начинает следующий раунд. */
  starter: string | null;
  call: Call | null;
  /** Вскрытые кости раунда. */
  shown: Record<string, number[]> | null;
  /** Номер хода: ответ телефона с другим `n` не в счёт. */
  seq: number;
  /** Ответ телефона на шаге можно менять (сервер перезаписывает). */
  changeable: boolean;
  /**
   * Отпечатки ключей, с которыми пульт бросил кости раунда (`keyPrint`). Телефон показывает кости, только если
   * его ключ совпал: ключ не дошёл до ведущего — кости этого стакана у ведущего, а не «свои» на телефоне.
   */
  prints: Record<string, string>;
  winner: string | null;
  /** Прошлое состояние — «Назад» на одно действие. */
  prev: { step: number; stage: string; result: Omit<PerudoResult, "prev"> } | null;
}

export type PerudoAnswerValue = { key: string } | { n: string; bid: Bid } | { n: string; dudo: true } | { n: string; calza: true };

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const ids = (v: unknown, max = 60): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && ID.test(x)))].slice(0, max) : []);
const pidOrNull = (v: unknown): string | null => (typeof v === "string" && ID.test(v) ? v : null);
const intIn = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);

export function parseBid(v: unknown): Bid | null {
  const d = rec(v);
  const q = intIn(d.q, 1, 200);
  const f = intIn(d.f, 1, 6);
  return q !== null && f !== null ? { q, f } : null;
}

function parseCall(v: unknown): Call | null {
  const d = rec(v);
  const bid = parseBid(d.bid);
  const by = pidOrNull(d.by);
  const bidder = pidOrNull(d.bidder);
  if (!bid || !by || !bidder || (d.kind !== "dudo" && d.kind !== "calza")) return null;
  const points: Record<string, number> = {};
  for (const [k, n] of Object.entries(rec(d.points))) if (ID.test(k) && typeof n === "number" && Number.isFinite(n)) points[k] = n;
  return { kind: d.kind, by, bidder, bid, count: intIn(d.count, 0, 200) ?? 0, ok: d.ok === true, loser: pidOrNull(d.loser), gainer: pidOrNull(d.gainer), out: pidOrNull(d.out), points };
}

function counts(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(rec(v))) if (ID.test(k) && typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= PERUDO_LIMITS.maxDice) out[k] = n;
  return out;
}

function shownOf(v: unknown): Record<string, number[]> | null {
  if (v === null || typeof v !== "object") return null;
  const out: Record<string, number[]> = {};
  for (const [k, list] of Object.entries(rec(v))) if (ID.test(k) && Array.isArray(list)) out[k] = list.filter((x): x is number => typeof x === "number" && x >= 1 && x <= 6).slice(0, PERUDO_LIMITS.maxDice);
  return out;
}

export function emptyResult(): PerudoResult {
  return { mode: "deal", party: 1, seats: [], waiting: [], keysStep: null, nonce: "", round: 0, dice: {}, out: [], turn: null, bid: null, bidder: null, history: [], palifico: false, palificoNext: false, palificoDone: [], starter: null, call: null, shown: null, seq: 0, changeable: false, prints: {}, winner: null, prev: null };
}

function printsOf(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [pid, v] of Object.entries(rec(raw)).slice(0, PERUDO_LIMITS.maxCups)) if (typeof v === "string" && /^h?[0-9a-f]{1,16}$/.test(v)) out[pid] = v;
  return out;
}

function parseFlat(raw: unknown): Omit<PerudoResult, "prev"> {
  const d = rec(raw);
  const base = emptyResult();
  return {
    mode: d.mode === "bid" || d.mode === "reveal" || d.mode === "over" ? d.mode : "deal",
    party: intIn(d.party, 1, 99) ?? 1,
    seats: ids(d.seats, PERUDO_LIMITS.maxCups),
    waiting: ids(d.waiting, 500),
    keysStep: typeof d.keysStep === "number" ? d.keysStep : null,
    nonce: typeof d.nonce === "string" ? d.nonce.slice(0, 40) : "",
    round: intIn(d.round, 0, 10000) ?? 0,
    dice: counts(d.dice),
    out: ids(d.out),
    turn: pidOrNull(d.turn),
    bid: parseBid(d.bid),
    bidder: pidOrNull(d.bidder),
    history: (Array.isArray(d.history) ? d.history : []).slice(-200).flatMap((h) => {
      const b = parseBid(h);
      const pid = pidOrNull(rec(h).pid);
      return b && pid ? [{ pid, ...b }] : [];
    }),
    palifico: d.palifico === true,
    palificoNext: d.palificoNext === true,
    palificoDone: ids(d.palificoDone),
    starter: pidOrNull(d.starter),
    call: parseCall(d.call),
    shown: shownOf(d.shown),
    seq: intIn(d.seq, 0, 1e9) ?? base.seq,
    changeable: d.changeable === true,
    prints: printsOf(d.prints),
    winner: pidOrNull(d.winner),
  };
}

export function parsePerudoResult(raw: unknown): PerudoResult {
  const p = rec(rec(raw).prev);
  const prev = typeof p.step === "number" && typeof p.stage === "string" ? { step: p.step, stage: p.stage, result: parseFlat(p.result) } : null;
  return { ...parseFlat(raw), prev };
}

const flat = (r: PerudoResult): Omit<PerudoResult, "prev"> => {
  const { prev: _p, ...rest } = r;
  return rest;
};

export function perudoSteps(): Step[] {
  return [];
}

export function score(): ScoreDelta[] {
  return [];
}

// ---------------------------------------------------------------- стол

/** Стаканы с костями по порядку. */
export function aliveCups(r: Pick<PerudoResult, "seats" | "dice">): string[] {
  return r.seats.filter((p) => (r.dice[p] ?? 0) > 0);
}

/** Всего костей на столе. */
export function totalDice(r: Pick<PerudoResult, "seats" | "dice">): number {
  return aliveCups(r).reduce((s, p) => s + (r.dice[p] ?? 0), 0);
}

/** Следующий стакан с костями после `pid` (по кругу). */
export function nextCup(r: Pick<PerudoResult, "seats" | "dice">, pid: string | null): string | null {
  const alive = aliveCups(r);
  if (alive.length === 0) return null;
  const i = pid ? r.seats.indexOf(pid) : -1;
  for (let k = 1; k <= r.seats.length; k++) {
    const p = r.seats[(i + k + r.seats.length) % r.seats.length] as string;
    if ((r.dice[p] ?? 0) > 0) return p;
  }
  return null;
}

// ---------------------------------------------------------------- ставки

/**
 * Наименьшее допустимое количество для грани `f` после ставки `prev`; null — эту грань сейчас назвать нельзя.
 * Обычный раунд: больше костей той же или любой грани, или столько же костей старшей грани; на единицы
 * («пако») — не меньше половины (с округлением вверх), с единиц обратно — вдвое больше плюс одна; открывать
 * раунд единицами нельзя. «Палифико»: единицы не джокеры, грань первой ставки не меняется, открыть можно любой.
 */
export function minQty(prev: Bid | null, f: number, palifico: boolean): number | null {
  if (f < 1 || f > 6) return null;
  if (palifico) {
    if (!prev) return 1;
    return f === prev.f ? prev.q + 1 : null;
  }
  if (!prev) return f === 1 ? null : 1;
  if (prev.f === 1) return f === 1 ? prev.q + 1 : prev.q * 2 + 1;
  if (f === 1) return Math.ceil(prev.q / 2);
  return f > prev.f ? prev.q : prev.q + 1;
}

/** Ставка допустима: не меньше наименьшей и не больше костей на столе. */
export function isLegalBid(prev: Bid | null, bid: Bid, palifico: boolean, total: number): boolean {
  const min = minQty(prev, bid.f, palifico);
  return min !== null && bid.q >= min && bid.q <= total && bid.q >= 1;
}

/** Сколько на столе костей с гранью `f`: единицы — джокеры (кроме «Палифико» и ставки на сами единицы). */
export function countFace(shown: Record<string, number[]>, f: number, palifico: boolean): number {
  let n = 0;
  for (const list of Object.values(shown)) for (const d of list) if (d === f || (!palifico && f !== 1 && d === 1)) n++;
  return n;
}

// ---------------------------------------------------------------- ход партии

function orderOf(session: Session, participants: Participant[]): string[] {
  const joined = [...scoringParticipants(participants, session.playMode)].sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0) || a.id.localeCompare(b.id)).map((p) => p.id);
  return [...new Set([...joined, ...Object.keys(session.leaderboard)])];
}

function snapshot(session: Session, r: PerudoResult): PerudoResult["prev"] {
  return { step: session.state.step, stage: session.state.stage, result: flat(r) };
}

/**
 * «Собрать стаканы»: за стол — до 10 стаканов по порядку входа, телефоны присылают ключи. После итога
 * партии — следующая партия: новый шаг, все снова с полным стаканом, очки копятся.
 */
export function startDeal(session: Session, participants: Participant[], content: PerudoContent): SessionChange {
  const additions = leaderboardAdditions(session.leaderboard, participants, session.playMode);
  const all = orderOf({ ...session, leaderboard: { ...session.leaderboard, ...additions } }, participants);
  const prev = session.state.result === null || session.state.result === undefined ? null : parsePerudoResult(session.state.result);
  const next = prev !== null && prev.mode === "over";
  const step = next ? session.state.step + 1 : session.state.step;
  const seats = all.slice(0, PERUDO_LIMITS.maxCups);
  const dice: Record<string, number> = {};
  for (const p of seats) dice[p] = content.startDice;
  const result: PerudoResult = {
    ...emptyResult(),
    party: next ? prev.party + 1 : 1,
    seats,
    waiting: all.slice(PERUDO_LIMITS.maxCups),
    keysStep: step,
    dice,
    // Начинает победитель прошлой партии, иначе первый за столом.
    starter: next && prev.winner && seats.includes(prev.winner) ? prev.winner : (seats[0] ?? null),
    prev: next ? snapshot(session, prev) : null,
  };
  return { leaderboard: additions, state: { step, stage: "question", startedAt: "server", timeLimit: null, revealed: false, answered: 0, result } };
}

/** «Бросить кости»: новый раунд, новое число раунда; ходит `starter`. */
export function startRound(session: Session, nonce: string, prints: Record<string, string> = {}): SessionChange | null {
  const r = parsePerudoResult(session.state.result);
  if (r.mode !== "deal" && r.mode !== "reveal") return null;
  const starter = r.starter && (r.dice[r.starter] ?? 0) > 0 ? r.starter : nextCup(r, r.starter);
  if (!starter || aliveCups(r).length < 2) return null;
  const result: PerudoResult = {
    ...r,
    mode: "bid",
    nonce,
    round: r.round + 1,
    turn: starter,
    bid: null,
    bidder: null,
    history: [],
    palifico: r.palificoNext,
    palificoNext: false,
    call: null,
    shown: null,
    seq: r.seq + 1,
    changeable: true,
    prints,
    prev: snapshot(session, r),
  };
  return { state: { step: session.state.step + 1, stage: "question", startedAt: "server", timeLimit: null, revealed: false, answered: 0, result } };
}

/** Ставка того, чей ход (с телефона или ведущим за стакан). */
export function placeBid(session: Session, pid: string, bid: Bid): SessionChange | null {
  const r = parsePerudoResult(session.state.result);
  if (r.mode !== "bid" || r.turn !== pid || !isLegalBid(r.bid, bid, r.palifico, totalDice(r))) return null;
  const result: PerudoResult = { ...r, bid, bidder: pid, history: [...r.history, { pid, ...bid }], turn: nextCup(r, pid), seq: r.seq + 1, prev: snapshot(session, r) };
  return { state: { result } };
}

/**
 * «Не верю!» или «Ровно!» того, чей ход: вскрытие. `shown` — кости всех стаканов (их знает пульт).
 * Не верю: ставка подтвердилась — кость теряет сказавший, иначе — тот, кто ставил. Ровно: угадал — кость
 * назад (не больше, чем в начале), нет — минус кость. Выбывший получает очки за всех, кто выбыл раньше;
 * последний стакан — победитель (очки за всех и сверху). У кого осталась одна кость — следующий раунд
 * «Палифико» (раз за партию, если за столом хотя бы трое).
 */
export function resolveCall(session: Session, content: PerudoContent, kind: "dudo" | "calza", shown: Record<string, number[]>): SessionChange | null {
  const r = parsePerudoResult(session.state.result);
  const by = r.turn;
  if (r.mode !== "bid" || !by || !r.bid || !r.bidder) return null;
  if (kind === "calza" && !content.calza) return null;
  const count = countFace(shown, r.bid.f, r.palifico);
  const dice = { ...r.dice };
  let ok: boolean;
  let loser: string | null = null;
  let gainer: string | null = null;
  if (kind === "dudo") {
    ok = count >= r.bid.q;
    loser = ok ? by : r.bidder;
  } else {
    ok = count === r.bid.q;
    if (ok) {
      if ((dice[by] ?? 0) < content.startDice) gainer = by;
    } else loser = by;
  }
  if (loser) dice[loser] = Math.max(0, (dice[loser] ?? 0) - 1);
  if (gainer) dice[gainer] = (dice[gainer] ?? 0) + 1;
  const out = loser && dice[loser] === 0 ? loser : null;
  const outList = out ? [...r.out, out] : r.out;
  const addScore: Record<string, number> = {};
  if (out && content.placePoints > 0) addScore[out] = content.placePoints * r.out.length;
  const next = { ...r, dice };
  const alive = aliveCups(next);
  const winner = alive.length === 1 ? (alive[0] as string) : null;
  if (winner) addScore[winner] = (addScore[winner] ?? 0) + content.placePoints * outList.length + content.winPoints;
  // Палифико: стакан потерял предпоследнюю кость.
  const lone = loser && dice[loser] === 1 && (r.dice[loser] ?? 0) === 2 && content.palifico && !r.palificoDone.includes(loser) && alive.length >= 3 ? loser : null;
  // Следующий раунд начинает тот, кто потерял кость (выбыл — следующий за ним); после «Ровно» — сказавший.
  const starterBase = kind === "calza" ? by : (loser ?? by);
  const starter = (dice[starterBase] ?? 0) > 0 ? starterBase : nextCup(next, starterBase);
  const result: PerudoResult = {
    ...r,
    mode: winner ? "over" : "reveal",
    dice,
    out: outList,
    shown,
    call: { kind, by, bidder: r.bidder, bid: r.bid, count, ok, loser, gainer, out, points: addScore },
    palificoNext: lone !== null,
    palificoDone: lone ? [...r.palificoDone, lone] : r.palificoDone,
    starter: lone ?? starter,
    turn: null,
    seq: r.seq + 1,
    changeable: false,
    winner,
    prev: snapshot(session, r),
  };
  return { state: { stage: "reveal", revealed: true, result }, ...(Object.keys(addScore).length > 0 ? { addScore } : {}) };
}

export type PerudoMove = { pid: string; bid: Bid } | { pid: string; call: "dudo" | "calza" };

/** Ход с телефона того, чья очередь, на этот номер хода. */
export function moveFromAnswers(session: Session, answers: Answer[]): PerudoMove | null {
  const r = parsePerudoResult(session.state.result);
  if (r.mode !== "bid" || !r.turn) return null;
  const a = answers.find((x) => x.step === session.state.step && x.pid === r.turn && rec(x.value).n === String(r.seq));
  if (!a) return null;
  const v = rec(a.value);
  if (v.dudo === true && r.bid) return { pid: a.pid, call: "dudo" };
  if (v.calza === true && r.bid) return { pid: a.pid, call: "calza" };
  const bid = parseBid(v.bid);
  return bid ? { pid: a.pid, bid } : null;
}

/** Ключи телефонов с шага раздачи. */
export function keysFrom(answers: Array<{ pid: string; value: unknown; step: number }>, step: number | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (step === null) return out;
  for (const a of answers) {
    if (a.step !== step) continue;
    const k = rec(a.value).key;
    if (typeof k === "string" && k.length >= 16 && k.length <= 80) out[a.pid] = k;
  }
  return out;
}

export type PerudoAction = "deal" | "roll" | "wait" | "nextRound" | "nextParty" | "podium" | "podiumNext" | "finish";

export function perudoPrimary(session: Session, content: PerudoContent): PerudoAction {
  const { stage } = session.state;
  if (stage === "podium") return podiumDone(session) ? "finish" : "podiumNext";
  if (session.state.result === null || session.state.result === undefined) return "deal";
  const r = parsePerudoResult(session.state.result);
  if (r.mode === "deal") return "roll";
  if (r.mode === "bid") return "wait";
  if (r.mode === "reveal") return "nextRound";
  if (r.party < content.parties) return "nextParty";
  return hasPodium(session.leaderboard) ? "podium" : "finish";
}

/** «Назад» на одно действие; null — некуда. */
export function perudoBack(session: Session): { change: SessionChange; clearAnswers?: number } | null {
  if (session.state.stage === "podium") return { change: podiumBack(session) };
  const r = parsePerudoResult(session.state.result);
  if (!r.prev) return null;
  const p = r.prev;
  const stage = p.stage === "question" || p.stage === "reveal" || p.stage === "ready" || p.stage === "board" ? p.stage : "reveal";
  // Очки вскрытия возвращаются.
  const undo: Record<string, number> = {};
  if ((r.mode === "reveal" || r.mode === "over") && r.call && p.result.mode === "bid") for (const [k, n] of Object.entries(r.call.points)) if (n) undo[k] = -n;
  const leftStep = session.state.step !== p.step ? session.state.step : undefined;
  return {
    // Номер хода — новый: прежний ход с телефона остался в ответах шага и не должен лечь на стол снова.
    change: { state: { step: p.step, stage, ...(stage === "question" ? { revealed: false } : { revealed: true }), result: { ...p.result, seq: Math.max(r.seq, p.result.seq) + 1, prev: null } }, ...(Object.keys(undo).length > 0 ? { addScore: undo } : {}) },
    ...(leftStep !== undefined ? { clearAnswers: leftStep } : {}),
  };
}
