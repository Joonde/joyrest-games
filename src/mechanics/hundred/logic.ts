// Ход «100 к 1» на пульте — чистые функции (пульт пишет в базу, репетиция и предпросмотр — в память).
//
// Обычный раунд (classic): заставка (`ready`, mode intro) → «Показать вопрос» (`question`, face: розыгрыш) →
// «Запустить отсчёт» (новый шаг: нажатия раньше не считаются) → капитаны двух играющих жмут «Жми первым!» →
// ведущий отмечает названный ответ (касание строки) или «Нет на табло» → «Играют …» (`reveal`, play) → команда
// отвечает по очереди: ответ на табло — очки в банк, «Нет на табло» — крестик → 3 крестика — «Шанс» соперника
// (steal: угадал — банк ему, нет — банк первой команде) → все ответы открыты или шанс сыгран — банк × множитель
// в счёт (done) → «Открыть остальные ответы» (без очков) → следующий раунд.
// «Большая игра» (classic): команда-лидер, два игрока по очереди на время, ведущий отмечает ответы на пульте,
// повтор ответа первого игрока не принимается; набрали `bigGoal` — плюс `bigBonus`.
// «Весь зал» (hall): каждый вопрос — заставка → ответы с телефонов (до трёх, таймер) → «Закрыть ответы» →
// ведущий засчитывает нераспознанные → открывает табло по одному ответу: каждый угадавший получает очки ответа.
// «Назад» — одно действие вместе с очками (`result.undo`, стопка до 12 действий).
import { buzzOrder, buzzWrong, EMPTY_BUZZ, parseBuzz, syncBuzz, type BuzzState } from "../../core/buzz";
import { leaderboardAdditions } from "../../core/leaderboard";
import { awardNow, podiumBack, podiumDone } from "../../core/podium";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import type { ScoreContext, ScoreDelta, Step } from "../types";
import { answerPoints, createHundred as createEmpty, HUNDRED_LIMITS, multiplierOf, ranked, type HundredContent, type HundredQuestion, type HundredRound } from "./content";
import { matchedAnswers, wordsOf } from "./match";

export type HundredMode = "intro" | "face" | "play" | "steal" | "done" | "big" | "bigDone" | "hall" | "hallCheck";

export interface BigCell {
  /** id ответа табло; null — «Нет на табло». */
  answer: string | null;
  text: string;
  points: number;
}

export interface BigState {
  team: string | null;
  /** Чей ход: первый (0) или второй (1) игрок. */
  player: 0 | 1;
  /** Ответы игроков по вопросам: [первый, второй]. */
  cells: [Array<BigCell | null>, Array<BigCell | null>];
  /** Второй игрок повторил ответ первого — номер вопроса для подсветки «Повтор!». */
  repeat: number | null;
}

export interface HundredCore {
  /** Номер раунда (с 0) и вопроса в нём. */
  round: number;
  q: number;
  mode: HundredMode;
  /** Две играющие команды (или игрока) раунда. */
  pair: string[];
  /** Кто играет раунд после розыгрыша. */
  playing: string | null;
  /** Открыты с очками (в банк). */
  opened: string[];
  /** Открыты в конце без очков. */
  shown: string[];
  strikes: number;
  /** Промахи розыгрыша (крестиками не считаются). */
  faceMiss: number;
  bank: number;
  armed: boolean;
  buzz: BuzzState;
  /** Кому ушёл банк и сколько (банк × множитель). */
  winner: string | null;
  award: number;
  /** «Весь зал»: ведущий засчитал ключ слова → id ответа ("" — не засчитывать). */
  accepted: Record<string, string>;
  /** «Весь зал»: сколько участников угадали открытый ответ (подпись «угадали: N» на табло). */
  hits: Record<string, number>;
  /** «Весь зал»: ответ можно поменять, пока идёт время. */
  changeable: boolean;
  big: BigState;
}

interface Snapshot {
  result: HundredCore;
  stage: "ready" | "question" | "reveal";
  step: number;
  timeLimit: number | null;
  /** Очки, начисленные этим действием (снимаются «Назад»). */
  score: Record<string, number>;
}

export interface HundredResult extends HundredCore {
  undo: Snapshot[];
}

/** Глубина «Назад»: результат уходит всем телефонам, поэтому стопка небольшая. */
export const UNDO_DEPTH = 12;

// ---------------------------------------------------------------- разбор

function rec(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const MODES: HundredMode[] = ["intro", "face", "play", "steal", "done", "big", "bigDone", "hall", "hallCheck"];

function pid(value: unknown): string | null {
  return typeof value === "string" && ID.test(value) ? value : null;
}

function ids(value: unknown, max = 500): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === "string" && ID.test(v)))].slice(0, max) : [];
}

function count(value: unknown, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(0, Math.round(value))) : 0;
}

function signed(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
}

function parseCell(value: unknown): BigCell | null {
  const d = rec(value);
  if (typeof d.text !== "string") return null;
  return { answer: pid(d.answer), text: d.text.slice(0, 80), points: count(d.points, 100) };
}

function parseCells(value: unknown): Array<BigCell | null> {
  const list = Array.isArray(value) ? value.slice(0, HUNDRED_LIMITS.bigQuestions) : [];
  return Array.from({ length: HUNDRED_LIMITS.bigQuestions }, (_, i) => parseCell(list[i]));
}

function parseBig(value: unknown): BigState {
  const d = rec(value);
  const cells = Array.isArray(d.cells) ? d.cells : [];
  const repeat = d.repeat;
  return {
    team: pid(d.team),
    player: d.player === 1 ? 1 : 0,
    cells: [parseCells(cells[0]), parseCells(cells[1])],
    repeat: typeof repeat === "number" && Number.isInteger(repeat) && repeat >= 0 && repeat < HUNDRED_LIMITS.bigQuestions ? repeat : null,
  };
}

function parseAccepted(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec(value)).slice(0, 500)) if (k.length > 0 && k.length <= 80 && typeof v === "string" && (v === "" || ID.test(v))) out[k] = v;
  return out;
}

function parseHits(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [aid, n] of Object.entries(rec(value)).slice(0, 20)) if (ID.test(aid)) out[aid] = count(n, 100_000);
  return out;
}

function parseCore(d: Record<string, unknown>): HundredCore {
  return {
    round: count(d.round, 100),
    q: count(d.q, HUNDRED_LIMITS.bigQuestions - 1),
    mode: MODES.includes(d.mode as HundredMode) ? (d.mode as HundredMode) : "intro",
    pair: ids(d.pair, 2),
    playing: pid(d.playing),
    opened: ids(d.opened, 20),
    shown: ids(d.shown, 20),
    strikes: count(d.strikes, HUNDRED_LIMITS.strikes),
    faceMiss: count(d.faceMiss, 99),
    bank: count(d.bank, 100_000),
    armed: d.armed === true,
    buzz: parseBuzz(d.buzz),
    winner: pid(d.winner),
    award: count(d.award, 1_000_000),
    accepted: parseAccepted(d.accepted),
    hits: parseHits(d.hits),
    changeable: d.changeable === true,
    big: parseBig(d.big),
  };
}

function parseSnapshot(value: unknown): Snapshot | null {
  const d = rec(value);
  const stage = d.stage === "question" || d.stage === "reveal" ? d.stage : d.stage === "ready" ? "ready" : null;
  if (!stage || typeof d.step !== "number" || !Number.isInteger(d.step) || d.step < 0) return null;
  const score: Record<string, number> = {};
  for (const [p, n] of Object.entries(rec(d.score))) if (ID.test(p)) score[p] = signed(n);
  const limit = d.timeLimit;
  return { result: parseCore(rec(d.result)), stage, step: d.step, timeLimit: typeof limit === "number" && Number.isFinite(limit) && limit > 0 ? limit : null, score };
}

export function parseHundredResult(raw: unknown): HundredResult {
  const d = rec(raw);
  const undo = Array.isArray(d.undo) ? d.undo.slice(-UNDO_DEPTH).map(parseSnapshot).filter((s): s is Snapshot => s !== null) : [];
  return { ...parseCore(d), undo };
}

function core(r: HundredResult | HundredCore): HundredCore {
  const { undo: _undo, ...rest } = r as HundredResult;
  void _undo;
  return JSON.parse(JSON.stringify(rest)) as HundredCore;
}

function write(r: HundredResult): Record<string, unknown> {
  return JSON.parse(JSON.stringify(r)) as Record<string, unknown>;
}

// ---------------------------------------------------------------- где мы

export function roundOf(content: HundredContent, r: Pick<HundredCore, "round">): HundredRound | null {
  return content.rounds[r.round] ?? null;
}

export function questionOf(content: HundredContent, r: Pick<HundredCore, "round" | "q">): HundredQuestion | null {
  return content.rounds[r.round]?.questions[r.q] ?? null;
}

/** Классика или «Весь зал» для текущего раунда: «Большая игра» в «Весь зал» идёт обычными вопросами зала. */
export function isHall(content: HundredContent): boolean {
  return content.mode === "hall";
}

/** Есть ли что-то после текущего вопроса. */
export function hasNext(content: HundredContent, r: Pick<HundredCore, "round" | "q">): boolean {
  const round = content.rounds[r.round];
  if (round && isHall(content) && r.q + 1 < round.questions.length) return true;
  return r.round + 1 < content.rounds.length;
}

/** Номер вопроса для «вопрос 2 из 5» в «Весь зал» (с 1) и всего. */
export function hallNumber(content: HundredContent, r: Pick<HundredCore, "round" | "q">): { n: number; total: number } {
  let n = 0;
  let total = 0;
  content.rounds.forEach((round, i) => {
    if (i < r.round) n += round.questions.length;
    total += round.questions.length;
  });
  return { n: n + r.q + 1, total };
}

/** Участники по порядку входа (jsonb на сервере не хранит порядок ключей). */
export function orderedIds(session: Session, participants: Participant[]): string[] {
  const joined = new Map(participants.map((p) => [p.id, p.joinedAt ?? 0]));
  return Object.keys(session.leaderboard).sort((a, b) => (joined.get(a) ?? Number.MAX_SAFE_INTEGER) - (joined.get(b) ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b));
}

/** Пара раунда по умолчанию: по кругу, каждая следующая обычная игра — следующие двое. */
export function defaultPair(content: HundredContent, ordered: string[], roundIndex: number): string[] {
  if (ordered.length <= 2) return [...ordered];
  const k = content.rounds.slice(0, roundIndex).filter((r) => r.kind !== "big").length;
  const n = ordered.length;
  const a = ordered[(2 * k) % n] ?? "";
  const b = ordered[(2 * k + 1) % n] ?? "";
  return a === b ? [a] : [a, b];
}

/** Лидер по счёту (для «Большой игры»); при равных — кто раньше вошёл. */
export function leaderOf(session: Session, ordered: string[]): string | null {
  let best: string | null = null;
  for (const p of ordered) if (best === null || (session.leaderboard[p]?.score ?? 0) > (session.leaderboard[best]?.score ?? 0)) best = p;
  return best;
}

export function opponentOf(r: Pick<HundredCore, "pair" | "playing">): string | null {
  return r.pair.find((p) => p !== r.playing) ?? null;
}

/** Все ответы табло открыты (с очками или без). */
export function allOpen(question: HundredQuestion, r: Pick<HundredCore, "opened" | "shown">): boolean {
  return question.answers.every((a) => r.opened.includes(a.id) || r.shown.includes(a.id));
}

export function bigTotal(big: BigState): number {
  return [...big.cells[0], ...big.cells[1]].reduce((s, c) => s + (c?.points ?? 0), 0);
}

/** Сумма за «Большую игру»: очки ответов и бонус, если набрали цель. */
export function bigAward(content: HundredContent, big: BigState): number {
  const total = bigTotal(big);
  return total + (total >= content.bigGoal ? content.bigBonus : 0);
}

// ---------------------------------------------------------------- запись действия

interface CommitOptions {
  stage: "ready" | "question" | "reveal";
  newStep?: boolean;
  /** Задать таймер шага (только с `stage: question`); не задано — таймер шага не трогаем. */
  timer?: number | null;
  score?: Record<string, number>;
  /** Действие без «Назад» (выбор пары, синхронизация кнопки). */
  silent?: boolean;
  /** «Весь зал»: очки действия «Назад» пересчитает по ответам — в стопку их не кладём (их может быть сотни). */
  recompute?: boolean;
}

function stageOf(session: Session): Snapshot["stage"] {
  const s = session.state.stage;
  return s === "question" || s === "reveal" ? s : "ready";
}

function commit(session: Session, participants: Participant[], prev: HundredResult, next: HundredCore, options: CommitOptions): SessionChange {
  const score = Object.fromEntries(Object.entries(options.score ?? {}).filter(([, n]) => n !== 0 && Number.isFinite(n)));
  const undo = options.silent ? prev.undo : [...prev.undo, { result: core(prev), stage: stageOf(session), step: session.state.step, timeLimit: session.state.timeLimit ?? null, score: options.recompute ? {} : score }].slice(-UNDO_DEPTH);
  const { stage } = options;
  const state: NonNullable<SessionChange["state"]> = { stage, revealed: stage === "reveal", result: write({ ...next, undo }) };
  if (options.newStep) {
    state.step = session.state.step + 1;
    state.answered = 0;
  }
  if (stage !== "question") {
    state.startedAt = null;
    state.timeLimit = null;
  } else if (options.timer !== undefined) {
    state.startedAt = "server";
    state.timeLimit = options.timer;
  }
  const additions = leaderboardAdditions(session.leaderboard, participants, session.playMode);
  return {
    state,
    ...(Object.keys(additions).length > 0 ? { leaderboard: additions } : {}),
    ...(Object.keys(score).length > 0 ? { addScore: score } : {}),
  };
}

/** Чистое состояние нового вопроса. */
function fresh(prev: HundredCore, round: number, q: number, pair: string[]): HundredCore {
  return {
    ...prev,
    round,
    q,
    mode: "intro",
    pair,
    playing: null,
    opened: [],
    shown: [],
    strikes: 0,
    faceMiss: 0,
    bank: 0,
    armed: false,
    buzz: EMPTY_BUZZ,
    winner: null,
    award: 0,
    accepted: {},
    hits: {},
    changeable: false,
    big: { team: null, player: 0, cells: [parseCells([]), parseCells([])], repeat: null },
  };
}

// ---------------------------------------------------------------- главная кнопка пульта

export type HundredAction =
  | "start"
  | "arm"
  | "face"
  | "play"
  | "steal"
  | "rest"
  | "next"
  | "award"
  | "bigStart"
  | "bigEnter"
  | "bigSecond"
  | "bigFinish"
  | "hallOpen"
  | "hallClose"
  | "hallRows"
  | "podiumNext"
  | "finish";

export function hundredPrimary(session: Session, content: HundredContent): HundredAction {
  if (session.state.stage === "podium") return podiumDone(session) ? "finish" : "podiumNext";
  const r = parseHundredResult(session.state.result);
  const round = roundOf(content, r);
  const question = questionOf(content, r);
  if (!round || !question) return "award";
  const last = !hasNext(content, r);
  switch (r.mode) {
    case "intro":
      return isHall(content) ? "hallOpen" : round.kind === "big" ? "bigStart" : "start";
    case "face":
      return r.armed ? "face" : "arm";
    case "play":
      return "play";
    case "steal":
      return "steal";
    case "done":
      return !allOpen(question, r) ? "rest" : last ? "award" : "next";
    case "big": {
      const cells = r.big.cells[r.big.player];
      if (session.state.stage === "ready" && cells.every((c) => c === null)) return "bigStart";
      if (round.questions.some((_, i) => !cells[i])) return "bigEnter";
      return r.big.player === 0 ? "bigSecond" : "bigFinish";
    }
    case "bigDone":
      return last ? "award" : "next";
    case "hall":
      return "hallClose";
    case "hallCheck":
      return !question.answers.every((a) => r.opened.includes(a.id)) ? "hallRows" : last ? "award" : "next";
  }
}

// ---------------------------------------------------------------- обычный раунд

/** «Показать вопрос»: розыгрыш, кнопки пока не активны (сначала ведущий читает вопрос). */
export function startFace(session: Session, content: HundredContent, participants: Participant[]): SessionChange | null {
  const r = parseHundredResult(session.state.result);
  const round = roundOf(content, r);
  if (r.mode !== "intro" || !round || round.kind === "big" || isHall(content)) return null;
  const ordered = orderedIds({ ...session, leaderboard: { ...session.leaderboard, ...leaderboardAdditions(session.leaderboard, participants, session.playMode) } }, participants);
  const pair = r.pair.length > 0 ? r.pair : defaultPair(content, ordered, r.round);
  return commit(session, participants, r, { ...core(r), mode: "face", pair, armed: false, buzz: EMPTY_BUZZ }, { stage: "question", timer: null });
}

/** Кто играет раунд (до «Запустить отсчёт» и на заставке): пульт касанием выбирает двоих. */
export function setPair(session: Session, participants: Participant[], pair: string[]): SessionChange | null {
  const r = parseHundredResult(session.state.result);
  if (r.mode !== "intro" && !(r.mode === "face" && !r.armed)) return null;
  const clean = [...new Set(pair)].filter((p) => session.leaderboard[p]).slice(0, 2);
  return commit(session, participants, r, { ...core(r), pair: clean }, { stage: stageOf(session), silent: true });
}

/** «Запустить отсчёт»: новый шаг — нажатия до него не считаются; время — `content.buzzTime`. */
export function armFace(session: Session, content: HundredContent, participants: Participant[]): SessionChange | null {
  const r = parseHundredResult(session.state.result);
  if (r.mode !== "face" || r.armed) return null;
  return commit(session, participants, r, { ...core(r), armed: true, buzz: EMPTY_BUZZ }, { stage: "question", newStep: true, timer: content.buzzTime });
}

/** Свежие нажатия → у кого слово (только у играющей пары); null — писать нечего. */
export function hundredBuzzSync(session: Session, answers: Answer[]): SessionChange | null {
  const r = parseHundredResult(session.state.result);
  if (session.state.stage !== "question" || r.mode !== "face" || !r.armed) return null;
  const order = buzzOrder(answers, session.state.step).filter((p) => r.pair.includes(p));
  const next = syncBuzz(r.buzz, order);
  return next ? { state: { result: write({ ...r, buzz: next }) } } : null;
}

/** Банк раунда уходит победителю: банк × множитель. */
function finishRound(session: Session, content: HundredContent, participants: Participant[], prev: HundredResult, next: HundredCore, winner: string | null): SessionChange {
  const round = roundOf(content, next);
  const award = winner ? next.bank * multiplierOf(round?.kind ?? "simple") : 0;
  return commit(session, participants, prev, { ...next, mode: "done", winner, award, armed: false }, { stage: "reveal", score: winner && award > 0 ? { [winner]: award } : {} });
}

/** Ведущий коснулся ответа на табло. */
export function openAnswer(session: Session, content: HundredContent, participants: Participant[], answerId: string, answers: Answer[] = []): SessionChange | null {
  const r = parseHundredResult(session.state.result);
  const round = roundOf(content, r);
  const question = questionOf(content, r);
  if (!round || !question || !question.answers.some((a) => a.id === answerId)) return null;
  if (r.opened.includes(answerId) || r.shown.includes(answerId)) return null;
  if (r.mode === "hallCheck") return hallOpenRow(session, content, participants, answers, answerId);
  if (r.mode === "done" || r.mode === "bigDone") return commit(session, participants, r, { ...core(r), shown: [...r.shown, answerId] }, { stage: "reveal" });
  if (r.mode !== "face" && r.mode !== "play" && r.mode !== "steal") return null;
  const next: HundredCore = { ...core(r), opened: [...r.opened, answerId], bank: r.bank + answerPoints(round.kind, question, answerId) };
  if (r.mode === "steal") return finishRound(session, content, participants, r, next, opponentOf(r));
  if (allOpen(question, next)) return finishRound(session, content, participants, r, next, r.mode === "play" ? r.playing : (r.buzz.current ?? r.pair[0] ?? null));
  return commit(session, participants, r, next, { stage: stageOf(session) });
}

/** «✕ Нет на табло». */
export function missAnswer(session: Session, content: HundredContent, participants: Participant[]): SessionChange | null {
  const r = parseHundredResult(session.state.result);
  if (r.mode === "face") return commit(session, participants, r, { ...core(r), faceMiss: r.faceMiss + 1, buzz: buzzWrong(r.buzz) }, { stage: "question" });
  if (r.mode === "play") {
    const strikes = r.strikes + 1;
    const next: HundredCore = { ...core(r), strikes };
    if (strikes < HUNDRED_LIMITS.strikes) return commit(session, participants, r, next, { stage: "reveal" });
    // Соперника нет (игрок один) — банк остаётся у играющих.
    if (!opponentOf(r)) return finishRound(session, content, participants, r, next, r.playing);
    return commit(session, participants, r, { ...next, mode: "steal" }, { stage: "reveal" });
  }
  // Шанс не использован — банк первой команде.
  if (r.mode === "steal") return finishRound(session, content, participants, r, core(r), r.playing);
  return null;
}

/** «Играют …»: после розыгрыша ведущий отдаёт раунд одной из пары. */
export function choosePlaying(session: Session, participants: Participant[], who: string): SessionChange | null {
  const r = parseHundredResult(session.state.result);
  if (r.mode !== "face" || !r.pair.includes(who)) return null;
  return commit(session, participants, r, { ...core(r), mode: "play", playing: who, strikes: 0, armed: false }, { stage: "reveal" });
}

/** «Открыть остальные ответы» — без очков. */
export function showRest(session: Session, content: HundredContent, participants: Participant[]): SessionChange | null {
  const r = parseHundredResult(session.state.result);
  const question = questionOf(content, r);
  if (!question || (r.mode !== "done" && r.mode !== "bigDone")) return null;
  const rest = ranked(question).filter((a) => !r.opened.includes(a.id) && !r.shown.includes(a.id)).map((a) => a.id);
  if (rest.length === 0) return null;
  return commit(session, participants, r, { ...core(r), shown: [...r.shown, ...rest] }, { stage: "reveal" });
}

/** Следующий вопрос или раунд: заставка. Вопросов больше нет — null (дальше награждение). */
export function nextQuestion(session: Session, content: HundredContent, participants: Participant[]): SessionChange | null {
  const r = parseHundredResult(session.state.result);
  if (!hasNext(content, r)) return null;
  const round = content.rounds[r.round];
  const inRound = isHall(content) && round && r.q + 1 < round.questions.length;
  const nextRound = inRound ? r.round : r.round + 1;
  const nextQ = inRound ? r.q + 1 : 0;
  const board = { ...session.leaderboard, ...leaderboardAdditions(session.leaderboard, participants, session.playMode) };
  const ordered = orderedIds({ ...session, leaderboard: board }, participants);
  const pair = isHall(content) ? [] : defaultPair(content, ordered, nextRound);
  const next = fresh(core(r), nextRound, nextQ, pair);
  if (content.rounds[nextRound]?.kind === "big" && !isHall(content)) next.big.team = leaderOf({ ...session, leaderboard: board }, ordered);
  return commit(session, participants, r, next, { stage: "ready", newStep: true });
}

/** Всё сыграно — награждение (пьедестал; «Назад» с заставки вернёт сюда). */
export function hundredAward(session: Session): SessionChange {
  return awardNow(session);
}

// ---------------------------------------------------------------- «Большая игра»

/** Кто играет «Большую игру» (по умолчанию — лидер). */
export function setBigTeam(session: Session, participants: Participant[], team: string): SessionChange | null {
  const r = parseHundredResult(session.state.result);
  const cells = r.big.cells;
  const begun = cells[0].some(Boolean) || cells[1].some(Boolean);
  if ((r.mode !== "intro" && r.mode !== "big") || begun || !session.leaderboard[team]) return null;
  return commit(session, participants, r, { ...core(r), big: { ...r.big, team } }, { stage: stageOf(session), silent: true });
}

/** «Запустить таймер»: первому игроку `bigTimes[0]` секунд, второму — `bigTimes[1]`. */
export function bigStart(session: Session, content: HundredContent, participants: Participant[]): SessionChange | null {
  const r = parseHundredResult(session.state.result);
  const round = roundOf(content, r);
  if (!round || round.kind !== "big" || isHall(content) || (r.mode !== "intro" && r.mode !== "big")) return null;
  const ordered = orderedIds(session, participants);
  const team = r.big.team ?? leaderOf(session, ordered);
  return commit(session, participants, r, { ...core(r), mode: "big", big: { ...r.big, team, repeat: null } }, { stage: "question", newStep: true, timer: content.bigTimes[r.big.player] });
}

/** Ведущий отметил ответ игрока на вопрос `q`: ответ табло или null — «Нет на табло». Повтор первого — не принимается. */
export function bigEnter(session: Session, content: HundredContent, participants: Participant[], q: number, answerId: string | null): SessionChange | null {
  const r = parseHundredResult(session.state.result);
  const round = roundOf(content, r);
  const question = round?.kind === "big" ? round.questions[q] : undefined;
  if (r.mode !== "big" || !question) return null;
  const answer = answerId ? question.answers.find((a) => a.id === answerId) : null;
  if (answerId && !answer) return null;
  const p = r.big.player;
  if (p === 1 && answer && r.big.cells[0][q]?.answer === answer.id) {
    // «Повтор, другой ответ!» — подсветка на экране, ответ не записан.
    return commit(session, participants, r, { ...core(r), big: { ...r.big, repeat: q } }, { stage: stageOf(session), silent: true });
  }
  const cell: BigCell = answer ? { answer: answer.id, text: answer.text, points: answer.points } : { answer: null, text: "Нет на табло", points: 0 };
  const row = [...r.big.cells[p]];
  row[q] = cell;
  const cells: BigState["cells"] = p === 0 ? [row, r.big.cells[1]] : [r.big.cells[0], row];
  return commit(session, participants, r, { ...core(r), big: { ...r.big, cells, repeat: null } }, { stage: stageOf(session) });
}

/** Первый игрок ответил — очередь второго (таймер запустит ведущий). */
export function bigSecond(session: Session, participants: Participant[]): SessionChange | null {
  const r = parseHundredResult(session.state.result);
  if (r.mode !== "big" || r.big.player !== 0) return null;
  return commit(session, participants, r, { ...core(r), big: { ...r.big, player: 1, repeat: null } }, { stage: "ready" });
}

/** Итог «Большой игры»: очки ответов обоих игроков (+ бонус, если набрали цель) — команде. */
export function bigFinish(session: Session, content: HundredContent, participants: Participant[]): SessionChange | null {
  const r = parseHundredResult(session.state.result);
  if (r.mode !== "big" || r.big.player !== 1) return null;
  const award = bigAward(content, r.big);
  const team = r.big.team;
  return commit(session, participants, r, { ...core(r), mode: "bigDone", winner: team, award, big: { ...r.big, repeat: null } }, { stage: "reveal", score: team && award > 0 ? { [team]: award } : {} });
}

// ---------------------------------------------------------------- «Весь зал»

/** «Открыть вопрос»: все пишут до трёх ответов с телефона, пока идёт время. */
export function hallOpen(session: Session, content: HundredContent, participants: Participant[]): SessionChange | null {
  const r = parseHundredResult(session.state.result);
  if (!isHall(content) || r.mode !== "intro" || !questionOf(content, r)) return null;
  return commit(session, participants, r, { ...core(r), mode: "hall", changeable: true }, { stage: "question", newStep: true, timer: content.hallTime });
}

/** «Закрыть ответы»: дальше ведущий засчитывает нераспознанные и открывает табло. */
export function hallClose(session: Session, participants: Participant[]): SessionChange | null {
  const r = parseHundredResult(session.state.result);
  if (r.mode !== "hall") return null;
  return commit(session, participants, r, { ...core(r), mode: "hallCheck", changeable: false }, { stage: "reveal" });
}

/** Сколько кому положено за открытые ответы табло (множитель раунда; в «Игре наоборот» — по месту). */
export function hallPayouts(content: HundredContent, r: Pick<HundredCore, "round" | "q" | "opened" | "accepted">, answers: Array<Pick<Answer, "pid" | "value">>): Record<string, Record<string, number>> {
  const round = roundOf(content, r);
  const question = questionOf(content, r);
  if (!round || !question) return {};
  const mult = multiplierOf(round.kind);
  const out: Record<string, Record<string, number>> = {};
  for (const aid of r.opened) out[aid] = {};
  for (const a of answers) {
    for (const aid of matchedAnswers(question, wordsOf(a.value), r.accepted)) {
      const row = out[aid];
      if (row) row[a.pid] = answerPoints(round.kind, question, aid) * mult;
    }
  }
  return out;
}

function totals(paid: Record<string, Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of Object.values(paid)) for (const [p, n] of Object.entries(row)) out[p] = (out[p] ?? 0) + n;
  return out;
}

/** Разница начисленного «Весь зал» между двумя состояниями (по тем же ответам шага). */
function hallDiff(content: HundredContent, from: HundredCore, to: HundredCore, answers: Array<Pick<Answer, "pid" | "value">>): Record<string, number> {
  const before = totals(hallPayouts(content, from, answers));
  const after = totals(hallPayouts(content, to, answers));
  const score: Record<string, number> = {};
  for (const p of new Set([...Object.keys(before), ...Object.keys(after)])) score[p] = (after[p] ?? 0) - (before[p] ?? 0);
  return score;
}

/**
 * Пересчёт «Весь зал»: прибавка — разница с уже начисленным. Кому сколько начислено, в результате не храним (он уходит
 * всем телефонам): это чистая функция открытых строк, засчитанных слов и ответов шага (после «Закрыть ответы» они не
 * меняются), поэтому «Назад» пересчитывает так же (`hundredBack`).
 */
function repay(session: Session, content: HundredContent, participants: Participant[], r: HundredResult, next: HundredCore, answers: Answer[]): SessionChange {
  const list = answers.filter((a) => a.step === session.state.step);
  const paid = hallPayouts(content, next, list);
  const hits: Record<string, number> = {};
  for (const [aid, row] of Object.entries(paid)) hits[aid] = Object.keys(row).length;
  return commit(session, participants, r, { ...next, hits }, { stage: "reveal", score: hallDiff(content, r, next, list), recompute: true });
}

/** Открыть ответ табло: каждый, кто его написал, получает очки ответа. */
export function hallOpenRow(session: Session, content: HundredContent, participants: Participant[], answers: Answer[], answerId: string): SessionChange | null {
  const r = parseHundredResult(session.state.result);
  const question = questionOf(content, r);
  if (r.mode !== "hallCheck" || !question || r.opened.includes(answerId) || !question.answers.some((a) => a.id === answerId)) return null;
  return repay(session, content, participants, r, { ...core(r), opened: [...r.opened, answerId] }, answers);
}

/** «Открыть следующий ответ»: от самого редкого к самому популярному. */
export function hallOpenNext(session: Session, content: HundredContent, participants: Participant[], answers: Answer[]): SessionChange | null {
  const r = parseHundredResult(session.state.result);
  const question = questionOf(content, r);
  if (!question) return null;
  const next = [...ranked(question)].reverse().find((a) => !r.opened.includes(a.id));
  return next ? hallOpenRow(session, content, participants, answers, next.id) : null;
}

/** Ведущий засчитал нераспознанный ответ зала как ответ табло (или "" — не засчитывать). */
export function hallAccept(session: Session, content: HundredContent, participants: Participant[], answers: Answer[], key: string, answerId: string): SessionChange | null {
  const r = parseHundredResult(session.state.result);
  const question = questionOf(content, r);
  if (r.mode !== "hallCheck" || !question || !key || key.length > 80) return null;
  if (answerId !== "" && !question.answers.some((a) => a.id === answerId)) return null;
  return repay(session, content, participants, r, { ...core(r), accepted: { ...r.accepted, [key]: answerId } }, answers);
}

/** Сколько участников угадали ответ (для подписи на табло). */
export function hitsOf(r: Pick<HundredCore, "hits">, answerId: string): number {
  return r.hits[answerId] ?? 0;
}

// ---------------------------------------------------------------- «Назад»

export interface HundredBack {
  change: SessionChange;
  /** Шаги, ответы которых убрать (нажатия после «Запустить отсчёт»). */
  clear: number[];
}

/**
 * «Назад» на одно действие (очки этого действия снимаются); null — назад некуда. `answers` — ответы текущего шага:
 * по ним «Весь зал» пересчитывает, сколько снять.
 */
export function hundredBack(session: Session, content: HundredContent, answers: Array<Pick<Answer, "pid" | "value" | "step">> = []): HundredBack | null {
  if (session.state.stage === "podium") return { change: podiumBack(session), clear: [] };
  const r = parseHundredResult(session.state.result);
  const snap = r.undo.at(-1);
  if (!snap) return null;
  const step = session.state.step;
  const hall = r.mode === "hallCheck" && snap.result.mode === "hallCheck" && snap.step === step;
  const minus = hall
    ? hallDiff(content, core(r), snap.result, answers.filter((a) => a.step === step))
    : Object.fromEntries(Object.entries(snap.score).map(([p, n]) => [p, -n]));
  const restored: HundredResult = { ...snap.result, undo: r.undo.slice(0, -1) };
  const addScore = Object.fromEntries(Object.entries(minus).filter(([, n]) => n !== 0));
  const change: SessionChange = {
    state: {
      step: snap.step,
      stage: snap.stage,
      revealed: snap.stage === "reveal",
      startedAt: snap.stage === "question" ? "server" : null,
      timeLimit: snap.stage === "question" ? snap.timeLimit : null,
      result: write(restored),
    },
    ...(Object.keys(addScore).length > 0 ? { addScore } : {}),
  };
  if (snap.step !== step) change.state = { ...change.state, answered: 0 };
  // Шаги новее восстановленного — их нажатия и ответы убрать (иначе вернутся при следующем отсчёте).
  const clear = Array.from({ length: Math.max(0, step - snap.step) }, (_, i) => snap.step + 1 + i);
  return { change, clear };
}

// ---------------------------------------------------------------- шаги и очки (интерфейс механики)

export interface HundredStep extends Step {
  question: HundredQuestion;
  kind: HundredRound["kind"];
  hall: boolean;
}

export function hundredSteps(content: HundredContent): HundredStep[] {
  return content.rounds.flatMap((round) => round.questions.map((question) => ({ id: `${round.id}:${question.id}`, answerable: true, question, kind: round.kind, hall: isHall(content) })));
}

/** Очки шага по итогам, записанным пультом: банк раунда победителю или «Весь зал» по ответам гостей. */
export function score(step: HundredStep, answers: Answer[], { state }: ScoreContext): ScoreDelta[] {
  const r = parseHundredResult(state.result);
  if (step.hall && r.mode === "hallCheck") {
    const content: HundredContent = { ...createEmpty(), mode: "hall", rounds: [{ id: "r", kind: step.kind, questions: [step.question] }] };
    const paid = hallPayouts(content, { round: 0, q: 0, opened: r.opened, accepted: r.accepted }, answers);
    return Object.entries(totals(paid)).map(([p, delta]) => ({ pid: p, delta }));
  }
  if ((r.mode === "done" || r.mode === "bigDone") && r.winner && r.award > 0) return [{ pid: r.winner, delta: r.award }];
  return [];
}
