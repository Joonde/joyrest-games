// Ход «Кто хочет стать миллионером» — чистые функции.
//
// Команды ходят по очереди, у каждой своя ступень (0–12). Ход: заставка (`ready`, «Ход команды X ·
// вопрос на 5 000») → вопрос (`question`): капитан выбирает вариант на телефоне (`{ choice }`) или ведущий
// отмечает ответ команды на пульте → «Показать ответ» (`reveal`): верно — ступенью выше, неверно — вниз до
// несгораемой; «Право на ошибку» — вариант гаснет, вопрос заново → «Следующая команда». Дошла до 12 —
// миллионер, дальше не ходит. Подсказки — каждая один раз за игру у команды; любая подсказка открывает
// новый шаг (свежий приём ответов: капитан может попросить следующую подсказку с телефона, а прежний
// выбор не считается). Счёт команды = очки её ступени.
import { leaderboardAdditions, scoringParticipants } from "../../core/leaderboard";
import { hasPodium, podiumBack, podiumDone } from "../../core/podium";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import type { ScoreDelta, Step } from "../types";
import { LEVELS, LIFELINE_IDS, pointsAt, questionsOf, safeFloor, type LifelineId, type MillionaireContent, type MillionaireQuestion } from "./content";

export type MillionaireMode = "turn" | "question" | "audience" | "reveal" | "over";

export interface MillionaireResult {
  order: string[];
  /** Чей ход. */
  turn: string | null;
  levels: Record<string, number>;
  /** Использованные подсказки команд. */
  used: Record<string, LifelineId[]>;
  /** Уже показанные вопросы — не повторяются (весь зал их видел). */
  seen: string[];
  q: string | null;
  mode: MillionaireMode;
  /** Погашенные варианты текущего вопроса (50 на 50, ошибка под «Правом на ошибку»). */
  removed: number[];
  /** Помощь зала: проценты по вариантам и сколько голосов. */
  audience: number[] | null;
  votes: number;
  /** Звонок другу: до какого времени по часам сервера. */
  callEndsAt: number | null;
  /** «Право на ошибку» включено на этот вопрос. */
  shield: boolean;
  /** «Совет ведущего» взят на этот вопрос. */
  tip: boolean;
  /** Ответ команды, отмеченный ведущим (если капитан не ответил с телефона). */
  hostPick: number | null;
  /** Чем закончился показ ответа. */
  pick: number | null;
  outcome: "right" | "wrong" | "saved" | null;
  /** Ступень до показа ответа («Назад»). */
  from: number;
  /** Последняя взятая подсказка — для вспышки на экране. */
  flash: LifelineId | null;
  /** Дошли до 12 ступени или вопросы кончились. */
  done: string[];
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && ID.test(x)))].slice(0, 300) : []);
const pid = (v: unknown) => (typeof v === "string" && ID.test(v) ? v : null);
const opt = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 3 ? v : null);
const opts = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(opt).filter((n): n is number => n !== null))].sort() : []);

function lifelines(v: unknown): LifelineId[] {
  return Array.isArray(v) ? LIFELINE_IDS.filter((l) => (v as unknown[]).includes(l)) : [];
}

export function parseMillionaireResult(raw: unknown): MillionaireResult {
  const d = rec(raw);
  const levels: Record<string, number> = {};
  for (const [k, n] of Object.entries(rec(d.levels))) if (ID.test(k) && typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= LEVELS) levels[k] = n;
  const used: Record<string, LifelineId[]> = {};
  for (const [k, list] of Object.entries(rec(d.used))) if (ID.test(k)) used[k] = lifelines(list);
  const audience = Array.isArray(d.audience) && d.audience.length === 4 && d.audience.every((n) => typeof n === "number" && n >= 0 && n <= 100) ? (d.audience as number[]) : null;
  const modes: MillionaireMode[] = ["turn", "question", "audience", "reveal", "over"];
  return {
    order: ids(d.order),
    turn: pid(d.turn),
    levels,
    used,
    seen: ids(d.seen),
    q: pid(d.q),
    mode: modes.includes(d.mode as MillionaireMode) ? (d.mode as MillionaireMode) : "turn",
    removed: opts(d.removed),
    audience,
    votes: typeof d.votes === "number" && d.votes >= 0 ? Math.floor(d.votes) : 0,
    callEndsAt: typeof d.callEndsAt === "number" ? d.callEndsAt : null,
    shield: d.shield === true,
    tip: d.tip === true,
    hostPick: opt(d.hostPick),
    pick: opt(d.pick),
    outcome: d.outcome === "right" || d.outcome === "wrong" || d.outcome === "saved" ? d.outcome : null,
    from: typeof d.from === "number" && d.from >= 0 && d.from <= LEVELS ? d.from : 0,
    flash: LIFELINE_IDS.includes(d.flash as LifelineId) ? (d.flash as LifelineId) : null,
    done: ids(d.done),
  };
}

const write = (r: MillionaireResult): Record<string, unknown> => ({ ...r });

export function millionaireSteps(content: MillionaireContent): Step[] {
  return content.questions.map((q) => ({ id: q.id, answerable: true }));
}

export function score(): ScoreDelta[] {
  return [];
}

export function questionOf(content: MillionaireContent, r: MillionaireResult): MillionaireQuestion | null {
  return r.q ? (content.questions.find((q) => q.id === r.q) ?? null) : null;
}

/** Следующий непоказанный вопрос ступени (кроме `except`). */
function freshQuestion(content: MillionaireContent, level: number, seen: string[], except: string | null = null): MillionaireQuestion | null {
  return questionsOf(content, level).find((q) => q.id !== except && !seen.includes(q.id) && q.text.trim() !== "") ?? null;
}

/** Какую ступень команда играет сейчас (1–12). */
export function levelToPlay(r: MillionaireResult, team: string | null): number {
  return Math.min(LEVELS, (team ? (r.levels[team] ?? 0) : 0) + 1);
}

function orderOf(session: Session, participants: Participant[], r: MillionaireResult): string[] {
  const joined = [...scoringParticipants(participants, session.playMode)].sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0) || a.id.localeCompare(b.id)).map((p) => p.id);
  const known = new Set([...joined, ...Object.keys(session.leaderboard)]);
  return [...new Set([...r.order.filter((p) => known.has(p)), ...joined, ...Object.keys(session.leaderboard)])];
}

/** Сколько команд сможет играть. */
export function millionaireTeams(session: Session, participants: Participant[]): string[] {
  return orderOf(session, participants, parseMillionaireResult(session.state.result));
}

/** Счёт команды — очки её ступени: записываем запись таблицы целиком (суммы бывают больше лимита прибавки). */
function scoreChange(session: Session, participants: Participant[], content: MillionaireContent, team: string, level: number, before: number): SessionChange["leaderboard"] {
  const board = { ...leaderboardAdditions(session.leaderboard, participants, session.playMode) };
  const entry = board[team] ?? session.leaderboard[team];
  if (!entry) return board;
  const score = pointsAt(content, level);
  board[team] = { ...entry, score, last: score - pointsAt(content, before) };
  return board;
}

export type MillionaireAction = "start" | "show" | "reveal" | "retry" | "audienceDone" | "next" | "podium" | "podiumNext" | "finish";

export function millionairePrimary(session: Session): MillionaireAction {
  const { stage } = session.state;
  const r = parseMillionaireResult(session.state.result);
  if (stage === "podium") return podiumDone(session) ? "finish" : "podiumNext";
  if (r.mode === "over") return hasPodium(session.leaderboard) ? "podium" : "finish";
  if (stage === "ready") return r.order.length === 0 ? "start" : "show";
  if (r.mode === "audience") return "audienceDone";
  if (r.mode === "question") return "reveal";
  if (r.outcome === "saved") return "retry";
  return "next";
}

function base(r: MillionaireResult): MillionaireResult {
  return { ...r, q: null, removed: [], audience: null, votes: 0, callEndsAt: null, shield: false, tip: false, hostPick: null, pick: null, outcome: null, flash: null };
}

/** Кто ходит следующим после `from` (по кругу, мимо закончивших). null — играть некому. */
function nextPlayer(order: string[], done: string[], from: string | null): string | null {
  if (order.length === 0) return null;
  const at = from ? order.indexOf(from) : -1;
  for (let i = 1; i <= order.length; i++) {
    const who = order[(at + i + order.length) % order.length];
    if (who && !done.includes(who)) return who;
  }
  return null;
}

/** «Начать игру»: очередь по подключению (или одна выбранная команда), все на нуле. */
export function startMillionaire(session: Session, participants: Participant[], content: MillionaireContent, only: string | null = null): SessionChange {
  const r = parseMillionaireResult(session.state.result);
  const all = orderOf(session, participants, r);
  const order = content.players === "one" && only && all.includes(only) ? [only] : content.players === "one" ? all.slice(0, 1) : all;
  const levels = Object.fromEntries(order.map((p) => [p, 0]));
  const next: MillionaireResult = { ...base(r), order, levels, used: {}, seen: [], done: [], mode: "turn", turn: order[0] ?? null, from: 0 };
  return {
    state: { stage: "ready", startedAt: null, timeLimit: null, revealed: false, answered: 0, result: write(next) },
    leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode),
  };
}

/** «Показать вопрос»: вопрос ступени команды (тот же, если его уже показывали в этом ходе). */
export function showQuestion(session: Session, content: MillionaireContent): SessionChange | null {
  const r = parseMillionaireResult(session.state.result);
  if (!r.turn) return null;
  const level = levelToPlay(r, r.turn);
  const q = (r.q ? questionOf(content, r) : null) ?? freshQuestion(content, level, r.seen);
  if (!q) return null;
  const seen = r.seen.includes(q.id) ? r.seen : [...r.seen, q.id];
  return { state: { stage: "question", startedAt: "server", timeLimit: null, revealed: false, answered: 0, result: write({ ...r, q: q.id, seen, mode: "question" }) } };
}

/** Ответ команды на шаг: капитан с телефона (после времени показа) или отметка ведущего. */
export function teamPick(session: Session, answers: Answer[]): number | null {
  const r = parseMillionaireResult(session.state.result);
  if (!r.turn) return null;
  const since = session.state.startedAt ?? 0;
  const answer = answers.find((a) => a.step === session.state.step && a.pid === r.turn && (a.submittedAt ?? 0) >= since);
  const choice = answer ? opt(rec(answer.value).choice) : null;
  if (choice !== null && !r.removed.includes(choice)) return choice;
  return r.hostPick;
}

/** Ведущий отмечает ответ команды (капитан сказал вслух или телефона нет). */
export function markPick(session: Session, choice: number | null): SessionChange {
  const r = parseMillionaireResult(session.state.result);
  return { state: { result: write({ ...r, hostPick: choice !== null && !r.removed.includes(choice) ? choice : null }) } };
}

/** «Показать ответ». */
export function revealAnswer(session: Session, content: MillionaireContent, answers: Answer[], participants: Participant[]): SessionChange | null {
  const r = parseMillionaireResult(session.state.result);
  const q = questionOf(content, r);
  const team = r.turn;
  const pick = teamPick(session, answers);
  if (!q || !team || pick === null) return null;
  const from = r.levels[team] ?? 0;
  if (pick === q.correct) {
    const level = Math.min(LEVELS, from + 1);
    const done = level >= LEVELS && !r.done.includes(team) ? [...r.done, team] : r.done;
    return {
      state: { stage: "reveal", revealed: true, result: write({ ...r, mode: "reveal", pick, outcome: "right", from, levels: { ...r.levels, [team]: level }, done, flash: null }) },
      leaderboard: scoreChange(session, participants, content, team, level, from),
    };
  }
  if (r.shield) {
    // Право на ошибку: вариант гаснет, команда остаётся на ступени и отвечает ещё раз.
    return { state: { stage: "reveal", revealed: true, result: write({ ...r, mode: "reveal", pick, outcome: "saved", from, shield: false, removed: [...new Set([...r.removed, pick])].sort(), flash: null }) } };
  }
  const level = safeFloor(content, from);
  return {
    state: { stage: "reveal", revealed: true, result: write({ ...r, mode: "reveal", pick, outcome: "wrong", from, levels: { ...r.levels, [team]: level }, flash: null }) },
    leaderboard: scoreChange(session, participants, content, team, level, from),
  };
}

/** После «Права на ошибку»: тот же вопрос заново, новый шаг (прежний выбор не считается). */
export function retryQuestion(session: Session): SessionChange {
  const r = parseMillionaireResult(session.state.result);
  return { state: { step: session.state.step + 1, stage: "question", startedAt: "server", timeLimit: null, revealed: false, answered: 0, result: write({ ...r, mode: "question", pick: null, outcome: null, hostPick: null }) } };
}

/** «Следующая команда»; некому ходить — конец игры. */
export function nextTurn(session: Session, content: MillionaireContent, participants: Participant[]): SessionChange {
  const r = parseMillionaireResult(session.state.result);
  // Новые команды встают в очередь (только в режиме «все по очереди»).
  const order = content.players === "one" ? r.order : orderOf(session, participants, r);
  const levels = { ...Object.fromEntries(order.map((p) => [p, 0])), ...r.levels };
  // Команда, которой нечем играть (вопросы её ступени кончились), тоже закончила.
  const done = [...r.done];
  for (const p of order) if (!done.includes(p) && !freshQuestion(content, levelToPlay({ ...r, levels }, p), r.seen)) done.push(p);
  const turn = nextPlayer(order, done, r.turn);
  const next: MillionaireResult = { ...base(r), order, levels, done, turn, mode: turn ? "turn" : "over", from: 0 };
  return {
    state: { step: session.state.step + 1, stage: turn ? "ready" : "reveal", startedAt: null, timeLimit: null, revealed: !turn, answered: 0, result: write(next) },
    leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode),
  };
}

export interface LifelineCheck {
  ok: boolean;
  /** Почему нельзя — для пульта. */
  reason?: string;
}

/** Можно ли взять подсказку — без учёта ответа команды (телефон капитана видит то же, что пульт). */
export function lifelineState(session: Session, content: MillionaireContent, id: LifelineId): LifelineCheck {
  const r = parseMillionaireResult(session.state.result);
  if (!content.lifelines.includes(id)) return { ok: false, reason: "В этой игре такой подсказки нет" };
  if (session.state.stage !== "question" || r.mode !== "question" || !r.turn) return { ok: false, reason: "Только пока открыт вопрос" };
  if ((r.used[r.turn] ?? []).includes(id)) return { ok: false, reason: "Уже использована" };
  if (r.hostPick !== null) return { ok: false, reason: "Ответ уже выбран" };
  if (id === "fifty" && wrongLeft(content, r).length < 2) return { ok: false, reason: "Неверных вариантов осталось меньше двух" };
  if (id === "swap" && !freshQuestion(content, levelToPlay(r, r.turn), r.seen, r.q)) return { ok: false, reason: "Нет запасного вопроса этой ступени" };
  return { ok: true };
}

/** Можно ли взять подсказку сейчас. */
export function canUseLifeline(session: Session, content: MillionaireContent, answers: Answer[], id: LifelineId): LifelineCheck {
  const r = parseMillionaireResult(session.state.result);
  if (!content.lifelines.includes(id)) return { ok: false, reason: "В этой игре такой подсказки нет" };
  if (session.state.stage !== "question" || r.mode !== "question" || !r.turn) return { ok: false, reason: "Только пока открыт вопрос" };
  if ((r.used[r.turn] ?? []).includes(id)) return { ok: false, reason: "Уже использована" };
  if (teamPick(session, answers) !== null) return { ok: false, reason: "Ответ уже выбран" };
  if (id === "fifty" && wrongLeft(content, r).length < 2) return { ok: false, reason: "Неверных вариантов осталось меньше двух" };
  if (id === "swap" && !freshQuestion(content, levelToPlay(r, r.turn), r.seen, r.q)) return { ok: false, reason: "Нет запасного вопроса этой ступени" };
  return { ok: true };
}

function wrongLeft(content: MillionaireContent, r: MillionaireResult): number[] {
  const q = questionOf(content, r);
  if (!q) return [];
  return [0, 1, 2, 3].filter((i) => i !== q.correct && !r.removed.includes(i) && (q.options[i] ?? "").trim() !== "");
}

/**
 * Подсказка: отмечается у команды (на экране, пульте и телефоне — перечёркнута) и действует сразу.
 * Любая подсказка — новый шаг: свежий приём ответов. `random` — случай для «50 на 50» (0–1).
 */
export function applyLifeline(session: Session, content: MillionaireContent, answers: Answer[], id: LifelineId, now: number, random: () => number = Math.random): SessionChange | null {
  if (!canUseLifeline(session, content, answers, id).ok) return null;
  const r = parseMillionaireResult(session.state.result);
  const team = r.turn as string;
  const used = { ...r.used, [team]: [...(r.used[team] ?? []), id] };
  let next: MillionaireResult = { ...r, used, flash: id, hostPick: null };
  let timeLimit: number | null = null;
  if (id === "fifty") {
    const wrong = wrongLeft(content, r);
    const keep = wrong[Math.floor(random() * wrong.length) % wrong.length];
    next.removed = [...new Set([...r.removed, ...wrong.filter((i) => i !== keep).slice(0, 2)])].sort();
  } else if (id === "swap") {
    const q = freshQuestion(content, levelToPlay(r, team), r.seen, r.q);
    if (!q) return null;
    next = { ...next, q: q.id, seen: [...r.seen, q.id], removed: [], audience: null, votes: 0, tip: false, callEndsAt: null };
  } else if (id === "audience") {
    next = { ...next, mode: "audience", audience: null, votes: 0 };
    timeLimit = content.audienceSeconds;
  } else if (id === "call") {
    next.callEndsAt = now + content.callSeconds * 1000;
  } else if (id === "mistake") {
    next.shield = true;
  } else if (id === "host") {
    next.tip = true;
  }
  return { state: { step: session.state.step + 1, stage: "question", startedAt: "server", timeLimit, revealed: false, answered: 0, result: write(next) } };
}

/** Голос зала за вариант: телефон не из команды, чей ход (её капитан и участники не голосуют). */
export function audienceVotes(session: Session, answers: Answer[], participants: Participant[]): number[] {
  const r = parseMillionaireResult(session.state.result);
  const since = session.state.startedAt ?? 0;
  const counts = [0, 0, 0, 0];
  const byId = new Map(participants.map((p) => [p.id, p]));
  for (const a of answers) {
    if (a.step !== session.state.step || (a.submittedAt ?? 0) < since || a.pid === r.turn) continue;
    const who = byId.get(a.pid);
    if (who && (who.teamId === r.turn || who.id === r.turn)) continue;
    // В командах голосует каждый телефон своим игроком; голос «за команду» не считается (иначе капитан — дважды).
    if (session.playMode === "teams" && (!who || who.kind !== "player")) continue;
    const vote = opt(rec(a.value).vote);
    if (vote === null || r.removed.includes(vote)) continue;
    counts[vote] = (counts[vote] ?? 0) + 1;
  }
  return counts;
}

/** Итоги голосования: проценты на экран, вопрос снова открыт для капитана. */
export function finishAudience(session: Session, answers: Answer[], participants: Participant[]): SessionChange {
  const r = parseMillionaireResult(session.state.result);
  const counts = audienceVotes(session, answers, participants);
  const total = counts.reduce((a, b) => a + b, 0);
  const audience = counts.map((n) => (total > 0 ? Math.round((n * 100) / total) : 0));
  return { state: { step: session.state.step + 1, stage: "question", startedAt: "server", timeLimit: null, revealed: false, answered: 0, result: write({ ...r, mode: "question", audience, votes: total, flash: null }) } };
}

/** Звонок закончен раньше минуты. */
export function endCall(session: Session, now: number): SessionChange {
  const r = parseMillionaireResult(session.state.result);
  return { state: { result: write({ ...r, callEndsAt: r.callEndsAt !== null ? Math.min(r.callEndsAt, now) : null }) } };
}

/** Подсказка, которую капитан попросил с телефона (свой ответ телефона на шаг). */
export function requestedLifeline(session: Session, answers: Answer[], participants: Participant[]): LifelineId | null {
  const r = parseMillionaireResult(session.state.result);
  if (!r.turn || session.state.stage !== "question" || r.mode !== "question") return null;
  const captainUid = session.leaderboard[r.turn]?.captainUid ?? participants.find((p) => p.id === r.turn)?.captainUid ?? null;
  const since = session.state.startedAt ?? 0;
  for (const a of answers) {
    if (a.step !== session.state.step || (a.submittedAt ?? 0) < since) continue;
    const id = rec(a.value).lifeline;
    if (!LIFELINE_IDS.includes(id as LifelineId)) continue;
    // Просит капитан команды, чей ход: телефон команды с его устройства (или сам игрок в solo — там просит ведущий).
    const phone = participants.find((p) => p.id === a.pid);
    if (!phone || phone.teamId !== r.turn || a.uid !== captainUid) continue;
    return id as LifelineId;
  }
  return null;
}

export interface MillionaireBack {
  change: SessionChange;
  clear?: number[];
}

/** «Назад»: с показа ответа — к вопросу (ступень и счёт обратно); с вопроса без подсказок — к заставке хода. */
export function millionaireBack(session: Session, content: MillionaireContent, participants: Participant[]): MillionaireBack | null {
  const { stage, step } = session.state;
  const r = parseMillionaireResult(session.state.result);
  if (stage === "podium") return { change: podiumBack(session) };
  if (r.mode === "over" || !r.turn) return null;
  if (stage === "reveal" && r.outcome) {
    const team = r.turn;
    const removed = r.outcome === "saved" && r.pick !== null ? r.removed.filter((i) => i !== r.pick) : r.removed;
    const done = r.outcome === "right" && r.from + 1 >= LEVELS ? r.done.filter((p) => p !== team) : r.done;
    const change: SessionChange = {
      state: { stage: "question", revealed: false, result: write({ ...r, mode: "question", outcome: null, pick: null, shield: r.outcome === "saved" ? true : r.shield, removed, done, levels: { ...r.levels, [team]: r.from } }) },
    };
    if (r.outcome !== "saved") change.leaderboard = scoreChange(session, participants, content, team, r.from, r.levels[team] ?? 0);
    return { change };
  }
  // Пока подсказок на вопросе не брали — можно вернуться к заставке хода (вопрос останется тем же).
  if (stage === "question" && r.mode === "question" && !r.audience && !r.shield && !r.tip && r.callEndsAt === null && r.removed.length === 0 && r.outcome === null) {
    return { change: { state: { stage: "ready", startedAt: null, timeLimit: null, revealed: false, answered: 0, result: write({ ...r, mode: "turn", hostPick: null }) } }, clear: [step] };
  }
  return null;
}
