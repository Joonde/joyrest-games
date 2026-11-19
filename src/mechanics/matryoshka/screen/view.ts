/**
 * Сводка экрана зала «Игр Матрёшки» (`screenView` правил, поток `screen` комнаты) → типы экрана без исключений: непонятное поле —
 * значение по умолчанию. Части сводки по испытаниям в правилах — `Record<string, unknown>` (их формат знает только экран), здесь
 * они разбираются один раз на событие.
 */
import type { Phase, ScreenPlayer, ShapeId, Side, Style, TrialKind } from "../rules/types";

export type Num = number | null;

export interface PhraseV {
  start: number;
  at: number;
  end: number;
  decoy: Num;
  window: number;
  head: number;
}
export interface FreezeV {
  kind: "freeze";
  runEnds: Num;
  speed: number;
  phrase: PhraseV | null;
  caught: { gaze: number; count: number; nums: number[] } | null;
  players: ScreenPlayer[];
}
export interface GingerV {
  kind: "ginger";
  sub: "pick" | "unbox" | "trace" | "over";
  pickEnds: Num;
  unboxEnds: Num;
  traceEnds: Num;
  picked: number;
  counts: number[] | null;
  boxes: ShapeId[];
  whole: number;
  cracked: number;
  players: ScreenPlayer[];
}
export interface ChairsV {
  kind: "chairs";
  round: number;
  sub: "music" | "stop" | "seat";
  chairs: number;
  inRound: number;
  musicAt: Num;
  stopAt: Num;
  decoyAt: Num;
  appearAt: Num;
  closeAt: Num;
  seatEnds: Num;
  seated: number[] | null;
  players: ScreenPlayer[];
}
export interface RopeV {
  kind: "rope";
  sub: "split" | "pull" | "rest" | "over";
  splitEnds: Num;
  attempt: number;
  attemptAt: Num;
  attemptEnds: Num;
  restEnds: Num;
  knot: number;
  wins: [number, number];
  players: [number, number];
  fans: [number, number];
  power: [number, number];
  sides: ScreenPlayer[];
}
export interface HopV {
  kind: "hopscotch";
  row: number;
  sub: "brave" | "jump" | "choose" | "crack" | "over";
  braveAt: Num;
  braveEnds: Num;
  jumpEnds: Num;
  chooseEnds: Num;
  crackEnds: Num;
  braves: Array<{ num: number; side: Side | null; picked: boolean }>;
  jumpers: number;
  picked: number;
  solid: Side | null;
  shares: { L: number; R: number } | null;
  fell: number[] | null;
  fallen: number;
  rows: Array<{ solid: Side; fell: number } | null>;
}
export type PlayV = FreezeV | GingerV | ChairsV | RopeV | HopV;

export interface OutcomeV {
  out: number[];
  lost: number;
  top: number[];
  fails: Num;
  guessBest: number[];
  guessNear: number;
  chance: boolean;
}
export type TrialStageV = "open" | "rules" | "countdown" | "play" | "judging" | "reveal" | "results";
export interface TrialV {
  index: number;
  count: number;
  kind: TrialKind;
  stage: TrialStageV;
  stageAt: Num;
  stageEnds: Num;
  A: number;
  T: number;
  seeding: boolean;
  auto: boolean;
  guessers: number;
  play: PlayV | null;
  outcome: OutcomeV | null;
}
export interface ChanceV {
  stage: "offer" | "question" | "back" | "done";
  stageEnds: Num;
  eligible: number;
  count: number;
  answered: number;
  q: string | null;
  options: string[] | null;
  correct: Num;
  returned: number[];
}
export interface DobV {
  stage: "intro" | "rows" | "results";
  stageEnds: Num;
  need: number;
  row: number;
  chooseEnds: Num;
  crackEnds: Num;
  picked: number;
  solid: Side | null;
  shares: { L: number; R: number } | null;
  fell: number[] | null;
  fallen: number;
  out: number[];
}
export type Gesture = "r" | "p" | "s";
export interface DuelV {
  a: number;
  b: number;
  wins: [number, number];
  roundNo: number;
  stage: "bets" | "pick" | "show" | "over";
  stageEnds: Num;
  picked: [boolean, boolean];
  gestures: [Gesture, Gesture] | null;
  auto: [boolean, boolean] | null;
  last: { winner: number; bySpeed: boolean } | null;
  bets: number;
  winner: Num;
  forfeit: boolean;
}
export interface FinalV {
  stage: "bracket" | "duel" | "champion";
  size: number;
  seeds: number[];
  rounds: Array<Array<[number, number]>>;
  winners: Array<Array<number | null>>;
  at: { round: number; match: number } | null;
  duel: DuelV | null;
  champion: Num;
  bestFan: { num: number; score: number } | null;
}
export interface ScreenV {
  phase: Phase;
  style: Style;
  board: boolean;
  inGame: number;
  out: number;
  fans: number;
  piggy: number;
  justOut: number[];
  names: Record<number, string>;
  lobby: { count: number; marks: string[]; nums: number[] | null; lives: number | null } | null;
  trial: TrialV | null;
  chance: ChanceV | null;
  dobivka: DobV | null;
  final: FinalV | null;
  podium: { top: Array<{ num: number; place: number; points: number }> } | null;
  scoreboard: { total: number; page: number; pages: number; rows: Array<[number, number]> } | null;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const rec = (v: unknown): Rec => (isRec(v) ? v : {});
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const numN = (v: unknown): Num => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean => v === true;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === "number" && Number.isFinite(x)) : []);
const numsN = (v: unknown): number[] | null => (Array.isArray(v) ? nums(v) : null);
function pick<T extends string>(v: unknown, all: readonly T[], d: T): T {
  return typeof v === "string" && (all as readonly string[]).includes(v) ? (v as T) : d;
}
const pair = (v: unknown): [number, number] => {
  const a = nums(v);
  return [a[0] ?? 0, a[1] ?? 0];
};
const side = (v: unknown): Side | null => (v === "L" || v === "R" ? v : null);
const shares = (v: unknown): { L: number; R: number } | null => (isRec(v) ? { L: num(v.L), R: num(v.R) } : null);
function players(v: unknown): ScreenPlayer[] {
  if (!Array.isArray(v)) return [];
  const out: ScreenPlayer[] = [];
  for (const x of v) if (Array.isArray(x)) out.push([num(x[0]), num(x[1]), num(x[2])]);
  return out;
}

const PHASES: readonly Phase[] = ["lobby", "trial", "chance", "dobivka", "final", "podium", "finished"];
const KINDS: readonly TrialKind[] = ["freeze", "ginger", "chairs", "rope", "hopscotch"];
const SHAPES: readonly ShapeId[] = ["circle", "star", "tree", "matryoshka", "umbrella", "heart", "house"];

function play(v: unknown, kind: TrialKind): PlayV | null {
  if (!isRec(v)) return null;
  switch (kind) {
    case "freeze": {
      const ph = isRec(v.phrase) ? v.phrase : null;
      const c = isRec(v.caught) ? v.caught : null;
      const at = ph ? numN(ph.at) : null;
      return {
        kind,
        runEnds: numN(v.runEnds),
        speed: num(v.speed),
        phrase: ph && at !== null ? { start: num(ph.start, at), at, end: num(ph.end, at), decoy: numN(ph.decoy), window: num(ph.window, at), head: num(ph.head, at) } : null,
        caught: c ? { gaze: num(c.gaze, -1), count: num(c.count), nums: nums(c.nums) } : null,
        players: players(v.players),
      };
    }
    case "ginger":
      return {
        kind,
        sub: pick(v.sub, ["pick", "unbox", "trace", "over"] as const, "pick"),
        pickEnds: numN(v.pickEnds),
        unboxEnds: numN(v.unboxEnds),
        traceEnds: numN(v.traceEnds),
        picked: num(v.picked),
        counts: numsN(v.counts),
        boxes: Array.isArray(v.boxes) ? v.boxes.map((b) => pick(b, SHAPES, "circle")) : [],
        whole: num(v.whole),
        cracked: num(v.cracked),
        players: players(v.players),
      };
    case "chairs":
      return {
        kind,
        round: num(v.round),
        sub: pick(v.sub, ["music", "stop", "seat"] as const, "music"),
        chairs: num(v.chairs),
        inRound: num(v.inRound),
        musicAt: numN(v.musicAt),
        stopAt: numN(v.stopAt),
        decoyAt: numN(v.decoyAt),
        appearAt: numN(v.appearAt),
        closeAt: numN(v.closeAt),
        seatEnds: numN(v.seatEnds),
        seated: numsN(v.seated),
        players: players(v.players),
      };
    case "rope":
      return {
        kind,
        sub: pick(v.sub, ["split", "pull", "rest", "over"] as const, "split"),
        splitEnds: numN(v.splitEnds),
        attempt: num(v.attempt, -1),
        attemptAt: numN(v.attemptAt),
        attemptEnds: numN(v.attemptEnds),
        restEnds: numN(v.restEnds),
        knot: num(v.knot),
        wins: pair(v.wins),
        players: pair(v.players),
        fans: pair(v.fans),
        power: pair(v.power),
        sides: players(v.sides),
      };
    case "hopscotch":
      return {
        kind,
        row: num(v.row),
        sub: pick(v.sub, ["brave", "jump", "choose", "crack", "over"] as const, "brave"),
        braveAt: numN(v.braveAt),
        braveEnds: numN(v.braveEnds),
        jumpEnds: numN(v.jumpEnds),
        chooseEnds: numN(v.chooseEnds),
        crackEnds: numN(v.crackEnds),
        braves: Array.isArray(v.braves) ? v.braves.map((b) => ({ num: num(rec(b).num), side: side(rec(b).side), picked: bool(rec(b).picked) })) : [],
        jumpers: num(v.jumpers),
        picked: num(v.picked),
        solid: side(v.solid),
        shares: shares(v.shares),
        fell: numsN(v.fell),
        fallen: num(v.fallen),
        rows: Array.isArray(v.rows) ? v.rows.map((r) => (isRec(r) && side(r.solid) ? { solid: side(r.solid) as Side, fell: num(r.fell) } : null)) : [],
      };
  }
}

function trial(v: unknown): TrialV | null {
  if (!isRec(v)) return null;
  const kind = pick(v.kind, KINDS, "freeze");
  const o = isRec(v.outcome) ? v.outcome : null;
  return {
    index: num(v.index),
    count: num(v.count, 1),
    kind,
    stage: pick(v.stage, ["open", "rules", "countdown", "play", "judging", "reveal", "results"] as const, "open"),
    stageAt: numN(v.stageAt),
    stageEnds: numN(v.stageEnds),
    A: num(v.A),
    T: num(v.T),
    seeding: bool(v.seeding),
    auto: bool(v.auto),
    guessers: num(v.guessers),
    play: play(v.play, kind),
    outcome: o ? { out: nums(o.out), lost: num(o.lost), top: nums(o.top), fails: numN(o.fails), guessBest: nums(o.guessBest), guessNear: num(o.guessNear), chance: bool(o.chance) } : null,
  };
}

function duel(v: unknown): DuelV | null {
  if (!isRec(v)) return null;
  const g = Array.isArray(v.gestures) ? v.gestures.map((x) => pick(x, ["r", "p", "s"] as const, "r")) : null;
  const au = Array.isArray(v.auto) ? v.auto.map(bool) : null;
  const pk = Array.isArray(v.picked) ? v.picked.map(bool) : [];
  const last = isRec(v.last) ? v.last : null;
  return {
    a: num(v.a),
    b: num(v.b),
    wins: pair(v.wins),
    roundNo: num(v.roundNo),
    stage: pick(v.stage, ["bets", "pick", "show", "over"] as const, "bets"),
    stageEnds: numN(v.stageEnds),
    picked: [pk[0] ?? false, pk[1] ?? false],
    gestures: g && g.length >= 2 ? [g[0] as Gesture, g[1] as Gesture] : null,
    auto: au && au.length >= 2 ? [au[0] ?? false, au[1] ?? false] : null,
    last: last ? { winner: num(last.winner), bySpeed: bool(last.bySpeed) } : null,
    bets: num(v.bets),
    winner: numN(v.winner),
    forfeit: bool(v.forfeit),
  };
}

/** Сводка из потока → вид экрана; не сводка — null. */
export function parseScreen(data: unknown): ScreenV | null {
  if (!isRec(data) || typeof data.phase !== "string") return null;
  const names: Record<number, string> = {};
  for (const [k, n] of Object.entries(rec(data.names))) if (typeof n === "string" && Number.isFinite(Number(k))) names[Number(k)] = n;
  const lobby = isRec(data.lobby) ? data.lobby : null;
  const ch = isRec(data.chance) ? data.chance : null;
  const dob = isRec(data.dobivka) ? data.dobivka : null;
  const fin = isRec(data.final) ? data.final : null;
  const pod = isRec(data.podium) ? data.podium : null;
  const sb = isRec(data.scoreboard) ? data.scoreboard : null;
  return {
    phase: pick(data.phase, PHASES, "lobby"),
    style: data.style === "night" ? "night" : "sunny",
    board: bool(data.board),
    inGame: num(data.inGame),
    out: num(data.out),
    fans: num(data.fans),
    piggy: num(data.piggy),
    justOut: nums(data.justOut),
    names,
    lobby: lobby
      ? {
          count: num(lobby.count),
          marks: Array.isArray(lobby.marks) ? lobby.marks.map((m) => (typeof m === "string" ? m : "•")) : [],
          nums: numsN(lobby.nums),
          lives: numN(lobby.lives),
        }
      : null,
    trial: trial(data.trial),
    chance: ch
      ? {
          stage: pick(ch.stage, ["offer", "question", "back", "done"] as const, "offer"),
          stageEnds: numN(ch.stageEnds),
          eligible: num(ch.eligible),
          count: num(ch.count),
          answered: num(ch.answered),
          q: str(ch.q),
          options: Array.isArray(ch.options) ? ch.options.filter((x): x is string => typeof x === "string") : null,
          correct: numN(ch.correct),
          returned: nums(ch.returned),
        }
      : null,
    dobivka: dob
      ? {
          stage: pick(dob.stage, ["intro", "rows", "results"] as const, "intro"),
          stageEnds: numN(dob.stageEnds),
          need: num(dob.need),
          row: num(dob.row),
          chooseEnds: numN(dob.chooseEnds),
          crackEnds: numN(dob.crackEnds),
          picked: num(dob.picked),
          solid: side(dob.solid),
          shares: shares(dob.shares),
          fell: numsN(dob.fell),
          fallen: num(dob.fallen),
          out: nums(dob.out),
        }
      : null,
    final: fin
      ? {
          stage: pick(fin.stage, ["bracket", "duel", "champion"] as const, "bracket"),
          size: num(fin.size),
          seeds: nums(fin.seeds),
          rounds: Array.isArray(fin.rounds) ? fin.rounds.map((r) => (Array.isArray(r) ? r.map((m): [number, number] => pair(m)) : [])) : [],
          winners: Array.isArray(fin.winners) ? fin.winners.map((r) => (Array.isArray(r) ? r.map((w) => numN(w)) : [])) : [],
          at: isRec(fin.at) ? { round: num(fin.at.round), match: num(fin.at.match) } : null,
          duel: duel(fin.duel),
          champion: numN(fin.champion),
          bestFan: isRec(fin.bestFan) ? { num: num(fin.bestFan.num), score: num(fin.bestFan.score) } : null,
        }
      : null,
    podium: pod && Array.isArray(pod.top) ? { top: pod.top.map((x) => ({ num: num(rec(x).num), place: num(rec(x).place), points: num(rec(x).points) })) } : null,
    scoreboard: sb
      ? {
          total: num(sb.total),
          page: num(sb.page),
          pages: num(sb.pages, 1),
          rows: Array.isArray(sb.rows) ? sb.rows.map((r) => pair(r)) : [],
        }
      : null,
  };
}
