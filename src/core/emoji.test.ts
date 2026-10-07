import { describe, expect, it } from "vitest";
import { EMOJIS, randomEmoji, splitEmoji, withEmoji } from "./emoji";
import { NAME_MAX_LENGTH } from "./names";

describe("смайлик к имени", () => {
  it("в начале имени и обратно", () => {
    expect(withEmoji("🦊", "Аня")).toBe("🦊 Аня");
    expect(withEmoji(null, "Аня")).toBe("Аня");
    expect(splitEmoji("🦊 Аня")).toEqual({ emoji: "🦊", name: "Аня" });
    expect(splitEmoji("Аня")).toEqual({ emoji: null, name: "Аня" });
  });

  it("вместе со смайликом не длиннее предела", () => {
    const long = "Очень длинное название команды".repeat(2);
    for (const emoji of EMOJIS) expect(withEmoji(emoji, long).length).toBeLessThanOrEqual(NAME_MAX_LENGTH);
  });

  it("набор — одиночные символы без модификаторов", () => {
    for (const emoji of EMOJIS) expect([...emoji].length, emoji).toBe(1);
    expect(new Set(EMOJIS).size).toBe(EMOJIS.length);
  });

  it("случайный — из набора", () => {
    expect(randomEmoji(() => 0)).toBe(EMOJIS[0]);
    expect(randomEmoji(() => 0.999)).toBe(EMOJIS[EMOJIS.length - 1]);
  });
});
