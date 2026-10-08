// «Бункер» — чистые функции хода игры (правила — docs/bunker-rules.md).
//
// Раздача → катастрофа → раунды (карта бункера → круг открытия карт, в первом раунде — профессия →
// обсуждение → тайное голосование; ничья — оправдание и переголосование, снова ничья — жребий) →
// финал: открываются все карты спасшихся, проверка «Возрождения» и угрозы «Истории выживания».
//
// Тайное (персонажи всех игроков, закрытые карты бункера, угрозы) хранится в `hostSeal` — ключом
// ведущего; карта каждого телефона — его ключом (`sealed`). Открытые карты лежат в `shown` открыто.
import { leaderboardAdditions } from "../../core/leaderboard";
import { podiumBack } from "../../core/podium";
import type { Participant, Session, SessionChange, StepStage } from "../../data/types";
import type { ScoreDelta, Step } from "../types";
import { BUNKER_LIMITS, placesFor, quotaNow, type BunkerContent } from "./content";
import { biologyOf, BUNKER_CARDS, CATASTROPHES, CATS, drawRef, healthOf, isRef, THREATS, type Cat } from "./decks";
import { isSpecial, playSpecial, SPECIALS, type Character, type Refusal, type SpecialId, type SpecialWorld, type Use } from "./specials";

export type Mode = "deal" | "catastrophe" | "bunker" | "open" | "discuss" | "vote" | "justify" | "exile" | "final";

/** Тайное игры: только у ведущего. */
export interface Secrets {
  chars: Record<string, Character>;
  /** Карты бункера (номера в колоде) по раундам. */
  bunker: number[];
  threats: number[];
  /** Личные заметки (Шпион): видит только сам игрок. */
  notes: Record<string, string[]>;
}

export interface Tally {
  counts: Record<string, number>;
  /** Голос изгнанных (общий). */
  exiledPick: string | null;
  out: string | null;
  tie: string[];
  random: boolean;
  cancelled: boolean;
  voters: number;
}

export interface BunkerResult {
  mode: Mode;
  dealStep: number | null;
  seats: string[];
  alive: string[];
  exiled: string[];
  places: number;
  round: number;
  /** Изгнано в этом раунде. */
  done: number;
  /** Пропущено голосований (ведущим). */
  skips: number;
  catastrophe: number;
  years: number;
  area: number;
  /** Открытые карты бункера (номера в колоде) по порядку раундов. */
  bunkerShown: number[];
  open: Record<string, Cat[]>;
  /** Тексты открытых карт (ссылки). */
  shown: Record<string, Partial<Record<Cat, string>>>;
  sealed: Record<string, string>;
  hostSeal: string | null;
  /** Круг открытия: порядок и чей ход. */
  order: string[];
  turn: number;
  speaker: string | null;
  speakEndsAt: number | null;
  speakKind: "speech" | "justify" | "discuss" | null;
  candidates: string[];
  revote: boolean;
  voteEndsAt: number | null;
  tally: Tally | null;
  /** Особые условия текущего голосования. */
  immune: string[];
  doubled: string[];
  cancelled: boolean;
  /** Сыгранные особые условия (открыты всем). */
  used: Record<string, SpecialId>;
  /** Отказ на просьбу «сыграть» (`шаг:цель:карта`), чтобы не повторять. */
  refused: Record<string, { sig: string; reason: string }>;
  log: string[];
  /** Финал: открытые угрозы и решения ведущего. */
  threatsShown: number[];
  verdicts: Array<boolean | null>;
  outcome: { won: boolean; rebirth: boolean | null; threats: number; beaten: number } | null;
  /** Очки, начисленные последним действием (для «Назад»). */
  changeable: boolean;
  undo: { step: number; stage: StepStage; result: Omit<BunkerResult, "undo">; scores: Record<string, number> } | null;
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && ID.test(x)) : []);
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0) : []);
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const MODES: Mode[] = ["deal", "catastrophe", "bunker", "open", "discuss", "vote", "justify", "exile", "final"];

export function isCat(v: unknown): v is Cat {
  return typeof v === "string" && (CATS as string[]).includes(v);
}

function parseTally(v: unknown): Tally | null {
  const d = rec(v);
  if (!("counts" in d)) return null;
  const counts: Record<string, number> = {};
  for (const [k, n] of Object.entries(rec(d.counts))) if (ID.test(k) && typeof n === "number") counts[k] = n;
  return { counts, exiledPick: typeof d.exiledPick === "string" ? d.exiledPick : null, out: typeof d.out === "string" ? d.out : null, tie: ids(d.tie), random: d.random === true, cancelled: d.cancelled === true, voters: num(d.voters, 0) };
}

export function emptyResult(): BunkerResult {
  return {
    mode: "deal",
    dealStep: null,
    seats: [],
    alive: [],
    exiled: [],
    places: 1,
    round: 0,
    done: 0,
    skips: 0,
    catastrophe: 0,
    years: 1,
    area: 100,
    bunkerShown: [],
    open: {},
    shown: {},
    sealed: {},
    hostSeal: null,
    order: [],
    turn: 0,
    speaker: null,
    speakEndsAt: null,
    speakKind: null,
    candidates: [],
    revote: false,
    voteEndsAt: null,
    tally: null,
    immune: [],
    doubled: [],
    cancelled: false,
    used: {},
    refused: {},
    log: [],
    threatsShown: [],
    verdicts: [],
    outcome: null,
    changeable: true,
    undo: null,
  };
}

export function parseBunkerResult(raw: unknown): BunkerResult {
  const d = rec(raw);
  const e = emptyResult();
  const open: Record<string, Cat[]> = {};
  for (const [k, v] of Object.entries(rec(d.open))) if (ID.test(k) && Array.isArray(v)) open[k] = v.filter(isCat);
  const shown: Record<string, Partial<Record<Cat, string>>> = {};
  for (const [k, v] of Object.entries(rec(d.shown))) {
    if (!ID.test(k)) continue;
    const row: Partial<Record<Cat, string>> = {};
    for (const [c, ref] of Object.entries(rec(v))) if (isCat(c) && isRef(c, ref)) row[c] = ref;
    shown[k] = row;
  }
  const sealed: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec(d.sealed))) if (ID.test(k) && typeof v === "string") sealed[k] = v;
  const used: Record<string, SpecialId> = {};
  for (const [k, v] of Object.entries(rec(d.used))) if (ID.test(k) && isSpecial(v)) used[k] = v;
  const refused: Record<string, { sig: string; reason: string }> = {};
  for (const [k, v] of Object.entries(rec(d.refused))) {
    const x = rec(v);
    if (ID.test(k) && typeof x.sig === "string" && typeof x.reason === "string") refused[k] = { sig: x.sig, reason: x.reason };
  }
  const outcome = rec(d.outcome);
  const undo = rec(d.undo);
  return {
    mode: MODES.includes(d.mode as Mode) ? (d.mode as Mode) : e.mode,
    dealStep: typeof d.dealStep === "number" ? d.dealStep : null,
    seats: ids(d.seats),
    alive: ids(d.alive),
    exiled: ids(d.exiled),
    places: num(d.places, e.places),
    round: num(d.round, 0),
    done: num(d.done, 0),
    skips: num(d.skips, 0),
    catastrophe: CATASTROPHES.some((c) => c.id === d.catastrophe) ? (d.catastrophe as number) : 0,
    years: num(d.years, 1),
    area: num(d.area, 100),
    bunkerShown: nums(d.bunkerShown).filter((i) => i < BUNKER_CARDS.length),
    open,
    shown,
    sealed,
    hostSeal: typeof d.hostSeal === "string" ? d.hostSeal : null,
    order: ids(d.order),
    turn: num(d.turn, 0),
    speaker: typeof d.speaker === "string" ? d.speaker : null,
    speakEndsAt: typeof d.speakEndsAt === "number" ? d.speakEndsAt : null,
    speakKind: d.speakKind === "speech" || d.speakKind === "justify" || d.speakKind === "discuss" ? d.speakKind : null,
    candidates: ids(d.candidates),
    revote: d.revote === true,
    voteEndsAt: typeof d.voteEndsAt === "number" ? d.voteEndsAt : null,
    tally: parseTally(d.tally),
    immune: ids(d.immune),
    doubled: ids(d.doubled),
    cancelled: d.cancelled === true,
    used,
    refused,
    log: Array.isArray(d.log) ? d.log.filter((x): x is string => typeof x === "string").slice(-20) : [],
    threatsShown: nums(d.threatsShown).filter((i) => i < THREATS.length),
    verdicts: Array.isArray(d.verdicts) ? d.verdicts.map((v) => (typeof v === "boolean" ? v : null)) : [],
    outcome: "won" in outcome ? { won: outcome.won === true, rebirth: typeof outcome.rebirth === "boolean" ? outcome.rebirth : null, threats: num(outcome.threats, 0), beaten: num(outcome.beaten, 0) } : null,
    changeable: d.changeable !== false,
    undo: "result" in undo && typeof undo.step === "number" ? { step: undo.step, stage: (undo.stage as StepStage) ?? "question", result: { ...parseBunkerResult(undo.result), undo: null } as Omit<BunkerResult, "undo">, scores: Object.fromEntries(Object.entries(rec(undo.scores)).filter(([, n]) => typeof n === "number")) as Record<string, number> } : null,
  };
}

export function bunkerSteps(): Step[] {
  return [];
}

export function score(): ScoreDelta[] {
  return [];
}

// ——— Ответы телефонов ———

/** Ответ телефона на шаге: ключ, какую карту открыть, голос, особое условие (всё в одном, его можно менять). */
export interface BunkerAnswer {
  key?: string;
  open?: Cat;
  vote?: string;
  use?: { target: string | null; cat: Cat | null };
}

export function answerOf(value: unknown): BunkerAnswer {
  const d = rec(value);
  const out: BunkerAnswer = {};
  if (typeof d.key === "string") out.key = d.key;
  if (isCat(d.open)) out.open = d.open;
  if (typeof d.vote === "string" && ID.test(d.vote)) out.vote = d.vote;
  const u = rec(d.use);
  if ("target" in u || "cat" in u) out.use = { target: typeof u.target === "string" && ID.test(u.target) ? u.target : null, cat: isCat(u.cat) ? u.cat : null };
  return out;
}

export function useSig(step: number, use: Use): string {
  return `${step}:${use.target ?? "-"}:${use.cat ?? "-"}`;
}

// ——— Раздача ———

export function seatsOf(session: Session, participants: Participant[]): string[] {
  const players = participants.filter((p) => p.kind === "player");
  const joined = new Map(players.map((p) => [p.id, p.joinedAt ?? 0]));
  const all = new Set([...Object.keys(session.leaderboard), ...players.map((p) => p.id)]);
  return [...all].sort((a, b) => (joined.get(a) ?? Number.MAX_SAFE_INTEGER) - (joined.get(b) ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b));
}

export function nameMap(session: Session, participants: Participant[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [pid, e] of Object.entries(session.leaderboard)) out[pid] = e.name;
  for (const p of participants) if (!out[p.id] && p.kind === "player") out[p.id] = p.name;
  return out;
}

function snapshot(session: Session, r: BunkerResult, scores: Record<string, number> = {}): BunkerResult["undo"] {
  const { undo: _u, ...rest } = r;
  return { step: session.state.step, stage: session.state.stage, result: rest, scores };
}

const q = (step: number, result: BunkerResult): SessionChange["state"] => ({ step, stage: "question", startedAt: "server", timeLimit: null, revealed: false, answered: 0, result });

/** «Собрать телефоны»: телефоны присылают ключи, игроки садятся по порядку входа. */
export function startDeal(session: Session, participants: Participant[]): SessionChange {
  const additions = leaderboardAdditions(session.leaderboard, participants, "solo");
  const seats = seatsOf({ ...session, leaderboard: { ...session.leaderboard, ...additions } }, participants);
  const step = session.state.stage === "ready" ? session.state.step : session.state.step + 1;
  return { leaderboard: additions, state: q(step, { ...emptyResult(), mode: "deal", seats, alive: seats, dealStep: step }) };
}

function shuffle<T>(list: T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** Персонажи без повторов карт; особые условия — все разные, пока хватает колоды. */
export function dealSecrets(seats: string[], content: BunkerContent, random: () => number = Math.random): Secrets {
  const taken = new Set<string>();
  const specials = shuffle(SPECIALS.map((s) => s.id), random);
  const chars: Record<string, Character> = {};
  seats.forEach((pid, i) => {
    const c = {} as Record<Cat, string>;
    for (const cat of CATS) {
      const ref = drawRef(cat, taken, random);
      taken.add(ref);
      c[cat] = ref;
    }
    chars[pid] = { ...c, special: specials[i % specials.length] as SpecialId };
  });
  const bunker = shuffle(BUNKER_CARDS.map((_, i) => i), random).slice(0, BUNKER_LIMITS.bunkerCards);
  const threats = shuffle(THREATS.map((_, i) => i), random).slice(0, content.threats);
  return { chars, bunker, threats, notes: {} };
}

/** Карты розданы: катастрофа на экране, у каждого — свой зашифрованный персонаж. */
export function dealt(session: Session, content: BunkerContent, sealed: Record<string, string>, hostSeal: string, random: () => number = Math.random): SessionChange {
  const r = parseBunkerResult(session.state.result);
  const cat = content.catastrophe ?? (CATASTROPHES[Math.floor(random() * CATASTROPHES.length)]?.id ?? 0);
  const c = CATASTROPHES.find((x) => x.id === cat) ?? CATASTROPHES[0];
  const years = c ? c.years[0] + Math.floor(random() * (c.years[1] - c.years[0] + 1)) : 1;
  const places = placesFor(r.seats.length);
  return {
    state: q(session.state.step + 1, { ...r, mode: "catastrophe", catastrophe: cat, years, area: 40 + places * 15 + Math.floor(random() * 6) * 5, places, alive: r.seats, sealed, hostSeal, undo: snapshot(session, r) }),
  };
}

/** Тексты открытых карт по персонажам (после обмена и открытия — заново). */
export function shownOf(chars: Record<string, Character>, open: Record<string, Cat[]>): Record<string, Partial<Record<Cat, string>>> {
  const out: Record<string, Partial<Record<Cat, string>>> = {};
  for (const [pid, cats] of Object.entries(open)) {
    const c = chars[pid];
    if (!c) continue;
    const row: Partial<Record<Cat, string>> = {};
    for (const cat of cats) row[cat] = c[cat];
    out[pid] = row;
  }
  return out;
}

// ——— Раунды ———

export function quota(content: BunkerContent, r: BunkerResult): number {
  return quotaNow(r.round, content.rounds, r.alive.length, r.places, r.done);
}

/** «Раунд N»: открывается карта бункера этого раунда. */
export function startRound(session: Session, content: BunkerContent, secrets: Secrets): SessionChange {
  const r = parseBunkerResult(session.state.result);
  const round = r.round + 1;
  const card = secrets.bunker[round - 1];
  const pay = roundPay(session, content, r);
  return {
    ...(Object.keys(pay).length > 0 ? { addScore: pay } : {}),
    state: q(session.state.step + 1, { ...r, mode: "bunker", round, done: 0, bunkerShown: card !== undefined && r.bunkerShown.length < round ? [...r.bunkerShown, card] : r.bunkerShown, speaker: null, speakEndsAt: null, speakKind: null, tally: null, candidates: [], revote: false, voteEndsAt: null, immune: [], doubled: [], cancelled: false, undo: snapshot(session, r, pay) }),
  };
}

/** Очки за пережитый раунд — всем в игре (кроме самого начала). */
function roundPay(session: Session, content: BunkerContent, r: BunkerResult): Record<string, number> {
  if (r.round === 0 || content.roundPoints <= 0) return {};
  return Object.fromEntries(r.alive.filter((p) => session.leaderboard[p]).map((p) => [p, content.roundPoints]));
}

/** «Круг открытия карт»: по очереди, каждый раунд начинает следующий игрок. */
export function startOpening(session: Session): SessionChange {
  const r = parseBunkerResult(session.state.result);
  const shift = r.alive.length > 0 ? (r.round - 1) % r.alive.length : 0;
  const order = [...r.alive.slice(shift), ...r.alive.slice(0, shift)];
  return { state: q(session.state.step + 1, { ...r, mode: "open", order, turn: 0, speaker: order[0] ?? null, speakEndsAt: null, speakKind: "speech", undo: snapshot(session, r) }) };
}

/** Какие карты можно открыть на ходе: в первом раунде — только профессию. */
export function openable(r: BunkerResult, pid: string): Cat[] {
  const opened = r.open[pid] ?? [];
  if (r.round <= 1 && !opened.includes("profession")) return ["profession"];
  return CATS.filter((c) => !opened.includes(c));
}

/** Открыть карту игрока (ход, допрос или ведущий за игрока); на ходе — запускается таймер речи. */
export function openCard(session: Session, content: BunkerContent, pid: string, cat: Cat, chars: Record<string, Character>, now: number): SessionChange {
  const r = parseBunkerResult(session.state.result);
  if ((r.open[pid] ?? []).includes(cat) || !chars[pid]) return {};
  const open = { ...r.open, [pid]: [...(r.open[pid] ?? []), cat] };
  const speaking = r.mode === "open" && r.speaker === pid;
  const secs = r.round <= 1 ? content.firstSpeechSeconds : content.speechSeconds;
  return { state: { result: { ...r, open, shown: shownOf(chars, open), ...(speaking ? { speakEndsAt: now + secs * 1000, speakKind: "speech" as const } : {}) } } };
}

/** Открыл ли текущий игрок карту в этом раунде. */
export function openedThisTurn(r: BunkerResult, before: Record<string, Cat[]>): boolean {
  const pid = r.speaker;
  return !!pid && (r.open[pid] ?? []).length > (before[pid] ?? []).length;
}

/** «Следующий игрок». */
export function nextSpeaker(session: Session): SessionChange {
  const r = parseBunkerResult(session.state.result);
  const turn = r.turn + 1;
  return { state: q(session.state.step + 1, { ...r, turn, speaker: r.order[turn] ?? null, speakEndsAt: null, speakKind: "speech", undo: snapshot(session, r) }) };
}

/** «Обсуждение»: общий таймер. */
export function startDiscuss(session: Session, content: BunkerContent, now: number): SessionChange {
  const r = parseBunkerResult(session.state.result);
  return { state: q(session.state.step + 1, { ...r, mode: "discuss", speaker: null, speakEndsAt: content.discussSeconds > 0 ? now + content.discussSeconds * 1000 : null, speakKind: "discuss", undo: snapshot(session, r) }) };
}

/** Слово игроку (оправдание при ничьей); null — убрать таймер. */
export function giveWord(session: Session, pid: string | null, seconds: number, now: number): SessionChange {
  const r = parseBunkerResult(session.state.result);
  return { state: { result: { ...r, speaker: pid, speakEndsAt: pid ? now + seconds * 1000 : null, speakKind: pid ? "justify" : null } } };
}

/** «Голосование»: тайно, на телефонах. Повторное — только между кандидатами ничьей. */
export function startVote(session: Session, content: BunkerContent, now: number, candidates?: string[]): SessionChange {
  const r = parseBunkerResult(session.state.result);
  const revote = candidates !== undefined;
  const fresh = r.mode !== "justify";
  return {
    state: q(session.state.step + 1, {
      ...r,
      mode: "vote",
      candidates: candidates ?? r.alive,
      revote,
      voteEndsAt: now + content.voteSeconds * 1000,
      tally: null,
      speaker: null,
      speakEndsAt: null,
      speakKind: null,
      // Защита и двойной голос действуют на всё голосование, включая переголосование.
      ...(fresh ? { immune: [], doubled: [], cancelled: false } : {}),
      undo: snapshot(session, r),
    }),
  };
}

/** Кто голосует: игроки в игре и (по настройке) изгнанные — одним общим голосом. */
export function tallyVotes(r: BunkerResult, content: BunkerContent, votes: Record<string, string>, random: () => number = Math.random): Tally {
  const counts: Record<string, number> = {};
  for (const c of r.candidates) counts[c] = 0;
  let voters = 0;
  for (const pid of r.alive) {
    const t = votes[pid];
    if (!t || !(t in counts) || t === pid) continue;
    voters++;
    if (r.immune.includes(t)) continue;
    counts[t] = (counts[t] ?? 0) + (r.doubled.includes(pid) ? 2 : 1);
  }
  let exiledPick: string | null = null;
  if (content.exiledVote === "common") {
    const picks: Record<string, number> = {};
    for (const pid of r.exiled) {
      const t = votes[pid];
      if (t && t in counts) picks[t] = (picks[t] ?? 0) + 1;
    }
    const best = Math.max(0, ...Object.values(picks));
    const tops = Object.keys(picks).filter((k) => picks[k] === best);
    if (best > 0 && tops.length === 1) {
      exiledPick = tops[0] as string;
      if (!r.immune.includes(exiledPick)) counts[exiledPick] = (counts[exiledPick] ?? 0) + 1;
    }
  }
  if (r.cancelled) return { counts, exiledPick, out: null, tie: [], random: false, cancelled: true, voters };
  const pool = r.candidates.filter((c) => !r.immune.includes(c));
  const field = pool.length > 0 ? pool : r.candidates;
  const max = Math.max(0, ...field.map((c) => counts[c] ?? 0));
  const leaders = field.filter((c) => (counts[c] ?? 0) === max);
  if (leaders.length === 1) return { counts, exiledPick, out: leaders[0] as string, tie: [], random: false, cancelled: false, voters };
  if (!r.revote) return { counts, exiledPick, out: null, tie: leaders, random: false, cancelled: false, voters };
  // Повторная ничья — жребий.
  return { counts, exiledPick, out: leaders[Math.floor(random() * leaders.length)] ?? null, tie: leaders, random: true, cancelled: false, voters };
}

/** «Подсчитать голоса»: изгнание, ничья (оправдание) или отмена. */
export function countVotes(session: Session, content: BunkerContent, votes: Record<string, string>, chars: Record<string, Character>, random: () => number = Math.random): SessionChange {
  const r = parseBunkerResult(session.state.result);
  const tally = tallyVotes(r, content, votes, random);
  const step = session.state.step + 1;
  if (tally.out) {
    const out = tally.out;
    const open = { ...r.open, [out]: [...CATS] };
    return { state: q(step, { ...r, mode: "exile", tally, alive: r.alive.filter((p) => p !== out), exiled: [...r.exiled, out], done: r.done + 1, open, shown: shownOf(chars, open), voteEndsAt: null, undo: snapshot(session, r) }) };
  }
  if (tally.cancelled) return { state: q(step, { ...r, mode: "exile", tally, voteEndsAt: null, undo: snapshot(session, r) }) };
  return { state: q(step, { ...r, mode: "justify", tally, candidates: tally.tie, voteEndsAt: null, speaker: null, speakEndsAt: null, undo: snapshot(session, r) }) };
}

/** Пропустить голосование раунда (ведущий, ограниченное число раз): изгнание перейдёт на следующие раунды. */
export function canSkip(content: BunkerContent, r: BunkerResult): boolean {
  return r.skips < content.skipVotes && r.round < content.rounds && r.done === 0;
}

export function skipVote(session: Session): SessionChange {
  const r = parseBunkerResult(session.state.result);
  return { state: q(session.state.step + 1, { ...r, mode: "exile", skips: r.skips + 1, tally: { counts: {}, exiledPick: null, out: null, tie: [], random: false, cancelled: true, voters: 0 }, undo: snapshot(session, r) }) };
}

// ——— Финал ———

/** Пара для «Возрождения»: мужчина и женщина 18–55 лет без бесплодия. */
export function hasPair(chars: Record<string, Character>, people: string[]): boolean {
  const fit = (sex: "m" | "f") =>
    people.some((p) => {
      const c = chars[p];
      const b = biologyOf(c?.biology);
      return !!c && !!b && b.sex === sex && b.age >= 18 && b.age <= 55 && !healthOf(c.health).infertile;
    });
  return fit("m") && fit("f");
}

/** «Финал»: открываются все карты спасшихся и все карты бункера, дальше — угрозы. */
export function startFinal(session: Session, content: BunkerContent, secrets: Secrets): SessionChange {
  const r = parseBunkerResult(session.state.result);
  const pay = roundPay(session, content, r);
  const open: Record<string, Cat[]> = { ...r.open };
  for (const p of r.alive) open[p] = [...CATS];
  return {
    ...(Object.keys(pay).length > 0 ? { addScore: pay } : {}),
    state: q(session.state.step + 1, { ...r, mode: "final", open, shown: shownOf(secrets.chars, open), bunkerShown: secrets.bunker, threatsShown: [], verdicts: [], outcome: null, speaker: null, speakEndsAt: null, speakKind: null, undo: snapshot(session, r, pay) }),
  };
}

/** Открыть следующую угрозу. */
export function nextThreat(session: Session, secrets: Secrets): SessionChange {
  const r = parseBunkerResult(session.state.result);
  const i = secrets.threats[r.threatsShown.length];
  if (i === undefined) return {};
  return { state: q(session.state.step + 1, { ...r, threatsShown: [...r.threatsShown, i], verdicts: [...r.verdicts, null], undo: snapshot(session, r) }) };
}

/** Ведущий решает: спасшиеся справились с угрозой или нет. */
export function judgeThreat(session: Session, beaten: boolean): SessionChange {
  const r = parseBunkerResult(session.state.result);
  const verdicts = [...r.verdicts];
  verdicts[verdicts.length - 1] = beaten;
  return { state: { result: { ...r, verdicts } } };
}

/** «Итог»: бункер выжил — очки спасшимся. */
export function finishBunker(session: Session, content: BunkerContent, chars: Record<string, Character>): SessionChange {
  const r = parseBunkerResult(session.state.result);
  const rebirth = content.rebirth ? hasPair(chars, r.alive) : null;
  const beaten = r.verdicts.filter((v) => v === true).length;
  const won = rebirth !== false && beaten === r.verdicts.length;
  const pay = won && content.winPoints > 0 ? Object.fromEntries(r.alive.filter((p) => session.leaderboard[p]).map((p) => [p, content.winPoints])) : {};
  return {
    ...(Object.keys(pay).length > 0 ? { addScore: pay } : {}),
    state: { stage: "reveal", revealed: true, result: { ...r, outcome: { won, rebirth, threats: r.verdicts.length, beaten }, changeable: false, undo: snapshot(session, r, pay) } },
  };
}

// ——— Главная кнопка ———

export type BunkerAction = "deal" | "dealt" | "round" | "opening" | "nextSpeaker" | "discuss" | "vote" | "count" | "revote" | "moreVote" | "final" | "threat" | "judge" | "outcome" | "podium";

export const ACTION_LABELS: Record<BunkerAction, string> = {
  deal: "Собрать телефоны",
  dealt: "Раздать карты",
  round: "Раунд",
  opening: "Круг открытия карт",
  nextSpeaker: "Следующий игрок",
  discuss: "Обсуждение",
  vote: "Голосование",
  count: "Подсчитать голоса",
  revote: "Переголосовать",
  moreVote: "Ещё одно голосование",
  final: "Финал: кто в бункере",
  threat: "Открыть угрозу",
  judge: "Решить угрозу",
  outcome: "Итог игры",
  podium: "Награждение",
};

/** Что дальше после раунда: следующий раунд или финал. */
function afterRound(content: BunkerContent, r: BunkerResult): BunkerAction {
  return r.round >= content.rounds ? "final" : "round";
}

export function bunkerPrimary(session: Session, content: BunkerContent): BunkerAction {
  if (session.state.stage === "podium") return "podium";
  const raw = session.state.result;
  if (raw === null || raw === undefined) return "deal";
  const r = parseBunkerResult(raw);
  switch (r.mode) {
    case "deal":
      return "dealt";
    case "catastrophe":
      return "round";
    case "bunker":
      return "opening";
    case "open":
      return r.turn + 1 < r.order.length ? "nextSpeaker" : "discuss";
    case "discuss":
      return quota(content, r) > 0 ? "vote" : afterRound(content, r);
    case "vote":
      return "count";
    case "justify":
      return "revote";
    case "exile":
      return !r.tally?.cancelled && quota(content, r) > 0 ? "moreVote" : afterRound(content, r);
    case "final":
      if (r.outcome) return "podium";
      if (r.verdicts.some((v) => v === null)) return "judge";
      return r.threatsShown.length < content.threats ? "threat" : "outcome";
  }
}

/** «Назад» на одно действие ведущего: очки этого действия снимаются. */
export function bunkerBack(session: Session): { change: SessionChange; clearAnswers?: number } | null {
  if (session.state.stage === "podium") return { change: podiumBack(session) };
  const r = parseBunkerResult(session.state.result);
  if (!r.undo) return null;
  const u = r.undo;
  const minus = Object.fromEntries(Object.entries(u.scores).map(([k, v]) => [k, -v]));
  return {
    change: { state: { step: u.step, stage: u.stage, revealed: u.stage !== "question", startedAt: u.stage === "question" ? "server" : null, timeLimit: null, result: u.result }, ...(Object.keys(minus).length > 0 ? { addScore: minus } : {}) },
    ...(u.step !== session.state.step ? { clearAnswers: session.state.step } : {}),
  };
}

// ——— Особые условия ———

export interface UseResult {
  secrets: Secrets;
  change: SessionChange;
  note: { pid: string; text: string } | null;
}

/**
 * Сыграть особое условие игрока: меняет тайное (персонажи, бункер) и открытое (открытые карты, места,
 * кто в игре), пишет строку в журнал. Отказ — причина в `refused` (телефон покажет её).
 */
export function applyUse(session: Session, content: BunkerContent, secrets: Secrets, pid: string, use: Use, name: (pid: string) => string, random: () => number = Math.random): UseResult | { refusal: Refusal; change: SessionChange } {
  const r = parseBunkerResult(session.state.result);
  const sig = useSig(session.state.step, use);
  const refuse = (refusal: Refusal) => ({ refusal, change: { state: { result: { ...r, refused: { ...r.refused, [pid]: { sig, reason: refusal } } } } } });
  if (!content.specials || !secrets.chars[pid]) return refuse("dead");
  if (r.used[pid]) return refuse("used");
  if (r.mode === "deal" || r.mode === "final") return refuse("time");
  const world: SpecialWorld = { chars: secrets.chars, alive: r.alive, exiled: r.exiled, open: r.open, places: r.places, bunker: secrets.bunker, bunkerOpen: r.bunkerShown.length, round: r.round, rounds: content.rounds };
  const out = playSpecial(world, pid, use, r.mode === "vote", name, BUNKER_CARDS.length, random);
  if (typeof out === "string") return refuse(out);
  const w = out.world;
  const id = (secrets.chars[pid] as Character).special;
  const bunkerShown = r.bunkerShown.map((card, i) => (i === r.bunkerShown.length - 1 && w.bunker[i] !== undefined ? (w.bunker[i] as number) : card));
  const { [pid]: _gone, ...refused } = r.refused;
  const next: BunkerResult = {
    ...r,
    alive: w.alive,
    exiled: w.exiled,
    open: w.open,
    shown: shownOf(w.chars, w.open),
    places: w.places,
    bunkerShown,
    used: { ...r.used, [pid]: id },
    refused,
    log: [...r.log, out.log].slice(-20),
    immune: out.vote === "immunity" ? [...r.immune, pid] : r.immune,
    doubled: out.vote === "doubleVote" ? [...r.doubled, pid] : r.doubled,
    cancelled: r.cancelled || out.vote === "cancelVote",
  };
  const notes = out.note ? { ...secrets.notes, [out.note.pid]: [...(secrets.notes[out.note.pid] ?? []), out.note.text] } : secrets.notes;
  return { secrets: { ...secrets, chars: w.chars, bunker: w.bunker, notes }, change: { state: { result: next } }, note: out.note };
}
