import { describe, expect, it } from "vitest";
import { icsCalendar, icsFileName, icsFold, icsSummary, icsText, icsTime, webcalUrl, type IcsEvent } from "./ics";

const EVENT: IcsEvent = { id: "ev1", day: "2026-10-24", start: 18 * 60, end: 23 * 60, title: "Свадьба", guests: 60, cancelled: false, hostName: "Аня" };
const URL = "https://games.joy-rest.ru";
const unfold = (text: string) => text.replace(/\r\n /g, "");

describe("календарь телефона (.ics)", () => {
  it("время — в UTC (Москва +3)", () => {
    expect(icsTime(Date.UTC(2026, 9, 24, 15, 0, 0))).toBe("20261024T150000Z");
    const text = icsCalendar([EVENT], { platformUrl: URL, now: 0 });
    expect(text).toContain("DTSTART:20261024T150000Z");
    expect(text).toContain("DTEND:20261024T200000Z");
  });

  it("вечер за полночь заканчивается на следующий день", () => {
    const text = icsCalendar([{ ...EVENT, start: 22 * 60, end: 26 * 60 }], { platformUrl: URL, now: 0 });
    expect(text).toContain("DTSTART:20261024T190000Z");
    expect(text).toContain("DTEND:20261024T230000Z");
  });

  it("в календаре нет клиента, телефона и адреса — только что, когда, гости и ссылка в студию", () => {
    const withClient = { ...EVENT, clientName: "Иван Петров", clientPhone: "+79001234567", place: "Ресторан, ул. Ленина 1" } as IcsEvent;
    const text = unfold(icsCalendar([withClient], { platformUrl: URL, now: 0 }));
    expect(text).not.toMatch(/Иван|9001234567|Ленина/);
    expect(text).toContain("SUMMARY:JoyRest: Свадьба · 60 гостей");
    expect(text).toContain(`URL:${URL}/studio/calendar?tab=events`);
  });

  it("напоминания за день и за 2 часа", () => {
    const text = icsCalendar([EVENT], { platformUrl: URL, now: 0 });
    expect(text).toContain("TRIGGER:-P1D");
    expect(text).toContain("TRIGGER:-PT2H");
    expect(text.match(/BEGIN:VALARM/g)).toHaveLength(2);
  });

  it("строки через CRLF, не длиннее 75 байт, буквы не разрываются", () => {
    const long = { ...EVENT, title: "Корпоратив большой компании с очень длинным названием и ещё одним уточнением" };
    const text = icsCalendar([long], { platformUrl: URL, now: 0, name: "JoyRest — мои мероприятия" });
    expect(text.endsWith("\r\n")).toBe(true);
    for (const line of text.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(unfold(text)).toContain(`SUMMARY:JoyRest: ${long.title} · 60 гостей`);
    expect(icsFold("я".repeat(100)).split("\r\n ").join("")).toBe("я".repeat(100));
  });

  it("экранирование: запятые, точки с запятой, переводы строк", () => {
    expect(icsText("а,б;в\\г\nд")).toBe("а\\,б\\;в\\\\г\\nд");
    expect(icsText("a\u0007b")).toBe("ab");
  });

  it("отменённое — CANCELLED; у владельца — кто ведёт; одинаковый UID при повторе", () => {
    const text = icsCalendar([{ ...EVENT, cancelled: true }], { platformUrl: URL, now: 0, withHost: true });
    expect(text).toContain("STATUS:CANCELLED");
    expect(icsSummary(EVENT, true)).toBe("JoyRest: Свадьба · 60 гостей · ведёт Аня");
    expect(icsSummary({ ...EVENT, title: " ", guests: null })).toBe("JoyRest: Мероприятие");
    expect(icsCalendar([EVENT], { platformUrl: URL, now: 0 }).match(/UID:ev1@joy-rest.ru/g)).toHaveLength(1);
  });

  it("подписка: название календаря и частота обновления; пустой список — тоже календарь", () => {
    const text = icsCalendar([], { platformUrl: URL, now: 0, name: "JoyRest" });
    expect(text).toContain("X-WR-CALNAME:JoyRest");
    expect(text).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT1H");
    expect(text).not.toContain("BEGIN:VEVENT");
    expect(icsFileName(EVENT)).toBe("joyrest-2026-10-24.ics");
    expect(webcalUrl("https://games.joy-rest.ru/api/calendar/feed/abc.ics")).toBe("webcal://games.joy-rest.ru/api/calendar/feed/abc.ics");
  });
});
