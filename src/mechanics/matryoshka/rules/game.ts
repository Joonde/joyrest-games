/**
 * «Игры Матрёшки» — ход игры целиком (docs/matryoshka.md): фазы и шаги, испытания, вылет, «Второй шанс», «Добивка», финал,
 * команды пульта, «Назад», пауза, снимок и восстановление. Чистые функции над состоянием: время, связь, случайность и отправка
 * телефону — только через `env` (у сервера это контекст игровой комнаты). Время в состоянии — время игры.
 */
import {
  BETS_MS,
  BET_WIN,
  BRAVE_MS,
  CHANCE_BACK_MS,
  CHANCE_GRACE_MS,
  CHANCE_MIN_RT,
  CHANCE_OFFER_MS,
  CHANCE_QUESTION_MS,
  CHOOSE_MS,
  COUNTDOWN_MS,
  CRACK_MS,
  DOBIVKA_INTRO_MS,
  DOBIVKA_ROWS,
  FREEZE_MS,
  GUESS_BEST,
  GUESS_NEAR,
  GUESS_NEAR_SHARE,
  HOP_ROWS,
  JUDGING_MS,
  JUMP_MS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  MORE_TIME_MAX_MS,
  MORE_TIME_MS,
  OPEN_MS,
  PICK_MS,
  PLAYED_TRIALS_MIN,
  REACT_CLOCK_MS,
  REVEAL_BASE_MS,
  REVEAL_MAX_MS,
  REVEAL_PER_OUT_MS,
  ROPE_ATTEMPT_MS,
  ROPE_REST_MS,
  RPS_PICK_MS,
  RPS_SHOW_MS,
  RULES_MS,
  SECOND_CHANCE_AFTER,
  SIT_EARLY_MS,
  SIT_SETTLE_MS,
  SPLIT_MS,
  TRACE_MS,
  UNBOX_MS,
  UNIT_CHANCE,
  UNIT_DOBIVKA,
  UNIT_FINAL,
} from "./constants";
import { parseContent, planOf, questionsOf } from "./content";
import { claimedTime, eventTime, finite, gameNow, lots, randomOf, reactionFits, record, stampSlack, tempoMs, type Env, type InEvent, type Outcome } from "./env";
import { buildFinal, champion, GESTURES, newDuel, nextMatch, resolveRound, setWinner } from "./final";
import { advance, freezeEndNow, freezeKey, freezeMore, freezePause, freezeStart, holdEvent, settledAt } from "./freeze";
import { boxEvent, gingerAutoBoxes, gingerKey, gingerStart, gingerSub, pieceEvent } from "./ginger";
import { chairsFails, chairsFor, chairsKey, chairsStart, newRound, seatRound, sitEvent } from "./chairs";
import { braveDue, braveEvent, cellEvent, crackDobRow, crackRow, hopKey, hopStart, newDobRow, newHopRow, pickBraves } from "./hopscotch";
import { bestFanOf, bringBack, eliminate, fans, inGame, inGamePids, knockedOut, newMember, placeSum, removePlayer } from "./members";
import { ropeAddFan, ropeEndNow, ropeStart, ropeTick, ropeWinner, tapEvent, tapRate } from "./rope";
import { dobivkaOut, finalistsFor, losersOf, rankOrder, scoreGuesses, targetOf } from "./target";
import type { Gesture, MatState, Member, Phase, RuntimeState, Side, TrialKind, TrialStage, TrialState } from "./types";

export type { Env, InEvent, Outcome } from "./env";

const PHASES: readonly Phase[] = ["lobby", "trial", "chance", "dobivka", "final", "podium", "finished"];

export function freshRuntime(): RuntimeState {
  return { sent: new Map(), urgent: new Set(), marks: new Set(), lastPersonal: -Infinity };
}

/** Все телефоны — личный вид сразу (смена шага, пауза). */
export function urgentAll(s: MatState): void {
  for (const pid of Object.keys(s.members)) s.rt.urgent.add(pid);
}

// ------------------------------------------------------------------ создание, вход

export function createState(contentRaw: unknown, env: Env): MatState {
  const s: MatState = {
    v: 1,
    content: parseContent(contentRaw),
    phase: "lobby",
    members: {},
    joinSeq: 0,
    plan: [],
    playedTrials: [],
    trialSizes: [],
    trialIndex: 0,
    trial: null,
    F: 0,
    startCount: 0,
    piggy: 0,
    outSeq: 0,
    justOut: [],
    chance: null,
    chanceUsed: false,
    chanceAsked: 0,
    dobivka: null,
    final: null,
    bestFan: null,
    podiumAt: null,
    board: false,
    base: null,
    chanceBase: null,
    dobBase: null,
    finalBase: null,
    attempt: 0,
    rev: 0,
    trialReturns: [],
    offset: 0,
    floor: env.now,
    pausedGame: null,
    lastTick: null,
    rng: 0,
    rt: freshRuntime(),
  };
  s.floor = env.now - s.offset;
  // Стартовый состав — в порядке входа (сервер читает участников по `joined_at`): номера «№ 001…» по нему.
  for (const p of env.players) join(s, p, env);
  return s;
}

/** После «Начать» вошедший — болельщик (опоздавший): прогнозы, «Канат», ставки; в таблице не играет. */
function makeLate(s: MatState, m: Member): void {
  m.role = "fan";
  m.late = true;
  m.fanSince = -1;
  m.places = s.plan.map(() => null);
  const play = s.trial?.play;
  if (play?.kind === "rope") ropeAddFan(play, m.pid, s.lastTick ?? 0);
}

/**
 * Вошёл гость: номер по порядку входа; после «Начать» — болельщик (опоздавший). Ушёл из лобби до «Начать» и вернулся после —
 * тоже болельщик (аудит 3a: раньше оставался в роли лобби и не мог ничего).
 */
export function join(s: MatState, p: { pid: string; name: string }, env: Pick<Env, "changed">): void {
  const known = s.members[p.pid];
  if (known) {
    known.name = p.name;
    known.gone = false;
    if (known.role === "lobby" && s.phase !== "lobby") {
      makeLate(s, known);
      s.rt.urgent.add(p.pid);
      env.changed();
    }
    return;
  }
  s.joinSeq += 1;
  const m = newMember(p.pid, p.name, s.joinSeq);
  if (s.phase !== "lobby") makeLate(s, m);
  s.members[p.pid] = m;
  s.rt.urgent.add(p.pid);
  env.changed();
}

/** Участника убрали на платформе: ушёл. Игрок посреди игры — как «Убрать игрока». */
export function syncPresence(s: MatState, env: Env): void {
  const present = new Set(env.players.map((p) => p.pid));
  for (const p of env.players) {
    const m = s.members[p.pid];
    if (m && m.name !== p.name) m.name = p.name;
  }
  for (const m of Object.values(s.members)) {
    if (m.gone || present.has(m.pid)) continue;
    m.gone = true;
    if (m.role === "player") dropPlayer(s, m, env);
    env.changed();
  }
}

// ------------------------------------------------------------------ точки «Назад»

type Persisted = Omit<MatState, "rt">;

export function persist(s: MatState): Persisted {
  const { rt: _rt, ...rest } = s;
  return rest;
}

/** Точка «Назад» — состояние без самих точек (иначе снимок рос бы вложенными копиями). */
function savePoint(s: MatState): string {
  return JSON.stringify({ ...persist(s), base: null, chanceBase: null, dobBase: null, finalBase: null });
}

/**
 * Вернуться к точке (без побочных действий): всё как было, кроме вошедших (болельщики остаются) и убранных (остаются
 * убранными), времени, случайности, номера попытки и номеров (L32). Точки «Назад» — те, что сейчас (их снимает вызывающий).
 */
function applyPoint(s: MatState, point: string): void {
  const keep = { offset: s.offset, floor: s.floor, pausedGame: s.pausedGame, lastTick: s.lastTick, rng: s.rng, attempt: s.attempt + 1, rev: s.rev, joinSeq: s.joinSeq, chanceAsked: s.chanceAsked, outSeq: s.outSeq, rt: s.rt, base: s.base, chanceBase: s.chanceBase, dobBase: s.dobBase, finalBase: s.finalBase, board: s.board };
  const current = s.members;
  const old = JSON.parse(point) as Persisted;
  Object.assign(s, old, keep);
  for (const [pid, m] of Object.entries(current)) {
    const restored = s.members[pid];
    if (!restored) {
      s.members[pid] = m;
      continue;
    }
    restored.name = m.name;
    restored.gone = m.gone;
    // Ушёл из лобби до «Начать» и вернулся позже — болельщик и в точке (иначе снова «лобби»).
    if (restored.role === "lobby" && m.role !== "lobby") {
      restored.role = m.role;
      restored.late = m.late;
      restored.fanSince = m.fanSince;
    }
    // Убран после точки — убранным и остаётся (в точке он мог быть и выбывшим болельщиком: вернули, потом убрали).
    if (m.removed && !restored.removed) {
      restored.role = "fan";
      restored.removed = true;
      restored.hearts = 0;
      restored.outSeq = m.outSeq;
      restored.outAt = "removed";
      restored.fanSince = m.fanSince;
    }
  }
  urgentAll(s);
}

function loadPoint(s: MatState, point: string, env: Pick<Env, "changed" | "checkpoint">): void {
  applyPoint(s, point);
  env.checkpoint();
  env.changed();
}

// ------------------------------------------------------------------ испытания

function setTrialStage(tr: TrialState, stage: TrialStage, t: number, ms: number | null): void {
  tr.stage = stage;
  tr.stageAt = t;
  tr.stageEnds = ms === null ? null : t + ms;
}

/** Открыть испытание `index` плана (после последнего — «Добивка» или финал). */
function openTrial(s: MatState, env: Env, index: number, t: number): void {
  if (index >= s.plan.length) {
    afterTrials(s, env, t);
    return;
  }
  s.phase = "trial";
  s.trialIndex = index;
  s.chance = null;
  s.chanceBase = null;
  s.dobBase = null;
  s.finalBase = null;
  const kind = s.plan[index] as TrialKind;
  s.trialReturns = [];
  s.trial = { index, kind, stage: "open", stageAt: t, stageEnds: t + tempoMs(s, OPEN_MS), A: 0, T: 0, k: 0, seeding: false, participants: [], guesses: {}, play: null, outcome: null, auto: false };
  s.base = savePoint(s);
  urgentAll(s);
  env.checkpoint();
  env.changed();
}

/** Сколько испытаний на вылет впереди, включая текущее. */
function remainingTrials(s: MatState, index: number): number {
  return Math.max(0, s.plan.length - index);
}

function startPlay(s: MatState, env: Env, t: number): void {
  const tr = s.trial;
  if (!tr) return;
  const pids = inGamePids(s);
  tr.participants = pids;
  tr.A = pids.length;
  tr.k = remainingTrials(s, tr.index);
  tr.T = targetOf(tr.A, s.F, tr.k);
  tr.seeding = tr.T >= tr.A;
  s.trialSizes[tr.index] = pids.length;
  if (pids.length < 2) {
    // Игроков меньше двух — испытание пропускается само.
    tr.auto = true;
    tr.outcome = { order: pids, lost: [], out: [], fails: null, best: [], near: [] };
    setTrialStage(tr, "results", t, null);
    urgentAll(s);
    env.checkpoint();
    env.changed();
    return;
  }
  const rand = randomOf(s, env);
  switch (tr.kind) {
    case "freeze":
      tr.play = freezeStart(rand, t, tempoMs(s, FREEZE_MS), pids);
      break;
    case "ginger":
      tr.play = gingerStart(rand, t, s.content.shapes, pids, { pick: tempoMs(s, PICK_MS), unbox: tempoMs(s, UNBOX_MS), trace: tempoMs(s, TRACE_MS) });
      break;
    case "chairs":
      tr.play = chairsStart(rand, t, pids, tr.T, (ms) => tempoMs(s, ms));
      break;
    case "rope":
      tr.play = ropeStart(rand, t, pids, fans(s).map((m) => m.pid), { split: tempoMs(s, SPLIT_MS) });
      break;
    case "hopscotch":
      tr.play = hopStart(rand, t, pids, tempoMs(s, BRAVE_MS));
      break;
  }
  setTrialStage(tr, "play", t, null);
  urgentAll(s);
  env.checkpoint();
  env.changed();
}

/** Участники испытания, всё ещё играющие (убранные посреди испытания не в счёт). */
function activeOf(s: MatState, tr: TrialState): string[] {
  return tr.participants.filter((pid) => {
    const m = s.members[pid];
    return m !== undefined && m.role === "player" && !m.removed && !m.gone;
  });
}

/** Нужно «наказать» сейчас: участники − цель (на посев — 0). */
function needOf(s: MatState, tr: TrialState): number {
  return tr.seeding ? 0 : Math.max(0, activeOf(s, tr).length - tr.T);
}

/** Ход игры в шаге `play`; true — испытание сыграно, дальше проверка. */
function playTick(s: MatState, env: Env, tr: TrialState, t: number): boolean {
  const p = tr.play;
  if (!p) return true;
  switch (p.kind) {
    case "freeze": {
      settleFreeze(s, env, tr, t);
      env.changed();
      return t >= p.runEnds;
    }
    case "ginger": {
      const sub = gingerSub(p, t);
      const mark = `g:${tr.index}:${sub}:${s.attempt}`;
      if (!s.rt.marks.has(mark)) {
        s.rt.marks.add(mark);
        if (sub !== "pick") gingerAutoBoxes(p, tr.participants, randomOf(s, env));
        urgentAll(s);
        env.changed();
      }
      const all = activeOf(s, tr).every((pid) => {
        const r = p.runners[pid];
        return !r || r.cracked || r.doneAt !== null;
      });
      // Коробки на экране открываются по очереди, кусочки растут — сводка экрана 5 раз в секунду.
      if (sub === "trace" || sub === "unbox") env.changed();
      return sub === "over" || (sub === "trace" && all);
    }
    case "chairs": {
      const r = p.rounds[p.round];
      if (!r) return true;
      announceChairs(s, env, tr, r, t);
      if (t >= r.settleAt && r.seated === null) {
        const lot = lots(s, env, Object.keys(r.sits));
        seatRound(p, r, (pid) => lot.get(pid) ?? 0);
        urgentAll(s);
        env.changed();
      }
      if (r.seated !== null && t >= r.seatEnds) {
        const seated = r.seated.filter((pid) => activeOf(s, tr).includes(pid));
        if (p.round + 1 >= 3 || seated.length <= tr.T || seated.length === 0) {
          p.over = true;
          return true;
        }
        p.round += 1;
        p.rounds.push(newRound(randomOf(s, env), r.seatEnds, seated, chairsFor(p.round, seated.length, tr.T, tr.A), (ms) => tempoMs(s, ms)));
        urgentAll(s);
        env.changed();
      }
      return false;
    }
    case "rope": {
      const lot = randomOf(s, env);
      const before = `${p.attempt}:${p.restEnds}:${p.over}`;
      if (ropeTick(p, t, (pid) => env.online(pid), lot, { attempt: tempoMs(s, ROPE_ATTEMPT_MS), rest: tempoMs(s, ROPE_REST_MS) })) env.changed();
      if (`${p.attempt}:${p.restEnds}:${p.over}` !== before) urgentAll(s);
      return p.over;
    }
    case "hopscotch": {
      const r = p.rows[p.row];
      if (!r || p.over) return true;
      if (braveDue(r, t)) {
        const lot = lots(s, env, Object.keys(r.braveTaps));
        const braves = pickBraves(r, (pid) => lot.get(pid) ?? 0).filter((pid) => activeOf(s, tr).includes(pid));
        r.braves = braves;
        const at = r.braveEnds;
        if (braves.length > 0) {
          r.jumpEnds = t + tempoMs(s, JUMP_MS);
          r.chooseAt = r.jumpEnds;
        } else r.chooseAt = Math.max(at, t);
        r.chooseEnds = r.chooseAt + tempoMs(s, CHOOSE_MS);
        urgentAll(s);
        env.changed();
      }
      if (r.jumpEnds !== null && t >= r.jumpEnds && !s.rt.marks.has(`h:${tr.index}:${p.row}:${s.attempt}`)) {
        s.rt.marks.add(`h:${tr.index}:${p.row}:${s.attempt}`);
        urgentAll(s);
        env.changed();
      }
      if (r.chooseEnds !== null && r.fell === null && t >= r.chooseEnds) {
        r.jumpers = r.jumpers.filter((pid) => activeOf(s, tr).includes(pid));
        crackRow(p, r, randomOf(s, env), (pid, n) => {
          const m = s.members[pid];
          if (m) m.coins += n;
        });
        r.crackEnds = t + tempoMs(s, CRACK_MS);
        urgentAll(s);
        env.changed();
      }
      if (r.crackEnds !== null && t >= r.crackEnds) {
        const active = activeOf(s, tr);
        const fallen = active.filter((pid) => p.fallen[pid] !== undefined).length;
        const left = active.filter((pid) => p.fallen[pid] === undefined);
        if (p.stop || fallen >= needOf(s, tr) || p.row + 1 >= HOP_ROWS || left.length === 0) {
          p.over = true;
          return true;
        }
        p.row += 1;
        p.rows.push(newHopRow(randomOf(s, env), t, left, tempoMs(s, BRAVE_MS)));
        urgentAll(s);
        env.changed();
      }
      return false;
    }
  }
}

/** «Замри!»: учёт до «сейчас − 1,5 с», объявление пойманных устоявшихся взглядов, моменты экрану и телефонам. */
function settleFreeze(s: MatState, env: Env, tr: TrialState, t: number): void {
  const p = tr.play;
  if (!p || p.kind !== "freeze") return;
  const settled = settledAt(p, t);
  for (const r of Object.values(p.runners)) if (r.acc < settled) advance(p, r, settled);
  while (p.judged < p.gazes.length) {
    const g = p.gazes[p.judged];
    if (!g || g.e > settled) break;
    const pids = Object.entries(p.runners)
      .filter(([, r]) => r.caughtAt.includes(p.judged))
      .map(([pid]) => pid);
    p.lastCatch = { gaze: p.judged, pids };
    for (const pid of pids) s.rt.urgent.add(pid);
    p.judged += 1;
  }
  // Моменты: экрану — фраза в её начале, телефонам — поворот за 1 с (их вид пересчитывается сразу).
  p.gazes.forEach((g, i) => {
    const sm = `fs:${tr.index}:${i}:${s.attempt}`;
    if (g.ph <= t && !s.rt.marks.has(sm)) {
      s.rt.marks.add(sm);
      env.changed();
    }
    const pm = `fp:${tr.index}:${i}:${s.attempt}`;
    if (g.a - 1000 <= t && !s.rt.marks.has(pm)) {
      s.rt.marks.add(pm);
      for (const pid of tr.participants) s.rt.urgent.add(pid);
    }
  });
}

function announceChairs(s: MatState, env: Env, tr: TrialState, r: { stopAt: number; appearAt: number }, t: number): void {
  const p = tr.play;
  if (!p || p.kind !== "chairs") return;
  const sm = `cs:${tr.index}:${p.round}:${s.attempt}`;
  if (r.stopAt - 3000 <= t && !s.rt.marks.has(sm)) {
    s.rt.marks.add(sm);
    env.changed();
  }
  const pm = `cp:${tr.index}:${p.round}:${s.attempt}`;
  if (r.stopAt - 1000 <= t && !s.rt.marks.has(pm)) {
    s.rt.marks.add(pm);
    urgentAll(s);
  }
}

/** Проверка испытания: порядок, кто теряет сердечко, кто выбывает, места, прогнозы. */
function judge(s: MatState, env: Env, tr: TrialState, t: number): void {
  const p = tr.play;
  const active = activeOf(s, tr);
  const lot = lots(s, env, active);
  const hearts = (pid: string) => s.members[pid]?.hearts ?? 0;
  let key: (pid: string) => number[] = () => [0];
  let eligible: (pid: string) => boolean = () => true;
  let fails: number | null = null;
  if (p?.kind === "freeze") {
    for (const r of Object.values(p.runners)) advance(p, r, p.runEnds);
    settleFreeze(s, env, tr, p.runEnds + 10_000);
    key = (pid) => [...freezeKey(p.runners[pid]), hearts(pid)];
    fails = active.filter((pid) => (p.runners[pid]?.caught ?? 0) > 0).length;
  } else if (p?.kind === "ginger") {
    key = (pid) => [...gingerKey(p.runners[pid]), hearts(pid)];
    fails = active.filter((pid) => p.runners[pid]?.cracked === true).length;
  } else if (p?.kind === "chairs") {
    key = (pid) => [...chairsKey(p, pid), hearts(pid)];
    fails = chairsFails(p);
  } else if (p?.kind === "rope") {
    const winner = ropeWinner(p, randomOf(s, env));
    const ms = tempoMs(s, ROPE_ATTEMPT_MS);
    key = (pid) => [p.sides[pid] === winner ? 1 : 0, tapRate(p, pid, ms), hearts(pid)];
    eligible = (pid) => p.sides[pid] !== winner;
  } else if (p?.kind === "hopscotch") {
    key = (pid) => [...hopKey(p, pid, s.members[pid]?.coins ?? 0), hearts(pid)];
    eligible = (pid) => p.fallen[pid] !== undefined;
    fails = active.filter((pid) => p.fallen[pid] !== undefined).length;
  }
  const order = rankOrder(active, key, (pid) => lot.get(pid) ?? 0);
  const losers = losersOf(order, eligible, needOf(s, tr));
  const out: string[] = [];
  for (const pid of losers) {
    const m = s.members[pid];
    if (!m) continue;
    m.hearts = Math.max(0, m.hearts - 1);
    if (m.hearts === 0) {
      eliminate(s, m, String(tr.index));
      out.push(pid);
    }
  }
  order.forEach((pid, i) => {
    const m = s.members[pid];
    if (m) m.places[tr.index] = i + 1;
  });
  let best: string[] = [];
  let near: string[] = [];
  if (fails !== null && s.content.fanBets) {
    ({ best, near } = scoreGuesses(tr.guesses, fails, GUESS_NEAR_SHARE));
    for (const pid of best) {
      const m = s.members[pid];
      if (m) m.fanScore += GUESS_BEST;
    }
    for (const pid of near) {
      const m = s.members[pid];
      if (m) m.fanScore += GUESS_NEAR;
    }
  }
  s.playedTrials[tr.index] = true;
  tr.outcome = { order, lost: losers, out, fails, best, near };
  setTrialStage(tr, "reveal", t, Math.min(REVEAL_MAX_MS, REVEAL_BASE_MS + REVEAL_PER_OUT_MS * out.length));
  urgentAll(s);
  env.checkpoint();
  env.changed();
}

function trialTick(s: MatState, env: Env, t: number): void {
  const tr = s.trial;
  if (!tr) return;
  for (let guard = 0; guard < 8; guard += 1) {
    const before = tr.stage;
    if (tr.stage === "open" && tr.stageEnds !== null && t >= tr.stageEnds) setTrialStage(tr, "rules", tr.stageEnds, tempoMs(s, RULES_MS));
    else if (tr.stage === "rules" && tr.stageEnds !== null && t >= tr.stageEnds) setTrialStage(tr, "countdown", tr.stageEnds, tempoMs(s, COUNTDOWN_MS));
    else if (tr.stage === "countdown" && tr.stageEnds !== null && t >= tr.stageEnds) startPlay(s, env, tr.stageEnds);
    else if (tr.stage === "play") {
      if (playTick(s, env, tr, t)) setTrialStage(tr, "judging", t, JUDGING_MS);
    } else if (tr.stage === "judging") {
      if (tr.play?.kind === "freeze") settleFreeze(s, env, tr, t);
      if (tr.stageEnds !== null && t >= tr.stageEnds) judge(s, env, tr, t);
    } else if (tr.stage === "reveal" && tr.stageEnds !== null && t >= tr.stageEnds) setTrialStage(tr, "results", t, null);
    if (tr.stage === before) break;
    urgentAll(s);
    env.changed();
  }
}

// ------------------------------------------------------------------ «Второй шанс»

/** «Второй шанс» положен: итоги 3-го сыгранного испытания, после него есть испытание, включён, ещё не был, есть выбывшие. */
export function chanceAvailable(s: MatState): boolean {
  const tr = s.trial;
  if (s.phase !== "trial" || !tr || tr.stage !== "results" || s.chanceUsed || s.content.secondChance === 0) return false;
  const played = s.playedTrials.filter(Boolean).length;
  return played === SECOND_CHANCE_AFTER && s.playedTrials[tr.index] === true && tr.index + 1 < s.plan.length && knockedOut(s).length > 0;
}

function startChance(s: MatState, env: Env, t: number): void {
  s.chanceBase = savePoint(s);
  const eligible = knockedOut(s).map((m) => m.pid);
  const questions = questionsOf(s.content);
  const question = s.chanceAsked % questions.length;
  s.chanceAsked += 1;
  s.chanceUsed = true;
  s.phase = "chance";
  s.chance = { stage: "offer", stageAt: t, stageEnds: t + tempoMs(s, CHANCE_OFFER_MS), question, eligible, count: Math.ceil((s.content.secondChance / 100) * eligible.length), answers: {}, returned: [] };
  urgentAll(s);
  env.checkpoint();
  env.changed();
}

function chanceTick(s: MatState, env: Env, t: number): void {
  const c = s.chance;
  if (!c || c.stageEnds === null) return;
  if (c.stage === "offer" && t >= c.stageEnds) {
    c.stage = "question";
    c.stageAt = c.stageEnds;
    c.stageEnds = c.stageAt + tempoMs(s, CHANCE_QUESTION_MS);
  } else if (c.stage === "question" && t >= c.stageEnds + SIT_SETTLE_MS) {
    const q = questionsOf(s.content)[c.question];
    const lot = lots(s, env, Object.keys(c.answers));
    const right = Object.entries(c.answers)
      .filter(([pid, a]) => a.i === q?.correct && s.members[pid]?.role === "fan")
      .sort(([pa, a], [pb, b]) => a.rt - b.rt || (lot.get(pa) ?? 0) - (lot.get(pb) ?? 0))
      .map(([pid]) => pid);
    c.returned = right.slice(0, c.count);
    for (const pid of c.returned) {
      const m = s.members[pid];
      if (m) bringBack(m);
    }
    c.stage = "back";
    c.stageAt = t;
    c.stageEnds = t + tempoMs(s, CHANCE_BACK_MS);
    env.checkpoint();
  } else if (c.stage === "back" && t >= c.stageEnds) {
    c.stage = "done";
    c.stageAt = t;
    c.stageEnds = null;
  } else return;
  urgentAll(s);
  env.changed();
}

// ------------------------------------------------------------------ «Добивка»

function afterTrials(s: MatState, env: Env, t: number): void {
  if (inGame(s).length > s.F) startDobivka(s, env, t);
  else toFinal(s, env, t);
}

function startDobivka(s: MatState, env: Env, t: number): void {
  s.dobBase = savePoint(s);
  s.phase = "dobivka";
  s.dobivka = { stage: "intro", stageAt: t, stageEnds: t + tempoMs(s, DOBIVKA_INTRO_MS), need: inGame(s).length - s.F, rows: [], fallen: {}, out: [] };
  urgentAll(s);
  env.checkpoint();
  env.changed();
}

function dobivkaTick(s: MatState, env: Env, t: number): void {
  const d = s.dobivka;
  if (!d || d.stage === "results") return;
  const alive = inGamePids(s);
  if (d.stage === "intro") {
    if (d.stageEnds === null || t < d.stageEnds) return;
    d.stage = "rows";
    d.stageAt = d.stageEnds;
    d.stageEnds = null;
    d.rows.push(newDobRow(randomOf(s, env), t, tempoMs(s, CHOOSE_MS), tempoMs(s, CRACK_MS)));
  } else {
    const r = d.rows.at(-1);
    if (!r) return;
    if (r.fell === null && t >= r.chooseEnds) {
      crackDobRow(r, alive.filter((pid) => d.fallen[pid] === undefined), randomOf(s, env));
      for (const pid of r.fell ?? []) d.fallen[pid] = d.rows.length - 1;
    } else if (r.fell !== null && t >= r.crackEnds) {
      const need = alive.length - s.F;
      const fallen = alive.filter((pid) => d.fallen[pid] !== undefined).length;
      const left = alive.filter((pid) => d.fallen[pid] === undefined);
      if (fallen >= need || d.rows.length >= DOBIVKA_ROWS || left.length === 0) {
        const lot = lots(s, env, alive);
        d.out = dobivkaOut(alive, (pid) => d.fallen[pid] ?? null, (pid) => {
          const m = s.members[pid] as Member;
          return { hearts: m.hearts, placeSum: placeSum(s, m), coins: m.coins, lot: lot.get(pid) ?? 0 };
        }, need);
        for (const pid of d.out) {
          const m = s.members[pid];
          if (m) eliminate(s, m, "dobivka");
        }
        d.stage = "results";
        d.stageAt = t;
        env.checkpoint();
      } else d.rows.push(newDobRow(randomOf(s, env), t, tempoMs(s, CHOOSE_MS), tempoMs(s, CRACK_MS)));
    } else return;
  }
  urgentAll(s);
  env.changed();
}

// ------------------------------------------------------------------ финал

function toFinal(s: MatState, env: Env, t: number): void {
  s.finalBase = savePoint(s);
  s.phase = "final";
  const list = inGame(s);
  const lot = lots(s, env, list.map((m) => m.pid));
  const seeds = rankOrder(list.map((m) => m.pid), (pid) => {
    const m = s.members[pid] as Member;
    return [-placeSum(s, m), m.coins];
  }, (pid) => lot.get(pid) ?? 0);
  s.final = buildFinal(seeds, t);
  nextMatch(s.final, (pid) => isGone(s, pid));
  if (s.final.winners.at(-1)?.[0] !== null) toChampion(s, env, t);
  urgentAll(s);
  env.checkpoint();
  env.changed();
}

function isGone(s: MatState, pid: string): boolean {
  const m = s.members[pid];
  return !m || m.removed || m.gone || m.role !== "player";
}

function toChampion(s: MatState, env: Env, t: number): void {
  const f = s.final;
  if (!f) return;
  f.stage = "champion";
  f.stageAt = t;
  f.champion = champion(f);
  const lot = lots(s, env, Object.keys(s.members));
  s.bestFan = bestFanOf(s, (pid) => lot.get(pid) ?? 0);
}

function startDuel(s: MatState, env: Env, t: number): Outcome {
  const f = s.final;
  if (!f) return { ok: false, error: "wrong-phase" };
  const m = nextMatch(f, (pid) => isGone(s, pid));
  if (!m) {
    toChampion(s, env, t);
  } else {
    f.at = { round: m.round, match: m.match };
    const bets = s.content.fanBets && fans(s).length > 0 ? t + tempoMs(s, BETS_MS) : null;
    f.duel = newDuel(m.a, m.b, t, bets);
    if (bets === null) f.duel.stageEnds = t + tempoMs(s, RPS_PICK_MS);
    f.stage = "duel";
    f.duels += 1;
  }
  urgentAll(s);
  env.checkpoint();
  env.changed();
  return { ok: true, result: f.stage };
}

function endDuel(s: MatState, env: Env, winner: string, t: number): void {
  const f = s.final;
  const d = f?.duel;
  if (!f || !d || !f.at) return;
  d.winner = winner;
  d.stage = "over";
  d.stageAt = t;
  d.stageEnds = null;
  const loser = winner === d.a ? d.b : d.a;
  setWinner(f, f.at.round, f.at.match, winner, loser);
  for (const [pid, on] of Object.entries(d.bets)) {
    const m = s.members[pid];
    if (m && on === winner) m.fanScore += BET_WIN;
  }
  env.checkpoint();
}

function finalTick(s: MatState, env: Env, t: number): void {
  const d = s.final?.duel;
  if (!s.final || s.final.stage !== "duel" || !d || d.stageEnds === null || t < d.stageEnds) return;
  if (d.stage === "bets") {
    d.stage = "pick";
    d.stageAt = d.stageEnds;
    d.stageEnds = d.stageAt + tempoMs(s, RPS_PICK_MS);
  } else if (d.stage === "pick") {
    const rand = randomOf(s, env);
    const g = (pid: string): { g: Gesture; at: number } => {
      const own = d.picks[pid];
      if (own) return own;
      const auto = GESTURES[Math.floor(rand() * 3)] as Gesture;
      d.auto[pid] = auto;
      return { g: auto, at: Infinity };
    };
    const a = g(d.a);
    const b = g(d.b);
    resolveRound(d, a.g, b.g, a.at - d.stageAt, b.at - d.stageAt, rand);
    d.stage = "show";
    d.stageAt = d.stageEnds;
    d.stageEnds = d.stageAt + tempoMs(s, RPS_SHOW_MS);
  } else if (d.stage === "show") {
    if (d.winner !== null) endDuel(s, env, d.winner, t);
    else {
      d.roundNo += 1;
      d.picks = {};
      d.auto = {};
      d.stage = "pick";
      d.stageAt = d.stageEnds;
      d.stageEnds = d.stageAt + tempoMs(s, RPS_PICK_MS);
    }
  }
  urgentAll(s);
  env.changed();
}

// ------------------------------------------------------------------ цикл

export function tick(s: MatState, env: Env): void {
  const t = gameNow(s, env);
  s.lastTick = t;
  syncPresence(s, env);
  if (s.phase === "trial") trialTick(s, env, t);
  else if (s.phase === "chance") chanceTick(s, env, t);
  else if (s.phase === "dobivka") dobivkaTick(s, env, t);
  else if (s.phase === "final") finalTick(s, env, t);
}

// ------------------------------------------------------------------ ввод телефонов

/**
 * Пачка телефона. Ответ — было ли принятое игровое действие (для `room_play`: баллы ведущему). Мусор, ввод не в свой шаг,
 * «я на связи» — нет.
 */
export function input(s: MatState, pid: string, events: InEvent[], env: Env): boolean {
  const m = s.members[pid];
  if (!m || m.gone) return false;
  const now = gameNow(s, env);
  let played = false;
  for (const e of events) {
    const te = eventTime(s, env, e);
    if (handle(s, m, e, te, now, claimedTime(s, env, e))) played = true;
  }
  if (played) s.rt.urgent.add(pid);
  env.changed();
  return played;
}

/** `te` — время события для игры (`delayed` — приход), `claimed` — заявленное (для сверки реакции с часами сервера). */
function handle(s: MatState, m: Member, e: InEvent, te: number, now: number, claimed: number): boolean {
  const tr = s.trial;
  const play = tr?.play ?? null;
  const player = m.role === "player" && !m.removed;
  switch (e.t) {
    case "guess": {
      if (s.phase !== "trial" || !tr || m.role !== "fan" || !s.content.fanBets || tr.kind === "rope") return false;
      if (tr.stage !== "open" && tr.stage !== "rules") return false;
      const n = finite(e.n);
      if (n === null) return false;
      tr.guesses[m.pid] = Math.max(0, Math.min(inGame(s).length, Math.round(n)));
      return true;
    }
    case "h": {
      if (!player || play?.kind !== "freeze" || tr?.stage !== "play") return false;
      const r = play.runners[m.pid];
      if (!r) return false;
      return holdEvent(play, r, e.on === true, te, now);
    }
    case "box": {
      if (!player || play?.kind !== "ginger" || tr?.stage !== "play") return false;
      const r = play.runners[m.pid];
      return r ? boxEvent(play, r, e.n, now) : false;
    }
    case "g": {
      if (!player || play?.kind !== "ginger" || (tr?.stage !== "play" && tr?.stage !== "judging")) return false;
      const r = play.runners[m.pid];
      return r ? pieceEvent(play, r, { c: e.c, crack: e.crack }, Math.min(te, play.traceEnds)) : false;
    }
    case "sit": {
      if (!player || play?.kind !== "chairs" || tr?.stage !== "play") return false;
      const r = play.rounds[play.round];
      if (!r) return false;
      // Реакция — по телефону (L14), но сходится с часами сервера: показ по телефону ≈ появление стульев (аудит 3a).
      const rt = finite(e.rt);
      if (rt === null || !reactionFits(rt, claimed, r.appearAt, e)) return false;
      return sitEvent(r, m.pid, e.rt, te, now);
    }
    case "tap": {
      if (play?.kind !== "rope" || tr?.stage !== "play") return false;
      if (m.role === "fan") ropeAddFan(play, m.pid, now);
      else if (!player) return false;
      return tapEvent(play, m.pid, e.n, te);
    }
    case "brave": {
      if (!player || play?.kind !== "hopscotch" || tr?.stage !== "play") return false;
      const r = play.rows[play.row];
      const rt = finite(e.rt);
      if (!r || rt === null || !reactionFits(rt, claimed, r.braveAt, e)) return false;
      return braveEvent(r, m.pid, e.rt, te, e.delayed);
    }
    case "cell": {
      if (s.phase === "dobivka") {
        const d = s.dobivka;
        const r = d?.rows.at(-1);
        if (!d || !r || !player || r.fell !== null || now >= r.chooseEnds || d.fallen[m.pid] !== undefined) return false;
        if (e.side !== "L" && e.side !== "R") return false;
        r.picks[m.pid] = e.side as Side;
        return true;
      }
      if (!player || play?.kind !== "hopscotch" || tr?.stage !== "play") return false;
      const r = play.rows[play.row];
      return r ? cellEvent(play, r, m.pid, e.side, now) : false;
    }
    case "ans": {
      const c = s.chance;
      if (s.phase !== "chance" || !c || c.stage !== "question" || !c.eligible.includes(m.pid) || c.answers[m.pid]) return false;
      const i = finite(e.i);
      const rt = finite(e.rt);
      const q = questionsOf(s.content)[c.question];
      if (i === null || rt === null || !q || !Number.isInteger(i) || i < 0 || i >= q.options.length || rt < CHANCE_MIN_RT) return false;
      const ends = c.stageEnds ?? 0;
      // Реакция — от показа вопроса и сходится с часами сервера; ответ — до конца вопроса (с запасом часов), пришёл — не позже
      // конца + 1 с (аудит 3a: раньше проходили «на 9,5 с с реакцией 300 мс» и ответ через 1,4 с после конца).
      if (rt > ends - c.stageAt + REACT_CLOCK_MS || !reactionFits(rt, claimed, c.stageAt, e)) return false;
      if (claimed < c.stageAt - SIT_EARLY_MS || claimed > ends + stampSlack(e) || now > ends + CHANCE_GRACE_MS) return false;
      c.answers[m.pid] = { i, rt: Math.round(rt) };
      return true;
    }
    case "bet": {
      const d = s.final?.duel;
      // Ставка — на сторону дуэли (0 — первый, 1 — второй): телефону не нужны чужие pid.
      if (s.phase !== "final" || !d || d.stage !== "bets" || m.role !== "fan" || (e.side !== 0 && e.side !== 1)) return false;
      d.bets[m.pid] = e.side === 0 ? d.a : d.b;
      return true;
    }
    case "rps": {
      const d = s.final?.duel;
      if (s.phase !== "final" || !d || d.stage !== "pick" || (m.pid !== d.a && m.pid !== d.b)) return false;
      if (e.g !== "r" && e.g !== "p" && e.g !== "s") return false;
      if (now >= (d.stageEnds ?? 0)) return false;
      d.picks[m.pid] = { g: e.g, at: Math.max(te, d.stageAt) };
      return true;
    }
    default:
      return false;
  }
}

// ------------------------------------------------------------------ команды пульта

export function moment(s: MatState): string {
  let stage = "-";
  let x = "-";
  if (s.phase === "trial") stage = s.trial?.stage ?? "-";
  else if (s.phase === "chance") stage = s.chance?.stage ?? "-";
  else if (s.phase === "dobivka") stage = s.dobivka?.stage ?? "-";
  else if (s.phase === "final") {
    stage = s.final?.stage ?? "-";
    x = `${s.final?.duels ?? 0}${s.final?.duel ? `.${s.final.duel.stage}.${s.final.duel.roundNo}` : ""}`;
  }
  return `${s.phase}:${s.trialIndex}:${stage}:${x}:${s.attempt}${s.rev > 0 ? `#${s.rev}` : ""}`;
}

/** Какие команды пульта доступны сейчас (пульт показывает только их). */
export function available(s: MatState): Record<string, boolean> {
  const tr = s.trial;
  const trialStage = s.phase === "trial" ? (tr?.stage ?? null) : null;
  const playKind = trialStage === "play" ? (tr?.play?.kind ?? null) : null;
  const between = trialStage === "results" || (s.phase === "chance" && s.chance?.stage === "done");
  const ahead = tr !== null && tr.index + 1 < s.plan.length;
  const d = s.final?.duel ?? null;
  const ginger = playKind === "ginger" && tr?.play?.kind === "ginger" ? gingerSub(tr.play, s.lastTick ?? 0) : null;
  return {
    start: s.phase === "lobby" && activeLobby(s).length >= MIN_PLAYERS,
    "skip-rules": trialStage === "rules",
    next: between || (s.phase === "dobivka" && s.dobivka?.stage === "results"),
    chance: chanceAvailable(s),
    "skip-trial": trialStage === "open" || trialStage === "rules",
    "more-time": playKind === "freeze" || (playKind === "ginger" && ginger !== "over"),
    "end-now": playKind === "freeze" || ginger === "trace" || playKind === "rope" || playKind === "hopscotch",
    back: trialStage === "reveal" || trialStage === "results" || s.phase === "chance" || (s.phase === "dobivka" && s.dobivka?.stage === "results") || (s.phase === "final" && s.final?.stage === "bracket"),
    return: ((between && ahead) || trialStage === "rules") && Object.values(s.members).some((m) => canReturn(m)),
    // После последней дуэли места финала не меняются: чемпиона и пьедестал «Убрать» не трогает.
    remove: s.phase !== "lobby" && s.phase !== "podium" && s.phase !== "finished" && !(s.phase === "final" && s.final?.stage === "champion"),
    "to-final": (between || trialStage === "rules") && inGame(s).length <= s.F,
    duel: s.phase === "final" && (s.final?.stage === "bracket" || (s.final?.stage === "duel" && d?.stage === "over")),
    rerun: s.phase === "final" && (d?.stage === "pick" || d?.stage === "show"),
    forfeit: s.phase === "final" && d !== null && d.stage !== "over" && s.final?.stage === "duel",
    podium: s.phase === "final" && s.final?.stage === "champion",
    finish: s.phase === "podium",
    board: s.phase !== "lobby",
  };
}

function activeLobby(s: MatState): Member[] {
  return Object.values(s.members).filter((m) => !m.gone);
}

/** Кого можно «Вернуть»: выбывших игрой и убранных (не опоздавших и не ушедших). Тот же список — у пульта (`returnable`). */
export function canReturn(m: Member): boolean {
  return m.role === "fan" && !m.late && !m.gone && (m.everOut || m.removed);
}

/** Убрать игрока из игры (пульт или ушёл): болельщик без монеты; дуэлянт — соперник проходит. */
function dropPlayer(s: MatState, m: Member, env: Env): void {
  removePlayer(s, m);
  const play = s.trial?.play;
  if (play?.kind === "rope") delete play.sides[m.pid];
  const d = s.final?.duel;
  if (s.phase === "final" && d && d.stage !== "over" && (d.a === m.pid || d.b === m.pid)) {
    d.forfeit = true;
    endDuel(s, env, d.a === m.pid ? d.b : d.a, gameNow(s, env));
  }
  s.rt.urgent.add(m.pid);
}

export function command(s: MatState, cmd: string, raw: unknown, env: Env): Outcome {
  const before = moment(s);
  const out = runCommand(s, cmd, raw, env);
  // Этап не сменился («+10 секунд», «Табло», «Вернуть»…) — счётчик в `moment`: второе касание со старым этапом — `moved`.
  if (out.ok && moment(s) === before) s.rev += 1;
  return out;
}

function runCommand(s: MatState, cmd: string, raw: unknown, env: Env): Outcome {
  const a = record(raw);
  const t = gameNow(s, env);
  const can = available(s);
  if (cmd in can && !can[cmd]) return { ok: false, error: cmd === "start" && s.phase === "lobby" ? "no-players" : "wrong-phase" };
  switch (cmd) {
    case "start": {
      const list = activeLobby(s).sort((x, y) => x.num - y.num);
      list.forEach((m, i) => {
        if (i < MAX_PLAYERS) {
          m.role = "player";
          m.hearts = s.content.lives;
        } else {
          m.role = "fan";
          m.late = true;
          m.fanSince = -1;
        }
      });
      s.startCount = Math.min(MAX_PLAYERS, list.length);
      s.F = finalistsFor(s.content.finalists, s.startCount);
      s.plan = planOf(s.content);
      s.playedTrials = s.plan.map(() => false);
      s.trialSizes = s.plan.map(() => 0);
      for (const m of Object.values(s.members)) m.places = s.plan.map(() => null);
      openTrial(s, env, 0, t);
      return { ok: true, result: { finalists: s.F } };
    }
    case "skip-rules": {
      const tr = s.trial as TrialState;
      setTrialStage(tr, "countdown", t, tempoMs(s, COUNTDOWN_MS));
      break;
    }
    case "next": {
      if (s.phase === "dobivka") toFinal(s, env, t);
      else openTrial(s, env, s.trialIndex + 1, t);
      return { ok: true, result: s.phase };
    }
    case "chance":
      startChance(s, env, t);
      return { ok: true };
    case "skip-trial": {
      const tr = s.trial as TrialState;
      s.playedTrials[tr.index] = false;
      openTrial(s, env, tr.index + 1, t);
      return { ok: true, result: s.phase };
    }
    case "more-time": {
      const p = s.trial?.play;
      if (p?.kind === "freeze") {
        if (p.extra + MORE_TIME_MS > MORE_TIME_MAX_MS) return { ok: false, error: "limit" };
        freezeMore(p, randomOf(s, env), MORE_TIME_MS);
      } else if (p?.kind === "ginger") {
        if (p.extra + MORE_TIME_MS > MORE_TIME_MAX_MS) return { ok: false, error: "limit" };
        p.extra += MORE_TIME_MS;
        p.traceEnds += MORE_TIME_MS;
      }
      break;
    }
    case "end-now": {
      const p = s.trial?.play;
      if (p?.kind === "freeze") freezeEndNow(p, t);
      else if (p?.kind === "ginger") p.traceEnds = Math.max(p.unboxEnds, Math.min(p.traceEnds, t));
      else if (p?.kind === "rope") ropeEndNow(p, t, randomOf(s, env));
      else if (p?.kind === "hopscotch") p.stop = true;
      break;
    }
    case "back":
      return back(s, env, t);
    case "return": {
      const m = typeof a.pid === "string" ? s.members[a.pid] : undefined;
      if (!m) return { ok: false, error: "no-player" };
      if (!canReturn(m)) return { ok: false, error: "not-out" };
      bringBack(m);
      // Вернули на `rules` — после точки `base`: перезапуск сервера (откат к `base`) возвращает его снова; «Назад» к `open` — нет.
      if (s.phase === "trial" && (s.trial?.stage === "open" || s.trial?.stage === "rules")) s.trialReturns = [...s.trialReturns.filter((x) => x !== m.pid), m.pid];
      s.rt.urgent.add(m.pid);
      break;
    }
    case "remove": {
      const m = typeof a.pid === "string" ? s.members[a.pid] : undefined;
      if (!m) return { ok: false, error: "no-player" };
      if (m.role !== "player") return { ok: false, error: "not-player" };
      dropPlayer(s, m, env);
      break;
    }
    case "to-final":
      toFinal(s, env, t);
      return { ok: true, result: s.phase };
    case "duel":
      return startDuel(s, env, t);
    case "rerun": {
      const d = s.final?.duel;
      if (!d) return { ok: false, error: "wrong-phase" };
      // Раунд заново: если уже подведён (показ) — снимаем его итог.
      if (d.stage === "show") {
        const last = d.history.pop();
        if (last?.winner === d.a) d.wins[0] -= 1;
        if (last?.winner === d.b) d.wins[1] -= 1;
        if (last) d.ties = last.ties;
        d.winner = null;
      }
      d.picks = {};
      d.auto = {};
      d.stage = "pick";
      d.stageAt = t;
      d.stageEnds = t + tempoMs(s, RPS_PICK_MS);
      break;
    }
    case "forfeit": {
      const d = s.final?.duel;
      if (!d || (a.pid !== d.a && a.pid !== d.b)) return { ok: false, error: "no-player" };
      d.forfeit = true;
      endDuel(s, env, a.pid === d.a ? d.b : d.a, t);
      break;
    }
    case "podium":
      s.phase = "podium";
      s.podiumAt = t;
      env.checkpoint();
      break;
    case "finish":
      s.phase = "finished";
      env.checkpoint();
      break;
    case "board":
      s.board = !s.board;
      break;
    default:
      return { ok: false, error: "unknown-command" };
  }
  urgentAll(s);
  env.changed();
  return { ok: true };
}

/**
 * Точка «Назад» могла быть записана на шаге с отсчётом («К финалу» с `rules`): отсчёт этого шага — заново, с полной длиной
 * (аудит 3a: иначе испытание проскакивало отсчёт, и места решал жребий).
 */
function restartStage(s: MatState, t: number): void {
  const tr = s.trial;
  if (s.phase !== "trial" || !tr) return;
  if (tr.stage === "open") setTrialStage(tr, "open", t, tempoMs(s, OPEN_MS));
  else if (tr.stage === "rules") setTrialStage(tr, "rules", t, tempoMs(s, RULES_MS));
  else if (tr.stage === "countdown") setTrialStage(tr, "countdown", t, tempoMs(s, COUNTDOWN_MS));
}

/** «Назад»: к началу испытания; со «Второго шанса» — к итогам 3-го; с итогов «Добивки» и сетки — к точке перед ними. */
function back(s: MatState, env: Env, t: number): Outcome {
  if (s.phase === "final" && s.finalBase) {
    const point = s.finalBase;
    s.finalBase = null;
    loadPoint(s, point, env);
    s.final = null;
    restartStage(s, t);
    return { ok: true, result: s.phase };
  }
  if (s.phase === "dobivka" && s.dobBase) {
    const point = s.dobBase;
    s.dobBase = null;
    loadPoint(s, point, env);
    s.dobivka = null;
    restartStage(s, t);
    return { ok: true, result: s.phase };
  }
  if (s.phase === "chance" && s.chanceBase) {
    const point = s.chanceBase;
    s.chanceBase = null;
    loadPoint(s, point, env);
    s.chance = null;
    s.chanceUsed = false;
    restartStage(s, t);
    return { ok: true, result: s.phase };
  }
  if (s.phase === "trial" && s.base) {
    loadPoint(s, s.base, env);
    s.chanceBase = null;
    s.dobBase = null;
    s.finalBase = null;
    const tr = s.trial;
    if (tr) setTrialStage(tr, "open", t, tempoMs(s, OPEN_MS));
    return { ok: true, result: s.phase };
  }
  return { ok: false, error: "wrong-phase" };
}

// ------------------------------------------------------------------ баллы ведущему

/** Раунд для `room_play`: испытание (0–4), «Второй шанс», «Добивка», финал. Лобби, итоги, пьедестал — null. */
export function playUnit(s: MatState): number | null {
  if (s.phase === "trial") {
    const st = s.trial?.stage;
    return st === "open" || st === "rules" || st === "countdown" || st === "play" || st === "judging" ? s.trialIndex : null;
  }
  if (s.phase === "chance") return s.chance?.stage === "question" ? UNIT_CHANCE : null;
  if (s.phase === "dobivka") return s.dobivka?.stage === "rows" ? UNIT_DOBIVKA : null;
  if (s.phase === "final") return s.final?.stage === "duel" ? UNIT_FINAL : null;
  return null;
}

/** «Сыграна до конца» (решение владельца 8): пройдены чемпион и пьедестал и сыграно не меньше 3 испытаний. */
export function playedToEnd(s: MatState): boolean {
  return (s.phase === "podium" || s.phase === "finished") && s.podiumAt !== null && s.playedTrials.filter(Boolean).length >= PLAYED_TRIALS_MIN;
}

// ------------------------------------------------------------------ пауза, снимок

/** Пауза: время игры встаёт; в «Замри!» все «отпустили» (L7). */
export function pause(s: MatState, env: Pick<Env, "now">): void {
  s.pausedGame = env.now - s.offset;
  const p = s.trial?.play;
  if (p?.kind === "freeze" && s.trial?.stage === "play") freezePause(p, s.pausedGame);
  urgentAll(s);
}

/** Продолжение: время игры — с того места, где встало (как у «Бубликатора»); события раньше — не раньше этого. */
export function resume(s: MatState, pausedMs: number, env: Pick<Env, "now">): void {
  const frozen = s.pausedGame ?? s.lastTick;
  if (typeof frozen === "number" && Number.isFinite(frozen)) s.offset = env.now - frozen;
  else s.offset += Math.max(0, pausedMs);
  s.pausedGame = null;
  s.floor = env.now - s.offset;
  s.lastTick = s.floor;
  // После перезапуска пауза без `onPause`: удержание «Замри!» тоже отпущено.
  const p = s.trial?.play;
  if (p?.kind === "freeze") for (const r of Object.values(p.runners)) r.holding = false;
  urgentAll(s);
}

export function snapshot(s: MatState): unknown {
  return persist(s);
}

/**
 * После перезапуска сервера (комната — на паузе): шаг, который «шёл», возвращается к началу. Испытание — к точке `base` и
 * снова отсчёт (прогнозы остаются, случайность — новая); вопрос «Второго шанса» — снова `offer`; ряд «Добивки» и раунд дуэли
 * — заново. Вскрытие, итоги, сетка — как были.
 */
function rewindLive(s: MatState): void {
  const tf = s.pausedGame ?? s.lastTick ?? 0;
  const tr = s.trial;
  if (s.phase === "trial" && tr && (tr.stage === "countdown" || tr.stage === "play" || tr.stage === "judging") && s.base) {
    const guesses = tr.guesses;
    // «Вернуть» на `rules` было после точки `base`: вернувшиеся (если их с тех пор не убрали) — снова в игре.
    const returned = (s.trialReturns ?? []).filter((pid) => s.members[pid]?.role === "player");
    applyPoint(s, s.base);
    for (const pid of returned) {
      const m = s.members[pid];
      if (m && canReturn(m)) bringBack(m);
    }
    s.trialReturns = returned;
    if (s.trial) {
      s.trial.guesses = guesses;
      setTrialStage(s.trial, "countdown", tf, tempoMs(s, COUNTDOWN_MS));
    }
    return;
  }
  const c = s.chance;
  if (s.phase === "chance" && c && c.stage === "question") {
    c.stage = "offer";
    c.stageAt = tf;
    c.stageEnds = tf + tempoMs(s, CHANCE_OFFER_MS);
    c.answers = {};
    s.attempt += 1;
    return;
  }
  const d = s.dobivka;
  const row = d?.rows.at(-1);
  if (s.phase === "dobivka" && d && row && row.fell === null) {
    row.chooseAt = tf;
    row.chooseEnds = tf + tempoMs(s, CHOOSE_MS);
    row.crackEnds = row.chooseEnds + tempoMs(s, CRACK_MS);
    row.picks = {};
    s.attempt += 1;
    return;
  }
  const duel = s.final?.duel;
  // Ставки перед дуэлью — заново с полным временем, сделанные ставки остаются (аудит 3a: раньше сразу выбор жестов, ставки терялись).
  if (s.phase === "final" && duel && duel.stage === "bets") {
    duel.stageAt = tf;
    duel.stageEnds = tf + tempoMs(s, BETS_MS);
    s.attempt += 1;
    return;
  }
  if (s.phase === "final" && duel && duel.stage === "pick") {
    duel.picks = {};
    duel.auto = {};
    duel.stage = "pick";
    duel.stageAt = tf;
    duel.stageEnds = tf + tempoMs(s, RPS_PICK_MS);
    s.attempt += 1;
  }
}

/** Состояние из снимка; не тот формат — null (комната начнётся заново). */
export function restore(data: unknown): MatState | null {
  const d = record(data);
  if (d.v !== 1 || typeof d.phase !== "string" || !(PHASES as readonly string[]).includes(d.phase)) return null;
  if (typeof d.members !== "object" || d.members === null || !Array.isArray(d.plan) || !Array.isArray(d.playedTrials)) return null;
  for (const key of ["joinSeq", "trialIndex", "F", "piggy", "outSeq", "attempt", "offset", "floor", "rng"]) if (finite(d[key]) === null) return null;
  for (const m of Object.values(d.members as Record<string, unknown>)) {
    const r = record(m);
    if (typeof r.pid !== "string" || finite(r.num) === null || !Array.isArray(r.places)) return null;
  }
  const s = { ...(d as unknown as Persisted), content: parseContent(d.content), rt: freshRuntime() } as MatState;
  if (typeof s.pausedGame !== "number") s.pausedGame = null;
  if (typeof s.lastTick !== "number") s.lastTick = null;
  if (!Array.isArray(s.trialSizes)) s.trialSizes = s.plan.map(() => 0);
  if (typeof s.rev !== "number" || !Number.isFinite(s.rev)) s.rev = 0;
  if (!Array.isArray(s.trialReturns)) s.trialReturns = [];
  rewindLive(s);
  urgentAll(s);
  return s;
}

