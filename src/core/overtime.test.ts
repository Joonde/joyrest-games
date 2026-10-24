import { describe, expect, it } from "vitest";
import { clockOf, lengthOf, overtimeOf, overtimeText } from "./overtime";

const MIN = 60_000;

describe("сверх плана: «до» уже с запасом 30 минут, дальше — продление по 30 минут", () => {
  it("уложились в «до» — без доплаты", () => {
    expect(overtimeOf(0, 10 * MIN)).toMatchObject({ minutes: 0, blocks: 0, price: 0 });
    expect(overtimeOf(30 * 1000, 0)).toMatchObject({ minutes: 0, blocks: 0 });
    expect(overtimeText(overtimeOf(0, 0))).toBe("");
  });
  it("с 1-й минуты после «до» — 30 минут, с 31-й — час, больше двух часов — обсудить", () => {
    expect(overtimeOf(1 * MIN, 0)).toMatchObject({ blocks: 1, price: 3900, extension: "+30 мин" });
    expect(overtimeOf(30 * MIN, 0)).toMatchObject({ blocks: 1 });
    expect(overtimeOf(31 * MIN, 0)).toMatchObject({ blocks: 2, price: 7900, extension: "+1 ч" });
    expect(overtimeOf(120 * MIN, 0)).toMatchObject({ blocks: 4, price: 15800 });
    expect(overtimeOf(121 * MIN, 0).price).toBeNull();
    expect(overtimeText(overtimeOf(27 * MIN, 0))).toBe("сверх плана 27 мин — продление +30 мин, 3 900 ₽");
  });
  it("таймер и длительность", () => {
    expect(clockOf(42 * MIN + 7000)).toBe("42:07");
    expect(clockOf(102 * MIN + 7000)).toBe("1:42:07");
    expect(lengthOf(161 * MIN)).toBe("2 ч 41 мин");
    expect(lengthOf(35 * MIN)).toBe("35 мин");
  });
});
