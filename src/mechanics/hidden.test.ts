import { describe, expect, it } from "vitest";
import { HIDDEN_MECHANICS } from "./hidden";
import { allDemoGames, demoGames, demoGamesNow, getMechanic, selectableMechanics, selectableNow } from "./registry";

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

describe("игры в игровой комнате без своего сервера (аудит 2d, №12)", () => {
  it("на своём сервере «Бубликатор» в выборе и в шаблонах; без комнат (Firebase) — нет, остальные форматы на месте", () => {
    expect(getMechanic("bublikator")?.room).toBe(true);
    expect(selectableNow({ rooms: true, program: true }).some((m) => m.id === "bublikator")).toBe(true);
    expect(demoGamesNow(true).some((d) => d.mechanic === "bublikator")).toBe(true);
    const firebase = selectableNow({ rooms: false, program: false });
    expect(firebase.some((m) => m.id === "bublikator")).toBe(false);
    expect(firebase.some((m) => m.id === "evening")).toBe(false);
    expect(firebase.some((m) => m.id === "quiz")).toBe(true);
    expect(demoGamesNow(false).some((d) => d.mechanic === "bublikator")).toBe(false);
    expect(demoGamesNow(false).length).toBe(demoGames.filter((d) => d.mechanic !== "bublikator").length);
    // Игры в комнате — только с флагом `room` (сейчас одна).
    expect(selectableMechanics.filter((m) => getMechanic(m.id)?.room).map((m) => m.id)).toEqual(["bublikator"]);
  });
});
