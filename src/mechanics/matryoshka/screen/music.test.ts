import { describe, expect, it } from "vitest";
import { chantNotes, danceNotes, DECOY_GAP_MS, heartNotes, ropeNotes, type Note } from "./music";

function valid(notes: Note[]): void {
  const ids = new Set<string>();
  for (const n of notes) {
    expect(Number.isFinite(n.t)).toBe(true);
    expect(n.dur).toBeGreaterThan(0);
    expect(n.dur).toBeLessThanOrEqual(2);
    expect(n.gain).toBeGreaterThan(0);
    expect(n.gain).toBeLessThanOrEqual(1);
    expect(ids.has(n.id)).toBe(false);
    ids.add(n.id);
    for (const f of n.freq) {
      expect(Number.isFinite(f)).toBe(true);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(8000);
    }
  }
}

describe("Матрёшка: объективная проверка музыки", () => {
  it("песенка: ноты конечны, уникальны, акцент ровно в T; обманка без нот", () => {
    const p = { start: 1000, at: 5000, end: 7000, decoy: null, window: 5550, head: 4600 };
    const notes = chantNotes(p);
    valid(notes);
    expect(notes.some((n) => n.voice === "accent" && n.t === p.at)).toBe(true);
    const quiet = chantNotes({ ...p, decoy: 3000 });
    valid(quiet);
    expect(quiet.some((n) => n.t >= 3000 && n.t < 3000 + DECOY_GAP_MS)).toBe(false);
  });

  it("плясовая обрывается в stop, на обманке молчит; сердце и канат не выходят за свои окна", () => {
    const dance = danceNotes(0, 10_000, 0, 5000, 2000);
    valid(dance);
    expect(dance.every((n) => n.t < 5000)).toBe(true);
    expect(dance.some((n) => n.t >= 2000 && n.t < 2600)).toBe(false);
    const heart = heartNotes({ start: 0, at: 1000, end: 4000, decoy: null, window: 1550, head: 600 });
    valid(heart);
    expect(heart.every((n) => n.t > 1000 && n.t < 4000)).toBe(true);
    const rope = ropeNotes(0, 6000, 0, 5000);
    valid(rope);
    expect(rope.every((n) => n.t < 5000)).toBe(true);
  });
});
