/**
 * Экран зала «Бубликатора» без React (Блок 2c): поток `screen` игровой комнаты → модель → какой экран показать.
 * Поток экрана — без тайн (`screenView`: ни диверсантов, ни ложных приказов), целиком при каждом изменении (≤ 5 в секунду).
 * Часы — как у телефона: сдвиг «сервер − экран» по `at` событий, на паузе отсчёты стоят.
 */
import type { RoomClosedReason, RoomStreamEvent } from "../../../data/types";
import { nextOffset } from "../phone/model";
import type { ScreenCrewView, ScreenView } from "../rules/types";

export interface ScreenModel {
  view: ScreenView | null;
  paused: boolean;
  pausedAt: number | null;
  offset: number | null;
  closed: RoomClosedReason | null;
  /** Гостей в комнате и на связи (из потока). */
  players: number;
  online: number;
  heardAt: number;
  /** Время сервера, к которому относится вид (`at` последнего события с видом): отсчёт полёта между событиями. */
  viewAt: number | null;
}

export function emptyScreen(now: number): ScreenModel {
  return { view: null, paused: false, pausedAt: null, offset: null, closed: null, players: 0, online: 0, heardAt: now, viewAt: null };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Событие потока экрана → новая модель. */
export function applyScreen(m0: ScreenModel, e: RoomStreamEvent, local: number): ScreenModel {
  let m: ScreenModel = { ...m0, offset: nextOffset(m0.offset, e.at, local), heardAt: local };
  const pause = (paused: boolean, at: number): ScreenModel => (paused === m.paused ? m : { ...m, paused, pausedAt: paused ? at : null });
  switch (e.type) {
    case "screen": {
      m = pause(e.paused, e.at);
      return isRecord(e.data) ? { ...m, view: e.data as unknown as ScreenView, viewAt: e.at, players: e.players, online: e.online, closed: null } : { ...m, players: e.players, online: e.online };
    }
    case "snapshot": {
      m = pause(e.paused, e.at);
      return isRecord(e.data) ? { ...m, view: e.data as unknown as ScreenView, viewAt: e.at, closed: null } : m;
    }
    case "room":
      return pause(e.paused, e.at);
    case "closed":
      return { ...m, closed: e.reason };
    default:
      return m;
  }
}

export function serverNow(m: ScreenModel, local: number): number {
  return m.paused && m.pausedAt !== null ? m.pausedAt : local + (m.offset ?? 0);
}

/** Сколько осталось до момента по часам сервера (на паузе стоит). */
export function leftUntil(m: ScreenModel, at: number | null | undefined, local: number): number | null {
  if (at === null || at === undefined || !Number.isFinite(at)) return null;
  return Math.max(0, at - serverNow(m, local));
}

/** Секунды для `HallTimer` (целые, вверх). */
export function secondsLeft(ms: number | null): number | null {
  return ms === null ? null : Math.ceil(ms / 1000);
}

export type Board =
  | "connecting"
  | "tab"
  | "abandoned"
  | "removed"
  | "over"
  | "lobby"
  | "crews"
  | "drill"
  | "launch"
  | "flight"
  | "pull"
  | "sos"
  | "captain"
  | "dock"
  | "vote"
  | "reveal"
  | "podium";

/** Какой экран показать. Пауза — плашкой поверх (экран под ней тот же). */
export function boardOf(m: ScreenModel): Board {
  if (m.closed === "busy" || m.closed === "replaced") return "tab";
  if (m.closed === "abandoned") return "abandoned";
  if (m.closed === "removed") return "removed";
  const v = m.view;
  if (m.closed === "finished") return v?.podium ? "podium" : "over";
  if (!v) return "connecting";
  if (v.phase === "lobby") return "lobby";
  if (v.phase === "crews") return "crews";
  if (v.phase === "drill") return "drill";
  if (v.phase === "podium" || v.phase === "finished") return v.podium ? "podium" : "over";
  if (v.stage === "launch") return "launch";
  if (v.stage === "dock") return "dock";
  if (v.stage === "vote") return "vote";
  if (v.stage === "voted") return v.reveal && v.reveal.length > 0 ? "reveal" : "dock";
  const ev = v.event;
  if (ev && !ev.warn) {
    if (ev.kind === "pull") return "pull";
    if (ev.kind === "sos") return "sos";
    if (ev.kind === "captain") return "captain";
  }
  return "flight";
}

/** Дорожек на экране не больше: остальные экипажи — строкой внизу (макет scr-flight-many). */
export const MAX_LANES = 8;

/**
 * Дорожки полёта: до 8 экипажей — у каждого своя (в порядке экипажей, место не двигает дорожку); больше — дорожки у 8 лучших
 * по месту (в порядке экипажей), остальные — строкой по местам.
 */
export function lanesOf(crews: readonly ScreenCrewView[], max = MAX_LANES): { lanes: ScreenCrewView[]; rest: ScreenCrewView[] } {
  const byId = [...crews].sort((a, b) => a.id - b.id);
  if (byId.length <= max) return { lanes: byId, rest: [] };
  const byPlace = [...crews].sort((a, b) => a.place - b.place || a.id - b.id);
  const top = new Set(byPlace.slice(0, max).map((c) => c.id));
  return { lanes: byId.filter((c) => top.has(c.id)), rest: byPlace.filter((c) => !top.has(c.id)) };
}

/** Доля пути 0–1 (дальность до 1000). */
export function progressOf(dist: number): number {
  return Math.max(0, Math.min(1, dist / 1000));
}

/** Скорость «×1,2» (относительно средней). Стоит на ремонте — «стоит». */
export function speedText(c: Pick<ScreenCrewView, "ratio" | "repair" | "finished">): string {
  if (c.finished) return "финиш";
  if (c.repair) return "стоит";
  return `×${c.ratio.toFixed(1).replace(".", ",")}`;
}

/** Деления прочности: 5 штук, у каждого заполнение 0–100%. */
export function hullCells(hull: number, cells = 5): number[] {
  return Array.from({ length: cells }, (_, k) => Math.round(Math.max(0, Math.min(1, hull - k)) * 100));
}

/**
 * Что изменилось между двумя видами — для звуков и салюта: только то, что случилось при открытом экране (первый снимок
 * ничего не «наступает»).
 */
export interface ScreenMoments {
  launch: boolean;
  event: boolean;
  finish: number[];
  salutes: Array<{ crew: number; n: number }>;
  dock: boolean;
  reveal: boolean;
  podium: boolean;
}

export function momentsOf(prev: ScreenView | null, next: ScreenView | null): ScreenMoments {
  const none: ScreenMoments = { launch: false, event: false, finish: [], salutes: [], dock: false, reveal: false, podium: false };
  if (!prev || !next) return none;
  const was = new Map(prev.crews.map((c) => [c.id, c]));
  const stage = (v: ScreenView) => `${v.phase}/${v.stage ?? ""}/${v.leg}`;
  return {
    launch: next.stage === "launch" && stage(prev) !== stage(next),
    event: next.event !== null && !next.event.warn && (prev.event?.id !== next.event.id || prev.event.warn),
    finish: next.crews.filter((c) => c.finished && was.get(c.id)?.finished === false).map((c) => c.id),
    salutes: next.crews.map((c) => ({ crew: c.id, n: c.salutes - (was.get(c.id)?.salutes ?? c.salutes) })).filter((x) => x.n > 0),
    dock: next.stage === "dock" && prev.stage !== "dock",
    reveal: next.stage === "voted" && prev.stage !== "voted",
    podium: next.phase === "podium" && prev.phase !== "podium",
  };
}

/**
 * Сколько осталось лететь (мс): `duration − elapsed` из вида и сколько прошло с него по часам сервера (вид приходит не чаще
 * 5 раз в секунду, а при тишине — реже). Стоит во время события, на паузе и до прихода следующего вида дальше не уходит
 * больше чем на 2 с (связь пропала — часы не убегают).
 */
export function flightLeft(m: ScreenModel, local: number): number | null {
  const f = m.view?.flight;
  if (!f) return null;
  const base = Math.max(0, f.duration - f.elapsed);
  if (f.stopped || m.paused || m.viewAt === null) return base;
  const since = Math.max(0, Math.min(2000, serverNow(m, local) - m.viewAt));
  return Math.max(0, base - since);
}

/** «Сигнал SOS» на экране: огонёк горит 0,75 с, следующий — через 1 с, после последовательности — пауза 1 с и повтор. */
export const SOS_STEP_MS = 1000;
export const SOS_LIT_MS = 750;

export function sosCycleMs(length: number): number {
  return (Math.max(1, length) + 1) * SOS_STEP_MS;
}

/** Какой огонёк горит в момент `at` (часы сервера): номер в последовательности или null (пауза между огоньками и повторами). */
export function sosLit(length: number, startsAt: number, at: number): number | null {
  if (length <= 0 || at < startsAt) return null;
  const t = (at - startsAt) % sosCycleMs(length);
  const i = Math.floor(t / SOS_STEP_MS);
  if (i >= length) return null;
  return t - i * SOS_STEP_MS < SOS_LIT_MS ? i : null;
}

/** «1 человек», «2 человека», «5 человек». */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

/** Число с пробелом в тысячах: «1 344». */
export function num(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** «0:18» — минуты и секунды (вверх до секунды). */
export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** «Притяжение» у экипажа: сколько держат «Тягу» из тех, кто на связи (точки), доля 3 секунд и подпись. */
export function pullOf(c: ScreenCrewView, holdMs: number): { holding: number; total: number; share: number; text: string; tone: "ok" | "bad" | "wait" | "hold" } {
  const p = c.pull;
  const total = Math.max(0, c.online);
  if (!p) return { holding: 0, total, share: 0, text: "Не участвует", tone: "wait" };
  const holding = Math.max(0, total - p.notHolding.length);
  const share = Math.max(0, Math.min(1, p.held / holdMs));
  const secs = (ms: number) => (ms / 1000).toFixed(1).replace(".", ",").replace(",0", "");
  if (p.escaped) return { holding, total, share: 1, text: "Вырвались!", tone: "ok" };
  if (p.failed) return { holding, total, share, text: "Не вырвались — минус деление", tone: "bad" };
  if (p.held > 0) return { holding, total, share, text: `Держат все · ${secs(p.held)} из ${secs(holdMs)} с`, tone: "hold" };
  return { holding, total, share: 0, text: `Ждём всех · 0 из ${secs(holdMs)} с`, tone: "wait" };
}

/** Раскрытие диверсантов по одному: сколько карточек открыто через `ms` после начала (шаг 1,6 с). Открыли экран позже — все. */
export const REVEAL_STEP_MS = 1600;

export function revealedCount(total: number, sinceMs: number | null): number {
  if (sinceMs === null) return total;
  return Math.max(0, Math.min(total, Math.floor(sinceMs / REVEAL_STEP_MS) + 1));
}

/** Доля угадавших у раскрытого диверсанта: «угадали 5 из 6». */
export function guessedOf(r: { saboteur: string; votes: Record<string, number> }): { right: number; all: number } {
  const all = Object.values(r.votes).reduce((a, n) => a + (Number.isFinite(n) ? n : 0), 0);
  return { right: r.votes[r.saboteur] ?? 0, all };
}

/** Сетка карточек: сколько колонок под n карточек на экране 16:9 (до 5 в ряд, дальше — рядами по 5–7). */
export function cardColumns(n: number): number {
  if (n <= 5) return Math.max(1, n);
  if (n <= 10) return 5;
  if (n <= 14) return 7;
  return Math.ceil(n / 3);
}

/** Сколько имён показать фишками в строке экипажа лобби (остальные — «+N»); больше 10 экипажей — без имён (только «N из M мест»). */
export function chipsShown(count: number, crews: number): number {
  if (crews > 10) return 0;
  const cap = crews <= 5 ? 6 : 3;
  return count <= cap ? count : cap - 1;
}
