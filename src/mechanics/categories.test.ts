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
    expect(groups.map((g) => g.category.id)).toEqual(["quiz", "music", "tv", "adventure", "olymp", "cards", "social", "active"]);
    expect(groups.reduce((n, g) => n + g.games.length, 0)).toBe(demoGames.length);
    expect(groups.find((g) => g.category.id === "music")?.games.map((g) => g.mechanic).sort()).toEqual(["lotto", "quiz"]);
  });
});

describe("«Популярные» над разделами", () => {
  it("по одной игре на слот, в порядке слотов, без караоке и музыкального квиза", async () => {
    const { popularGames } = await import("./categories");
    const g = (id: string, mechanic: string, content: unknown = {}, title = id) => ({ id, mechanic, content, title });
    const list = [
      g("board", "board"),
      g("melody", "quiz", { questions: [] }, "Угадай мелодию"),
      g("quiz", "quiz", { questions: [] }, "Квиз"),
      g("karaoke", "stage", { variant: "karaoke" }),
      g("dance", "stage", { variant: "dance" }),
      g("lotto", "lotto"),
      g("mafia", "mafia"),
      g("dragon", "dragon"),
      g("mil", "millionaire"),
      g("hundred", "hundred"),
      g("quiz2", "quiz", { questions: [] }, "Ещё квиз"),
    ];
    expect(popularGames(list).map((x) => x.id)).toEqual(["quiz", "lotto", "dragon", "dance", "mil", "board", "hundred"]);
  });

  it("нет игры формата — слот пропускается", async () => {
    const { popularGames } = await import("./categories");
    expect(popularGames([{ mechanic: "board", content: {}, title: "Своя" }]).map((x) => x.title)).toEqual(["Своя"]);
  });
});
