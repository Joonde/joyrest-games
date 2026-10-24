/**
 * Цветной кружок мероприятия (решение владельца 24 октября 2026): один кружок на карточке — что с мероприятием сейчас.
 * Менеджер и владелец сортируют и фильтруют по нему список «Мероприятий». Цвет считается из того, что платформа уже
 * знает: подтвердил ли ведущий («Принял, готовлюсь»), идёт ли время мероприятия, открыта ли у ведущего игра (`live`),
 * отмечено ли «Проведено». Своих данных у кружка нет.
 *
 *   🟣 over   — время «до» прошло, а игра у ведущего ещё открыта: продление за доплату;
 *   🔴 late   — ведущий не подтвердил, а до начала меньше суток;
 *   🟠 live   — время мероприятия идёт (или ведущий уже открыл игру);
 *   ⚪ check  — время прошло, «Проведено» никто не отметил;
 *   🟡 wait   — записано, ведущий ещё не нажал «Принял»;
 *   🟢 ok     — ведущий подтвердил;
 *   🔵 held   — проведено;
 *   ⚫ failed — не состоялось;
 *   ⚫ off    — отменено.
 */
import { eventSpan } from "./events";
import type { AgencyEvent } from "../data/types";

export type EventLight = "over" | "late" | "live" | "check" | "wait" | "ok" | "held" | "failed" | "off";

/** Порядок «сначала срочное»: что требует действия — сверху. */
export const LIGHT_ORDER: EventLight[] = ["over", "late", "live", "check", "wait", "ok", "held", "failed", "off"];

export const LIGHT_TITLES: Record<EventLight, string> = {
  over: "Сверх плана",
  late: "Не подтвердил",
  live: "Идёт",
  check: "Прошло — отметьте",
  wait: "Ждёт ведущего",
  ok: "Принято",
  held: "Проведено",
  failed: "Не состоялось",
  off: "Отменено",
};

/** Что делать менеджеру — подсказка к кружку. */
export const LIGHT_HINTS: Record<EventLight, string> = {
  over: "Время «до» прошло, игра ещё идёт — это продление за доплату",
  late: "До начала меньше суток, а ведущий не подтвердил — позвоните ему",
  live: "Мероприятие идёт",
  check: "Время прошло — отметьте «Проведено» или «Не состоялось»",
  wait: "Ведущий ещё не нажал «Принял, готовлюсь»",
  ok: "Ведущий подтвердил и готовится",
  held: "Мероприятие проведено",
  failed: "Мероприятие не состоялось",
  off: "Мероприятие отменено, его можно вернуть",
};

/** Подтверждение не спрашивают дольше суток до начала. */
export const LATE_MS = 24 * 3_600_000;

export interface LightInfo {
  light: EventLight;
  /** Подпись у кружка: «Сверх плана · 25 мин», «Не подтвердил · через 18 ч», «Идёт · до 22:30». */
  label: string;
}

const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

type LightEvent = Pick<AgencyEvent, "day" | "start" | "end" | "cancelled" | "held"> & Pick<Partial<AgencyEvent>, "acceptedAt" | "acceptRev" | "live">;

export function eventLight(e: LightEvent, now: number): LightInfo {
  const make = (light: EventLight, extra = ""): LightInfo => ({ light, label: extra ? `${LIGHT_TITLES[light]} · ${extra}` : LIGHT_TITLES[light] });
  if (e.cancelled) return make("off");
  if (e.held === true) return make("held");
  if (e.held === false) return make("failed");
  const span = eventSpan(e);
  if (!span) return make("check");
  if (now >= span.to) {
    if (e.live) return make("over", `${Math.max(1, Math.floor((now - span.to) / 60_000))} мин`);
    return make("check");
  }
  if (now >= span.from || e.live) return make("live", `до ${hhmm(e.end)}`);
  // Впереди. Мероприятия, записанные до 22 октября 2026 (`acceptRev` = 0), подтверждения не спрашивали — «Принято».
  const asked = (e.acceptRev ?? 0) > 0;
  if (!asked || e.acceptedAt) return make("ok");
  const left = span.from - now;
  if (left <= LATE_MS) return make("late", `через ${left < 3_600_000 ? `${Math.max(1, Math.round(left / 60_000))} мин` : `${Math.round(left / 3_600_000)} ч`}`);
  return make("wait");
}

/**
 * Сортировка «по цвету»: сначала срочное (порядок `LIGHT_ORDER`), внутри цвета — по времени: будущие и идущие —
 * ближайшие сверху, прошедшие и отменённые — свежие сверху.
 */
export function sortByLight<T extends LightEvent & Pick<AgencyEvent, "id">>(events: T[], now: number): T[] {
  const rank = (e: T) => LIGHT_ORDER.indexOf(eventLight(e, now).light);
  const at = (e: T) => eventSpan(e)?.from ?? 0;
  const pastFirst = new Set<EventLight>(["check", "held", "failed", "off"]);
  return [...events].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    const light = eventLight(a, now).light;
    return pastFirst.has(light) ? at(b) - at(a) : at(a) - at(b);
  });
}

/** Сколько мероприятий каждого цвета. */
export function lightCounts(events: LightEvent[], now: number): Record<EventLight, number> {
  const out = Object.fromEntries(LIGHT_ORDER.map((l) => [l, 0])) as Record<EventLight, number>;
  for (const e of events) out[eventLight(e, now).light] += 1;
  return out;
}
