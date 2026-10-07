/**
 * На связи ли телефон гостя: телефоны раз в 30 секунд сообщают «я тут» (`touch`). Молчит дольше
 * 75 секунд — не на связи: пульт показывает серую точку, а новый телефон может войти за этого игрока.
 */
import type { Participant } from "../data/types";

export const PRESENCE_TIMEOUT_MS = 75_000;

export function lastSeen(p: Pick<Participant, "seenAt" | "joinedAt">): number | null {
  return p.seenAt ?? p.joinedAt ?? null;
}

export function isOnline(p: Pick<Participant, "seenAt" | "joinedAt">, now: number): boolean {
  const seen = lastSeen(p);
  // Время входа ещё не подтвердил сервер — только что вошёл.
  return seen === null || now - seen < PRESENCE_TIMEOUT_MS;
}
