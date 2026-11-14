// Фигуры «Пряника» (docs/matryoshka.md, «Пряник», L10): равная длина контура, в поле, 200 кусочков, ближайший кусочек,
// трещина через 0,2 с вне полосы, промежуточные точки при быстром движении.
import { describe, expect, it } from "vitest";
import { BAND_ADULTS, BAND_KIDS, CRACK_FAR, CRACK_OUT_MS, CRACK_WINDOW_OUT_MS, PIECES, SHAPE_LENGTH, SHAPE_LENGTH_TOLERANCE, SHAPE_MARGIN } from "./constants";
import { SHAPE_IDS } from "./content";
import { contourLength, nearestPiece, newTrace, segmentDistance, shapeOf, traceLift, traceTouch, type Point, type Shape, type Trace } from "./shapes";

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
    // Вне полосы, но не дальше трёх полос (дальше — трещина сразу, отдельный тест).
    const a0 = s.points[0] as Point;
    const out: Point = [a0[0] + (a0[0] - 0.5) * (2 * BAND_ADULTS) / Math.hypot(a0[0] - 0.5, a0[1] - 0.5), a0[1] + (a0[1] - 0.5) * (2 * BAND_ADULTS) / Math.hypot(a0[0] - 0.5, a0[1] - 0.5)];
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

  it("дальше трёх полос от контура — трещина сразу, даже на миг (так «режут» поперёк)", () => {
    const s = shapeOf("circle");
    const st = newTrace();
    traceTouch(s, st, s.points[0] as Point, 0, BAND_KIDS);
    // Центр круга — 0,35 от контура: больше 3 × 6%.
    expect(0.35).toBeGreaterThan(CRACK_FAR * BAND_KIDS);
    traceTouch(s, st, [0.5, 0.5], 16, BAND_KIDS);
    expect(st.cracked).toBe(true);
    expect(st.crackedAt).toBe(16);
  });

  it("короткие выходы за полосу складываются: больше 0,3 с за секунду — трещина", () => {
    const s = shapeOf("circle");
    const a = s.points[0] as Point;
    const n = Math.hypot(a[0] - 0.5, a[1] - 0.5);
    const out: Point = [a[0] + ((a[0] - 0.5) / n) * 2 * BAND_KIDS, a[1] + ((a[1] - 0.5) / n) * 2 * BAND_KIDS];
    const st = newTrace();
    // Каждые 250 мс: 140 мс вне полосы, остальное в полосе — подряд вне полосы не больше 0,2 с.
    let t = 0;
    for (let k = 0; k < 6 && !st.cracked; k += 1) {
      traceTouch(s, st, a, t, BAND_KIDS);
      traceTouch(s, st, out, t + 10, BAND_KIDS);
      traceTouch(s, st, out, t + 150, BAND_KIDS);
      traceTouch(s, st, a, t + 160, BAND_KIDS);
      t += 250;
    }
    expect(st.cracked).toBe(true);
    expect(CRACK_WINDOW_OUT_MS).toBe(300);
  });

  /** Ведёт палец по контуру: круг за `ms`, `laps` кругов; `wobble(t)` — сдвиг поперёк контура (доли поля), касание раз в 16 мс. */
  function drive(shape: Shape, band: number, ms: number, wobble: (t: number) => number, laps = 1): Trace {
    const st = newTrace();
    const pts = shape.points;
    for (let t = 0; t <= ms * laps && !st.cracked && st.doneAt === null; t += 16) {
      const u = (t / ms) * pts.length;
      const i = Math.floor(u) % pts.length;
      const a = pts[i] as Point;
      const b = pts[(i + 1) % pts.length] as Point;
      const f = u - Math.floor(u);
      const x = a[0] + (b[0] - a[0]) * f;
      const y = a[1] + (b[1] - a[1]) * f;
      const nx = -(b[1] - a[1]);
      const ny = b[0] - a[0];
      const nl = Math.hypot(nx, ny) || 1;
      const w = wobble(t);
      traceTouch(shape, st, [x + (nx / nl) * w, y + (ny / nl) * w], t, band);
    }
    return st;
  }

  it("быстрый зигзаг поперёк контура (±2 полосы … ±30% поля, 1–10 раз в секунду, три круга) не даёт целого пряника", () => {
    // Уже двух полос — это дрожание у линии (его прощаем): на ёлочке и звезде такой палец всё время у какого-то края.
    for (const id of SHAPE_IDS) {
      const shape = shapeOf(id);
      for (const band of [BAND_ADULTS, BAND_KIDS]) {
        for (const amp of [2 * band, 2.5 * band, 2.9 * band, 0.1, 0.2, 0.3].filter((x) => x >= 2 * band)) {
          for (const hz of [1, 2, 4, 6, 10]) {
            const st = drive(shape, band, 40_000, (t) => amp * Math.sin((2 * Math.PI * hz * t) / 1000), 3);
            const what = `${id} полоса ${band} ±${amp.toFixed(3)} ${hz} Гц: ${st.count} кусочков`;
            expect(st.doneAt, what).toBeNull();
            // Дальше трёх полос — трещина сразу (±10–30% поля, как в находке аудита).
            if (amp > CRACK_FAR * band) expect(st.cracked, what).toBe(true);
          }
        }
      }
    }
  });

  it("честная обводка с дрожанием у линии и редкими срывами до 0,15 с проходит без трещины (у детей полоса шире)", () => {
    for (const id of SHAPE_IDS) {
      const shape = shapeOf(id);
      for (const band of [BAND_ADULTS, BAND_KIDS]) {
        for (const ms of [15_000, 20_000, 35_000]) {
          // Дрожание ±0,6 полосы (три частоты) и раз в 4,3 с — срыв на 1,6 полосы на 0,15 с.
          const wobble = (t: number) => {
            const slip = t % 4300 > 2000 && t % 4300 < 2150 ? 1.6 * band : 0;
            return slip || band * (0.3 * Math.sin(t / 230) + 0.2 * Math.sin(t / 97 + 1) + 0.1 * Math.sin(t / 41 + 2));
          };
          // До трёх кругов: пропущенное при срыве честный игрок дообводит.
          const st = drive(shape, band, ms, wobble, 3);
          expect(st.cracked, `${id} полоса ${band} за ${ms} мс`).toBe(false);
          expect(st.doneAt, `${id} полоса ${band} за ${ms} мс`).not.toBeNull();
        }
      }
    }
  });
});
