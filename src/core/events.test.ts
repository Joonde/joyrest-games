import { describe, expect, it } from "vitest";
import type { AgencyEvent } from "../data/types";
import { bookingId, bookingNote, cleanPhone, eventSpan, eventStatus, parseEventInput, sortEvents, timelineHours, timelineOf, weekStart } from "./events";

const ev = (id: string, day: string, start: number, end: number, extra: Partial<AgencyEvent> = {}): AgencyEvent => ({
  id,
  hostId: "h1",
  hostName: "Анна",
  day,
  start,
  end,
  clientName: "",
  clientPhone: "",
  title: "Свадьба",
  place: "",
  guests: null,
  note: "",
  cancelled: false,
  ...extra,
});

describe("планировщик: статус по московскому времени", () => {
  const e = ev("e1", "2026-10-20", 18 * 60, 23 * 60);
  // 18:00 МСК = 15:00 UTC.
  const at = (iso: string) => Date.parse(iso);
  it("предстоит, идёт сейчас, прошло, отменено", () => {
    expect(eventSpan(e)).toEqual({ from: at("2026-10-20T15:00:00Z"), to: at("2026-10-20T20:00:00Z") });
    expect(eventStatus(e, at("2026-10-20T14:59:00Z"))).toBe("upcoming");
    expect(eventStatus(e, at("2026-10-20T15:00:00Z"))).toBe("now");
    expect(eventStatus(e, at("2026-10-20T20:00:00Z"))).toBe("past");
    expect(eventStatus({ ...e, cancelled: true }, at("2026-10-20T16:00:00Z"))).toBe("cancelled");
  });
  it("вечер за полночь идёт до утра следующего дня", () => {
    const night = ev("e2", "2026-10-20", 22 * 60, 26 * 60);
    expect(eventStatus(night, at("2026-10-20T22:30:00Z"))).toBe("now"); // 01:30 МСК 21-го
  });
});

describe("планировщик: проверка формы", () => {
  const now = Date.parse("2026-10-14T10:00:00Z");
  const ok = { id: "e1", hostId: "h1", day: "2026-11-01", start: 1080, end: 1380, title: "Свадьба", clientName: " Ольга ", clientPhone: "+7 (999) 123-45-67 доб", guests: 40 };
  it("принимает верное и чистит текст", () => {
    expect(parseEventInput(ok, now)).toMatchObject({ clientName: "Ольга", clientPhone: "+7 (999) 123-45-67", guests: 40, place: "", note: "" });
  });
  it("нужны ведущий, дата, время и что за мероприятие или клиент", () => {
    expect(parseEventInput({ ...ok, hostId: "" }, now)).toBeNull();
    expect(parseEventInput({ ...ok, day: "2030-01-01" }, now)).toBeNull();
    expect(parseEventInput({ ...ok, start: 1081 }, now)).toBeNull();
    expect(parseEventInput({ ...ok, title: "", clientName: "" }, now)).toBeNull();
    expect(parseEventInput({ ...ok, title: "" }, now)).not.toBeNull();
    expect(parseEventInput({ ...ok, guests: -1 }, now)).toBeNull();
    expect(parseEventInput({ ...ok, guests: null }, now)?.guests).toBeNull();
  });
  it("в календарь ведущего — без имени и телефона клиента", () => {
    expect(bookingNote({ title: "Свадьба", guests: 40 })).toBe("Свадьба, 40 гостей");
    expect(bookingNote({ title: "", guests: null })).toBe("Мероприятие");
    expect(bookingId("e1")).toBe("ev-e1");
    expect(cleanPhone("8 999 <b>")).toBe("8 999");
  });
});

describe("планировщик: таймлайн дня", () => {
  it("пересекающиеся — в соседних колонках, непересекающиеся — во всю ширину", () => {
    const items = timelineOf(
      [ev("a", "2026-10-20", 1080, 1380), ev("b", "2026-10-20", 1140, 1260), ev("c", "2026-10-20", 600, 720), ev("x", "2026-10-20", 600, 700, { cancelled: true })],
      "2026-10-20",
    );
    const by = (id: string) => items.find((i) => i.event.id === id);
    expect(items).toHaveLength(3);
    expect(by("c")).toMatchObject({ lane: 0, lanes: 1 });
    expect(by("a")).toMatchObject({ lane: 0, lanes: 2 });
    expect(by("b")).toMatchObject({ lane: 1, lanes: 2 });
  });
  it("вчерашний вечер за полночь — с 00:00, часы расширяются до конца ночного", () => {
    const items = timelineOf([ev("n", "2026-10-19", 1320, 1620), ev("m", "2026-10-20", 1260, 1560)], "2026-10-20");
    expect(items.find((i) => i.event.id === "n")).toMatchObject({ top: 0, bottom: 180 });
    expect(timelineHours(items)).toEqual({ from: 0, to: 1560 });
    expect(timelineHours([])).toEqual({ from: 480, to: 1440 });
  });
});

describe("планировщик: неделя и сортировка", () => {
  it("неделя — с понедельника", () => {
    expect(weekStart("2026-10-14")).toBe("2026-10-12"); // среда
    expect(weekStart("2026-10-12")).toBe("2026-10-12");
    expect(weekStart("2026-10-18")).toBe("2026-10-12"); // воскресенье
  });
  it("архив — сначала новые", () => {
    const list = [ev("a", "2026-10-01", 600, 700), ev("b", "2026-10-03", 600, 700), ev("c", "2026-10-03", 500, 700)];
    expect(sortEvents(list, false).map((e) => e.id)).toEqual(["a", "c", "b"]);
    expect(sortEvents(list, true).map((e) => e.id)).toEqual(["b", "c", "a"]);
  });
});
