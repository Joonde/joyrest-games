/**
 * Реестр игр быстрого канала: механика сессии → игра комнаты. Комната создаётся только для сессии, механика
 * которой здесь есть; остальные игры платформы работают как раньше (медленный путь). Новая игра с комнатой —
 * строка здесь.
 */
import { roomCheck, ROOM_CHECK } from "./check";
import type { RoomGame } from "./engine";

export const ROOM_GAMES: ReadonlyMap<string, RoomGame<unknown>> = new Map<string, RoomGame<unknown>>([[ROOM_CHECK, roomCheck as RoomGame<unknown>]]);

export function roomGameOf(mechanic: string | null): RoomGame<unknown> | null {
  return mechanic ? (ROOM_GAMES.get(mechanic) ?? null) : null;
}
