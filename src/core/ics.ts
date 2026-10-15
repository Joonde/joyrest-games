/**
 * «Добавить в мой календарь» (решение владельца 15 октября 2026): мероприятия ведущего — файлом .ics (одно мероприятие)
 * и подпиской (весь список, телефон обновляет сам). Как и в Telegram, в календаре телефона нет имени, телефона и адреса
 * клиента — только что, когда, сколько гостей и ссылка в студию (календари телефонов хранятся у Apple и Google, не в
 * России). Напоминания — за день и за 2 часа. Чистые функции без сервера и браузера.
 */
import { eventSpan } from "./events";
import type { AgencyEvent } from "../data/types";

export type IcsEvent = Pick<AgencyEvent, "id" | "day" | "start" | "end" | "title" | "guests" | "cancelled" | "hostName">;

export interface IcsOptions {
  /** Адрес платформы без «/» в конце: https://games.joy-rest.ru */
  platformUrl: string;
  /** Название календаря при подписке. */
  name?: string;
  /** Подписывать ведущего в названии (календарь владельца со всеми ведущими). */
  withHost?: boolean;
  now?: number;
}

/** Время в UTC для iCalendar: 20261015T150000Z. */
export function icsTime(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Текст значения: \ ; , и переводы строк экранируются, управляющие символы убираются. */
export function icsText(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Строки длиннее 75 байт переносятся (продолжение начинается с пробела), не разрывая букву. */
export function icsFold(line: string): string {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const size = new TextEncoder().encode(ch).length;
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += size;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** Что показать в календаре: «JoyRest: Свадьба · 60 гостей» (у владельца — и кто ведёт). */
export function icsSummary(e: IcsEvent, withHost = false): string {
  const what = `${e.title.trim() || "Мероприятие"}${e.guests ? ` · ${e.guests} гостей` : ""}`;
  return `JoyRest: ${what}${withHost && e.hostName ? ` · ведёт ${e.hostName}` : ""}`;
}

function alarm(trigger: string, text: string): string[] {
  return ["BEGIN:VALARM", "ACTION:DISPLAY", `TRIGGER:${trigger}`, `DESCRIPTION:${icsText(text)}`, "END:VALARM"];
}

function vevent(e: IcsEvent, options: IcsOptions, stamp: string): string[] {
  const span = eventSpan(e);
  if (!span) return [];
  const link = `${options.platformUrl}/studio/calendar?tab=events`;
  const summary = icsSummary(e, options.withHost);
  return [
    "BEGIN:VEVENT",
    `UID:${e.id}@joy-rest.ru`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${icsTime(span.from)}`,
    `DTEND:${icsTime(span.to)}`,
    `SUMMARY:${icsText(summary)}`,
    `DESCRIPTION:${icsText(`Клиент, телефон, адрес и подробности — в студии JoyRest:\n${link}`)}`,
    `URL:${link}`,
    `STATUS:${e.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:OPAQUE",
    ...alarm("-P1D", `Завтра: ${summary}`),
    ...alarm("-PT2H", `Через 2 часа: ${summary}`),
    "END:VEVENT",
  ];
}

/** Календарь iCalendar (RFC 5545) — строки через CRLF. */
export function icsCalendar(events: IcsEvent[], options: IcsOptions): string {
  const stamp = icsTime(options.now ?? Date.now());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//JoyRest//Games//RU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...(options.name ? [`X-WR-CALNAME:${icsText(options.name)}`, "X-WR-TIMEZONE:Europe/Moscow", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"] : []),
    ...events.flatMap((e) => vevent(e, options, stamp)),
    "END:VCALENDAR",
  ];
  return `${lines.map(icsFold).join("\r\n")}\r\n`;
}

/** Имя файла одного мероприятия: joyrest-2026-10-24.ics */
export function icsFileName(e: Pick<AgencyEvent, "day">): string {
  return `joyrest-${/^\d{4}-\d{2}-\d{2}$/.test(e.day) ? e.day : "event"}.ics`;
}

/** Ссылка подписки: webcal:// открывает «Подписаться» в календаре iPhone и Mac. */
export function webcalUrl(httpsUrl: string): string {
  return httpsUrl.replace(/^https?:\/\//, "webcal://");
}
