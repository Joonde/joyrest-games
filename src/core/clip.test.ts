import { describe, expect, it } from "vitest";
import { clipFields, DEFAULT_CLIP, moveHandle, parseClip } from "./clip";

describe("музыкальный фрагмент", () => {
  it("старые игры читаются, новые поля — со значениями по умолчанию, мусор отбрасывается", () => {
    expect(parseClip({ trackId: "t1", trackStart: 42, trackLength: 15 })).toEqual({ ...DEFAULT_CLIP, trackId: "t1", start: 42, length: 15 });
    expect(parseClip({ trackId: "../x", trackStart: -5, trackLength: 999, fadeIn: 7, join: "boom", chorusStart: 65, chorusLength: 12, confetti: false })).toEqual({
      ...DEFAULT_CLIP,
      start: 0,
      length: 120,
      chorusStart: 65,
      confetti: false,
    });
    const clip = { ...DEFAULT_CLIP, trackId: "t2", chorusStart: 70, fadeIn: 2 };
    expect(parseClip(clipFields(clip))).toEqual(clip);
  });

  it("ползунки не заходят друг за друга и за края трека", () => {
    const clip = { ...DEFAULT_CLIP, start: 40, length: 15 };
    // Начало не заходит за конец: остаётся минимум 3 с.
    expect(moveHandle(clip, "start", 60, 200)).toMatchObject({ start: 52, length: 3 });
    expect(moveHandle(clip, "start", -10, 200)).toMatchObject({ start: 0, length: 55 });
    // Конец не раньше начала + 3 с и не дальше края трека и 120 с.
    expect(moveHandle(clip, "end", 10, 200)).toMatchObject({ start: 40, length: 3 });
    expect(moveHandle(clip, "end", 500, 200)).toMatchObject({ start: 40, length: 120 });
    expect(moveHandle({ ...clip, start: 150 }, "end", 500, 180)).toMatchObject({ length: 30 });
    // Припев не уезжает за край трека.
    expect(moveHandle(clip, "chorus", 300, 200).chorusStart).toBe(190);
  });
});
