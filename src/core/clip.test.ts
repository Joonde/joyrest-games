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
      chorusLength: 12,
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

  it("припев — любой промежуток: два ползунка, 3–120 с, не за край трека", () => {
    const clip = { ...DEFAULT_CLIP, chorusStart: 60, chorusLength: 10 };
    // Конец тянут дальше — припев длиннее, начало на месте.
    expect(moveHandle(clip, "chorusEnd", 87, 200)).toMatchObject({ chorusStart: 60, chorusLength: 27 });
    expect(moveHandle(clip, "chorusEnd", 61, 200)).toMatchObject({ chorusStart: 60, chorusLength: 3 });
    expect(moveHandle(clip, "chorusEnd", 999, 200)).toMatchObject({ chorusStart: 60, chorusLength: 120 });
    expect(moveHandle({ ...clip, chorusStart: 190 }, "chorusEnd", 999, 200)).toMatchObject({ chorusStart: 190, chorusLength: 10 });
    // Начало тянут — конец на месте.
    expect(moveHandle(clip, "chorusStart", 45, 200)).toMatchObject({ chorusStart: 45, chorusLength: 25 });
    expect(moveHandle(clip, "chorusStart", 69, 200)).toMatchObject({ chorusStart: 67, chorusLength: 3 });
    expect(moveHandle(clip, "chorusStart", -5, 200)).toMatchObject({ chorusStart: 0, chorusLength: 70 });
    // Сохраняется любая длина, старые 5/10/15 читаются как раньше.
    expect(parseClip({ chorusStart: 30, chorusLength: 27 }).chorusLength).toBe(27);
    expect(parseClip({ chorusStart: 30, chorusLength: 15 }).chorusLength).toBe(15);
    expect(parseClip({ chorusStart: 30, chorusLength: 1 }).chorusLength).toBe(3);
  });
});

describe("поле «С секунды» и короткий трек (QA 22 октября 2026)", () => {
  const base = parseClip({ start: 0, length: 15, chorusStart: 100, chorusLength: 10 });
  it("«С секунды» сдвигает весь фрагмент, длина та же", () => {
    expect(moveHandle(base, "guess", 45, 200)).toMatchObject({ start: 45, length: 15 });
    expect(moveHandle(base, "guess", 195, 200)).toMatchObject({ start: 185, length: 15 });
  });
  it("начало за концом трека — длина не уходит в минус", () => {
    const far = { ...base, start: 100 };
    const r = moveHandle(far, "end", 110, 60);
    expect(r.length).toBeGreaterThanOrEqual(3);
    expect(r.start + r.length).toBeLessThanOrEqual(60);
    const ch = moveHandle(base, "chorusEnd", 120, 60);
    expect(ch.chorusLength).toBeGreaterThanOrEqual(3);
    expect((ch.chorusStart ?? 0) + ch.chorusLength).toBeLessThanOrEqual(60);
  });
});

