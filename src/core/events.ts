/**
 * Планировщик мероприятий (решение владельца 14 октября 2026): владелец записывает мероприятие —
 * клиент, телефон, дата, время, что за мероприятие, ведущий — и видит все мероприятия: день по часам
 * (таймлайн), 7 дней, месяц, а также списки «Предстоящие», «Идут сейчас», «Архив», «Отменённые».
 * У ведущего время мероприятия занято в календаре. Чистые функции: их же проверяет сервер.
 */
import type { AgencyEvent } from "../data/types";
import { cleanNote, DAY_MINUTES, dayIndex, dayInWindow, todayMoscow, validTime } from "./calendar";

export const EVENT_LIMITS = { client: 100, phone: 40, title: 100, place: 200, note: 500, guestsMax: 10_000 } as const;

/** Виды мероприятий — подсказки в поле «Что за мероприятие» (можно написать своё). */
export const EVENT_TITLES = ["Свадьба", "Корпоратив", "День рождения", "Юбилей", "Выпускной", "Детский праздник", "Новый год", "Квиз-вечер", "Девичник", "Мальчишник"];

export type EventStatus = "upcoming" | "now" | "past" | "cancelled";

export const EVENT_STATUS_TITLES: Record<EventStatus, string> = {
  upcoming: "Предстоит",
  now: "Идёт сейчас",
  past: "Прошло",
  cancelled: "Отменено",
};

const MSK = 3 * 3_600_000;

/** Начало и конец мероприятия в мс (время — московское, без перехода на летнее). */
export function eventSpan(e: Pick<AgencyEvent, "day" | "start" | "end">): { from: number; to: number } | null {
  const d = dayIndex(e.day);
  if (d === null) return null;
  const base = d * 86_400_000 - MSK;
  return { from: base + e.start * 60_000, to: base + e.end * 60_000 };
}

export function eventStatus(e: Pick<AgencyEvent, "day" | "start" | "end" | "cancelled">, now = Date.now()): EventStatus {
  if (e.cancelled) return "cancelled";
  const span = eventSpan(e);
  if (!span) return "past";
  if (now < span.from) return "upcoming";
  return now < span.to ? "now" : "past";
}

/** Текст из формы: без управляющих символов и лишних пробелов, с ограничением длины. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Телефон: цифры, пробелы, +, -, скобки. */
export function cleanPhone(value: unknown): string {
  return (typeof value === "string" ? value : "").replace(/[^\d+\-() ]/g, "").replace(/\s+/g, " ").trim().slice(0, EVENT_LIMITS.phone);
}

export interface EventInput {
  id: string;
  hostId: string;
  day: string;
  start: number;
  end: number;
  clientName: string;
  clientPhone: string;
  title: string;
  place: string;
  guests: number | null;
  note: string;
}

const ID = /^[A-Za-z0-9_-]{1,60}$/;

/** Проверенное мероприятие из тела запроса или null. Нужны ведущий, дата, время и что за мероприятие или клиент. */
export function parseEventInput(body: unknown, now = Date.now()): EventInput | null {
  const b = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const id = typeof b.id === "string" && ID.test(b.id) ? b.id : null;
  const hostId = typeof b.hostId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(b.hostId) ? b.hostId : null;
  const day = typeof b.day === "string" ? b.day : "";
  if (!id || !hostId || !dayInWindow(day, todayMoscow(now)) || !validTime(b.start, b.end)) return null;
  const guestsRaw = b.guests;
  const guests =
    guestsRaw === null || guestsRaw === undefined || guestsRaw === ""
      ? null
      : typeof guestsRaw === "number" && Number.isInteger(guestsRaw) && guestsRaw >= 0 && guestsRaw <= EVENT_LIMITS.guestsMax
        ? guestsRaw
        : undefined;
  if (guests === undefined) return null;
  const input: EventInput = {
    id,
    hostId,
    day,
    start: b.start as number,
    end: b.end as number,
    clientName: cleanText(b.clientName, EVENT_LIMITS.client),
    clientPhone: cleanPhone(b.clientPhone),
    title: cleanText(b.title, EVENT_LIMITS.title),
    place: cleanText(b.place, EVENT_LIMITS.place),
    guests,
    note: cleanText(b.note, EVENT_LIMITS.note),
  };
  if (!input.title && !input.clientName) return null;
  return input;
}

/** Заметка в календаре ведущего: что за мероприятие (без имени и телефона клиента). */
export function bookingNote(e: Pick<EventInput, "title" | "guests">): string {
  const guests = e.guests ? `, ${e.guests} гостей` : "";
  return cleanNote(`${e.title || "Мероприятие"}${guests}`);
}

/** id записи календаря «занят» для мероприятия. */
export const bookingId = (eventId: string) => `ev-${eventId}`;

/** Мероприятия, видимые в этом дне: свои за день и прошлого дня, идущие за полночь. Отменённые — нет. */
export function eventsOfDay(events: AgencyEvent[], day: string, withCancelled = false): AgencyEvent[] {
  const d = dayIndex(day);
  return events
    .filter((e) => withCancelled || !e.cancelled)
    .filter((e) => {
      const i = dayIndex(e.day);
      return i !== null && d !== null && (i === d || (i === d - 1 && e.end > DAY_MINUTES));
    })
    .sort((a, b) => (a.day === b.day ? a.start - b.start : a.day < b.day ? -1 : 1));
}

export interface TimelineItem {
  event: AgencyEvent;
  /** Минуты от полуночи показанного дня (у вчерашнего вечера — с 0). */
  top: number;
  bottom: number;
  lane: number;
  lanes: number;
}

/**
 * Таймлайн дня: мероприятия по времени, пересекающиеся — в соседних колонках (lane из lanes).
 * Вчерашний вечер за полночь показывается с 00:00.
 */
export function timelineOf(events: AgencyEvent[], day: string): TimelineItem[] {
  const d = dayIndex(day) ?? 0;
  const items = eventsOfDay(events, day).map((event) => {
    const shift = (dayIndex(event.day) ?? d) === d ? 0 : -DAY_MINUTES;
    return { event, top: Math.max(0, event.start + shift), bottom: event.end + shift, lane: 0, lanes: 1 };
  });
  items.sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  // Группы пересекающихся: внутри группы — жадно по колонкам.
  let group: TimelineItem[] = [];
  let groupEnd = -1;
  const flush = () => {
    const n = Math.max(1, ...group.map((g) => g.lane + 1));
    for (const g of group) g.lanes = n;
    group = [];
  };
  for (const item of items) {
    if (item.top >= groupEnd && group.length) flush();
    const laneEnds: number[] = [];
    for (const g of group) laneEnds[g.lane] = Math.max(laneEnds[g.lane] ?? -1, g.bottom);
    let lane = laneEnds.findIndex((end) => end <= item.top);
    if (lane < 0) lane = laneEnds.length;
    item.lane = lane;
    group.push(item);
    groupEnd = Math.max(groupEnd, item.bottom);
  }
  if (group.length) flush();
  return items;
}

/**
 * Часы таймлайна: пустой день — 08:00–24:00; с мероприятиями — за час до первого (без пустого утра)
 * и до 24:00 или на час позже конца ночного.
 */
export function timelineHours(items: TimelineItem[]): { from: number; to: number } {
  if (items.length === 0) return { from: 8 * 60, to: DAY_MINUTES };
  const first = Math.min(...items.map((i) => Math.floor(i.top / 60) * 60));
  const last = Math.max(...items.map((i) => Math.ceil(i.bottom / 60) * 60));
  return { from: Math.max(0, first - 60), to: Math.max(DAY_MINUTES, last + (last < DAY_MINUTES ? 0 : 60)) };
}

/** Понедельник недели этого дня. */
export function weekStart(day: string): string {
  const d = dayIndex(day) ?? 0;
  // 1970-01-01 — четверг.
  const weekday = (d + 3) % 7;
  return new Date((d - weekday) * 86_400_000).toISOString().slice(0, 10);
}

/** Сортировка списков: предстоящие и идущие — по возрастанию, архив и отменённые — сначала новые. */
export function sortEvents(events: AgencyEvent[], newestFirst: boolean): AgencyEvent[] {
  const key = (e: AgencyEvent) => (dayIndex(e.day) ?? 0) * DAY_MINUTES + e.start;
  return [...events].sort((a, b) => (newestFirst ? key(b) - key(a) : key(a) - key(b)));
}
