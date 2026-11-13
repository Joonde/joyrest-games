/** Настоящая связь телефона «Бубликатора»: игровая комната своего сервера (`roomsRepo` из слоя данных). */
import { roomsRepo } from "../../../data";
import { BATCH_MS } from "../rules/constants";
import type { PhoneLink } from "./link";

export function roomLink(sessionId: string): PhoneLink {
  return {
    subscribe: (onEvent, onError, take) => roomsRepo.subscribe(sessionId, "me", onEvent, onError, take ? { take: true } : undefined),
    sender(onReply, onError) {
      const s = roomsRepo.sender(sessionId, { everyMs: BATCH_MS, onReply, onError });
      return { push: (event, now, beforeMs) => s.push(event, now || beforeMs ? { now: now === true, beforeMs } : undefined), stop: () => s.stop() };
    },
  };
}
