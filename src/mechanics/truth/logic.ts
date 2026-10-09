// Ход «Правды или действия» — чистые функции.
//
// Ход игрока — один шаг (`question`, без таймера, пока ход не закончен): режим `pick` — игрок (капитан)
// выбирает на телефоне `{ choice }` или ведущий на пульте → `card` — на экране карточка (из гостевых,
// если есть, иначе случайная из колоды) → «Выполнено» / «Отказ» (`reveal`, режим `done`, очки) →
// следующий игрок. Пока ход идёт, остальные гости могут прислать свой вопрос или задание
// (`{ suggest: { kind, text } }`); ведущий берёт его в колоду или нет.
import { leaderboardAdditions, scoringParticipants } from "../../core/leaderboard";
import { hasPodium, podiumBack, podiumDone } from "../../core/podium";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import type { ScoreDelta, Step } from "../types";
import { cleanText, deckOf, TRUTH_LIMITS, type TruthContent, type TruthKind } from "./content";

export type TruthMode = "pick" | "card" | "done";

export interface DrawnCard {
  id: string;
  kind: TruthKind;
  text: string;
  /** Карточка от гостя: кто прислал. */
  from: string | null;
}

export interface GuestCard extends DrawnCard {
  from: string;
}

export interface TruthResult {
  order: string[];
  /** Номер хода с начала игры (круг = turn / order.length). */
  turn: number;
  mode: TruthMode;
  choice: TruthKind | null;
  card: DrawnCard | null;
  /** Карточки колоды, что уже выпадали (по кругу, пока колода не кончится). */
  used: string[];
  /** Принятые задания гостей — выпадают первыми. */
  extra: GuestCard[];
  /** Разобранные ведущим предложения (id ответа). */
  handled: string[];
  outcome: "done" | "refused" | null;
  /** Очки этого хода (для «Назад»). */
  delta: number;
  /** Прошлый ход целиком — «Назад» с выбора следующего игрока. */
  prev: Omit<TruthResult, "prev"> | null;
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const ids = (v: unknown, max = 500) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && ID.test(x)))].slice(-max) : []);
const kindOf = (v: unknown): TruthKind | null => (v === "truth" || v === "dare" ? v : null);

function drawn(v: unknown): DrawnCard | null {
  const c = rec(v);
  const kind = kindOf(c.kind);
  if (!kind || typeof c.id !== "string") return null;
  return { id: c.id, kind, text: cleanText(c.text), from: typeof c.from === "string" ? c.from : null };
}

function parseFlat(raw: unknown): Omit<TruthResult, "prev"> {
  const d = rec(raw);
  return {
    order: ids(d.order, 200),
    turn: typeof d.turn === "number" && d.turn >= 0 ? Math.floor(d.turn) : 0,
    mode: d.mode === "card" || d.mode === "done" ? d.mode : "pick",
    choice: kindOf(d.choice),
    card: drawn(d.card),
    used: ids(d.used),
    extra: (Array.isArray(d.extra) ? d.extra : []).flatMap((x) => {
      const c = drawn(x);
      return c && c.from ? [{ ...c, from: c.from }] : [];
    }),
    handled: ids(d.handled),
    outcome: d.outcome === "done" || d.outcome === "refused" ? d.outcome : null,
    delta: typeof d.delta === "number" ? d.delta : 0,
  };
}

export function parseTruthResult(raw: unknown): TruthResult {
  const p = rec(raw).prev;
  return { ...parseFlat(raw), prev: p && typeof p === "object" ? parseFlat(p) : null };
}

const flat = (r: TruthResult): Omit<TruthResult, "prev"> => {
  const { prev: _p, ...rest } = r;
  return rest;
};

export function truthSteps(): Step[] {
  return [];
}

export function score(): ScoreDelta[] {
  return [];
}

/** Чья очередь. */
export function turnPid(r: TruthResult): string | null {
  return r.order.length > 0 ? (r.order[r.turn % r.order.length] ?? null) : null;
}

/** Номер круга (с 1). */
export function roundOf(r: TruthResult): number {
  return r.order.length > 0 ? Math.floor(r.turn / r.order.length) + 1 : 1;
}

function orderOf(session: Session, participants: Participant[], r: TruthResult): string[] {
  const joined = [...scoringParticipants(participants, session.playMode)].sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0) || a.id.localeCompare(b.id)).map((p) => p.id);
  const known = new Set([...joined, ...Object.keys(session.leaderboard)]);
  return [...new Set([...r.order.filter((p) => known.has(p)), ...joined, ...Object.keys(session.leaderboard)])];
}

/** Выбор игрока из ответа. */
export function choiceOf(value: unknown): TruthKind | null {
  return kindOf(rec(value).choice);
}

/** Предложение гостя из ответа. */
export function suggestionOf(value: unknown): { kind: TruthKind; text: string } | null {
  const s = rec(rec(value).suggest);
  const kind = kindOf(s.kind);
  const text = cleanText(s.text, TRUTH_LIMITS.text);
  return kind && text ? { kind, text } : null;
}

/** Предложения гостей этого хода, ещё не разобранные ведущим. */
export function pendingSuggestions(r: TruthResult, answers: Answer[], step: number): Array<{ id: string; pid: string; kind: TruthKind; text: string }> {
  return answers
    .filter((a) => a.step === step && !r.handled.includes(a.id))
    .flatMap((a) => {
      const s = suggestionOf(a.value);
      return s ? [{ id: a.id, pid: a.pid, ...s }] : [];
    });
}

export type TruthAction = "start" | "waitChoice" | "resolve" | "next" | "podium" | "podiumNext" | "finish";

/** Все круги сыграны. */
export function roundsDone(content: TruthContent, r: TruthResult): boolean {
  return content.rounds > 0 && r.order.length > 0 && r.turn + 1 >= content.rounds * r.order.length;
}

export function truthPrimary(session: Session, content: TruthContent): TruthAction {
  const { stage } = session.state;
  const r = parseTruthResult(session.state.result);
  if (stage === "podium") return podiumDone(session) ? "finish" : "podiumNext";
  if (stage === "ready") return "start";
  if (r.mode === "pick") return "waitChoice";
  if (r.mode === "card") return "resolve";
  if (roundsDone(content, r)) return hasPodium(session.leaderboard) ? "podium" : "finish";
  return "next";
}

/** «Начать игру»: очередь по порядку входа, ходит первый. */
export function startTruth(session: Session, participants: Participant[]): SessionChange {
  const r = parseTruthResult(session.state.result);
  return {
    leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode),
    state: { stage: "question", startedAt: "server", timeLimit: null, revealed: false, answered: 0, result: { ...r, order: orderOf(session, participants, r), turn: 0, mode: "pick", choice: null, card: null, outcome: null, delta: 0, prev: null } },
  };
}

/**
 * Вытянуть карточку: сначала принятые задания гостей этого вида, потом случайная из колоды, что ещё не
 * выпадала (колода кончилась — по новой). `random` — 0..1.
 */
export function draw(content: TruthContent, r: TruthResult, kind: TruthKind, random: () => number = Math.random, skip: string | null = null): { card: DrawnCard | null; used: string[]; extra: GuestCard[] } {
  const guest = r.extra.find((c) => c.kind === kind && c.id !== skip);
  if (guest) return { card: guest, used: r.used, extra: r.extra.filter((c) => c.id !== guest.id) };
  const deck = deckOf(content, kind);
  let left = deck.filter((c) => !r.used.includes(c.id) && c.id !== skip);
  let used = r.used;
  if (left.length === 0) {
    // Колода этого вида кончилась — по новой (без только что выпавшей).
    used = r.used.filter((id) => !deck.some((c) => c.id === id));
    left = deck.filter((c) => c.id !== skip);
  }
  if (left.length === 0) return { card: null, used, extra: r.extra };
  const pick = left[Math.min(left.length - 1, Math.floor(random() * left.length))] as (typeof left)[number];
  return { card: { id: pick.id, kind, text: pick.text, from: null }, used: [...used, pick.id], extra: r.extra };
}

/** Игрок выбрал (или ведущий за него): карточка на экран. */
export function choose(session: Session, content: TruthContent, kind: TruthKind, random: () => number = Math.random): SessionChange {
  const r = parseTruthResult(session.state.result);
  if (r.mode !== "pick") return {};
  const d = draw(content, r, kind, random);
  return { state: { result: { ...r, mode: "card", choice: kind, card: d.card ?? { id: "empty", kind, text: kind === "truth" ? "Расскажите о себе то, чего никто здесь не знает" : "Станцуйте 15 секунд под любую музыку", from: null }, used: d.used, extra: d.extra } } };
}

/** Выбор с телефона того, чья очередь (капитан команды). */
export function chooseFromAnswers(session: Session, content: TruthContent, answers: Answer[], random: () => number = Math.random): SessionChange | null {
  const r = parseTruthResult(session.state.result);
  if (session.state.stage !== "question" || r.mode !== "pick") return null;
  const who = turnPid(r);
  const a = answers.find((x) => x.step === session.state.step && x.pid === who && choiceOf(x.value));
  const kind = a ? choiceOf(a.value) : null;
  return kind ? choose(session, content, kind, random) : null;
}

/** «Другая карточка» того же вида (прежняя гостевая возвращается в конец очереди). */
export function redraw(session: Session, content: TruthContent, random: () => number = Math.random): SessionChange {
  const r = parseTruthResult(session.state.result);
  if (r.mode !== "card" || !r.card || !r.choice) return {};
  const back = r.card.from ? [...r.extra, { ...r.card, from: r.card.from }] : r.extra;
  const d = draw(content, { ...r, extra: back }, r.choice, random, r.card.id);
  return d.card ? { state: { result: { ...r, card: d.card, used: d.used, extra: d.extra } } } : {};
}

/** «Выполнено» или «Отказ»: очки хода. */
export function resolve(session: Session, content: TruthContent, outcome: "done" | "refused"): SessionChange {
  const r = parseTruthResult(session.state.result);
  const who = turnPid(r);
  if (r.mode !== "card" || !who || !r.choice) return {};
  const delta = outcome === "done" ? (r.choice === "truth" ? content.truthPoints : content.darePoints) : -content.refusePenalty;
  return {
    state: { stage: "reveal", revealed: true, result: { ...r, mode: "done", outcome, delta } },
    ...(delta !== 0 ? { addScore: { [who]: delta } } : {}),
  };
}

/** Следующий игрок (новые гости встают в конец очереди). */
export function nextTurn(session: Session, participants: Participant[]): SessionChange {
  const r = parseTruthResult(session.state.result);
  return {
    leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode),
    state: {
      step: session.state.step + 1,
      stage: "question",
      startedAt: "server",
      timeLimit: null,
      revealed: false,
      answered: 0,
      result: { ...r, order: orderOf(session, participants, r), turn: r.turn + 1, mode: "pick", choice: null, card: null, outcome: null, delta: 0, prev: flat(r) },
    },
  };
}

/** Взять задание гостя в колоду или отказать. */
export function handleSuggestion(session: Session, s: { id: string; pid: string; kind: TruthKind; text: string }, accept: boolean): SessionChange {
  const r = parseTruthResult(session.state.result);
  if (r.handled.includes(s.id)) return {};
  const extra = accept ? [...r.extra, { id: s.id, kind: s.kind, text: s.text, from: s.pid }] : r.extra;
  return { state: { result: { ...r, extra, handled: [...r.handled, s.id] } } };
}

export interface TruthBack {
  change: SessionChange;
  clearAnswers?: number;
}

/** «Назад» на один этап; null — некуда. */
export function truthBack(session: Session): TruthBack | null {
  const { stage, step } = session.state;
  const r = parseTruthResult(session.state.result);
  if (stage === "podium") return { change: podiumBack(session) };
  if (stage === "ready") return null;
  if (r.mode === "done") {
    const who = turnPid(r);
    return { change: { state: { stage: "question", revealed: false, result: { ...r, mode: "card", outcome: null, delta: 0 } }, ...(who && r.delta ? { addScore: { [who]: -r.delta } } : {}) } };
  }
  if (r.mode === "card") {
    // Карточку — обратно (гостевую — в очередь), выбор — заново: ответы хода стираются.
    const extra = r.card?.from ? [{ ...r.card, from: r.card.from }, ...r.extra] : r.extra;
    const used = r.card && !r.card.from ? r.used.filter((id) => id !== r.card?.id) : r.used;
    return { change: { state: { result: { ...r, mode: "pick", choice: null, card: null, extra, used } } }, clearAnswers: step };
  }
  if (r.prev) {
    // Принятые за этот ход задания гостей не теряются.
    const kept = r.extra.filter((c) => !r.prev?.extra.some((p) => p.id === c.id) && !r.prev?.handled.includes(c.id));
    return { change: { state: { step: step - 1, stage: "reveal", revealed: true, result: { ...r.prev, extra: [...r.prev.extra, ...kept], handled: [...new Set([...r.prev.handled, ...r.handled])], prev: null } } }, clearAnswers: step };
  }
  return { change: { state: { stage: "ready", startedAt: null, result: null } }, clearAnswers: step };
}
