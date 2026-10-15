// Ход «Шпиона» на пульте. Всё открытое (кто за столом, таймер обсуждения, голоса, итог) — в state.result.
// Тайное — локация, роли и кто шпион — только в зашифрованных картах `sealed` (каждую открывает телефон своим
// ключом, как в «Мафии» — см. ../mafia/seal.ts) и в `hostSeal` (все карты — ключом ведущего на устройстве пульта).
// Догадка шпиона и голоса — ответы телефонов: их видит только пульт.
import { leaderboardAdditions } from "../../core/leaderboard";
import type { Answer, LeaderboardEntry, Participant, Session, SessionChange } from "../../data/types";
import type { ScoreDelta, Step } from "../types";
import { rolesOf, SPY_LIMITS, spiesFor, type SpyContent } from "./content";

export type SpyMode = "deal" | "cards" | "talk" | "vote" | "verdict" | "last" | "over";

/** Почему закончилась партия. */
export type SpyReason = "guess-right" | "guess-wrong" | "caught-right" | "caught-wrong" | "innocent" | "time" | "abort";

/** Тайна партии: какая локация, кто шпионы и роли остальных. Шифруется ключом ведущего. */
export interface SpySecret {
  location: number;
  spies: string[];
  roles: Record<string, string>;
}

/** Карта игрока (шифруется ключом его телефона): у шпиона нет ни локации, ни роли. */
export interface SpyCard {
  seat: number;
  spy: boolean;
  location: number | null;
  place: string;
  role: string;
}

export interface SpyGuess {
  pid: string;
  /** Номер локации в колоде. */
  index: number;
  correct: boolean;
}

export interface SpyResult {
  mode: SpyMode;
  /** Номер партии (с 1). */
  party: number;
  /** Игроки за столом по порядку: номер = место + 1. */
  seats: string[];
  /** Шаг раздачи: ответы этого шага — ключи телефонов. */
  dealStep: number | null;
  sealed: Record<string, string>;
  hostSeal: string | null;
  /** Локации прошлых партий этой игры (номера в колоде): не повторяются. */
  used: number[];
  /** Кто задаёт первый вопрос (жребий пульта). */
  firstAsker: string | null;
  /** Обсуждение идёт: когда закончится (часы сервера). */
  talkEndsAt: number | null;
  /** Обсуждение на паузе или идёт голосование: сколько миллисекунд осталось. */
  talkLeft: number | null;
  paused: boolean;
  /** Итог голосования: голоса за каждого. */
  tally: Record<string, number> | null;
  /** Кого обвинил город (null — «Не договорились»). */
  accused: string | null;
  /** Обвиняемый — шпион (открывается кнопкой «Открыть карту»). */
  accusedSpy: boolean | null;
  /** Догадка шпиона — открыта в итоге. */
  guess: SpyGuess | null;
  winner: "town" | "spies" | null;
  reason: SpyReason | null;
  /** Тайна партии — открывается в итоге. */
  reveal: SpySecret | null;
  /** Очки партии каждому: «Назад» с итога их снимает. */
  points: Record<string, number> | null;
  /** На голосовании голос можно менять — сервер перезаписывает ответ. */
  changeable: boolean;
  undo: { step: number; stage: string; result: Omit<SpyResult, "undo"> } | null;
}

export type SpyAnswerValue = { key: string } | { guess: number } | { vote: string };

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function strings(value: unknown, max = 60): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, max) : [];
}

function stringMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record(value))) if (typeof v === "string") out[k] = v;
  return out;
}

function numberMap(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(record(value))) if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  return out;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const MODES: SpyMode[] = ["deal", "cards", "talk", "vote", "verdict", "last", "over"];
const REASONS: SpyReason[] = ["guess-right", "guess-wrong", "caught-right", "caught-wrong", "innocent", "time", "abort"];

export function emptyResult(): SpyResult {
  return {
    mode: "deal",
    party: 1,
    seats: [],
    dealStep: null,
    sealed: {},
    hostSeal: null,
    used: [],
    firstAsker: null,
    talkEndsAt: null,
    talkLeft: null,
    paused: false,
    tally: null,
    accused: null,
    accusedSpy: null,
    guess: null,
    winner: null,
    reason: null,
    reveal: null,
    points: null,
    changeable: false,
    undo: null,
  };
}

export function parseSecret(raw: unknown): SpySecret | null {
  const d = record(raw);
  const location = num(d.location);
  if (location === null) return null;
  return { location, spies: strings(d.spies), roles: stringMap(d.roles) };
}

function parseGuess(raw: unknown): SpyGuess | null {
  const d = record(raw);
  const index = num(d.index);
  return typeof d.pid === "string" && index !== null ? { pid: d.pid, index, correct: d.correct === true } : null;
}

function withoutUndo(r: SpyResult): Omit<SpyResult, "undo"> {
  const { undo: _undo, ...rest } = r;
  return rest;
}

export function parseSpyResult(raw: unknown): SpyResult {
  const d = record(raw);
  const base = emptyResult();
  const undo = record(d.undo);
  const tally = numberMap(d.tally);
  const points = numberMap(d.points);
  return {
    mode: MODES.includes(d.mode as SpyMode) ? (d.mode as SpyMode) : base.mode,
    party: typeof d.party === "number" && d.party >= 1 ? Math.floor(d.party) : 1,
    seats: strings(d.seats),
    dealStep: num(d.dealStep),
    sealed: stringMap(d.sealed),
    hostSeal: typeof d.hostSeal === "string" ? d.hostSeal : null,
    used: Array.isArray(d.used) ? d.used.filter((n): n is number => typeof n === "number").slice(0, 50) : [],
    firstAsker: typeof d.firstAsker === "string" ? d.firstAsker : null,
    talkEndsAt: num(d.talkEndsAt),
    talkLeft: num(d.talkLeft),
    paused: d.paused === true,
    tally: Object.keys(tally).length > 0 ? tally : null,
    accused: typeof d.accused === "string" ? d.accused : null,
    accusedSpy: typeof d.accusedSpy === "boolean" ? d.accusedSpy : null,
    guess: parseGuess(d.guess),
    winner: d.winner === "town" || d.winner === "spies" ? d.winner : null,
    reason: REASONS.includes(d.reason as SpyReason) ? (d.reason as SpyReason) : null,
    reveal: parseSecret(d.reveal),
    points: Object.keys(points).length > 0 ? points : null,
    changeable: d.changeable === true,
    undo: typeof undo.step === "number" && typeof undo.stage === "string" ? { step: undo.step, stage: undo.stage, result: withoutUndo(parseSpyResult(undo.result)) } : null,
  };
}

export function spySteps(): Step[] {
  return [];
}

export function score(): ScoreDelta[] {
  return [];
}

// ---------------------------------------------------------------- раздача

/** Локации, которые можно сыграть: с названием и хотя бы одной ролью. */
export function playable(content: SpyContent): number[] {
  return content.locations.flatMap((l, i) => (l.name.trim() && rolesOf(l).length > 0 ? [i] : []));
}

/** Игроки за столом: по порядку входа; добавленные ведущим без телефона — в конце. */
export function seatsOf(session: Session, participants: Participant[]): string[] {
  const players = participants.filter((p) => p.kind === "player");
  const joined = new Map(players.map((p) => [p.id, p.joinedAt ?? 0]));
  const ids = new Set([...Object.keys(session.leaderboard), ...players.map((p) => p.id)]);
  return [...ids].sort((a, b) => (joined.get(a) ?? Number.MAX_SAFE_INTEGER) - (joined.get(b) ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b));
}

function shuffle<T>(list: T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/**
 * Тайна новой партии: локация — случайная из ещё не сыгранных в этой игре (сыграны все — любая, кроме прошлой),
 * шпионы — случайные игроки, остальным — роли локации вперемешку (игроков больше ролей — роли повторяются).
 */
export function dealSecret(seats: string[], content: SpyContent, used: number[], random: () => number = Math.random): SpySecret {
  const all = playable(content);
  const fresh = all.filter((i) => !used.includes(i));
  const last = used[used.length - 1];
  const pool = fresh.length > 0 ? fresh : all.filter((i) => i !== last).length > 0 ? all.filter((i) => i !== last) : all;
  const location = pool[Math.floor(random() * pool.length)] ?? 0;
  const order = shuffle(seats, random);
  const count = spiesFor(content, seats.length);
  const spies = order.slice(0, count);
  const roles: Record<string, string> = {};
  const deck = shuffle(rolesOf(content.locations[location]), random);
  order.slice(count).forEach((pid, i) => {
    roles[pid] = deck.length > 0 ? (deck[i % deck.length] as string) : "Гость";
  });
  return { location, spies, roles };
}

export function cardOf(pid: string, secret: SpySecret, seats: string[], content: SpyContent): SpyCard {
  const seat = seats.indexOf(pid) + 1;
  if (secret.spies.includes(pid)) return { seat, spy: true, location: null, place: "", role: "" };
  return { seat, spy: false, location: secret.location, place: content.locations[secret.location]?.name ?? "", role: secret.roles[pid] ?? "" };
}

export function parseCard(raw: unknown): SpyCard | null {
  const d = record(raw);
  if (typeof d.spy !== "boolean") return null;
  return { seat: num(d.seat) ?? 0, spy: d.spy, location: num(d.location), place: typeof d.place === "string" ? d.place : "", role: typeof d.role === "string" ? d.role : "" };
}

/** До какого размера (байты JSON в UTF-8) добиваются карты: по размеру шифра не отличить шпиона от остальных. */
export const PAD_TO = 400;

/** Размер в байтах UTF-8: кириллица — 2 байта, шифр считает байты, а не буквы. */
function byteSize(data: unknown): number {
  return new TextEncoder().encode(JSON.stringify(data)).length;
}

/** Добить все записи точками до общего размера: не меньше PAD_TO и не меньше самой большой. */
export function paddedAll<T extends object>(items: Record<string, T>): Record<string, T & { _: string }> {
  const largest = Math.max(PAD_TO, ...Object.values(items).map((d) => byteSize({ ...d, _: "" })));
  const out: Record<string, T & { _: string }> = {};
  for (const [k, d] of Object.entries(items)) out[k] = { ...d, _: ".".repeat(Math.max(0, largest - byteSize({ ...d, _: "" }))) };
  return out;
}

// ---------------------------------------------------------------- догадки и голоса

/** Номер локации из ответа `{ guess }` — только существующая локация колоды. */
export function guessOf(value: unknown, content: SpyContent): number | null {
  const g = record(value).guess;
  return typeof g === "number" && Number.isInteger(g) && playable(content).includes(g) ? g : null;
}

export function voteOf(value: unknown): string | null {
  const v = record(value).vote;
  return typeof v === "string" ? v : null;
}

/** Первая догадка шпиона на шаге (по времени ответа); от не-шпионов не принимается. */
export function pendingGuess(answers: Answer[], step: number, spies: string[], content: SpyContent): { pid: string; index: number } | null {
  const list = answers
    .filter((a) => a.step === step && spies.includes(a.pid))
    .map((a) => ({ pid: a.pid, index: guessOf(a.value, content), at: a.submittedAt ?? Number.MAX_SAFE_INTEGER }))
    .filter((a): a is { pid: string; index: number; at: number } => a.index !== null)
    .sort((a, b) => a.at - b.at);
  const first = list[0];
  return first ? { pid: first.pid, index: first.index } : null;
}

export interface Tally {
  counts: Record<string, number>;
  /** Сколько голосов подано. */
  cast: number;
  /** Обвиняемый: единственный лидер, за него больше половины игроков за столом. null — «Не договорились». */
  accused: string | null;
}

/** Подсчёт голосов: голос за себя и за не сидящих за столом не считается. */
export function tallyVotes(answers: Array<{ pid: string; value: unknown }>, seats: string[]): Tally {
  const counts: Record<string, number> = {};
  for (const p of seats) counts[p] = 0;
  const voted = new Set<string>();
  let cast = 0;
  for (const a of answers) {
    if (!seats.includes(a.pid) || voted.has(a.pid)) continue;
    const v = voteOf(a.value);
    if (v === null || v === a.pid || !seats.includes(v)) continue;
    voted.add(a.pid);
    counts[v] = (counts[v] ?? 0) + 1;
    cast++;
  }
  const max = Math.max(0, ...Object.values(counts));
  const leaders = seats.filter((p) => (counts[p] ?? 0) === max);
  const accused = max > 0 && leaders.length === 1 && max * 2 > cast && max * 2 > seats.length ? (leaders[0] ?? null) : null;
  return { counts, cast, accused };
}

/** Сколько миллисекунд обсуждения осталось. */
export function talkLeftMs(r: Pick<SpyResult, "talkEndsAt" | "talkLeft" | "paused">, now: number): number {
  if (r.talkEndsAt !== null && !r.paused) return Math.max(0, r.talkEndsAt - now);
  return Math.max(0, r.talkLeft ?? 0);
}

// ---------------------------------------------------------------- переходы пульта

function snapshot(session: Session, r: SpyResult): SpyResult["undo"] {
  return { step: session.state.step, stage: session.state.stage, result: withoutUndo(r) };
}

export function nameMap(session: Session, participants: Participant[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [pid, e] of Object.entries(session.leaderboard)) out[pid] = e.name;
  for (const p of participants) if (!out[p.id] && p.kind === "player") out[p.id] = p.name;
  return out;
}

const started = (session: Session) => session.state.result !== null && session.state.result !== undefined;

/**
 * «Собрать телефоны»: телефоны присылают свои ключи, игроки садятся за стол по порядку входа.
 * После итога партии — следующая: новый шаг, номер партии +1, очки и сыгранные локации остаются.
 */
export function startDeal(session: Session, participants: Participant[]): SessionChange {
  const additions = leaderboardAdditions(session.leaderboard, participants, "solo");
  const board = { ...session.leaderboard, ...additions };
  const seats = seatsOf({ ...session, leaderboard: board }, participants);
  const prev = started(session) ? parseSpyResult(session.state.result) : null;
  const next = prev !== null && prev.mode === "over";
  const step = next ? session.state.step + 1 : session.state.step;
  return {
    leaderboard: additions,
    state: {
      step,
      stage: "question",
      startedAt: "server",
      timeLimit: null,
      revealed: false,
      answered: 0,
      result: { ...emptyResult(), mode: "deal", party: next ? prev.party + 1 : 1, used: next ? prev.used : [], seats, dealStep: step, undo: next ? snapshot(session, prev) : null },
    },
  };
}

/** Карты розданы: у каждого — своя зашифрованная карта. */
export function dealt(session: Session, sealed: Record<string, string>, hostSeal: string | null): SessionChange {
  const r = parseSpyResult(session.state.result);
  return { state: { stage: "reveal", revealed: true, result: { ...r, mode: "cards", sealed, hostSeal, changeable: false, undo: null } } };
}

/**
 * «Начать обсуждение»: новый шаг без ограничения времени (шпион может в любой момент назвать локацию),
 * таймер раунда — по часам сервера на экране, первый спрашивающий — жребий.
 */
export function startTalk(session: Session, content: SpyContent, now: number, random: () => number = Math.random): SessionChange {
  const r = parseSpyResult(session.state.result);
  const firstAsker = r.seats[Math.floor(random() * r.seats.length)] ?? null;
  return {
    state: {
      step: session.state.step + 1,
      stage: "question",
      startedAt: "server",
      timeLimit: null,
      revealed: false,
      answered: 0,
      result: { ...r, mode: "talk", firstAsker, talkEndsAt: now + content.roundMinutes * 60_000, talkLeft: null, paused: false, changeable: false, undo: snapshot(session, r) },
    },
  };
}

/** Пауза таймера обсуждения. */
export function pauseTalk(session: Session, now: number): SessionChange {
  const r = parseSpyResult(session.state.result);
  if (r.mode !== "talk" || r.paused) return {};
  return { state: { result: { ...r, paused: true, talkLeft: talkLeftMs(r, now), talkEndsAt: null } } };
}

/** Снять с паузы. */
export function resumeTalk(session: Session, now: number): SessionChange {
  const r = parseSpyResult(session.state.result);
  if (r.mode !== "talk" || !r.paused) return {};
  return { state: { result: { ...r, paused: false, talkEndsAt: now + (r.talkLeft ?? 0), talkLeft: null } } };
}

/** «+1 минута» к обсуждению (время вышло — минута с этой секунды). */
export function addMinute(session: Session, now: number): SessionChange {
  const r = parseSpyResult(session.state.result);
  if (r.mode !== "talk") return {};
  const left = talkLeftMs(r, now) + 60_000;
  return { state: { result: r.paused ? { ...r, talkLeft: left } : { ...r, talkEndsAt: now + left } } };
}

/** «Голосование»: новый шаг с таймером, голос можно менять; таймер обсуждения встаёт. */
export function startVote(session: Session, content: SpyContent, now: number): SessionChange {
  const r = parseSpyResult(session.state.result);
  return {
    state: {
      step: session.state.step + 1,
      stage: "question",
      startedAt: "server",
      timeLimit: content.voteSeconds,
      revealed: false,
      answered: 0,
      result: { ...r, mode: "vote", talkLeft: talkLeftMs(r, now), talkEndsAt: null, paused: false, tally: null, accused: null, changeable: true, undo: snapshot(session, r) },
    },
  };
}

/** «Подсчитать голоса»: обвиняемый или «Не договорились». */
export function verdict(session: Session, answers: Array<{ pid: string; value: unknown; step?: number }>): SessionChange {
  const r = parseSpyResult(session.state.result);
  const own = answers.filter((a) => a.step === undefined || a.step === session.state.step);
  const t = tallyVotes(own, r.seats);
  return { state: { stage: "reveal", revealed: true, result: { ...r, mode: "verdict", tally: t.counts, accused: t.accused, accusedSpy: null, changeable: false, undo: snapshot(session, r) } } };
}

/** «Не договорились», время ещё есть — обсуждение продолжается (новый шаг: шпион снова может назвать локацию). */
export function continueTalk(session: Session, now: number): SessionChange {
  const r = parseSpyResult(session.state.result);
  return {
    state: {
      step: session.state.step + 1,
      stage: "question",
      startedAt: "server",
      timeLimit: null,
      revealed: false,
      answered: 0,
      result: { ...r, mode: "talk", talkEndsAt: now + (r.talkLeft ?? 0), talkLeft: null, paused: false, tally: null, accused: null, changeable: false, undo: snapshot(session, r) },
    },
  };
}

/** Очки партии каждому за столом. */
export function partyPoints(seats: string[], secret: SpySecret, content: SpyContent, winner: "town" | "spies" | null, guess: SpyGuess | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pid of seats) {
    const spy = secret.spies.includes(pid);
    let delta = 0;
    if (winner === "town" && !spy) delta = content.townPoints;
    if (winner === "spies" && spy) delta = content.spyPoints + (guess && guess.correct && guess.pid === pid ? content.guessBonus : 0);
    out[pid] = delta;
  }
  return out;
}

/** Итог партии: тайна открыта, очки победителям, локация — в сыгранные. */
export function finishParty(session: Session, content: SpyContent, secret: SpySecret, winner: "town" | "spies" | null, reason: SpyReason, guess: SpyGuess | null = null): SessionChange {
  const r = parseSpyResult(session.state.result);
  const points = partyPoints(r.seats, secret, content, winner, guess);
  const leaderboard: Record<string, LeaderboardEntry> = {};
  for (const pid of r.seats) {
    const entry = session.leaderboard[pid];
    if (!entry) continue;
    const delta = points[pid] ?? 0;
    leaderboard[pid] = { ...entry, score: entry.score + delta, last: delta };
  }
  const used = r.used.includes(secret.location) ? r.used : [...r.used, secret.location];
  return {
    leaderboard,
    state: {
      stage: "reveal",
      revealed: true,
      result: { ...r, mode: "over", winner, reason, guess, reveal: secret, points, used, talkEndsAt: null, paused: false, changeable: false, undo: snapshot(session, r) },
    },
  };
}

/** Шпион назвал локацию во время обсуждения: угадал — победа шпионов, нет — победа города. */
export function resolveGuess(session: Session, content: SpyContent, secret: SpySecret, pid: string, index: number, now: number): SessionChange {
  const r = parseSpyResult(session.state.result);
  const correct = index === secret.location;
  const guess: SpyGuess = { pid, index, correct };
  const base: Session = { ...session, state: { ...session.state, result: { ...r, talkLeft: talkLeftMs(r, now) } } };
  return finishParty(base, content, secret, correct ? "spies" : "town", correct ? "guess-right" : "guess-wrong", guess);
}

/**
 * «Открыть карту обвиняемого»: шпион — последний шанс (новый шаг, 30 секунд назвать локацию);
 * не шпион — город ошибся, побеждают шпионы.
 */
export function openAccused(session: Session, content: SpyContent, secret: SpySecret): SessionChange {
  const r = parseSpyResult(session.state.result);
  if (!r.accused) return {};
  if (!secret.spies.includes(r.accused)) return finishParty(session, content, secret, "spies", "innocent");
  return {
    state: {
      step: session.state.step + 1,
      stage: "question",
      startedAt: "server",
      timeLimit: SPY_LIMITS.lastChanceSeconds,
      revealed: false,
      answered: 0,
      result: { ...r, mode: "last", accusedSpy: true, changeable: false, undo: snapshot(session, r) },
    },
  };
}

/** «Проверить ответ шпиона» (последний шанс): угадал — шпионы, не угадал или молчал — город. */
export function resolveLast(session: Session, content: SpyContent, secret: SpySecret, index: number | null): SessionChange {
  const r = parseSpyResult(session.state.result);
  const pid = r.accused ?? "";
  const correct = index !== null && index === secret.location;
  const guess: SpyGuess | null = index !== null ? { pid, index, correct } : null;
  return finishParty(session, content, secret, correct ? "spies" : "town", correct ? "caught-right" : "caught-wrong", guess);
}

/** Время вышло, а город так и не договорился — побеждают шпионы. */
export function timeUp(session: Session, content: SpyContent, secret: SpySecret): SessionChange {
  return finishParty(session, content, secret, "spies", "time");
}

/** «Закончить досрочно»: тайна открывается, очков никто не получает. */
export function abortParty(session: Session, content: SpyContent, secret: SpySecret): SessionChange {
  return finishParty(session, content, secret, null, "abort");
}

/** «Назад» на одно действие: прежний этап; ответы ушедшего шага убрать; с итога — снять очки партии. */
export function spyBack(session: Session): { change: SessionChange; clearAnswers?: number } | null {
  const r = parseSpyResult(session.state.result);
  if (!r.undo) return null;
  const u = r.undo;
  const stage = u.stage === "question" || u.stage === "reveal" || u.stage === "ready" || u.stage === "board" ? u.stage : "reveal";
  const leftStep = session.state.step !== u.step ? session.state.step : undefined;
  const leaderboard: Record<string, LeaderboardEntry> = {};
  if (r.mode === "over" && r.points) {
    for (const [pid, delta] of Object.entries(r.points)) {
      const entry = session.leaderboard[pid];
      if (entry && delta !== 0) leaderboard[pid] = { ...entry, score: entry.score - delta, last: 0 };
    }
  }
  return {
    change: {
      ...(Object.keys(leaderboard).length > 0 ? { leaderboard } : {}),
      // Вернулись на шаг с приёмом ответов — снова принимаем (иначе телефоны не смогли бы ответить).
      state: { step: u.step, stage, result: { ...u.result, undo: null }, revealed: stage !== "question" },
    },
    ...(leftStep !== undefined ? { clearAnswers: leftStep } : {}),
  };
}

export type SpyAction = "deal" | "dealt" | "talk" | "guess" | "vote" | "verdict" | "open" | "continue" | "timeUp" | "lastCheck" | "nextParty" | "podium";

/** Главная кнопка пульта. `guessPending` — шпион прислал догадку во время обсуждения. */
export function spyPrimary(session: Session, parties = 1, guessPending = false): SpyAction {
  if (session.state.stage === "podium") return "podium";
  if (!started(session)) return "deal";
  const r = parseSpyResult(session.state.result);
  if (r.mode === "deal") return "dealt";
  if (r.mode === "cards") return "talk";
  if (r.mode === "talk") return guessPending ? "guess" : "vote";
  if (r.mode === "vote") return "verdict";
  if (r.mode === "verdict") return r.accused ? "open" : (r.talkLeft ?? 0) > 0 ? "continue" : "timeUp";
  if (r.mode === "last") return "lastCheck";
  return r.party < parties ? "nextParty" : "podium";
}

export const ACTION_LABELS: Record<SpyAction, string> = {
  deal: "Собрать телефоны",
  dealt: "Раздать карты",
  talk: "Начать обсуждение",
  guess: "Шпион называет локацию — открыть",
  vote: "Голосование",
  verdict: "Подсчитать голоса",
  open: "Открыть карту обвиняемого",
  continue: "Продолжить обсуждение",
  timeUp: "Время вышло — шпион побеждает",
  lastCheck: "Проверить ответ шпиона",
  nextParty: "Следующая партия",
  podium: "Награждение",
};

/** Подпись итога партии. */
export function reasonText(reason: SpyReason | null): string {
  switch (reason) {
    case "guess-right":
      return "Шпион сам назвал локацию — и угадал!";
    case "guess-wrong":
      return "Шпион назвал локацию — и ошибся";
    case "caught-right":
      return "Шпиона вычислили, но он угадал локацию";
    case "caught-wrong":
      return "Шпиона вычислили, локацию он не угадал";
    case "innocent":
      return "Город обвинил невиновного";
    case "time":
      return "Время вышло — город не договорился";
    case "abort":
      return "Партия закончена досрочно";
    default:
      return "";
  }
}
