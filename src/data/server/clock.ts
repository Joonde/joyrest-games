/**
 * Часы своего сервера: `GET /api/time` три раза, берётся замер с самой быстрой связью —
 * время сервера ≈ середина между отправкой и ответом.
 */
import type { ClockService } from "../contracts";
import { api, asRecord } from "./api";

let measured = 0;
let pending: Promise<number> | null = null;
/** Повторы после неудачного замера: экран зала на Smart TV со сбитыми часами не должен врать до перезагрузки. */
let retries = 0;
const RETRY_MS = [3_000, 10_000, 30_000, 60_000];

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
        retries = 0;
        return value;
      })
      .catch(() => {
        // Нет связи: пока таймер идёт по часам устройства, сами повторяем замер с паузой.
        pending = null;
        const delay = RETRY_MS[Math.min(retries, RETRY_MS.length - 1)] ?? 60_000;
        retries += 1;
        setTimeout(() => {
          if (!pending) void serverClock.sync();
        }, delay);
        return measured;
      });
    return pending;
  },
};
