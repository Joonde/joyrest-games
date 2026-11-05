/**
 * Реестр игр быстрого канала: механика сессии → игра комнаты. Комната создаётся только для сессии, механика
 * которой здесь есть; остальные игры платформы работают как раньше (медленный путь). Новая игра с комнатой —
 * строка в `GAMES`.
 *
 * Проверочная игра `room-check` (тесты и нагрузка) включается только на тестовой версии: `ROOM_CHECK=on`, а без
 * переменной — только при адресах сайта `test.*` (как анкеты площадок, `venueFormsOpen`). На основной версии её нет:
 * сессия с механикой `room-check` там — обычная сессия без комнаты (404).
 */
import { roomCheck, ROOM_CHECK } from "./check";
import type { RoomGame } from "./engine";

/** Игры комнат для настоящих мероприятий (пока нет — первыми придут «Матрёшка», «Бубликатор», «Джойки»). */
const GAMES: Array<RoomGame<unknown>> = [];

export function roomGames(options: { check?: boolean } = {}): ReadonlyMap<string, RoomGame<unknown>> {
  const games = new Map<string, RoomGame<unknown>>(GAMES.map((g) => [g.id, g]));
  if (options.check) games.set(ROOM_CHECK, roomCheck as RoomGame<unknown>);
  return games;
}

/** Включена ли проверочная игра: только точное `on`; `off` и опечатка — нет; без переменной — только test.*. */
export function roomCheckEnabled(value: string | undefined, siteHosts: readonly string[]): boolean {
  const setting = value?.trim().toLowerCase();
  if (setting) return setting === "on";
  return siteHosts.length > 0 && siteHosts.every((host) => host.startsWith("test."));
}
