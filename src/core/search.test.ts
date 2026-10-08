import { describe, expect, it } from "vitest";
import { matchesSearch, normalizeSearch, searchSuggestions } from "./search";

describe("поиск по спискам", () => {
  it("без регистра, ё = е, слова в любом порядке, телефон по цифрам", () => {
    expect(normalizeSearch("  Ёлки-Палки! ")).toBe("елки палки");
    expect(matchesSearch(["Ресторан «Белая веранда»", "Отрадное"], "отрадное")).toBe(true);
    expect(matchesSearch(["Белая веранда", "СЗАО"], "веранда белая")).toBe(true);
    expect(matchesSearch(["+7 (999) 123-45-67"], "999 123")).toBe(true);
    expect(matchesSearch(["+7 (999) 123-45-67"], "9991234567")).toBe(true);
    expect(matchesSearch(["Лофт"], "веранда")).toBe(false);
    expect(matchesSearch(["Лофт"], "  ")).toBe(true);
  });

  it("подсказки: без повторов, сначала с начала слова, не больше пяти", () => {
    const list = ["Отрадное", "Отрадное", "Октябрьское поле", "Новые Черёмушки", "Ботанический сад", "Отель «Космос»", "Аэропорт", "Охотный ряд", "Октябрьская", "Окская"];
    expect(searchSuggestions(list, "отр")).toEqual(["Отрадное"]);
    expect(searchSuggestions(list, "ок")).toEqual(["Окская", "Октябрьская", "Октябрьское поле"]);
    expect(searchSuggestions(list, "о").length).toBe(5);
    expect(searchSuggestions(list, "черемушки")).toEqual(["Новые Черёмушки"]);
    expect(searchSuggestions(list, "Отрадное")).toEqual([]);
    expect(searchSuggestions(list, "")).toEqual([]);
  });
});
