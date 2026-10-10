import { describe, expect, it } from "vitest";
import { ELEMENTS, STRONG, d100Of, elementMult, foeXp, hpMaxOf, levelOf, outcomeOf, resistOf, splitCoins, splitXp, threshold, xpToNext } from "./rules";
import { GODS, abilitiesOf } from "./gods";
import { FOES, scaledHp } from "./foes";
import { battleTotals, battleXp, beginTurn, canUse, endTurn, foeAct, godAct, startBattle, turnQueue, type Battle } from "./combat";
import { exitsOf, validateStory } from "./story";
import { WINTER } from "./winter";

/** Детерминированный «кубик» для тестов. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s % 100) + 1;
  };
}

describe("стихии", () => {
  it("у каждой две сильные и две слабые стороны, взаимных пар нет", () => {
    for (const e of ELEMENTS) {
      expect(STRONG[e]).toHaveLength(2);
      const weakTo = ELEMENTS.filter((x) => STRONG[x].includes(e));
      expect(weakTo).toHaveLength(2);
      for (const t of STRONG[e]) expect(STRONG[t].includes(e)).toBe(false);
    }
  });
  it("множители и сопротивления", () => {
    expect(elementMult("fire", "ice")).toBe(1.5);
    expect(elementMult("ice", "fire")).toBe(0.5);
    expect(elementMult("fire", "wind")).toBe(1);
    const r = resistOf("ice");
    expect(r.fire).toBe(150);
    expect(r.bolt).toBe(150);
    expect(r.earth).toBe(50);
    expect(r.water).toBe(50);
    expect(r.ice).toBe(0);
    expect(r.light).toBe(100);
  });
});

describe("кубик и исходы", () => {
  it("порог = 100 − характеристика в пределах 5–95", () => {
    expect(threshold(65)).toBe(35);
    expect(threshold(100)).toBe(5);
    expect(threshold(0)).toBe(95);
  });
  it("пять исходов", () => {
    expect(outcomeOf(97, 10)).toBe("crit");
    expect(outcomeOf(3, 90)).toBe("fail");
    expect(outcomeOf(55, 65)).toBe("good"); // порог 35, хорошо от 55
    expect(outcomeOf(40, 65)).toBe("mid");
    expect(outcomeOf(30, 65)).toBe("bad");
    // модификаторы двигают бросок, но не крит
    expect(outcomeOf(50, 65, -16)).toBe("bad");
    expect(outcomeOf(4, 65, 50)).toBe("fail");
  });
  it("бросок с сервера: 1–100, повторяемый", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const r = d100Of({ id: `a${i}`, submittedAt: 1_700_000_000_000 + i * 37 });
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(100);
      seen.add(r);
    }
    expect(seen.size).toBe(100);
    expect(d100Of({ id: "x", submittedAt: 5 })).toBe(d100Of({ id: "x", submittedAt: 5 }));
  });
});

describe("уровни, здоровье, награды", () => {
  it("опыт до уровня", () => {
    expect(xpToNext(1)).toBe(100);
    expect(xpToNext(4)).toBe(1213);
    expect(xpToNext(29)).toBe(42886);
    expect(levelOf(100 + 348).level).toBe(3);
    expect(levelOf(10_000_000).level).toBe(30);
  });
  it("здоровье", () => {
    expect(hpMaxOf(1)).toBe(100);
    expect(hpMaxOf(5)).toBe(124);
    expect(hpMaxOf(5, 10)).toBe(136);
  });
  it("драхмы: целые, сумма равна награде", () => {
    const next = rng(7);
    for (let t = 0; t < 2000; t++) {
      const n = 1 + (next() % 10);
      const rolls = Array.from({ length: n }, () => next());
      const total = next() * 3;
      const parts = splitCoins(total, rolls);
      expect(parts.reduce((a, x) => a + x, 0)).toBe(total);
      for (const p of parts) expect(Number.isInteger(p)).toBe(true);
    }
  });
  it("опыт по урону, помощник — не меньше 10%", () => {
    const xp = splitXp(600, { a: 300, b: 100 }, ["c"]);
    expect(xp.a).toBe(450);
    expect(xp.b).toBe(150);
    expect(xp.c).toBe(60);
    expect(foeXp("B", true)).toBe(600);
  });
});

describe("боги и противники", () => {
  it("10 богов: разные стихии, 3 способности и ульта", () => {
    expect(GODS).toHaveLength(10);
    expect(new Set(GODS.map((g) => g.element)).size).toBe(10);
    for (const g of GODS) {
      expect(g.abilities).toHaveLength(3);
      expect(g.ult.ult).toBe(true);
      expect(g.abilities.some((a) => a.ult)).toBe(false);
      const sum = Object.values(g.stats).reduce((a, x) => a + x, 0);
      expect(sum).toBeGreaterThanOrEqual(245);
      expect(sum).toBeLessThanOrEqual(265);
      for (const a of abilitiesOf(g)) if (a.kind === "bless" || a.kind === "curse") expect(a.effect).toBeTruthy();
    }
    expect(new Set(GODS.flatMap((g) => abilitiesOf(g).map((a) => a.id))).size).toBe(40);
  });
  it("обычные — 2–4 способности, боссы — 5–8", () => {
    for (const f of FOES) {
      if (f.boss) {
        expect(f.abilities.length).toBeGreaterThanOrEqual(5);
        expect(f.abilities.length).toBeLessThanOrEqual(8);
      } else {
        expect(f.abilities.length).toBeGreaterThanOrEqual(2);
        expect(f.abilities.length).toBeLessThanOrEqual(4);
      }
    }
    const boss = FOES.find((f) => f.id === "devourer");
    expect(boss && scaledHp(boss, 4)).toBe(300);
    expect(boss && scaledHp(boss, 8)).toBe(600);
  });
});

describe("история «Вечная зима»", () => {
  it("дерево без ошибок, три концовки", () => {
    expect(validateStory(WINTER)).toEqual([]);
    expect(WINTER.scenes.filter((s) => s.kind === "end").map((s) => (s.kind === "end" ? s.ending : "")).sort()).toEqual(["bad", "good", "mid"]);
  });
  it("есть узел, где ветки сходятся", () => {
    const into = WINTER.scenes.filter((s) => exitsOf(s).includes("acheron"));
    expect(into.length).toBeGreaterThanOrEqual(2);
  });
});

/** Прогон боя: каждый бог бьёт первой готовой способностью, лечит раненого. */
function runBattle(foe: string, godIds: string[], seed: number, level = 1): Battle {
  const next = rng(seed);
  let b = startBattle(foe, godIds.map((god, i) => ({ pid: `p${i}`, god, level })));
  for (let i = 0; i < 400 && !b.over; i++) {
    const begun = beginTurn(b);
    b = begun.battle;
    if (!begun.skip && !b.over) {
      const actor = b.fighters.find((f) => f.id === b.actor);
      if (!actor) break;
      if (actor.side === "foe") b = foeAct(b, next());
      else {
        const god = GODS.find((g) => g.id === actor.ref);
        if (!god) break;
        const ready = abilitiesOf(god).filter((a) => canUse(actor, a)).sort((a, c) => (c.ult ? 1 : 0) - (a.ult ? 1 : 0));
        const ability = ready[0];
        if (!ability) break;
        const ally = b.fighters.filter((f) => f.side === "god" && !f.down).sort((a, c) => a.hp / a.hpMax - c.hp / c.hpMax)[0];
        b = godAct(b, actor.id, ability.id, ally ? [ally.id] : [], next()).battle;
      }
    }
    for (const f of b.fighters) {
      expect(f.hp).toBeGreaterThanOrEqual(0);
      expect(f.hp).toBeLessThanOrEqual(f.hpMax);
      expect(f.shield).toBeGreaterThanOrEqual(0);
    }
    b = endTurn(b);
  }
  return b;
}

describe("бой", () => {
  it("Скорость 200 против 100 — два хода на один", () => {
    const b = startBattle("wolves", [{ pid: "a", god: "zeus", level: 1, bonus: { speed: 100 } }, { pid: "b", god: "athena", level: 1 }]);
    const q = turnQueue(b, 6).filter((id) => id !== "foe");
    expect(q.filter((id) => id === "a").length).toBeGreaterThanOrEqual(2 * q.filter((id) => id === "b").length - 1);
  });
  it("сотни боёв доходят до конца, числа в пределах, журнал сходится", () => {
    let wins = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const gods = [...GODS].sort((a, c) => ((seed * 31 + a.id.length * 7) % 11) - ((seed * 31 + c.id.length * 7) % 11)).slice(0, 2 + (seed % 7)).map((g) => g.id);
      const b = runBattle(seed % 3 === 0 ? "devourer" : seed % 3 === 1 ? "wolves" : "shades", gods, seed, 1 + (seed % 4));
      expect(b.over).not.toBeNull();
      if (b.over === "win") {
        wins++;
        const xp = battleXp(b);
        const total = Object.values(xp).reduce((a, x) => a + x, 0);
        expect(total).toBeGreaterThan(0);
      }
      const t = battleTotals(b);
      expect(t.curses).toBeGreaterThanOrEqual(0);
      // журнал хранит не больше 80 записей и номера идут по порядку
      expect(b.log.length).toBeLessThanOrEqual(80);
      for (let i = 1; i < b.log.length; i++) expect((b.log[i - 1]?.n ?? 0) - (b.log[i]?.n ?? 0)).toBe(1);
    }
    // баланс пробной истории: отряд чаще побеждает, но не всегда
    expect(wins).toBeGreaterThan(150);
    expect(wins).toBeLessThan(300);
  });
  it("ход не в свою очередь и неготовая способность — ошибка", () => {
    const b = startBattle("wolves", [{ pid: "a", god: "zeus", level: 1 }, { pid: "b", god: "athena", level: 1 }]);
    const other = b.actor === "a" ? "b" : "a";
    expect(() => godAct(b, other, "zeus-1", [], 50)).toThrow();
    if (b.actor === "a") expect(() => godAct(b, "a", "zeus-u", [], 50)).toThrow();
  });
});
