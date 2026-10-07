import { describe, expect, it } from "vitest";
import { chunks, mediaRefs } from "./importPlan";
import type { Game } from "./types";

const game = (id: string, content: unknown): Game => ({
  id,
  scope: "personal",
  ownerId: "u1",
  title: "Квиз",
  mechanic: "quiz",
  themeId: "joyrest",
  ageRating: "0+",
  playMode: "solo",
  content,
  createdAt: null,
  updatedAt: null,
});

describe("перенос из Firebase: пачки", () => {
  it("делит по числу", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunks([], 2)).toEqual([]);
  });

  it("делит по размеру, но крупный элемент идёт один", () => {
    const big = "x".repeat(100);
    expect(chunks(["a", big, "b", "c"], 10, 50)).toEqual([["a"], [big], ["b", "c"]]);
  });
});

describe("перенос из Firebase: картинки", () => {
  it("без повторов и без падения на сломанной игре", () => {
    const ids = (_mechanic: string, content: unknown) => {
      if (content === "broken") throw new Error("parse");
      return content as string[];
    };
    const refs = mediaRefs([game("g1", ["a", "b", "a"]), game("g2", "broken"), game("g3", ["a"])], ids);
    expect(refs).toEqual([
      { game: "g1", media: "a" },
      { game: "g1", media: "b" },
      { game: "g3", media: "a" },
    ]);
  });
});
