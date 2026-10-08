// Ход «Мафии» на пульте. Всё, что видят все (кто жив, кто выбыл, голосование), — в state.result.
// Тайное — роли и ночные выборы — только в ответах телефонов (их видит пульт) и в зашифрованных
// карточках `sealed` / `whisper` (открывает только телефон со своим ключом, см. seal.ts).
import { leaderboardAdditions } from "../../core/leaderboard";
import type { Answer, LeaderboardEntry, Participant, Session, SessionChange } from "../../data/types";
import type { ScoreDelta, Step } from "../types";
import { ROLES, type MafiaContent, type RoleCounts, type RoleId } from "./content";

export type MafiaMode = "deal" | "roles" | "day" | "vote" | "verdict" | "night" | "morning" | "over";

export interface Death {
  pid: string;
  round: number;
  by: "night" | "vote";
  /** Роль выбывшего — только если в игре открывают роли. */
  role?: RoleId;
}

export interface MafiaResult {
  mode: MafiaMode;
  /** Номер дня (ночь после него — тот же номер). */
  round: number;
  /** Игроки за столом по порядку: номер игрока = место + 1. */
  seats: string[];
  alive: string[];
  /** Шаг раздачи: ответы этого шага — ключи телефонов. */
  dealStep: number | null;
  /** Карта роли каждого игрока, зашифрованная его ключом. */
  sealed: Record<string, string>;
  /** Роли игроков без телефона — ключом ведущего (на его устройстве). */
  hostSeal: string | null;
  /** Ночные подсказки — у всех живых одинаковой длины, чтобы никого не выдать. */
  whisper: Record<string, string>;
  /** Шаги прошлых ночей с действиями: по ним пульт знает, кого лечил Доктор. */
  nights: number[];
  /** Сколько живых уже нажали ночью или проголосовали (для экрана; без имён). */
  done: number;
  /** Утро: кого убили ночью (null — ночь прошла спокойно). */
  killed: string | null;
  /** Кто говорит и до какого времени (часы сервера). */
  speaker: string | null;
  speakEndsAt: number | null;
  speakKind: "speech" | "last" | null;
  nominees: string[];
  /** Итог голосования: голоса за каждого и «никого» (`none`). */
  tally: Record<string, number> | null;
  /** Это переголосование между равными. */
  revote: boolean;
  /** Кого выгнали днём. */
  out: string | null;
  deaths: Death[];
  winner: "city" | "mafia" | null;
  /** Все роли — открываются в конце. */
  reveal: Record<string, RoleId> | null;
  /** Ночью ответ можно менять (семья договаривается) — сервер перезаписывает ответ. */
  changeable: boolean;
  /** «Назад»: прежний шаг и итог (один шаг). */
  undo: { step: number; stage: string; result: Omit<MafiaResult, "undo"> } | null;
}

export type MafiaAnswerValue = { key: string } | { target?: string; check?: string } | { vote: string };

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

const MODES: MafiaMode[] = ["deal", "roles", "day", "vote", "verdict", "night", "morning", "over"];
const ROLE_IDS: RoleId[] = ["mafia", "don", "commissar", "doctor", "civilian"];

export function isRole(value: unknown): value is RoleId {
  return typeof value === "string" && (ROLE_IDS as string[]).includes(value);
}

export function emptyResult(): MafiaResult {
  return {
    mode: "deal",
    round: 0,
    seats: [],
    alive: [],
    dealStep: null,
    sealed: {},
    hostSeal: null,
    whisper: {},
    nights: [],
    done: 0,
    killed: null,
    speaker: null,
    speakEndsAt: null,
    speakKind: null,
    nominees: [],
    tally: null,
    revote: false,
    out: null,
    deaths: [],
    winner: null,
    reveal: null,
    changeable: false,
    undo: null,
  };
}

function withoutUndo(r: MafiaResult): Omit<MafiaResult, "undo"> {
  const { undo: _undo, ...rest } = r;
  return rest;
}

export function parseMafiaResult(raw: unknown): MafiaResult {
  const d = record(raw);
  const base = emptyResult();
  const tally: Record<string, number> = {};
  for (const [k, v] of Object.entries(record(d.tally))) if (typeof v === "number") tally[k] = v;
  const reveal: Record<string, RoleId> = {};
  for (const [k, v] of Object.entries(record(d.reveal))) if (isRole(v)) reveal[k] = v;
  const undo = record(d.undo);
  return {
    mode: MODES.includes(d.mode as MafiaMode) ? (d.mode as MafiaMode) : base.mode,
    round: typeof d.round === "number" ? d.round : 0,
    seats: strings(d.seats),
    alive: strings(d.alive),
    dealStep: typeof d.dealStep === "number" ? d.dealStep : null,
    sealed: stringMap(d.sealed),
    hostSeal: typeof d.hostSeal === "string" ? d.hostSeal : null,
    whisper: stringMap(d.whisper),
    nights: Array.isArray(d.nights) ? d.nights.filter((n): n is number => typeof n === "number") : [],
    done: typeof d.done === "number" ? d.done : 0,
    killed: typeof d.killed === "string" ? d.killed : null,
    speaker: typeof d.speaker === "string" ? d.speaker : null,
    speakEndsAt: typeof d.speakEndsAt === "number" ? d.speakEndsAt : null,
    speakKind: d.speakKind === "speech" || d.speakKind === "last" ? d.speakKind : null,
    nominees: strings(d.nominees),
    tally: Object.keys(tally).length > 0 ? tally : null,
    revote: d.revote === true,
    out: typeof d.out === "string" ? d.out : null,
    deaths: Array.isArray(d.deaths)
      ? d.deaths.flatMap((x) => {
          const r = record(x);
          if (typeof r.pid !== "string") return [];
          const death: Death = { pid: r.pid, round: typeof r.round === "number" ? r.round : 0, by: r.by === "vote" ? "vote" : "night" };
          if (isRole(r.role)) death.role = r.role;
          return [death];
        })
      : [],
    winner: d.winner === "city" || d.winner === "mafia" ? d.winner : null,
    reveal: Object.keys(reveal).length > 0 ? reveal : null,
    changeable: d.changeable === true,
    undo: typeof undo.step === "number" && typeof undo.stage === "string" ? { step: undo.step, stage: undo.stage, result: withoutUndo(parseMafiaResult(undo.result)) } : null,
  };
}

export function mafiaSteps(): Step[] {
  return [];
}

export function score(): ScoreDelta[] {
  return [];
}

// ---------------------------------------------------------------- роли

/** Игроки за столом: по порядку входа; добавленные ведущим без телефона — в конце. */
export function seatsOf(session: Session, participants: Participant[]): string[] {
  const players = participants.filter((p) => p.kind === "player");
  const joined = new Map(players.map((p) => [p.id, p.joinedAt ?? 0]));
  const ids = new Set([...Object.keys(session.leaderboard), ...players.map((p) => p.id)]);
  return [...ids].sort((a, b) => (joined.get(a) ?? Number.MAX_SAFE_INTEGER) - (joined.get(b) ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b));
}

/** Случайная раздача ролей. `random` — 0..1 (в тестах — свой). */
export function dealRoles(seats: string[], counts: RoleCounts, random: () => number = Math.random): Record<string, RoleId> {
  const bag: RoleId[] = [];
  const add = (role: RoleId, n: number) => {
    for (let i = 0; i < n; i++) bag.push(role);
  };
  add("don", counts.don);
  add("mafia", counts.mafia);
  add("commissar", counts.commissar);
  add("doctor", counts.doctor);
  const shuffled = [...seats];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j] as string, shuffled[i] as string];
  }
  const roles: Record<string, RoleId> = {};
  shuffled.forEach((pid, i) => {
    roles[pid] = bag[i] ?? "civilian";
  });
  return roles;
}

export function isMafia(role: RoleId | undefined): boolean {
  return role === "mafia" || role === "don";
}

/** Что лежит в карте роли (шифруется ключом телефона). */
export interface RoleCard {
  role: RoleId;
  /** Номер за столом. */
  seat: number;
  /** Мафии и Дону — своя семья: id, имена, роли. */
  family: Array<{ pid: string; name: string; role: RoleId }>;
}

/** Ночная подсказка (шифруется): что видит телефон после своего выбора. */
export interface Whisper {
  /** Мафии и Дону — кого выбрал каждый из семьи (голоса над игроками). */
  family?: Record<string, string | null>;
  /** Дону — проверка на Комиссара, Комиссару — на мафию. */
  check?: { target: string; yes: boolean } | null;
  /** Доктору — кого лечил прошлой ночью и лечил ли себя. */
  lastHeal?: string | null;
  selfHealed?: boolean;
}

/** Длина, до которой добиваются все карты и подсказки: по размеру шифра роль не угадать. */
export const PAD_TO = 900;

/** Добить данные точками до длины `to` (в JSON): все карты и подсказки одной длины. */
export function padded<T extends object>(data: T, to: number = PAD_TO): T & { _: string } {
  const plain = JSON.stringify({ ...data, _: "" });
  return { ...data, _: ".".repeat(Math.max(0, to - plain.length)) };
}

/** Добить все записи до общей длины: не меньше PAD_TO и не меньше самой длинной (большая семья мафии). */
export function paddedAll<T extends object>(items: Record<string, T>): Record<string, T & { _: string }> {
  const longest = Math.max(PAD_TO, ...Object.values(items).map((d) => JSON.stringify({ ...d, _: "" }).length));
  const out: Record<string, T & { _: string }> = {};
  for (const [k, d] of Object.entries(items)) out[k] = padded(d, longest);
  return out;
}

export function roleCard(pid: string, roles: Record<string, RoleId>, seats: string[], names: Record<string, string>): RoleCard {
  const role = roles[pid] ?? "civilian";
  const family = isMafia(role) ? seats.filter((p) => p !== pid && isMafia(roles[p])).map((p) => ({ pid: p, name: names[p] ?? "Игрок", role: roles[p] as RoleId })) : [];
  return { role, seat: seats.indexOf(pid) + 1, family };
}

// ---------------------------------------------------------------- ночь

export interface NightOutcome {
  /** Выбор мафии (до лечения). */
  mafiaTarget: string | null;
  healed: string | null;
  /** Кто убит (выбор мафии, если Доктор не спас). */
  victim: string | null;
  donCheck: { target: string; yes: boolean } | null;
  comCheck: { target: string; yes: boolean } | null;
}

/** Цель ночного действия из ответа. */
export function targetOf(value: unknown): string | null {
  const t = record(value).target;
  return typeof t === "string" ? t : null;
}

/** Проверка Дона (вторая цель в его ответе). */
export function checkOf(value: unknown): string | null {
  const t = record(value).check;
  return typeof t === "string" ? t : null;
}

/** Голоса семьи: за кого сколько живых мафиози (видят только сами мафиози). */
export function familyVotes(roles: Record<string, RoleId>, alive: string[], choices: Record<string, string | null>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const pid of alive) {
    if (!isMafia(roles[pid])) continue;
    const t = choices[pid];
    if (t && alive.includes(t)) counts[t] = (counts[t] ?? 0) + 1;
  }
  return counts;
}

/**
 * Выбор мафии: убийство состоится, только если все живые мафиози (с Доном) выбрали одного и того же.
 * Разошлись или кто-то не выбрал — промах.
 */
export function mafiaChoice(roles: Record<string, RoleId>, alive: string[], choices: Record<string, string | null>): string | null {
  const family = alive.filter((p) => isMafia(roles[p]));
  if (family.length === 0) return null;
  const first = choices[family[0] as string];
  if (!first || !alive.includes(first)) return null;
  return family.every((p) => choices[p] === first) ? first : null;
}

/** Можно ли Доктору лечить этого игрока: не того же, что прошлой ночью; себя — один раз за игру. */
export function canHeal(doctor: string, target: string, history: Array<string | null>): boolean {
  const last = history[history.length - 1] ?? null;
  if (target === last) return false;
  if (target === doctor && history.includes(doctor)) return false;
  return true;
}

/**
 * Итог ночи. `choices` — цель каждого живого (мафия — выстрел, Доктор — лечение, Комиссар — проверка),
 * `donCheck` — отдельная проверка Дона (его `target` — голос в семье).
 */
export function resolveNight(roles: Record<string, RoleId>, alive: string[], choices: Record<string, string | null>, healHistory: Array<string | null>, donCheck: string | null = null): NightOutcome {
  const living = (role: RoleId) => alive.find((p) => roles[p] === role) ?? null;
  const mafiaTarget = mafiaChoice(roles, alive, choices);
  const doctor = living("doctor");
  const healWanted = doctor ? choices[doctor] : null;
  const healed = doctor && healWanted && alive.includes(healWanted) && canHeal(doctor, healWanted, healHistory) ? healWanted : null;
  const don = living("don");
  const donT = don ? donCheck : null;
  const commissar = living("commissar");
  const comT = commissar ? choices[commissar] : null;
  return {
    mafiaTarget,
    healed,
    victim: mafiaTarget && mafiaTarget !== healed ? mafiaTarget : null,
    donCheck: donT && alive.includes(donT) && donT !== don ? { target: donT, yes: roles[donT] === "commissar" } : null,
    comCheck: comT && alive.includes(comT) && comT !== commissar ? { target: comT, yes: isMafia(roles[comT]) } : null,
  };
}

/** Победа: мафии не осталось — город; мафии не меньше остальных — мафия. */
export function winnerOf(roles: Record<string, RoleId>, alive: string[]): "city" | "mafia" | null {
  const family = alive.filter((p) => isMafia(roles[p])).length;
  if (family === 0) return "city";
  if (family >= alive.length - family) return "mafia";
  return null;
}

// ---------------------------------------------------------------- голосование

export function voteOf(value: unknown): string | null {
  const v = record(value).vote;
  return typeof v === "string" ? v : null;
}

export interface Tally {
  counts: Record<string, number>;
  /** Кого выгоняют; null — никого (ничья или большинство «никого»). */
  out: string | null;
  /** Равные лидеры (для переголосования). */
  tied: string[];
}

/** Подсчёт: голоса живых за кандидатов или «никого» (`none`). */
export function tallyVotes(answers: Array<{ pid: string; value: unknown }>, nominees: string[], alive: string[]): Tally {
  const counts: Record<string, number> = { none: 0 };
  for (const n of nominees) counts[n] = 0;
  for (const a of answers) {
    if (!alive.includes(a.pid)) continue;
    const v = voteOf(a.value);
    if (v === null || !(v in counts) || v === a.pid) continue;
    counts[v] = (counts[v] ?? 0) + 1;
  }
  const max = Math.max(...nominees.map((n) => counts[n] ?? 0), 0);
  const tied = nominees.filter((n) => (counts[n] ?? 0) === max && max > 0);
  const out = tied.length === 1 && max > (counts.none ?? 0) ? (tied[0] ?? null) : null;
  return { counts, out, tied: out ? [] : tied };
}

/** Ничья между кандидатами (больше нуля голосов у двух и больше) — можно переголосовать. */
export function isTie(tally: Record<string, number> | null, nominees: string[]): boolean {
  if (!tally) return false;
  const max = Math.max(0, ...nominees.map((n) => tally[n] ?? 0));
  return max > 0 && nominees.filter((n) => (tally[n] ?? 0) === max).length > 1;
}

// ---------------------------------------------------------------- ночные выборы на пульте

/** Ночные выборы живых: цель из ответа телефона или из ручного ввода ведущего (игроки без телефона). */
export function nightChoices(answers: Array<{ pid: string; value: unknown }>, alive: string[], manual: Record<string, string> = {}): { choices: Record<string, string | null>; donCheck: Record<string, string | null> } {
  const choices: Record<string, string | null> = {};
  const donCheck: Record<string, string | null> = {};
  for (const a of answers) {
    if (!alive.includes(a.pid)) continue;
    choices[a.pid] = targetOf(a.value);
    donCheck[a.pid] = checkOf(a.value);
  }
  for (const [key, t] of Object.entries(manual)) {
    const pid = key.endsWith("#check") ? key.slice(0, -6) : key;
    if (!alive.includes(pid) || (choices[pid] !== undefined && !key.endsWith("#check"))) continue;
    if (key.endsWith("#check")) donCheck[pid] ??= t;
    else choices[pid] = t;
  }
  return { choices, donCheck };
}

/** Кого лечил Доктор в прошлые ночи (по порядку): нужен для правила «не две ночи подряд». */
export function healHistory(doctor: string | null, pastNights: Array<Record<string, string | null>>): Array<string | null> {
  return doctor ? pastNights.map((c) => c[doctor] ?? null) : [];
}

/** Подсказка каждому живому с телефоном: мафии — голоса семьи, Дону и Комиссару — проверка, Доктору — прошлое лечение. */
export function whispers(roles: Record<string, RoleId>, alive: string[], choices: Record<string, string | null>, donChecks: Record<string, string | null>, history: Array<string | null>): Record<string, Whisper> {
  const out: Record<string, Whisper> = {};
  const familyChoice: Record<string, string | null> = {};
  for (const p of alive) if (isMafia(roles[p])) familyChoice[p] = choices[p] ?? null;
  for (const pid of alive) {
    const role = roles[pid];
    const w: Whisper = {};
    if (isMafia(role)) w.family = familyChoice;
    if (role === "don") {
      const t = donChecks[pid];
      w.check = t && alive.includes(t) && t !== pid ? { target: t, yes: roles[t] === "commissar" } : null;
    }
    if (role === "commissar") {
      const t = choices[pid];
      w.check = t && alive.includes(t) && t !== pid ? { target: t, yes: isMafia(roles[t]) } : null;
    }
    if (role === "doctor") {
      w.lastHeal = history[history.length - 1] ?? null;
      w.selfHealed = history.includes(pid);
    }
    out[pid] = w;
  }
  return out;
}

export function parseWhisper(raw: unknown): Whisper {
  const d = record(raw);
  const w: Whisper = {};
  if (d.family !== undefined) {
    const fam: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(record(d.family))) fam[k] = typeof v === "string" ? v : null;
    w.family = fam;
  }
  const c = record(d.check);
  if (typeof c.target === "string") w.check = { target: c.target, yes: c.yes === true };
  if (typeof d.lastHeal === "string") w.lastHeal = d.lastHeal;
  if (d.selfHealed === true) w.selfHealed = true;
  return w;
}

export function parseRoleCard(raw: unknown): RoleCard | null {
  const d = record(raw);
  if (!isRole(d.role)) return null;
  const family = Array.isArray(d.family)
    ? d.family.flatMap((x) => {
        const f = record(x);
        return typeof f.pid === "string" && isRole(f.role) ? [{ pid: f.pid, name: typeof f.name === "string" ? f.name : "Игрок", role: f.role }] : [];
      })
    : [];
  return { role: d.role, seat: typeof d.seat === "number" ? d.seat : 0, family };
}

// ---------------------------------------------------------------- переходы пульта

function snapshot(session: Session, r: MafiaResult): MafiaResult["undo"] {
  const { undo: _u, ...rest } = r;
  return { step: session.state.step, stage: session.state.stage, result: rest };
}

function names(session: Session): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [pid, e] of Object.entries(session.leaderboard)) out[pid] = e.name;
  return out;
}

export function nameMap(session: Session, participants: Participant[]): Record<string, string> {
  const out = names(session);
  for (const p of participants) if (!out[p.id] && p.kind === "player") out[p.id] = p.name;
  return out;
}

/** «Собрать телефоны»: телефоны присылают свои ключи, игроки садятся за стол по порядку входа. */
export function startDeal(session: Session, participants: Participant[]): SessionChange {
  const additions = leaderboardAdditions(session.leaderboard, participants, "solo");
  const board = { ...session.leaderboard, ...additions };
  const seats = seatsOf({ ...session, leaderboard: board }, participants);
  return {
    leaderboard: additions,
    state: {
      stage: "question",
      startedAt: "server",
      timeLimit: null,
      revealed: false,
      answered: 0,
      result: { ...emptyResult(), mode: "deal", seats, alive: seats, dealStep: session.state.step },
    },
  };
}

/** Роли розданы: у каждого — своя зашифрованная карта. Дальше — ночь знакомства. */
export function dealt(session: Session, sealed: Record<string, string>, hostSeal: string | null): SessionChange {
  const r = parseMafiaResult(session.state.result);
  return { state: { stage: "reveal", revealed: true, result: { ...r, changeable: false, mode: "roles", sealed, hostSeal, undo: null } } };
}

/** «Наступает день»: обсуждение, ведущий даёт слово и выставляет кандидатов. */
export function startDay(session: Session): SessionChange {
  const r = parseMafiaResult(session.state.result);
  return {
    state: {
      stage: "reveal",
      revealed: true,
      result: { ...r, changeable: false, mode: "day", round: r.mode === "roles" ? 1 : r.round + (r.mode === "morning" ? 1 : 0), nominees: [], tally: null, out: null, revote: false, speaker: null, speakEndsAt: null, speakKind: null, killed: r.mode === "morning" ? r.killed : null, whisper: {}, done: 0, undo: snapshot(session, r) },
    },
  };
}

/** Дать слово игроку (речь или последнее слово) на N секунд; null — убрать таймер. */
export function giveWord(session: Session, pid: string | null, seconds: number, now: number, kind: "speech" | "last" = "speech"): SessionChange {
  const r = parseMafiaResult(session.state.result);
  return { state: { result: { ...r, speaker: pid, speakEndsAt: pid ? now + seconds * 1000 : null, speakKind: pid ? kind : null } } };
}

/** Выставить или снять кандидата на голосование. */
export function toggleNominee(session: Session, pid: string): SessionChange {
  const r = parseMafiaResult(session.state.result);
  if (!r.alive.includes(pid)) return {};
  const nominees = r.nominees.includes(pid) ? r.nominees.filter((p) => p !== pid) : [...r.nominees, pid];
  return { state: { result: { ...r, nominees } } };
}

/** Голосование: новый шаг, телефоны живых выбирают одного из кандидатов или «никого». */
export function startVote(session: Session, content: MafiaContent, nominees: string[], revote = false): SessionChange {
  const r = parseMafiaResult(session.state.result);
  return {
    state: {
      step: session.state.step + 1,
      stage: "question",
      startedAt: "server",
      timeLimit: content.voteSeconds,
      revealed: false,
      answered: 0,
      result: { ...r, changeable: false, mode: "vote", nominees, revote, tally: null, out: null, done: 0, speaker: null, speakEndsAt: null, speakKind: null, undo: snapshot(session, r) },
    },
  };
}

function death(pid: string, round: number, by: Death["by"], roles: Record<string, RoleId>, content: MafiaContent): Death {
  const d: Death = { pid, round, by };
  if (content.revealOnDeath && roles[pid]) d.role = roles[pid];
  return d;
}

/** Итог голосования: выгнали одного, ничья (можно переголосовать) или никого. */
export function verdict(session: Session, content: MafiaContent, answers: Answer[], roles: Record<string, RoleId>): SessionChange {
  const r = parseMafiaResult(session.state.result);
  const own = answers.filter((a) => a.step === session.state.step);
  const t = tallyVotes(own, r.nominees, r.alive);
  const alive = t.out ? r.alive.filter((p) => p !== t.out) : r.alive;
  const deaths = t.out ? [...r.deaths, death(t.out, r.round, "vote", roles, content)] : r.deaths;
  const winner = t.out ? winnerOf(roles, alive) : null;
  return {
    state: {
      stage: "reveal",
      revealed: true,
      result: { ...r, changeable: false, mode: "verdict", tally: t.counts, out: t.out, alive, deaths, winner, nominees: t.out ? r.nominees : t.tied.length > 1 ? t.tied : r.nominees, done: own.length, undo: snapshot(session, r) },
    },
  };
}

/** «Наступает ночь»: новый шаг, все живые нажимают на телефоне (у мирных — для вида). */
export function startNight(session: Session): SessionChange {
  const r = parseMafiaResult(session.state.result);
  const step = session.state.step + 1;
  return {
    state: {
      step,
      stage: "question",
      startedAt: "server",
      timeLimit: null,
      revealed: false,
      answered: 0,
      result: { ...r, mode: "night", changeable: true, nights: [...r.nights, step], whisper: {}, done: 0, killed: null, out: null, tally: null, nominees: [], speaker: null, speakEndsAt: null, speakKind: null, undo: snapshot(session, r) },
    },
  };
}

/** Ночные подсказки и счётчик нажатий (пишет пульт по мере ответов). */
export function nightSync(session: Session, whisper: Record<string, string>, done: number): SessionChange {
  const r = parseMafiaResult(session.state.result);
  return { state: { result: { ...r, whisper, done } } };
}

/** «Наступает утро»: кто убит (или тихая ночь), проверка победы. */
export function morning(session: Session, content: MafiaContent, outcome: NightOutcome, roles: Record<string, RoleId>): SessionChange {
  const r = parseMafiaResult(session.state.result);
  const victim = outcome.victim;
  const alive = victim ? r.alive.filter((p) => p !== victim) : r.alive;
  const deaths = victim ? [...r.deaths, death(victim, r.round, "night", roles, content)] : r.deaths;
  return {
    state: {
      stage: "reveal",
      revealed: true,
      result: { ...r, changeable: false, mode: "morning", killed: victim, alive, deaths, winner: winnerOf(roles, alive), whisper: {}, undo: snapshot(session, r) },
    },
  };
}

/** Конец игры: роли всем, очки победителям (выжившим — бонус). */
export function finishGame(session: Session, content: MafiaContent, roles: Record<string, RoleId>, winner: "city" | "mafia"): SessionChange {
  const r = parseMafiaResult(session.state.result);
  const leaderboard: Record<string, LeaderboardEntry> = {};
  for (const pid of r.seats) {
    const entry = session.leaderboard[pid];
    if (!entry) continue;
    const role = roles[pid];
    const won = role ? ROLES[role].side === winner : false;
    const delta = won ? content.winPoints + (r.alive.includes(pid) ? content.survivorBonus : 0) : 0;
    leaderboard[pid] = { ...entry, score: entry.score + delta, last: delta };
  }
  const reveal: Record<string, RoleId> = {};
  for (const pid of r.seats) if (roles[pid]) reveal[pid] = roles[pid] as RoleId;
  return { leaderboard, state: { stage: "reveal", revealed: true, result: { ...r, changeable: false, mode: "over", winner, reveal, whisper: {}, speaker: null, speakEndsAt: null, undo: snapshot(session, r) } } };
}

/** «Закончить досрочно»: роли открываются, очков за победу никто не получает. */
export function abortGame(session: Session, roles: Record<string, RoleId>): SessionChange {
  const r = parseMafiaResult(session.state.result);
  const reveal: Record<string, RoleId> = {};
  for (const pid of r.seats) if (roles[pid]) reveal[pid] = roles[pid] as RoleId;
  return { state: { stage: "reveal", revealed: true, result: { ...r, changeable: false, mode: "over", winner: null, reveal, whisper: {}, speaker: null, speakEndsAt: null, speakKind: null, undo: snapshot(session, r) } } };
}

/** «Назад» на шаг: прежний этап; ответы отменённого шага убрать. */
export function mafiaBack(session: Session): { change: SessionChange; clearAnswers?: number } | null {
  const r = parseMafiaResult(session.state.result);
  if (!r.undo || (r.mode === "over" && r.winner)) return null;
  const u = r.undo;
  const stage = u.stage === "question" || u.stage === "reveal" || u.stage === "ready" || u.stage === "board" ? u.stage : "reveal";
  const leftStep = session.state.step !== u.step ? session.state.step : undefined;
  return {
    change: { state: { step: u.step, stage, result: { ...u.result, undo: null }, ...(stage === "question" ? {} : { revealed: true }) } },
    ...(leftStep !== undefined ? { clearAnswers: leftStep } : {}),
  };
}

export type MafiaAction = "deal" | "dealt" | "day" | "vote" | "verdict" | "revote" | "night" | "morning" | "finish" | "podium";

/** Главная кнопка пульта на каждом этапе. */
export function mafiaPrimary(session: Session): MafiaAction {
  const r = parseMafiaResult(session.state.result);
  if (session.state.stage === "podium") return "podium";
  if (session.state.result === null || session.state.result === undefined) return "deal";
  if (r.mode === "deal") return "dealt";
  if (r.mode === "roles") return "day";
  if (r.mode === "day") return r.nominees.length > 0 ? "vote" : "night";
  if (r.mode === "vote") return "verdict";
  if (r.mode === "verdict") {
    if (r.winner) return "finish";
    if (!r.out && !r.revote && isTie(r.tally, r.nominees)) return "revote";
    return "night";
  }
  if (r.mode === "night") return "morning";
  if (r.mode === "morning") return r.winner ? "finish" : "day";
  return "podium";
}

export const ACTION_LABELS: Record<MafiaAction, string> = {
  deal: "Собрать телефоны",
  dealt: "Раздать роли",
  day: "Наступает день",
  vote: "Голосование",
  verdict: "Подсчитать голоса",
  revote: "Переголосовать",
  night: "Наступает ночь",
  morning: "Наступает утро",
  finish: "Открыть роли — итог игры",
  podium: "Награждение",
};
