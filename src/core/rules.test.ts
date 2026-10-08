import { describe, expect, it } from "vitest";
import { SLIDE_LIMITS } from "../data/cues";
import { rulesFor } from "./rules";

describe("правила для слайда", () => {
  it("у каждого формата свои правила, влезают в слайд", () => {
    for (const id of ["quiz", "lotto", "board", "checkers", "dance", "quest"]) {
      for (const mode of ["solo", "teams"] as const) {
        const r = rulesFor(id, mode);
        expect(r.title).not.toBe("Правила игры");
        expect(r.lines.length).toBeGreaterThan(2);
        expect(r.lines.length).toBeLessThanOrEqual(8);
        expect(r.title.length).toBeLessThanOrEqual(SLIDE_LIMITS.title);
        for (const line of r.lines) expect(line.length).toBeLessThanOrEqual(SLIDE_LIMITS.line);
      }
    }
    expect(rulesFor("quiz", "teams").lines[0]).toContain("капитан");
    expect(rulesFor(null, "solo").title).toBe("Правила игры");
  });
});
