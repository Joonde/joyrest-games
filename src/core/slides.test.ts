import { describe, expect, it } from "vitest";
import { countdownLabel, joinSlide, linesFromText, slideTemplate, SLIDE_TEMPLATES, techSlide } from "./slides";
import { parseSlide, SLIDE_KINDS } from "../data/cues";

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

  it("технический перерыв и QR для опоздавших — одним касанием, сервер их принимает", () => {
    for (const slide of [techSlide("t1"), joinSlide("j1")]) {
      expect(parseSlide(slide)).toEqual(slide);
      expect(SLIDE_KINDS).toContain(slide.kind);
    }
    expect(techSlide("t1")).toMatchObject({ kind: "tech", title: "Технический перерыв", endsAt: null });
    // Каждый вид из списка сервера есть в шаблонах пульта.
    for (const kind of SLIDE_KINDS) expect(SLIDE_TEMPLATES.some((t) => t.kind === kind)).toBe(true);
  });
});
