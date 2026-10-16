/**
 * «Итоги игр» ведущего для владельца (решение владельца 16 октября 2026): из «⋯» на карточке человека — сводка, ближайшие
 * закреплённые за ним мероприятия планировщика и его прошедшие игры. Чистые функции: экран `HostGames.tsx` только рисует.
 */
import type { AgencyEvent, GameResult } from "../data/types";
import { eventSpan, eventStatus } from "./events";

const DAY = 86_400_000;

export interface HostGamesSummary {
  /** Сыгранных игр (итоги) всего. */
  games: number;
  /** Сыгранных за последние 30 дней. */
  last30: number;
  /** Сумма подключившихся телефонов по всем играм. */
  guests: number;
  /** В среднем телефонов на игру (округлено), 0 — игр нет. */
  average: number;
  /** Когда была последняя игра (мс), null — игр нет. */
  lastPlayedAt: number | null;
}

export function hostGamesSummary(results: GameResult[], now = Date.now()): HostGamesSummary {
  const played = results.map((r) => r.playedAt).filter((t): t is number => typeof t === "number");
  const guests = results.reduce((sum, r) => sum + Math.max(0, r.participantsCount || 0), 0);
  return {
    games: results.length,
    last30: played.filter((t) => t >= now - 30 * DAY && t <= now).length,
    guests,
    average: results.length ? Math.round(guests / results.length) : 0,
    lastPlayedAt: played.length ? Math.max(...played) : null,
  };
}

/** Ближайшие мероприятия человека: идут сейчас и предстоящие, без отменённых, по времени начала. */
export function upcomingOf(events: AgencyEvent[], hostId: string, now = Date.now(), limit = 5): AgencyEvent[] {
  return events
    .filter((e) => e.hostId === hostId && !e.cancelled)
    .filter((e) => {
      const s = eventStatus(e, now);
      return s === "upcoming" || s === "now";
    })
    .sort((a, b) => (eventSpan(a)?.from ?? 0) - (eventSpan(b)?.from ?? 0))
    .slice(0, limit);
}

/** Прошедшие игры — новые сверху, не больше `limit`. */
export function recentResults(results: GameResult[], limit = 10): GameResult[] {
  return [...results].sort((a, b) => (b.playedAt ?? 0) - (a.playedAt ?? 0)).slice(0, limit);
}
