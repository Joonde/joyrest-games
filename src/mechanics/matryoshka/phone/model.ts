/**
 * Телефон гостя «Игр Матрёшки» без React (Блок 3b, docs/matryoshka.md «3b — телефон»): личный поток комнаты (снимок, дальше
 * `{ t: "me", me }` целиком), пауза, закрытие потока, часы сервера — и какой экран сейчас показывать. Чистые функции: их
 * проверяют тесты (`model.test.ts`) и стенд телефона (`scripts/robot/matryoshka-phone.*`).
 */
import type { RoomClosedReason, RoomStreamEvent } from "../../../data/types";
import type { Gesture, Phase, Role, ShapeId, Side, Style, TrialKind, TrialStage } from "../rules/types";

// ------------------------------------------------------------------ личный вид (разбор без исключений)

export interface MeGuess {
  open: boolean;
  max: number;
  mine: number | null;
}
export interface MeFreeze {
  runEnds: number | null;
  /** Делений в секунду удержания (для плавного пути между сводками). */
  speed: number;
  path: number;
  holding: boolean;
  finished: boolean;
  caught: number;
  /** Следующий взгляд Матрёшки — за 1 с (часы сервера): `at` — «ЗАМРИ!», `end` — конец взгляда. */
  gaze: { n: number; at: number; end: number } | null;
  caughtNow: number | null;
}
export interface MeGinger {
  sub: "pick" | "unbox" | "trace" | "over";
  pickEnds: number | null;
  unboxEnds: number | null;
  traceEnds: number | null;
  box: number | null;
  auto: boolean;
  shape: ShapeId | null;
  shapeTitle: string | null;
  c: number;
  cracked: boolean;
  done: boolean;
}
export interface MeChairs {
  round: number;
  sub: "music" | "stop" | "seat";
  inRound: boolean;
  chairs: number;
  stopAt: number | null;
  appearAt: number | null;
  closeAt: number | null;
  tapped: boolean;
  seated: boolean | null;
  chair: number | null;
  rounds: number;
}
export interface MeRope {
  sub: "split" | "pull" | "rest" | "over";
  side: 0 | 1 | null;
  fan: boolean;
  attempt: number;
  attemptEnds: number | null;
  restEnds: number | null;
  knot: number;
  wins: [number, number];
  taps: number;
}
export interface MeHop {
  row: number;
  sub: "brave" | "jump" | "choose" | "crack" | "over";
  jumper: boolean;
  braveAt: number | null;
  braveEnds: number | null;
  jumpEnds: number | null;
  chooseEnds: number | null;
  brave: boolean;
  braveTapped: boolean;
  /** Куда прыгнули смельчаки (видно с начала выбора), без того, чем кончилось. */
  braves: Array<Side | null> | null;
  pick: Side | null;
  fell: boolean;
  solid: Side | null;
  coins: number;
}
export interface MeResult {
  place: number | null;
  of: number;
  lostHeart: boolean;
  out: boolean;
  fails: number | null;
  guess: number | null;
  guessPoints: number;
}
export interface MeTrial {
  index: number;
  kind: TrialKind;
  stage: TrialStage;
  stageEnds: number | null;
  seeding: boolean;
  guess: MeGuess | null;
  freeze: MeFreeze | null;
  ginger: MeGinger | null;
  chairs: MeChairs | null;
  rope: MeRope | null;
  hop: MeHop | null;
  result: MeResult | null;
}
export interface MeChance {
  stage: "offer" | "question" | "back" | "done";
  stageAt: number | null;
  stageEnds: number | null;
  eligible: boolean;
  q: string | null;
  options: string[] | null;
  answered: number | null;
  correct: number | null;
  returned: boolean;
}
export interface MeDobivka {
  stage: "intro" | "rows" | "results";
  stageEnds: number | null;
  row: number;
  jumper: boolean;
  chooseEnds: number | null;
  pick: Side | null;
  fell: boolean;
  solid: Side | null;
  out: boolean;
}
export interface Who {
  num: number;
  name: string;
}
export interface MeDuel {
  me: 0 | 1;
  opponent: Who;
  wins: [number, number];
  roundNo: number;
  stage: "bets" | "pick" | "show" | "over";
  stageEnds: number | null;
  pick: Gesture | null;
  auto: boolean;
  gestures: [Gesture, Gesture] | null;
  winner: boolean | null;
}
export interface MeWatch {
  a: Who;
  b: Who;
  wins: [number, number];
  stage: "bets" | "pick" | "show" | "over";
  stageEnds: number | null;
  bet: 0 | 1 | null;
  betOpen: boolean;
  winner: 0 | 1 | null;
}
export interface MeFinal {
  stage: "bracket" | "duel" | "champion";
  finalist: boolean;
  seed: number | null;
  champion: boolean;
  bestFan: boolean;
  duel: MeDuel | null;
  watch: MeWatch | null;
}
export interface Me {
  num: number;
  name: string;
  role: Role;
  late: boolean;
  hearts: number;
  /** Сердечек на старте (дети 2, взрослые 1). */
  lives: number;
  phase: Phase;
  style: Style;
  coins: number;
  fanScore: number;
  returned: boolean;
  removed: boolean;
  lobbyCount: number | null;
  trial: MeTrial | null;
  chance: MeChance | null;
  dobivka: MeDobivka | null;
  final: MeFinal | null;
  podium: { place: number; points: number } | null;
}

function rec(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function n0(v: unknown): number {
  return num(v) ?? 0;
}
function bool(v: unknown): boolean {
  return v === true;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function oneOf<T extends string>(v: unknown, list: readonly T[], fallback: T): T {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback;
}
function side(v: unknown): Side | null {
  return v === "L" || v === "R" ? v : null;
}
function gesture(v: unknown): Gesture | null {
  return v === "r" || v === "p" || v === "s" ? v : null;
}
function pair(v: unknown): [number, number] {
  return Array.isArray(v) ? [n0(v[0]), n0(v[1])] : [0, 0];
}
function bit(v: unknown): 0 | 1 | null {
  return v === 0 || v === 1 ? v : null;
}
function who(v: unknown): Who {
  const r = rec(v);
  return { num: n0(r?.num), name: str(r?.name) };
}

const KINDS: readonly TrialKind[] = ["freeze", "ginger", "chairs", "rope", "hopscotch"];
const STAGES: readonly TrialStage[] = ["open", "rules", "countdown", "play", "judging", "reveal", "results"];
const SHAPES: readonly ShapeId[] = ["circle", "star", "tree", "matryoshka", "umbrella", "heart", "house"];
const PHASES: readonly Phase[] = ["lobby", "trial", "chance", "dobivka", "final", "podium", "finished"];
const DUEL_STAGES = ["bets", "pick", "show", "over"] as const;

function parseFreeze(v: unknown): MeFreeze | null {
  const r = rec(v);
  if (!r) return null;
  const g = rec(r.gaze);
  const at = num(g?.at);
  const end = num(g?.end);
  return {
    runEnds: num(r.runEnds),
    speed: n0(r.speed),
    path: n0(r.path),
    holding: bool(r.holding),
    finished: bool(r.finished),
    caught: n0(r.caught),
    gaze: g && at !== null && end !== null ? { n: n0(g.n), at, end } : null,
    caughtNow: num(r.caughtNow),
  };
}

function parseGinger(v: unknown): MeGinger | null {
  const r = rec(v);
  if (!r) return null;
  const shape = typeof r.shape === "string" && (SHAPES as readonly string[]).includes(r.shape) ? (r.shape as ShapeId) : null;
  return {
    sub: oneOf(r.sub, ["pick", "unbox", "trace", "over"] as const, "pick"),
    pickEnds: num(r.pickEnds),
    unboxEnds: num(r.unboxEnds),
    traceEnds: num(r.traceEnds),
    box: num(r.box),
    auto: bool(r.auto),
    shape,
    shapeTitle: typeof r.shapeTitle === "string" ? r.shapeTitle : null,
    c: n0(r.c),
    cracked: bool(r.cracked),
    done: bool(r.done),
  };
}

function parseChairs(v: unknown): MeChairs | null {
  const r = rec(v);
  if (!r) return null;
  return {
    round: n0(r.round),
    sub: oneOf(r.sub, ["music", "stop", "seat"] as const, "music"),
    inRound: bool(r.inRound),
    chairs: n0(r.chairs),
    stopAt: num(r.stopAt),
    appearAt: num(r.appearAt),
    closeAt: num(r.closeAt),
    tapped: bool(r.tapped),
    seated: r.seated === true ? true : r.seated === false ? false : null,
    chair: num(r.chair),
    rounds: n0(r.rounds),
  };
}

function parseRope(v: unknown): MeRope | null {
  const r = rec(v);
  if (!r) return null;
  return {
    sub: oneOf(r.sub, ["split", "pull", "rest", "over"] as const, "split"),
    side: bit(r.side),
    fan: bool(r.fan),
    attempt: n0(r.attempt),
    attemptEnds: num(r.attemptEnds),
    restEnds: num(r.restEnds),
    knot: n0(r.knot),
    wins: pair(r.wins),
    taps: n0(r.taps),
  };
}

function parseHop(v: unknown): MeHop | null {
  const r = rec(v);
  if (!r) return null;
  return {
    row: n0(r.row),
    sub: oneOf(r.sub, ["brave", "jump", "choose", "crack", "over"] as const, "brave"),
    jumper: bool(r.jumper),
    braveAt: num(r.braveAt),
    braveEnds: num(r.braveEnds),
    jumpEnds: num(r.jumpEnds),
    chooseEnds: num(r.chooseEnds),
    brave: bool(r.brave),
    braveTapped: bool(r.braveTapped),
    braves: Array.isArray(r.braves) ? r.braves.map(side) : null,
    pick: side(r.pick),
    fell: bool(r.fell),
    solid: side(r.solid),
    coins: n0(r.coins),
  };
}

function parseResult(v: unknown): MeResult | null {
  const r = rec(v);
  if (!r) return null;
  return { place: num(r.place), of: n0(r.of), lostHeart: bool(r.lostHeart), out: bool(r.out), fails: num(r.fails), guess: num(r.guess), guessPoints: n0(r.guessPoints) };
}

function parseTrial(v: unknown): MeTrial | null {
  const r = rec(v);
  if (!r) return null;
  const g = rec(r.guess);
  return {
    index: n0(r.index),
    kind: oneOf(r.kind, KINDS, "freeze"),
    stage: oneOf(r.stage, STAGES, "open"),
    stageEnds: num(r.stageEnds),
    seeding: bool(r.seeding),
    guess: g ? { open: bool(g.open), max: n0(g.max), mine: num(g.mine) } : null,
    freeze: parseFreeze(r.freeze),
    ginger: parseGinger(r.ginger),
    chairs: parseChairs(r.chairs),
    rope: parseRope(r.rope),
    hop: parseHop(r.hop),
    result: parseResult(r.result),
  };
}

function parseChance(v: unknown): MeChance | null {
  const r = rec(v);
  if (!r) return null;
  return {
    stage: oneOf(r.stage, ["offer", "question", "back", "done"] as const, "offer"),
    stageAt: num(r.stageAt),
    stageEnds: num(r.stageEnds),
    eligible: bool(r.eligible),
    q: typeof r.q === "string" ? r.q : null,
    options: Array.isArray(r.options) ? r.options.map(str) : null,
    answered: num(r.answered),
    correct: num(r.correct),
    returned: bool(r.returned),
  };
}

function parseDobivka(v: unknown): MeDobivka | null {
  const r = rec(v);
  if (!r) return null;
  return {
    stage: oneOf(r.stage, ["intro", "rows", "results"] as const, "intro"),
    stageEnds: num(r.stageEnds),
    row: n0(r.row),
    jumper: bool(r.jumper),
    chooseEnds: num(r.chooseEnds),
    pick: side(r.pick),
    fell: bool(r.fell),
    solid: side(r.solid),
    out: bool(r.out),
  };
}

function parseFinal(v: unknown): MeFinal | null {
  const r = rec(v);
  if (!r) return null;
  const d = rec(r.duel);
  const w = rec(r.watch);
  const gs = Array.isArray(d?.gestures) ? d.gestures.map(gesture) : null;
  return {
    stage: oneOf(r.stage, ["bracket", "duel", "champion"] as const, "bracket"),
    finalist: bool(r.finalist),
    seed: num(r.seed),
    champion: bool(r.champion),
    bestFan: bool(r.bestFan),
    duel: d
      ? {
          me: d.me === 1 ? 1 : 0,
          opponent: who(d.opponent),
          wins: pair(d.wins),
          roundNo: n0(d.roundNo),
          stage: oneOf(d.stage, DUEL_STAGES, "bets"),
          stageEnds: num(d.stageEnds),
          pick: gesture(d.pick),
          auto: bool(d.auto),
          gestures: gs && gs[0] && gs[1] ? [gs[0], gs[1]] : null,
          winner: d.winner === true ? true : d.winner === false ? false : null,
        }
      : null,
    watch: w
      ? { a: who(w.a), b: who(w.b), wins: pair(w.wins), stage: oneOf(w.stage, DUEL_STAGES, "bets"), stageEnds: num(w.stageEnds), bet: bit(w.bet), betOpen: bool(w.betOpen), winner: bit(w.winner) }
      : null,
  };
}

/** Личный вид из потока → типы телефона; не похоже на личный вид — null (ждём снимка). */
export function parseMe(raw: unknown): Me | null {
  const r = rec(raw);
  if (!r || typeof r.num !== "number" || typeof r.phase !== "string") return null;
  const lobby = rec(r.lobby);
  const podium = rec(r.podium);
  return {
    num: n0(r.num),
    name: str(r.name),
    role: oneOf(r.role, ["lobby", "player", "fan"] as const, "lobby"),
    late: bool(r.late),
    hearts: n0(r.hearts),
    lives: num(r.lives) ?? (r.style === "night" ? 1 : 2),
    phase: oneOf(r.phase, PHASES, "lobby"),
    style: r.style === "night" ? "night" : "sunny",
    coins: n0(r.coins),
    fanScore: n0(r.fanScore),
    returned: bool(r.returned),
    removed: bool(r.removed),
    lobbyCount: lobby ? num(lobby.count) : null,
    trial: parseTrial(r.trial),
    chance: parseChance(r.chance),
    dobivka: parseDobivka(r.dobivka),
    final: parseFinal(r.final),
    podium: podium && num(podium.place) !== null ? { place: n0(podium.place), points: n0(podium.points) } : null,
  };
}

// ------------------------------------------------------------------ модель потока

export interface PhoneModel {
  me: Me | null;
  paused: boolean;
  /** Часы сервера в момент паузы (отсчёты на паузе стоят). */
  pausedAt: number | null;
  /**
   * Нижняя граница сдвига «сервер − местные часы» по потоку: событие приходит не раньше, чем отправлено, поэтому `at − приход`
   * не больше настоящего сдвига. Основные часы — `GET /api/time` (`PhoneClock`); эта граница ловит неудачный замер.
   */
  floor: number | null;
  closed: RoomClosedReason | null;
  /** Когда последний раз сервер отвечал (поток или пачка), местное время. */
  heardAt: number;
}

/** Сервер молчит дольше — «Нет связи» (пачка — раз в 1 с, «без связи» у комнаты — 3 с). */
export const SILENT_MS = 4000;
/** Замер часов (`GET /api/time`) меньше нижней границы потока больше чем на столько — замер неверный, берём границу. */
export const CLOCK_TRUST_MS = 80;

export function emptyModel(local: number): PhoneModel {
  return { me: null, paused: false, pausedAt: null, floor: null, closed: null, heardAt: local };
}

function withFloor(m: PhoneModel, at: number, local: number): PhoneModel {
  if (!Number.isFinite(at)) return m;
  const sample = at - local;
  // Граница — наибольший замер; часы устройства прыгнули (замер меньше на минуту) — сначала.
  const floor = m.floor === null || sample > m.floor || m.floor - sample > 60_000 ? sample : m.floor;
  return floor === m.floor ? m : { ...m, floor };
}

function setPaused(m: PhoneModel, paused: boolean, at: number): PhoneModel {
  if (paused === m.paused) return m;
  return { ...m, paused, pausedAt: paused ? at : null };
}

/** Событие личного потока → новая модель. */
export function applyStream(m0: PhoneModel, e: RoomStreamEvent, local: number): PhoneModel {
  let m: PhoneModel = { ...withFloor(m0, e.at, local), heardAt: local };
  switch (e.type) {
    case "snapshot": {
      m = setPaused(m, e.paused, e.at);
      return { ...m, me: parseMe(e.data), closed: null };
    }
    case "room":
      return setPaused(m, e.paused, e.at);
    case "closed":
      return { ...m, closed: e.reason };
    case "event": {
      const d = rec(e.data);
      if (d?.t !== "me") return m;
      const me = parseMe(d.me);
      return me ? { ...m, me, closed: null } : m;
    }
    default:
      return m;
  }
}

/** Ответ сервера на пачку: часы и пауза. */
export function applyReply(m: PhoneModel, reply: { at: number; paused: boolean }, local: number): PhoneModel {
  return setPaused({ ...withFloor(m, reply.at, local), heardAt: local }, reply.paused, reply.at);
}

export function closeFinished(m: PhoneModel): PhoneModel {
  return m.closed === "finished" ? m : { ...m, closed: "finished" };
}

/**
 * Сдвиг часов сервера: замер `GET /api/time` (лучший из трёх, раз в 2 минуты) — если он есть и не меньше нижней границы потока;
 * нет замера — граница потока; нет ничего — 0.
 */
export function offsetOf(m: PhoneModel, measured: number | null): number {
  if (measured === null) return m.floor ?? 0;
  if (m.floor !== null && measured < m.floor - CLOCK_TRUST_MS) return m.floor;
  return measured;
}

/** Сколько осталось до момента по часам сервера; на паузе отсчёт стоит. */
export function leftUntil(m: PhoneModel, at: number | null | undefined, sNow: number): number | null {
  if (at === null || at === undefined || !Number.isFinite(at)) return null;
  const now = m.paused && m.pausedAt !== null ? m.pausedAt : sNow;
  return Math.max(0, at - now);
}

/** Связи нет: браузер без сети или сервер молчит дольше `SILENT_MS`. */
export function silent(m: PhoneModel, local: number, online: boolean): boolean {
  return !online || local - m.heardAt > SILENT_MS;
}

/** Причина отказа комнаты из ошибки слоя данных (`ApiError.reason`), без импорта самого класса. */
export function reasonOf(error: unknown): string | null {
  const r = (error as { reason?: unknown } | null)?.reason;
  return typeof r === "string" ? r : null;
}

export type LinkProblem = "finished" | "abandoned" | "quiet" | "error";

export function problemOf(error: unknown): LinkProblem {
  const reason = reasonOf(error);
  if (reason === "finished") return "finished";
  if (reason === "abandoned") return "abandoned";
  if (reason === "removed" || reason === "replaced" || reason === "busy") return "quiet";
  return "error";
}

/** «0:07» или «7». */
export function secondsText(ms: number | null): string {
  if (ms === null) return "";
  const s = Math.ceil(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : String(s);
}

// ------------------------------------------------------------------ какой экран

export type Screen =
  | "connecting"
  | "tab"
  | "abandoned"
  | "removed"
  | "over"
  | "pause"
  | "lobby"
  | "intro"
  | "guess"
  | "countdown"
  | "freeze"
  | "ginger-pick"
  | "ginger-unbox"
  | "ginger-trace"
  | "ginger-end"
  | "chairs-music"
  | "chairs-stop"
  | "chairs-tap"
  | "chairs-wait"
  | "chairs-seated"
  | "chairs-missed"
  | "chairs-off"
  | "rope"
  | "rope-wait"
  | "hop-brave"
  | "hop-jump"
  | "hop-choose"
  | "hop-crack"
  | "hop-fell"
  | "watch"
  | "judging"
  | "result"
  | "chance-offer"
  | "chance-question"
  | "chance-wait"
  | "chance-back"
  | "dob-intro"
  | "dob-choose"
  | "dob-crack"
  | "dob-fell"
  | "dob-wait"
  | "dob-results"
  | "bracket"
  | "duel"
  | "bet"
  | "duel-watch"
  | "champion"
  | "podium";

/** Экран испытания во время игры (`play`). `sNow` — часы сервера: стулья и сроки телефон ведёт сам по сверенным часам. */
function playScreen(t: MeTrial, sNow: number): Screen {
  if (t.freeze) return "freeze";
  if (t.ginger) {
    const g = t.ginger;
    if (g.cracked || g.done || g.sub === "over" || (g.traceEnds !== null && sNow >= g.traceEnds)) return "ginger-end";
    if (g.sub === "trace" || (g.unboxEnds !== null && sNow >= g.unboxEnds && g.shape)) return "ginger-trace";
    if (g.sub === "unbox" || (g.pickEnds !== null && sNow >= g.pickEnds)) return "ginger-unbox";
    return "ginger-pick";
  }
  if (t.chairs) {
    const c = t.chairs;
    if (!c.inRound) return "chairs-off";
    if (c.seated === true) return "chairs-seated";
    if (c.seated === false) return "chairs-missed";
    if (c.tapped) return "chairs-wait";
    if (c.appearAt !== null && sNow >= c.appearAt) return c.closeAt !== null && sNow >= c.closeAt ? "chairs-wait" : "chairs-tap";
    if (c.stopAt !== null && sNow >= c.stopAt) return "chairs-stop";
    return "chairs-music";
  }
  if (t.rope) return t.rope.sub === "pull" ? "rope" : "rope-wait";
  if (t.hop) {
    const h = t.hop;
    if (h.fell && h.sub !== "crack") return "hop-fell";
    if (h.sub === "crack" || h.sub === "over") return "hop-crack";
    if (h.sub === "choose") return "hop-choose";
    if (h.sub === "jump") return "hop-jump";
    return "hop-brave";
  }
  return "watch";
}

function trialScreen(t: MeTrial, sNow: number): Screen {
  switch (t.stage) {
    case "open":
    case "rules":
      return t.guess?.open ? "guess" : "intro";
    case "countdown":
      return "countdown";
    case "play":
      return playScreen(t, sNow);
    case "judging":
      return "judging";
    default:
      return t.result ? "result" : "judging";
  }
}

/** Какой экран показать: закрытие потока сильнее всего, потом пауза, потом этап игры. */
export function screenOf(m: PhoneModel, sNow: number): Screen {
  if (m.closed === "busy" || m.closed === "replaced") return "tab";
  if (m.closed === "abandoned") return "abandoned";
  if (m.closed === "removed") return "removed";
  const me = m.me;
  if (m.closed === "finished") return me?.podium ? "podium" : "over";
  if (!me) return "connecting";
  if (me.phase === "podium" || me.phase === "finished") return me.podium ? "podium" : "over";
  if (m.paused) return "pause";
  if (me.phase === "lobby") return "lobby";
  if (me.phase === "trial" && me.trial) return trialScreen(me.trial, sNow);
  if (me.phase === "chance" && me.chance) {
    const c = me.chance;
    if (!c.eligible) return "chance-wait";
    if (c.stage === "offer") return "chance-offer";
    if (c.stage === "question") return "chance-question";
    return "chance-back";
  }
  if (me.phase === "dobivka" && me.dobivka) {
    const d = me.dobivka;
    if (d.stage === "intro") return "dob-intro";
    if (d.stage === "results") return "dob-results";
    if (d.fell) return d.solid !== null ? "dob-crack" : "dob-fell";
    if (!d.jumper) return "dob-wait";
    if (d.solid !== null) return "dob-crack";
    return "dob-choose";
  }
  if (me.phase === "final" && me.final) {
    const f = me.final;
    if (f.stage === "champion") return "champion";
    if (f.duel) return "duel";
    if (f.watch) return f.watch.betOpen ? "bet" : "duel-watch";
    return "bracket";
  }
  return "connecting";
}

// ------------------------------------------------------------------ мелочи для экранов

/** Взгляд Матрёшки идёт по сверенным часам телефона: [at, end). */
export function gazeNow(f: MeFreeze | null, sNow: number): boolean {
  return f?.gaze !== null && f?.gaze !== undefined && sNow >= f.gaze.at && sNow < f.gaze.end;
}

/**
 * Реакция — от **назначенного** момента (появление стульев, кнопки, показ вопроса) по сверенным часам, а не от отрисовки
 * (требование 3a к телефону). Меньше 0 не бывает.
 */
export function reactionMs(shownAt: number, sNow: number): number {
  return Math.max(0, Math.round(sNow - shownAt));
}

/** Смайлик в начале имени («🦊 Аня») — для кружка; без смайлика — первая буква. */
export function avatarOf(name: string): { mark: string; rest: string } {
  const m = name.match(/^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)\s*(.*)$/u);
  if (m) return { mark: m[1] ?? "", rest: m[2] || name };
  const first = [...name.trim()][0] ?? "?";
  return { mark: first.toUpperCase(), rest: name };
}

/** «№ 027». */
export function numText(n: number): string {
  return `№ ${String(Math.max(0, Math.floor(n))).padStart(3, "0")}`;
}
