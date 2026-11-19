import { describe, expect, it } from "vitest";
import { activeCount, autoCounts, countsFor, createMafia, familyCount, type RoleCounts, type RoleId } from "./content";
import { isMafia, parseMafiaResult, resolveNight, whispers } from "./logic";

const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
const roles: Record<string, RoleId> = { a: "don", b: "mafia", c: "commissar", d: "doctor", e: "courtesan", f: "maniac", g: "advocate", h: "civilian" };
const base = { a: "h", b: "h", g: "h", c: "g", d: "h", f: "c", h: "a" };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("QA-матрица: составы", () => {
  it("все автоматические составы 5–30 соблюдают лимиты семьи и мест", () => {
    for (let n = 5; n <= 30; n++) {
      const c = autoCounts(n);
      expect(activeCount(c), `места, n=${n}`).toBeLessThanOrEqual(n);
      expect(familyCount(c), `семья, n=${n}`).toBeLessThan(n / 2);
      expect(c.mafia, `обычная мафия, n=${n}`).toBeGreaterThanOrEqual(0);
      expect(c.courtesan).toBe(n >= 10 ? 1 : 0);
      expect(c.maniac).toBe(n >= 12 ? 1 : 0);
      expect(c.advocate).toBe(n >= 14 ? 1 : 0);
    }
  });

  it("крайние ручные составы нормализуются без циклов и отрицательных ролей", () => {
    const extreme: RoleCounts = { mafia: 10, don: 1, advocate: 1, commissar: 1, doctor: 1, courtesan: 1, maniac: 1 };
    for (let n = 5; n <= 30; n++) {
      const c = countsFor({ ...createMafia(), roles: "custom", counts: extreme }, n);
      expect(activeCount(c), `места, n=${n}`).toBeLessThanOrEqual(n);
      expect(familyCount(c), `семья, n=${n}`).toBeLessThan(n / 2);
      expect(familyCount(c), `семья не пуста, n=${n}`).toBeGreaterThanOrEqual(1);
      for (const value of Object.values(c)) expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("QA-матрица: все цели Красотки", () => {
  it("каждая роль обрабатывается по своему правилу, жертвы уникальны и находятся среди живых", () => {
    for (const target of [...ids, "ghost", ""]) {
      const outcome = resolveNight(roles, ids, { ...base, e: target }, [], "c", "g");
      expect(new Set(outcome.victims).size).toBe(outcome.victims.length);
      for (const victim of outcome.victims) expect(ids).toContain(victim);
      if (target === "e" || target === "ghost" || target === "") {
        expect(outcome.courtesanTarget).toBeNull();
        expect(outcome.familyBlocked).toBe(false);
      } else {
        expect(outcome.courtesanTarget).toBe(target);
        expect(outcome.familyBlocked).toBe(isMafia(roles[target]));
      }
      if (target === "f") expect(outcome.maniacTarget).toBeNull();
      if (target === "d") expect(outcome.healed).toBeNull();
      if (target === "c") expect(outcome.comCheck).toBeNull();
      if (target === "a") expect(outcome.donCheck).toBeNull();
      if (target === "g") expect(outcome.advocateProtect).toBeNull();
    }
  });

  it("Комиссар получает верный ответ для каждой роли, Маньяк не считается мафией", () => {
    for (const target of ids.filter((p) => p !== "c")) {
      const outcome = resolveNight(roles, ids, { ...base, c: target, e: "h" }, []);
      expect(outcome.comCheck).toEqual({ target, yes: isMafia(roles[target]) });
    }
  });

  it("Адвокат скрывает каждого члена семьи, но не мирного или Маньяка", () => {
    for (const target of ["a", "b", "g"]) {
      const outcome = resolveNight(roles, ids, { ...base, c: target, e: "h" }, [], null, target);
      expect(outcome.advocateProtect).toBe(target);
      expect(outcome.comCheck).toEqual({ target, yes: false });
    }
    for (const target of ["c", "d", "e", "f", "h"]) {
      const outcome = resolveNight(roles, ids, { ...base, c: target, e: "h" }, [], null, target);
      expect(outcome.advocateProtect).toBeNull();
      if (target === "c") expect(outcome.comCheck).toBeNull(); // Комиссар не проверяет сам себя.
      else expect(outcome.comCheck?.yes).toBe(false);
    }
  });

  it("все сочетания двух выстрелов и лечения дают ожидаемый набор смертей", () => {
    const expected = new Map<string, string[]>([
      ["none:none", []],
      ["h:none", ["h"]],
      ["none:c", ["c"]],
      ["h:c", ["h", "c"]],
      ["h:h", ["h"]],
    ]);
    for (const mafiaVictim of ["h", "c"] as const) {
      for (const maniacVictim of ["h", "c"] as const) {
        for (const healed of [null, "h", "c"] as const) {
          const choices = { a: mafiaVictim, b: mafiaVictim, g: mafiaVictim, f: maniacVictim, ...(healed ? { d: healed } : {}) };
          const outcome = resolveNight(roles, ids, choices, []);
          const raw = [...new Set([mafiaVictim, maniacVictim])].filter((p) => p !== healed);
          expect(outcome.victims, `мафия=${mafiaVictim}, маньяк=${maniacVictim}, лечение=${healed}`).toEqual(raw);
        }
      }
    }
    expect(expected.size).toBe(5);
  });
});

describe("QA-матрица: случайные и повреждённые данные", () => {
  it("1000 ночей с неправильными целями сохраняют инварианты и не мутируют вход", () => {
    const random = mulberry32(20261118);
    const pool = [...ids, "ghost", "", null];
    const pick = () => pool[Math.floor(random() * pool.length)] as string | null;
    for (let i = 0; i < 1000; i++) {
      const choices = Object.fromEntries(ids.map((pid) => [pid, pick()]));
      const snapshot = JSON.stringify(choices);
      const donCheck = pick();
      const protect = pick();
      const outcome = resolveNight(roles, ids, choices, [], donCheck, protect, i % 2 ? ["a"] : []);
      expect(JSON.stringify(choices)).toBe(snapshot);
      expect(new Set(outcome.victims).size).toBe(outcome.victims.length);
      for (const victim of outcome.victims) expect(ids).toContain(victim);
      if (outcome.mafiaTarget) {
        expect(ids).toContain(outcome.mafiaTarget);
        expect(isMafia(roles[outcome.mafiaTarget])).toBe(false);
      }
      if (outcome.maniacTarget) {
        expect(ids).toContain(outcome.maniacTarget);
        expect(outcome.maniacTarget).not.toBe("f");
      }
      if (outcome.advocateProtect) expect(isMafia(roles[outcome.advocateProtect])).toBe(true);
      const hints = whispers(roles, ids, choices, { a: donCheck, g: protect }, [], [], outcome);
      expect(hints.c?.check).toEqual(outcome.comCheck);
      expect(hints.a?.check).toEqual(outcome.donCheck);
    }
  });

  it("парсер переживает мусор без исключений и сохраняет безопасные значения по умолчанию", () => {
    const garbage = [null, 0, "night", true, [], { killed: {} }, { killed: [1, "a", null, "b"] }, { alive: "all" }, { deaths: [null, {}, { pid: 4 }] }, { winner: "alien" }];
    for (const raw of garbage) expect(() => parseMafiaResult(raw)).not.toThrow();
    expect(parseMafiaResult({ killed: [1, "a", null, "b"] }).killed).toEqual(["a", "b"]);
    expect(parseMafiaResult({ killed: {} }).killed).toEqual([]);
    expect(parseMafiaResult({ winner: "alien" }).winner).toBeNull();
  });
});
