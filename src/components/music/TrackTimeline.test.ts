import { describe, expect, it } from "vitest";
import type { Clip } from "../../core/clip";
import { playbackPoint } from "./TrackTimeline";

const clip: Clip = {
  trackId: "track",
  start: 12,
  length: 20,
  chorusStart: 60,
  chorusLength: 15,
  fadeIn: 0,
  fadeOut: 3,
  join: "cut",
  confetti: false,
};

describe("таймлайн: позиция звука при движении краёв", () => {
  it("начала перематывают к своей новой позиции", () => {
    expect(playbackPoint(clip, "start")).toBe(12);
    expect(playbackPoint(clip, "chorusStart")).toBe(60);
  });

  it("концы дают прослушать последние две секунды вместо мгновенной остановки", () => {
    expect(playbackPoint(clip, "end")).toBe(30);
    expect(playbackPoint(clip, "chorusEnd")).toBe(73);
  });

  it("короткий отрезок и отсутствие припева не дают позицию до начала или NaN", () => {
    expect(playbackPoint({ ...clip, length: 3 }, "end")).toBe(13);
    const without = { ...clip, chorusStart: null };
    expect(playbackPoint(without, "chorusStart")).toBe(0);
    expect(playbackPoint(without, "chorusEnd")).toBe(13);
  });
});
