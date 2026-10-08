// Ход «Боя с драконом» — чистые функции.
//
// Выбор героев (`question`, капитаны шлют `{ hero, stats }`; не успели — герой по порядку, свойства по 1) →
// бой: заставка задания (`ready`) → задание (`question`: вопрос `{ choice }`, кубик `{ roll: true }`, задание —
// отмечает ведущий) → «Удар!» (`reveal`): урон = база × (1 + свойство) × силы героя; не справились — дракон
// отнимает жизнь; жизни кончились — команда теряет очки боя и ждёт следующего. Дракон повержен — бонус за
// последний удар и выжившим; дожил до конца боя — все теряют очки боя. Дальше — следующий бой (новый дракон,
// погибшие оживают) или награждение.
import { leaderboardAdditions, scoringParticipants } from "../../core/leaderboard";
import { hasPodium, podiumBack, podiumDone } from "../../core/podium";
import { MAX_SCORE_DELTA } from "../../core/session";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import { dieOf } from "../quest/logic";
import type { ScoreDelta, Step } from "../types";
import { HEROES, heroOf, parseStats, type DragonBattle, type DragonContent, type DragonTask, type HeroId, type Stats } from "./content";

export type DragonPhase = "heroes" | "intro" | "task" | "reveal" | "victory" | "defeat" | "over";

export interface TeamHero {
  hero: HeroId;
  stats: Stats;
}

export interface Hit {
  damage: number;
  ok: boolean;
  /** Сколько жизней отнял дракон (0 — увернулись или справились). */
  lost: number;
  healed: boolean;
  roll: number | null;
  /** Почему удар дракона не прошёл: щит рыцаря, тень эльфа. */
  saved: "shield" | "dodge" | null;
}

interface Snapshot {
  hp: number;
  lives: Record<string, number>;
  dead: string[];
  dmg: Record<string, number>;
  wins: Record<string, number>;
  hits: Record<string, number>;
  shield: string[];
}

export interface DragonResult extends Snapshot {
  phase: DragonPhase;
  order: string[];
  heroes: Record<string, TeamHero>;
  battle: number;
  task: number;
  /** Отметки ведущего (задание выполнено). */
  marks: string[];
  last: Record<string, Hit>;
  killer: string | null;
  /** Начисленное на показе удара или итога боя (для «Назад»). */
  deltas: Record<string, number>;
  prev: Snapshot | null;
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && ID.test(x)))].slice(0, 200) : []);
const nat = (v: unknown, def = 0) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : def);
function nums(v: unknown, signed = false): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(rec(v))) if (ID.test(k) && typeof n === "number" && Number.isFinite(n) && (signed || n >= 0)) out[k] = Math.round(n);
  return out;
}
const PHASES: DragonPhase[] = ["heroes", "intro", "task", "reveal", "victory", "defeat", "over"];

function parseSnapshot(d: Record<string, unknown>): Snapshot {
  return { hp: nat(d.hp), lives: nums(d.lives), dead: ids(d.dead), dmg: nums(d.dmg), wins: nums(d.wins), hits: nums(d.hits), shield: ids(d.shield) };
}

export function parseDragonResult(raw: unknown): DragonResult {
  const d = rec(raw);
  const heroes: Record<string, TeamHero> = {};
  for (const [k, v] of Object.entries(rec(d.heroes))) {
    const h = rec(v);
    if (ID.test(k) && heroOf(h.hero)) heroes[k] = { hero: h.hero as HeroId, stats: parseStats(h.stats) };
  }
  const last: Record<string, Hit> = {};
  for (const [k, v] of Object.entries(rec(d.last))) {
    const h = rec(v);
    if (!ID.test(k)) continue;
    last[k] = {
      damage: nat(h.damage),
      ok: h.ok === true,
      lost: nat(h.lost),
      healed: h.healed === true,
      roll: typeof h.roll === "number" && h.roll >= 1 && h.roll <= 6 ? h.roll : null,
      saved: h.saved === "shield" || h.saved === "dodge" ? h.saved : null,
    };
  }
  const prev = rec(d.prev);
  return {
    ...parseSnapshot(d),
    phase: PHASES.includes(d.phase as DragonPhase) ? (d.phase as DragonPhase) : "heroes",
    order: ids(d.order),
    heroes,
    battle: nat(d.battle),
    task: nat(d.task),
    marks: ids(d.marks),
    last,
    killer: typeof d.killer === "string" && ID.test(d.killer) ? d.killer : null,
    deltas: nums(d.deltas, true),
    prev: Object.keys(prev).length > 0 ? parseSnapshot(prev) : null,
  };
}

const write = (r: DragonResult): Record<string, unknown> => ({ ...r });

export function dragonSteps(content: DragonContent): Step[] {
  return content.battles.flatMap((b) => b.tasks.map((t) => ({ id: t.id, answerable: true })));
}

export function score(): ScoreDelta[] {
  return [];
}

export function battleOf(content: DragonContent, r: DragonResult): DragonBattle | null {
  return content.battles[r.battle] ?? null;
}

export function taskOf(content: DragonContent, r: DragonResult): DragonTask | null {
  return battleOf(content, r)?.tasks[r.task] ?? null;
}

/** Сколько жизней у команды в начале боя (гном — +2). */
export function maxLives(content: DragonContent, hero: TeamHero | undefined): number {
  return content.lives + (hero?.hero === "dwarf" ? 2 : 0);
}

function orderOf(session: Session, participants: Participant[], r: DragonResult): string[] {
  const joined = [...scoringParticipants(participants, session.playMode)].sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0) || a.id.localeCompare(b.id)).map((p) => p.id);
  const known = new Set([...joined, ...Object.keys(session.leaderboard)]);
  return [...new Set([...r.order.filter((p) => known.has(p)), ...joined, ...Object.keys(session.leaderboard)])];
}

function applyDeltas(session: Session, participants: Participant[], deltas: Record<string, number>): Pick<SessionChange, "addScore" | "leaderboard"> {
  const additions = leaderboardAdditions(session.leaderboard, participants, session.playMode);
  const nonzero = Object.fromEntries(Object.entries(deltas).filter(([, n]) => n !== 0));
  if (Object.values(nonzero).every((n) => Math.abs(n) <= MAX_SCORE_DELTA)) {
    return Object.keys(nonzero).length > 0 ? { addScore: nonzero, leaderboard: additions } : { leaderboard: additions };
  }
  const board = { ...additions };
  for (const [p, n] of Object.entries(nonzero)) {
    const entry = board[p] ?? session.leaderboard[p];
    if (entry) board[p] = { ...entry, score: entry.score + n, last: n };
  }
  return { leaderboard: board };
}

const negate = (d: Record<string, number>) => Object.fromEntries(Object.entries(d).map(([k, n]) => [k, -n]));

function snapshot(r: DragonResult): Snapshot {
  return { hp: r.hp, lives: r.lives, dead: r.dead, dmg: r.dmg, wins: r.wins, hits: r.hits, shield: r.shield };
}

/** Начало боя: здоровье дракона, полные жизни, погибшие оживают. */
function battleStart(content: DragonContent, r: DragonResult, battle: number): DragonResult {
  const hp = content.battles[battle]?.hp ?? 1;
  const lives = Object.fromEntries(r.order.map((p) => [p, maxLives(content, r.heroes[p])]));
  return { ...r, phase: "intro", battle, task: 0, hp, lives, dead: [], dmg: {}, wins: {}, hits: {}, shield: [], marks: [], last: {}, killer: null, deltas: {}, prev: null };
}

export type DragonAction = "start" | "heroesDone" | "show" | "reveal" | "next" | "nextBattle" | "podium" | "podiumNext" | "finish";

export function dragonPrimary(session: Session, content: DragonContent): DragonAction {
  const { stage } = session.state;
  const r = parseDragonResult(session.state.result);
  if (stage === "podium") return podiumDone(session) ? "finish" : "podiumNext";
  if (r.order.length === 0) return "start";
  if (r.phase === "heroes") return "heroesDone";
  if (r.phase === "over") return hasPodium(session.leaderboard) ? "podium" : "finish";
  if (r.phase === "intro") return "show";
  if (r.phase === "task") return "reveal";
  if (r.phase === "victory" || r.phase === "defeat") return r.battle + 1 < content.battles.length ? "nextBattle" : "nextBattle";
  return "next";
}

/** «Начать игру»: капитаны выбирают героя и раскладывают свойства на телефонах. */
export function startDragon(session: Session, participants: Participant[]): SessionChange {
  const r = parseDragonResult(session.state.result);
  const order = orderOf(session, participants, r);
  return {
    state: { step: session.state.step + 1, stage: "question", startedAt: "server", timeLimit: null, revealed: false, answered: 0, result: write({ ...r, phase: "heroes", order, heroes: {} }) },
    leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode),
  };
}

/** Герой из ответа капитана; нет ответа — по порядку команды, свойства поровну. */
export function heroFromAnswer(value: unknown, index: number): TeamHero {
  const v = rec(value);
  const hero = heroOf(v.hero)?.id ?? (HEROES[index % HEROES.length] as (typeof HEROES)[number]).id;
  return { hero, stats: parseStats(v.stats) };
}

/** «Герои выбраны — в бой!» */
export function closeHeroes(session: Session, content: DragonContent, answers: Answer[], participants: Participant[]): SessionChange {
  const r = parseDragonResult(session.state.result);
  const order = orderOf(session, participants, r);
  const since = session.state.startedAt ?? 0;
  const byPid = new Map(answers.filter((a) => a.step === session.state.step && (a.submittedAt ?? 0) >= since).map((a) => [a.pid, a.value]));
  const heroes: Record<string, TeamHero> = {};
  order.forEach((p, i) => {
    heroes[p] = r.heroes[p] ?? heroFromAnswer(byPid.get(p), i);
  });
  const next = battleStart(content, { ...r, order, heroes }, 0);
  return { state: { step: session.state.step + 1, stage: "ready", startedAt: null, timeLimit: null, revealed: false, answered: 0, result: write(next) } };
}

/** Показать задание. */
export function showTask(session: Session, content: DragonContent, participants: Participant[]): SessionChange | null {
  const r = parseDragonResult(session.state.result);
  const task = taskOf(content, r);
  if (!task) return null;
  // Новые команды (опоздали) — в бой с полными жизнями и героем по порядку.
  const order = orderOf(session, participants, r);
  const heroes = { ...r.heroes };
  const lives = { ...r.lives };
  order.forEach((p, i) => {
    if (!heroes[p]) heroes[p] = heroFromAnswer(null, i);
    if (lives[p] === undefined) lives[p] = maxLives(content, heroes[p]);
  });
  return {
    state: { step: session.state.step + 1, stage: "question", startedAt: "server", timeLimit: task.kind === "choice" && task.seconds > 0 ? task.seconds : null, revealed: false, answered: 0, result: write({ ...r, order, heroes, lives, phase: "task", marks: [], last: {}, deltas: {} }) },
    leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode),
  };
}

export function toggleMark(session: Session, team: string): SessionChange {
  const r = parseDragonResult(session.state.result);
  const marks = r.marks.includes(team) ? r.marks.filter((p) => p !== team) : [...r.marks, team];
  return { state: { result: write({ ...r, marks }) } };
}

/** Урон команды за задание (0 — не справились). */
export function damageOf(task: DragonTask, hero: TeamHero, ok: boolean, roll: number | null, firstFast: boolean): number {
  if (!ok) return 0;
  const stat = hero.stats[task.stat] ?? 0;
  let mult = 1 + stat;
  if (task.kind === "dice") mult *= (roll ?? 1) / 3.5;
  if (hero.hero === "sorceress" && task.stat === "mind") mult *= 1.5;
  if (hero.hero === "barbarian" && task.stat === "str") mult *= 2;
  if (hero.hero === "bard" && task.stat === "cha") mult *= 2;
  if (hero.hero === "elfess" && task.stat === "agi" && firstFast) mult *= 2;
  return Math.max(0, Math.round(task.power * mult) + (hero.hero === "archer" ? 20 : 0));
}

/** «Удар!»: урон дракону, удары по командам, гибель, победа. */
export function revealTask(session: Session, content: DragonContent, answers: Answer[], participants: Participant[], hostRolls: Record<string, number> = {}): SessionChange | null {
  const r = parseDragonResult(session.state.result);
  const task = taskOf(content, r);
  if (!task) return null;
  const since = session.state.startedAt ?? 0;
  const mine = answers.filter((a) => a.step === session.state.step && (a.submittedAt ?? 0) >= since && r.order.includes(a.pid)).sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0));
  const alive = r.order.filter((p) => !r.dead.includes(p));
  const firstRight = task.kind === "choice" ? mine.find((a) => rec(a.value).choice === task.correct)?.pid : undefined;
  const lives = { ...r.lives };
  const dmg = { ...r.dmg };
  const wins = { ...r.wins };
  const hits = { ...r.hits };
  const shield = [...r.shield];
  const dead = [...r.dead];
  const last: Record<string, Hit> = {};
  const deltas: Record<string, number> = {};
  let total = 0;
  for (const p of alive) {
    const hero = r.heroes[p] ?? heroFromAnswer(null, r.order.indexOf(p));
    const answer = mine.find((a) => a.pid === p);
    let ok = false;
    let roll: number | null = null;
    if (task.kind === "choice") ok = rec(answer?.value).choice === task.correct;
    else if (task.kind === "task") ok = r.marks.includes(p);
    else {
      const raw = answer && rec(answer.value).roll === true ? dieOf(answer) : (hostRolls[p] ?? null);
      roll = raw === null ? null : Math.min(6, raw + (hero.hero === "thief" ? 1 : 0));
      ok = roll !== null;
    }
    const damage = damageOf(task, hero, ok, roll, firstRight === p);
    const hit: Hit = { damage, ok, lost: 0, healed: false, roll, saved: null };
    if (ok) {
      total += damage;
      dmg[p] = (dmg[p] ?? 0) + damage;
      deltas[p] = damage;
      wins[p] = (wins[p] ?? 0) + 1;
      // Жрица: каждое третье выполненное задание возвращает жизнь.
      if (hero.hero === "priestess" && (wins[p] ?? 0) % 3 === 0 && (lives[p] ?? 0) < maxLives(content, hero)) {
        lives[p] = (lives[p] ?? 0) + 1;
        hit.healed = true;
      }
    } else {
      hits[p] = (hits[p] ?? 0) + 1;
      if (hero.hero === "knight" && !shield.includes(p)) {
        shield.push(p);
        hit.saved = "shield";
      } else if (hero.hero === "elf" && (hits[p] ?? 0) % 2 === 0) {
        hit.saved = "dodge";
      } else {
        lives[p] = Math.max(0, (lives[p] ?? 0) - 1);
        hit.lost = 1;
        if (lives[p] === 0) {
          dead.push(p);
          // Погиб — очки этого боя сгорают.
          deltas[p] = (deltas[p] ?? 0) - (dmg[p] ?? 0);
          dmg[p] = 0;
        }
      }
    }
    last[p] = hit;
  }
  const hp = Math.max(0, r.hp - total);
  let phase: DragonPhase = "reveal";
  let killer: string | null = null;
  if (hp === 0) {
    phase = "victory";
    killer = alive.filter((p) => (last[p]?.damage ?? 0) > 0).sort((a, b) => (last[b]?.damage ?? 0) - (last[a]?.damage ?? 0))[0] ?? null;
    if (killer) deltas[killer] = (deltas[killer] ?? 0) + content.killBonus;
    for (const p of alive) if (!dead.includes(p)) deltas[p] = (deltas[p] ?? 0) + content.winBonus;
  }
  return {
    state: { stage: "reveal", revealed: true, result: write({ ...r, phase, hp, lives, dead, dmg, wins, hits, shield, last, killer, deltas, prev: snapshot(r) }) },
    ...applyDeltas(session, participants, deltas),
  };
}

/** После удара: следующее задание; задания кончились или все погибли — дракон побеждает (очки боя сгорают). */
export function nextTask(session: Session, content: DragonContent, participants: Participant[]): SessionChange {
  const r = parseDragonResult(session.state.result);
  const battle = battleOf(content, r);
  const allDead = r.order.every((p) => r.dead.includes(p));
  if (!battle || r.task + 1 >= battle.tasks.length || allDead) {
    const deltas = Object.fromEntries(r.order.filter((p) => !r.dead.includes(p) && (r.dmg[p] ?? 0) > 0).map((p) => [p, -(r.dmg[p] ?? 0)]));
    return {
      state: { result: write({ ...r, phase: "defeat", deltas, prev: snapshot(r), dmg: Object.fromEntries(Object.keys(r.dmg).map((p) => [p, 0])) }) },
      ...applyDeltas(session, participants, deltas),
    };
  }
  return { state: { step: session.state.step + 1, stage: "ready", startedAt: null, timeLimit: null, revealed: false, answered: 0, result: write({ ...r, phase: "intro", task: r.task + 1, marks: [], last: {}, deltas: {}, prev: null }) } };
}

/** Следующий бой (новый дракон, все живы) или конец игры. */
export function nextBattle(session: Session, content: DragonContent, participants: Participant[]): SessionChange {
  const r = parseDragonResult(session.state.result);
  const order = orderOf(session, participants, r);
  if (r.battle + 1 >= content.battles.length) {
    return { state: { step: session.state.step + 1, stage: "reveal", revealed: true, startedAt: null, timeLimit: null, answered: 0, result: write({ ...r, order, phase: "over", deltas: {}, prev: null }) } };
  }
  const next = battleStart(content, { ...r, order }, r.battle + 1);
  return { state: { step: session.state.step + 1, stage: "ready", startedAt: null, timeLimit: null, revealed: false, answered: 0, result: write(next) }, leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode) };
}

export interface DragonBack {
  change: SessionChange;
  clear?: number[];
}

export function dragonBack(session: Session, participants: Participant[]): DragonBack | null {
  const { stage, step } = session.state;
  const r = parseDragonResult(session.state.result);
  if (stage === "podium") return { change: podiumBack(session) };
  if ((r.phase === "reveal" || r.phase === "victory") && r.prev) {
    // Отменить удар: здоровье, жизни и очки — как до него; задание снова открыто.
    return { change: { state: { stage: "question", revealed: false, result: write({ ...r, ...r.prev, phase: "task", last: {}, killer: null, deltas: {}, prev: null }) }, ...applyDeltas(session, participants, negate(r.deltas)) } };
  }
  if (r.phase === "defeat" && r.prev) {
    return { change: { state: { result: write({ ...r, ...r.prev, phase: "reveal", deltas: {}, prev: null }) }, ...applyDeltas(session, participants, negate(r.deltas)) } };
  }
  if (r.phase === "task") {
    return { change: { state: { stage: "ready", startedAt: null, timeLimit: null, revealed: false, answered: 0, result: write({ ...r, phase: "intro", marks: [] }) } }, clear: [step] };
  }
  return null;
}
