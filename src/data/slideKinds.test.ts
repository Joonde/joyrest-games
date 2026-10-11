import { describe, expect, it } from "vitest";
import { drawSlide } from "../core/draw";
import { joinSlide, SLIDE_TEMPLATES, techSlide } from "../core/slides";
import { parseSlide, SLIDE_KINDS } from "./cues";

describe("виды слайдов", () => {
  it("технический перерыв, QR для опоздавших и жеребьёвку сервер принимает как есть", () => {
    for (const slide of [techSlide("t1"), joinSlide("j1"), drawSlide("d1", ["Аня", "Боря"], "Боря", 1000)]) {
      expect(parseSlide(slide)).toEqual(slide);
      expect(SLIDE_KINDS).toContain(slide.kind);
    }
  });

  it("каждый вид из списка сервера есть в шаблонах пульта", () => {
    for (const kind of SLIDE_KINDS) expect(SLIDE_TEMPLATES.some((t) => t.kind === kind)).toBe(true);
  });
});
