/**
 * Пульт «Бубликатора» без React (Блок 2d): поток `host` игровой комнаты → модель (сводка раз в секунду, пауза, закрытие),
 * какой экран пульта, подписи главной кнопки, тексты отказов, таблица лидеров платформы по общему счёту экипажей.
 * Логика игры — на сервере (`rules/game.ts`); здесь только то, что пульт показывает и что шлёт.
 */
import type { Leaderboard, LeaderboardEntry, RoomClosedReason, RoomLoopStats, RoomOfflinePlayer, RoomStreamEvent } from "../../../data/types";
import type { EventKind, HostView } from "../rules/types";

export interface HostModel {
  view: HostView | null;
  /** Этап игры (`moment` комнаты): команда шлёт его в `expect` — двойное касание и второй пульт не сработают дважды. */
  moment: string;
  version: number;
  paused: boolean;
  /** Когда пульт узнал о паузе (часы сервера, по событию потока) — запасной момент, пока сводка не принесла `pausedAt`. */
  pauseSince: number | null;
  /** Комнату подняли после перезапуска сервера (она на паузе). */
  restored: boolean;
  players: number;
  online: number;
  offline: RoomOfflinePlayer[];
  loop: RoomLoopStats | null;
  /** Часы сервера минус местные, мс (по последнему событию потока). */
  skew: number;
  closed: RoomClosedReason | null;
  /** Сколько сводок пришло: после команды пульт ждёт следующую (кнопка не нажимается дважды). */
  seq: number;
}

export function emptyHost(): HostModel {
  return { view: null, moment: "", version: 0, paused: false, pauseSince: null, restored: false, players: 0, online: 0, offline: [], loop: null, skew: 0, closed: null, seq: 0 };
}

const PHASES = new Set(["lobby", "crews", "drill", "leg", "podium", "finished"]);

/** Сводка пульта из потока: только похожая на `HostView` (битая — не ломает пульт, ждём следующую). */
export function isHostView(data: unknown): data is HostView {
  if (typeof data !== "object" || data === null) return false;
  const v = data as Partial<HostView>;
  return typeof v.phase === "string" && PHASES.has(v.phase) && Array.isArray(v.crews) && typeof v.legs === "number";
}

export function applyHost(m: HostModel, e: RoomStreamEvent, localNow: number): HostModel {
  switch (e.type) {
    case "host":
      return {
        view: isHostView(e.data) ? e.data : m.view,
        moment: e.moment,
        version: e.version,
        paused: e.paused,
        pauseSince: e.paused ? (m.pauseSince ?? e.at) : null,
        restored: e.restored,
        players: e.players,
        online: e.online,
        offline: e.offline,
        loop: e.loop,
        skew: e.at - localNow,
        closed: null,
        seq: m.seq + 1,
      };
    case "room":
      return { ...m, paused: e.paused, pauseSince: e.paused ? (m.pauseSince ?? e.at) : null, skew: e.at - localNow, seq: m.seq + 1 };
    case "closed":
      return { ...m, closed: e.reason };
    default:
      return m;
  }
}

export type HostBoard = "connecting" | "tab" | "abandoned" | "over" | "lobby" | "crews" | "drill" | "launch" | "fly" | "dock" | "vote" | "voted" | "podium" | "finished";

/** Какой экран пульта. `sessionFinished` — сессия платформы завершена (поток закрыт `finished`). */
export function hostBoardOf(m: HostModel, sessionFinished = false): HostBoard {
  if (m.closed === "busy" || m.closed === "replaced") return "tab";
  if (m.closed === "abandoned") return "abandoned";
  if (m.closed === "finished" || sessionFinished) return "over";
  const v = m.view;
  if (!v) return "connecting";
  if (v.phase === "leg") return v.stage ?? "fly";
  return v.phase;
}

/** Время — «1:05», «0:07». */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * На каком моменте стоят отсчёты пульта (часы сервера); null — время идёт. Берётся из сводки (`pausedAt` — когда встало время
 * игры), а не из времени прихода сводки: сводки идут раз в секунду и на паузе, и отсчёт по ним «шёл» бы (аудит 2d, №1). После
 * «Продолжить» сводка с прежними сроками ещё на паузе — стоим, пока не придёт свежая (сроки в ней уже сдвинуты); пауза пришла
 * отдельным событием раньше сводки — стоим с момента этого события.
 */
export function pausedMomentOf(m: HostModel): number | null {
  const fromView = m.view?.pausedAt ?? null;
  if (fromView !== null) return fromView;
  return m.paused ? m.pauseSince : null;
}

/** Сколько осталось до момента по часам сервера; на паузе отсчёт стоит (сервер сдвинет моменты после «Продолжить»). */
export function leftOf(until: number | null, serverNow: number, pausedAt: number | null): number | null {
  if (until === null) return null;
  return Math.max(0, until - (pausedAt ?? serverNow));
}

/** Сколько осталось полёта: в сводке — сколько прошло на момент сводки; между сводками — досчитываем (не дальше 2 с). */
export function flightLeftOf(v: HostView, sinceMs: number, paused: boolean): number | null {
  const f = v.flight;
  if (!f) return null;
  const extra = f.stopped || paused ? 0 : Math.min(2000, Math.max(0, sinceMs));
  return Math.max(0, f.duration - f.elapsed - extra);
}

export const EVENT_TITLES: Record<EventKind, string> = { meteor: "Метеоритный дождь", pull: "Притяжение", sos: "Сигнал SOS", captain: "Все на палубу!" };
export const EVENT_HINTS: Record<EventKind, string> = {
  meteor: "10 с: трясут телефоны или тапают — щит корабля",
  pull: "20 с: весь экипаж держит «Тягу» 3 с вместе",
  sos: "15 с: капитан вводит цвета с экрана зала",
  captain: "60 с: задание ведущего, потом звёзды экипажам",
};

/** Главная кнопка «Дальше» с «Привала» и после голосования: что она сделает. */
export function nextLabel(v: HostView): string {
  if (v.stage === "dock" && v.voteOpensAt !== null) return "Кто диверсант? — открыть голосование";
  if (v.leg + 1 >= v.legs) return "К награждению";
  return `Старт перелёта ${v.leg + 2}`;
}

export function legTitle(v: HostView): string {
  return `Перелёт ${v.leg + 1} из ${v.legs}`;
}

/**
 * Отказ комнаты — короткий понятный текст; null — молча (игра ушла дальше: второй пульт или двойное касание; пульт ждёт
 * свежую сводку).
 */
export function commandError(code: string, reason: string): string | null {
  if (code === "failed-precondition") {
    switch (reason) {
      case "moved":
        return null;
      case "no-players":
        return "Пока никого нет — дождитесь гостей.";
      case "vote-running":
        return "Идёт голосование — дождитесь его конца.";
      case "vote-pending":
        return "Сначала голосование «Кто диверсант?» — потом объединять.";
      case "paused":
        return "Игра на паузе — сначала «Продолжить».";
      case "busy":
        return "Сейчас нельзя — подождите конца события или полёта.";
      case "disabled":
        return "Это событие выключено в настройках игры.";
      case "all-finished":
        return "Все экипажи уже у цели.";
      case "limit":
        return "Дальше нельзя: время на приказ — от 4 до 30 секунд.";
      case "online":
        return "Гость снова на связи — убирать не нужно.";
      case "full":
        return "В этом экипаже уже нет мест.";
      case "no-event":
        return "Событие уже закончилось.";
      case "nothing-to-undo":
        return "Назад уже нельзя.";
      case "finished":
        return "Игра уже завершена.";
      default:
        return "Сейчас это сделать нельзя — игра ушла дальше.";
    }
  }
  if (code === "permission-denied") return "Управлять игрой может только ведущий этой игры.";
  if (code === "not-found") return "Игра не найдена — откройте пульт заново из студии.";
  if (code === "invalid-argument") return "Не получилось — обновите пульт.";
  return "Нет связи — проверьте интернет и нажмите ещё раз.";
}

/**
 * Таблица лидеров платформы по общему счёту экипажей («История игр», «Игры сейчас», итоги по ссылке). У каждой команды экипажа —
 * общий счёт экипажа, и у команд, чьи экипажи влили в него («Объединить»), — тоже (решение владельца 13 ноября 2026: раньше у
 * них был 0). Чтобы экипаж не считался двумя-тремя местами, у всех его команд — общая группа `group` (id команды экипажа):
 * места считаются по экипажам (`rankedLeaderboard`, `places`), экипаж из двух команд — одно место, следующий — второе. Экипаж из
 * одной команды — без группы. null — менять нечего. Только существующие записи (новые команды пишет пульт платформы).
 */
export function leaderboardChange(v: HostView, board: Leaderboard): Record<string, LeaderboardEntry> | null {
  const want = new Map<string, { score: number; group: string | undefined }>();
  for (const c of v.crews) {
    const teams = c.team !== null && !c.teams.includes(c.team) ? [c.team, ...c.teams] : c.teams;
    const head = c.team ?? teams[0];
    const group = teams.length > 1 ? head : undefined;
    const score = Math.max(0, Math.round(c.total));
    for (const team of teams) want.set(team, { score, group });
  }
  // Команда была в экипаже (у записи группа), а теперь ни в одном («Назад» отменил перелёт, в который пришли её люди, и они
  // ушли) — 0 и без группы, иначе висели бы чужие очки и место. Записи без группы (ручные «+ Добавить команду») не трогаем.
  if (v.crews.length > 0) {
    for (const [team, entry] of Object.entries(board)) if (!want.has(team) && entry.group !== undefined) want.set(team, { score: 0, group: undefined });
  }
  const change: Record<string, LeaderboardEntry> = {};
  for (const [team, { score, group }] of want) {
    const entry = board[team];
    if (!entry || (entry.score === score && entry.group === group)) continue;
    const { group: _old, ...rest } = entry;
    void _old;
    change[team] = group === undefined ? { ...rest, score } : { ...rest, score, group };
  }
  return Object.keys(change).length > 0 ? change : null;
}

/**
 * Когда пульт пишет таблицу лидеров: итоги перелёта готовы (привал, голосование, раскрытие), на пьедестале — и перед первым
 * перелётом («Экипажи собраны», тренировка): туда же возвращает «Назад — переиграть перелёт» с первого перелёта, и очки
 * отменённого перелёта сразу уходят из таблицы, а не висят до следующего «Привала» (аудит 2d, №4). В полёте — нет: общий счёт
 * экипажа в полёте не меняется (итог перелёта — на «Привале»), писать нечего.
 */
export function syncsLeaderboard(v: HostView): boolean {
  if (v.phase === "podium" || v.phase === "finished" || v.phase === "crews" || v.phase === "drill") return true;
  return v.phase === "leg" && (v.stage === "dock" || v.stage === "vote" || v.stage === "voted");
}

/** Текст подтверждения «Объединить экипажи» (docs/bublikator.md, «Привал, места и пьедестал»). */
export function mergeText(from: { name: string; total: number }, to: { name: string }, between: boolean): string {
  const points = Math.round(from.total).toLocaleString("ru-RU");
  return `Объединить «${from.name}» с «${to.name}»? Очки «${from.name}» (${points}) прибавятся к «${to.name}». ${
    between ? "Отменить нельзя — только «Назад — переиграть перелёт»." : "Отменить нельзя."
  }`;
}

/** «Без связи 1:20» — сколько гость молчит. */
export function offlineText(ms: number): string {
  return ms < 60_000 ? `без связи ${Math.round(ms / 1000)} с` : `без связи ${mmss(ms)}`;
}

/** Сколько гостей «Давно без связи» видно сразу; остальные — «Показать всех» (аудит 2d, №9). */
export const OFFLINE_SHOWN = 3;

/**
 * Кого влить и куда: выбор ведущего, если такой экипаж ещё есть; иначе — первый маленький, нет маленьких — самый маленький
 * (объединять можно и экипажи от 3 человек). «Куда» — не тот же экипаж. Аудит 2d, №2: блок пропадал, когда все экипажи были
 * от 3 человек и когда выбранный экипаж уже влили (выбор держал номер экипажа, которого больше нет).
 */
export function mergePick(crews: ReadonlyArray<{ id: number; players: number; small: boolean }>, from: number | null, to: number | null): { fromId: number | null; toId: number | null } {
  if (crews.length < 2) return { fromId: null, toId: null };
  const smallest = [...crews].sort((a, b) => a.players - b.players || a.id - b.id)[0];
  const fromId = from !== null && crews.some((c) => c.id === from) ? from : (crews.find((c) => c.small)?.id ?? smallest?.id ?? null);
  const toId = to !== null && to !== fromId && crews.some((c) => c.id === to) ? to : (crews.find((c) => c.id !== fromId)?.id ?? null);
  return { fromId, toId };
}

/** Текст подтверждения «Пересадить» (аудит 2d, №5). */
export function moveText(name: string, fromCrew: string, toCrew: string): string {
  return `«${name}» перейдёт из «${fromCrew}» в «${toCrew}»: приборы получит там со старта следующего перелёта. Вернуть — снова «Пересадить».`;
}
