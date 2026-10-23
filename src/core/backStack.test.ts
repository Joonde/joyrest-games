import { describe, expect, it } from "vitest";
import { beforeChange, makeBefore, parseBefore } from "./backStack";

describe("снимок прошлого этапа для «Назад» с заставки", () => {
  it("цепочка не глубже заданной и не больше лимита по размеру", () => {
    let result: Record<string, unknown> = { n: 0, before: null };
    for (let i = 1; i <= 10; i++) result = { n: i, before: makeBefore("reveal", result, 0, 3) };
    const depth = (raw: unknown): number => {
      const b = parseBefore(raw);
      return b ? 1 + depth(b.result.before) : 0;
    };
    expect(depth(result.before)).toBe(3);
    expect(parseBefore(result.before)?.result.n).toBe(9);
    // Большие итоги — цепочка короче, но прошлый этап есть всегда.
    const big = { pad: "x".repeat(5000), before: makeBefore("reveal", { pad: "y".repeat(5000), before: makeBefore("reveal", { pad: "z".repeat(5000) }) }) };
    const snap = makeBefore("reveal", big, 0, 5, 8000);
    expect(snap.result.pad).toBe(big.pad);
    expect(snap.result.before).toBeNull();
  });

  it("битые данные — null; «Назад» возвращает этап, шаг − 1, без отсчёта", () => {
    expect(parseBefore(null)).toBeNull();
    expect(parseBefore({ stage: "podium", result: {} })).toBeNull();
    expect(parseBefore({ stage: "reveal", result: [] })).toBeNull();
    const b = parseBefore({ stage: "reveal", result: { a: 1 }, answered: 3 });
    expect(b && beforeChange(7, b)).toEqual({ state: { step: 6, stage: "reveal", revealed: true, startedAt: null, timeLimit: null, answered: 3, result: { a: 1 } } });
  });
});
