import { describe, expect, it } from "vitest";
import type { SlideState } from "../../data/types";
import { shouldCloseTechBreak, techBreakDue } from "./techBreakAuto";

const tech = (id: string, endsAt: number | null): SlideState => ({ id, kind: "tech", title: "Пауза", text: "", lines: [], endsAt });

describe("авто-конец технического перерыва", () => {
  it("время не вышло — ждём", () => {
    expect(techBreakDue(tech("a", 1000), 999)).toBeNull();
  });
  it("время вышло — id перерыва", () => {
    expect(techBreakDue(tech("a", 1000), 1000)).toBe("a");
    expect(techBreakDue(tech("a", 1000), 5000)).toBe("a");
  });
  it("перерыв без времени и другие слайды сами не уходят", () => {
    expect(techBreakDue(tech("a", null), 10_000)).toBeNull();
    expect(techBreakDue({ ...tech("b", 1000), kind: "break" }, 10_000)).toBeNull();
    expect(techBreakDue(null, 10_000)).toBeNull();
  });
  it("убираем только тот же перерыв и один раз", () => {
    expect(shouldCloseTechBreak("a", tech("a", 1000), null)).toBe(true);
    expect(shouldCloseTechBreak("a", tech("a", 1000), "a")).toBe(false);
    // Второй пульт уже показал другой слайд — не трогаем.
    expect(shouldCloseTechBreak("a", tech("b", 9000), null)).toBe(false);
    expect(shouldCloseTechBreak("a", { ...tech("a", 1000), kind: "join" }, null)).toBe(false);
    expect(shouldCloseTechBreak("a", null, null)).toBe(false);
  });
});
