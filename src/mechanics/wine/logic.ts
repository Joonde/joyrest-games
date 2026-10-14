// Ход «Винного казино» — чистые функции.
//
// Заставка бутылки (`ready`) → «Открыть ставки» (шаг `question`, таймер `betTime`, ставки можно менять): каждый
// гость (в командах — капитан) раскладывает свои фишки `{ chips: { "country:Италия": 2, ... } }` → пульт пишет на
// экран, сколько фишек на каждой ячейке → «Открыть бутылку»: паспорт вина на экране, фишка на верной ячейке —
// цена фишки × коэффициент категории → «Следующая бутылка» … → награждение. «Назад» — с каждого этапа.
import { leaderboardAdditions, scoreChange } from "../../core/leaderboard";
import { hasPodium, podiumBack, podiumDone } from "../../core/podium";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import type { ScoreDelta, Step } from "../types";
import { boardOf, categoryOfKey, thisYear, winningKeys, type BetCategory, type WineContent } from "./content";

export type WineMode = "bet" | "open";

interface Prev {
  w: number;
  year: number;
  chips: Record<string, number>;
  payouts: Record<string, number>;
  bettors: string[];
}

export interface WineResult {
  /** Номер бутылки. */
  w: number;
  mode: WineMode;
  /** Год, по которому построено поле лет (ставит пульт при «Открыть ставки»). */
  year: number;
  /** Фишки на ячейках (все гости вместе) — для экрана. */
  chips: Record<string, number>;
  /** Кто уже поставил. */
  bettors: string[];
  /** Выплаты за бутылку (для экрана и «Назад»). */
  payouts: Record<string, number>;
  prev: Prev | null;
  changeable: boolean;
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && ID.test(x)))].slice(0, 500) : []);
const KEY = /^[a-z]+:[^\u0000-\u001f]{1,40}$/;
function counts(v: unknown, keyOk: (k: string) => boolean): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(rec(v))) if (keyOk(k) && typeof n === "number" && Number.isFinite(n) && n !== 0) out[k] = Math.round(n);
  return out;
}
const isKey = (k: string) => KEY.test(k) && categoryOfKey(k) !== null;
const yearOf = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 2000 && v <= 2200 ? v : thisYear());

export function parseWineResult(raw: unknown): WineResult {
  const d = rec(raw);
  const p = rec(d.prev);
  return {
    w: typeof d.w === "number" && Number.isInteger(d.w) && d.w >= 0 ? d.w : 0,
    mode: d.mode === "open" ? "open" : "bet",
    year: yearOf(d.year),
    chips: counts(d.chips, isKey),
    bettors: ids(d.bettors),
    payouts: counts(d.payouts, (k) => ID.test(k)),
    prev: typeof p.w === "number" ? { w: p.w, year: yearOf(p.year), chips: counts(p.chips, isKey), payouts: counts(p.payouts, (k) => ID.test(k)), bettors: ids(p.bettors) } : null,
    changeable: d.changeable === true,
  };
}

const write = (r: WineResult): Record<string, unknown> => ({ ...r });

export function wineSteps(content: WineContent): Step[] {
  return content.wines.map((w) => ({ id: w.id, answerable: true }));
}

/** Очки начисляет пульт при «Открыть бутылку». */
export function score(): ScoreDelta[] {
  return [];
}

/** Ставки одного гостя: только ячейки поля, всего не больше `chips` фишек (лишние отбрасываются по порядку). */
export function cleanChips(content: WineContent, raw: unknown, year: number): Record<string, number> {
  const board = boardOf(content, year);
  const valid = new Set(Object.values(board).flatMap((list) => list.map((o) => o.key)));
  const out: Record<string, number> = {};
  let left = content.chips;
  for (const [k, n] of Object.entries(rec(rec(raw).chips))) {
    if (!valid.has(k) || typeof n !== "number" || !Number.isFinite(n)) continue;
    const take = Math.min(Math.max(0, Math.floor(n)), left);
    if (take <= 0) continue;
    out[k] = (out[k] ?? 0) + take;
    left -= take;
  }
  return out;
}

/** Ставки этого показа шага по участникам таблицы. */
export function betsOf(session: Session, content: WineContent, answers: Answer[]): Record<string, Record<string, number>> {
  const r = parseWineResult(session.state.result);
  const since = session.state.startedAt ?? 0;
  const out: Record<string, Record<string, number>> = {};
  for (const a of answers) {
    if (a.step !== session.state.step || (a.submittedAt ?? 0) < since || !session.leaderboard[a.pid]) continue;
    const chips = cleanChips(content, a.value, r.year);
    if (Object.keys(chips).length > 0) out[a.pid] = chips;
  }
  return out;
}

function totalChips(bets: Record<string, Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const chips of Object.values(bets)) for (const [k, n] of Object.entries(chips)) out[k] = (out[k] ?? 0) + n;
  return out;
}

/** Выплаты: фишка на верной ячейке — цена фишки × коэффициент категории. Фишки бесплатные: проигрыш — без минуса. */
export function payoutsOf(content: WineContent, bets: Record<string, Record<string, number>>, win: Record<BetCategory, string>): Record<string, number> {
  const winning = new Map(Object.entries(win).map(([cat, key]) => [key, content.odds[cat as BetCategory]]));
  const out: Record<string, number> = {};
  for (const [pid, chips] of Object.entries(bets)) {
    let sum = 0;
    for (const [k, n] of Object.entries(chips)) sum += (winning.get(k) ?? 0) * n * content.chipValue;
    if (sum > 0) out[pid] = sum;
  }
  return out;
}

export type WineAction = "bets" | "open" | "next" | "podium" | "podiumNext" | "finish";

export function winePrimary(session: Session, content: WineContent): WineAction {
  const { stage } = session.state;
  const r = parseWineResult(session.state.result);
  if (stage === "podium") return podiumDone(session) ? "finish" : "podiumNext";
  if (stage === "ready") return content.wines[r.w] ? "bets" : "finish";
  if (r.mode === "bet") return "open";
  if (r.w + 1 < content.wines.length) return "next";
  return hasPodium(session.leaderboard) ? "podium" : "finish";
}

function fresh(w: number, prev: Prev | null, year: number): WineResult {
  return { w, mode: "bet", year, chips: {}, bettors: [], payouts: {}, prev, changeable: false };
}

/** «Открыть ставки»: новый шаг, таймер; год поля — по часам пульта. */
export function openBets(session: Session, content: WineContent, participants: Participant[], year = thisYear()): SessionChange {
  const r = parseWineResult(session.state.result);
  if (session.state.stage !== "ready" || !content.wines[r.w]) return {};
  return {
    state: { step: session.state.step + 1, stage: "question", startedAt: "server", timeLimit: content.betTime, revealed: false, answered: 0, result: write({ ...fresh(r.w, r.prev, year), changeable: true }) },
    leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode),
  };
}

/** Фишки на поле и кто поставил — на экран; null — без изменений. */
export function liveChips(session: Session, content: WineContent, answers: Answer[]): SessionChange | null {
  const r = parseWineResult(session.state.result);
  if (r.mode !== "bet" || session.state.stage !== "question") return null;
  const bets = betsOf(session, content, answers);
  const chips = totalChips(bets);
  const bettors = Object.keys(bets).sort();
  const sameChips = Object.keys(chips).length === Object.keys(r.chips).length && Object.entries(chips).every(([k, n]) => r.chips[k] === n);
  if (sameChips && bettors.join(",") === [...r.bettors].sort().join(",")) return null;
  return { state: { answered: bettors.length, result: write({ ...r, chips, bettors }) } };
}

/** «Открыть бутылку»: паспорт на экране, выплаты по фишкам. */
export function openBottle(session: Session, content: WineContent, answers: Answer[]): SessionChange {
  const r = parseWineResult(session.state.result);
  const wine = content.wines[r.w];
  if (r.mode !== "bet" || !wine) return {};
  const bets = betsOf(session, content, answers);
  const payouts = payoutsOf(content, bets, winningKeys(content, wine, r.year));
  const change: SessionChange = {
    state: { stage: "reveal", revealed: true, timeLimit: null, result: write({ ...r, mode: "open", chips: totalChips(bets), bettors: Object.keys(bets), payouts, changeable: false }) },
  };
  return { ...change, ...scoreChange(session.leaderboard, payouts) };
}

/** «Следующая бутылка» — её заставка. */
export function nextWine(session: Session): SessionChange {
  const r = parseWineResult(session.state.result);
  if (r.mode !== "open") return {};
  const prev: Prev = { w: r.w, year: r.year, chips: r.chips, payouts: r.payouts, bettors: r.bettors };
  return { state: { stage: "ready", revealed: false, startedAt: null, timeLimit: null, answered: 0, result: write(fresh(r.w + 1, prev, r.year)) } };
}

export interface WineBack {
  change: SessionChange;
  clear?: number[];
}

/** «Назад» — на этап раньше; очки этапа снимаются. */
export function wineBack(session: Session): WineBack | null {
  const { stage, step } = session.state;
  const r = parseWineResult(session.state.result);
  if (stage === "podium") return { change: podiumBack(session) };
  if (stage === "ready") {
    if (!r.prev) return null;
    const p = r.prev;
    return { change: { state: { stage: "reveal", revealed: true, startedAt: null, timeLimit: null, result: write({ ...fresh(p.w, null, p.year), mode: "open", chips: p.chips, payouts: p.payouts, bettors: p.bettors }) } } };
  }
  if (r.mode === "bet") return { change: { state: { step: step - 1, stage: "ready", revealed: false, startedAt: null, timeLimit: null, answered: 0, result: write(fresh(r.w, r.prev, r.year)) } }, clear: [step] };
  const minus = Object.fromEntries(Object.entries(r.payouts).map(([p, n]) => [p, -n]));
  const change: SessionChange = { state: { stage: "question", revealed: false, result: write({ ...r, mode: "bet", payouts: {}, changeable: true }) } };
  return { change: { ...change, ...scoreChange(session.leaderboard, minus) } };
}
