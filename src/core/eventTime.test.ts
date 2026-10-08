import { describe, expect, it } from "vitest";
import { breakStats, durationLine, elapsedClock, parseBreaks, trackBreaks } from "./eventTime";

const brk = (id: string, endsAt: number | null) => ({ id, kind: "break", endsAt });
const other = { id: "s9", kind: "rules", endsAt: null };

describe("время вечера: перерывы", () => {
  it("слайд «Перерыв» открывает перерыв, отсчёт задаёт конец, раньше убрали — конец сейчас", () => {
    let b = trackBreaks([], null, brk("b1", 10 * 60_000), 0);
    expect(b).toEqual([{ id: "b1", start: 0, end: 10 * 60_000 }]);
    b = trackBreaks(b, brk("b1", 10 * 60_000), null, 4 * 60_000);
    expect(b).toEqual([{ id: "b1", start: 0, end: 4 * 60_000 }]);
    expect(breakStats(b, 99 * 60_000)).toEqual({ ms: 4 * 60_000, count: 1 });
  });

  it("повтор того же показа — без нового перерыва; смена на другой слайд закрывает", () => {
    let b = trackBreaks([], null, brk("b1", null), 1000);
    b = trackBreaks(b, brk("b1", null), brk("b1", null), 2000);
    expect(b).toHaveLength(1);
    b = trackBreaks(b, brk("b1", null), other, 61_000);
    expect(breakStats(b, 999_999)).toEqual({ ms: 60_000, count: 1 });
  });

  it("убрали после конца отсчёта — конец не сдвигается; идущий перерыв обрезается по «до»", () => {
    let b = trackBreaks([], null, brk("b1", 5 * 60_000), 0);
    b = trackBreaks(b, brk("b1", 5 * 60_000), null, 9 * 60_000);
    expect(b[0]?.end).toBe(5 * 60_000);
    const open = trackBreaks([], null, brk("b2", null), 0);
    expect(breakStats(open, 3 * 60_000)).toEqual({ ms: 3 * 60_000, count: 1 });
  });

  it("разбор из базы отбрасывает мусор", () => {
    expect(parseBreaks([{ id: "a", start: 1, end: 2 }, { id: 5 }, null, "x", { id: "b", start: "1" }])).toEqual([{ id: "a", start: 1, end: 2 }]);
    expect(parseBreaks("[]")).toEqual([]);
  });

  it("подписи", () => {
    expect(durationLine(0, 134 * 60_000, 25 * 60_000, 2)).toBe("шла 2 ч 14 мин, из них перерывы 25 мин (2 раза)");
    expect(durationLine(0, 60 * 60_000, 5 * 60_000, 5)).toBe("шла 1 ч, из них перерывы 5 мин (5 раз)");
    expect(durationLine(0, 47 * 60_000)).toBe("шла 47 мин");
    expect(elapsedClock(72 * 60_000 + 59_000)).toBe("1:12");
  });
});
