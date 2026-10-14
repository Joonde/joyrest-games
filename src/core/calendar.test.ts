import { describe, expect, it } from "vitest";
import type { AvailabilityEntry } from "../data/types";
import {
  addDays,
  availabilityOf,
  dayIndex,
  dayInWindow,
  dayTitle,
  endAfter,
  entriesOfDay,
  monthGrid,
  parseTime,
  rangeLabel,
  timeLabel,
  validTime,
  weeklyDays,
} from "./calendar";

let n = 0;
const entry = (day: string, start: number, end: number, kind: AvailabilityEntry["kind"] = "free"): AvailabilityEntry => ({
  id: `e${(n += 1)}`,
  uid: "anna",
  day,
  start,
  end,
  kind,
  note: "",
});
const h = (hours: number) => hours * 60;

describe("время и даты", () => {
  it("подписи времени, за полночь и весь день", () => {
    expect(timeLabel(h(19) + 30)).toBe("19:30");
    expect(timeLabel(h(26))).toBe("02:00");
    expect(rangeLabel(0, h(24))).toBe("весь день");
    expect(rangeLabel(h(20), h(26))).toBe("20:00–02:00 (за полночь)");
    expect(parseTime("9:05")).toBe(h(9) + 5);
    expect(parseTime("24:00")).toBeNull();
    expect(endAfter(h(20), h(2))).toBe(h(26));
    expect(endAfter(h(18), h(23))).toBe(h(23));
    expect(endAfter(h(18), 0)).toBe(h(24));
  });

  it("проверка времени: шаг 15 минут, конец после начала и не позже 06:00", () => {
    expect(validTime(h(18), h(23))).toBe(true);
    expect(validTime(0, h(24))).toBe(true);
    expect(validTime(h(20), h(30))).toBe(true);
    expect(validTime(h(20), h(30) + 15)).toBe(false);
    expect(validTime(h(20), h(20))).toBe(false);
    expect(validTime(h(24), h(25))).toBe(false);
    expect(validTime(h(18) + 10, h(23))).toBe(false);
    expect(validTime("18", h(23))).toBe(false);
  });

  it("даты: несуществующих нет, окно — месяц назад и два года вперёд", () => {
    expect(dayIndex("2026-02-30")).toBeNull();
    expect(dayIndex("2026-10-14")).not.toBeNull();
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(dayInWindow("2026-10-01", "2026-10-14")).toBe(true);
    expect(dayInWindow("2026-08-01", "2026-10-14")).toBe(false);
    expect(dayInWindow("2029-01-01", "2026-10-14")).toBe(false);
    expect(dayTitle("2027-06-19")).toBe("суббота, 19 июня 2027");
    expect(weeklyDays("2026-10-16", 3)).toEqual(["2026-10-16", "2026-10-23", "2026-10-30"]);
  });

  it("сетка месяца с понедельника", () => {
    const grid = monthGrid(2026, 10);
    // 1 октября 2026 — четверг: три пустые клетки.
    expect(grid.slice(0, 4)).toEqual([null, null, null, "2026-10-01"]);
    expect(grid.length % 7).toBe(0);
    expect(grid.filter(Boolean)).toHaveLength(31);
  });
});

describe("кто может", () => {
  const day = "2026-10-16";
  it("свободен весь вечер, частично, не отметил", () => {
    expect(availabilityOf([entry(day, 0, h(24))], day, h(18), h(23)).status).toBe("free");
    // Два куска подряд — тоже целиком свободен.
    expect(availabilityOf([entry(day, h(17), h(20)), entry(day, h(20), h(24))], day, h(18), h(23)).status).toBe("free");
    const part = availabilityOf([entry(day, h(20), h(24))], day, h(18), h(23));
    expect(part.status).toBe("partial");
    expect(part.free).toEqual([{ start: h(20), end: h(23) }]);
    expect(availabilityOf([entry("2026-10-17", 0, h(24))], day, h(18), h(23)).status).toBe("unknown");
  });

  it("занят перекрывает свободен; мероприятие — тоже занят", () => {
    const entries = [entry(day, 0, h(24)), entry(day, h(21), h(23), "busy")];
    const r = availabilityOf(entries, day, h(18), h(23));
    expect(r.status).toBe("busy");
    expect(r.busy).toHaveLength(1);
    // Занят утром — вечер свободен.
    expect(availabilityOf([entry(day, 0, h(24)), entry(day, h(10), h(12), "busy")], day, h(18), h(23)).status).toBe("free");
    expect(availabilityOf([entry(day, h(19), h(22), "booked")], day, h(18), h(23)).status).toBe("busy");
  });

  it("за полночь: вчерашнее мероприятие до 02:00 и запрос до утра", () => {
    const yesterday = entry("2026-10-15", h(20), h(26), "booked");
    expect(availabilityOf([yesterday], day, h(1), h(3)).status).toBe("busy");
    expect(availabilityOf([yesterday], day, h(18), h(23)).status).toBe("unknown");
    // Запрос 20:00–02:00: свободен до полуночи и ночью следующего дня.
    const night = [entry(day, h(18), h(24)), entry("2026-10-17", 0, h(4))];
    expect(availabilityOf(night, day, h(20), h(26)).status).toBe("free");
    expect(entriesOfDay([yesterday, entry(day, h(10), h(12))], day).map((e) => e.day)).toEqual(["2026-10-15", day]);
  });
});
