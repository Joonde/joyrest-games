import { describe, expect, it } from "vitest";
import { countdownLabel, joinSlide, linesFromText, slideTemplate, SLIDE_TEMPLATES, techSlide } from "./slides";

describe("слайды-шаблоны", () => {
  it("у каждого вида свой шаблон, неизвестный — свой слайд", () => {
    expect(new Set(SLIDE_TEMPLATES.map((t) => t.kind)).size).toBe(SLIDE_TEMPLATES.length);
    expect(slideTemplate("rules").defaults.lines.length).toBeGreaterThan(0);
  });

  it("пункты из текста и обратный отсчёт", () => {
    expect(linesFromText(" Раз \n\n Два\n")).toEqual(["Раз", "Два"]);
    expect(countdownLabel({ endsAt: 10_000 + 65_000 }, 10_000)).toBe("1:05");
    expect(countdownLabel({ endsAt: 1000 }, 50_000)).toBe("0:00");
    expect(countdownLabel({ endsAt: null }, 0)).toBeNull();
  });

  it("технический перерыв и QR для опоздавших — без отсчёта", () => {
    expect(techSlide("t1")).toMatchObject({ kind: "tech", title: "Технический перерыв", endsAt: null });
    expect(joinSlide("j1")).toMatchObject({ kind: "join", endsAt: null });
  });
});
