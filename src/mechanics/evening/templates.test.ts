import { describe, expect, it } from "vitest";
import type { AgeRating } from "../../data/types";
import { getMechanic } from "../registry";
import { NOT_IN_EVENING } from "./content";
import { fits, slotLabel, TEMPLATE_MAX_BLOCKS, TEMPLATES } from "./templates";

const game = (mechanic: string, content: unknown = {}, ageRating: AgeRating = "12+", title = "Игра") => ({ mechanic, content, ageRating, title });

describe("готовые программы вечера", () => {
  it("каждую можно запустить: известные игры, 1–5 блоков, режимы сочетаются", () => {
    const ids = new Set<string>();
    for (const t of TEMPLATES) {
      expect(ids.has(t.id), t.id).toBe(false);
      ids.add(t.id);
      expect(t.slots.length, t.title).toBeGreaterThanOrEqual(1);
      expect(t.slots.length, t.title).toBeLessThanOrEqual(TEMPLATE_MAX_BLOCKS);
      const supports = t.slots.map((s) => {
        expect(NOT_IN_EVENING.has(s.mechanic), `${t.title}: ${s.mechanic}`).toBe(false);
        const m = getMechanic(s.mechanic);
        expect(m, `${t.title}: ${s.mechanic}`).toBeDefined();
        return m!.supports;
      });
      // Как проверка при запуске (`EveningLoader`): «только каждый сам» вместе с «только команды» — отказ.
      const soloOnly = supports.some((s) => !s.teams);
      const teamsOnly = supports.some((s) => !s.solo);
      expect(soloOnly && teamsOnly, t.title).toBe(false);
      expect(supports.some((s) => s.solo) || supports.some((s) => s.teams), t.title).toBe(true);
    }
  });

  it("у каждой программы есть подсказка, как делить гостей, и она не спорит с режимами", () => {
    for (const t of TEMPLATES) {
      expect(t.setup.length, t.title).toBeGreaterThan(20);
      const supports = t.slots.map((s) => getMechanic(s.mechanic)!.supports);
      if (supports.some((s) => !s.teams)) expect(t.setup, t.title).toMatch(/^Только каждый сам/);
      if (supports.some((s) => !s.solo)) expect(t.setup, t.title).toMatch(/^Только команды/);
      if (supports.some((s) => !s.noScreen)) expect(t.setup + t.hint, t.title).toMatch(/экран/);
    }
  });

  it("нет двух одинаковых программ", () => {
    const keys = TEMPLATES.map((t) => JSON.stringify(t.slots));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("программы 11 ноября 2026 на месте", () => {
    const of = (id: string) => TEMPLATES.find((t) => t.id === id)?.slots.map((s) => s.mechanic);
    expect(of("team-battle")).toEqual(["story", "dragon", "survival", "quest"]);
    expect(of("cards")).toEqual(["durak", "perudo", "mafia"]);
    expect(of("new-year-show")).toEqual(["hundred", "board", "millionaire"]);
    expect(of("show-dance")).toEqual(["quiz", "quiz", "stage"]);
    expect(of("kids-break")).toEqual(["dragon", "aquarium", "quest"]);
    expect(of("smart")).toEqual(["quiz", "board"]);
  });

  it("пробный вечер: дракон, настолка и квиз", () => {
    const trial = TEMPLATES.find((t) => t.id === "trial");
    expect(trial?.slots.map((s) => s.mechanic)).toEqual(["dragon", "quest", "quiz"]);
    const kids = TEMPLATES.find((t) => t.id === "trial-kids");
    expect(kids?.slots.map((s) => s.mechanic)).toEqual(["dragon", "quest", "quiz"]);
  });

  it("вечер интриг — только игры «каждый сам»", () => {
    const t = TEMPLATES.find((x) => x.id === "intrigue");
    expect(t?.slots.map((s) => s.mechanic)).toEqual(["spy", "bunker", "mafia"]);
    for (const s of t?.slots ?? []) expect(getMechanic(s.mechanic)?.supports.teams).toBe(false);
  });

  it("вид поля и арены: детский дракон не попадёт во взрослую программу и наоборот", () => {
    const [dragonAdult, questAdult] = TEMPLATES.find((t) => t.id === "trial")!.slots;
    const [dragonKids, questKids, quizKids] = TEMPLATES.find((t) => t.id === "trial-kids")!.slots;
    expect(fits(game("dragon", { style: "classic" }), dragonAdult!)).toBe(true);
    expect(fits(game("dragon", {}), dragonAdult!)).toBe(true); // без поля — «Классика»
    expect(fits(game("dragon", { style: "kids" }), dragonAdult!)).toBe(false);
    expect(fits(game("dragon", { style: "kids" }), dragonKids!)).toBe(true);
    expect(fits(game("dragon", { style: "classic" }), dragonKids!)).toBe(false);
    expect(fits(game("quest", { style: "party" }), questAdult!)).toBe(true);
    expect(fits(game("quest", { style: "adult" }), questAdult!)).toBe(false);
    expect(fits(game("quest", { style: "kids" }), questAdult!)).toBe(false);
    expect(fits(game("quest", { style: "kids" }), questKids!)).toBe(true);
    expect(fits(game("quiz", {}, "0+"), quizKids!)).toBe(true);
    expect(fits(game("quiz", {}, "12+"), quizKids!)).toBe(false);
    expect(fits(game("board"), dragonAdult!)).toBe(false);
  });

  it("подсказка «Не нашлось игр» называет слот понятно", () => {
    const kids = TEMPLATES.find((t) => t.id === "trial-kids")!;
    expect(slotLabel(kids.slots[0]!)).toBe("Бой с драконом (детский)");
    expect(slotLabel({ mechanic: "mafia" })).toBe(getMechanic("mafia")?.title);
  });
});
