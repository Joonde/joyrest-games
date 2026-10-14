/**
 * Планировщик мероприятий (решение владельца 14 октября 2026): владелец записывает мероприятие —
 * клиент, телефон, дата, время, что за мероприятие, ведущий — и видит все мероприятия: день по часам
 * (таймлайн), 7 дней, месяц, а также списки «Предстоящие», «Идут сейчас», «Архив», «Отменённые».
 * У ведущего время мероприятия занято в календаре. Чистые функции: их же проверяет сервер.
 */
import type { AgencyEvent } from "../data/types";
import { cleanNote, DAY_MINUTES, dayIndex, dayInWindow, dayTitle, endAfter, MAX_END, rangeLabel, TIME_STEP, todayMoscow, validTime } from "./calendar";

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
  /** Номер группы пересекающихся мероприятий (в одной группе — общая высота колонок). */
  group: number;
}

/**
 * Таймлайн дня: мероприятия по времени, пересекающиеся — в соседних колонках (lane из lanes).
 * Вчерашний вечер за полночь показывается с 00:00.
 */
export function timelineOf(events: AgencyEvent[], day: string): TimelineItem[] {
  const d = dayIndex(day) ?? 0;
  const items = eventsOfDay(events, day).map((event) => {
    const shift = (dayIndex(event.day) ?? d) === d ? 0 : -DAY_MINUTES;
    return { event, top: Math.max(0, event.start + shift), bottom: event.end + shift, lane: 0, lanes: 1, group: 0 };
  });
  items.sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  // Группы пересекающихся: внутри группы — жадно по колонкам.
  let group: TimelineItem[] = [];
  let groupEnd = -1;
  let groupNo = 0;
  const flush = () => {
    const n = Math.max(1, ...group.map((g) => g.lane + 1));
    for (const g of group) {
      g.lanes = n;
      g.group = groupNo;
    }
    groupNo += 1;
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

export interface TimelineCluster {
  group: number;
  top: number;
  bottom: number;
  items: TimelineItem[];
}

/**
 * Группы, где одновременно больше `maxLanes` мероприятий: на узком экране колонки стали бы нечитаемыми,
 * поэтому такая группа рисуется одной плашкой «5 мероприятий» со списком (касание — все карточки).
 */
export function crowdedClusters(items: TimelineItem[], maxLanes: number): TimelineCluster[] {
  const byGroup = new Map<number, TimelineItem[]>();
  for (const it of items) byGroup.set(it.group, [...(byGroup.get(it.group) ?? []), it]);
  const out: TimelineCluster[] = [];
  for (const [group, list] of byGroup) {
    if ((list[0]?.lanes ?? 1) <= maxLanes) continue;
    out.push({ group, top: Math.min(...list.map((i) => i.top)), bottom: Math.max(...list.map((i) => i.bottom)), items: list });
  }
  return out.sort((a, b) => a.top - b.top);
}

// ───────────── Быстрое заполнение формы ─────────────

/** Готовое время одним касанием. */
export const TIME_PRESETS: Array<{ start: number; end: number }> = [
  { start: 18 * 60, end: 23 * 60 },
  { start: 19 * 60, end: 24 * 60 },
  { start: 17 * 60, end: 22 * 60 },
  { start: 12 * 60, end: 16 * 60 },
  { start: 15 * 60, end: 20 * 60 },
];

/** Длительность от начала (часы). */
export const DURATIONS = [2, 3, 4, 5, 6];

/** Число гостей одним касанием — ступени пакетов сайта. */
export const GUEST_PRESETS = [15, 25, 45, 60, 90];

/** Конец через `hours` часов от начала (не позже 06:00 следующего дня). */
export function endIn(start: number, hours: number): number {
  return Math.min(start + hours * 60, MAX_END);
}

export interface LeadFill {
  clientName?: string;
  clientPhone?: string;
  title?: string;
  day?: string;
  start?: number;
  end?: number;
  guests?: number;
  place?: string;
  note?: string;
}

const MONTH_STEMS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function field(text: string, names: string[]): string {
  for (const name of names) {
    const m = new RegExp(`(?:^|\\n)\\s*${name}\\s*[:：]\\s*(.+)`, "i").exec(text);
    const v = m?.[1]?.trim();
    if (v && v !== "—" && v !== "-") return v;
  }
  return "";
}

/** Ближайшая дата с этим днём и месяцем (сегодня или позже), если год не указан. */
function upcoming(day: number, month: number, year: number | null, today: string): string | null {
  const ty = Number(today.slice(0, 4));
  for (const y of year !== null ? [year < 100 ? 2000 + year : year] : [ty, ty + 1]) {
    const iso = `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (dayIndex(iso) === null) continue;
    if (year !== null || iso >= today) return iso;
  }
  return null;
}

const round15 = (m: number) => Math.round(m / TIME_STEP) * TIME_STEP;

/**
 * Разбор текста заявки (сообщение с сайта в Telegram, переписка, заметка): имя, телефон, что за
 * мероприятие, дата, время, гости, место, комментарий. Всё, что не нашлось, остаётся пустым.
 */
export function parseLeadText(text: string, today: string): LeadFill {
  const t = text.replace(/\r/g, "");
  const out: LeadFill = {};
  const name = field(t, ["Имя", "Клиент", "Заказчик", "Контакт"]);
  if (name) out.clientName = cleanText(name, EVENT_LIMITS.client);
  const phone = /(?:\+7|8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/.exec(t)?.[0];
  if (phone) out.clientPhone = cleanPhone(phone);
  const type = field(t, ["Тип мероприятия", "Мероприятие", "Повод", "Формат"]);
  const known = EVENT_TITLES.find((title) => new RegExp(title.slice(0, Math.max(5, title.length - 2)), "i").test(type || t));
  if (type) out.title = cleanText(type, EVENT_LIMITS.title);
  else if (known) out.title = known;
  else if (/(?:^|[^а-яё])др(?:[^а-яё]|$)|день рожд/i.test(t)) out.title = "День рождения";
  const guests = field(t, ["Гостей", "Гости", "Количество гостей"]);
  const g = /(\d{1,4})/.exec(guests)?.[1] ?? /(\d{1,4})\s*(?:гост|чел)/i.exec(t)?.[1] ?? /(?:гост[а-я]*|человек|чел\.?)\s*(\d{1,4})/i.exec(t)?.[1];
  if (g && Number(g) > 0 && Number(g) <= EVENT_LIMITS.guestsMax) out.guests = Number(g);
  const place = field(t, ["Где", "Место", "Адрес", "Площадка", "Район"]);
  if (place) out.place = cleanText(place, EVENT_LIMITS.place);
  const note = field(t, ["Комментарий", "Пожелания", "Заметка"]);
  if (note) out.note = cleanText(note, EVENT_LIMITS.note);
  // Дата: 2026-10-15, 15.10.2026, 15.10, «15 октября».
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
  // «15.10» и «15.10.2026», но не время «18.00» и не часть другого числа.
  let dotted: RegExpExecArray | null = null;
  for (const m of t.matchAll(/(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/g)) {
    const before = t[(m.index ?? 0) - 1] ?? "";
    const after = t[(m.index ?? 0) + m[0].length] ?? "";
    const month = Number(m[2]);
    if (/[\d:.]/.test(before) || /[\d:]/.test(after) || month < 1 || month > 12 || Number(m[1]) < 1 || Number(m[1]) > 31) continue;
    dotted = m as RegExpExecArray;
    break;
  }
  const worded = /(\d{1,2})\s+(янв|фев|мар|апр|ма[яй]|июн|июл|авг|сен|окт|ноя|дек)[а-я]*(?:\s+(\d{4}))?/i.exec(t);
  let day: string | null = null;
  if (iso && dayIndex(iso[0]) !== null) day = iso[0];
  else if (worded) {
    const stem = worded[2]!.toLowerCase().replace("май", "мая");
    const month = MONTH_STEMS.findIndex((m) => stem.startsWith(m.slice(0, 3))) + 1;
    if (month > 0) day = upcoming(Number(worded[1]), month, worded[3] ? Number(worded[3]) : null, today);
  } else if (dotted) day = upcoming(Number(dotted[1]), Number(dotted[2]), dotted[3] ? Number(dotted[3]) : null, today);
  if (day) out.day = day;
  // Время: 18:00–23:00, 18.00-23.00, «с 18 до 23».
  const range = /(\d{1,2})[:.](\d{2})\s*(?:[–—-]|до)\s*(\d{1,2})[:.](\d{2})/.exec(t) ?? null;
  const words = /с\s*(\d{1,2})(?:[:.](\d{2}))?\s*до\s*(\d{1,2})(?:[:.](\d{2}))?/i.exec(t);
  const r = range ?? words;
  if (r) {
    const s = Number(r[1]) * 60 + Number(r[2] ?? 0);
    const e = Number(r[3]) * 60 + Number(r[4] ?? 0);
    if (Number(r[1]) < 24 && Number(r[3]) <= 24) {
      const start = round15(s) % DAY_MINUTES;
      const end = Math.min(MAX_END, endAfter(start, round15(e) % DAY_MINUTES || 0));
      if (validTime(start, end)) {
        out.start = start;
        out.end = end;
      }
    }
  } else {
    const single = /(?:в|начало|с)\s*(\d{1,2})[:.](\d{2})/i.exec(t);
    if (single && Number(single[1]) < 24) {
      const start = round15(Number(single[1]) * 60 + Number(single[2])) % DAY_MINUTES;
      out.start = start;
      out.end = endIn(start, 4);
    }
  }
  return out;
}

/** Заявка клиента из базы площадок → поля мероприятия. */
export function fillFromRequest(r: { name: string; phone: string; eventType: string; date: string; from: string; to: string; guests: number | null; district: string; comment: string }): LeadFill {
  const out: LeadFill = {};
  if (r.name) out.clientName = cleanText(r.name, EVENT_LIMITS.client);
  if (r.phone) out.clientPhone = cleanPhone(r.phone);
  if (r.eventType) out.title = cleanText(r.eventType, EVENT_LIMITS.title);
  if (dayIndex(r.date) !== null) out.day = r.date;
  const s = /^(\d{2}):(\d{2})$/.exec(r.from);
  const e = /^(\d{2}):(\d{2})$/.exec(r.to);
  if (s) {
    const start = round15(Number(s[1]) * 60 + Number(s[2])) % DAY_MINUTES;
    const end = e ? Math.min(MAX_END, endAfter(start, round15(Number(e[1]) * 60 + Number(e[2])) % DAY_MINUTES)) : endIn(start, 4);
    if (validTime(start, end)) {
      out.start = start;
      out.end = end;
    }
  }
  if (r.guests) out.guests = r.guests;
  if (r.district) out.place = cleanText(r.district, EVENT_LIMITS.place);
  if (r.comment) out.note = cleanText(r.comment, EVENT_LIMITS.note);
  return out;
}

// ───────────── Уведомления ведущему в Telegram ─────────────

export type NoticeKind = "created" | "changed" | "removed" | "cancelled" | "day" | "hours";

const NOTICE_HEADS: Record<NoticeKind, string> = {
  created: "📅 Вам назначено мероприятие JoyRest",
  changed: "✏️ Мероприятие изменено",
  removed: "↩️ Это мероприятие больше не за вами",
  cancelled: "❌ Мероприятие отменено",
  day: "⏰ Напоминание: мероприятие через сутки",
  hours: "⏰ Скоро начало мероприятия",
};

/** Напоминания: за сутки и за 3 часа до начала. */
export const REMIND_DAY_MS = 24 * 3_600_000;
export const REMIND_HOURS_MS = 3 * 3_600_000;

/** Какое напоминание пора отправить: за 3 часа (и ближе) — «hours», за сутки — «day», раньше — никакого. */
export function reminderDue(startsAt: number, now: number): "day" | "hours" | null {
  const left = startsAt - now;
  if (left <= 0) return null;
  if (left <= REMIND_HOURS_MS) return "hours";
  return left <= REMIND_DAY_MS ? "day" : null;
}

/**
 * Текст уведомления ведущему. Без имени и телефона клиента и без адреса: Telegram — не в России, а это
 * персональные данные; подробности — в студии по ссылке.
 */
export function noticeText(kind: NoticeKind, e: Pick<AgencyEvent, "title" | "guests" | "day" | "start" | "end">, platformUrl: string, now = Date.now()): string {
  const what = `${e.title || "Мероприятие"}${e.guests ? ` · ${e.guests} гостей` : ""}`;
  const when = `${dayTitle(e.day)}, ${rangeLabel(e.start, e.end)}`;
  const span = eventSpan(e);
  const head = kind === "hours" && span ? `⏰ Через ${Math.max(1, Math.round((span.from - now) / 3_600_000))} ч начало мероприятия` : NOTICE_HEADS[kind];
  const tail = kind === "removed" || kind === "cancelled" ? "" : `\n\nКлиент, телефон и подробности — в студии:\n${platformUrl}/studio/calendar?tab=events`;
  return `${head}\n\n${what}\n${when}${tail}`;
}

// ───────────── Итоги: неделя, месяц, квартал, год ─────────────

export type PeriodKind = "week" | "month" | "quarter" | "year";
export const PERIOD_TITLES: Record<PeriodKind, string> = { week: "Неделя", month: "Месяц", quarter: "Квартал", year: "Год" };

const MONTHS_NOM = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const QUARTERS = ["I", "II", "III", "IV"];

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

/** Период, в который входит день: первый и последний день и подпись («Октябрь 2026», «IV квартал 2026»). */
export function periodOf(kind: PeriodKind, day: string): { from: string; to: string; title: string } {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7)) - 1;
  if (kind === "week") {
    const from = weekStart(day);
    const to = new Date(Date.parse(`${from}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
    const [fm, fd, tm, td, ty] = [Number(from.slice(5, 7)) - 1, Number(from.slice(8)), Number(to.slice(5, 7)) - 1, Number(to.slice(8)), to.slice(0, 4)];
    const title = fm === tm ? `${fd}–${td} ${MONTHS_GEN[tm]} ${ty}` : `${fd} ${MONTHS_GEN[fm]} – ${td} ${MONTHS_GEN[tm]} ${ty}`;
    return { from, to, title };
  }
  if (kind === "month") return { from: iso(y, m, 1), to: iso(y, m + 1, 0), title: `${MONTHS_NOM[m]} ${y}` };
  if (kind === "quarter") {
    const q = Math.floor(m / 3);
    return { from: iso(y, q * 3, 1), to: iso(y, q * 3 + 3, 0), title: `${QUARTERS[q]} квартал ${y}` };
  }
  return { from: iso(y, 0, 1), to: iso(y, 11, 31), title: String(y) };
}

/** День в соседнем периоде (назад −1, вперёд +1). */
export function shiftPeriod(kind: PeriodKind, day: string, delta: number): string {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7)) - 1;
  if (kind === "week") return new Date(Date.parse(`${weekStart(day)}T00:00:00Z`) + delta * 7 * 86_400_000).toISOString().slice(0, 10);
  if (kind === "month") return iso(y, m + delta, 1);
  if (kind === "quarter") return iso(y, Math.floor(m / 3) * 3 + delta * 3, 1);
  return iso(y + delta, 0, 1);
}

export interface HostStats {
  hostId: string;
  hostName: string;
  planned: number;
  held: number;
  guests: number;
}

export interface EventStats {
  /** Записано (без отменённых). */
  planned: number;
  /** Отмечено «Проведено». */
  held: number;
  /** Отмечено «Не состоялось». */
  failed: number;
  /** Прошло, но никто не отметил. */
  unmarked: number;
  /** Ещё впереди (и идут сейчас). */
  upcoming: number;
  cancelled: number;
  /** Гостей на проведённых (точные числа из мероприятий). */
  guests: number;
  /** Сколько проведённых без числа гостей. */
  guestsMissing: number;
  byHost: HostStats[];
  byTitle: Array<{ title: string; planned: number; held: number }>;
}

/** Итоги по мероприятиям периода (мероприятие относится к дню начала). */
export function statsOf(events: AgencyEvent[], from: string, to: string, now = Date.now()): EventStats {
  const list = events.filter((e) => e.day >= from && e.day <= to);
  const s: EventStats = { planned: 0, held: 0, failed: 0, unmarked: 0, upcoming: 0, cancelled: 0, guests: 0, guestsMissing: 0, byHost: [], byTitle: [] };
  const hosts = new Map<string, HostStats>();
  const titles = new Map<string, { title: string; planned: number; held: number }>();
  for (const e of list) {
    if (e.cancelled) {
      s.cancelled += 1;
      continue;
    }
    s.planned += 1;
    const status = eventStatus(e, now);
    const host = hosts.get(e.hostId) ?? { hostId: e.hostId, hostName: e.hostName, planned: 0, held: 0, guests: 0 };
    host.planned += 1;
    const key = (e.title || "Мероприятие").trim();
    const t = titles.get(key.toLowerCase()) ?? { title: key, planned: 0, held: 0 };
    t.planned += 1;
    if (e.held === true) {
      s.held += 1;
      host.held += 1;
      t.held += 1;
      if (e.guests === null) s.guestsMissing += 1;
      else {
        s.guests += e.guests;
        host.guests += e.guests;
      }
    } else if (e.held === false) s.failed += 1;
    else if (status === "past") s.unmarked += 1;
    else s.upcoming += 1;
    hosts.set(e.hostId, host);
    titles.set(key.toLowerCase(), t);
  }
  s.byHost = [...hosts.values()].sort((a, b) => b.held - a.held || b.planned - a.planned || a.hostName.localeCompare(b.hostName, "ru"));
  s.byTitle = [...titles.values()].sort((a, b) => b.planned - a.planned || a.title.localeCompare(b.title, "ru"));
  return s;
}
