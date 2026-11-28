// Ход «Рулетки судьбы» — чистые функции (паспорт LOGIC.md, п. 2, 3.1, 4, 8). Этап 1: шаг 0 «выбор тем», очередь,
// «К колесу» и «Назад» к выбору тем. Вращение, задание, итог, пауза и «Назад» хода — следующие этапы.
//
// Шаги платформы (Р-1): шаг 0 — выбор тем; каждый ход команды — два шага (вращение и задание).
import { leaderboardAdditions, scoringParticipants } from "../../core/leaderboard";
import { answersMark, resultKey } from "../../core/session";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import type { ScoreDelta, Step } from "../types";
import { catalogThemes, LIMITS, MAX_TEAMS, MIN_TEAMS, RARITIES, type Rarity, type RouletteContent } from "./content";
import type { Fallback } from "./spin";

export type RouletteMode = "themes" | "spin" | "spinning" | "task" | "judged";

/** Выбор тем команды: ответ капитана или выбор ведущего (Р-6). at — время ответа капитана, после которого он сделан. */
export interface ThemeChoice {
  themes: string[];
  by: "captain" | "host";
  /** Капитан: время его ответа (сервер). Ведущий: время последнего ответа капитана, который пульт видел, — более поздний ответ капитана заменяет выбор ведущего. */
  at: number;
}

export interface TurnInfo {
  /** Номер хода с начала игры (с 1). */
  n: number;
  /** Круг (с 1). */
  round: number;
  team: string;
  /** Дополнительное вращение (extraSpin). */
  extra: boolean;
}

/** Результат вращения — только id (п. 8). Конец анимации = startedAt + durationMs (Р-14). */
export interface SpinRecord {
  id: string;
  themeId: string;
  taskId: string;
  rarity: Rarity;
  angle: number;
  durationMs: number;
  curve: number;
  /** Задание уже меняли в этом ходу (Р-18). */
  replaced: boolean;
}

export interface LogEntry {
  turn: number;
  team: string;
  kind: "spin" | "replace" | Fallback;
  themeId: string;
  taskId: string | null;
}

export interface RouletteResult {
  mode: RouletteMode;
  /** Шаг выбора тем: ответ можно менять (О-14). */
  changeable: boolean;
  choices: Record<string, ThemeChoice>;
  /** Темы, добавленные ведущим в колесо, когда выбранных меньше трёх (Р-7). */
  added: string[];
  sectors: string[];
  order: string[];
  /** Показанные задания по темам — «Назад» их не откатывает (Р-40). */
  played: Record<string, string[]>;
  log: LogEntry[];
  turn: TurnInfo | null;
  spin: SpinRecord | null;
  /** Редкость прошлого задания каждой команды (Р-17 п. 4). */
  lastRarity: Record<string, Rarity>;
  /** Снимок для «Назад» без постоянных частей (Р-41). */
  before: Record<string, unknown> | null;
}

/** Постоянные части итогов: их нет в снимке «Назад», возврат их не трогает (Р-41). */
export const PERMANENT_KEYS = ["choices", "added", "sectors", "order", "played", "log"] as const;

export const LOG_LIMIT = 20;

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const ids = (v: unknown, max: number): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && ID.test(x)))].slice(0, max) : []);
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const rarityOf = (v: unknown): Rarity | null => (typeof v === "string" && (RARITIES as readonly string[]).includes(v) ? (v as Rarity) : null);

function parseChoices(raw: unknown): Record<string, ThemeChoice> {
  const out: Record<string, ThemeChoice> = {};
  for (const [pid, value] of Object.entries(rec(raw))) {
    if (!ID.test(pid)) continue;
    const c = rec(value);
    const themes = ids(c.themes, 2);
    if (themes.length === 0) continue;
    out[pid] = { themes, by: c.by === "host" ? "host" : "captain", at: num(c.at, 0) };
  }
  return out;
}

function parsePlayed(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [theme, list] of Object.entries(rec(raw))) if (ID.test(theme)) out[theme] = ids(list, LIMITS.tasks);
  return out;
}

function parseTurn(raw: unknown): TurnInfo | null {
  const t = rec(raw);
  if (typeof t.team !== "string" || !ID.test(t.team)) return null;
  return { n: Math.max(1, Math.floor(num(t.n, 1))), round: Math.max(1, Math.floor(num(t.round, 1))), team: t.team, extra: t.extra === true };
}

function parseSpin(raw: unknown): SpinRecord | null {
  const s = rec(raw);
  const rarity = rarityOf(s.rarity);
  if (typeof s.id !== "string" || typeof s.themeId !== "string" || typeof s.taskId !== "string" || !rarity) return null;
  return {
    id: s.id.slice(0, 64),
    themeId: s.themeId,
    taskId: s.taskId,
    rarity,
    angle: num(s.angle, 0),
    durationMs: Math.max(0, num(s.durationMs, 0)),
    curve: num(s.curve, 3),
    replaced: s.replaced === true,
  };
}

const LOG_KINDS = new Set(["spin", "replace", "deckReset", "extraSpinFallback", "legendaryFallback", "rarityFallback"]);

function parseLog(raw: unknown): LogEntry[] {
  return (Array.isArray(raw) ? raw : [])
    .flatMap((x): LogEntry[] => {
      const e = rec(x);
      if (typeof e.kind !== "string" || !LOG_KINDS.has(e.kind) || typeof e.team !== "string" || typeof e.themeId !== "string") return [];
      return [{ turn: Math.floor(num(e.turn, 0)), team: e.team, kind: e.kind as LogEntry["kind"], themeId: e.themeId, taskId: typeof e.taskId === "string" ? e.taskId : null }];
    })
    .slice(-LOG_LIMIT);
}

export function parseRouletteResult(raw: unknown): RouletteResult {
  const d = rec(raw);
  const mode: RouletteMode = d.mode === "spin" || d.mode === "spinning" || d.mode === "task" || d.mode === "judged" ? d.mode : "themes";
  const lastRarity: Record<string, Rarity> = {};
  for (const [pid, v] of Object.entries(rec(d.lastRarity))) {
    const r = rarityOf(v);
    if (r && ID.test(pid)) lastRarity[pid] = r;
  }
  const before = rec(d.before);
  return {
    mode,
    changeable: d.changeable === true,
    choices: parseChoices(d.choices),
    added: ids(d.added, LIMITS.maxThemes),
    sectors: ids(d.sectors, LIMITS.maxThemes),
    order: ids(d.order, MAX_TEAMS),
    played: parsePlayed(d.played),
    log: parseLog(d.log),
    turn: parseTurn(d.turn),
    spin: parseSpin(d.spin),
    lastRarity,
    before: Object.keys(before).length > 0 ? before : null,
  };
}

/** Шагов у игры нет заранее (ходы и доп. вращения добавляют шаги): номинально пусто, как в «Правде или действии». */
export function rouletteSteps(): Step[] {
  return [];
}

/** Очки пишет сама игра прибавкой при итоге хода (п. 1). */
export function score(): ScoreDelta[] {
  return [];
}

// ------------------------------------------------------------------ выбор тем (шаг 0)

export interface ThemesAnswer {
  themes: string[];
  confirmed: boolean;
}

/** Сколько тем выбирает команда: по правилам игры, но не больше, чем есть в каталоге (Р-5). */
export function themesNeeded(content: RouletteContent): number {
  return Math.max(1, Math.min(content.themesPerTeam, catalogThemes(content).length));
}

/** Ответ капитана на шаге выбора тем: только темы каталога, без повторов, не больше разрешённого (Р-5). */
export function parseThemesAnswer(value: unknown, content: RouletteContent): ThemesAnswer | null {
  const v = rec(value);
  if (!Array.isArray(v.themes)) return null;
  const catalog = new Set(catalogThemes(content).map((t) => t.id));
  const themes = ids(v.themes, LIMITS.themes)
    .filter((id) => catalog.has(id))
    .slice(0, themesNeeded(content));
  // Порядок — как в каталоге: один и тот же выбор не выглядит «изменённым» из-за порядка касаний.
  return { themes: cleanThemes(content, themes), confirmed: v.confirmed === true };
}

/** Темы в порядке каталога (только из каталога, не больше нужного). */
function cleanThemes(content: RouletteContent, themes: readonly string[]): string[] {
  const chosen = new Set(themes);
  return catalogThemes(content)
    .filter((t) => chosen.has(t.id))
    .map((t) => t.id)
    .slice(0, themesNeeded(content));
}

/**
 * Выбор каждой команды сейчас: выбор ведущего или ответ капитана — что позже (Р-6). Подтверждённый ответ с нужным
 * числом тем — выбор капитана; более поздний неподтверждённый («Изменить») снимает готовность команды.
 */
export function effectiveChoices(content: RouletteContent, r: RouletteResult, answers: readonly Answer[], step = 0): Record<string, ThemeChoice> {
  const out: Record<string, ThemeChoice> = { ...r.choices };
  const need = themesNeeded(content);
  const latest = new Map<string, Answer>();
  for (const a of answers) {
    if (a.step !== step) continue;
    const prev = latest.get(a.pid);
    if (!prev || (a.submittedAt ?? 0) >= (prev.submittedAt ?? 0)) latest.set(a.pid, a);
  }
  for (const [pid, a] of latest) {
    const at = a.submittedAt ?? 0;
    const current = out[pid];
    if (current && at <= current.at) continue;
    const parsed = parseThemesAnswer(a.value, content);
    if (!parsed) continue;
    if (parsed.confirmed && parsed.themes.length === need) out[pid] = { themes: parsed.themes, by: "captain", at };
    else delete out[pid];
  }
  return out;
}

/**
 * Кандидаты в очередь: команды по времени входа, потом команды таблицы без телефона (добавлены вручную) — в порядке
 * таблицы. Только те, кто в таблице или ещё будет внесён пультом (новая команда).
 */
export function teamCandidates(session: Session, participants: readonly Participant[]): string[] {
  const joined = [...scoringParticipants([...participants], "teams")].sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0) || a.id.localeCompare(b.id)).map((p) => p.id);
  return [...new Set([...joined, ...Object.keys(session.leaderboard)])];
}

export interface ThemesStatus {
  /** Очередь: первые 8 команд (Р-8). */
  queue: string[];
  /** Команды сверх восьми — в игру не попадут. */
  overflow: string[];
  /** Команды очереди без выбора. */
  missing: string[];
  sectors: string[];
  /** Почему «К колесу» недоступно; пусто — можно. */
  problems: string[];
}

/** Секторы — объединение тем команд очереди и тем ведущего, без повторов, в порядке каталога (Р-9). */
export function sectorsOf(content: RouletteContent, choices: Record<string, ThemeChoice>, queue: readonly string[], added: readonly string[]): string[] {
  const chosen = new Set<string>(added);
  for (const pid of queue) for (const t of choices[pid]?.themes ?? []) chosen.add(t);
  return catalogThemes(content)
    .filter((t) => chosen.has(t.id))
    .map((t) => t.id);
}

export function themesStatus(content: RouletteContent, session: Session, participants: readonly Participant[], choices: Record<string, ThemeChoice>, added: readonly string[]): ThemesStatus {
  const all = teamCandidates(session, participants);
  const queue = all.slice(0, MAX_TEAMS);
  const overflow = all.slice(MAX_TEAMS);
  const missing = queue.filter((pid) => !choices[pid]);
  const sectors = sectorsOf(content, choices, queue, added);
  const problems: string[] = [];
  if (queue.length < MIN_TEAMS) problems.push("Нужно хотя бы " + MIN_TEAMS + " команды.");
  if (missing.length > 0) problems.push("Ещё не выбрали темы: " + missing.length + ".");
  if (sectors.length < LIMITS.minThemes) problems.push("В колесе " + sectors.length + " из " + LIMITS.minThemes + " тем — добавьте темы из каталога.");
  return { queue, overflow, missing, sectors, problems };
}

/** Шаг выбора тем открыт. */
export function onThemes(session: Session): boolean {
  const r = parseRouletteResult(session.state.result);
  return session.state.phase === "playing" && session.state.step === 0 && session.state.stage === "question" && r.mode === "themes";
}

/** «Открыть выбор тем»: команды в таблицу, шаг 0 — приём ответов без таймера, ответ можно менять. */
export function openThemes(session: Session, participants: Participant[]): SessionChange {
  return {
    leaderboard: leaderboardAdditions(session.leaderboard, participants, "teams"),
    state: { step: 0, stage: "question", startedAt: "server", timeLimit: null, revealed: false, answered: 0, result: { mode: "themes", changeable: true, choices: {}, added: [] } },
    expect: { phase: "playing", step: 0, stage: "ready" },
  };
}

function themesResult(choices: Record<string, ThemeChoice>, added: readonly string[]): Record<string, unknown> {
  return { mode: "themes", changeable: true, choices, added: [...added] };
}

/**
 * Пульт переносит выбор капитанов в сессию (экран и телефоны видят только её) и пишет счётчик «Ответили» (ownAnswered).
 * null — писать нечего.
 */
export function syncThemes(session: Session, content: RouletteContent, answers: readonly Answer[]): SessionChange | null {
  if (!onThemes(session)) return null;
  const r = parseRouletteResult(session.state.result);
  const choices = effectiveChoices(content, r, answers);
  const answered = Object.keys(choices).length;
  if (resultKey(choices) === resultKey(r.choices) && session.state.answered === answered) return null;
  return { state: { answered, result: themesResult(choices, r.added) }, expect: { phase: "playing", step: 0, stage: "question", result: resultKey(session.state.result) } };
}

/** Последнее время ответа команды на шаге выбора тем, которое видит пульт. */
function lastAnswerAt(answers: readonly Answer[], pid: string): number {
  return answers.filter((a) => a.step === 0 && a.pid === pid).reduce((m, a) => Math.max(m, a.submittedAt ?? 0), 0);
}

/** Ведущий выбирает темы за команду (Р-6); пустой список — снять выбор. */
export function hostChoose(session: Session, content: RouletteContent, answers: readonly Answer[], team: string, themes: readonly string[]): SessionChange | null {
  if (!onThemes(session)) return null;
  const r = parseRouletteResult(session.state.result);
  const current = effectiveChoices(content, r, answers);
  const clean = cleanThemes(content, themes);
  const choices = { ...current };
  if (clean.length === 0) delete choices[team];
  else choices[team] = { themes: clean, by: "host", at: lastAnswerAt(answers, team) };
  return { state: { answered: Object.keys(choices).length, result: themesResult(choices, r.added) }, expect: { phase: "playing", step: 0, stage: "question", result: resultKey(session.state.result) } };
}

/** Ведущий добавляет или убирает тему колеса сверх выбора команд (Р-7). */
export function hostToggleAdded(session: Session, content: RouletteContent, answers: readonly Answer[], themeId: string): SessionChange | null {
  if (!onThemes(session)) return null;
  const r = parseRouletteResult(session.state.result);
  if (!catalogThemes(content).some((t) => t.id === themeId)) return null;
  const added = r.added.includes(themeId) ? r.added.filter((t) => t !== themeId) : [...r.added, themeId];
  const choices = effectiveChoices(content, r, answers);
  return { state: { answered: Object.keys(choices).length, result: themesResult(choices, added) }, expect: { phase: "playing", step: 0, stage: "question", result: resultKey(session.state.result) } };
}

export type WheelPlan = { ok: true; change: SessionChange; status: ThemesStatus } | { ok: false; problems: string[]; status: ThemesStatus | null };

/**
 * «К колесу» по свежему списку ответов (О-8): секторы и очередь фиксируются до конца игры (Р-9), ходит первая команда
 * очереди. Запись несёт отметку списка ответов шага выбора тем — пришёл или сменился ответ, сервер ответит 409,
 * пульт перечитает выбор (Р-7).
 */
export function planWheel(session: Session, content: RouletteContent, participants: Participant[], fresh: readonly Answer[]): WheelPlan {
  if (!onThemes(session)) return { ok: false, problems: ["Выбор тем уже закрыт."], status: null };
  const r = parseRouletteResult(session.state.result);
  const choices = effectiveChoices(content, r, fresh);
  const status = themesStatus(content, session, participants, choices, r.added);
  if (status.problems.length > 0) return { ok: false, problems: status.problems, status };
  const first = status.queue[0] as string;
  const result: RouletteResult = {
    mode: "spin",
    changeable: false,
    choices,
    added: r.added,
    sectors: status.sectors,
    order: status.queue,
    played: {},
    log: [],
    turn: { n: 1, round: 1, team: first, extra: false },
    spin: null,
    lastRarity: {},
    before: null,
  };
  return {
    ok: true,
    status,
    change: {
      leaderboard: leaderboardAdditions(session.leaderboard, participants, "teams"),
      state: { step: 1, stage: "question", startedAt: "server", timeLimit: null, revealed: false, answered: 0, result },
      expect: { phase: "playing", step: 0, stage: "question", answers: answersMark(0, fresh) },
    },
  };
}

export interface RouletteBack {
  change: SessionChange;
  /** Стереть ответы покидаемого шага — только после записи шага назад (Р-43, Н-3). */
  clearAnswers?: number;
}

/**
 * «Назад» с первого хода к выбору тем — только пока не было ни одного вращения (Р-42). Выбор команд и темы ведущего
 * остаются; ответы шага выбора тем не стираются никогда (Р-43).
 */
export function backToThemes(session: Session): RouletteBack | null {
  const { phase, step, stage } = session.state;
  const r = parseRouletteResult(session.state.result);
  if (phase !== "playing" || step !== 1 || stage !== "question" || r.mode !== "spin" || r.spin || r.turn?.n !== 1 || r.turn.extra) return null;
  if (Object.values(r.played).some((list) => list.length > 0)) return null;
  return {
    change: {
      state: { step: 0, stage: "question", startedAt: null, timeLimit: null, revealed: false, answered: Object.keys(r.choices).length, result: themesResult(r.choices, r.added) },
      expect: { phase: "playing", step: 1, stage: "question", result: resultKey(session.state.result) },
    },
    clearAnswers: 1,
  };
}

/**
 * Очередь с опоздавшими: команды, которых нет в очереди, встают в конец (Р-10), пока в очереди меньше восьми (Р-8);
 * убранные из таблицы команды из очереди выпадают.
 */
export function queueWithLate(order: readonly string[], session: Session, participants: readonly Participant[]): string[] {
  const kept = order.filter((pid) => pid in session.leaderboard);
  const late = teamCandidates(session, participants).filter((pid) => !order.includes(pid) && pid in session.leaderboard);
  return [...kept, ...late].slice(0, Math.max(MAX_TEAMS, kept.length));
}

export type RouletteAction = "openThemes" | "toWheel" | "spin" | "other";

/** Главная кнопка пульта на этом этапе. */
export function rouletteAction(session: Session): RouletteAction {
  const { stage, step } = session.state;
  const r = parseRouletteResult(session.state.result);
  if (stage === "ready" && step === 0 && r.mode === "themes") return "openThemes";
  if (onThemes(session)) return "toWheel";
  if (stage === "question" && r.mode === "spin") return "spin";
  return "other";
}
