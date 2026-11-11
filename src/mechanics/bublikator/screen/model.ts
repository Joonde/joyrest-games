/**
 * Экран зала «Бубликатора» без React (Блок 2c): поток `screen` игровой комнаты → модель → какой экран показать.
 * Поток экрана — без тайн (`screenView`: ни диверсантов, ни ложных приказов), целиком при каждом изменении (≤ 5 в секунду).
 * Часы — как у телефона: сдвиг «сервер − экран» по `at` событий, на паузе отсчёты стоят.
 */
import type { RoomClosedReason, RoomStreamEvent } from "../../../data/types";
import { nextOffset } from "../phone/model";
import type { EventKind, ScreenCrewView, ScreenView } from "../rules/types";

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
  /**
   * Вид — снимок, а не перемена (первая сводка потока, переподключение, опрос, сводка после «закрыто»): моменты по нему не
   * играются — ни аплодисментов, ни фанфар, ни салюта за то, что случилось без экрана (аудит 2c, №6).
   */
  fresh: boolean;
}

export function emptyScreen(now: number): ScreenModel {
  return { view: null, paused: false, pausedAt: null, offset: null, closed: null, players: 0, online: 0, heardAt: now, viewAt: null, fresh: true };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Пауза из события: момент паузы по часам сервера берём из вида (`pausedAt` — сервер знает, когда встало время; экран, открытый
 * посреди паузы, иначе считал бы остатки от «сейчас», аудит 2c, №5), без него — время события (прежний сервер).
 */
function withPause(m: ScreenModel, paused: boolean, at: number, view: ScreenView | null): ScreenModel {
  if (!paused) return m.paused ? { ...m, paused: false, pausedAt: null } : m;
  const fromView = view && typeof view.pausedAt === "number" && Number.isFinite(view.pausedAt) ? view.pausedAt : null;
  return { ...m, paused: true, pausedAt: fromView ?? (m.paused ? m.pausedAt : at) };
}

/** Событие потока экрана → новая модель. */
export function applyScreen(m0: ScreenModel, e: RoomStreamEvent, local: number): ScreenModel {
  const m: ScreenModel = { ...m0, offset: nextOffset(m0.offset, e.at, local), heardAt: local };
  switch (e.type) {
    case "screen": {
      if (!isRecord(e.data)) return { ...withPause(m, e.paused, e.at, m.view), players: e.players, online: e.online };
      const view = e.data as unknown as ScreenView;
      // Снимок: сервер так пометил (подписка, переподключение, опрос), вида ещё не было или поток был закрыт.
      const fresh = e.fresh === true || m0.view === null || m0.closed !== null;
      return { ...withPause(m, e.paused, e.at, view), view, viewAt: e.at, players: e.players, online: e.online, closed: null, fresh };
    }
    case "snapshot": {
      if (!isRecord(e.data)) return withPause(m, e.paused, e.at, m.view);
      const view = e.data as unknown as ScreenView;
      return { ...withPause(m, e.paused, e.at, view), view, viewAt: e.at, closed: null, fresh: true };
    }
    case "room":
      return withPause(m, e.paused, e.at, null);
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
  /** Какое событие началось сейчас (для своего звука). */
  eventKind: EventKind | null;
  /** Началось предупреждение о событии (сирена, красная рамка). */
  warn: boolean;
  /** Сколько приказов выполнено с прошлого вида (каждый — новый приказ: «бип»). */
  orders: number;
  /** У кого-то просрочка (удар). */
  fail: boolean;
  /** Кто-то встал на ремонт (лязг). */
  repair: boolean;
  finish: number[];
  salutes: Array<{ crew: number; n: number }>;
  dock: boolean;
  reveal: boolean;
  podium: boolean;
}

/** Моменты для звука и салюта по новой модели: снимок (`fresh`) ничего не «наступает». */
export function momentsFor(prev: ScreenView | null, m: ScreenModel): ScreenMoments {
  return momentsOf(m.fresh ? null : prev, m.view);
}

export function momentsOf(prev: ScreenView | null, next: ScreenView | null): ScreenMoments {
  const none: ScreenMoments = { launch: false, event: false, eventKind: null, warn: false, orders: 0, fail: false, repair: false, finish: [], salutes: [], dock: false, reveal: false, podium: false };
  if (!prev || !next) return none;
  const was = new Map(prev.crews.map((c) => [c.id, c]));
  const stage = (v: ScreenView) => `${v.phase}/${v.stage ?? ""}/${v.leg}`;
  const ev = next.event;
  const started = ev !== null && !ev.warn && (prev.event?.id !== ev.id || prev.event.warn);
  return {
    launch: next.stage === "launch" && stage(prev) !== stage(next),
    event: started,
    eventKind: started && ev ? ev.kind : null,
    warn: ev !== null && ev.warn && prev.event?.id !== ev.id,
    orders: next.phase === "leg" && prev.phase === "leg" && next.leg === prev.leg ? Math.max(0, next.ordersDone - prev.ordersDone) : 0,
    fail: next.crews.some((c) => c.failSeq > (was.get(c.id)?.failSeq ?? c.failSeq)),
    repair: next.crews.some((c) => c.repair !== null && was.get(c.id)?.repair === null),
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

/**
 * Сколько имён показать фишками в строке экипажа лобби (остальные — «+N»). Больше 10 экипажей — без имён (только «N из M мест»);
 * 7–10 — два столбца, под названием одна строка: два имени или одно и «+N» (аудит 2c, №2 — третье имя вытесняло название);
 * до 6 — столько, сколько помещается в две строки фишек шириной 16,5 `u` (замер стенда: 16,8–18,6 `u` × 5,5–7 `u`, фишка 1,65–2 `u`):
 * ширина фишки — по длине имени (не шире 10 `u`), с местом под «+N» (иначе длинные имена уходили строкой под рамку).
 */
export function chipsShown(names: readonly string[], crews: number): number {
  if (crews > 10) return 0;
  if (crews > 6) return names.length <= 2 ? names.length : 1;
  const width = 16.5;
  const rows = 2;
  const gap = 0.45;
  const chip = (text: string) => Math.min(10, 1.5 + 0.75 * [...text].length);
  const rowsOf = (items: number[]) => {
    let n = 1;
    let x = 0;
    for (const w of items) {
      if (x > 0 && x + gap + w > width) {
        n += 1;
        x = w;
      } else x += (x > 0 ? gap : 0) + w;
    }
    return n;
  };
  for (let k = Math.min(names.length, 6); k > 0; k -= 1) {
    const items = names.slice(0, k).map(chip);
    if (k < names.length) items.push(chip(`+${names.length - k}`));
    if (rowsOf(items) <= rows) return k;
  }
  return 0;
}

/**
 * «Все на палубу!»: раскладка по длине задания (аудит 2c, №3). Короткое — крупно, с кораблями; длинное (до 120 знаков) —
 * мельче, отсчёт меньше, карточки без кораблей (иначе названия экипажей уходили под край).
 */
export function captainLayout(task: string, crews: number): { size: "short" | "mid" | "long"; ships: boolean; timer: string } {
  const n = task.trim().length;
  const size = n <= 40 ? "short" : n <= 80 ? "mid" : "long";
  return { size, ships: size !== "long" && crews <= (size === "short" ? 10 : 5), timer: size === "long" ? "17cqh" : size === "mid" ? "21cqh" : "26cqh" };
}

/** «места 9–12», а если место одно (все вне дорожек на одном месте) — «место 9» (аудит 2c, №16). */
export function placesText(first: number | undefined, last: number | undefined): string {
  if (first === undefined || last === undefined) return "";
  return first === last ? `место ${first}` : `места ${first}–${last}`;
}

/** Сколько рывков показано у экипажа: выполнено (`ok`) и просрочено (`fail`). Ключ анимации растёт только при росте счётчика. */
export type Bumps = Record<number, { ok: number; fail: number }>;

/**
 * Рывки кораблей (аудит 2c, №7): только когда `okSeq` / `failSeq` выросли относительно прошлого вида и вид — не снимок. Открыли
 * экран или переподключились — счётчики те же, ничего не дёргается.
 */
export function nextBumps(prev: ScreenView | null, next: ScreenView | null, fresh: boolean, bumps: Bumps): Bumps {
  if (!next || !prev || fresh) return bumps;
  const was = new Map(prev.crews.map((c) => [c.id, c]));
  let out = bumps;
  for (const c of next.crews) {
    const p = was.get(c.id);
    if (!p) continue;
    const ok = c.okSeq > p.okSeq;
    const fail = c.failSeq > p.failSeq;
    if (!ok && !fail) continue;
    const cur = out[c.id] ?? { ok: 0, fail: 0 };
    out = { ...out, [c.id]: { ok: cur.ok + (ok ? 1 : 0), fail: cur.fail + (fail ? 1 : 0) } };
  }
  return out;
}

/**
 * Щит «Метеоритного дождя» (аудит 2c, №1): доля высоты дорожки 0,55–1 по силе щита — растёт от силы, но не выходит за свою
 * дорожку (соседние корабли и плашку дождя не задевает). Слабый (< 50) — пунктиром; у детей урона нет — без «беды».
 */
export function shieldLook(shield: number, kids: boolean): { scale: number; weak: boolean } {
  const s = Math.max(0, Math.min(100, shield)) / 100;
  return { scale: Math.round((0.55 + 0.45 * s) * 100) / 100, weak: !kids && shield < 50 };
}

/** Звуки экрана (решение владельца 11 ноября 2026, звуки ТЗ) — имена синтеза платформы (`sound.ts`). */
export type ScreenSound = "whoosh" | "siren" | "whistle" | "hum" | "gong" | "beep" | "thud" | "clank" | "fanfare" | "applause" | "drumroll" | "sparkle" | "pop";

/** «Бип» нового приказа на весь зал — не чаще (склеиваем). */
export const BEEP_EVERY_MS = 500;

const EVENT_SOUND: Record<EventKind, ScreenSound> = { meteor: "whistle", pull: "hum", sos: "gong", captain: "gong" };

/**
 * Какие звуки дать на моменты (только моменты при открытом экране — `momentsFor`): сирена на предупреждение, у события — свой
 * звук (свист метеоров, гул притяжения, гонг), «бип» нового приказа (не чаще `BEEP_EVERY_MS`, `beepAt` — когда был прошлый),
 * удар просрочки, лязг ремонта, фанфары финиша, аплодисменты привала, дробь раскрытия, фанфары пьедестала, хлопок салюта.
 */
export function soundsOf(mo: ScreenMoments, glitch: boolean, now: number, beepAt: number): { sounds: ScreenSound[]; beepAt: number } {
  const out: ScreenSound[] = [];
  if (mo.launch) out.push("whoosh");
  if (mo.warn) out.push("siren");
  if (mo.eventKind) out.push(EVENT_SOUND[mo.eventKind]);
  if (glitch) out.push("sparkle");
  if (mo.repair) out.push("clank");
  if (mo.fail) out.push("thud");
  if (mo.finish.length > 0 || mo.podium) out.push("fanfare");
  if (mo.dock) out.push("applause");
  if (mo.reveal) out.push("drumroll");
  if (mo.salutes.length > 0) out.push("pop");
  let at = beepAt;
  // Бип — только когда ничего громкого не звучит, и не чаще раза в полсекунды на весь зал.
  if (mo.orders > 0 && out.length === 0 && now - beepAt >= BEEP_EVERY_MS) {
    out.push("beep");
    at = now;
  }
  return { sounds: [...new Set(out)], beepAt: at };
}

/** Тон огонька SOS: новый огонёк загорелся — его цвет (`sos0`…`sos3`), иначе ничего. */
export function sosToneOf(seq: readonly number[], lit: number | null, lastLit: number | null): `sos${0 | 1 | 2 | 3}` | null {
  if (lit === null || lit === lastLit) return null;
  const c = seq[lit];
  return c === 0 || c === 1 || c === 2 || c === 3 ? (`sos${c}` as const) : null;
}

/** Как часто перерисовывать доску: SOS — 10 раз в секунду (огоньки), раскрытие по одному — 4, отсчёты — 2, остальное — никогда. */
export function tickOf(board: Board, revealing: boolean, paused: boolean): number | null {
  if (paused) return null;
  if (board === "sos") return 100;
  if (board === "reveal") return revealing ? 250 : null;
  return ["launch", "drill", "flight", "pull", "captain", "vote"].includes(board) ? 500 : null;
}
