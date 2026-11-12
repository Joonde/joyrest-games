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
  return { view: null, moment: "", version: 0, paused: false, restored: false, players: 0, online: 0, offline: [], loop: null, skew: 0, closed: null, seq: 0 };
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
      return { ...m, paused: e.paused, skew: e.at - localNow, seq: m.seq + 1 };
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
 * Таблица лидеров платформы по общему счёту экипажей («История игр», «Игры сейчас», итоги по ссылке): у команды, чей экипаж, —
 * общий счёт экипажа; у команд, чьи экипажи влили в другой («Объединить»), — 0 (их очки уже у того экипажа). null — ничего
 * менять не нужно. Только существующие записи (новых команд таблица получает от пульта платформы).
 */
export function leaderboardChange(v: HostView, board: Leaderboard): Record<string, LeaderboardEntry> | null {
  const want = new Map<string, number>();
  for (const c of v.crews) {
    for (const team of c.teams) if (!want.has(team)) want.set(team, 0);
    if (c.team !== null) want.set(c.team, Math.max(0, Math.round(c.total)));
  }
  const change: Record<string, LeaderboardEntry> = {};
  for (const [team, score] of want) {
    const entry = board[team];
    if (entry && entry.score !== score) change[team] = { ...entry, score };
  }
  return Object.keys(change).length > 0 ? change : null;
}

/** Когда пульт пишет таблицу лидеров: итоги перелёта готовы (привал, голосование, раскрытие) и на пьедестале. */
export function syncsLeaderboard(v: HostView): boolean {
  return v.phase === "podium" || v.phase === "finished" || (v.phase === "leg" && (v.stage === "dock" || v.stage === "vote" || v.stage === "voted"));
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
