// Ход «Держи пари» — чистые функции.
//
// «Начать игру» → заставка вопроса (`ready`) → «Показать вопрос» (шаг `question`, таймер `guessTime`): капитаны
// пишут догадку `{ guess }` (можно исправить до конца времени) → «Разложить ответы и открыть ставки» (новый шаг,
// таймер `betTime`): на поле догадки по возрастанию с коэффициентами, капитаны ставят до двух фишек
// `{ bets: [{ slot, stake }] }` (slot −1 — «меньше всех»; stake — свои очки сверху, можно 0) → «Показать ответ»:
// выигрывает догадка ближе всех, но не больше правды (все больше — «меньше всех» 6:1); фишка на ней — chipPoints ×
// коэффициент, свои очки на ней — ×коэффициент, на других ячейках свои очки сгорают; автору верной догадки —
// authorBonus → «Следующий вопрос» … → награждение. «Назад» — с каждого этапа (очки снимаются).
import { leaderboardAdditions } from "../../core/leaderboard";
import { hasPodium, podiumBack, podiumDone } from "../../core/podium";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import type { ScoreDelta, Step } from "../types";
import { cleanNumber, layoutSlots, oddsOf, WAGER_LIMITS, winningSlot, type Slot, type WagerContent } from "./content";

export type WagerMode = "guess" | "bet" | "answer";

export interface Bet {
  slot: number;
  stake: number;
}

interface Prev {
  q: number;
  slots: Slot[];
  win: number;
  payouts: Record<string, number>;
  guessed: string[];
  bets: Record<string, Bet[]>;
}

export interface WagerResult {
  /** Номер вопроса. */
  q: number;
  mode: WagerMode;
  /** Кто уже написал догадку (без чисел — числа видит только пульт до раскладки). */
  guessed: string[];
  /** Поле этого вопроса. */
  slots: Slot[];
  /** Сколько фишек на каждой ячейке сейчас (−1 — «меньше всех»): ключ — номер ячейки. */
  chips: Record<string, number>;
  /** Ставки команд — после «Показать ответ». */
  bets: Record<string, Bet[]>;
  /** Выигравшая ячейка (−1 — «меньше всех»); до ответа — null. */
  win: number | null;
  /** Изменение очков за вопрос (для экрана и «Назад»). */
  payouts: Record<string, number>;
  /** Ответ можно менять до конца времени. */
  changeable: boolean;
  /** Когда показали вопрос (время сервера) — «Назад» со ставок возвращает тот же показ. */
  guessStartedAt: number | null;
  /** Итог прошлого вопроса — «Назад» с заставки следующего. */
  prev: Prev | null;
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && ID.test(x)))].slice(0, 300) : []);
function nums(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(rec(v))) if (/^-?[A-Za-z0-9_-]{1,128}$/.test(k) && typeof n === "number" && Number.isFinite(n)) out[k] = Math.round(n);
  return out;
}
function slotsOf(v: unknown): Slot[] {
  return (Array.isArray(v) ? v : []).slice(0, WAGER_LIMITS.slots).map((s) => {
    const d = rec(s);
    return { value: cleanNumber(d.value) ?? 0, odds: typeof d.odds === "number" ? Math.min(6, Math.max(2, Math.round(d.odds))) : 2, authors: ids(d.authors) };
  });
}
function betsOf(v: unknown): Record<string, Bet[]> {
  const out: Record<string, Bet[]> = {};
  for (const [k, list] of Object.entries(rec(v))) {
    if (!ID.test(k) || !Array.isArray(list)) continue;
    out[k] = list.slice(0, WAGER_LIMITS.chips).map((b) => {
      const d = rec(b);
      return { slot: typeof d.slot === "number" ? Math.round(d.slot) : -1, stake: typeof d.stake === "number" && d.stake > 0 ? Math.round(d.stake) : 0 };
    });
  }
  return out;
}
const winOf = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= -1 ? v : null);

export function parseWagerResult(raw: unknown): WagerResult {
  const d = rec(raw);
  const p = rec(d.prev);
  return {
    q: typeof d.q === "number" && Number.isInteger(d.q) && d.q >= 0 ? d.q : 0,
    mode: d.mode === "bet" || d.mode === "answer" ? d.mode : "guess",
    guessed: ids(d.guessed),
    slots: slotsOf(d.slots),
    chips: nums(d.chips),
    bets: betsOf(d.bets),
    win: winOf(d.win),
    payouts: nums(d.payouts),
    changeable: d.changeable === true,
    guessStartedAt: typeof d.guessStartedAt === "number" && Number.isFinite(d.guessStartedAt) ? d.guessStartedAt : null,
    prev:
      typeof p.q === "number"
        ? { q: p.q, slots: slotsOf(p.slots), win: winOf(p.win) ?? -1, payouts: nums(p.payouts), guessed: ids(p.guessed), bets: betsOf(p.bets) }
        : null,
  };
}

const write = (r: WagerResult): Record<string, unknown> => ({ ...r });

export function wagerSteps(content: WagerContent): Step[] {
  return content.questions.map((q) => ({ id: q.id, answerable: true }));
}

/** Очки начисляет пульт по ставкам — подсчёт по шагу не нужен. */
export function score(): ScoreDelta[] {
  return [];
}

/**
 * Ответы только этого показа шага (после «Назад» старые не считаются). Догадки — с первого показа вопроса:
 * «Назад» со ставок к догадкам заново запускает таймер, но написанные догадки остаются.
 */
function current(session: Session, answers: Answer[]): Answer[] {
  const r = parseWagerResult(session.state.result);
  const since = (r.mode === "guess" ? r.guessStartedAt : null) ?? session.state.startedAt ?? 0;
  return answers.filter((a) => a.step === session.state.step && (a.submittedAt ?? 0) >= since);
}

/** Догадки участников таблицы (капитан — за команду). */
export function guessesOf(session: Session, answers: Answer[]): Array<{ pid: string; value: number }> {
  const out = new Map<string, number>();
  for (const a of current(session, answers)) {
    if (!session.leaderboard[a.pid]) continue;
    const value = cleanNumber(rec(a.value).guess);
    if (value !== null) out.set(a.pid, value);
  }
  return [...out].map(([pid, value]) => ({ pid, value }));
}

/** Ставки: не больше двух фишек, ячейка — на поле или «меньше всех», свои очки — не больше счёта (по порядку). */
export function betsFrom(session: Session, answers: Answer[], slots: Slot[], stakes: boolean): Record<string, Bet[]> {
  const out: Record<string, Bet[]> = {};
  for (const a of current(session, answers)) {
    const entry = session.leaderboard[a.pid];
    if (!entry) continue;
    const raw = rec(a.value).bets;
    if (!Array.isArray(raw)) continue;
    let left = stakes ? Math.max(0, entry.score) : 0;
    const list: Bet[] = [];
    for (const b of raw.slice(0, WAGER_LIMITS.chips)) {
      const d = rec(b);
      const slot = typeof d.slot === "number" ? Math.round(d.slot) : NaN;
      if (!(slot === -1 || (slot >= 0 && slot < slots.length))) continue;
      const want = typeof d.stake === "number" && Number.isFinite(d.stake) ? Math.max(0, Math.round(d.stake)) : 0;
      const stake = Math.min(want, left);
      left -= stake;
      list.push({ slot, stake });
    }
    if (list.length > 0) out[a.pid] = list;
  }
  return out;
}

/** Фишки на ячейках — живой счёт для экрана. */
export function chipCounts(bets: Record<string, Bet[]>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const list of Object.values(bets)) for (const b of list) out[String(b.slot)] = (out[String(b.slot)] ?? 0) + 1;
  return out;
}

/** Выплаты: фишка на верной ячейке — chipPoints × коэффициент, свои очки на ней — ×коэффициент, на других — сгорают; автору — бонус. */
export function payoutsOf(content: WagerContent, slots: Slot[], bets: Record<string, Bet[]>, win: number): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (pid: string, n: number) => {
    if (n !== 0) out[pid] = (out[pid] ?? 0) + n;
  };
  const odds = oddsOf(slots, win);
  for (const [pid, list] of Object.entries(bets)) {
    for (const b of list) add(pid, b.slot === win ? content.chipPoints * odds + b.stake * odds : -b.stake);
  }
  if (win >= 0) for (const author of slots[win]?.authors ?? []) add(author, content.authorBonus);
  return out;
}

export type WagerAction = "show" | "bets" | "reveal" | "next" | "podium" | "podiumNext" | "finish";

export function wagerPrimary(session: Session, content: WagerContent): WagerAction {
  const { stage } = session.state;
  const r = parseWagerResult(session.state.result);
  if (stage === "podium") return podiumDone(session) ? "finish" : "podiumNext";
  if (stage === "ready") return content.questions[r.q] ? "show" : "finish";
  if (r.mode === "guess") return "bets";
  if (r.mode === "bet") return "reveal";
  if (r.q + 1 < content.questions.length) return "next";
  return hasPodium(session.leaderboard) ? "podium" : "finish";
}

function fresh(q: number, prev: Prev | null): WagerResult {
  return { q, mode: "guess", guessed: [], slots: [], chips: {}, bets: {}, win: null, payouts: {}, changeable: false, guessStartedAt: null, prev };
}

/** «Показать вопрос»: новый шаг, таймер догадки. */
export function showQuestion(session: Session, content: WagerContent, participants: Participant[]): SessionChange {
  const r = parseWagerResult(session.state.result);
  if (session.state.stage !== "ready" || !content.questions[r.q]) return {};
  return {
    state: { step: session.state.step + 1, stage: "question", startedAt: "server", timeLimit: content.guessTime, revealed: false, answered: 0, result: write({ ...fresh(r.q, r.prev), changeable: true }) },
    leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode),
  };
}

/** Живой счёт «кто написал догадку» и фишки на поле — для экрана; null — без изменений. */
export function liveProgress(session: Session, content: WagerContent, answers: Answer[]): SessionChange | null {
  const r = parseWagerResult(session.state.result);
  if (session.state.stage !== "question") return null;
  if (r.mode === "guess") {
    const guessed = guessesOf(session, answers).map((g) => g.pid).sort();
    if (guessed.join(",") === [...r.guessed].sort().join(",")) return null;
    return { state: { answered: guessed.length, result: write({ ...r, guessed }) } };
  }
  if (r.mode === "bet") {
    const bets = betsFrom(session, answers, r.slots, content.stakes);
    const chips = chipCounts(bets);
    const same = Object.keys(chips).length === Object.keys(r.chips).length && Object.entries(chips).every(([k, n]) => r.chips[k] === n);
    if (same) return null;
    return { state: { answered: Object.keys(bets).length, result: write({ ...r, chips }) } };
  }
  return null;
}

/** «Разложить ответы и открыть ставки»: поле по догадкам, новый шаг с таймером ставок. */
export function openBets(session: Session, content: WagerContent, answers: Answer[]): SessionChange {
  const r = parseWagerResult(session.state.result);
  if (r.mode !== "guess" || session.state.stage !== "question") return {};
  const guesses = guessesOf(session, answers);
  const slots = layoutSlots(guesses);
  return {
    state: {
      step: session.state.step + 1,
      stage: "question",
      startedAt: "server",
      timeLimit: content.betTime,
      revealed: false,
      answered: 0,
      result: write({ ...r, mode: "bet", guessed: guesses.map((g) => g.pid), slots, chips: {}, changeable: true, guessStartedAt: r.guessStartedAt ?? session.state.startedAt }),
    },
  };
}

/** «Показать ответ»: выигравшая ячейка, выплаты по ставкам, бонус автору. */
export function revealAnswer(session: Session, content: WagerContent, answers: Answer[]): SessionChange {
  const r = parseWagerResult(session.state.result);
  const question = content.questions[r.q];
  if (r.mode !== "bet" || !question) return {};
  const bets = betsFrom(session, answers, r.slots, content.stakes);
  const win = winningSlot(r.slots, question.answer);
  const payouts = payoutsOf(content, r.slots, bets, win);
  const change: SessionChange = {
    state: { stage: "reveal", revealed: true, timeLimit: null, result: write({ ...r, mode: "answer", bets, chips: chipCounts(bets), win, payouts, changeable: false }) },
  };
  if (Object.keys(payouts).length > 0) change.addScore = payouts;
  return change;
}

/** «Следующий вопрос»: заставка следующего (шаг тот же — новый шаг даст «Показать вопрос»). */
export function nextQuestion(session: Session): SessionChange {
  const r = parseWagerResult(session.state.result);
  if (r.mode !== "answer") return {};
  const prev: Prev = { q: r.q, slots: r.slots, win: r.win ?? -1, payouts: r.payouts, guessed: r.guessed, bets: r.bets };
  return { state: { stage: "ready", revealed: false, startedAt: null, timeLimit: null, answered: 0, result: write(fresh(r.q + 1, prev)) } };
}

export interface WagerBack {
  change: SessionChange;
  /** Ответы этих шагов стереть (их показ отменён). */
  clear?: number[];
}

/** «Назад» — на этап раньше; очки и ответы этапа снимаются. */
export function wagerBack(session: Session, content: WagerContent): WagerBack | null {
  const { stage, step } = session.state;
  const r = parseWagerResult(session.state.result);
  if (stage === "podium") return { change: podiumBack(session) };
  if (stage === "ready") {
    if (!r.prev) return null;
    const p = r.prev;
    // Назад к ответу прошлого вопроса: очки остаются начисленными.
    return { change: { state: { stage: "reveal", revealed: true, startedAt: null, timeLimit: null, result: write({ ...fresh(p.q, null), mode: "answer", slots: p.slots, win: p.win, payouts: p.payouts, guessed: p.guessed, bets: p.bets, chips: chipCounts(p.bets) }) } } };
  }
  if (r.mode === "guess") return { change: { state: { step: step - 1, stage: "ready", revealed: false, startedAt: null, timeLimit: null, answered: 0, result: write(fresh(r.q, r.prev)) } }, clear: [step] };
  if (r.mode === "bet") {
    // К догадкам: поле убирается, догадки остаются (считаются с первого показа — guessStartedAt), таймер заново.
    return { change: { state: { step: step - 1, stage: "question", startedAt: "server", timeLimit: content.guessTime, revealed: false, answered: r.guessed.length, result: write({ ...r, mode: "guess", slots: [], chips: {}, changeable: true }) } }, clear: [step] };
  }
  const minus = Object.fromEntries(Object.entries(r.payouts).map(([p, n]) => [p, -n]));
  const change: SessionChange = { state: { stage: "question", revealed: false, result: write({ ...r, mode: "bet", win: null, payouts: {}, bets: {}, changeable: true }) } };
  if (Object.keys(minus).length > 0) change.addScore = minus;
  return { change };
}
