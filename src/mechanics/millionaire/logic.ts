// Ход «Миллион на кону» — чистые функции.
//
// Команды ходят по очереди, у каждой своя ступень (0–12). Ход: заставка (`ready`, «Ход команды X ·
// вопрос на 5 000») → вопрос (`question`): капитан выбирает вариант на телефоне (`{ choice }`, до фиксации
// можно передумать) или ведущий отмечает ответ команды на пульте — выбор подсвечивается на экране
// (`chosen`) → ведущий переспрашивает «Фиксируем ответ?» и фиксирует его (`locked`) → «Показать
// ответ» (`reveal`): верно — ступенью выше, неверно — вниз до
// несгораемой; «Право на ошибку» — вариант гаснет, вопрос заново → «Следующая команда». Дошла до 12 —
// миллионер, дальше не ходит. Подсказки — каждая один раз за игру у команды; любая подсказка открывает
// новый шаг (свежий приём ответов: капитан может попросить следующую подсказку с телефона, а прежний
// выбор не считается). Счёт команды = очки её ступени.
import { leaderboardAdditions, scoringParticipants } from "../../core/leaderboard";
import { hasPodium, podiumBack, podiumDone } from "../../core/podium";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import type { ScoreDelta, Step } from "../types";
import { LEVELS, levelsOf, LIFELINE_IDS, pointsAt, questionsOf, safeFloor, type LifelineId, type MillionaireContent, type MillionaireQuestion } from "./content";

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
  /** Выбор команды, подсвеченный на экране (пульт пишет его, как только ответ пришёл). */
  chosen: number | null;
  /** Ведущий переспросил и зафиксировал ответ — теперь только «Показать ответ». */
  locked: boolean;
  /** Просьба подсказки с телефона, которую ведущий отклонил (её номер `n`). */
  refused: string | null;
  /** «Совет ведущего»: наводка на экране зала (ведущий показывает по кнопке). */
  tipText: string | null;
  /** Голосование зала открыто: голосуют и гости по QR (сервер принимает голоса только при этой пометке). */
  audienceVote: boolean;
  /** Ответ на шаге можно поменять до фиксации (сервер перезаписывает ответ телефона). */
  changeable: boolean;
  /** Выбыли из игры (решение ведущего после ошибки). */
  out: string[];
  /** Пропускают свой следующий ход (решение ведущего после ошибки). */
  skip: string[];
  /** QR помощи зала крупно на весь экран (ведущий открывает и убирает). */
  qrBig: boolean;
  /** Сколько раз команда ошиблась (для «Попыток после ошибки»). */
  misses: Record<string, number>;
}

/** Что делать с командой после неверного ответа (решение владельца 14 октября 2026, выбирает ведущий). */
export type WrongChoice = "out" | "restart" | "skip";

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
    chosen: opt(d.chosen),
    locked: d.locked === true,
    refused: typeof d.refused === "string" ? d.refused.slice(0, 40) : null,
    tipText: typeof d.tipText === "string" && d.tipText.trim() !== "" ? d.tipText.slice(0, 300) : null,
    audienceVote: d.audienceVote === true,
    changeable: d.changeable === true,
    out: ids(d.out),
    skip: ids(d.skip),
    qrBig: d.qrBig === true,
    misses: (() => {
      const out: Record<string, number> = {};
      for (const [k, n] of Object.entries(rec(d.misses))) if (ID.test(k) && typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 100) out[k] = n;
      return out;
    })(),
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

/** Какую ступень команда играет сейчас (1–12 или 1–15). */
export function levelToPlay(r: MillionaireResult, team: string | null, max: number = LEVELS): number {
  return Math.min(max, (team ? (r.levels[team] ?? 0) : 0) + 1);
}

/** Сколько попыток после ошибки у команды осталось; null — без ограничения. */
export function attemptsLeft(content: MillionaireContent, r: MillionaireResult, team: string): number | null {
  if (content.attempts === null) return null;
  return content.attempts - (r.misses[team] ?? 0);
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

export type MillionaireAction = "start" | "show" | "lock" | "reveal" | "retry" | "audienceDone" | "next" | "wrongChoice" | "podium" | "podiumNext" | "finish";

export function millionairePrimary(session: Session): MillionaireAction {
  const { stage } = session.state;
  const r = parseMillionaireResult(session.state.result);
  if (stage === "podium") return podiumDone(session) ? "finish" : "podiumNext";
  if (r.mode === "over") return hasPodium(session.leaderboard) ? "podium" : "finish";
  if (stage === "ready") return r.order.length === 0 ? "start" : "show";
  if (r.mode === "audience") return "audienceDone";
  if (r.mode === "question") return r.locked ? "reveal" : "lock";
  if (r.outcome === "saved") return "retry";
  if (r.outcome === "wrong") return "wrongChoice";
  return "next";
}

/** Новый приём ответа: выбор не подсвечен и не зафиксирован, можно передумать. */
const fresh = { chosen: null, locked: false, refused: null, audienceVote: false, changeable: true } as const;

function base(r: MillionaireResult): MillionaireResult {
  return { ...r, q: null, removed: [], audience: null, votes: 0, callEndsAt: null, shield: false, tip: false, hostPick: null, pick: null, outcome: null, flash: null, qrBig: false, ...fresh };
}

/**
 * Кто ходит следующим после `from` (по кругу, мимо закончивших и выбывших). Пропускающий ход — один раз
 * пропускается и снимается с пропуска. null — играть некому.
 */
export function nextPlayer(order: string[], done: string[], from: string | null, skip: string[] = []): { who: string | null; skip: string[] } {
  if (order.length === 0) return { who: null, skip };
  const at = from ? order.indexOf(from) : -1;
  let left = [...skip];
  // Два круга: на первом пропускающие уступают ход, на втором (если ходить больше некому) — ходят.
  for (let i = 1; i <= order.length * 2; i++) {
    const who = order[(at + i + order.length * 2) % order.length];
    if (!who || done.includes(who)) continue;
    if (left.includes(who)) {
      left = left.filter((p) => p !== who);
      continue;
    }
    return { who, skip: left };
  }
  return { who: null, skip: left };
}

/** «Начать игру»: очередь по подключению (или одна выбранная команда), все на нуле. */
export function startMillionaire(session: Session, participants: Participant[], content: MillionaireContent, only: string | null = null): SessionChange {
  const r = parseMillionaireResult(session.state.result);
  const all = orderOf(session, participants, r);
  const order = content.players === "one" && only && all.includes(only) ? [only] : content.players === "one" ? all.slice(0, 1) : all;
  const levels = Object.fromEntries(order.map((p) => [p, 0]));
  const next: MillionaireResult = { ...base(r), order, levels, used: {}, seen: [], done: [], out: [], skip: [], misses: {}, mode: "turn", turn: order[0] ?? null, from: 0 };
  return {
    state: { stage: "ready", startedAt: null, timeLimit: null, revealed: false, answered: 0, result: write(next) },
    leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode),
  };
}

/** Время на ответ (null — без таймера). */
const answerLimit = (content: MillionaireContent | undefined): number | null => (content && content.answerSeconds > 0 ? content.answerSeconds : null);

/** «Показать вопрос»: вопрос ступени команды (тот же, если его уже показывали в этом ходе). */
export function showQuestion(session: Session, content: MillionaireContent): SessionChange | null {
  const r = parseMillionaireResult(session.state.result);
  if (!r.turn) return null;
  const level = levelToPlay(r, r.turn, levelsOf(content));
  const q = (r.q ? questionOf(content, r) : null) ?? freshQuestion(content, level, r.seen);
  if (!q) return null;
  const seen = r.seen.includes(q.id) ? r.seen : [...r.seen, q.id];
  return { state: { stage: "question", startedAt: "server", timeLimit: answerLimit(content), revealed: false, answered: 0, result: write({ ...r, q: q.id, seen, mode: "question", ...fresh, hostPick: null }) } };
}

/** Ответ команды на шаг: капитан с телефона (после времени показа) или отметка ведущего. */
export function teamPick(session: Session, answers: Answer[]): number | null {
  const r = parseMillionaireResult(session.state.result);
  if (!r.turn) return null;
  // Зафиксированный ответ больше не меняется, что бы ни прислал телефон.
  if (r.locked) return r.hostPick;
  const since = session.state.startedAt ?? 0;
  const answer = answers.find((a) => a.step === session.state.step && a.pid === r.turn && (a.submittedAt ?? 0) >= since);
  const choice = answer ? opt(rec(answer.value).choice) : null;
  if (choice !== null && !r.removed.includes(choice)) return choice;
  return r.hostPick;
}

/** Ведущий отмечает ответ команды (капитан сказал вслух или телефона нет). */
export function markPick(session: Session, choice: number | null): SessionChange | null {
  const r = parseMillionaireResult(session.state.result);
  if (r.locked) return null;
  const hostPick = choice !== null && !r.removed.includes(choice) ? choice : null;
  return { state: { result: write({ ...r, hostPick, chosen: hostPick }) } };
}

/** Ответ пришёл с телефона или поменялся — подсветить его на экране (null — подсвечивать нечего). */
export function syncChosen(session: Session, answers: Answer[]): SessionChange | null {
  const r = parseMillionaireResult(session.state.result);
  if (session.state.stage !== "question" || r.mode !== "question" || r.locked) return null;
  const pick = teamPick(session, answers);
  if (pick === r.chosen) return null;
  return { state: { result: write({ ...r, chosen: pick }) } };
}

/** «Фиксируем ответ?» — да: ответ зафиксирован, телефон его больше не поменяет. */
export function lockAnswer(session: Session, answers: Answer[]): SessionChange | null {
  const r = parseMillionaireResult(session.state.result);
  if (session.state.stage !== "question" || r.mode !== "question" || r.locked) return null;
  const pick = teamPick(session, answers);
  if (pick === null) return null;
  // Фиксация ответа останавливает часы: таймер с экрана уходит.
  return { state: { timeLimit: null, result: write({ ...r, chosen: pick, hostPick: pick, locked: true, changeable: false, refused: null }) } };
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
    const level = Math.min(levelsOf(content), from + 1);
    const done = level >= levelsOf(content) && !r.done.includes(team) ? [...r.done, team] : r.done;
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
  // Ошибка считается в «Попытках после ошибки» («Назад» вернёт её обратно).
  const misses = { ...r.misses, [team]: (r.misses[team] ?? 0) + 1 };
  return {
    state: { stage: "reveal", revealed: true, result: write({ ...r, mode: "reveal", pick, outcome: "wrong", from, misses, levels: { ...r.levels, [team]: level }, flash: null }) },
    leaderboard: scoreChange(session, participants, content, team, level, from),
  };
}

/** После «Права на ошибку»: тот же вопрос заново, новый шаг (прежний выбор не считается). */
export function retryQuestion(session: Session, content?: MillionaireContent): SessionChange {
  const r = parseMillionaireResult(session.state.result);
  return { state: { step: session.state.step + 1, stage: "question", startedAt: "server", timeLimit: answerLimit(content), revealed: false, answered: 0, result: write({ ...r, mode: "question", pick: null, outcome: null, hostPick: null, ...fresh }) } };
}

/** «Следующая команда»; некому ходить — конец игры. */
export function nextTurn(session: Session, content: MillionaireContent, participants: Participant[]): SessionChange {
  const r = parseMillionaireResult(session.state.result);
  // Новые команды встают в очередь (только в режиме «все по очереди»).
  const order = content.players === "one" ? r.order : orderOf(session, participants, r);
  const levels = { ...Object.fromEntries(order.map((p) => [p, 0])), ...r.levels };
  // Команда, которой нечем играть (вопросы её ступени кончились), тоже закончила.
  const done = [...r.done];
  for (const p of order) if (!done.includes(p) && !freshQuestion(content, levelToPlay({ ...r, levels }, p, levelsOf(content)), r.seen)) done.push(p);
  // Одна команда в игре («одна выбранная»): после ошибки она же и ходит дальше.
  const picked = nextPlayer(order, done, content.players === "one" ? null : r.turn, r.skip);
  const turn = picked.who;
  const next: MillionaireResult = { ...base(r), order, levels, done, skip: picked.skip, turn, mode: turn ? "turn" : "over", from: 0 };
  return {
    state: { step: session.state.step + 1, stage: turn ? "ready" : "reveal", startedAt: null, timeLimit: null, revealed: !turn, answered: 0, result: write(next) },
    leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode),
  };
}

/**
 * После неверного ответа ведущий решает (решение владельца 14 октября 2026):
 * `out` — команда выбывает (ступень и счёт остаются, больше не ходит);
 * `restart` — начинает с самого начала (ступень 0, счёт 0);
 * `skip` — продолжает со следующего вопроса (ступень — по несгораемой, как уже показано), но пропускает свой следующий ход.
 * Дальше — ход следующей команды.
 */
export function wrongChoice(session: Session, content: MillionaireContent, participants: Participant[], choice: WrongChoice): SessionChange | null {
  const r = parseMillionaireResult(session.state.result);
  const team = r.turn;
  if (!team || session.state.stage !== "reveal" || r.outcome !== "wrong") return null;
  let after: MillionaireResult = r;
  let board: SessionChange["leaderboard"];
  if (choice === "out") after = { ...r, out: [...new Set([...r.out, team])], done: [...new Set([...r.done, team])] };
  if (choice === "restart") {
    after = { ...r, levels: { ...r.levels, [team]: 0 } };
    board = scoreChange(session, participants, content, team, 0, r.levels[team] ?? 0);
  }
  if (choice === "skip") after = { ...r, skip: [...new Set([...r.skip, team])] };
  const moved = nextTurn({ ...session, state: { ...session.state, result: write(after) } }, content, participants);
  return { ...moved, leaderboard: { ...(moved.leaderboard ?? {}), ...(board ?? {}) } };
}

/** QR помощи зала на весь экран зала — открыть или убрать. */
export function toggleAudienceQr(session: Session): SessionChange {
  const r = parseMillionaireResult(session.state.result);
  return { state: { result: write({ ...r, qrBig: !r.qrBig }) } };
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
  if (r.locked) return { ok: false, reason: "Ответ уже зафиксирован" };
  if (id === "fifty" && wrongLeft(content, r).length < 2) return { ok: false, reason: "Неверных вариантов осталось меньше двух" };
  if (id === "swap" && !freshQuestion(content, levelToPlay(r, r.turn, levelsOf(content)), r.seen, r.q)) return { ok: false, reason: "Нет запасного вопроса этой ступени" };
  return { ok: true };
}

/** Можно ли взять подсказку сейчас. */
export function canUseLifeline(session: Session, content: MillionaireContent, answers: Answer[], id: LifelineId): LifelineCheck {
  const r = parseMillionaireResult(session.state.result);
  if (!content.lifelines.includes(id)) return { ok: false, reason: "В этой игре такой подсказки нет" };
  if (session.state.stage !== "question" || r.mode !== "question" || !r.turn) return { ok: false, reason: "Только пока открыт вопрос" };
  if ((r.used[r.turn] ?? []).includes(id)) return { ok: false, reason: "Уже использована" };
  if (r.locked) return { ok: false, reason: "Ответ уже зафиксирован" };
  void answers;
  if (id === "fifty" && wrongLeft(content, r).length < 2) return { ok: false, reason: "Неверных вариантов осталось меньше двух" };
  if (id === "swap" && !freshQuestion(content, levelToPlay(r, r.turn, levelsOf(content)), r.seen, r.q)) return { ok: false, reason: "Нет запасного вопроса этой ступени" };
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
  // Подсказка — новый шаг: прежний выбор не считается, капитан выбирает заново.
  let next: MillionaireResult = { ...r, used, flash: id, hostPick: null, ...fresh };
  // Подсказка — часы заново (в телеигре они стоят, пока берут подсказку); на звонок — ещё и время звонка.
  let timeLimit: number | null = answerLimit(content);
  if (id === "fifty") {
    const wrong = wrongLeft(content, r);
    const keep = wrong[Math.floor(random() * wrong.length) % wrong.length];
    next.removed = [...new Set([...r.removed, ...wrong.filter((i) => i !== keep).slice(0, 2)])].sort();
  } else if (id === "swap") {
    const q = freshQuestion(content, levelToPlay(r, team, levelsOf(content)), r.seen, r.q);
    if (!q) return null;
    next = { ...next, q: q.id, seen: [...r.seen, q.id], removed: [], audience: null, votes: 0, tip: false, callEndsAt: null };
  } else if (id === "audience") {
    next = { ...next, mode: "audience", audience: [0, 0, 0, 0], votes: 0, audienceVote: true, changeable: false };
    timeLimit = content.audienceSeconds;
  } else if (id === "call") {
    next.callEndsAt = now + content.callSeconds * 1000;
    if (timeLimit !== null) timeLimit += content.callSeconds;
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

/** Голоса телефонов игры и гостей по QR (`extra` — счёт сервера по вариантам), погашенные не считаются. */
function tally(session: Session, answers: Answer[], participants: Participant[], extra: number[]): { audience: number[]; votes: number } {
  const r = parseMillionaireResult(session.state.result);
  const counts = audienceVotes(session, answers, participants).map((n, i) => (r.removed.includes(i) ? 0 : n + Math.max(0, Math.floor(extra[i] ?? 0))));
  const votes = counts.reduce((a, b) => a + b, 0);
  return { audience: counts.map((n) => (votes > 0 ? Math.round((n * 100) / votes) : 0)), votes };
}

/** Пока зал голосует: проценты на экране обновляются (null — ничего не поменялось). */
export function liveAudience(session: Session, answers: Answer[], participants: Participant[], extra: number[] = []): SessionChange | null {
  const r = parseMillionaireResult(session.state.result);
  if (r.mode !== "audience" || session.state.stage !== "question") return null;
  const { audience, votes } = tally(session, answers, participants, extra);
  if (votes === r.votes && audience.every((n, i) => n === (r.audience?.[i] ?? 0))) return null;
  return { state: { result: write({ ...r, audience, votes }) } };
}

/** Итоги голосования: проценты на экран, вопрос снова открыт для капитана. */
export function finishAudience(session: Session, answers: Answer[], participants: Participant[], extra: number[] = [], content?: MillionaireContent): SessionChange {
  const r = parseMillionaireResult(session.state.result);
  const { audience, votes } = tally(session, answers, participants, extra);
  return { state: { step: session.state.step + 1, stage: "question", startedAt: "server", timeLimit: answerLimit(content), revealed: false, answered: 0, result: write({ ...r, mode: "question", audience, votes, flash: null, qrBig: false, ...fresh }) } };
}

/** «Совет ведущего»: наводка на экран зала (пусто — убрать). */
export function showTip(session: Session, text: string | null): SessionChange {
  const r = parseMillionaireResult(session.state.result);
  const tipText = text && text.trim() !== "" ? text.trim().slice(0, 300) : null;
  return { state: { result: write({ ...r, tipText }) } };
}

/** Звонок закончен раньше минуты. */
export function endCall(session: Session, now: number): SessionChange {
  const r = parseMillionaireResult(session.state.result);
  return { state: { result: write({ ...r, callEndsAt: r.callEndsAt !== null ? Math.min(r.callEndsAt, now) : null }) } };
}

/** Просьба подсказки с телефона: какая и её номер (чтобы отказ относился только к ней). */
export interface LifelineAsk {
  id: LifelineId;
  n: string;
}

/**
 * Подсказка, которую игрок попросил с телефона: в solo — ответом своего игрока, в командах — капитан
 * своим ответом телефона. Пульт её не включает сам: ведущий переспрашивает и подтверждает.
 */
export function requestedLifeline(session: Session, answers: Answer[], participants: Participant[]): LifelineAsk | null {
  const r = parseMillionaireResult(session.state.result);
  if (!r.turn || session.state.stage !== "question" || r.mode !== "question" || r.locked) return null;
  const captainUid = session.leaderboard[r.turn]?.captainUid ?? participants.find((p) => p.id === r.turn)?.captainUid ?? null;
  const since = session.state.startedAt ?? 0;
  for (const a of answers) {
    if (a.step !== session.state.step || (a.submittedAt ?? 0) < since) continue;
    const value = rec(a.value);
    const id = value.lifeline;
    if (!LIFELINE_IDS.includes(id as LifelineId)) continue;
    const n = typeof value.n === "string" ? value.n.slice(0, 40) : "";
    if (n !== "" && n === r.refused) continue;
    const solo = a.pid === r.turn;
    const phone = participants.find((p) => p.id === a.pid);
    const captain = phone !== undefined && phone.teamId === r.turn && a.uid === captainUid;
    if (!solo && !captain) continue;
    return { id: id as LifelineId, n };
  }
  return null;
}

/** Ведущий переспросил — игрок передумал: просьба гаснет на телефоне и пульте. */
export function refuseLifeline(session: Session, n: string): SessionChange {
  const r = parseMillionaireResult(session.state.result);
  return { state: { result: write({ ...r, refused: n.slice(0, 40) }) } };
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
    const done = r.outcome === "right" && r.from + 1 >= levelsOf(content) ? r.done.filter((p) => p !== team) : r.done;
    const misses = r.outcome === "wrong" ? { ...r.misses, [team]: Math.max(0, (r.misses[team] ?? 0) - 1) } : r.misses;
    const change: SessionChange = {
      state: { stage: "question", revealed: false, result: write({ ...r, mode: "question", outcome: null, pick: null, shield: r.outcome === "saved" ? true : r.shield, removed, done, misses, levels: { ...r.levels, [team]: r.from }, locked: true, changeable: false }) },
    };
    if (r.outcome !== "saved") change.leaderboard = scoreChange(session, participants, content, team, r.from, r.levels[team] ?? 0);
    return { change };
  }
  // Ответ зафиксирован — «Назад» снимает фиксацию: можно переспросить и выбрать другой.
  if (stage === "question" && r.mode === "question" && r.locked) {
    return { change: { state: { result: write({ ...r, locked: false, hostPick: null, changeable: true }) } } };
  }
  // Пока подсказок на вопросе не брали — можно вернуться к заставке хода (вопрос останется тем же).
  if (stage === "question" && r.mode === "question" && !r.audience && !r.shield && !r.tip && r.callEndsAt === null && r.removed.length === 0 && r.outcome === null) {
    return { change: { state: { stage: "ready", startedAt: null, timeLimit: null, revealed: false, answered: 0, result: write({ ...r, mode: "turn", hostPick: null, chosen: null }) } }, clear: [step] };
  }
  return null;
}

/**
 * Какие полоски на экране зала: команд больше `size` — окно по кругу, с той, чья очередь (решение владельца
 * 14 октября 2026): «Лисы, Медведи, Совы» → Лисы отходили → «Медведи, Совы, Козы». Выбывшие в окно не попадают.
 */
export function ladderWindow(result: MillionaireResult, size: number): string[] {
  const { order } = result;
  if (order.length <= size) return order;
  const at = Math.max(0, result.turn ? order.indexOf(result.turn) : 0);
  const ring = [...order.slice(at), ...order.slice(0, at)];
  const live = ring.filter((p) => !result.out.includes(p));
  return (live.length > 0 ? live : ring).slice(0, size);
}
