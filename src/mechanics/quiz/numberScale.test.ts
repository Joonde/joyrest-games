import { describe, expect, it } from "vitest";
import { SCALE_EDGE, SCALE_GAP, SCALE_ROWS, scaleLabelLimit, scaleLabels, type ScaleGuess } from "./numberScale";

function overlaps(labels: ReturnType<typeof scaleLabels>): boolean {
  return labels.some((a, i) => labels.some((b, j) => j > i && a.row === b.row && Math.abs(a.at - b.at) < SCALE_GAP - 1e-9));
}

describe("подписи на шкале «Угадай число»", () => {
  it("один ответ — подпись есть и не уходит за край", () => {
    const labels = scaleLabels([{ pid: "a", at: 0, place: 1 }]);
    expect(labels).toEqual([{ pid: "a", at: SCALE_EDGE, row: 0 }]);
  });

  it("близкие ответы расходятся по рядам, лучший — внизу", () => {
    const labels = scaleLabels([
      { pid: "b", at: 0.5, place: 2 },
      { pid: "a", at: 0.52, place: 1 },
      { pid: "c", at: 0.48, place: 3 },
    ]);
    expect(labels.map((l) => [l.pid, l.row])).toEqual([["a", 0], ["b", 1], ["c", 2]]);
    expect(overlaps(labels)).toBe(false);
  });

  it("четвёртый близкий ответ — без подписи (только точка)", () => {
    const guesses: ScaleGuess[] = [0, 1, 2, 3].map((i) => ({ pid: `p${i}`, at: 0.5 + i * 0.01, place: i + 1 }));
    expect(scaleLabels(guesses).map((l) => l.pid)).toEqual(["p0", "p1", "p2"]);
  });

  it("до 10 игроков — до 6 подписей, больше — 3", () => {
    expect(scaleLabelLimit(10)).toBe(6);
    expect(scaleLabelLimit(11)).toBe(3);
    const spread = (n: number): ScaleGuess[] => Array.from({ length: n }, (_, i) => ({ pid: `p${i}`, at: i / (n - 1), place: i + 1 }));
    expect(scaleLabels(spread(10)).length).toBeLessThanOrEqual(6);
    expect(scaleLabels(spread(40)).length).toBe(3);
  });

  it("никогда не наезжают и не выходят за ряды — случайные ответы", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let t = 0; t < 300; t++) {
      const n = 1 + Math.floor(rnd() * 40);
      const guesses = Array.from({ length: n }, (_, i) => ({ pid: `p${i}`, at: rnd(), place: 1 + Math.floor(rnd() * n) }));
      const labels = scaleLabels(guesses);
      expect(overlaps(labels)).toBe(false);
      expect(labels.every((l) => l.row >= 0 && l.row < SCALE_ROWS && l.at >= SCALE_EDGE && l.at <= 1 - SCALE_EDGE)).toBe(true);
      expect(labels.length).toBeLessThanOrEqual(scaleLabelLimit(n));
    }
  });
});
