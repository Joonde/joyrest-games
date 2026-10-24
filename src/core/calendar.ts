/**
 * Календарь команды (решение владельца 14 октября 2026): ведущие отмечают, когда свободны и когда
 * заняты; владелец вводит дату и время мероприятия и сразу видит, кто может, у кого время занято и
 * кто ничего не отметил. Владелец может закрепить время за ведущим («Мероприятие JoyRest») — у
 * ведущего это время становится занятым. Чистые функции: их же проверяет сервер.
 *
 * Время — минуты от полуночи дня записи. Вечер может идти за полночь: конец до 06:00 следующего дня
 * (end до 1440 + 360). Шаг — 15 минут.
 */
import type { AvailabilityEntry, AvailabilityKind } from "../data/types";

export const DAY_MINUTES = 1440;
export const TIME_STEP = 15;
/** Конец записи — не позже 06:00 следующего дня. */
export const MAX_END = DAY_MINUTES + 6 * 60;
export const NOTE_MAX = 200;
/** Сколько дней вперёд можно отмечать (и сколько назад смотреть). */
export const DAYS_AHEAD = 2 * 366;
export const DAYS_BACK = 31;
/** Записей у одного человека в один день. */
export const PER_DAY_MAX = 12;
/** Окно одного запроса списка (дней). */
export const RANGE_MAX_DAYS = 62;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** «ГГГГ-ММ-ДД» → номер дня от 1970-01-01 (UTC); неверная дата — null. */
export function dayIndex(day: string): number | null {
  if (!DAY_RE.test(day)) return null;
  const t = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  const index = Math.round(t / 86_400_000);
  // 2026-02-30 Date.parse «переносит» на март — такой даты нет.
  return dayOf(index) === day ? index : null;
}

export function dayOf(index: number): string {
  return new Date(index * 86_400_000).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const i = dayIndex(day);
  return i === null ? day : dayOf(i + n);
}

/** Сегодня по Москве (UTC+3, без перехода на летнее время). */
export function todayMoscow(now = Date.now()): string {
  return new Date(now + 3 * 3_600_000).toISOString().slice(0, 10);
}

/** «19:30»; после полуночи — время следующего дня («02:00»). */
export function timeLabel(minutes: number): string {
  const m = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function isWholeDay(start: number, end: number): boolean {
  return start === 0 && end === DAY_MINUTES;
}

/** «весь день», «19:00–23:00», «20:00–02:00 (до утра)». */
export function rangeLabel(start: number, end: number): string {
  if (isWholeDay(start, end)) return "весь день";
  const night = end > DAY_MINUTES ? " (за полночь)" : "";
  return `${timeLabel(start)}–${timeLabel(end)}${night}`;
}

/** «HH:MM» → минуты; «до» меньше «с» — значит за полночь (+24 ч). */
export function parseTime(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Конец по введённому времени: раньше начала (или 00:00) — это следующий день. */
export function endAfter(start: number, end: number): number {
  return end <= start ? end + DAY_MINUTES : end;
}

export const KIND_TITLES: Record<AvailabilityKind, string> = {
  free: "Свободен",
  busy: "Занят",
  booked: "Мероприятие JoyRest",
};

export function isKind(value: unknown): value is AvailabilityKind {
  return value === "free" || value === "busy" || value === "booked";
}

/** Время записи правильное: шаг 15 минут, начало в своём дне, конец после начала и не позже 06:00 следующего. */
export function validTime(start: unknown, end: unknown): boolean {
  return (
    typeof start === "number" &&
    typeof end === "number" &&
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start % TIME_STEP === 0 &&
    end % TIME_STEP === 0 &&
    start >= 0 &&
    start < DAY_MINUTES &&
    end > start &&
    end <= MAX_END
  );
}

/** День в допустимом окне: не раньше месяца назад и не дальше двух лет вперёд. */
export function dayInWindow(day: string, today: string): boolean {
  const d = dayIndex(day);
  const t = dayIndex(today);
  if (d === null || t === null) return false;
  return d >= t - DAYS_BACK && d <= t + DAYS_AHEAD;
}

export function cleanNote(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
}

type Span = [number, number];

/** Запись → отрезок в «абсолютных» минутах (от 1970-01-01). */
function spanOf(entry: Pick<AvailabilityEntry, "day" | "start" | "end">): Span | null {
  const d = dayIndex(entry.day);
  if (d === null) return null;
  return [d * DAY_MINUTES + entry.start, d * DAY_MINUTES + entry.end];
}

function merge(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else out.push([s[0], s[1]]);
  }
  return out;
}

export type MemberStatus = "free" | "partial" | "busy" | "unknown";

export interface MemberAvailability {
  status: MemberStatus;
  /** Свободные части запрошенного времени (минуты от полуночи запрошенного дня; > 1440 — после полуночи). */
  free: Array<{ start: number; end: number }>;
  /** Записи «занят» и «мероприятие», которые задевают запрошенное время. */
  busy: AvailabilityEntry[];
}

/**
 * Может ли человек в этот день и время: «busy» — время задевает его «занят» или мероприятие;
 * «free» — его «свободен» покрывает всё время; «partial» — только часть; «unknown» — не отметил.
 * Учитываются и записи прошлого дня, идущие за полночь.
 */
export function availabilityOf(entries: AvailabilityEntry[], day: string, start: number, end: number): MemberAvailability {
  const query = spanOf({ day, start, end });
  if (!query) return { status: "unknown", free: [], busy: [] };
  const [qs, qe] = query;
  const overlaps = (s: Span) => s[0] < qe && s[1] > qs;
  const busy = entries.filter((e) => e.kind !== "free").filter((e) => {
    const s = spanOf(e);
    return s !== null && overlaps(s);
  });
  const freeSpans = merge(
    entries
      .filter((e) => e.kind === "free")
      .map(spanOf)
      .filter((s): s is Span => s !== null && overlaps(s))
      .map((s): Span => [Math.max(s[0], qs), Math.min(s[1], qe)]),
  );
  const base = qs - start;
  const free = freeSpans.map(([s, e]) => ({ start: s - base, end: e - base }));
  if (busy.length > 0) return { status: "busy", free, busy };
  if (freeSpans.length === 1 && freeSpans[0]?.[0] === qs && freeSpans[0][1] === qe) return { status: "free", free, busy };
  return { status: free.length > 0 ? "partial" : "unknown", free, busy };
}

/** Порядок в списке «Кто может»: свободные, частично, не отметили, заняты. */
export const STATUS_ORDER: Record<MemberStatus, number> = { free: 0, partial: 1, unknown: 2, busy: 3 };

export const STATUS_TITLES: Record<MemberStatus, string> = {
  free: "Может",
  partial: "Свободен частично",
  unknown: "Не отметил",
  busy: "Занят",
};

/** Записи, видимые в этом дне: свои за день и прошлого дня, идущие за полночь. */
export function entriesOfDay(entries: AvailabilityEntry[], day: string): AvailabilityEntry[] {
  const prev = addDays(day, -1);
  return entries
    .filter((e) => e.day === day || (e.day === prev && e.end > DAY_MINUTES))
    .sort((a, b) => (a.day === b.day ? a.start - b.start : a.day < b.day ? -1 : 1));
}

/** Дни месяца для сетки: с понедельника, пустые ячейки — null. month — 1..12. */
export function monthGrid(year: number, month: number): Array<string | null> {
  const first = Date.UTC(year, month - 1, 1);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const shift = (new Date(first).getUTCDay() + 6) % 7;
  const cells: Array<string | null> = Array.from({ length: shift }, () => null);
  for (let d = 1; d <= days; d++) cells.push(dayOf(Math.round(first / 86_400_000) + d - 1));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const MONTHS_OF = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
export const WEEK_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function monthTitle(year: number, month: number): string {
  const name = MONTHS[month - 1] ?? "";
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
}

/** «пятница, 19 июня 2027». */
export function dayTitle(day: string): string {
  const i = dayIndex(day);
  if (i === null) return day;
  const d = new Date(i * 86_400_000);
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS_OF[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Дни повтора «каждую неделю»: сам день и ещё `weeks − 1` таких же дней недели. */
export function weeklyDays(day: string, weeks: number): string[] {
  return Array.from({ length: Math.max(1, Math.min(12, weeks)) }, (_, i) => addDays(day, i * 7));
}

/** Время по умолчанию для поиска — типичный вечер. */
export const DEFAULT_QUERY = { start: 18 * 60, end: 23 * 60 };

/** Варианты времени в выпадающих списках (шаг 15 минут: начало из расчёта сайта бывает 19:15). */
export const TIME_OPTIONS: number[] = Array.from({ length: 96 }, (_, i) => i * 15);
