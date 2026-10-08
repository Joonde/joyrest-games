// Ход «Танцевального батла» — чистые функции.
//
// Шаг выбора (`question`, режим `pick`): капитан команды, чья очередь, выбирает карточку на телефоне
// (`{ card }`) или ведущий касается её на пульте → выступление (`reveal`, режим `perform`: видео или
// трек на экране) → шаг оценки (`question`, режим `vote`, таймер): танец и караоке — другие команды
// ставят от 10 до 100 (`{ rate }`), команде — среднее; батл — голос за лучшую команду (`{ team }`),
// победителю — очки батла → итог (`reveal`, `result`) → следующая команда.
import { leaderboardAdditions, scoringParticipants } from "../../core/leaderboard";
import { hasPodium, podiumBack, podiumDone } from "../../core/podium";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import type { ScoreDelta, Step } from "../types";
import type { DanceCard, DanceContent } from "./content";

export type DanceMode = "pick" | "perform" | "vote" | "result";

interface Prev {
  card: string;
  performer: string | null;
  turn: number;
  scores: Record<string, number>;
}

export interface DanceResult {
  order: string[];
  turn: number;
  played: string[];
  card: string | null;
  performer: string | null;
  mode: DanceMode;
  /** Очки последнего выступления (для «Назад»). */
  scores: Record<string, number>;
  /** Ничья в батле: ведущий выбирает победителя. */
  tie: string[];
  /** Ведущий: «Сначала» (видео или трек), «Пауза». */
  replay: number;
  paused: boolean;
  prev: Prev | null;
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && ID.test(x)))].slice(0, 200) : []);
const pid = (v: unknown) => (typeof v === "string" && ID.test(v) ? v : null);
function nums(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(rec(v))) if (ID.test(k) && typeof n === "number" && Number.isFinite(n)) out[k] = Math.round(n);
  return out;
}

export function parseDanceResult(raw: unknown): DanceResult {
  const d = rec(raw);
  const p = rec(d.prev);
  return {
    order: ids(d.order),
    turn: typeof d.turn === "number" && Number.isInteger(d.turn) && d.turn >= 0 ? d.turn : 0,
    played: ids(d.played),
    card: pid(d.card),
    performer: pid(d.performer),
    mode: d.mode === "perform" || d.mode === "vote" || d.mode === "result" ? d.mode : "pick",
    scores: nums(d.scores),
    tie: ids(d.tie),
    replay: typeof d.replay === "number" ? d.replay : 0,
    paused: d.paused === true,
    prev: typeof p.card === "string" ? { card: p.card, performer: pid(p.performer), turn: typeof p.turn === "number" ? p.turn : 0, scores: nums(p.scores) } : null,
  };
}

const write = (r: DanceResult): Record<string, unknown> => ({ ...r });

export function danceSteps(content: DanceContent): Step[] {
  return content.cards.map((c) => ({ id: c.id, answerable: true }));
}

export function score(): ScoreDelta[] {
  return [];
}

export function cardOf(content: DanceContent, cardId: string | null): DanceCard | null {
  return cardId ? (content.cards.find((c) => c.id === cardId) ?? null) : null;
}

/** Чья очередь выбирать. */
export function turnPid(r: DanceResult): string | null {
  return r.order.length > 0 ? (r.order[r.turn % r.order.length] ?? null) : null;
}

function orderOf(session: Session, participants: Participant[], r: DanceResult): string[] {
  const joined = [...scoringParticipants(participants, session.playMode)].sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0) || a.id.localeCompare(b.id)).map((p) => p.id);
  const known = new Set([...joined, ...Object.keys(session.leaderboard)]);
  // Новые команды встают в конец очереди, старые не сдвигаются; убранные ведущим — выпадают.
  return [...new Set([...r.order.filter((p) => known.has(p)), ...joined, ...Object.keys(session.leaderboard)])];
}

export type DanceAction = "start" | "waitPick" | "vote" | "result" | "next" | "podium" | "podiumNext" | "finish";

export function dancePrimary(session: Session, content: DanceContent): DanceAction {
  const { stage } = session.state;
  const r = parseDanceResult(session.state.result);
  if (stage === "podium") return podiumDone(session) ? "finish" : "podiumNext";
  if (stage === "ready") return "start";
  if (r.mode === "pick") return content.cards.every((c) => r.played.includes(c.id)) ? (hasPodium(session.leaderboard) ? "podium" : "finish") : "waitPick";
  if (r.mode === "perform") return "vote";
  if (r.mode === "vote") return "result";
  const left = content.cards.filter((c) => !r.played.includes(c.id) && c.id !== r.card);
  if (left.length === 0) return hasPodium(session.leaderboard) ? "podium" : "finish";
  return "next";
}

/** «Начать игру»: очередь команд, выбор первой карточки. */
export function startPick(session: Session, participants: Participant[]): SessionChange {
  const r = parseDanceResult(session.state.result);
  return {
    state: { stage: "question", startedAt: "server", timeLimit: null, revealed: false, answered: 0, result: write({ ...r, order: orderOf(session, participants, r), mode: "pick", card: null }) },
    leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode),
  };
}

/** Карточка выбрана (капитан или ведущий) — выступление. */
export function pickCard(session: Session, content: DanceContent, cardId: string, participants: Participant[]): SessionChange {
  const r = parseDanceResult(session.state.result);
  const card = cardOf(content, cardId);
  if (!card || r.played.includes(cardId) || r.mode !== "pick") return {};
  // Очередь меняется только при смене хода (иначе телефон и пульт разойдутся, чья очередь).
  const order = r.order.length > 0 ? r.order : orderOf(session, participants, r);
  return {
    state: { stage: "reveal", revealed: false, result: write({ ...r, order, card: cardId, performer: turnPid({ ...r, order }), mode: "perform", replay: 0, paused: false, scores: {}, tie: [] }) },
    leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode),
  };
}

/** Выбор капитана с телефона: только команда, чья очередь, только несыгранная карточка. */
export function pickFromAnswers(session: Session, content: DanceContent, answers: Answer[], participants: Participant[]): SessionChange | null {
  if (session.state.stage !== "question") return null;
  const r = parseDanceResult(session.state.result);
  if (r.mode !== "pick") return null;
  const who = turnPid(r.order.length > 0 ? r : { ...r, order: orderOf(session, participants, r) });
  // Выбор до «Назад» (раньше нового времени шага) не считается.
  const since = session.state.startedAt ?? 0;
  const answer = answers.find((a) => a.step === session.state.step && a.pid === who && (a.submittedAt ?? 0) >= since);
  const cardId = pid(rec(answer?.value).card);
  if (!cardId) return null;
  const change = pickCard(session, content, cardId, participants);
  return change.state ? change : null;
}

export function startVote(session: Session, content: DanceContent): SessionChange {
  const r = parseDanceResult(session.state.result);
  return { state: { step: session.state.step + 1, stage: "question", startedAt: "server", timeLimit: content.voteTime, revealed: false, answered: 0, result: write({ ...r, mode: "vote", paused: true }) } };
}

/** Кто может голосовать: все команды, кроме выступающей (в батле — кроме своей при голосе). */
export function canVote(r: DanceResult, card: DanceCard | null, voter: string): boolean {
  if (!card || !r.order.includes(voter)) return false;
  return card.kind === "battle" || voter !== r.performer;
}

/** Голоса батла: команда → число голосов. */
export function battleVotes(r: DanceResult, answers: Answer[], step: number): Map<string, number> {
  const votes = new Map<string, number>();
  for (const a of answers) {
    if (a.step !== step || !r.order.includes(a.pid)) continue;
    const team = pid(rec(a.value).team);
    if (!team || team === a.pid || !r.order.includes(team)) continue;
    votes.set(team, (votes.get(team) ?? 0) + 1);
  }
  return votes;
}

/** Ничья в батле: лидеры с равным числом голосов (больше одного) — решает ведущий. */
export function battleTie(content: DanceContent, r: DanceResult, answers: Answer[], step: number): string[] {
  const card = cardOf(content, r.card);
  if (!card || card.kind !== "battle") return [];
  const votes = battleVotes(r, answers, step);
  const max = Math.max(0, ...votes.values());
  const top = [...votes.entries()].filter(([, n]) => n === max && max > 0).map(([t]) => t);
  return top.length > 1 ? top : [];
}

/** Очки по голосам: танец и караоке — среднее оценок выступающей команде; батл — победителю (ничья — решает ведущий). */
export function tally(content: DanceContent, r: DanceResult, answers: Answer[], step: number): Record<string, number> {
  const card = cardOf(content, r.card);
  if (!card) return {};
  const own = answers.filter((a) => a.step === step && canVote(r, card, a.pid));
  if (card.kind === "battle") {
    const votes = battleVotes(r, own, step);
    const max = Math.max(0, ...votes.values());
    const winners = [...votes.entries()].filter(([, n]) => n === max && max > 0).map(([t]) => t);
    return winners.length === 1 && winners[0] ? { [winners[0]]: content.battlePoints } : {};
  }
  if (!r.performer) return {};
  const rates = own.map((a) => rec(a.value).rate).filter((x): x is number => typeof x === "number" && Number.isFinite(x)).map((x) => Math.min(content.maxRate, Math.max(content.minRate, Math.round(x))));
  if (rates.length === 0) return {};
  return { [r.performer]: Math.round(rates.reduce((s, x) => s + x, 0) / rates.length) };
}

export function showResult(session: Session, content: DanceContent, answers: Answer[]): SessionChange {
  const r = parseDanceResult(session.state.result);
  const scores = tally(content, r, answers, session.state.step);
  const tie = battleTie(content, r, answers, session.state.step);
  const change: SessionChange = { state: { stage: "reveal", revealed: true, result: write({ ...r, mode: "result", scores, tie }) } };
  if (Object.keys(scores).length > 0) change.addScore = scores;
  return change;
}

/** Ничья в батле: ведущий называет победителя — ему очки батла. */
export function resolveTie(session: Session, content: DanceContent, winner: string): SessionChange {
  const r = parseDanceResult(session.state.result);
  if (!r.tie.includes(winner) || Object.keys(r.scores).length > 0) return {};
  return { state: { result: write({ ...r, scores: { [winner]: content.battlePoints }, tie: [] }) }, addScore: { [winner]: content.battlePoints } };
}

export function nextTurn(session: Session, participants: Participant[] = []): SessionChange {
  const r = parseDanceResult(session.state.result);
  if (!r.card) return {};
  const order = orderOf(session, participants, r);
  return {
    state: {
      step: session.state.step + 1,
      stage: "question",
      startedAt: "server",
      timeLimit: null,
      revealed: false,
      answered: 0,
      result: write({ ...r, order, played: [...r.played, r.card], prev: { card: r.card, performer: r.performer, turn: r.turn, scores: r.scores }, card: null, performer: null, mode: "pick", scores: {}, tie: [], turn: r.turn + 1, replay: 0, paused: false }),
    },
  };
}

export function control(session: Session, patch: { replay?: true; paused?: boolean }): SessionChange {
  const r = parseDanceResult(session.state.result);
  return { state: { result: write({ ...r, replay: patch.replay ? r.replay + 1 : r.replay, paused: patch.paused ?? (patch.replay ? false : r.paused) }) } };
}

export interface DanceBack {
  change: SessionChange;
  clear?: number[];
}

export function danceBack(session: Session): DanceBack | null {
  const { stage, step } = session.state;
  const r = parseDanceResult(session.state.result);
  if (stage === "podium") return { change: podiumBack(session) };
  if (stage === "ready") return null;
  if (r.mode === "perform") return { change: { state: { stage: "question", startedAt: "server", result: write({ ...r, mode: "pick", card: null, performer: null }) } }, clear: [step] };
  if (r.mode === "vote") return { change: { state: { step: step - 1, stage: "reveal", startedAt: null, timeLimit: null, result: write({ ...r, mode: "perform", paused: false }) } }, clear: [step] };
  if (r.mode === "result") {
    const minus = Object.fromEntries(Object.entries(r.scores).map(([p, n]) => [p, -n]));
    const change: SessionChange = { state: { stage: "question", revealed: false, result: write({ ...r, mode: "vote", scores: {}, tie: [] }) } };
    if (Object.keys(minus).length > 0) change.addScore = minus;
    return { change };
  }
  // Выбор: назад к итогу прошлого выступления.
  if (!r.prev) return null;
  const prev = r.prev;
  return {
    change: {
      state: { step: step - 1, stage: "reveal", revealed: true, startedAt: null, timeLimit: null, result: write({ ...r, played: r.played.filter((c) => c !== prev.card), card: prev.card, performer: prev.performer, turn: prev.turn, scores: prev.scores, mode: "result", prev: null }) },
    },
    clear: [step],
  };
}
