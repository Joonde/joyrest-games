import { describe, expect, it } from "vitest";
import { ART_H, ART_W, FIELDS, placeCells } from "./paths";

describe("дорожки нарисованных полей", () => {
  it("клетки 40–100 встают на дорожку: первая — у старта, последняя — у финиша, все внутри картинки", () => {
    for (const field of Object.values(FIELDS)) {
      const pts = field.path.filter((p): p is { x: number; y: number } => p !== null);
      for (const n of [41, 70, 101]) {
        const cells = placeCells(field.path, n);
        expect(cells).toHaveLength(n);
        expect(cells[0]).toEqual(pts[0]);
        const last = cells.at(-1);
        const end = pts.at(-1);
        expect(Math.abs((last?.x ?? 0) - (end?.x ?? 0))).toBeLessThan(0.5);
        for (const c of cells) {
          expect(c.x).toBeGreaterThanOrEqual(0);
          expect(c.x).toBeLessThanOrEqual(ART_W);
          expect(c.y).toBeGreaterThanOrEqual(0);
          expect(c.y).toBeLessThanOrEqual(ART_H);
        }
      }
    }
  });

  it("на каждом поле дорожка проходит по всем нарисованным камням (не меньше 30 точек) и у полосы есть цвет", () => {
    for (const field of Object.values(FIELDS)) {
      expect(field.path.filter((p) => p !== null).length).toBeGreaterThanOrEqual(30);
      expect(field.lane.width).toBeGreaterThanOrEqual(60);
      expect(field.lane.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(field.lane.edge).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("по разрыву (мосту) клетки не ставятся", () => {
    const cells = placeCells([{ x: 0, y: 0 }, { x: 100, y: 0 }, null, { x: 500, y: 0 }, { x: 600, y: 0 }], 5);
    expect(cells.map((c) => Math.round(c.x))).toEqual([0, 50, 100, 550, 600]);
  });
});
