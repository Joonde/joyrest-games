import { describe, expect, it } from "vitest";
import {
  acceptKey,
  levelProblems,
  newLevels,
  parseLevels,
  parseSuperAnswer,
  penaltyFor,
  superGroups,
  superPicks,
  superVerdicts,
  type SuperLevel,
} from "./supergame";

const levels: SuperLevel[] = [
  { points: 100, text: "Столица Франции?", answers: ["Париж"], imageId: null },
  { points: 200, text: "Самая длинная река?", answers: ["Нил", "Амазонка"], imageId: null },
  { points: 300, text: "Автор «Мастера и Маргариты»?", answers: ["Булгаков"], imageId: null },
  { points: 500, text: "Год первого полёта человека в космос?", answers: ["1961"], imageId: null },
];

describe("суперигра", () => {
  it("уровней всегда четыре, мусор — по умолчанию", () => {
    const parsed = parseLevels([{ points: 99999, text: 5 }, "x"]);
    expect(parsed).toHaveLength(4);
    expect(parsed[0]?.points).toBe(5000);
    expect(parsed[0]?.text).toBe("");
    expect(parsed[3]?.points).toBe(500);
  });

  it("правило ошибки", () => {
    expect(penaltyFor("none", 3, 500)).toBe(0);
    expect(penaltyFor("halfTop", 0, 100)).toBe(0);
    expect(penaltyFor("halfTop", 1, 200)).toBe(0);
    expect(penaltyFor("halfTop", 2, 300)).toBe(150);
    expect(penaltyFor("halfTop", 3, 500)).toBe(250);
    expect(penaltyFor("halfAll", 0, 100)).toBe(50);
    expect(penaltyFor("fullAll", 1, 200)).toBe(200);
  });

  it("ответ телефона: уровень 0–3 и текст", () => {
    expect(parseSuperAnswer({ level: 2, text: "Булгаков" })).toEqual({ level: 2, text: "Булгаков" });
    expect(parseSuperAnswer({ level: 4, text: "x" })).toBeNull();
    expect(parseSuperAnswer("Булгаков")).toBeNull();
  });

  it("верно — плюс очки уровня, ошибка — по правилу, без ответа — ничего", () => {
    const verdicts = superVerdicts(
      levels,
      "halfTop",
      [
        { pid: "a", value: { level: 0, text: "париж!" } },
        { pid: "b", value: { level: 3, text: "1962" } },
        { pid: "c", value: { level: 1, text: "Волга" } },
        { pid: "d", value: { level: 2, text: "  Булгаков " } },
        { pid: "e", value: "мусор" },
      ],
    );
    expect(verdicts.a).toMatchObject({ right: true, delta: 100 });
    expect(verdicts.b).toMatchObject({ right: false, delta: -250 });
    expect(verdicts.c).toMatchObject({ right: false, delta: 0 });
    expect(verdicts.d).toMatchObject({ right: true, delta: 300 });
    expect(verdicts.e).toBeUndefined();
  });

  it("ведущий засчитывает опечатку на своём уровне", () => {
    const answers = [{ pid: "a", value: { level: 2, text: "Булгакофф" } }];
    expect(superVerdicts(levels, "halfTop", answers).a?.delta).toBe(-150);
    expect(superVerdicts(levels, "halfTop", answers, [acceptKey(2, "Булгакофф")]).a?.delta).toBe(300);
    // Засчитано на другом уровне — не считается.
    expect(superVerdicts(levels, "halfTop", answers, [acceptKey(1, "Булгакофф")]).a?.right).toBe(false);
  });

  it("выбор уровней для экрана и группы ответов для пульта", () => {
    const answers = [
      { pid: "a", value: { level: 3, text: "1961" } },
      { pid: "b", value: { level: 3, text: "1 961" } },
      { pid: "c", value: { level: 0, text: "Лион" } },
    ];
    expect(superPicks(answers)).toEqual({ a: 3, b: 3, c: 0 });
    const groups = superGroups(levels, answers, []);
    expect(groups[3]).toEqual([{ key: acceptKey(3, "1961"), text: "1961", count: 2, status: "correct" }]);
    expect(groups[0]?.[0]?.status).toBe("wrong");
  });

  it("проверка заполнения", () => {
    expect(levelProblems(levels)).toEqual([]);
    expect(levelProblems(newLevels()).length).toBe(8);
  });
});
