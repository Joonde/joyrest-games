// Фигуры «Пряника» (docs/matryoshka.md, «Пряник», L10): равная длина контура, в поле, 200 кусочков, ближайший кусочек,
// трещина через 0,2 с вне полосы, промежуточные точки при быстром движении.
import { describe, expect, it } from "vitest";
import { BAND_ADULTS, BAND_KIDS, CRACK_OUT_MS, PIECES, SHAPE_LENGTH, SHAPE_LENGTH_TOLERANCE, SHAPE_MARGIN } from "./constants";
import { SHAPE_IDS } from "./content";
import { contourLength, nearestPiece, newTrace, segmentDistance, shapeOf, traceLift, traceTouch, type Point } from "./shapes";

describe("фигуры «Пряника»", () => {
  it("7 фигур, у всех одинаковая длина контура (±2%), 200 кусочков, целиком в поле с отступом", () => {
    expect(SHAPE_IDS.length).toBe(7);
    for (const id of SHAPE_IDS) {
      const s = shapeOf(id);
      expect(s.points.length, id).toBe(PIECES);
      const len = contourLength(s.points);
      expect(Math.abs(len - SHAPE_LENGTH) / SHAPE_LENGTH, id).toBeLessThanOrEqual(SHAPE_LENGTH_TOLERANCE);
      for (const [x, y] of s.points) {
        expect(x, id).toBeGreaterThanOrEqual(SHAPE_MARGIN);
        expect(x, id).toBeLessThanOrEqual(1 - SHAPE_MARGIN);
        expect(y, id).toBeGreaterThanOrEqual(SHAPE_MARGIN);
        expect(y, id).toBeLessThanOrEqual(1 - SHAPE_MARGIN);
      }
    }
  });

  it("кусочки почти равной длины: ни один не длиннее среднего больше чем вдвое (полосы и время честные)", () => {
    for (const id of SHAPE_IDS) {
      const pts = shapeOf(id).points;
      const mean = SHAPE_LENGTH / PIECES;
      for (let i = 0; i < pts.length; i += 1) {
        const a = pts[i] as Point;
        const b = pts[(i + 1) % pts.length] as Point;
        expect(Math.hypot(a[0] - b[0], a[1] - b[1]), `${id} ${i}`).toBeLessThanOrEqual(mean * 2);
      }
    }
  });

  it("сложность и названия: круг 1, звезда 2, ёлочка 3, матрёшка 4, зонтик 3", () => {
    expect(shapeOf("circle").difficulty).toBe(1);
    expect(shapeOf("star").difficulty).toBe(2);
    expect(shapeOf("tree").difficulty).toBe(3);
    expect(shapeOf("matryoshka").difficulty).toBe(4);
    expect(shapeOf("umbrella").difficulty).toBe(3);
    expect(shapeOf("umbrella").title).toBe("Зонтик");
  });

  it("обвёл весь контур пальцем — все 200 кусочков, пряник целый, время записано", () => {
    for (const id of SHAPE_IDS) {
      const s = shapeOf(id);
      const st = newTrace();
      s.points.forEach((p, i) => traceTouch(s, st, p, i * 50, BAND_ADULTS));
      traceTouch(s, st, s.points[0] as Point, PIECES * 50, BAND_ADULTS);
      expect(st.count, id).toBe(PIECES);
      expect(st.doneAt, id).not.toBeNull();
      expect(st.cracked, id).toBe(false);
    }
  });

  it("одно касание засчитывает не больше одного кусочка — ближайший (внутренние углы звезды и ёлочки, L10)", () => {
    for (const id of ["star", "tree", "umbrella", "house"] as const) {
      const s = shapeOf(id);
      for (let i = 0; i < 200; i += 7) {
        const st = newTrace();
        const a = s.points[i] as Point;
        // Точка чуть внутрь от вершины — в полосе соседних рёбер.
        const p: Point = [a[0] + (0.5 - a[0]) * 0.05, a[1] + (0.5 - a[1]) * 0.05];
        traceTouch(s, st, p, 0, BAND_KIDS);
        expect(st.count, `${id} ${i}`).toBeLessThanOrEqual(1);
        if (st.count === 1) {
          const covered = st.covered.indexOf(true);
          expect(covered).toBe(nearestPiece(s, p).piece);
        }
      }
    }
  });

  it("палец вне полосы дольше 0,2 с — трещина; меньше — нет; поднял палец — время вне полосы не копится", () => {
    const s = shapeOf("circle");
    const out: Point = [0.5, 0.5];
    const st = newTrace();
    traceTouch(s, st, out, 0, BAND_ADULTS);
    traceTouch(s, st, out, CRACK_OUT_MS, BAND_ADULTS);
    expect(st.cracked).toBe(false);
    traceTouch(s, st, out, CRACK_OUT_MS + 1, BAND_ADULTS);
    expect(st.cracked).toBe(true);
    expect(st.crackedAt).toBe(CRACK_OUT_MS + 1);
    // После трещины касания ничего не меняют.
    const before = st.count;
    traceTouch(s, st, s.points[3] as Point, 500, BAND_ADULTS);
    expect(st.count).toBe(before);
    const st2 = newTrace();
    traceTouch(s, st2, out, 0, BAND_ADULTS);
    traceLift(st2);
    traceTouch(s, st2, out, 150, BAND_ADULTS);
    traceTouch(s, st2, out, 300, BAND_ADULTS);
    expect(st2.cracked).toBe(false);
  });

  it("быстрое движение по контуру не пропускает кусочки (промежуточные точки), полоса у детей шире", () => {
    const s = shapeOf("circle");
    const st = newTrace();
    for (let i = 0; i <= 200; i += 4) traceTouch(s, st, s.points[i % 200] as Point, i, BAND_ADULTS);
    expect(st.count).toBe(PIECES);
    // Точка на расстоянии 4,5% от контура: у взрослых (3%) — вне полосы, у детей (6%) — внутри.
    const a = s.points[0] as Point;
    const dx = a[0] - 0.5;
    const dy = a[1] - 0.5;
    const len = Math.hypot(dx, dy);
    const p: Point = [a[0] + (dx / len) * 0.045, a[1] + (dy / len) * 0.045];
    expect(segmentDistance(p, a, s.points[1] as Point)).toBeGreaterThan(BAND_ADULTS);
    const adult = traceTouch(s, newTrace(), p, 0, BAND_ADULTS);
    const kid = traceTouch(s, newTrace(), p, 0, BAND_KIDS);
    expect(adult.count).toBe(0);
    expect(kid.count).toBe(1);
  });
});
