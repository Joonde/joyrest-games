import { describe, expect, it } from "vitest";
import { NOT_IN_EVENING } from "../mechanics/evening/content";
import { selectableMechanics } from "../mechanics/registry";
import { BLOCK_PREP, BLOCK_PREP_DEFAULT, blockPrepOf, blocksLabel, prepTitle, prepWarning, templateBlocks } from "./eveningPrep";
import { guideFor } from "./guide";

describe("подготовка блоков вечера", () => {
  it("у каждой игры, которую можно поставить блоком, есть памятка и текст «как объяснить гостям»", () => {
    const ids = selectableMechanics.map((m) => m.id).filter((id) => !NOT_IN_EVENING.has(id));
    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids) {
      expect(BLOCK_PREP[id], id).toBeTruthy();
      expect(guideFor(id)?.explain, id).toBeTruthy();
    }
    expect(blockPrepOf("нет-такой")).toBe(BLOCK_PREP_DEFAULT);
  });

  it("шаблоны — только игры библиотеки в личном вечере", () => {
    expect(templateBlocks("personal", ["agency", "personal", "agency", null])).toEqual([1, 3]);
    expect(templateBlocks("personal", ["personal", "personal"])).toEqual([]);
    // Вечер библиотеки и состоит из игр библиотеки — это не «недоделанные» блоки.
    expect(templateBlocks("agency", ["agency", "agency"])).toEqual([]);
  });

  it("подписи и предупреждение", () => {
    expect(blocksLabel([2])).toBe("Блок 2");
    expect(blocksLabel([1, 3])).toBe("Блоки 1 и 3");
    expect(blocksLabel([1, 2, 4])).toBe("Блоки 1, 2 и 4");
    expect(prepWarning([])).toBeNull();
    expect(prepWarning([2])).toMatch(/^Блок 2 — шаблон библиотеки/);
    expect(prepWarning([1, 3])).toMatch(/^Блоки 1 и 3 — шаблоны библиотеки/);
  });

  it("название копии не длиннее предела", () => {
    expect(prepTitle("Квиз", "Юбилей Анны", 80)).toBe("Квиз · для вечера «Юбилей Анны»");
    expect(prepTitle("Квиз", "  ", 80)).toBe("Квиз");
    const long = prepTitle("Очень длинное название квиза про всё на свете", "Корпоратив отдела продаж на крыше", 60);
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith(" · для вечера")).toBe(true);
    expect(prepTitle("Я".repeat(100), "Вечер", 60).length).toBeLessThanOrEqual(60);
  });
});
