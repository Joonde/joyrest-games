import { describe, expect, it } from "vitest";
import { inRatingGroup, ratingGroupOf } from "./reviewRating";

describe("отзывы по оценке", () => {
  it("5 — отличные, 4 — хорошие, 3 — средние, 1–2 — плохие", () => {
    expect([5, 4, 3, 2, 1].map(ratingGroupOf)).toEqual(["excellent", "good", "average", "bad", "bad"]);
  });
  it("«Любая оценка» пропускает всё", () => {
    expect([1, 3, 5].every((r) => inRatingGroup(r, "all"))).toBe(true);
    expect(inRatingGroup(2, "bad")).toBe(true);
    expect(inRatingGroup(4, "excellent")).toBe(false);
  });
});
