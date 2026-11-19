import { describe, expect, it } from "vitest";
import { NOT_IN_EVENING } from "./content";
import { validateEvening } from "./validate";

describe("мероприятие из блоков: что нельзя ставить блоком", () => {
  it("«Бубликатор» (решение владельца 13 ноября 2026), «Олимп» и сам вечер — ошибка с понятным текстом; квиз — можно", () => {
    expect([...NOT_IN_EVENING].sort()).toEqual(["bublikator", "evening", "matryoshka", "olymp"]);
    const errors = validateEvening({ blocks: [{ gameId: "q", title: "Квиз", mechanic: "quiz" }, { gameId: "b", title: "Бубликатор", mechanic: "bublikator" }] });
    expect(errors).toEqual([{ path: "blocks/1", message: "Блок 2: «Бубликатор» нельзя поставить в вечер — проводите её отдельно." }]);
    expect(validateEvening({ blocks: [{ gameId: "q", title: "Квиз", mechanic: "quiz" }] })).toEqual([]);
  });
});
