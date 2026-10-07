import { describe, expect, it } from "vitest";
import { parsePeek, parseTeams } from "./cues";

describe("команды и таблица поверх игры: данные с сервера проверяются", () => {
  it("скрытые названия, представление, телефоны команд", () => {
    expect(parseTeams({ hidden: true, shown: 2, sizes: { a: 3, "плохой id": 2, c: -1, z: 4.5 } })).toEqual({ hidden: true, shown: 2, sizes: { a: 3 } });
    expect(parseTeams({ hidden: "да", shown: -1 })).toEqual({ hidden: false, shown: null });
    expect(parseTeams("x")).toBeNull();
  });

  it("таблица поверх игры — только известные виды", () => {
    expect(parsePeek("round")).toBe("round");
    expect(parsePeek("total")).toBe("total");
    expect(parsePeek("всё")).toBeNull();
  });
});
