// Цель, финалисты, порядок вылета, сердечки, «Добивка», прогнозы (docs/matryoshka.md, «Сердечки и вылет») и главное: к финалу
// приходит ровно F на всей сетке параметров (настоящие правила, гости без нажатий — порядок решает жребий).
import { describe, expect, it } from "vitest";
import { TRIAL_KINDS } from "./content";
import { tick } from "./game";
import { inGame } from "./members";
import { dobivkaOut, finalistsFor, losersOf, rankOrder, scoreGuesses, targetOf } from "./target";
import { World } from "./world.test-kit";

describe("цель и финалисты", () => {
  it("T = max(F, ⌈A·(F/A)^(1/k)⌉); A ≤ F — на посев", () => {
    expect(targetOf(50, 4, 5)).toBe(31);
    expect(targetOf(50, 4, 1)).toBe(4);
    expect(targetOf(4, 4, 3)).toBe(4);
    expect(targetOf(3, 4, 3)).toBe(3);
    expect(targetOf(100, 4, 5)).toBe(53);
    expect(targetOf(10, 3, 0)).toBe(10);
    // Последнее испытание всегда до F.
    for (let A = 5; A <= 100; A += 1) expect(targetOf(A, 4, 1)).toBe(4);
  });

  it("финалистов не больше половины зала и не меньше 2 (L22): 6 гостей при 8 — трое", () => {
    expect(finalistsFor(8, 6)).toBe(3);
    expect(finalistsFor(4, 6)).toBe(3);
    expect(finalistsFor(2, 6)).toBe(2);
    expect(finalistsFor(4, 50)).toBe(4);
    expect(finalistsFor(8, 100)).toBe(8);
    expect(finalistsFor(8, 4)).toBe(2);
  });
});

describe("порядок вылета: исход → результат → сердечки → жребий", () => {
  it("сердечки — только при равенстве исхода и результата; потом жребий", () => {
    const key: Record<string, number[]> = { a: [1, 50, 1], b: [1, 50, 2], c: [0, 99, 2], d: [1, 60, 0], e: [1, 50, 1] };
    const lot: Record<string, number> = { a: 0.9, b: 0.5, c: 0.1, d: 0.3, e: 0.2 };
    expect(rankOrder(Object.keys(key), (p) => key[p] ?? [], (p) => lot[p] ?? 0)).toEqual(["d", "b", "e", "a", "c"]);
  });

  it("теряют сердечко последние need из тех, кто может проиграть; меньше — недобор", () => {
    const order = ["a", "b", "c", "d", "e", "f"];
    expect(losersOf(order, () => true, 2)).toEqual(["f", "e"]);
    expect(losersOf(order, (p) => p === "a" || p === "c", 3)).toEqual(["c", "a"]);
    expect(losersOf(order, () => true, 0)).toEqual([]);
  });

  it("«Добивка»: раньше упавшие первыми, равные — меньше сердечек; упавших мало — отсечка по сердечкам и сумме мест", () => {
    const rows: Record<string, number | null> = { a: 0, b: 1, c: 1, d: null, e: null, f: 2 };
    const info = (p: string) => ({ hearts: p === "c" ? 1 : 2, placeSum: p === "e" ? 30 : 10, coins: 0, lot: 0.5 });
    expect(dobivkaOut(Object.keys(rows), (p) => rows[p] ?? null, info, 2)).toEqual(["a", "c"]);
    expect(dobivkaOut(Object.keys(rows), (p) => rows[p] ?? null, info, 5)).toEqual(["a", "c", "b", "f", "e"]);
    expect(dobivkaOut(Object.keys(rows), (p) => rows[p] ?? null, info, 0)).toEqual([]);
  });

  it("«Добивка» (решение владельца 14 ноября 2026): упало больше, чем нужно, — остаётся тот, у кого больше сердечек, даже с худшим результатом; потом результат, потом жребий", () => {
    // A (2 сердечка, сумма мест 40) и B (1 сердечко, сумма мест 10, 3 монеты) упали в одном ряду, нужен один.
    const info: Record<string, { hearts: number; placeSum: number; coins: number; lot: number }> = {
      A: { hearts: 2, placeSum: 40, coins: 0, lot: 0.1 },
      B: { hearts: 1, placeSum: 10, coins: 3, lot: 0.9 },
      C: { hearts: 1, placeSum: 5, coins: 0, lot: 0.5 },
      D: { hearts: 1, placeSum: 10, coins: 0, lot: 0.2 },
      E: { hearts: 1, placeSum: 10, coins: 0, lot: 0.7 },
    };
    const fell = (p: string) => (p === "C" ? null : 0);
    expect(dobivkaOut(["A", "B", "C"], fell, (p) => info[p] as (typeof info)[string], 1)).toEqual(["B"]);
    // Сердечки поровну — результат: больше сумма мест (хуже) выбывает; поровну — меньше монет; дальше — жребий.
    expect(dobivkaOut(["B", "D", "C"], fell, (p) => info[p] as (typeof info)[string], 1)).toEqual(["D"]);
    expect(dobivkaOut(["D", "E", "C"], fell, (p) => info[p] as (typeof info)[string], 1)).toEqual(["E"]);
    // Падение сердечко не отнимает: сердечки оставшихся — те же (M, сквозной тест «Добивки»).
  });
});

describe("прогнозы болельщиков (решение владельца 3)", () => {
  it("самый близкий — все одинаково близкие; в пределах 10% (не меньше 1) — рядом", () => {
    expect(scoreGuesses({ a: 10, b: 12, c: 8, d: 13, e: 30 }, 10, 0.1)).toEqual({ best: ["a"], near: [] });
    expect(scoreGuesses({ b: 12, c: 8, d: 13, e: 30 }, 10, 0.1)).toEqual({ best: ["b", "c"], near: [] });
    expect(scoreGuesses({ a: 20, b: 22, c: 18, d: 25 }, 21, 0.1)).toEqual({ best: ["a", "b"], near: ["c"] });
    expect(scoreGuesses({ a: 1, b: 2 }, 0, 0.1)).toEqual({ best: ["a"], near: [] });
    expect(scoreGuesses({}, 3, 0.1)).toEqual({ best: [], near: [] });
  });
});

/** Быстрая игра: гости не жмут, время — шагами по 1 с, пульт ведёт до сетки. Ответ — финалисты. */
function fastToFinal(A: number, content: Record<string, unknown>, seed: string, answerChance = true): { seeds: number; F: number; w: World } {
  const w = new World(A, content, seed);
  w.cmd("start");
  for (let i = 0; i < 4000; i += 1) {
    w.now += 1000;
    tick(w.s, w);
    const c = w.host().can;
    if (w.s.phase === "final") break;
    if (c.chance) {
      w.cmd("chance");
      continue;
    }
    if (w.s.phase === "chance" && w.s.chance?.stage === "question" && answerChance) {
      const q = w.s.chance;
      // Половина выбывших отвечает верно, остальные — нет.
      q.eligible.forEach((pid, k) => {
        if (q.answers[pid]) return;
        w.in(pid, [{ t: "ans", i: k % 2 === 0 ? 0 : 1, rt: 400 + k }]);
      });
    }
    if (c.next) w.cmd("next");
  }
  return { seeds: w.s.final?.seeds.length ?? -1, F: w.s.F, w };
}

describe("к финалу — ровно F на сетке параметров (настоящие правила)", () => {
  const sizes = [6, 7, 8, 9, 10, 11, 12, 13, 15, 17, 20, 23, 27, 31, 37, 44, 50, 58, 66, 75, 87, 100];
  it("A 6–100, F 2–8, 1–5 испытаний, сердечки 1 и 2, «Второй шанс» 0 и 10%: финалистов ровно F = min(F, ⌊A/2⌋)", () => {
    let games = 0;
    const bad: string[] = [];
    let dobivka = 0;
    for (const A of sizes) {
      for (let F = 2; F <= 8; F += 1) {
        for (let n = 1; n <= 5; n += 1) {
          for (const lives of [1, 2]) {
            for (const sc of [0, 10]) {
              const trials = TRIAL_KINDS.map((kind, i) => ({ kind, on: i < n }));
              const { seeds, F: eff, w } = fastToFinal(A, { finalists: F, lives, secondChance: sc, trials, tempo: "short" }, `g${A}-${F}-${n}-${lives}-${sc}`);
              games += 1;
              if (w.s.dobBase !== null) dobivka += 1;
              if (eff !== finalistsFor(F, A) || seeds !== eff || seeds > Math.floor(A / 2)) bad.push(`A=${A} F=${F} n=${n} lives=${lives} sc=${sc}: ${seeds}/${eff}`);
            }
          }
        }
      }
    }
    expect(bad).toEqual([]);
    expect(games).toBe(sizes.length * 7 * 5 * 2 * 2);
    // «Добивка» бывает, но не в каждой игре.
    expect(dobivka).toBeGreaterThan(0);
    expect(dobivka).toBeLessThan(games);
  }, 300_000);

  it("взрослые (1 сердечко), точные испытания: после каждого в игре ровно T, «Добивка» не нужна", () => {
    for (const A of [12, 30, 50, 100]) {
      const trials = TRIAL_KINDS.map((kind, i) => ({ kind, on: i < 3 }));
      const w = new World(A, { finalists: 4, lives: 1, secondChance: 0, trials, tempo: "short" }, `exact${A}`);
      w.cmd("start");
      for (let i = 0; i < 3000 && w.s.phase !== "final"; i += 1) {
        w.now += 1000;
        tick(w.s, w);
        const tr = w.s.trial;
        if (tr?.stage === "results") {
          expect(inGame(w.s).length, `A=${A} испытание ${tr.index}`).toBe(tr.T);
          w.cmd("next");
        }
      }
      expect(w.s.dobBase).toBeNull();
      expect(w.s.final?.seeds.length).toBe(4);
    }
  });

  it("дети (2 сердечка): в первом испытании никто не выбывает, лишних перед финалом убирает «Добивка»", () => {
    const w = new World(50, { finalists: 4, lives: 2, secondChance: 0, tempo: "short" }, "kids50");
    w.cmd("start");
    w.until(() => w.s.trial?.stage === "results", 600_000);
    expect(w.s.trial?.outcome?.out).toEqual([]);
    expect(w.s.trial?.outcome?.lost.length).toBe(19);
    const { seeds } = fastToFinal(50, { finalists: 4, lives: 2, secondChance: 0, tempo: "short" }, "kids50b");
    expect(seeds).toBe(4);
  });
});
