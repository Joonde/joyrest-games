/**
 * Сколько идёт игра и сверх плана ли (решение владельца 22 октября 2026): в «Играх сейчас» у каждой игры — таймер с
 * момента, когда ведущий открыл игру (экран с QR), после завершения — «Завершилась в 21:47 · шла 2 ч 41 мин». Если в
 * планировщике есть мероприятие этого ведущего на этот вечер — сверх плана: до 20 минут без доплаты, дальше — продление
 * по 30 минут по ценам калькулятора (`EXTENSIONS` в site/js/pricing.js — сверяет тест).
 */

/** Сколько минут сверх плана не считаем. */
export const OVERTIME_FREE_MIN = 20;
/** Продление: 30 мин, 1 ч, 1,5 ч, 2 ч — как в калькуляторе сайта. */
export const EXTENSION_PRICES = [3900, 7900, 11800, 15800];
const EXTENSION_LABELS = ["30 мин", "1 ч", "1,5 ч", "2 ч"];

export interface Overtime {
  /** Минут сверх плана (0 — уложились). */
  minutes: number;
  /** Сколько продлений по 30 минут к доплате (0 — без доплаты). */
  blocks: number;
  /** Сумма доплаты, ₽; null — больше 2 часов, обсудить. */
  price: number | null;
  /** «+30 мин», «+1 ч»… */
  extension: string;
}

/** Сверх плана: до 20 минут — без доплаты, с 21-й — 30 минут, с 51-й — час и так далее. */
export function overtimeOf(endMs: number, planEndMs: number): Overtime {
  const minutes = Math.max(0, Math.floor((endMs - planEndMs) / 60_000));
  const blocks = minutes <= OVERTIME_FREE_MIN ? 0 : Math.ceil((minutes - OVERTIME_FREE_MIN) / 30);
  const price = blocks === 0 ? 0 : (EXTENSION_PRICES[blocks - 1] ?? null);
  const extension = blocks === 0 ? "" : `+${EXTENSION_LABELS[blocks - 1] ?? `${blocks * 30} мин`}`;
  return { minutes, blocks, price, extension };
}

/** Строка про доплату: «сверх плана 12 мин — без доплаты» / «сверх плана 27 мин — продление +30 мин, 3 900 ₽». */
export function overtimeText(o: Overtime): string {
  if (o.minutes === 0) return "";
  if (o.blocks === 0) return `сверх плана ${o.minutes} мин — без доплаты (до ${OVERTIME_FREE_MIN} мин)`;
  const money = o.price === null ? "больше 2 часов — обсудить с клиентом" : `${o.price.toLocaleString("ru-RU").replace(/ /g, " ")} ₽`;
  return `сверх плана ${o.minutes} мин — продление ${o.extension}, ${money}`;
}

/** Таймер «1:42:07» (часы:минуты:секунды) или «42:07». */
export function clockOf(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** «2 ч 41 мин», «35 мин». */
export function lengthOf(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} ч${min % 60 ? ` ${min % 60} мин` : ""}` : `${min} мин`;
}
