/**
 * Реестр игр быстрого канала: механика сессии → игра комнаты. Комната создаётся только для сессии, механика
 * которой здесь есть; остальные игры платформы работают как раньше (медленный путь). Новая игра с комнатой —
 * строка в `GAMES`.
 *
 * Проверочная игра `room-check` (тесты и нагрузка) включается только на тестовой версии: `ROOM_CHECK=on`, а без
 * переменной — только при адресах сайта `test.*` (как анкеты площадок, `venueFormsOpen`). На основной версии её нет:
 * сессия с механикой `room-check` там — обычная сессия без комнаты (404).
 *
 * Игры, у которых ещё нет экранов, включаются тем же переключателем: на test — для проверки, на основной версии их нет
 * (`TEST_ONLY_GAMES`). Экраны готовы — игра переезжает в `GAMES` («Бубликатор» — 12 ноября 2026, Блок 2d: телефон, экран
 * зала, пульт и конструктор готовы).
 */
import { bublikator } from "./bublikator";
import { roomCheck, ROOM_CHECK } from "./check";
import type { RoomGame } from "./engine";
import { matryoshka } from "./matryoshka";

/** Игры комнат для настоящих мероприятий («Бубликатор»; дальше — «Матрёшка», «Джойки»). */
const GAMES: Array<RoomGame<unknown>> = [bublikator as RoomGame<unknown>];

/** Игры без экранов — только на тестовой версии (вместе с `room-check`): «Игры Матрёшки» — Блок 3a, правила (14 ноября 2026). */
const TEST_ONLY_GAMES: Array<RoomGame<unknown>> = [matryoshka as RoomGame<unknown>];

export function roomGames(options: { check?: boolean } = {}): ReadonlyMap<string, RoomGame<unknown>> {
  const games = new Map<string, RoomGame<unknown>>(GAMES.map((g) => [g.id, g]));
  if (options.check) {
    games.set(ROOM_CHECK, roomCheck as RoomGame<unknown>);
    for (const g of TEST_ONLY_GAMES) games.set(g.id, g);
  }
  return games;
}

/** Включена ли проверочная игра: только точное `on`; `off` и опечатка — нет; без переменной — только test.*. */
export function roomCheckEnabled(value: string | undefined, siteHosts: readonly string[]): boolean {
  const setting = value?.trim().toLowerCase();
  if (setting) return setting === "on";
  return siteHosts.length > 0 && siteHosts.every((host) => host.startsWith("test."));
}
