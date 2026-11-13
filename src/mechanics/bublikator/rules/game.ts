/**
 * «Бубликатор» — правила целиком (docs/bublikator.md): фазы, приказы, корпус и ремонт, события, диверсант, итоги. Чистые
 * функции над состоянием: время, связь, случайность и отправка телефону — только через `env` (у сервера это контекст игровой
 * комнаты). Время в состоянии — «время игры»: часы сервера минус все паузы (`offset`).
 */
import {
  C_PER_MINUTE,
  DISTANCE_MAX,
  DRILL_MS,
  EFFECT_EDGE_MS,
  EVENT_EDGE_END_MS,
  EVENT_EDGE_START_MS,
  EVENT_GAP_MS,
  EVENT_MS,
  FAKE_SHARE,
  FINISH_BONUS_PER_S,
  FOREIGN_SHARE,
  GLITCH_GUARD_MS,
  HOLD_MS,
  HULL_AFTER_REPAIR,
  HULL_MAX,
  KICK_AFTER_MS,
  LAUNCH_MS,
  METEOR_BAD,
  METEOR_BONUS,
  METEOR_REF,
  METEOR_TAPS_REF_PER_S,
  METEOR_WEAK,
  MIN_N,
  MOVES_PER_SECOND,
  NEXT_AFTER_DONE_MS,
  NEXT_AFTER_FAIL_MS,
  ORDER_DAMAGE,
  ORDER_MAX_S,
  ORDER_MIN_S,
  ORDER_SECONDS,
  ORDER_SHIFT_STEP_S,
  PULL_DRIFT_PER_S,
  PULL_HOLD_MS,
  REPAIR_MIN_MS,
  REPAIR_MS,
  REPAIR_TAPS_PER_PERSON,
  SABOTEUR_MIN_CREW,
  SOS_BLOCK_MS,
  SOS_BONUS,
  SOS_COLORS,
  SOS_LENGTH,
  SPEED_WINDOW_MS,
  TAPS_BURST,
  TAPS_PER_SECOND,
  VOTE_BONUS,
  VOTE_MS,
  WARN_MS,
  WRONG_STOP_MS,
  BACKDATE_MS,
  DOCK_MS,
  CAPTAIN_STAR,
  CAPTAIN_STARS_MAX,
} from "./constants";
import { cleanTask, parseContent } from "./content";
import {
  activeMembers,
  adoptTeams,
  assignAllRoles,
  captainOf,
  crewMembers,
  crewPlayers,
  gatherCrews,
  liveCrews,
  lobbyCrewCount,
  mergeCrews,
  moveMember,
  nameTeams,
  registerTeams,
  rosterChanged,
  seatLate,
  teamCrewOf,
} from "./crews";
import { dealPanels, cleanState, orderText, randomTarget } from "./panels";
import { shuffle } from "./names";
import type { BubContent, BubState, CardStats, Control, Crew, EventKind, EventState, LegResult, Member, Order, Runtime, Stage, VoteResult } from "./types";

/** Что правила знают о комнате (у сервера — `RoomContext`). */
export interface Env {
  now: number;
  paused: boolean;
  players: ReadonlyArray<{ pid: string; name: string; team: string | null }>;
  teams: ReadonlyMap<string, string>;
  online(pid: string): boolean;
  send(pid: string, data: unknown): void;
  changed(): void;
  checkpoint(): void;
  random(key: string): number;
}

/** Событие телефона после проверки комнатой: `at` — по часам сервера, `delayed` — пришло не в свой черёд. */
export interface InEvent {
  t: string;
  at: number;
  late: boolean;
  delayed: boolean;
  [field: string]: unknown;
}

export type Outcome = { ok: true; result?: unknown } | { ok: false; error: string };

const PHASES = ["lobby", "crews", "drill", "leg", "podium", "finished"] as const;

// ------------------------------------------------------------------ время и случайность

/** Время игры. На паузе оно стоит: момент паузы (`pausedGame`, ставит `pause`), после перезапуска — последний шаг цикла. */
export function gameNow(s: BubState, env: Pick<Env, "now" | "paused">): number {
  if (env.paused) return s.pausedGame ?? s.lastTick ?? env.now - s.offset;
  return env.now - s.offset;
}

/**
 * Время события телефона для игры (удержание, кнопка, «Тяга», SOS, лимиты): `delayed` — по приходу; свежее — заявленное
 * телефоном, но не раньше «приход − 0,3 с» (задним числом не подправить), не раньше конца паузы и не позже «сейчас».
 */
export function eventTime(s: BubState, env: Pick<Env, "now" | "paused">, e: Pick<InEvent, "at" | "delayed">): number {
  const now = gameNow(s, env);
  if (e.delayed) return now;
  return Math.min(now, Math.max(s.floor, now - BACKDATE_MS, e.at - s.offset));
}

/** Заявленное время события (по нему решается, какое движение прибора свежее): не раньше конца паузы и не позже «сейчас». */
export function claimedTime(s: BubState, env: Pick<Env, "now" | "paused">, e: Pick<InEvent, "at">): number {
  return Math.min(gameNow(s, env), Math.max(s.floor, e.at - s.offset));
}

/**
 * Случайность пачкой: одно число из зерна комнаты (`env.random`, у сервера — sha256, дорого) на вызов `randomOf`, дальше —
 * быстрый генератор от него (раздача на 800 приборов — тысячи чисел). Повторяемо: то же зерно и номер — те же числа.
 */
export function randomOf(s: BubState, env: Pick<Env, "random">): () => number {
  const n = s.rng;
  s.rng += 1;
  let a = Math.floor(env.random(`b${n}`) * 4294967296) >>> 0;
  return () => {
    // mulberry32
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function toServer(s: BubState, gameTime: number): number {
  return gameTime + s.offset;
}

function freshRuntime(): Runtime {
  return { moves: new Map(), taps: new Map(), sent: new Map(), dirty: new Set(), lastSweep: -Infinity, rosterVer: 0, roster: null, sentCrew: new Map() };
}

function bucketTake(map: Map<string, { tokens: number; at: number }>, key: string, capacity: number, perSecond: number, at: number, want: number): number {
  const b = map.get(key) ?? { tokens: capacity, at };
  if (at > b.at) {
    b.tokens = Math.min(capacity, b.tokens + ((at - b.at) / 1000) * perSecond);
    b.at = at;
  }
  const got = Math.max(0, Math.min(want, Math.floor(b.tokens)));
  b.tokens -= got;
  map.set(key, b);
  return got;
}

// ------------------------------------------------------------------ создание, вход

function newMember(pid: string, name: string, join: number): Member {
  return {
    pid,
    name,
    join,
    crew: null,
    role: "lobby",
    doubleOf: null,
    pending: false,
    gone: false,
    offlineSince: null,
    panel: [],
    order: null,
    nextAt: 0,
    lastControl: null,
    done: 0,
    legDone: 0,
    moved: 0,
    ribbons: 0,
    roleSeen: false,
    vote: null,
  };
}

export function createState(contentRaw: unknown, teamsMode: boolean, env: Env): BubState {
  const s: BubState = {
    v: 1,
    content: parseContent(contentRaw),
    teamsMode,
    phase: "lobby",
    legIndex: 0,
    members: {},
    joinSeq: 0,
    crews: [],
    controls: {},
    ctlSeq: 0,
    orderSeq: 0,
    eventSeq: 0,
    leg: null,
    drill: null,
    phaseAt: 0,
    base: null,
    offset: 0,
    floor: 0,
    pausedGame: null,
    rng: 0,
    attempts: [],
    lastTick: null,
    podiumAt: null,
    rt: freshRuntime(),
  };
  s.phaseAt = env.now - s.offset;
  // Последний шаг цикла — от создания: на паузе (и после перезапуска) время игры стоит на нём.
  s.lastTick = s.phaseAt;
  for (const p of env.players) join(s, p, env);
  return s;
}

/** Вход в игру: в лобби — выбор экипажа (в командной сессии — по команде платформы); позже — дублёр, полноценно со следующего перелёта. */
export function join(s: BubState, p: { pid: string; name: string; team: string | null }, env: Env): void {
  registerTeams(s, env.teams.keys());
  if (p.team !== null) registerTeams(s, [p.team]);
  nameTeams(s, env.teams);
  const known = s.members[p.pid];
  if (known) {
    known.name = p.name;
    if (known.gone) {
      known.gone = false;
      if (s.teamsMode) known.team = p.team;
      rosterChanged(s);
      if (s.phase === "lobby" && s.teamsMode) {
        known.crew = teamCrewOf(s, p.team);
        rosterChanged(s);
      } else if (s.phase !== "lobby" && s.phase !== "podium" && s.phase !== "finished") seatLate(s, known, teamCrewOf(s, p.team) ?? known.crew, midLeg(s));
    }
    return;
  }
  const m = newMember(p.pid, p.name, s.joinSeq);
  s.joinSeq += 1;
  if (s.teamsMode) m.team = p.team;
  s.members[p.pid] = m;
  rosterChanged(s);
  if (s.phase === "lobby") {
    // Командная сессия: команда = экипаж (решение владельца 6 ноября 2026), сверх 10 в команде — дублёры при сборе.
    if (s.teamsMode) m.crew = teamCrewOf(s, p.team);
    rosterChanged(s);
  } else if (s.phase === "crews" || s.phase === "drill" || s.phase === "leg") {
    seatLate(s, m, teamCrewOf(s, p.team), midLeg(s));
  }
  s.rt.dirty.add(p.pid);
  env.changed();
}

/** Посреди перелёта (или тренировки) опоздавший — дублёр до следующей раздачи приборов. */
export function midLeg(s: BubState): boolean {
  return s.phase === "drill" || (s.phase === "leg" && (s.leg?.stage === "launch" || s.leg?.stage === "fly"));
}

// ------------------------------------------------------------------ связь

/** Сверка состава и связи: ушедшие из сессии, без связи (с какого момента), вернувшиеся после «Убрать». */
export function syncPresence(s: BubState, env: Env, now: number): void {
  // Команду переименовали на платформе — экипаж называется так же.
  if (s.teamsMode && nameTeams(s, env.teams)) {
    for (const pid of Object.keys(s.members)) s.rt.dirty.add(pid);
    env.changed();
  }
  const present = new Map(env.players.map((p) => [p.pid, p]));
  for (const m of Object.values(s.members)) {
    const p = present.get(m.pid);
    if (!p) {
      if (!m.gone) {
        m.gone = true;
        m.order = null;
        rosterChanged(s);
        env.changed();
      }
      continue;
    }
    if (m.gone) join(s, p, env);
    if (p.name !== m.name) m.name = p.name;
    if (s.teamsMode && (m.team ?? null) !== p.team) teamChanged(s, env, m, p.team);
    const online = env.online(m.pid);
    if (!online && m.offlineSince === null) {
      m.offlineSince = now;
      env.changed();
    } else if (online && m.offlineSince !== null) {
      m.offlineSince = null;
      if (m.role === "out") seatLate(s, m, m.crew, midLeg(s));
      s.rt.dirty.add(m.pid);
      env.changed();
    }
  }
}

/**
 * Командная сессия: гость сменил команду (или вошёл в неё) — пересадка в её экипаж (решение владельца 6 ноября 2026). В
 * лобби — выбор экипажа; посреди перелёта — дублёром до следующей раздачи; во время голосования — после него (голос и
 * кандидаты не меняются); на пьедестале — ничего. Экипажа у команды нет (появилась после сбора, сверх 20) — остаётся где был.
 */
function teamChanged(s: BubState, env: Env, m: Member, team: string | null): void {
  if (s.phase === "podium" || s.phase === "finished") return;
  if (s.phase === "leg" && s.leg?.stage === "vote") return;
  if (team !== null) registerTeams(s, [team]);
  m.team = team;
  const crew = teamCrewOf(s, team);
  if (s.phase === "lobby") {
    m.crew = crew;
    rosterChanged(s);
  } else if (crew !== null && crew !== m.crew && s.crews.some((c) => c.id === crew && !c.gone) && m.role !== "out") {
    moveMember(s, m, crew, midLeg(s));
    for (const pid of Object.keys(s.members)) s.rt.dirty.add(pid);
  }
  // Новая команда без экипажа (появилась после сбора) — там, где сидит этот гость.
  if (s.phase !== "lobby") adoptTeams(s);
  s.rt.dirty.add(m.pid);
  env.changed();
}

/** n экипажа: игроки на связи (без дублёров и убранных), не меньше 3. */
export function crewN(s: BubState, crew: number, env: Pick<Env, "online">): number {
  return Math.max(MIN_N, crewPlayers(s, crew).filter((p) => env.online(p.pid)).length);
}

/** Хозяин прибора на связи (ТЗ: хозяин пропал — приказ на его прибор снимается, новых на его приборы нет; дублёр не в счёт). */
function panelOnline(s: BubState, owner: string, env: Pick<Env, "online">): boolean {
  const m = s.members[owner];
  return m !== undefined && !m.gone && m.role === "player" && env.online(owner);
}

function receiverOk(m: Member, env: Pick<Env, "online">): boolean {
  return m.role === "player" && !m.gone && env.online(m.pid);
}

// ------------------------------------------------------------------ время приказа, импульс, урон

export function orderSeconds(s: BubState, legNo = s.legIndex, shift = s.leg?.shift ?? 0): number {
  const base = ORDER_SECONDS[s.content.difficulty][Math.min(2, Math.max(0, legNo))] ?? 12;
  return Math.max(ORDER_MIN_S, Math.min(ORDER_MAX_S, base + shift));
}

/** Импульс за выполненный приказ: Δ = 1000 ÷ (c × n), c = 7,5 × минуты перелёта. */
export function impulse(legMinutes: number, n: number): number {
  return DISTANCE_MAX / (C_PER_MINUTE * legMinutes * Math.max(MIN_N, n));
}

/** Урон за просрочку и выполненный ложный приказ: 4 ÷ n. */
export function orderDamage(n: number): number {
  return ORDER_DAMAGE / Math.max(MIN_N, n);
}

function damage(s: BubState, env: Env, crew: Crew, amount: number, now: number): void {
  if (s.phase !== "leg" || amount <= 0) return;
  crew.hull = Math.max(0, crew.hull - amount);
  if (crew.hull <= 1e-9 && crew.repair === null && crew.finishedAt === null) {
    crew.hull = 0;
    crew.repair = { startedAt: now, taps: 0, target: REPAIR_TAPS_PER_PERSON * crewN(s, crew.id, env), by: {} };
    for (const m of crewMembers(s, crew.id)) s.rt.dirty.add(m.pid);
  }
  env.changed();
}

function markCrew(s: BubState, crew: number): void {
  for (const m of crewMembers(s, crew)) s.rt.dirty.add(m.pid);
}

// ------------------------------------------------------------------ приказы

function crewControls(s: BubState): Map<number, Control[]> {
  const by = new Map<number, Control[]>();
  for (const c of Object.values(s.controls)) {
    const list = by.get(c.crew);
    if (list) list.push(c);
    else by.set(c.crew, [c]);
  }
  return by;
}

/** Начало удержания в нужном положении: не раньше выдачи приказа; движения в первые 0,7 с «Глюка» не считаются. */
function holdFrom(s: BubState, ctl: Control, order: Order): number | null {
  if (ctl.movedAt < 0) return null;
  let from = Math.max(ctl.movedAt, order.issuedAt);
  const g = s.leg?.glitch?.startedAt ?? null;
  if (g !== null && ctl.movedAt >= g && ctl.movedAt < g + GLITCH_GUARD_MS) from = Math.max(from, g + GLITCH_GUARD_MS);
  return from;
}

function inGlitchGuard(s: BubState, t: number): boolean {
  const g = s.leg?.glitch?.startedAt ?? null;
  return g !== null && t >= g && t < g + GLITCH_GUARD_MS;
}

/** Выбор прибора для приказа (ТЗ, «Как выдаётся приказ»). Экспорт — для теста 80/20. */
export function chooseControl(candidates: Control[], receiver: string, lastControl: string | null, rand: () => number): Control | null {
  let cands = candidates;
  if (cands.length > 1 && lastControl !== null) cands = cands.filter((c) => c.id !== lastControl);
  const own = cands.filter((c) => c.owner === receiver);
  const foreign = cands.filter((c) => c.owner !== receiver);
  let bucket = rand() < FOREIGN_SHARE ? foreign : own;
  if (bucket.length === 0) bucket = bucket === foreign ? own : foreign;
  if (bucket.length === 0) return null;
  // Предпочтение тем, о которых давно не было приказа: случайный из старшей половины.
  const sorted = [...bucket].sort((a, b) => a.lastOrder - b.lastOrder);
  const k = Math.max(1, Math.ceil(sorted.length / 2));
  return sorted[Math.floor(rand() * k)] ?? sorted[0] ?? null;
}

function send(s: BubState, env: Env, pid: string, data: Record<string, unknown>): void {
  env.send(pid, data);
  s.rt.dirty.add(pid);
}

function issue(s: BubState, env: Env, crew: Crew, m: Member, controls: Control[], busy: Set<string>, now: number, drill: boolean): void {
  const rand = randomOf(s, env);
  const cands = controls.filter((c) => !busy.has(c.id) && panelOnline(s, c.owner, env));
  const ctl = chooseControl(cands, m.pid, m.lastControl, rand);
  if (!ctl) return;
  const target = randomTarget(ctl, rand);
  const fake = !drill && crew.saboteur === m.pid && rand() < FAKE_SHARE;
  const seconds = drill ? orderSeconds(s, 0, 0) : orderSeconds(s);
  const order: Order = {
    id: `o${s.orderSeq}`,
    control: ctl.id,
    target,
    text: orderText(ctl, target, s.content.difficulty === "kids"),
    issuedAt: now,
    issuedClock: crew.clock,
    due: crew.clock + seconds * 1000,
    fake,
    penalizedAt: null,
  };
  s.orderSeq += 1;
  m.order = order;
  busy.add(ctl.id);
  s.rt.dirty.add(m.pid);
}

/** Приказ снят без штрафа; у «хозяин прибора пропал» — его имя для телефона («Костя пропал со связи»). */
function cancel(s: BubState, env: Env, crew: Crew, m: Member, reason: string, who?: string): void {
  const order = m.order;
  if (!order) return;
  m.order = null;
  m.nextAt = crew.clock + NEXT_AFTER_FAIL_MS;
  send(s, env, m.pid, who ? { t: "cancel", order: order.id, reason, who } : { t: "cancel", order: order.id, reason });
}

function complete(s: BubState, env: Env, crew: Crew, m: Member, ctl: Control, now: number, drill: boolean): void {
  const order = m.order;
  if (!order) return;
  m.order = null;
  m.nextAt = crew.clock + NEXT_AFTER_DONE_MS;
  m.lastControl = ctl.id;
  ctl.lastOrder = crew.clock;
  crew.okSeq += 1;
  const mover = ctl.by !== null ? s.members[ctl.by] : undefined;
  if (!drill) {
    m.done += 1;
    m.legDone += 1;
    if (mover) mover.moved += 1;
    crew.done += 1;
    crew.streak += 1;
    crew.bestStreak = Math.max(crew.bestStreak, crew.streak);
    const n = crewN(s, crew.id, env);
    if (order.fake) {
      // Ложный приказ выглядит как обычный: та же «✓», но корабль теряет прочность.
      crew.fakeDone += 1;
      damage(s, env, crew, orderDamage(n), now);
    } else {
      const delta = impulse(s.content.legMinutes, n);
      crew.dist = Math.min(DISTANCE_MAX, crew.dist + delta);
      crew.impulses.push(now, delta);
      if (crew.dist >= DISTANCE_MAX - 1e-9) finishCrew(s, env, crew);
    }
  }
  send(s, env, m.pid, { t: "done", order: order.id });
  if (mover && mover.pid !== m.pid) send(s, env, mover.pid, { t: "done", order: order.id, helped: true });
  env.changed();
}

function expire(s: BubState, env: Env, crew: Crew, m: Member, now: number, drill: boolean): void {
  const order = m.order;
  if (!order) return;
  m.order = null;
  m.nextAt = crew.clock + NEXT_AFTER_FAIL_MS;
  const ctl = s.controls[order.control];
  if (ctl) ctl.lastOrder = crew.clock;
  m.lastControl = order.control;
  if (order.fake && !drill) {
    // Невыполненный ложный приказ (решение владельца 6 ноября 2026, как в ТЗ): просто исчезает — без рывка корабля,
    // без просрочки и без сброса серии; на телефоне диверсанта — как снятый.
    send(s, env, m.pid, { t: "cancel", order: order.id, reason: "expired" });
    env.changed();
    return;
  }
  crew.failSeq += 1;
  if (!drill) {
    crew.failed += 1;
    crew.streak = 0;
    damage(s, env, crew, orderDamage(crewN(s, crew.id, env)), now);
  }
  send(s, env, m.pid, { t: "fail", order: order.id });
  env.changed();
}

function finishCrew(s: BubState, env: Env, crew: Crew): void {
  if (!s.leg || crew.finishedAt !== null) return;
  crew.dist = DISTANCE_MAX;
  crew.finishedAt = s.leg.flight;
  crew.repair = null;
  for (const m of crewMembers(s, crew.id)) {
    if (m.order) m.order = null;
    send(s, env, m.pid, { t: "finish" });
  }
  env.checkpoint();
  env.changed();
}

/** Приказы всех экипажей за шаг цикла: отмены (без связи), выполнение (0,7 с в нужном положении), сгорание, просрочка, новые. */
export function runOrders(s: BubState, env: Env, now: number, drill: boolean, eventActive: boolean): void {
  const byCrew = crewControls(s);
  for (const crew of liveCrews(s)) {
    if (crew.finishedAt !== null) continue;
    const players = crewPlayers(s, crew.id);
    const controls = byCrew.get(crew.id) ?? [];
    for (const m of players) {
      if (!m.order) continue;
      const ctl = s.controls[m.order.control];
      if (!ctl) cancel(s, env, crew, m, "control");
      else if (!panelOnline(s, ctl.owner, env)) cancel(s, env, crew, m, "owner", s.members[ctl.owner]?.name);
    }
    // Убранные и ушедшие тоже теряют приказ (без сообщения — их телефона нет).
    for (const m of crewMembers(s, crew.id)) if (m.order && !receiverOk(m, env)) {
      m.order = null;
      m.nextAt = crew.clock + NEXT_AFTER_FAIL_MS;
    }
    // Во время события и ремонта приказы стоят: часы экипажа не идут, ничего не засчитывается и не сгорает.
    if (!drill && (eventActive || crew.repair !== null)) continue;
    for (const m of players) {
      const order = m.order;
      if (!order) continue;
      const ctl = s.controls[order.control];
      if (!ctl) continue;
      if (ctl.type === "button") {
        if (ctl.movedAt >= order.issuedAt && !inGlitchGuard(s, ctl.movedAt)) {
          complete(s, env, crew, m, ctl, now, drill);
          continue;
        }
      } else if (ctl.state === order.target) {
        const from = holdFrom(s, ctl, order);
        if (from !== null && now - from >= HOLD_MS) {
          complete(s, env, crew, m, ctl, now, drill);
          continue;
        }
        // Стоит на цели и держится — срок не сгорает, пока идёт удержание.
        continue;
      } else if (ctl.movedAt >= order.issuedAt && now - ctl.movedAt >= HOLD_MS && order.penalizedAt !== ctl.movedAt && !inGlitchGuard(s, ctl.movedAt)) {
        // Остановился в неверном положении — у приказа сгорает 2 секунды (один раз за эту остановку).
        order.due -= WRONG_STOP_MS;
        order.penalizedAt = ctl.movedAt;
        s.rt.dirty.add(m.pid);
      }
      if (crew.clock >= order.due) expire(s, env, crew, m, now, drill);
    }
    if (crew.finishedAt !== null || crew.repair !== null) continue;
    const busy = new Set(players.map((p) => p.order?.control).filter((c): c is string => typeof c === "string"));
    for (const m of players) {
      if (m.order || !receiverOk(m, env) || crew.clock < m.nextAt) continue;
      issue(s, env, crew, m, controls, busy, now, drill);
    }
  }
}

// ------------------------------------------------------------------ фазы

function resetCrewLeg(c: Crew): void {
  c.hull = HULL_MAX;
  c.repair = null;
  c.clock = 0;
  c.dist = 0;
  c.finishedAt = null;
  c.bonus = { meteor: 0, sos: 0, captain: {}, finish: 0 };
  c.streak = 0;
  c.bestStreak = 0;
  c.done = 0;
  c.failed = 0;
  c.fakeDone = 0;
  c.impulses = [];
  c.saboteur = null;
  c.shield = null;
  c.legShield = 0;
  c.pull = null;
  c.sos = null;
}

/** Раздача приборов на перелёт (или тренировку): опоздавшие становятся игроками, убранные приборов не получают. */
function deal(s: BubState, env: Env, legNo: number, drill: boolean): void {
  const rand = randomOf(s, env);
  assignAllRoles(s, false);
  const crews = liveCrews(s).map((c) => ({ id: c.id, players: crewPlayers(s, c.id).map((p) => p.pid) }));
  const result = dealPanels({
    theme: s.content.theme,
    difficulty: s.content.difficulty,
    legNo,
    drill,
    crews,
    crewNames: s.crews.map((c) => c.name),
    customNames: s.content.names,
    rand,
    nextId: () => {
      const id = `c${s.ctlSeq}`;
      s.ctlSeq += 1;
      return id;
    },
  });
  s.controls = Object.fromEntries(result.controls.map((c) => [c.id, c]));
  for (const m of Object.values(s.members)) {
    m.panel = m.role === "player" ? (result.panels[m.pid] ?? []) : [];
    m.order = null;
    m.lastControl = null;
    m.nextAt = Math.floor(rand() * 1000);
    m.legDone = 0;
    m.vote = null;
    m.roleSeen = false;
    s.rt.dirty.add(m.pid);
  }
}

/** Расписание событий перелёта: 2–3 из включённых (кроме «Все на палубу!»), не в первые 30 и последние 20 с, между — от 30 с. */
export function scheduleEvents(content: BubContent, duration: number, rand: () => number): Array<{ at: number; kind: EventKind }> {
  const pool = (["meteor", "pull", "sos"] as const).filter((k) => content.events[k]);
  if (pool.length === 0) return [];
  let count = rand() < 0.5 ? 2 : 3;
  const lo = EVENT_EDGE_START_MS;
  const hi = duration - EVENT_EDGE_END_MS;
  while (count > 0 && hi - lo < (count - 1) * EVENT_GAP_MS) count -= 1;
  const kinds: EventKind[] = shuffle(pool, rand);
  while (kinds.length < count) kinds.push(pool[Math.floor(rand() * pool.length)] ?? "meteor");
  const span = hi - lo - (count - 1) * EVENT_GAP_MS;
  const offsets = Array.from({ length: count }, () => Math.floor(rand() * (span + 1))).sort((a, b) => a - b);
  return offsets.map((u, i) => ({ at: lo + u + i * EVENT_GAP_MS, kind: kinds[i] ?? "meteor" }));
}

function startLeg(s: BubState, env: Env, index: number, now: number): void {
  const rand = randomOf(s, env);
  s.legIndex = index;
  s.attempts[index] = (s.attempts[index] ?? 0) + 1;
  s.phase = "leg";
  s.drill = null;
  s.phaseAt = now;
  for (const c of liveCrews(s)) resetCrewLeg(c);
  deal(s, env, index, false);
  let saboteurs = false;
  if (s.content.saboteur) {
    for (const c of liveCrews(s)) {
      const players = crewPlayers(s, c.id);
      if (players.length < SABOTEUR_MIN_CREW) continue;
      c.saboteur = players[Math.floor(rand() * players.length)]?.pid ?? null;
      saboteurs = saboteurs || c.saboteur !== null;
    }
  }
  const duration = s.content.legMinutes * 60_000;
  const effectAt = () => EFFECT_EDGE_MS + Math.floor(rand() * Math.max(1, duration - 2 * EFFECT_EDGE_MS));
  s.leg = {
    index,
    attempt: s.attempts[index] ?? 1,
    stage: "launch",
    launchEnds: now + LAUNCH_MS,
    flight: 0,
    duration,
    shift: 0,
    schedule: scheduleEvents(s.content, duration, rand),
    event: null,
    lastEventEnd: null,
    history: [],
    glitch: index === 1 ? { at: effectAt(), startedAt: null } : null,
    flip: index === 2 && s.content.difficulty !== "kids" ? { at: effectAt(), startedAt: null } : null,
    roster: Object.fromEntries(activeMembers(s).filter((m) => m.role === "player" && m.crew !== null).map((m) => [m.pid, m.crew as number])),
    dockAt: null,
    voteEnds: null,
    vote: null,
    ratings: {},
    saboteurs,
  };
  env.checkpoint();
  env.changed();
}

/** Состояние без служебного (для снимка и «Назад»). */
export function persist(s: BubState): Omit<BubState, "rt"> {
  const { rt: _rt, ...rest } = s;
  void _rt;
  return rest;
}

/**
 * Точка «Назад — переиграть перелёт»: состояние до старта перелёта без того, что раздаётся заново при старте (приборы,
 * пульты, приказы) — так снимок комнаты на 500 гостей не вырастает вдвое.
 */
function saveBase(s: BubState): void {
  const { members, ...rest } = persist(s);
  const lean: Record<string, Member> = {};
  for (const [pid, m] of Object.entries(members)) lean[pid] = { ...m, panel: [], order: null, lastControl: null };
  // Старт из «Тренировки»: точка «Назад» — «Экипажи собраны» (приборы тренировки в точке не хранятся, и вернуться в
  // тренировку без приборов было бы тупиком; ревью 6 ноября 2026). Тренировку ведущий может запустить снова.
  const fromDrill = rest.phase === "drill";
  s.base = JSON.stringify({ ...rest, ...(fromDrill ? { phase: "crews", drill: null } : {}), members: lean, controls: {}, base: null });
}

/** Итог перелёта экипажа: «За приказы» + «Финиш раньше» + «События» = «За перелёт». */
export function legResultOf(s: BubState, crew: Crew): Omit<LegResult, "place" | "first"> {
  const leg = s.leg;
  const duration = leg?.duration ?? s.content.legMinutes * 60_000;
  const orders = Math.round(crew.dist);
  const finish = crew.finishedAt !== null ? FINISH_BONUS_PER_S * Math.floor(Math.max(0, duration - crew.finishedAt) / 1000) : 0;
  const captain = Object.values(crew.bonus.captain).reduce((a, b) => a + b, 0);
  const events = crew.bonus.meteor + crew.bonus.sos + captain;
  const players = crewPlayers(s, crew.id);
  let best: LegResult["best"] = null;
  for (const p of players) if (p.legDone > 0 && (!best || p.legDone > best.done)) best = { pid: p.pid, name: p.name, done: p.legDone };
  return { leg: leg?.index ?? s.legIndex, orders, finish, events, total: orders + finish + events, streak: crew.bestStreak, best, shield: Math.round(crew.legShield), done: crew.done };
}

/** Места при равных очках общие: 10, 10, 7 → 1, 1, 3. */
export function places<T>(items: T[], score: (x: T) => number): Map<T, number> {
  const sorted = [...items].sort((a, b) => score(b) - score(a));
  const out = new Map<T, number>();
  sorted.forEach((x, i) => {
    const prev = sorted[i - 1];
    out.set(x, prev !== undefined && score(prev) === score(x) ? (out.get(prev) ?? i + 1) : i + 1);
  });
  return out;
}

/** Пересчёт итогов текущего перелёта (на «Привале» и после оценок «Все на палубу!»). */
function refreshLegResults(s: BubState): void {
  const leg = s.leg;
  if (!leg) return;
  const crews = liveCrews(s);
  const results = new Map(crews.map((c) => [c, legResultOf(s, c)]));
  const placeOf = places(crews, (c) => results.get(c)?.total ?? 0);
  const finished = crews.filter((c) => c.finishedAt !== null).map((c) => c.finishedAt ?? Infinity);
  const firstAt = finished.length > 0 ? Math.min(...finished) : null;
  for (const c of crews) {
    const r = results.get(c);
    if (!r) continue;
    c.legs[leg.index] = { ...r, place: placeOf.get(c) ?? 1, first: firstAt !== null && c.finishedAt === firstAt };
  }
}

function endLeg(s: BubState, env: Env, now: number): void {
  const leg = s.leg;
  if (!leg) return;
  leg.stage = "dock";
  leg.dockAt = now;
  leg.event = null;
  leg.schedule = [];
  for (const m of Object.values(s.members)) {
    m.order = null;
    s.rt.dirty.add(m.pid);
  }
  for (const c of liveCrews(s)) {
    c.repair = null;
    c.pull = null;
    c.sos = null;
    c.shield = null;
  }
  refreshLegResults(s);
  env.checkpoint();
  env.changed();
}

function openVote(s: BubState, env: Env, now: number): void {
  const leg = s.leg;
  if (!leg) return;
  leg.stage = "vote";
  leg.voteEnds = now + VOTE_MS;
  for (const m of Object.values(s.members)) {
    m.vote = null;
    s.rt.dirty.add(m.pid);
  }
  env.changed();
}

/** Экипаж, в котором человек голосует: где он был на старте перелёта (пересадка на «Привале» этого не меняет). */
export function voteCrewOf(s: BubState, m: Member): number | null {
  const at = s.leg?.roster?.[m.pid];
  return at !== undefined ? at : m.crew;
}

/** Кандидаты голосования экипажа: игроки этого экипажа на старте перелёта (у кого были приборы), кто ещё в игре. */
export function voteCandidates(s: BubState, crew: number): Member[] {
  const roster = s.leg?.roster;
  if (!roster) return crewMembers(s, crew).filter((m) => m.panel.length > 0);
  return activeMembers(s).filter((m) => roster[m.pid] === crew);
}

/** Кто голосует за экипаж: в игре и по экипажу на старте перелёта (опоздавшие — по своему экипажу). */
export function voteVoters(s: BubState, crew: number): Member[] {
  return activeMembers(s).filter((m) => m.role !== "out" && voteCrewOf(s, m) === crew);
}

/** Итог «Кто диверсант?»: голос диверсанта не считается; поровну — не угадали; угадали — +50 экипажу, иначе диверсанту лента. */
export function tallyVote(s: BubState, crew: Crew): VoteResult | null {
  const sab = crew.saboteur;
  if (sab === null) return null;
  const candidates = new Set(voteCandidates(s, crew.id).map((m) => m.pid));
  const votes: Record<string, number> = {};
  for (const m of voteVoters(s, crew.id)) {
    if (m.pid === sab || m.vote === null || m.vote === m.pid || !candidates.has(m.vote)) continue;
    votes[m.vote] = (votes[m.vote] ?? 0) + 1;
  }
  const top = Math.max(0, ...Object.values(votes));
  const leaders = Object.keys(votes).filter((pid) => votes[pid] === top);
  const guessed = top > 0 && leaders.length === 1 && leaders[0] === sab;
  return { crew: crew.id, saboteur: sab, name: s.members[sab]?.name ?? "", guessed, votes, fakes: crew.fakeDone };
}

function closeVote(s: BubState, env: Env): void {
  const leg = s.leg;
  if (!leg) return;
  const results: VoteResult[] = [];
  for (const c of liveCrews(s)) {
    const r = tallyVote(s, c);
    if (!r) continue;
    results.push(r);
    if (r.guessed) {
      c.voteBonus += VOTE_BONUS;
      c.guessed += 1;
    } else {
      const sab = s.members[r.saboteur];
      if (sab) sab.ribbons += 1;
    }
  }
  leg.vote = results;
  leg.stage = "voted";
  leg.voteEnds = null;
  for (const m of Object.values(s.members)) s.rt.dirty.add(m.pid);
  env.checkpoint();
  env.changed();
}

/** Счётчики итоговой карточки только из своих перелётов (без влитых). */
function ownStats(c: Crew): CardStats {
  return {
    orders: c.legs.reduce((a, r) => a + (r?.done ?? 0), 0),
    firsts: c.legs.filter((r) => r?.first === true).length,
    legs: c.legs.filter((r) => r !== undefined && r !== null).length,
    shield: Math.max(0, ...c.legs.map((r) => r?.shield ?? 0)),
  };
}

/** Влитые экипажи летели те же перелёты рядом: приказы и первые финиши складываются, перелёты и щит — лучшее. */
function joinCardStats(a: CardStats, b: CardStats | undefined): CardStats {
  if (!b) return a;
  return { orders: a.orders + b.orders, firsts: a.firsts + b.firsts, legs: Math.max(a.legs, b.legs), shield: Math.max(a.shield, b.shield) };
}

/** Счётчики итоговой карточки экипажа вместе с влитыми в него — сходятся с `crewTotal`. */
export function cardStats(c: Crew): CardStats {
  return joinCardStats(ownStats(c), c.mergedStats);
}

/** Общий счёт: перелёты + угаданные диверсанты + очки влитых экипажей (решение владельца 6 ноября 2026). */
export function crewTotal(c: Crew): number {
  return c.legs.reduce((a, r) => a + (r?.total ?? 0), 0) + c.voteBonus + (c.merged ?? 0);
}

// ------------------------------------------------------------------ события

function newEvent(s: BubState, kind: EventKind, now: number, manual: boolean, task?: string): EventState {
  const id = `e${s.eventSeq}`;
  s.eventSeq += 1;
  const ev: EventState = { id, kind, warnAt: now, startAt: now + WARN_MS, endAt: now + WARN_MS + EVENT_MS[kind], started: false, manual, crews: [] };
  if (task !== undefined) ev.task = task;
  if (kind === "meteor") ev.power = {};
  if (kind === "pull") ev.holds = {};
  return ev;
}

function warnEvent(s: BubState, env: Env, kind: EventKind, now: number, manual: boolean, task?: string): EventState | null {
  const leg = s.leg;
  if (!leg || leg.event) return null;
  const ev = newEvent(s, kind, now, manual, task);
  if (kind === "sos") {
    const rand = randomOf(s, env);
    const len = SOS_LENGTH[Math.min(2, leg.index)] ?? 4;
    ev.seq = Array.from({ length: len }, () => Math.floor(rand() * SOS_COLORS));
  }
  leg.event = ev;
  for (const m of Object.values(s.members)) s.rt.dirty.add(m.pid);
  env.changed();
  return ev;
}

/** Событие началось: участники — экипажи не у цели и не на ремонте (ремонт событие пропускает без штрафа). */
function startEvent(s: BubState, env: Env, ev: EventState): void {
  ev.started = true;
  ev.crews = liveCrews(s)
    .filter((c) => c.finishedAt === null && c.repair === null && crewMembers(s, c.id).length > 0)
    .map((c) => c.id);
  for (const id of ev.crews) {
    const c = s.crews.find((x) => x.id === id);
    if (!c) continue;
    if (ev.kind === "pull") c.pull = { holdStart: null, escaped: false, failed: false };
    if (ev.kind === "sos") c.sos = { progress: 0, blockedUntil: -1, done: false, attempt: 0 };
    if (ev.kind === "meteor") c.shield = 0;
  }
  for (const m of Object.values(s.members)) s.rt.dirty.add(m.pid);
  env.checkpoint();
  env.changed();
}

/**
 * Потолок силы к моменту `at`: 100 × (время от начала дождя ÷ 10 с). Применяется при подсчёте (`meteorPower`): сообщение
 * «100» в начале дождя к концу дождя даст не больше, чем честная тряска все 10 с. Сама сила — накопленная телефоном
 * (`ShakeMeter`: 10 с энергичной тряски = 100, один рывок — почти ничего); сервер хранит наибольшую присланную.
 */
export function meteorCap(ev: EventState, at: number): number {
  return METEOR_REF * Math.max(0, Math.min(1, (at - ev.startAt) / EVENT_MS.meteor));
}

/** Сила одного: тряска или нажатия (без датчика 6 в секунду = 100), не больше эталона и не быстрее его роста. */
export function meteorPower(ev: EventState, pid: string, now: number): number {
  const p = ev.power?.[pid];
  if (!p) return 0;
  const tapsRef = METEOR_TAPS_REF_PER_S * (EVENT_MS.meteor / 1000);
  return Math.min(METEOR_REF, meteorCap(ev, now), Math.max(p.shake, (p.taps / tapsRef) * METEOR_REF));
}

/** Щит экипажа: средняя сила на человека ÷ эталон × 100, не больше 100. */
export function meteorShield(s: BubState, ev: EventState, crew: number, online: (pid: string) => boolean, now: number): number {
  const power = ev.power ?? {};
  let count = 0;
  let sum = 0;
  for (const m of crewMembers(s, crew)) {
    if (m.role === "out" || !(online(m.pid) || power[m.pid] !== undefined)) continue;
    count += 1;
    sum += meteorPower(ev, m.pid, now);
  }
  if (count === 0) return 0;
  return Math.min(100, ((sum / count) / METEOR_REF) * 100);
}

function eventCrews(s: BubState, ev: EventState): Crew[] {
  return ev.crews.map((id) => s.crews.find((c) => c.id === id)).filter((c): c is Crew => c !== undefined && !c.gone);
}

/** Шаг события: «Притяжение» (все держат 3 с, иначе сносит назад), щиты дождя, досрочный конец. */
function eventTick(s: BubState, env: Env, ev: EventState, now: number, dt: number): void {
  const crews = eventCrews(s, ev);
  if (ev.kind === "pull") {
    for (const c of crews) {
      const pull = c.pull;
      if (!pull || pull.escaped || pull.failed) continue;
      const required = crewPlayers(s, c.id).filter((p) => env.online(p.pid));
      const holds = ev.holds ?? {};
      const all = required.length > 0 && required.every((p) => holds[p.pid]?.on === true);
      if (all) {
        const since = Math.max(ev.startAt, ...required.map((p) => holds[p.pid]?.at ?? ev.startAt));
        if (pull.holdStart === null) pull.holdStart = since;
        if (now - pull.holdStart >= PULL_HOLD_MS) {
          pull.escaped = true;
          markCrew(s, c.id);
          env.checkpoint();
        }
      } else if (pull.holdStart !== null) {
        pull.holdStart = null;
        markCrew(s, c.id);
      }
      if (!pull.escaped) c.dist = Math.max(0, c.dist - (PULL_DRIFT_PER_S * dt) / 1000);
    }
  } else if (ev.kind === "meteor") {
    for (const c of crews) c.shield = meteorShield(s, ev, c.id, (pid: string) => env.online(pid), now);
  }
  const resolved =
    (ev.kind === "pull" && crews.every((c) => c.pull?.escaped === true)) || (ev.kind === "sos" && crews.every((c) => c.sos?.done === true));
  if (crews.length === 0 || resolved || now >= ev.endAt) endEvent(s, env, now, false);
}

/** Конец события: итоги вида; ведущий закончил раньше — без урона. Следующее по расписанию — не раньше чем через 30 с полёта. */
export function endEvent(s: BubState, env: Env, now: number, byHost: boolean): void {
  const leg = s.leg;
  const ev = leg?.event;
  if (!leg || !ev) return;
  const crews = ev.started ? eventCrews(s, ev) : [];
  const kids = s.content.difficulty === "kids";
  if (ev.kind === "meteor" && ev.started) {
    const shields = new Map(crews.map((c) => [c, meteorShield(s, ev, c.id, (pid: string) => env.online(pid), now)]));
    const best = Math.max(0, ...shields.values());
    for (const [c, shield] of shields) {
      c.legShield = Math.max(c.legShield, shield);
      if (!kids && !byHost) damage(s, env, c, shield < METEOR_BAD ? 2 : shield < METEOR_WEAK ? 1 : 0, now);
      if (best > 0 && shield === best) c.bonus.meteor += METEOR_BONUS;
      c.shield = null;
    }
  }
  if (ev.kind === "pull") {
    for (const c of crews) {
      if (c.pull && !c.pull.escaped && !byHost) {
        c.pull.failed = true;
        damage(s, env, c, 1, now);
      }
      c.pull = null;
    }
  }
  if (ev.kind === "sos") for (const c of crews) c.sos = null;
  if (ev.started) {
    const item: { id: string; kind: EventKind; task?: string } = { id: ev.id, kind: ev.kind };
    if (ev.task !== undefined) item.task = ev.task;
    leg.history.push(item);
    leg.lastEventEnd = leg.flight;
  }
  leg.event = null;
  // Следующее — не раньше чем через 30 с полёта и не в последние 20 с.
  let prev = leg.flight;
  leg.schedule = leg.schedule
    .map((e) => {
      const at = Math.max(e.at, prev + EVENT_GAP_MS);
      prev = at;
      return { ...e, at };
    })
    .filter((e) => e.at <= leg.duration - EVENT_EDGE_END_MS);
  for (const m of Object.values(s.members)) s.rt.dirty.add(m.pid);
  env.checkpoint();
  env.changed();
}

// ------------------------------------------------------------------ шаг цикла

function allFinished(s: BubState): boolean {
  const crews = liveCrews(s).filter((c) => crewPlayers(s, c.id).length > 0);
  return crews.length > 0 && crews.every((c) => c.finishedAt !== null);
}

function flyTick(s: BubState, env: Env, now: number, dt: number): void {
  const leg = s.leg;
  if (!leg) return;
  const pending = leg.event;
  if (pending && !pending.started && now >= pending.startAt) startEvent(s, env, pending);
  const active = leg.event?.started === true;
  if (!active) leg.flight = Math.min(leg.duration, leg.flight + dt);
  const next = leg.schedule[0];
  if (!leg.event && next && leg.flight >= next.at - WARN_MS) {
    leg.schedule.shift();
    if (!allFinished(s)) warnEvent(s, env, next.kind, now, false);
  }
  if (leg.glitch && leg.glitch.startedAt === null && leg.flight >= leg.glitch.at) {
    const rand = randomOf(s, env);
    // «Глюк»: плитки на всех телефонах меняются местами (приборы и названия прежние).
    leg.glitch.startedAt = now;
    for (const m of Object.values(s.members)) {
      if (m.panel.length > 1) {
        const before = m.panel.join();
        let next2 = shuffle(m.panel, rand);
        for (let i = 0; i < 4 && next2.join() === before; i += 1) next2 = shuffle(m.panel, rand);
        if (next2.join() === before) next2 = [...m.panel.slice(1), ...m.panel.slice(0, 1)];
        m.panel = next2;
      }
      s.rt.dirty.add(m.pid);
    }
    env.checkpoint();
  }
  if (leg.flip && leg.flip.startedAt === null && leg.flight >= leg.flip.at) {
    leg.flip.startedAt = now;
    for (const m of Object.values(s.members)) s.rt.dirty.add(m.pid);
  }
  for (const c of liveCrews(s)) {
    if (c.repair && (now - c.repair.startedAt >= REPAIR_MS || (c.repair.taps >= c.repair.target && now - c.repair.startedAt >= REPAIR_MIN_MS))) {
      c.repair = null;
      c.hull = HULL_AFTER_REPAIR;
      markCrew(s, c.id);
      env.checkpoint();
    }
    if (c.finishedAt === null && !active && c.repair === null) c.clock += dt;
    // Скорость — импульсы за последние 10 секунд.
    while (c.impulses.length > 0 && (c.impulses[0] ?? 0) < now - SPEED_WINDOW_MS) c.impulses.splice(0, 2);
  }
  runOrders(s, env, now, false, active);
  const ev = leg.event;
  if (ev?.started) eventTick(s, env, ev, now, dt);
  if (s.leg?.stage === "fly" && ((leg.flight >= leg.duration && !leg.event?.started) || allFinished(s))) endLeg(s, env, now);
  env.changed();
}

/** Шаг общего цикла комнаты (100 мс; на паузе не вызывается). */
export function tick(s: BubState, env: Env): void {
  const now = gameNow(s, env);
  const dt = s.lastTick === null ? 0 : Math.max(0, Math.min(1000, now - s.lastTick));
  s.lastTick = now;
  syncPresence(s, env, now);
  if (s.phase === "drill" && s.drill) {
    if (!s.drill.over) {
      if (now >= s.drill.endsAt) {
        s.drill.over = true;
        for (const m of Object.values(s.members)) {
          m.order = null;
          s.rt.dirty.add(m.pid);
        }
        env.changed();
      } else {
        for (const c of liveCrews(s)) c.clock += dt;
        runOrders(s, env, now, true, false);
      }
    }
  } else if (s.phase === "leg" && s.leg) {
    const leg = s.leg;
    if (leg.stage === "launch" && now >= leg.launchEnds) {
      leg.stage = "fly";
      s.phaseAt = now;
      for (const m of Object.values(s.members)) s.rt.dirty.add(m.pid);
      env.changed();
    }
    if (leg.stage === "fly") flyTick(s, env, now, dt);
    // Голосование открывается само через 10 с «Привала» (решение владельца 6 ноября 2026); ведущий может раньше.
    else if (leg.stage === "dock" && leg.saboteurs && leg.vote === null && leg.dockAt !== null && now >= leg.dockAt + DOCK_MS) openVote(s, env, now);
    else if (leg.stage === "vote" && leg.voteEnds !== null && now >= leg.voteEnds) closeVote(s, env);
  }
}

// ------------------------------------------------------------------ события телефонов

function sameCrewEvent(s: BubState, m: Member): EventState | null {
  const ev = s.leg?.event;
  if (!ev || m.crew === null || s.phase !== "leg" || s.leg?.stage !== "fly") return null;
  return ev;
}

/**
 * Пачка телефона. Ответ — было ли в ней игровое действие, которое игра приняла (прибор сдвинут, тап ремонта или дождя, тряска,
 * «Тяга», нажатие SOS, голос, выбор экипажа, салют): по нему комната отмечает «телефон играл в перелёте» (`room_play`, баллы
 * ведущему). Мусор (`{ t: "zzz" }`), чужой прибор, то же положение, тап без ремонта и дождя, «роль увидел» — не в счёт
 * (проверка 2d, №4).
 */
export function input(s: BubState, pid: string, events: InEvent[], env: Env): boolean {
  const m = s.members[pid];
  if (!m || m.gone) return false;
  let played = false;
  for (const e of events) {
    const at = eventTime(s, env, e);
    switch (e.t) {
      case "crew":
        if (chooseCrew(s, env, m, e.crew)) played = true;
        break;
      case "move":
        if (moveControl(s, m, e, at, claimedTime(s, env, e))) played = true;
        break;
      case "tap":
        if (tapEvent(s, m, e, at)) played = true;
        break;
      case "shake": {
        const ev = sameCrewEvent(s, m);
        if (!ev || ev.kind !== "meteor" || !ev.started || m.crew === null || !ev.crews.includes(m.crew) || !ev.power) break;
        // Храним наибольшую присланную силу (не больше эталона): телефон шлёт накопленную за дождь (`ShakeMeter`), а
        // «не быстрее эталона» — при подсчёте (`meteorPower` по текущему времени).
        const p = typeof e.p === "number" && Number.isFinite(e.p) ? Math.max(0, Math.min(METEOR_REF, e.p)) : 0;
        const prev = ev.power[m.pid] ?? { shake: 0, taps: 0 };
        // Сводка тряски — накопленная за событие: берём наибольшую.
        ev.power[m.pid] = { shake: Math.max(prev.shake, p), taps: prev.taps };
        s.rt.dirty.add(m.pid);
        if (p > 0) played = true;
        break;
      }
      case "hold": {
        const ev = sameCrewEvent(s, m);
        if (!ev || ev.kind !== "pull" || !ev.holds || now(s, env) >= ev.endAt) break;
        const prev = ev.holds[m.pid];
        if (prev && at < prev.at) break;
        ev.holds[m.pid] = { on: e.on === true, at };
        markCrew(s, m.crew ?? -1);
        played = true;
        break;
      }
      case "sos":
        if (sosInput(s, env, m, e, at)) played = true;
        break;
      case "vote":
        if (castVote(s, m, e.pid)) played = true;
        break;
      case "salute": {
        const crew = s.crews.find((c) => c.id === m.crew);
        if (!crew || crew.finishedAt === null || s.phase !== "leg") break;
        const n = bucketTake(s.rt.taps, m.pid, TAPS_BURST, TAPS_PER_SECOND, at, count(e.n));
        crew.salutes += n;
        if (n > 0) played = true;
        break;
      }
      case "role-ok":
        // «Роль увидел» — не игровое действие.
        m.roleSeen = true;
        s.rt.dirty.add(m.pid);
        break;
      default:
        break;
    }
  }
  env.changed();
  return played;
}

function now(s: BubState, env: Pick<Env, "now" | "paused">): number {
  return gameNow(s, env);
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(TAPS_BURST, Math.floor(value))) : 1;
}

function chooseCrew(s: BubState, env: Env, m: Member, crew: unknown): boolean {
  // Командная сессия: экипаж — это команда, выбирают её на платформе.
  if (s.phase !== "lobby" || s.teamsMode) return false;
  if (crew === null) {
    m.crew = null;
    rosterChanged(s);
    s.rt.dirty.add(m.pid);
    return true;
  }
  if (typeof crew !== "number" || !Number.isInteger(crew) || crew < 0 || crew >= lobbyCrewCount(s)) return false;
  const taken = activeMembers(s).filter((x) => x.crew === crew && x.pid !== m.pid).length;
  if (taken >= s.content.crewSize.max) {
    env.send(m.pid, { t: "full", crew });
    return false;
  }
  m.crew = crew;
  rosterChanged(s);
  s.rt.dirty.add(m.pid);
  return true;
}

function moveControl(s: BubState, m: Member, e: InEvent, at: number, claim: number): boolean {
  const stage = s.leg?.stage;
  if (!(s.phase === "drill" || (s.phase === "leg" && stage === "fly"))) return false;
  const id = typeof e.c === "string" ? e.c : "";
  const ctl = s.controls[id];
  if (!ctl) return false;
  const allowed = ctl.owner === m.pid || (m.role === "double" && m.doubleOf === ctl.owner);
  if (!allowed) return false;
  // С одного телефона — не больше 5 движений в секунду.
  if (bucketTake(s.rt.moves, m.pid, MOVES_PER_SECOND, MOVES_PER_SECOND, at, 1) === 0) return false;
  // Свежее движение решается по заявленному времени события: старое (пришло повтором после обрыва, `delayed`) не затирает
  // свежее; два дублёра почти разом — побеждает более позднее по часам сервера.
  if (claim < (ctl.claim ?? -1)) return false;
  if (ctl.type === "button") {
    ctl.state += 1;
  } else {
    const next = cleanState(ctl.type, e.s);
    // То же положение второй раз — не движение (удержание в нужном положении не сбрасывается).
    if (next === null || next === ctl.state) return false;
    ctl.state = next;
  }
  ctl.claim = claim;
  // Удержание 0,7 с — от прихода (свежее — не раньше «приход − 0,3 с»).
  ctl.movedAt = Math.max(at, ctl.movedAt);
  ctl.by = m.pid;
  s.rt.dirty.add(ctl.owner);
  for (const d of activeMembers(s)) if (d.doubleOf === ctl.owner) s.rt.dirty.add(d.pid);
  return true;
}

function tapEvent(s: BubState, m: Member, e: InEvent, at: number): boolean {
  if (s.phase !== "leg" || s.leg?.stage !== "fly") return false;
  const crew = s.crews.find((c) => c.id === m.crew);
  if (!crew || m.role === "out") return false;
  const n = bucketTake(s.rt.taps, m.pid, TAPS_BURST, TAPS_PER_SECOND, at, count(e.n));
  if (n === 0) return false;
  if (crew.repair) {
    crew.repair.taps += n;
    crew.repair.by[m.pid] = (crew.repair.by[m.pid] ?? 0) + n;
    markCrew(s, crew.id);
    return true;
  }
  const ev = s.leg.event;
  if (ev && ev.started && ev.kind === "meteor" && ev.crews.includes(crew.id) && ev.power) {
    const prev = ev.power[m.pid] ?? { shake: 0, taps: 0 };
    ev.power[m.pid] = { shake: prev.shake, taps: prev.taps + n };
    s.rt.dirty.add(m.pid);
    return true;
  }
  return false;
}

/**
 * SOS с телефона. Новый телефон шлёт весь набор с последнего сброса (`seq`) и метку сброса, которую видел (`b` —
 * номер попытки): повтор сорвавшегося запроса может прийти после следующего цвета — набор не сбрасывается, засчитываются
 * недостающие нажатия по порядку, уже засчитанные и нажатия до прошлого сброса (`b` — номер попытки `attempt`) не
 * считаются (аудит 2b, №14).
 * Старый формат — один цвет (`color`).
 */
function sosInput(s: BubState, env: Env, m: Member, e: Record<string, unknown>, at: number): boolean {
  if (!Array.isArray(e.seq)) return sosPress(s, env, m, e.color, at);
  const crew = s.crews.find((c) => c.id === m.crew);
  const sos = crew?.sos;
  if (!sos || sos.done) return false;
  if (typeof e.b === "number" && e.b !== (sos.attempt ?? 0)) return false;
  const entered = e.seq.slice(0, SOS_COLORS * 4);
  let pressed = false;
  for (let i = sos.progress; i < entered.length; i += 1) {
    if (sosPress(s, env, m, entered[i], at)) pressed = true;
    // Ошибка (набор сброшен) или нажатие не принято — дальше этого набора не идём.
    if (sos.progress !== i + 1 || sos.done) break;
  }
  return pressed;
}

/** Нажатие цвета SOS; true — принято (верный цвет или ошибка со сбросом). */
function sosPress(s: BubState, env: Env, m: Member, color: unknown, at: number): boolean {
  const ev = sameCrewEvent(s, m);
  if (!ev || ev.kind !== "sos" || !ev.started || m.crew === null || !ev.crews.includes(m.crew)) return false;
  const crew = s.crews.find((c) => c.id === m.crew);
  const sos = crew?.sos;
  if (!crew || !sos || sos.done) return false;
  if (captainOf(s, crew.id, (pid: string) => env.online(pid))?.pid !== m.pid) return false;
  if (at < sos.blockedUntil) return false;
  if (typeof color !== "number" || !Number.isInteger(color) || color < 0 || color >= SOS_COLORS) return false;
  const seq = ev.seq ?? [];
  if (seq[sos.progress] === color) {
    sos.progress += 1;
    if (sos.progress >= seq.length) {
      sos.done = true;
      crew.bonus.sos += SOS_BONUS;
      env.checkpoint();
    }
  } else {
    // Ошибка: кнопки неактивны 1,5 с, набор с начала — перебрать наугад нельзя.
    sos.progress = 0;
    sos.blockedUntil = at + SOS_BLOCK_MS;
    sos.attempt = (sos.attempt ?? 0) + 1;
  }
  markCrew(s, crew.id);
  return true;
}

function castVote(s: BubState, m: Member, target: unknown): boolean {
  const own = voteCrewOf(s, m);
  if (s.phase !== "leg" || s.leg?.stage !== "vote" || own === null) return false;
  const crew = s.crews.find((c) => c.id === own);
  if (!crew || crew.saboteur === null) return false;
  if (target === null) {
    m.vote = null;
  } else {
    if (typeof target !== "string" || target === m.pid) return false;
    if (!voteCandidates(s, crew.id).some((c) => c.pid === target)) return false;
    if (m.role === "out") return false;
    m.vote = target;
  }
  s.rt.dirty.add(m.pid);
  return true;
}

// ------------------------------------------------------------------ команды пульта

export function moment(s: BubState): string {
  return `${s.phase}:${s.legIndex}:${s.leg?.stage ?? "-"}:${s.attempts[s.legIndex] ?? 0}`;
}

function args(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const LEG_STAGES_BETWEEN: readonly Stage[] = ["dock", "vote", "voted"];

export function command(s: BubState, cmd: string, raw: unknown, env: Env): Outcome {
  const a = args(raw);
  const t = gameNow(s, env);
  const leg = s.leg;
  const stage = leg?.stage ?? null;
  const between = s.phase === "leg" && stage !== null && LEG_STAGES_BETWEEN.includes(stage);
  switch (cmd) {
    case "gather": {
      if (s.phase !== "lobby") return { ok: false, error: "wrong-phase" };
      if (activeMembers(s).length === 0) return { ok: false, error: "no-players" };
      gatherCrews(s);
      s.phase = "crews";
      s.phaseAt = t;
      dirtyAll(s);
      env.checkpoint();
      env.changed();
      return { ok: true };
    }
    case "drill": {
      if (s.phase !== "crews") return { ok: false, error: "wrong-phase" };
      for (const c of liveCrews(s)) resetCrewLeg(c);
      deal(s, env, 0, true);
      s.phase = "drill";
      s.phaseAt = t;
      s.drill = { endsAt: t + DRILL_MS, over: false };
      env.checkpoint();
      env.changed();
      return { ok: true };
    }
    case "start": {
      if (s.phase !== "crews" && s.phase !== "drill") return { ok: false, error: "wrong-phase" };
      saveBase(s);
      startLeg(s, env, 0, t);
      return { ok: true };
    }
    case "next": {
      if (!leg || !between) return { ok: false, error: "wrong-phase" };
      if (stage === "vote") return { ok: false, error: "vote-running" };
      if (stage === "dock" && leg.saboteurs && leg.vote === null) {
        openVote(s, env, t);
        return { ok: true, result: "vote" };
      }
      if (s.legIndex + 1 >= s.content.legs) {
        toPodium(s, env, t);
        return { ok: true, result: "podium" };
      }
      saveBase(s);
      startLeg(s, env, s.legIndex + 1, t);
      return { ok: true, result: "leg" };
    }
    case "vote": {
      // Только на «Привале» идущей игры: у пьедестала и после «Завершить» перелёт остаётся на `dock`, но голосовать нельзя.
      if (!leg || !between || stage !== "dock") return { ok: false, error: "wrong-phase" };
      if (!leg.saboteurs || leg.vote !== null) return { ok: false, error: "no-saboteur" };
      openVote(s, env, t);
      return { ok: true };
    }
    case "vote-end": {
      if (s.phase !== "leg" || stage !== "vote") return { ok: false, error: "wrong-phase" };
      closeVote(s, env);
      return { ok: true };
    }
    case "podium": {
      if (!between || stage === "vote") return { ok: false, error: "wrong-phase" };
      toPodium(s, env, t);
      return { ok: true };
    }
    case "finish": {
      if (s.phase !== "podium") return { ok: false, error: "wrong-phase" };
      s.phase = "finished";
      dirtyAll(s);
      env.checkpoint();
      env.changed();
      return { ok: true };
    }
    case "back": {
      if (!between || s.base === null) return { ok: false, error: "nothing-to-undo" };
      restoreBase(s, env);
      return { ok: true };
    }
    case "time": {
      if (!leg || (stage !== "launch" && stage !== "fly")) return { ok: false, error: "wrong-phase" };
      const delta = a.delta === ORDER_SHIFT_STEP_S || a.delta === -ORDER_SHIFT_STEP_S ? a.delta : null;
      if (delta === null || typeof a.from !== "number") return { ok: false, error: "invalid-argument" };
      // `from` — сдвиг, который видел ведущий: двойное касание и второй пульт не прибавляют дважды.
      if (a.from !== leg.shift) return { ok: false, error: "moved" };
      const base = orderSeconds(s, leg.index, 0);
      const next = Math.max(ORDER_MIN_S - base, Math.min(ORDER_MAX_S - base, leg.shift + delta));
      if (next === leg.shift) return { ok: false, error: "limit" };
      leg.shift = next;
      env.changed();
      return { ok: true, result: orderSeconds(s) };
    }
    case "event": {
      if (!leg || stage !== "fly") return { ok: false, error: "wrong-phase" };
      if (env.paused) return { ok: false, error: "paused" };
      if (leg.event) return { ok: false, error: "busy" };
      const kind = a.kind;
      if (kind !== "meteor" && kind !== "pull" && kind !== "sos" && kind !== "captain") return { ok: false, error: "invalid-argument" };
      if (!s.content.events[kind]) return { ok: false, error: "disabled" };
      if (allFinished(s)) return { ok: false, error: "all-finished" };
      let task: string | undefined;
      if (kind === "captain") {
        task = cleanTask(a.task) || s.content.captainTasks[0] || "Все на палубу!";
      }
      const ev = warnEvent(s, env, kind, t, true, task);
      return ev ? { ok: true, result: ev.id } : { ok: false, error: "busy" };
    }
    case "event-end": {
      const ev = leg?.event;
      if (!ev) return { ok: false, error: "no-event" };
      if (a.id !== undefined && a.id !== ev.id) return { ok: false, error: "moved" };
      endEvent(s, env, t, true);
      return { ok: true };
    }
    case "rate": {
      if (!leg || s.phase !== "leg") return { ok: false, error: "wrong-phase" };
      const id = typeof a.event === "string" ? a.event : "";
      const known = leg.history.some((h) => h.id === id && h.kind === "captain") || (leg.event?.id === id && leg.event.kind === "captain");
      if (!known) return { ok: false, error: "not-found" };
      const stars = args(a.stars);
      const clean: Record<string, number> = {};
      for (const c of liveCrews(s)) {
        const v = stars[String(c.id)];
        if (typeof v === "number" && Number.isFinite(v)) clean[String(c.id)] = Math.max(0, Math.min(CAPTAIN_STARS_MAX, Math.round(v)));
      }
      // Повторное «Начислить» заменяет прошлые бонусы этого задания, а не добавляет.
      leg.ratings[id] = clean;
      for (const c of liveCrews(s)) {
        const n = clean[String(c.id)];
        if (n === undefined || n === 0) delete c.bonus.captain[id];
        else c.bonus.captain[id] = n * CAPTAIN_STAR;
      }
      if (between) refreshLegResults(s);
      env.checkpoint();
      env.changed();
      return { ok: true };
    }
    case "remove": {
      const m = typeof a.pid === "string" ? s.members[a.pid] : undefined;
      if (!m || m.gone) return { ok: false, error: "not-found" };
      if (m.offlineSince === null || t - m.offlineSince < KICK_AFTER_MS) return { ok: false, error: "online" };
      if (m.role === "out") return { ok: true };
      // Ушедший гость не держит «Притяжение» и не получает приказов; его приборы со следующего перелёта — товарищам.
      m.role = "out";
      m.order = null;
      m.pending = false;
      m.doubleOf = null;
      rosterChanged(s);
      env.changed();
      return { ok: true };
    }
    case "move": {
      const m = typeof a.pid === "string" ? s.members[a.pid] : undefined;
      if (!m || m.gone) return { ok: false, error: "not-found" };
      if (s.phase === "lobby") {
        if (a.crew === null) {
          m.crew = null;
        } else {
          const crew = a.crew;
          if (typeof crew !== "number" || !Number.isInteger(crew) || crew < 0 || crew >= lobbyCrewCount(s)) return { ok: false, error: "invalid-argument" };
          if (activeMembers(s).filter((x) => x.crew === crew && x.pid !== m.pid).length >= s.content.crewSize.max) return { ok: false, error: "full" };
          m.crew = crew;
        }
        rosterChanged(s);
      } else if (stage === "vote") {
        return { ok: false, error: "vote-running" };
      } else if (s.phase === "crews" || between) {
        const crew = s.crews.find((c) => c.id === a.crew && !c.gone);
        if (!crew) return { ok: false, error: "invalid-argument" };
        if (m.crew === crew.id) return { ok: true };
        moveMember(s, m, crew.id, false);
      } else return { ok: false, error: "busy" };
      dirtyAll(s);
      env.changed();
      return { ok: true };
    }
    case "merge": {
      if (s.phase !== "crews" && !between) return { ok: false, error: "busy" };
      if (stage === "vote") return { ok: false, error: "vote-running" };
      // До голосования за диверсанта экипажи не объединяются: голос и +50 остались бы у исчезнувшего экипажа.
      if (stage === "dock" && leg?.saboteurs && leg.vote === null) return { ok: false, error: "vote-pending" };
      const from = s.crews.find((c) => c.id === a.from && !c.gone);
      const to = s.crews.find((c) => c.id === a.to && !c.gone);
      if (!from || !to || from === to) return { ok: false, error: "invalid-argument" };
      // Очки влитого экипажа прибавляются к экипажу, куда его влили (решение владельца 6 ноября 2026).
      to.merged = (to.merged ?? 0) + crewTotal(from);
      // Счётчики карточки — вместе с очками: иначе «приказов 12» и «очков 900» на карточке не сходились бы (ревью 6 ноября 2026).
      to.mergedStats = joinCardStats(cardStats(from), to.mergedStats);
      to.guessed += from.guessed;
      mergeCrews(s, from, to);
      dirtyAll(s);
      env.checkpoint();
      env.changed();
      return { ok: true };
    }
    default:
      return { ok: false, error: "invalid-argument" };
  }
}

function dirtyAll(s: BubState): void {
  for (const pid of Object.keys(s.members)) s.rt.dirty.add(pid);
}

function toPodium(s: BubState, env: Env, t: number): void {
  s.phase = "podium";
  s.podiumAt = t;
  for (const m of Object.values(s.members)) m.order = null;
  dirtyAll(s);
  env.checkpoint();
  env.changed();
}

/** «Назад — переиграть перелёт»: всё как до старта перелёта; вошедшие за это время остаются (в самых маленьких экипажах). */
function restoreBase(s: BubState, env: Env): void {
  if (s.base === null) return;
  // Не откатываются: время, случайность, попытки и все номера (приказов, событий, приборов, входа) — иначе после «Назад»
  // номера повторились бы и телефон принял бы новый приказ за старый.
  const keep = {
    offset: s.offset,
    floor: s.floor,
    pausedGame: s.pausedGame,
    rng: s.rng,
    attempts: s.attempts,
    lastTick: s.lastTick,
    orderSeq: s.orderSeq,
    eventSeq: s.eventSeq,
    ctlSeq: s.ctlSeq,
    joinSeq: s.joinSeq,
    rt: s.rt,
  };
  const current = s.members;
  const base = JSON.parse(s.base) as Omit<BubState, "rt">;
  Object.assign(s, base, keep);
  s.base = null;
  rosterChanged(s);
  for (const [pid, m] of Object.entries(current)) {
    if (s.members[pid]) {
      const restored = s.members[pid];
      if (restored) {
        restored.gone = m.gone;
        restored.offlineSince = m.offlineSince;
        restored.name = m.name;
        if (s.teamsMode) restored.team = m.team ?? null;
      }
      continue;
    }
    const fresh = newMember(pid, m.name, m.join);
    if (s.teamsMode) fresh.team = m.team ?? null;
    s.members[pid] = fresh;
    if (m.gone) fresh.gone = true;
    rosterChanged(s);
    if (!m.gone && s.phase !== "lobby") seatLate(s, fresh, null, false);
  }
  rosterChanged(s);
  // Кто в игре, а экипажа нет (ушёл ещё в лобби — в точке «Назад» он без экипажа — и вернулся посреди перелёта): за стол,
  // как опоздавший. Иначе после «Назад» он навсегда остался бы в лобби без экипажа (ревью 6 ноября 2026).
  if (s.phase !== "lobby") {
    for (const m of [...activeMembers(s)]) {
      if (m.role === "out") continue;
      const team = teamCrewOf(s, m.team);
      const teamLive = team !== null && s.crews.some((c) => c.id === team && !c.gone);
      if (m.crew === null || !s.crews.some((c) => c.id === m.crew && !c.gone)) seatLate(s, m, teamLive ? team : null, false);
      // Командная сессия: сменил команду за перелёт — после «Назад» он в экипаже своей команды.
      else if (teamLive && team !== m.crew) moveMember(s, m, team, false);
    }
    // Команда, появившаяся после точки «Назад», — в экипаже, где теперь сидят её люди (проверка 2d, №1).
    adoptTeams(s);
  }
  dirtyAll(s);
  env.checkpoint();
  env.changed();
}

// ------------------------------------------------------------------ пауза, снимок

/** Пауза: время игры встаёт на этом моменте (команды пульта на паузе ставят отсчёты от него). */
export function pause(s: BubState, env: Pick<Env, "now">): void {
  s.pausedGame = env.now - s.offset;
}

/**
 * Пауза кончилась: время игры не шло — продолжаем ровно с того места, где оно встало (`pausedGame`, после перезапуска —
 * последний шаг цикла `lastTick`), всё назначенное (сроки, события, ремонт) сдвигается само. Не `offset += pausedMs`:
 * после перезапуска движок считает простой от метки «жив» снимка, а она бывает новее последнего шага игры (тихая фаза —
 * снимок без перемен), и время игры перескочило бы весь простой (ревью 6 ноября 2026).
 */
export function resume(s: BubState, pausedMs: number, env: Pick<Env, "now">): void {
  const frozen = s.pausedGame ?? s.lastTick;
  if (typeof frozen === "number" && Number.isFinite(frozen)) s.offset = env.now - frozen;
  else s.offset += Math.max(0, pausedMs);
  s.pausedGame = null;
  s.floor = env.now - s.offset;
  s.lastTick = s.floor;
}

export function snapshot(s: BubState): unknown {
  return persist(s);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Состояние из снимка; не тот формат — null (комната начнётся заново). */
export function restore(data: unknown): BubState | null {
  if (!isRecord(data) || data.v !== 1) return null;
  if (typeof data.phase !== "string" || !(PHASES as readonly string[]).includes(data.phase)) return null;
  if (!isRecord(data.members) || !Array.isArray(data.crews) || !isRecord(data.controls) || !Array.isArray(data.attempts)) return null;
  for (const key of ["legIndex", "joinSeq", "ctlSeq", "orderSeq", "eventSeq", "offset", "floor", "rng", "phaseAt"]) {
    if (typeof data[key] !== "number" || !Number.isFinite(data[key])) return null;
  }
  if (data.leg !== null && !isRecord(data.leg)) return null;
  for (const m of Object.values(data.members)) if (!isRecord(m) || typeof m.pid !== "string" || !Array.isArray(m.panel)) return null;
  const s = { ...(data as unknown as Omit<BubState, "rt">), content: parseContent(data.content), rt: freshRuntime() } as BubState;
  if (typeof s.pausedGame !== "number") s.pausedGame = null;
  return s;
}

export { HULL_MAX };
