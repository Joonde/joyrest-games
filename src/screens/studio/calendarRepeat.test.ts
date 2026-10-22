import { describe, expect, it } from "vitest";
import { partialText, pendingDays, planRepeat, repeatKey } from "./calendarRepeat";

const days = ["2026-11-02", "2026-11-09", "2026-11-16"];

function counter() {
  let n = 0;
  return () => `id${++n}`;
}

describe("повтор каждую неделю", () => {
  it("каждой неделе — свой id", () => {
    const plan = planRepeat(null, repeatKey(days[0]!, "free", 0, 1440, 3, ""), days, counter());
    expect(Object.values(plan.ids)).toEqual(["id1", "id2", "id3"]);
    expect(pendingDays(plan, days)).toEqual(days);
  });

  it("повтор той же попытки — те же id, сохранённые не отправляются", () => {
    const make = counter();
    const key = repeatKey(days[0]!, "free", 0, 1440, 3, "");
    const first = planRepeat(null, key, days, make);
    first.saved.push(days[0]!);
    const again = planRepeat(first, key, days, make);
    expect(again.ids).toEqual(first.ids);
    expect(pendingDays(again, days)).toEqual(days.slice(1));
  });

  it("поменяли форму — новые id", () => {
    const make = counter();
    const first = planRepeat(null, repeatKey(days[0]!, "free", 0, 1440, 3, ""), days, make);
    const other = planRepeat(first, repeatKey(days[0]!, "busy", 0, 1440, 3, ""), days, make);
    expect(other.ids[days[0]!]).not.toBe(first.ids[days[0]!]);
    expect(other.saved).toEqual([]);
  });

  it("текст частичной ошибки называет, сколько не сохранилось", () => {
    expect(partialText(4, 12)).toContain("не сохранилось 8");
    expect(partialText(0, 12)).toContain("Не получилось сохранить");
  });
});
