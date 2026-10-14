import { describe, expect, it } from "vitest";
import { HIDDEN_MECHANICS } from "./hidden";
import { allDemoGames, demoGames, getMechanic, selectableMechanics } from "./registry";

describe("скрытые форматы («Держи пари», «Винное казино» — решение владельца 14 октября 2026)", () => {
  it("зарегистрированы, но их нет в выборе формата и в шаблонах библиотеки", () => {
    for (const id of HIDDEN_MECHANICS) {
      expect(getMechanic(id), id).toBeTruthy();
      expect(selectableMechanics.some((m) => m.id === id), id).toBe(false);
      expect(demoGames.some((d) => d.mechanic === id), id).toBe(false);
      expect(allDemoGames.some((d) => d.mechanic === id), id).toBe(true);
    }
  });
});
