import { describe, expect, it } from "vitest";
import { categoryOf, groupByCategory } from "./categories";
import { demoGames, mechanics } from "./registry";

describe("категории библиотеки", () => {
  it("квиз с треками — музыкальный, без треков — квиз", () => {
    expect(categoryOf({ mechanic: "quiz", content: { questions: [{ kind: "choice", text: "?" }] } })).toBe("quiz");
    expect(categoryOf({ mechanic: "quiz", content: { questions: [{ kind: "open", text: "?", trackId: "t1" }] } })).toBe("music");
    expect(categoryOf({ mechanic: "quiz", content: { questions: [] }, title: "Угадай мелодию: 90-е" })).toBe("music");
    expect(categoryOf({ mechanic: "unknown", content: null })).toBe("other");
  });

  it("у каждой механики свой раздел, не «Другие»", () => {
    for (const m of mechanics) expect(categoryOf({ mechanic: m.id, content: null }), m.id).not.toBe("other");
  });

  it("шаблоны раскладываются по разделам, порядок разделов постоянный", () => {
    const groups = groupByCategory(demoGames);
    expect(groups.map((g) => g.category.id)).toEqual(["quiz", "music", "tv", "adventure", "cards", "social", "active"]);
    expect(groups.reduce((n, g) => n + g.games.length, 0)).toBe(demoGames.length);
    expect(groups.find((g) => g.category.id === "music")?.games.map((g) => g.mechanic).sort()).toEqual(["lotto", "quiz"]);
  });
});
