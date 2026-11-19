/** Настоящая связь телефона «Игр Матрёшки»: игровая комната своего сервера и часы `GET /api/time` (слой данных). */
import { clock, roomsRepo } from "../../../data";
import { BATCH_MS } from "../rules/constants";
import type { PhoneClock, PhoneLink } from "./link";

/** Часы сервера: замер раз в 2 минуты; пока замера нет — null (телефон берёт границу по потоку). */
function serverClock(): PhoneClock {
  let measured = false;
  return {
    offset: () => (measured ? clock.offset() : null),
    sync(maxAgeMs) {
      void clock
        .sync({ maxAgeMs })
        .then(() => {
          measured = true;
        })
        .catch(() => undefined);
    },
  };
}

export function roomLink(sessionId: string): PhoneLink {
  return {
    subscribe: (onEvent, onError, take) => roomsRepo.subscribe(sessionId, "me", onEvent, onError, take ? { take: true } : undefined),
    sender(onReply, onError) {
      const s = roomsRepo.sender(sessionId, { everyMs: BATCH_MS, onReply, onError });
      return { push: (event, now) => s.push(event, now ? { now: true } : undefined), stop: () => s.stop() };
    },
    clock: serverClock(),
    key: `mat.${sessionId}`,
  };
}
