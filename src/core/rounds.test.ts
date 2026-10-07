import { describe, expect, it } from "vitest";
import { bestInRound, moveLabel, placeMoves, roundLeaderboard, roundScore, startRoundEntries } from "./rounds";

const p = (name: string, score: number, roundBase?: number) => ({ name, kind: "player" as const, score, ...(roundBase === undefined ? {} : { roundBase }) });

describe("раунды и табло", () => {
  it("очки раунда — с начала раунда; новый раунд запоминает очки", () => {
    const board = { a: p("Аня", 300, 100), b: p("Боря", 50) };
    expect(roundScore(board.a)).toBe(200);
    expect(roundLeaderboard(board).a?.score).toBe(200);
    expect(startRoundEntries(board)).toEqual({ a: p("Аня", 300, 300), b: p("Боря", 50, 50) });
    expect(startRoundEntries({ c: p("Вика", 0) })).toEqual({});
  });

  it("стрелки по местам до и после", () => {
    const before = { a: p("Аня", 30), b: p("Боря", 20), c: p("Вика", 10) };
    const after = { a: p("Аня", 30), b: p("Боря", 20), c: p("Вика", 40), d: p("Гоша", 5) };
    const moves = placeMoves(before, after);
    expect(Object.fromEntries(moves)).toEqual({ c: 2, a: -1, b: -1, d: 0 });
    expect(moveLabel(2)).toBe("↑2");
    expect(moveLabel(-1)).toBe("↓1");
    expect(moveLabel(0)).toBe("");
    expect(moveLabel(undefined)).toBe("");
  });

  it("лучший в раунде — по очкам раунда, при равенстве все; без очков — никто", () => {
    expect([...bestInRound({ a: p("Аня", 300, 250), b: p("Боря", 100, 0), c: p("Вика", 100) })].sort()).toEqual(["b", "c"]);
    expect(bestInRound({ a: p("Аня", 100, 100) }).size).toBe(0);
  });
});
