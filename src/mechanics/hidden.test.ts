import { describe, expect, it } from "vitest";
import { HIDDEN_MECHANICS } from "./hidden";
import { allDemoGames, demoGames, demoGamesNow, finaleSlides, getMechanic, launchBlocked, selectableMechanics, selectableNow } from "./registry";

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
  it("уже добавленный «Бубликатор» без комнат не запускается: карточка и запуск — «только на своём сервере» (проверка 2d, №5)", () => {
    expect(launchBlocked("bublikator", false)).toBe("Эта игра работает только на своём сервере JoyRest");
    expect(launchBlocked("bublikator", true)).toBeNull();
    expect(launchBlocked("quiz", false)).toBeNull();
    expect(launchBlocked(null, false)).toBeNull();
    // Остальные игры без комнат запускаются как раньше.
    expect(selectableMechanics.filter((m) => launchBlocked(m.id, false) !== null).map((m) => m.id)).toEqual(["bublikator"]);
  });
});

describe("общий финал после игры у самостоятельных игр (решение владельца 13 ноября 2026)", () => {
  it("«Бубликатор» — с общими делами гостя и «Спасибо» с QR; «Олимп» — свой финал целиком", () => {
    expect(getMechanic("bublikator")?.standalone?.finale).toBe(true);
    expect(getMechanic("olymp")?.standalone?.finale).toBeFalsy();
  });
  it("«Спасибо» после игры: пульт ставит и показывает кнопку, только если экран его нарисует (проверка 2d, №11)", () => {
    expect(finaleSlides("bublikator")).toBe(true);
    expect(finaleSlides("olymp")).toBe(false);
    expect(finaleSlides("quiz")).toBe(true);
    expect(finaleSlides(null)).toBe(true);
    // Самостоятельные игры без общего финала — только «Олимп».
    expect(selectableMechanics.filter((m) => !finaleSlides(m.id)).map((m) => m.id)).toEqual(["olymp"]);
  });
});
