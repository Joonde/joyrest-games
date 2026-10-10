// «Олимп» на сессии — чистые функции пульта: выбор богов → сцены истории (рассказ, проверка кубиком,
// голосование, бой, концовка) → награждение. Всё состояние — в `state.result` (`OlympResult`), очки
// таблицы — накопленный опыт бога команды. Броски — с сервера: из id ответа и времени (`d100Of`),
// бросок «за команду» и ход противника — из шага и номера хода (одинаково на втором пульте).
//
// Шаги: каждое ожидание ответа телефонов (выбор бога, бросок, голос, ход бога в бою) — новый шаг
// со stage "question"; показ итога — "reveal"; чтение ведущим — "ready".
import { leaderboardAdditions, scoringParticipants } from "../../core/leaderboard";
import { awardNow, hasPodium, podiumBack, podiumDone } from "../../core/podium";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import type { ScoreDelta, Step } from "../types";
import { abilitiesOf, godOf, GODS, type Ability, type EffectSpec } from "./gods";
import { foeOf } from "./foes";
import { battleTotals, battleXp, beginTurn, canUse, endTurn, foeAct, godAct, startBattle, type Battle, type LogEntry, type LogKind } from "./combat";
import { OUTCOME_NAMES, OUTCOME_XP, d100Of, hpMaxOf, levelOf, outcomeOf, splitCoins, type Outcome, type StatId } from "./rules";
import { branchNext, sceneOf, visibleOptions, type CheckScene, type Scene, type VoteScene } from "./story";
import { difficultyOf, storyOf, type OlympContent } from "./content";

export type OlympPhase = "pick" | "scene" | "check" | "vote" | "fight" | "fightEnd" | "end";

/** Эффект из истории (проклятие после неудачного броска): действует до конца следующего боя или проверки. */
export interface StoryEffect extends EffectSpec {
  left: number;
}

export interface Member {
  god: string;
  xp: number;
  hp: number;
  coins: number;
  effects: StoryEffect[];
}

export interface CheckState {
  who: string | null;
  roll: number | null;
  mod: number;
  outcome: Outcome | null;
  /** Что дал бросок: «+20 опыта Зевсу», «Сага запомнила». */
  chips: Array<[string, "good" | "bad" | "gold"]>;
}

export interface VoteState {
  /** Номера видимых вариантов (в `scene.options`). */
  options: number[];
  /** Голоса за каждый видимый вариант. */
  tally: number[];
  /** Победивший вариант (номер в `options`), null — голосование идёт. */
  picked: number | null;
  tie: boolean;
}

export interface FightEnd {
  win: boolean;
  xp: Record<string, number>;
  coins: Record<string, number>;
  rolls: Record<string, number>;
}

export interface LastDie {
  pid: string;
  roll: number;
  outcome: Outcome;
  ability: string;
}

export interface OlympResult {
  phase: OlympPhase;
  order: string[];
  party: Record<string, Member>;
  flags: string[];
  scene: string;
  /** Кто бросает следующую проверку по умолчанию (по кругу). */
  turn: number;
  check: CheckState | null;
  vote: VoteState | null;
  battle: Battle | null;
  /** Текущий боец уже сделал ход (ждём «Следующий ход»). */
  acted: boolean;
  lastDie: LastDie | null;
  fightEnd: FightEnd | null;
  log: LogEntry[];
  seq: number;
  /** Одно действие назад: прежнее состояние (без журнала) и начисленный опыт. */
  undo: { result: Omit<OlympResult, "undo" | "log">; score: Record<string, number>; stage: "ready" | "question" | "reveal" } | null;
}

const LOG_KEEP = 60;
const BATTLE_LOG_KEEP = 16;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const PHASES: OlympPhase[] = ["pick", "scene", "check", "vote", "fight", "fightEnd", "end"];
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown, def = 0) => (typeof v === "number" && Number.isFinite(v) ? v : def);
const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && ID.test(x)))].slice(0, 200) : []);
const strs = (v: unknown, max = 50) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length <= 80).slice(0, max) : []);
const OUTCOMES: Outcome[] = ["crit", "good", "mid", "bad", "fail"];

function parseLog(v: unknown, keep: number): LogEntry[] {
  if (!Array.isArray(v)) return [];
  const out: LogEntry[] = [];
  for (const raw of v.slice(0, keep)) {
    const e = rec(raw);
    if (typeof e.x !== "string" || typeof e.k !== "string") continue;
    const entry: LogEntry = { n: num(e.n), k: e.k as LogKind, x: e.x.slice(0, 400), who: strs(e.who, 12) };
    if (Array.isArray(e.d) && e.d.length === 3) entry.d = [String(e.d[0]), String(e.d[1]), num(e.d[2])];
    if (Array.isArray(e.h) && e.h.length === 3) entry.h = [String(e.h[0]), String(e.h[1]), num(e.h[2])];
    out.push(entry);
  }
  return out;
}

function parseEffects(v: unknown): StoryEffect[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 10).flatMap((raw) => {
    const e = rec(raw);
    if (typeof e.id !== "string" || typeof e.name !== "string") return [];
    return [{ ...(e as unknown as StoryEffect), left: Math.max(1, num(e.left, 1)) }];
  });
}

function parseMembers(v: unknown): Record<string, Member> {
  const out: Record<string, Member> = {};
  for (const [pid, raw] of Object.entries(rec(v))) {
    const m = rec(raw);
    if (!ID.test(pid) || !godOf(m.god as string)) continue;
    out[pid] = { god: m.god as string, xp: Math.max(0, Math.round(num(m.xp))), hp: Math.max(1, Math.round(num(m.hp, 100))), coins: Math.max(0, Math.round(num(m.coins))), effects: parseEffects(m.effects) };
  }
  return out;
}

function parseCheck(v: unknown): CheckState | null {
  const c = rec(v);
  if (Object.keys(c).length === 0) return null;
  return {
    who: typeof c.who === "string" && ID.test(c.who) ? c.who : null,
    roll: typeof c.roll === "number" ? c.roll : null,
    mod: num(c.mod),
    outcome: OUTCOMES.includes(c.outcome as Outcome) ? (c.outcome as Outcome) : null,
    chips: Array.isArray(c.chips) ? (c.chips as Array<[string, "good" | "bad" | "gold"]>).filter((x) => Array.isArray(x) && typeof x[0] === "string").slice(0, 8) : [],
  };
}

function parseVote(v: unknown): VoteState | null {
  const d = rec(v);
  if (!Array.isArray(d.options)) return null;
  const nums = (a: unknown) => (Array.isArray(a) ? a.map((x) => Math.max(0, Math.round(num(x)))).slice(0, 8) : []);
  return { options: nums(d.options), tally: nums(d.tally), picked: typeof d.picked === "number" ? d.picked : null, tie: d.tie === true };
}

function parseBattle(v: unknown): Battle | null {
  const b = rec(v);
  if (typeof b.foe !== "string" || !Array.isArray(b.fighters) || !foeOf(b.foe)) return null;
  return { ...(b as unknown as Battle), log: parseLog(b.log, BATTLE_LOG_KEEP) };
}

function parseFightEnd(v: unknown): FightEnd | null {
  const d = rec(v);
  if (typeof d.win !== "boolean") return null;
  const map = (x: unknown) => Object.fromEntries(Object.entries(rec(x)).filter(([k, n]) => ID.test(k) && typeof n === "number").map(([k, n]) => [k, n as number]));
  return { win: d.win, xp: map(d.xp), coins: map(d.coins), rolls: map(d.rolls) };
}

function parseCore(d: Record<string, unknown>): Omit<OlympResult, "undo" | "log"> {
  const die = rec(d.lastDie);
  return {
    phase: PHASES.includes(d.phase as OlympPhase) ? (d.phase as OlympPhase) : "pick",
    order: ids(d.order),
    party: parseMembers(d.party),
    flags: strs(d.flags),
    scene: typeof d.scene === "string" ? d.scene : "",
    turn: Math.max(0, Math.round(num(d.turn))),
    check: parseCheck(d.check),
    vote: parseVote(d.vote),
    battle: parseBattle(d.battle),
    acted: d.acted === true,
    lastDie: typeof die.pid === "string" && typeof die.roll === "number" && OUTCOMES.includes(die.outcome as Outcome) ? { pid: die.pid, roll: die.roll, outcome: die.outcome as Outcome, ability: typeof die.ability === "string" ? die.ability : "" } : null,
    fightEnd: parseFightEnd(d.fightEnd),
    seq: Math.max(1, Math.round(num(d.seq, 1))),
  };
}

export function parseOlympResult(raw: unknown): OlympResult {
  const d = rec(raw);
  const u = rec(d.undo);
  const stage = u.stage === "question" || u.stage === "reveal" ? u.stage : "ready";
  return {
    ...parseCore(d),
    log: parseLog(d.log, LOG_KEEP),
    undo: Object.keys(rec(u.result)).length > 0 ? { result: parseCore(rec(u.result)), score: rec(u.score) as Record<string, number>, stage } : null,
  };
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function olympSteps(content: OlympContent): Step[] {
  return storyOf(content).scenes.filter((s) => s.kind === "check" || s.kind === "vote" || s.kind === "fight").map((s) => ({ id: s.id, answerable: true }));
}

/** Очки — опыт, начисляется пультом сразу (`addScore`); подсчёта по ответам нет. */
export function score(): ScoreDelta[] {
  return [];
}

// ------------------------------------------------------------------ помощники

export function godName(r: OlympResult, pid: string | null | undefined): string {
  const m = pid ? r.party[pid] : undefined;
  return (m && godOf(m.god)?.name) ?? "Бог";
}

export function levelOfMember(m: Member): number {
  return levelOf(m.xp).level;
}

export function hpMaxOfMember(m: Member): number {
  return hpMaxOf(levelOfMember(m));
}

/** Характеристика с эффектами истории. */
export function memberStat(m: Member, stat: StatId): number {
  const god = godOf(m.god);
  return (god?.stats[stat] ?? 0) + m.effects.reduce((a, e) => a + (e.stats?.[stat] ?? 0), 0);
}

export function memberRollMod(m: Member): number {
  return m.effects.reduce((a, e) => a + (e.roll ?? 0), 0);
}

function orderOf(session: Session, participants: Participant[], r: OlympResult): string[] {
  const joined = [...scoringParticipants(participants, session.playMode)].sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0) || a.id.localeCompare(b.id)).map((p) => p.id);
  const known = new Set([...joined, ...Object.keys(session.leaderboard)]);
  return [...new Set([...r.order.filter((p) => known.has(p)), ...joined, ...Object.keys(session.leaderboard)])];
}

/** Свободный бог: первый, которого ещё никто не взял; все заняты (больше 10 команд) — по кругу. */
function freeGod(taken: string[], index: number): string {
  const free = GODS.find((g) => !taken.includes(g.id));
  return (free ?? (GODS[index % GODS.length] as (typeof GODS)[number])).id;
}

function newMember(god: string): Member {
  return { god, xp: 0, hp: hpMaxOf(1), coins: 0, effects: [] };
}

/** Опоздавшие команды получают свободного бога и вступают в историю. */
function seatLate(r: OlympResult, order: string[]): void {
  r.order = order;
  order.forEach((pid, i) => {
    if (r.party[pid]) return;
    const god = freeGod(Object.values(r.party).map((m) => m.god), i);
    r.party[pid] = newMember(god);
    log(r, "story", `К отряду присоединился ${godOf(god)?.name ?? "бог"}`, [godOf(god)?.name ?? ""]);
  });
}

function log(r: OlympResult, k: LogKind, x: string, who: string[] = []): void {
  r.log.unshift({ n: r.seq, k, x, who });
  r.seq += 1;
  if (r.log.length > LOG_KEEP) r.log.length = LOG_KEEP;
}

/** Опыт богу: таблица очков = опыт; новый уровень — запись в журнал и прибавка здоровья. */
function giveXp(r: OlympResult, pid: string, amount: number, deltas: Record<string, number>): void {
  const m = r.party[pid];
  if (!m || amount <= 0) return;
  const before = levelOfMember(m);
  m.xp += amount;
  deltas[pid] = (deltas[pid] ?? 0) + amount;
  const after = levelOfMember(m);
  if (after > before) {
    m.hp = Math.min(hpMaxOfMember(m), m.hp + (hpMaxOf(after) - hpMaxOf(before)));
    log(r, "level", `${godName(r, pid)}: новый уровень — ${after}-й! Здоровье ${hpMaxOfMember(m)}`, [godName(r, pid)]);
  }
}

/** Драхмы отряду: делим бросками (только целые, сумма = награде). */
function giveCoins(r: OlympResult, amount: number, salt: string): Record<string, number> {
  const pids = r.order.filter((p) => r.party[p]);
  if (pids.length === 0 || amount === 0) return {};
  if (amount < 0) {
    const each = Math.ceil(-amount / pids.length);
    for (const p of pids) {
      const m = r.party[p] as Member;
      m.coins -= Math.min(m.coins, each);
    }
    log(r, "coin", `Отряд заплатил ${-amount} драхм`);
    return {};
  }
  const rolls = pids.map((p) => d100Of({ id: `${salt}_${p}`, submittedAt: 0 }));
  const parts = splitCoins(amount, rolls);
  const out: Record<string, number> = {};
  pids.forEach((p, i) => {
    (r.party[p] as Member).coins += parts[i] ?? 0;
    out[p] = rolls[i] ?? 0;
  });
  log(r, "coin", `${amount} драхм делим бросками: ${pids.map((p, i) => `${godName(r, p)} ${rolls[i]} → ${parts[i]}`).join(", ")}`, pids.map((p) => godName(r, p)));
  return out;
}

function stripUndo(r: OlympResult): Omit<OlympResult, "undo" | "log"> {
  const { undo: _u, log: _l, ...rest } = r;
  void _u;
  void _l;
  const core = clone(rest);
  if (core.battle) core.battle.log = core.battle.log.slice(0, 4);
  return core;
}

function write(r: OlympResult): Record<string, unknown> {
  if (r.battle) r.battle.log = r.battle.log.slice(0, BATTLE_LOG_KEEP);
  return { ...r } as unknown as Record<string, unknown>;
}

/** Запись действия: новое состояние, «Назад» на одно действие, опыт — в таблицу. */
function commit(session: Session, participants: Participant[], prev: OlympResult, next: OlympResult, stage: "ready" | "question" | "reveal", deltas: Record<string, number> = {}, newStep = true, timeLimit: number | null = null): SessionChange {
  const prevStage = session.state.stage === "question" || session.state.stage === "reveal" ? session.state.stage : "ready";
  next.undo = { result: stripUndo(prev), score: deltas, stage: prevStage };
  const nonzero = Object.fromEntries(Object.entries(deltas).filter(([, n]) => n !== 0));
  return {
    state: {
      ...(newStep ? { step: session.state.step + 1, answered: 0 } : {}),
      stage,
      startedAt: stage === "question" ? "server" : null,
      timeLimit: stage === "question" ? timeLimit : null,
      revealed: stage === "reveal",
      result: write(next),
    },
    leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode),
    ...(Object.keys(nonzero).length > 0 ? { addScore: nonzero } : {}),
  };
}

// ------------------------------------------------------------------ что дальше на пульте

export type OlympAction =
  | "start"
  | "pickDone"
  | "next"
  | "roll"
  | "showRoll"
  | "openVote"
  | "closeVote"
  | "fight"
  | "act"
  | "nextTurn"
  | "fightResult"
  | "podium"
  | "podiumNext"
  | "finish";

export function olympPrimary(session: Session, content: OlympContent): OlympAction {
  const { stage } = session.state;
  const r = parseOlympResult(session.state.result);
  if (stage === "podium") return podiumDone(session) ? "finish" : "podiumNext";
  if (r.order.length === 0) return "start";
  if (r.phase === "pick") return "pickDone";
  const scene = sceneOf(storyOf(content), r.scene);
  if (r.phase === "end") return hasPodium(session.leaderboard) ? "podium" : "finish";
  if (r.phase === "check") return stage === "question" ? "showRoll" : r.check?.outcome ? "next" : "roll";
  if (r.phase === "vote") return stage === "question" ? "closeVote" : r.vote?.picked !== null && r.vote?.picked !== undefined ? "next" : "openVote";
  if (r.phase === "fight") {
    if (r.battle?.over) return "fightResult";
    return r.acted ? "nextTurn" : "act";
  }
  if (r.phase === "fightEnd") return "next";
  if (scene?.kind === "fight") return "fight";
  return "next";
}

// ------------------------------------------------------------------ выбор богов

/** «Начать игру»: капитаны выбирают богов на телефонах. */
export function startOlymp(session: Session, participants: Participant[]): SessionChange {
  const prev = parseOlympResult(session.state.result);
  const r = clone(prev);
  r.order = orderOf(session, participants, r);
  r.phase = "pick";
  return commit(session, participants, prev, r, "question");
}

/** Кто какого бога выбрал: раньше выбравший получает бога; занят — первый свободный. */
export function assignGods(order: string[], answers: Answer[], step: number, since: number): Record<string, string> {
  const wanted = answers
    .filter((a) => a.step === step && (a.submittedAt ?? 0) >= since && order.includes(a.pid))
    .sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0));
  const out: Record<string, string> = {};
  for (const a of wanted) {
    const g = rec(a.value).god;
    if (typeof g === "string" && godOf(g) && !Object.values(out).includes(g) && !out[a.pid]) out[a.pid] = g;
  }
  order.forEach((p, i) => {
    if (!out[p]) out[p] = freeGod(Object.values(out), i);
  });
  return out;
}

/** «Боги выбраны — в путь!» */
export function closePick(session: Session, content: OlympContent, answers: Answer[], participants: Participant[]): SessionChange {
  const prev = parseOlympResult(session.state.result);
  const r = clone(prev);
  r.order = orderOf(session, participants, r);
  const gods = assignGods(r.order, answers, session.state.step, session.state.startedAt ?? 0);
  for (const p of r.order) r.party[p] = r.party[p] ?? newMember(gods[p] as string);
  log(r, "story", `Отряд собран: ${r.order.map((p) => godName(r, p)).join(", ")}`, r.order.map((p) => godName(r, p)));
  enter(r, storyOf(content).start, content);
  return commit(session, participants, prev, r, "ready");
}

/** Войти в сцену: развилки проходятся сами, у проверки — следующий по кругу бросающий. */
function enter(r: OlympResult, sceneId: string, content: OlympContent): void {
  const story = storyOf(content);
  let scene: Scene | undefined = sceneOf(story, sceneId);
  for (let guard = 0; scene && scene.kind === "branch" && guard < 10; guard++) {
    const next = branchNext(scene, r.flags);
    log(r, "story", `${scene.title}: ${scene.screen}`);
    scene = sceneOf(story, next);
  }
  if (!scene) return;
  r.scene = scene.id;
  r.check = null;
  r.vote = null;
  r.battle = null;
  r.acted = false;
  r.lastDie = null;
  r.fightEnd = null;
  r.phase = scene.kind === "check" ? "check" : scene.kind === "vote" ? "vote" : scene.kind === "end" ? "end" : "scene";
  if (scene.kind === "check") {
    const pids = r.order.filter((p) => r.party[p]);
    r.check = { who: pids.length > 0 ? (pids[r.turn % pids.length] as string) : null, roll: null, mod: 0, outcome: null, chips: [] };
  }
  if (scene.kind === "vote") {
    const visible = visibleOptions(scene, r.flags);
    r.vote = { options: visible.map((o) => scene.options.indexOf(o)), tally: visible.map(() => 0), picked: null, tie: false };
  }
  log(r, scene.kind === "end" ? "story" : "story", scene.kind === "end" ? `Концовка: «${scene.title}»` : `${scene.title} — ${scene.screen}`);
}

/** «Дальше»: рассказ → следующая сцена; после броска, голосования и боя — куда они ведут. */
export function nextScene(session: Session, content: OlympContent, participants: Participant[]): SessionChange | null {
  const prev = parseOlympResult(session.state.result);
  const r = clone(prev);
  const scene = sceneOf(storyOf(content), r.scene);
  if (!scene) return null;
  let to: string | null = null;
  if (scene.kind === "narrate") to = scene.next;
  else if (scene.kind === "check" && r.check?.outcome) to = scene.outcomes[r.check.outcome].next ?? scene.next;
  else if (scene.kind === "vote" && r.vote && r.vote.picked !== null) to = scene.options[r.vote.options[r.vote.picked] ?? 0]?.next ?? null;
  else if (scene.kind === "fight" && r.fightEnd) to = r.fightEnd.win ? scene.win : scene.lose;
  if (!to) return null;
  seatLate(r, orderOf(session, participants, r));
  enter(r, to, content);
  return commit(session, participants, prev, r, "ready");
}

// ------------------------------------------------------------------ проверка кубиком

export function setRoller(session: Session, participants: Participant[], pid: string): SessionChange | null {
  const prev = parseOlympResult(session.state.result);
  if (prev.phase !== "check" || !prev.check || prev.check.outcome || !prev.party[pid]) return null;
  const r = clone(prev);
  (r.check as CheckState).who = pid;
  return commit(session, participants, prev, r, "ready", {}, false);
}

/** «Бросок»: телефон бросающего получает кнопку кубика. */
export function openRoll(session: Session, participants: Participant[]): SessionChange | null {
  const prev = parseOlympResult(session.state.result);
  if (prev.phase !== "check" || !prev.check?.who) return null;
  return commit(session, participants, prev, clone(prev), "question");
}

/** «Показать бросок»: число с телефона (или бросок за команду), исход, награды и последствия. */
export function showRoll(session: Session, content: OlympContent, answers: Answer[], participants: Participant[]): SessionChange | null {
  const prev = parseOlympResult(session.state.result);
  const scene = sceneOf(storyOf(content), prev.scene);
  if (prev.phase !== "check" || !prev.check?.who || scene?.kind !== "check") return null;
  const r = clone(prev);
  const check = r.check as CheckState;
  const who = check.who as string;
  const m = r.party[who] as Member;
  const answer = answers.find((a) => a.step === session.state.step && a.pid === who && rec(a.value).roll === true && (a.submittedAt ?? 0) >= (session.state.startedAt ?? 0));
  const roll = answer ? d100Of(answer) : d100Of({ id: `${session.id}_${session.state.step}_${who}_host`, submittedAt: session.state.startedAt ?? 0 });
  const mod = memberRollMod(m);
  const outcome = outcomeOf(roll, memberStat(m, scene.stat), mod);
  const branch = scene.outcomes[outcome];
  const deltas: Record<string, number> = {};
  const chips: CheckState["chips"] = [];
  const name = godName(r, who);
  const xp = branch.xp ?? OUTCOME_XP[outcome];
  if (xp > 0) {
    giveXp(r, who, xp, deltas);
    chips.push([`+${xp} опыта: ${name}`, "good"]);
  }
  // Разовые эффекты (Рок) сгорают на этом броске.
  m.effects = m.effects.filter((e) => e.turns > 1);
  if (branch.effect) {
    m.effects = [...m.effects.filter((e) => e.id !== branch.effect?.id), { ...branch.effect, left: branch.effect.turns }];
    chips.push([`«${branch.effect.name}» на ${name}`, "bad"]);
  }
  if (branch.flag && !r.flags.includes(branch.flag)) {
    r.flags.push(branch.flag);
    chips.push(["Сага запомнила", "gold"]);
  }
  if (branch.hurt) {
    m.hp = Math.max(1, m.hp - branch.hurt);
    chips.push([`−${branch.hurt} здоровья: ${name}`, "bad"]);
  }
  if (branch.coins) {
    giveCoins(r, branch.coins, `${session.id}_${session.state.step}_coins`);
    chips.push([branch.coins > 0 ? `+${branch.coins} драхм отряду` : `${branch.coins} драхм`, branch.coins > 0 ? "gold" : "bad"]);
  }
  Object.assign(check, { roll, mod, outcome, chips });
  r.turn += 1;
  log(r, outcome === "fail" ? "curse" : "story", `${name}: «${scene.title}», бросок ${roll}${mod ? ` ${mod > 0 ? "+" : "−"}${Math.abs(mod)}` : ""} — ${OUTCOME_NAMES[outcome].toLowerCase()}. ${branch.text}`, [name]);
  return commit(session, participants, prev, r, "reveal", deltas, false);
}

// ------------------------------------------------------------------ голосование

export function openVote(session: Session, content: OlympContent, participants: Participant[]): SessionChange | null {
  const prev = parseOlympResult(session.state.result);
  if (prev.phase !== "vote" || !prev.vote) return null;
  return commit(session, participants, prev, clone(prev), "question", {}, true, content.voteSeconds > 0 ? content.voteSeconds : null);
}

/** Итог: большинство голосов команд; ничья — жребий с сервера среди равных. */
export function closeVote(session: Session, content: OlympContent, answers: Answer[], participants: Participant[]): SessionChange | null {
  const prev = parseOlympResult(session.state.result);
  const scene = sceneOf(storyOf(content), prev.scene) as VoteScene | undefined;
  if (prev.phase !== "vote" || !prev.vote || scene?.kind !== "vote") return null;
  const r = clone(prev);
  const vote = r.vote as VoteState;
  const tally = vote.options.map(() => 0);
  const seen = new Set<string>();
  for (const a of answers) {
    if (a.step !== session.state.step || seen.has(a.pid) || !r.order.includes(a.pid)) continue;
    const i = rec(a.value).vote;
    if (typeof i === "number" && i >= 0 && i < tally.length) {
      tally[i] = (tally[i] ?? 0) + 1;
      seen.add(a.pid);
    }
  }
  const best = Math.max(...tally);
  const top = tally.map((n, i) => (n === best ? i : -1)).filter((i) => i >= 0);
  const pick = top.length === 1 ? (top[0] as number) : (top[(d100Of({ id: `${session.id}_${session.state.step}_tie`, submittedAt: session.state.startedAt ?? 0 }) - 1) % top.length] as number);
  vote.tally = tally;
  vote.picked = pick;
  vote.tie = top.length > 1;
  const option = scene.options[vote.options[pick] ?? 0];
  log(r, "vote", `Голосование «${scene.title}»: ${vote.options.map((o, i) => `${scene.options[o]?.label} — ${tally[i]}`).join(", ")}. ${vote.tie ? "Ничья, жребий выбрал" : "Решили"}: «${option?.label ?? ""}»`);
  return commit(session, participants, prev, r, "reveal", {}, false);
}

// ------------------------------------------------------------------ бой

function foeRoll(session: Session, b: Battle): number {
  return d100Of({ id: `${session.id}_foe_${b.turns}_${b.seq}`, submittedAt: 0 });
}

/** Перенести новые записи боя в журнал. */
function syncLog(r: OlympResult, b: Battle): void {
  const fresh = b.log.filter((e) => e.n >= r.seq).sort((a, c) => a.n - c.n);
  for (const e of fresh) r.log.unshift({ ...e });
  if (r.log.length > LOG_KEEP) r.log.length = LOG_KEEP;
  r.seq = Math.max(r.seq, b.seq);
}

/** Довести бой до следующего решения: эффекты начала хода, пропуски, ход противника. */
function advance(session: Session, r: OlympResult): void {
  let b = r.battle as Battle;
  for (let guard = 0; guard < 40 && !b.over; guard++) {
    const begun = beginTurn(b);
    b = begun.battle;
    if (b.over) break;
    if (begun.skip) {
      b = endTurn(b);
      continue;
    }
    const actor = b.fighters.find((f) => f.id === b.actor);
    if (actor?.side === "foe") {
      b = foeAct(b, foeRoll(session, b));
      r.acted = true;
    } else r.acted = false;
    break;
  }
  r.battle = b;
  syncLog(r, b);
}

/** «Начать бой»: здоровье и проклятия богов переходят в бой. */
export function startFight(session: Session, content: OlympContent, participants: Participant[]): SessionChange | null {
  const prev = parseOlympResult(session.state.result);
  const scene = sceneOf(storyOf(content), prev.scene);
  if (scene?.kind !== "fight") return null;
  const r = clone(prev);
  seatLate(r, orderOf(session, participants, r));
  const diff = difficultyOf(content);
  const pids = r.order.filter((p) => r.party[p]);
  const b = startBattle(scene.foe, pids.map((p) => ({ pid: p, god: (r.party[p] as Member).god, level: levelOfMember(r.party[p] as Member), hp: (r.party[p] as Member).hp })), r.seq, { hp: diff.hp, power: diff.power });
  for (const f of b.fighters) {
    const m = r.party[f.id];
    if (!m) continue;
    f.effects = m.effects.map((e) => ({ id: e.id, name: e.name, kind: e.kind, left: e.left, roll: e.roll, stats: e.stats, dot: e.dot, speed: e.speed, taken: e.taken, skip: e.skip, from: "история" }));
    m.effects = [];
  }
  r.battle = b;
  r.phase = "fight";
  r.lastDie = null;
  advance(session, r);
  return commit(session, participants, prev, r, r.acted ? "reveal" : "question");
}

/** Что прислал капитан бога, чей ход: способность и цель. */
export function actionOf(answers: Answer[], session: Session, pid: string): { ability: string; target: string | null; answer: Answer } | null {
  const a = answers
    .filter((x) => x.step === session.state.step && x.pid === pid && (x.submittedAt ?? 0) >= (session.state.startedAt ?? 0))
    .sort((x, y) => (x.submittedAt ?? 0) - (y.submittedAt ?? 0))[0];
  const v = rec(a?.value);
  return a && typeof v.ability === "string" ? { ability: v.ability, target: typeof v.target === "string" ? v.target : null, answer: a } : null;
}

/** Способности, готовые к ходу. */
export function readyAbilities(b: Battle, pid: string): Ability[] {
  const f = b.fighters.find((x) => x.id === pid);
  const god = f ? godOf(f.ref) : undefined;
  return f && god ? abilitiesOf(god).filter((a) => canUse(f, a)) : [];
}

/**
 * Ход бога: способность и цель — от капитана или ведущего; бросок — из ответа телефона
 * (или «за команду» из шага). Возвращает null, если ход уже сделан или способность не готова.
 */
export function godTurn(session: Session, participants: Participant[], answers: Answer[], pick?: { ability: string; target: string | null }): SessionChange | null {
  const prev = parseOlympResult(session.state.result);
  const b = prev.battle;
  if (prev.phase !== "fight" || !b || b.over || prev.acted || !b.actor) return null;
  const pid = b.actor;
  const sent = actionOf(answers, session, pid);
  const choice = pick ?? (sent ? { ability: sent.ability, target: sent.target } : null);
  if (!choice) return null;
  const ready = readyAbilities(b, pid);
  const ability = ready.find((a) => a.id === choice.ability);
  if (!ability) return null;
  const roll = sent && !pick ? d100Of(sent.answer) : d100Of({ id: `${session.id}_${session.state.step}_${pid}_host`, submittedAt: session.state.startedAt ?? 0 });
  const r = clone(prev);
  const allies = b.fighters.filter((f) => f.side === "god" && !f.down);
  const target = choice.target && allies.some((f) => f.id === choice.target) ? choice.target : ([...allies].sort((x, y) => x.hp / x.hpMax - y.hp / y.hpMax)[0]?.id ?? pid);
  try {
    const res = godAct(b, pid, ability.id, [target], roll);
    r.battle = res.battle;
    r.acted = true;
    r.lastDie = { pid, roll, outcome: res.outcome, ability: ability.name };
    syncLog(r, res.battle);
  } catch {
    return null;
  }
  return commit(session, participants, prev, r, "reveal", {}, false);
}

/** «Следующий ход»: конец хода, эффекты, ход противника или ход следующего бога. */
export function nextTurn(session: Session, participants: Participant[]): SessionChange | null {
  const prev = parseOlympResult(session.state.result);
  if (prev.phase !== "fight" || !prev.battle || prev.battle.over || !prev.acted) return null;
  const r = clone(prev);
  r.battle = endTurn(r.battle as Battle);
  r.lastDie = null;
  advance(session, r);
  return commit(session, participants, prev, r, r.acted || r.battle?.over ? "reveal" : "question");
}

/** «Итог боя»: опыт по урону, драхмы бросками, здоровье остаётся до следующего боя. */
export function fightResult(session: Session, participants: Participant[]): SessionChange | null {
  const prev = parseOlympResult(session.state.result);
  const b = prev.battle;
  if (prev.phase !== "fight" || !b?.over) return null;
  const r = clone(prev);
  const foe = foeOf(b.foe);
  const win = b.over === "win";
  const deltas: Record<string, number> = {};
  for (const f of b.fighters) {
    const m = r.party[f.id];
    if (!m) continue;
    m.hp = f.down ? Math.max(1, Math.round(f.hpMax * (win ? 0.25 : 0.3))) : Math.max(1, f.hp);
  }
  let xp: Record<string, number> = {};
  let rolls: Record<string, number> = {};
  if (win) {
    xp = battleXp(b);
    for (const [p, v] of Object.entries(xp)) giveXp(r, p, v, deltas);
    log(r, "coin", `Опыт за бой: ${Object.entries(xp).map(([p, v]) => `${godName(r, p)} +${v}`).join(", ")}`, Object.keys(xp).map((p) => godName(r, p)));
    rolls = giveCoins(r, foe?.coins ?? 0, `${session.id}_${b.seq}_loot`);
  } else log(r, "fight", "Отряд отступает. Наград нет");
  const coins = Object.fromEntries(r.order.map((p) => [p, (r.party[p]?.coins ?? 0) - (prev.party[p]?.coins ?? 0)]));
  r.fightEnd = { win, xp, coins, rolls };
  r.phase = "fightEnd";
  return commit(session, participants, prev, r, "reveal", deltas, false);
}

/** Итоги текущего боя для экрана и журнала. */
export { battleTotals };

// ------------------------------------------------------------------ назад и награждение

/** «Назад»: одно действие (опыт тоже снимается). */
export function olympBack(session: Session): SessionChange | null {
  if (session.state.stage === "podium") return podiumBack(session);
  const r = parseOlympResult(session.state.result);
  const u = r.undo;
  if (!u) return null;
  const restored: OlympResult = { ...clone(u.result), log: r.log.filter((e) => e.n < u.result.seq), undo: null };
  const minus = Object.fromEntries(Object.entries(u.score).filter(([, n]) => typeof n === "number" && n !== 0).map(([p, n]) => [p, -(n as number)]));
  const stage = u.stage;
  return {
    state: { step: session.state.step + 1, answered: 0, stage, startedAt: stage === "question" ? "server" : null, timeLimit: null, revealed: stage === "reveal", result: write(restored) },
    ...(Object.keys(minus).length > 0 ? { addScore: minus } : {}),
  };
}

export function olympAward(session: Session): SessionChange {
  return awardNow(session);
}

/** Текущая сцена (для экранов). */
export function currentScene(content: OlympContent, r: OlympResult): Scene | undefined {
  return sceneOf(storyOf(content), r.scene);
}

export function isCheck(scene: Scene | undefined): scene is CheckScene {
  return scene?.kind === "check";
}
