/**
 * Часы своего сервера: `GET /api/time` три раза, берётся замер с самой быстрой связью —
 * время сервера ≈ середина между отправкой и ответом.
 */
import type { ClockService } from "../contracts";
import { api, asRecord } from "./api";

let measured = 0;
let pending: Promise<number> | null = null;

/** Смещение по замерам: лучший — с наименьшей задержкой. */
export function bestOffset(samples: Array<{ sent: number; received: number; server: number }>): number {
  const best = [...samples].sort((a, b) => a.received - a.sent - (b.received - b.sent))[0];
  return best ? best.server - (best.sent + best.received) / 2 : 0;
}

async function measure(): Promise<number> {
  const samples: Array<{ sent: number; received: number; server: number }> = [];
  for (let i = 0; i < 3; i++) {
    const sent = Date.now();
    const data = asRecord(await api("GET", "/api/time"));
    const received = Date.now();
    if (typeof data.now === "number") samples.push({ sent, received, server: data.now });
  }
  return bestOffset(samples);
}

export const serverClock: ClockService = {
  offset: () => measured,
  sync() {
    pending ??= measure()
      .then((value) => {
        measured = value;
        return value;
      })
      .catch(() => {
        // Нет связи: таймер идёт по часам устройства, повторим при следующем вызове.
        pending = null;
        return measured;
      });
    return pending;
  },
};
