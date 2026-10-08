import { describe, expect, it } from "vitest";
import { applyMove, capturePoints, completeMove, count, findMove, initialBoard, isLost, legalMoves, nextTargets } from "./rules";

/** Позиция из схемы 8 строк по 8 символов. */
function board(rows: string[]): string {
  return rows.join("");
}
const sq = (r: number, c: number) => r * 8 + c;

describe("русские шашки", () => {
  it("начало: по 12 шашек, у белых 7 ходов", () => {
    const b = initialBoard();
    expect(count(b, "w")).toEqual({ men: 12, kings: 0 });
    expect(count(b, "b")).toEqual({ men: 12, kings: 0 });
    expect(legalMoves(b, "w")).toHaveLength(7);
    expect(legalMoves(b, "w").every((m) => m.captured.length === 0)).toBe(true);
  });

  it("бить обязательно, простая бьёт и назад", () => {
    const b = board([
      "........",
      "........",
      "........",
      "........",
      "..w.....",
      ".b......",
      "........",
      "w.......",
    ]);
    // Белая на (4,2) бьёт чёрную (5,1) назад на (6,0); тихий ход (7,0) недоступен.
    const moves = legalMoves(b, "w");
    expect(moves).toEqual([{ path: [sq(4, 2), sq(6, 0)], captured: [sq(5, 1)], crowned: false }]);
  });

  it("бой продолжается: двойное взятие, снимаются обе", () => {
    const b = board([
      "........",
      "........",
      "...b....",
      "........",
      ".b......",
      "w.......",
      "........",
      "........",
    ]);
    const moves = legalMoves(b, "w");
    expect(moves).toHaveLength(1);
    const m = moves[0]!;
    expect(m.path).toEqual([sq(5, 0), sq(3, 2), sq(1, 4)]);
    expect(nextTargets(b, "w", [sq(5, 0)])).toEqual([sq(3, 2)]);
    expect(completeMove(b, "w", [sq(5, 0), sq(3, 2)])).toBeNull();
    const after = applyMove(b, m);
    expect(count(after, "b").men).toBe(0);
    expect(capturePoints(b, m)).toBe(20);
    expect(isLost(after, "b")).toBe(true);
  });

  it("дошла до края — дамка, дамка ходит далеко и бьёт издалека", () => {
    const b = board([
      "........",
      "..w.....",
      "........",
      "........",
      "........",
      "........",
      "........",
      ".......b",
    ]);
    const m = findMove(b, "w", [sq(1, 2), sq(0, 1)]);
    expect(m?.crowned).toBe(true);
    const k = board([
      ".W......",
      "........",
      "........",
      "........",
      "........",
      "......b.",
      "........",
      "........",
    ]);
    const fights = legalMoves(k, "w");
    expect(fights.every((f) => f.captured[0] === sq(5, 6))).toBe(true);
    expect(fights.map((f) => f.path[1])).toEqual([sq(6, 7)]);
    expect(capturePoints(k, fights[0]!)).toBe(10);
  });

  it("чужой или неправильный ход не находится", () => {
    const b = initialBoard();
    expect(findMove(b, "w", [sq(5, 0), sq(3, 2)])).toBeNull();
    expect(findMove(b, "b", [sq(5, 0), sq(4, 1)])).toBeNull();
    expect(findMove(b, "w", [sq(5, 0), sq(4, 1)])).not.toBeNull();
  });
});
