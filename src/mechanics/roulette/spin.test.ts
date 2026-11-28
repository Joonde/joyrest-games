import { describe, expect, it } from "vitest";
import { parseRoulette, type Rarity, type RouletteContent } from "./content";
import { DEMO_ROULETTE } from "./demo";
import { answerSeed, landingAngle, pickRarity, pickTask, REVEAL_PAUSE_MS, sectorAt, seededRandom, spinOutcome, wheelRotation } from "./spin";

type T = { id: string; rarity?: Rarity; kind?: string; effect?: string; adult?: boolean; active?: boolean };

function game(themes: Record<string, T[]>, extra: Record<string, unknown> = {}): RouletteContent {
  return parseRoulette({
    themes: Object.entries(themes).map(([id, tasks]) => ({ id, name: id, tasks: tasks.map((t) => ({ title: t.id, text: "текст " + t.id, ...t })) })),
    ...extra,
  });
}

const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length] as number;
};

describe("рулетка: генератор из зерна (Р-13)", () => {
  it("одно зерно — одна последовательность, разные зёрна — разные, числа в [0, 1)", () => {
    const a = seededRandom("0_team:1700000000000");
    const b = seededRandom("0_team:1700000000000");
    const c = seededRandom("0_team:1700000000001");
    const xs = Array.from({ length: 50 }, () => a());
    expect(Array.from({ length: 50 }, () => b())).toEqual(xs);
    expect(Array.from({ length: 50 }, () => c())).not.toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(answerSeed({ id: "3_t1", submittedAt: 42 })).toBe("3_t1:42");
  });
});

describe("рулетка: редкость по весам (Р-17 п. 5)", () => {
  const grid = (weights: Record<Rarity, number>, present: Rarity[], excluded: Rarity[] = []) => {
    const counts: Record<Rarity, number> = { common: 0, rare: 0, legendary: 0 };
    let fallback = false;
    for (let i = 0; i < 1000; i++) {
      const p = pickRarity(weights, present, (i + 0.5) / 1000, excluded);
      counts[p.rarity]++;
      fallback ||= p.fallback;
    }
    return { counts, fallback };
  };
  it("60/30/10 при всех редкостях — без пересчёта", () => {
    expect(grid({ common: 60, rare: 30, legendary: 10 }, ["common", "rare", "legendary"])).toEqual({ counts: { common: 600, rare: 300, legendary: 100 }, fallback: false });
  });
  it("нет легендарных — веса пересчитываются среди оставшихся, пишется rarityFallback", () => {
    const g = grid({ common: 60, rare: 30, legendary: 10 }, ["common", "rare"]);
    expect(g.counts).toEqual({ common: 667, rare: 333, legendary: 0 });
    expect(g.fallback).toBe(true);
  });
  it("сумма весов оставшихся 0 — равновероятно", () => {
    const g = grid({ common: 0, rare: 0, legendary: 100 }, ["common", "rare"]);
    expect(g.counts).toEqual({ common: 500, rare: 500, legendary: 0 });
    expect(g.fallback).toBe(true);
  });
  it("легендарные убраны правилом «двух подряд» — это не пересчёт весов", () => {
    expect(grid({ common: 60, rare: 30, legendary: 10 }, ["common", "rare"], ["legendary"]).fallback).toBe(false);
  });
});

describe("рулетка: отбор задания (Р-17, Р-18)", () => {
  it("без повторов, пока колода темы не кончится; сброс — без только что показанного", () => {
    const content = game({ a: [{ id: "a1" }, { id: "a2" }, { id: "a3" }] });
    const theme = content.themes[0]!;
    let played: string[] = [];
    for (let i = 0; i < 3; i++) {
      const p = pickTask(content, theme, { played, extra: false, lastRarity: null }, seq(0.1, 0.99));
      expect(p).not.toBeNull();
      expect(played).not.toContain(p!.task.id);
      expect(p!.fallbacks).not.toContain("deckReset");
      played = p!.played;
    }
    expect(new Set(played).size).toBe(3);
    for (const r of [0, 0.5, 0.99]) {
      const reset = pickTask(content, theme, { played, extra: false, lastRarity: null }, seq(0.1, r))!;
      expect(reset.fallbacks).toContain("deckReset");
      expect(reset.task.id).not.toBe(played.at(-1));
      expect(reset.played).toEqual([reset.task.id]);
    }
  });

  it("в теме одно задание — после сброса выпадает оно же (другого нет)", () => {
    const content = game({ a: [{ id: "a1" }] });
    const p = pickTask(content, content.themes[0]!, { played: ["a1"], extra: false, lastRarity: null }, seq(0.3));
    expect(p?.task.id).toBe("a1");
  });

  it("выключенные, пустые и 18+ без режима не выпадают", () => {
    const content = game({ a: [{ id: "a1", active: false }, { id: "a2", adult: true }, { id: "a3" }] });
    for (const r of [0, 0.5, 0.99]) expect(pickTask(content, content.themes[0]!, { played: [], extra: false, lastRarity: null }, seq(r, r))?.task.id).toBe("a3");
    const adult = { ...content, adult: true };
    const seen = new Set([0, 0.4, 0.99].map((r) => pickTask(adult, adult.themes[0]!, { played: [], extra: false, lastRarity: null }, seq(0.1, r))?.task.id));
    expect(seen).toEqual(new Set(["a2", "a3"]));
    const empty = parseRoulette({ themes: [{ id: "e", name: "e", tasks: [{ id: "x", title: "", text: "" }] }] });
    expect(pickTask(empty, empty.themes[0]!, { played: [], extra: false, lastRarity: null }, seq(0.5))).toBeNull();
  });

  it("доп. вращение — без «Ещё вращения»; если других нет — шаг отменяется (extraSpinFallback)", () => {
    const content = game({ a: [{ id: "bonus", kind: "bonus", effect: "extraSpin" }, { id: "a2" }] });
    for (const r of [0, 0.99]) expect(pickTask(content, content.themes[0]!, { played: [], extra: true, lastRarity: null }, seq(0.1, r))?.task.id).toBe("a2");
    const only = game({ a: [{ id: "bonus", kind: "bonus", effect: "extraSpin" }] });
    const p = pickTask(only, only.themes[0]!, { played: [], extra: true, lastRarity: null }, seq(0.1, 0.1))!;
    expect(p.task.id).toBe("bonus");
    expect(p.fallbacks).toContain("extraSpinFallback");
  });

  it("после легендарного этой команды — без легендарных; только легендарные — legendaryFallback", () => {
    const content = game({ a: [{ id: "L", rarity: "legendary" }, { id: "c", rarity: "common" }] }, { weights: { common: 0, rare: 0, legendary: 100 } });
    const p = pickTask(content, content.themes[0]!, { played: [], extra: false, lastRarity: "legendary" }, seq(0.5, 0.5))!;
    expect(p.task.id).toBe("c");
    expect(p.fallbacks).not.toContain("legendaryFallback");
    const off = { ...content, noTwoLegendary: false };
    expect(pickTask(off, off.themes[0]!, { played: [], extra: false, lastRarity: "legendary" }, seq(0.5, 0.5))!.task.id).toBe("L");
    const only = game({ a: [{ id: "L", rarity: "legendary" }] });
    const q = pickTask(only, only.themes[0]!, { played: [], extra: false, lastRarity: "legendary" }, seq(0.5, 0.5))!;
    expect(q.task.id).toBe("L");
    expect(q.fallbacks).toContain("legendaryFallback");
  });

  it("замена: та же редкость, если есть; заменённое не выпадает снова", () => {
    const content = game({ a: [{ id: "r1", rarity: "rare" }, { id: "r2", rarity: "rare" }, { id: "c1", rarity: "common" }, { id: "L1", rarity: "legendary" }] });
    for (const r of [0, 0.5, 0.99]) {
      const p = pickTask(content, content.themes[0]!, { played: ["r1"], extra: false, lastRarity: null, sameRarity: "rare", current: "r1" }, seq(r, r))!;
      expect(p.task.id).toBe("r2");
    }
    // Той же редкости больше нет — обычный отбор, но не заменённое.
    const p = pickTask(content, content.themes[0]!, { played: ["r1", "r2"], extra: false, lastRarity: null, sameRarity: "rare", current: "r2" }, seq(0.99, 0.5))!;
    expect(["c1", "L1"]).toContain(p.task.id);
  });
});

describe("рулетка: колесо (Р-14)", () => {
  it("указатель попадает в выпавший сектор при любом числе секторов", () => {
    for (let n = 1; n <= 15; n++) for (let i = 0; i < n; i++) for (const f of [0.15, 0.5, 0.85]) expect(sectorAt(landingAngle(i, n, 5, f), n)).toBe(i);
  });

  it("анимация: от 0 до угла, монотонно, без случайности; после остановки — пауза", () => {
    const spin = { angle: 2700.5, durationMs: 6000, curve: 3.1 };
    expect(wheelRotation(spin, 0)).toBe(0);
    expect(wheelRotation(spin, spin.durationMs - REVEAL_PAUSE_MS)).toBe(spin.angle);
    expect(wheelRotation(spin, spin.durationMs + 5000)).toBe(spin.angle);
    let prev = -1;
    for (let t = 0; t <= 5000; t += 100) {
      const a = wheelRotation(spin, t);
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
  });

  it("вращение из зерна: одно и то же на любом пульте, тема равновероятна (Р-16)", () => {
    const sectors = ["music", "dance", "cinema"];
    const input = { sectors, played: {}, extra: false, lastRarity: null };
    const a = spinOutcome(DEMO_ROULETTE, input, "1_team:100");
    expect(spinOutcome(DEMO_ROULETTE, input, "1_team:100")).toEqual(a);
    expect(a!.durationMs).toBe(DEMO_ROULETTE.spinSeconds * 1000 + REVEAL_PAUSE_MS);
    expect(sectorAt(a!.angle, sectors.length)).toBe(a!.index);
    expect(sectors[a!.index]).toBe(a!.themeId);
    const counts = new Map<string, number>();
    for (let i = 0; i < 3000; i++) {
      const s = spinOutcome(DEMO_ROULETTE, input, "seed" + i)!;
      counts.set(s.themeId, (counts.get(s.themeId) ?? 0) + 1);
      expect(DEMO_ROULETTE.themes.find((t) => t.id === s.themeId)!.tasks.some((t) => t.id === s.taskId)).toBe(true);
    }
    for (const id of sectors) expect(Math.abs((counts.get(id) ?? 0) - 1000)).toBeLessThan(120);
  });

  it("сброс колоды — только у выпавшей темы", () => {
    const content = game({ a: [{ id: "a1" }], b: [{ id: "b1" }, { id: "b2" }] });
    const out = spinOutcome(content, { sectors: ["a"], played: { a: ["a1"], b: ["b1"] }, extra: false, lastRarity: null }, "x")!;
    expect(out.themeId).toBe("a");
    expect(out.played).toEqual(["a1"]);
    expect(out.fallbacks).toContain("deckReset");
  });

  it("«Выбор темы» ведёт колесо к теме капитана", () => {
    for (let i = 0; i < 20; i++) expect(spinOutcome(DEMO_ROULETTE, { sectors: ["music", "dance", "cinema"], played: {}, extra: false, lastRarity: null, forcedTheme: "cinema" }, "s" + i)!.themeId).toBe("cinema");
  });
});
