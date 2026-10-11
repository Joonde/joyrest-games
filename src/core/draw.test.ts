import { describe, expect, it } from "vitest";
import { parseSlide } from "../data/cues";
import { DRAW_MS, drawFrame, drawNames, drawSlide, drawWinner } from "./draw";

describe("жеребьёвка", () => {
  it("жребий — один из участников; пусто — никого", () => {
    expect(drawWinner(["a", "b", "c"], () => 0.99)).toBe("c");
    expect(drawWinner(["a", "b", "c"], () => 0)).toBe("a");
    expect(drawWinner([], () => 0.5)).toBeNull();
  });

  it("слайд: победитель в заголовке и в списке, сервер принимает его как есть", () => {
    const slide = drawSlide("d1", ["Аня", "Боря", "Вика"], "Боря", 1000);
    expect(slide).toMatchObject({ kind: "draw", title: "Боря", endsAt: 1000 + DRAW_MS });
    expect(parseSlide(slide)).toEqual(slide);
    expect(drawNames(slide).at(-1)).toBe("Боря");
    expect(drawNames(slide)).toHaveLength(3);
  });

  it("монетка останавливается на победителе, смены всё реже", () => {
    const names = drawNames(drawSlide("d", ["Аня", "Боря", "Вика", "Гоша"], "Вика", 0));
    expect(names[drawFrame(names, 0).index]).toBe("Вика");
    expect(names[drawFrame(names, 1).index]).toBe("Вика");
    const early = drawFrame(names, DRAW_MS - 500).flips;
    const late = drawFrame(names, 500).flips - drawFrame(names, 1000).flips;
    expect(early).toBeGreaterThan(4);
    expect(late).toBeLessThanOrEqual(2);
  });

  it("длинный список обрезается, победитель остаётся", () => {
    const many = Array.from({ length: 200 }, (_, i) => `Игрок ${i}`);
    const slide = drawSlide("d", many, "Игрок 199", 0);
    expect(slide.text.length).toBeLessThanOrEqual(400);
    expect(drawNames(slide).at(-1)).toBe("Игрок 199");
  });
});
