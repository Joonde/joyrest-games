import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

/**
 * Калькулятор сайта агентства (site/js/pricing.js, решение владельца 12 октября 2026).
 * Перебор всех путей сверяется с независимой формулой:
 * (пакет + добавленные игры по 50% + продление + обычные допы) × 1,1 в пт–вс
 *   × (1 / 0,8 / 0,65) → вверх до 100 ₽ → + фиксированные допы (призы, выезд за область).
 */
interface Total { id: string; name: string; badge: string; price: number }
interface Result {
  individual: boolean;
  reason: string;
  totals: Total[];
  lines: { label: string; value: number; fixed: boolean }[];
  hours: { min: number; max: number };
  extrasCount: number;
}
interface Options { pkg: string; tier: number; weekend?: boolean; extras?: string[]; ext?: number; addons?: string[] }
interface Pricing {
  calcPrice(o: Options): Result;
  hoursWord(n: number): string;
  gamesWord(n: number): string;
  TIERS: number[];
  LEVELS: { id: string; discount: number }[];
}

const root = resolve(import.meta.dirname, "../..");
const sandbox: { JoyPricing?: Pricing } = {};
runInNewContext(readFileSync(join(root, "site/js/pricing.js"), "utf8"), sandbox);
const P = sandbox.JoyPricing as Pricing;

const PRICES: Record<string, number[]> = {
  game: [14900, 18900, 24900, 29900, 37900],
  quiz: [19900, 24900, 32900, 39900, 49900],
  show: [22900, 27900, 35900, 42900, 52900],
  music: [19900, 24900, 32900, 39900, 49900],
  dance: [19900, 24900, 32900, 39900, 49900],
  active: [21400, 26400, 34400, 41400, 51400],
};
const PACKS = Object.keys(PRICES);
const EXT = [0, 3900, 7900, 11800, 15800];
const EXT_HOURS = [0, 0.5, 1, 1.5, 2];
const ADDONS: Record<string, number> = { corp: 7000, logo: 3000, prize: 2500, dance: 3000, out: 2500, far: 2000 };
const FIXED = new Set(["prize", "far"]);
const LEVELS = [0, 0.2, 0.35];
const up = (y: number) => Math.ceil(Math.round(y * 100) / 100 / 100) * 100;
const subsets = <T,>(items: T[]): T[][] => items.reduce<T[][]>((acc, x) => acc.concat(acc.map((s) => [...s, x])), [[]]);

function model(pkg: string, tier: number, weekend: boolean, extras: string[], ext: number, addons: string[]): number[] {
  let flex = PRICES[pkg]![tier]!;
  let fixed = 0;
  for (const e of extras) flex += Math.ceil((PRICES[e]![tier]! * 0.5) / 100) * 100;
  flex += EXT[ext]!;
  for (const a of addons) {
    if (FIXED.has(a)) fixed += ADDONS[a]!;
    else flex += ADDONS[a]!;
  }
  return LEVELS.map((d) => up(flex * (weekend ? 1.1 : 1) * (1 - d)) + fixed);
}
const prices = (o: Options) => P.calcPrice(o).totals.map((t) => t.price);

describe("калькулятор сайта: цены", () => {
  it("эталонная таблица: 6 пакетов × 5 ступеней, будни и пт–вс, три ведущих", () => {
    const table: Record<string, [number, number, number, number][]> = {
      game: [[14900, 16400, 12000, 9700], [18900, 20800, 15200, 12300], [24900, 27400, 20000, 16200], [29900, 32900, 24000, 19500], [37900, 41700, 30400, 24700]],
      quiz: [[19900, 21900, 16000, 13000], [24900, 27400, 20000, 16200], [32900, 36200, 26400, 21400], [39900, 43900, 32000, 26000], [49900, 54900, 40000, 32500]],
      show: [[22900, 25200, 18400, 14900], [27900, 30700, 22400, 18200], [35900, 39500, 28800, 23400], [42900, 47200, 34400, 27900], [52900, 58200, 42400, 34400]],
      active: [[21400, 23600, 17200, 14000], [26400, 29100, 21200, 17200], [34400, 37900, 27600, 22400], [41400, 45600, 33200, 27000], [51400, 56600, 41200, 33500]],
    };
    table.music = table.quiz!;
    table.dance = table.quiz!;
    for (const [pkg, rows] of Object.entries(table)) {
      rows.forEach(([weekday, weekend, fresh, first], tier) => {
        const label = `${pkg} до ${P.TIERS[tier]}`;
        expect(prices({ pkg, tier })[0], label).toBe(weekday);
        expect(prices({ pkg, tier, weekend: true })[0], label).toBe(weekend);
        expect(prices({ pkg, tier })[1], label).toBe(fresh);
        expect(prices({ pkg, tier })[2], label).toBe(first);
      });
    }
  });

  it("примеры из задачи владельца", () => {
    // Квиз до 25 + Игровой вечер + продление 1 ч + логотип + призы, пт–вс.
    expect(prices({ pkg: "quiz", tier: 1, weekend: true, extras: ["game"], ext: 2, addons: ["logo", "prize"] })).toEqual([52400, 42400, 34900]);
    // Квиз до 25 + Игровой вечер + продление 1 ч, будни: 24 900 + 9 500 + 7 900.
    expect(prices({ pkg: "quiz", tier: 1, extras: ["game"], ext: 2 })).toEqual([42300, 33900, 27500]);
    // Квиз до 60, пт–вс, квиз под компанию: «Первый старт» (39 900 + 7 000) × 1,1 × 0,65 = 33 533,5 → 33 600.
    expect(prices({ pkg: "quiz", tier: 3, weekend: true, addons: ["corp"] })[2]).toBe(33600);
    // Плавающая точка: 24 900 × 1,1 = 27 390,000000000004 — не лишняя сотня.
    expect(prices({ pkg: "quiz", tier: 1, weekend: true })[0]).toBe(27400);
  });

  it("«Новые лица» — минус 20%, «Первый старт» — минус 35%", () => {
    expect(P.LEVELS.map((l) => [l.id, l.discount])).toEqual([["standard", 0], ["new", 0.2], ["first", 0.35]]);
  });

  it("все пути калькулятора совпадают с формулой (до двух доп. игр), три и больше — индивидуально", () => {
    let paths = 0;
    for (const pkg of PACKS) {
      const others = PACKS.filter((p) => p !== pkg);
      for (let tier = 0; tier < 5; tier++) {
        for (const weekend of [false, true]) {
          for (const extras of subsets(others).filter((s) => s.length <= 3)) {
            for (let ext = 0; ext < 5; ext++) {
              for (const addons of subsets(Object.keys(ADDONS))) {
                paths += 1;
                const r = P.calcPrice({ pkg, tier, weekend, extras, ext, addons });
                if (extras.length > 2) {
                  if (!r.individual || r.reason !== "extras" || r.totals.length) throw new Error(`3+ игры: ${pkg} ${extras.join("+")}`);
                  continue;
                }
                const got = r.totals.map((t) => t.price);
                const want = model(pkg, tier, weekend, extras, ext, addons);
                if (got.join() !== want.join()) throw new Error(`${pkg}/${tier}/${weekend}/${extras}/${ext}/${addons}: ${got} ≠ ${want}`);
                if (!(got[0]! >= got[1]! && got[1]! >= got[2]!)) throw new Error(`порядок ведущих: ${pkg}/${tier}`);
                if (got.some((g) => g % 100 !== 0)) throw new Error(`не кратно 100: ${got}`);
                if (r.hours.min !== 1.5 + extras.length + EXT_HOURS[ext]! || r.hours.max !== 2 + extras.length + EXT_HOURS[ext]!) throw new Error("длительность");
                // Строки сводки — те же слагаемые, что и в итоге.
                const sum = r.lines.reduce((s, l) => s + l.value, 0);
                const raw = PRICES[pkg]![tier]! + extras.reduce((s, e) => s + Math.ceil((PRICES[e]![tier]! * 0.5) / 100) * 100, 0) + EXT[ext]! + addons.reduce((s, a) => s + ADDONS[a]!, 0);
                if (sum !== raw) throw new Error(`строки сводки: ${sum} ≠ ${raw}`);
              }
            }
          }
        }
      }
    }
    expect(paths).toBe(6 * 5 * 2 * 26 * 5 * 64);
  });

  it("больше гостей — дороже, пятница–воскресенье — не дешевле будней", () => {
    for (const pkg of PACKS) {
      for (let tier = 1; tier < 5; tier++) {
        const a = prices({ pkg, tier: tier - 1 });
        const b = prices({ pkg, tier });
        b.forEach((v, i) => expect(v, `${pkg} ${tier}`).toBeGreaterThan(a[i]!));
      }
      for (let tier = 0; tier < 5; tier++) {
        const a = prices({ pkg, tier });
        const b = prices({ pkg, tier, weekend: true });
        b.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(a[i]!));
      }
    }
  });

  it("«Под ключ» и больше 90 гостей — без цены, «обсудим индивидуально»", () => {
    for (const r of [P.calcPrice({ pkg: "turnkey", tier: 1 }), P.calcPrice({ pkg: "quiz", tier: 5 }), P.calcPrice({ pkg: "turnkey", tier: 5, weekend: true, ext: 3, addons: ["corp"] })]) {
      expect(r.individual).toBe(true);
      expect(r.totals).toEqual([]);
    }
    expect(P.calcPrice({ pkg: "turnkey", tier: 0 }).reason).toBe("turnkey");
    expect(P.calcPrice({ pkg: "game", tier: 5 }).reason).toBe("guests");
  });

  it("выбранный пакет не считается «ещё игрой», склонения часов и игр", () => {
    expect(prices({ pkg: "quiz", tier: 0, extras: ["quiz"] })).toEqual(prices({ pkg: "quiz", tier: 0 }));
    expect([1, 2, 4, 5].map((n) => P.gamesWord(n))).toEqual(["игра", "игры", "игры", "игр"]);
    expect([2, 2.5, 4, 5, 6].map((n) => P.hoursWord(n))).toEqual(["часа", "часа", "часа", "часов", "часов"]);
  });
});
