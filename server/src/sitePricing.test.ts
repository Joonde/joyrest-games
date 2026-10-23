import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { programFromCalc } from "../../src/core/eventProgram";
import { parseLeadText } from "../../src/core/events";

/**
 * Калькулятор сайта агентства (site/js/pricing.js, решение владельца 12 октября 2026).
 * Перебор всех путей сверяется с независимой формулой:
 * (пакет + добавленные игры по 50% + продление + обычные допы) × 1,1 в пт–вс
 *   × (1 / 0,8 / 0,65) → вверх до 100 ₽ → + фиксированные допы (призы, выезд за область).
 */
interface Total { id: string; name: string; badge: string; price: number; base: number; extra: number }
interface Season { id: string; pct: number; fullPct: number; early: boolean; min: number; travel: string; title: string; text: string; holiday?: string }
interface Result {
  individual: boolean;
  reason: string;
  totals: Total[];
  lines: { label: string; value: number; fixed: boolean }[];
  hours: { min: number; max: number };
  extrasCount: number;
  weekend: boolean;
  date: { iso: string; label: string; weekday: string } | null;
  season: Season | null;
  hint: string;
  travel: number;
}
interface Options { pkg: string; tier: number; weekend?: boolean; extras?: string[]; ext?: number; addons?: string[]; date?: string; time?: string; today?: string }
interface Summary { type: string; guests: number | null; parts: string[]; totals: { name: string; price: number }[] | null; duration: string; season: string; date: string; text: string }
interface Pricing {
  calcPrice(o: Options): Result;
  calcSummary(o: Options): Summary;
  calcMessage(o: Options, level: string): string;
  hoursWord(n: number): string;
  gamesWord(n: number): string;
  seasonFor(date: string, today: string): Season | null;
  seasonHint(date: string): string;
  seasonBadge(s: Season | null): string;
  moscowToday(nowMs?: number): string;
  parseDate(iso: string): { y: number; m: number; d: number; t: number; wd: number } | null;
  ADDONS: { id: string; label: string; price: number; fixed: boolean }[];
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

  it("расчёт для заявки: выбор, три цены и длительность одной строкой", () => {
    const s = P.calcSummary({ pkg: "quiz", tier: 1, ext: 1, addons: ["prize", "logo"] });
    expect(s.type).toBe("Пакет «Квиз»");
    expect(s.guests).toBe(25);
    expect(s.parts).toEqual(["до 25 гостей", "будни", "продление 30 мин", "допы: Логотип на экранах, Призы и медали"]);
    expect(s.totals?.map((t) => ({ name: t.name, price: t.price }))).toEqual([
      { name: "Опытный", price: 34300 },
      { name: "Новые лица", price: 28000 },
      { name: "Первый старт", price: 23200 },
    ]);
    expect(s.text).toBe(
      "Пакет «Квиз», до 25 гостей, будни, продление 30 мин, допы: Логотип на экранах, Призы и медали. " +
        "Вечер ≈ 2–2,5 часа. Итого: Опытный — 34 300 ₽, Новые лица — 28 000 ₽, Первый старт — 23 200 ₽. Дата праздника не указана.",
    );
    const totals = P.calcPrice({ pkg: "quiz", tier: 1, ext: 1, addons: ["prize", "logo"] }).totals.map((t) => t.price);
    expect(s.totals?.map((t) => t.price)).toEqual(totals);
  });

  it("расчёт для заявки: «Под ключ», больше 90 гостей и ещё игры", () => {
    const turnkey = P.calcSummary({ pkg: "turnkey", tier: 5, weekend: true });
    expect(turnkey.type).toBe("Под ключ");
    expect(turnkey.guests).toBeNull();
    expect(turnkey.totals).toBeNull();
    expect(turnkey.text).toContain("больше 90 гостей, пятница–воскресенье");
    expect(turnkey.text).toContain("Итого: обсудим индивидуально.");
    const evening = P.calcSummary({ pkg: "show", tier: 0, extras: ["dance", "show"] });
    expect(evening.parts).toContain("ещё в этот вечер: Танцевальный");
    expect(evening.text.length).toBeLessThanOrEqual(1000);
  });
  it("сообщение менеджеру: строки «что: значение», выбранный формат отмечен", () => {
    const m = P.calcMessage({ pkg: "quiz", tier: 1, ext: 1, addons: ["prize", "logo"] }, "new");
    expect(m.split("\n")).toEqual([
      "🧮 Расчёт JoyRest",
      "────────────",
      "Пакет: Квиз",
      "Гостей: до 25",
      "Дата: не указана",
      "День: будни",
      "Продление: 30 мин",
      "Допы: Логотип на экранах, Призы и медали",
      "Длительность: ≈ 2–2,5 часа",
      "────────────",
      "Стоимость по формату ведущего:",
      "▫️ Опытный: 34 300 ₽",
      "✅ Новые лица (−20%): 28 000 ₽ — выбран",
      "▫️ Первый старт (−35%): 23 200 ₽",
    ]);
    const plain = P.calcMessage({ pkg: "show", tier: 0, weekend: true, extras: ["dance"] }, "");
    expect(plain).toContain("Ещё игры: Танцевальный");
    expect(plain).toContain("Продление: нет");
    expect(plain).not.toContain("✅");
    const turnkey = P.calcMessage({ pkg: "turnkey", tier: 5 }, "standard");
    expect(turnkey).toContain("Пакет: Под ключ");
    expect(turnkey).toContain("Гостей: больше 90");
    expect(turnkey).toContain("Стоимость: обсудим индивидуально");
    expect(turnkey).not.toMatch(/\u00a0/);
  });
  it("время начала — по желанию: строка менеджеру, на цену не влияет, кривое не попадает", () => {
    const base = { pkg: "quiz", tier: 1, date: "2026-11-20", today: "2026-10-23" };
    const m = P.calcMessage({ ...base, time: "19:00" }, "standard").split("\n");
    expect(m[m.indexOf("Дата: 20 ноября 2026, пт") + 1]).toBe("Начало: в 19:00 (примерно, подтвердит менеджер)");
    expect(P.calcSummary({ ...base, time: "19:00" }).text).toContain("начало в 19:00");
    expect(P.calcPrice({ ...base, time: "19:00" }).totals).toEqual(P.calcPrice(base).totals);
    for (const bad of ["25:00", "7:00", "19:60", "", "вечером"]) {
      expect(P.calcMessage({ ...base, time: bad }, "standard")).not.toContain("Начало");
      expect(P.calcSummary({ ...base, time: bad }).text).not.toContain("начало в");
    }
  });
});

/**
 * Праздничная цена (решение владельца 22 октября 2026). Своя независимая модель здесь, в тесте: процент по дате праздника
 * (границы включительно), ранняя бронь до 15 ноября, минимум 50 000 ₽ в новогоднюю ночь, выезд за город по периодам,
 * день недели из даты. Сверяем каждый день трёх лет, все пути калькулятора на ключевых датах и тексты менеджеру.
 */
const DAY = 86400000;
const utc = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y!, m! - 1, d!); };
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
interface Want { kind: string; pct: number; full: number; min: number; travel: number; early: boolean }
function want(date: string, today: string): Want | null {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  let full = 0;
  let min = 0;
  let peak = false;
  let kind = "";
  if ((m === 12 && d === 31) || (m === 1 && d === 1)) { full = 40; min = 50000; peak = true; kind = "nynight"; }
  else if (m === 12 && d >= 19) { full = 40; peak = true; kind = "nypeak"; }
  else if (m === 12 && d >= 5) { full = 20; kind = "nyseason"; }
  else {
    let best = Infinity;
    for (const yy of [y, y + 1]) for (const [hm, hd] of [[2, 14], [2, 23], [3, 8]] as const) {
      const diff = (Date.UTC(yy, hm - 1, hd) - utc(date)) / DAY;
      if (diff >= 0 && diff <= 14) best = Math.min(best, diff);
    }
    if (best === 0) { full = 25; kind = "holiday"; }
    else if (best <= 7) { full = 15; kind = "week"; }
    else if (best <= 14) { full = 10; kind = "twoweeks"; }
  }
  if (!full) return null;
  const early = m === 12 && d >= 5 && d <= 28 && today <= `${y}-11-15`;
  return { kind, pct: early ? full / 2 : full, full, min, travel: peak ? 7000 : 5000, early };
}
const weekendOf = (date: string) => { const wd = new Date(utc(date)).getUTCDay(); return wd === 0 || wd === 5 || wd === 6; };
function modelAt(pkg: string, tier: number, date: string, today: string, extras: string[], ext: number, addons: string[]): { price: number; base: number; extra: number }[] {
  const w = want(date, today);
  let flex = PRICES[pkg]![tier]!;
  let prizes = 0;
  for (const e of extras) flex += Math.ceil((PRICES[e]![tier]! * 0.5) / 100) * 100;
  flex += EXT[ext]!;
  for (const a of addons) {
    if (a === "prize") prizes += 2500;
    else if (a !== "far") flex += ADDONS[a]!;
  }
  const far = addons.includes("far") ? (w ? w.travel : 2000) : 0;
  return LEVELS.map((dsc) => {
    const base = up(flex * (weekendOf(date) ? 1.1 : 1) * (1 - dsc)) + prizes;
    let p = base;
    if (w) {
      p = base + up((base * w.pct) / 100);
      if (w.min && p < w.min) p = w.min;
    }
    return { price: p + far, base, extra: p - base };
  });
}

describe("калькулятор сайта: праздничная цена", () => {
  it("каждый день 2026–2028 × «сегодня» до, в день и после 15 ноября — процент, минимум, выезд, ранняя бронь", () => {
    let days = 0;
    for (let t = utc("2026-01-01"); t <= utc("2028-12-31"); t += DAY) {
      const date = isoOf(t);
      const y = date.slice(0, 4);
      for (const today of [`${y}-01-10`, `${y}-10-22`, `${y}-11-15`, `${y}-11-16`, `${y}-12-20`]) {
        const w = want(date, today);
        const s = P.seasonFor(date, today);
        if (!w) {
          if (s) throw new Error(`${date}: лишняя праздничная цена ${s.pct}%`);
          continue;
        }
        if (!s) throw new Error(`${date}: нет праздничной цены, ждали ${w.pct}%`);
        const got = [s.id, s.pct, s.fullPct, s.min, s.early, s.travel === "peak" ? 7000 : 5000].join();
        const exp = [w.kind, w.pct, w.full, w.min, w.early, w.travel].join();
        if (got !== exp) throw new Error(`${date} (сегодня ${today}): ${got} ≠ ${exp}`);
        if (!s.title || !s.text) throw new Error(`${date}: нет причины`);
      }
      days += 1;
    }
    expect(days).toBe(366 + 365 + 365 - 1 + 1);
  }, 30000);

  it("границы включительно — эталонная таблица", () => {
    const table: [string, string, number | null, number][] = [
      // дата, сегодня, процент (null — без), выезд
      ["2026-12-04", "2026-11-20", null, 2000],
      ["2026-12-05", "2026-11-20", 20, 5000],
      ["2026-12-18", "2026-11-20", 20, 5000],
      ["2026-12-19", "2026-11-20", 40, 7000],
      ["2026-12-28", "2026-11-20", 40, 7000],
      ["2026-12-30", "2026-11-20", 40, 7000],
      ["2026-12-31", "2026-11-20", 40, 7000],
      ["2027-01-01", "2026-11-20", 40, 7000],
      ["2027-01-02", "2026-11-20", null, 2000],
      // ранняя бронь: до 15 ноября включительно, только 5–28 декабря
      ["2026-12-05", "2026-11-15", 10, 5000],
      ["2026-12-18", "2026-11-15", 10, 5000],
      ["2026-12-19", "2026-11-15", 20, 7000],
      ["2026-12-28", "2026-11-15", 20, 7000],
      ["2026-12-29", "2026-11-15", 40, 7000],
      ["2026-12-31", "2026-11-15", 40, 7000],
      ["2027-01-01", "2026-11-15", 40, 7000],
      ["2026-12-10", "2026-11-16", 20, 5000],
      // праздники: 14 → 8 дней — 10%, 7 → 1 — 15%, в сам день — 25%, на следующий день — следующий праздник или ничего
      ["2027-02-22", "2027-01-10", 15, 5000],
      ["2027-02-23", "2027-01-10", 25, 5000],
      ["2027-02-24", "2027-01-10", 10, 5000],
      ["2027-02-28", "2027-01-10", 10, 5000],
      ["2027-03-01", "2027-01-10", 15, 5000],
      ["2027-03-07", "2027-01-10", 15, 5000],
      ["2027-03-08", "2027-01-10", 25, 5000],
      ["2027-03-09", "2027-01-10", null, 2000],
      ["2027-01-30", "2027-01-10", null, 2000],
      ["2027-01-31", "2027-01-10", 10, 5000],
      ["2027-02-06", "2027-01-10", 10, 5000],
      ["2027-02-07", "2027-01-10", 15, 5000],
      ["2027-02-14", "2027-01-10", 25, 5000],
      ["2027-02-15", "2027-01-10", 10, 5000],
      ["2027-02-16", "2027-01-10", 15, 5000],
      ["2027-07-15", "2027-01-10", null, 2000],
    ];
    for (const [date, today, pct, travel] of table) {
      const r = P.calcPrice({ pkg: "quiz", tier: 1, date, today, addons: ["far"] });
      expect(r.season?.pct ?? null, `${date} / ${today}`).toBe(pct);
      expect(r.travel, `${date}: выезд`).toBe(travel);
    }
  });

  const KEY_DATES: [string, string][] = [
    ["2026-11-12", "2026-10-22"], // обычный четверг
    ["2026-12-05", "2026-10-22"], // ранняя бронь, суббота
    ["2026-12-18", "2026-11-20"], // +20%, пятница
    ["2026-12-19", "2026-10-22"], // ранняя бронь пика, суббота
    ["2026-12-29", "2026-10-22"], // пик без ранней брони
    ["2026-12-31", "2026-11-20"], // новогодняя ночь, минимум
    ["2027-02-23", "2027-01-10"], // сам праздник
    ["2027-03-03", "2027-01-10"], // неделя до 8 марта
  ];
  for (const [date, today] of KEY_DATES) {
    it(`все пути калькулятора на дату ${date} (сегодня ${today}) совпадают с моделью`, () => {
      let paths = 0;
      for (const pkg of PACKS) {
        const others = PACKS.filter((p) => p !== pkg);
        for (let tier = 0; tier < 5; tier++) {
          for (const extras of subsets(others).filter((s) => s.length <= 2)) {
            for (let ext = 0; ext < 5; ext++) {
              for (const addons of subsets(Object.keys(ADDONS))) {
                paths += 1;
                // день недели берётся из даты, даже если выбран другой
                const r = P.calcPrice({ pkg, tier, weekend: !weekendOf(date), date, today, extras, ext, addons });
                const want2 = modelAt(pkg, tier, date, today, extras, ext, addons);
                const got = r.totals.map((t) => `${t.price}/${t.base}/${t.extra}`).join();
                const exp = want2.map((t) => `${t.price}/${t.base}/${t.extra}`).join();
                if (got !== exp) throw new Error(`${date} ${pkg}/${tier}/${extras}/${ext}/${addons}: ${got} ≠ ${exp}`);
                if (r.weekend !== weekendOf(date)) throw new Error("день недели не из даты");
                const p = r.totals.map((t) => t.price);
                if (!(p[0]! >= p[1]! && p[1]! >= p[2]!)) throw new Error(`порядок ведущих: ${p}`);
                if (p.some((x) => x % 100 !== 0)) throw new Error(`не кратно 100: ${p}`);
                if (r.totals.some((t) => t.extra < 0)) throw new Error("праздничная цена меньше нуля");
              }
            }
          }
        }
      }
      expect(paths).toBe(6 * 5 * 16 * 5 * 64);
    }, 60000);
  }

  it("праздничная цена считается последней: от итога с выходным, ведущим и призами", () => {
    // Квиз до 25, пятница 18 декабря: 24 900 × 1,1 = 27 400; + призы 2 500 = 29 900; +20% = 5 980 → 6 000.
    const r = P.calcPrice({ pkg: "quiz", tier: 1, date: "2026-12-18", today: "2026-11-20", addons: ["prize"] });
    expect(r.totals.map((t) => [t.base, t.extra, t.price])).toEqual([[29900, 6000, 35900], [24500, 4900, 29400], [20400, 4100, 24500]]);
    // Добавили игру — праздничная цена пересчиталась от новой суммы.
    const more = P.calcPrice({ pkg: "quiz", tier: 1, date: "2026-12-18", today: "2026-11-20", addons: ["prize"], extras: ["game"] });
    expect(more.totals[0]!.base).toBe(up((24900 + 9500) * 1.1) + 2500);
    expect(more.totals[0]!.extra).toBe(up(more.totals[0]!.base * 0.2));
    // Выезд — своей ценой, без процента.
    const far = P.calcPrice({ pkg: "quiz", tier: 1, date: "2026-12-18", today: "2026-11-20", addons: ["prize", "far"] });
    expect(far.totals[0]!.price).toBe(35900 + 5000);
  });

  it("31 декабря и 1 января — не меньше 50 000 ₽ у всех трёх ведущих, выезд сверху", () => {
    for (const date of ["2026-12-31", "2027-01-01", "2027-12-31", "2028-01-01"]) {
      const small = P.calcPrice({ pkg: "game", tier: 0, date, today: "2026-01-10" });
      expect(small.totals.map((t) => t.price), date).toEqual([50000, 50000, 50000]);
      const far = P.calcPrice({ pkg: "game", tier: 0, date, today: "2026-01-10", addons: ["far"] });
      expect(far.totals.map((t) => t.price), date).toEqual([57000, 57000, 57000]);
      // Большой вечер дороже минимума — просто +40%.
      const big = P.calcPrice({ pkg: "show", tier: 4, date, today: "2026-01-10" });
      expect(big.totals[0]!.price).toBe(big.totals[0]!.base + up(big.totals[0]!.base * 0.4));
      expect(big.totals[0]!.price).toBeGreaterThan(50000);
    }
  });

  it("ранняя бронь дешевле поздней на 5–28 декабря и не действует 29 декабря — 1 января", () => {
    for (let t = utc("2026-12-01"); t <= utc("2027-01-02"); t += DAY) {
      const date = isoOf(t);
      const early = P.calcPrice({ pkg: "quiz", tier: 2, date, today: "2026-11-15" }).totals[0]!.price;
      const late = P.calcPrice({ pkg: "quiz", tier: 2, date, today: "2026-11-16" }).totals[0]!.price;
      const d = Number(date.slice(8)), m = Number(date.slice(5, 7));
      if (m === 12 && d >= 5 && d <= 28) expect(early, date).toBeLessThan(late);
      else expect(early, date).toBe(late);
    }
  });

  it("без даты, с кривой или несуществующей датой — как раньше: без праздничной цены, день — из кнопок", () => {
    for (const date of ["", "abc", "2026-02-30", "2026-13-01", "2026-1-5", "10.12.2026"]) {
      const r = P.calcPrice({ pkg: "quiz", tier: 1, weekend: true, date, today: "2026-10-22", addons: ["far"] });
      expect(r.date, date).toBeNull();
      expect(r.season, date).toBeNull();
      expect(r.weekend).toBe(true);
      expect(r.travel).toBe(2000);
      expect(r.totals.map((t) => t.price)).toEqual(prices({ pkg: "quiz", tier: 1, weekend: true, addons: ["far"] }));
    }
    expect(P.parseDate("2028-02-29")).not.toBeNull();
    expect(P.parseDate("2027-02-29")).toBeNull();
  });

  it("«Под ключ» и больше 90 гостей на праздничную дату — без цены, но с причиной", () => {
    for (const o of [{ pkg: "turnkey", tier: 1 }, { pkg: "quiz", tier: 5 }, { pkg: "quiz", tier: 0, extras: ["game", "show", "music"] }]) {
      const r = P.calcPrice({ ...o, date: "2026-12-25", today: "2026-11-20" });
      expect(r.individual).toBe(true);
      expect(r.totals).toEqual([]);
      expect(r.season?.pct).toBe(40);
      const m = P.calcMessage({ ...o, date: "2026-12-25", today: "2026-11-20" }, "standard");
      expect(m).toContain("Стоимость: обсудим индивидуально");
      expect(m).toContain("Праздничная цена: +40% — Пик новогодних корпоративов");
    }
  });

  it("сегодня по Москве: в 23:59 по Москве — ещё тот же день, в 00:00 — следующий", () => {
    expect(P.moscowToday(Date.UTC(2026, 10, 15, 20, 59))).toBe("2026-11-15");
    expect(P.moscowToday(Date.UTC(2026, 10, 15, 21, 0))).toBe("2026-11-16");
    expect(P.moscowToday(Date.UTC(2026, 11, 31, 21, 0))).toBe("2027-01-01");
  });

  it("подсказка «до 4 декабря — без новогодней праздничной цены»: с 14 ноября по 4 декабря", () => {
    expect(P.seasonHint("2026-11-13")).toBe("");
    for (let t = utc("2026-11-14"); t <= utc("2026-12-04"); t += DAY) expect(P.seasonHint(isoOf(t)), isoOf(t)).toContain("до 4 декабря");
    expect(P.seasonHint("2026-12-05")).toBe("");
    expect(P.calcPrice({ pkg: "quiz", tier: 1, date: "2026-11-20", today: "2026-10-22" }).hint).toContain("4 декабря");
  });

  it("сообщение менеджеру: дата, причина, ранняя бронь, из чего цена, выезд с такси", () => {
    const m = P.calcMessage({ pkg: "quiz", tier: 1, date: "2026-12-10", today: "2026-10-22", addons: ["prize", "far"] }, "new");
    expect(m.split("\n")).toEqual([
      "🧮 Расчёт JoyRest",
      "────────────",
      "Пакет: Квиз",
      "Гостей: до 25",
      "Дата: 10 декабря 2026, чт",
      "День: будни",
      "Продление: нет",
      "Допы: Призы и медали, Выезд за город",
      "Выезд за город: 5 000 ₽ + такси ведущему",
      "Длительность: ≈ 1,5–2 часа",
      "Праздничная цена: +10% вместо +20% — Новогодний сезон",
      "Ранняя бронь: до 15 ноября 2026 — посчитано 22 октября 2026",
      "────────────",
      "Стоимость по формату ведущего (праздничная цена уже в итоге):",
      "▫️ Опытный: 35 200 ₽ (27 400 ₽ + 2 800 ₽ праздничная цена + 5 000 ₽ выезд)",
      "✅ Новые лица (−20%): 29 800 ₽ (22 500 ₽ + 2 300 ₽ праздничная цена + 5 000 ₽ выезд) — выбран",
      "▫️ Первый старт (−35%): 25 600 ₽ (18 700 ₽ + 1 900 ₽ праздничная цена + 5 000 ₽ выезд)",
    ]);
    const night = P.calcMessage({ pkg: "game", tier: 0, date: "2026-12-31", today: "2026-11-20" }, "");
    expect(night).toContain("Праздничная цена: +40%, от 50 000 ₽ — Новогодняя ночь");
    expect(night).toContain("▫️ Опытный: 50 000 ₽ (14 900 ₽ → минимум 50 000 ₽)");
    expect(night).not.toContain("Ранняя бронь");
    const holiday = P.calcMessage({ pkg: "quiz", tier: 1, date: "2027-03-08", today: "2027-01-10" }, "standard");
    expect(holiday).toContain("Праздничная цена: +25% — Праздничный день: 8 марта");
    expect(holiday).toContain("✅ Опытный: 31 200 ₽ (24 900 ₽ + 6 300 ₽ праздничная цена) — выбран");
    // Цены сообщения — те же, что у калькулятора.
    const r = P.calcPrice({ pkg: "quiz", tier: 1, date: "2027-03-08", today: "2027-01-10" });
    expect(r.totals[0]!.price).toBe(31200);
  });

  it("строка заявки (поле calc, Telegram владельцу): дата и праздничная цена, не длиннее 1000 знаков на любых выборах", () => {
    const s = P.calcSummary({ pkg: "quiz", tier: 1, date: "2026-12-19", today: "2026-10-22", addons: ["far"] });
    expect(s.date).toBe("19 декабря 2026, сб");
    expect(s.parts).toContain("дата 19 декабря 2026, сб");
    expect(s.parts).toContain("праздничная цена +20% вместо +40% — Пик новогодних корпоративов (ранняя бронь до 15 ноября 2026)");
    expect(s.parts).toContain("выезд за город 7 000 ₽ + такси ведущему");
    expect(s.text).toContain("Итого (праздничная цена уже в итоге): Опытный —");
    let longest = 0;
    for (const [date, today] of KEY_DATES) {
      for (const pkg of [...PACKS, "turnkey"]) {
        const all = P.calcSummary({ pkg, tier: 4, date, today, extras: PACKS.filter((p) => p !== pkg).slice(0, 2), ext: 4, addons: Object.keys(ADDONS) });
        longest = Math.max(longest, all.text.length);
      }
    }
    expect(longest).toBeLessThanOrEqual(1000);
  });

  it("дальше по цепочке: менеджер вставляет расчёт в планировщик — дата, гости и программа разбираются, цены не берутся", () => {
    for (const [date, today] of KEY_DATES) {
      const msg = P.calcMessage({ pkg: "quiz", tier: 2, date, today, extras: ["music"], ext: 2, addons: ["logo", "prize", "far"] }, "standard");
      expect(msg).toMatch(/Расч[её]т\s+JoyRest/); // так его узнаёт бот в Telegram для бизнеса
      const fill = parseLeadText(msg, today);
      expect(fill.day, date).toBe(date);
      expect(fill.guests, date).toBe(45);
      const program = programFromCalc(msg);
      expect(program?.formats).toEqual(["Квиз", "Музыкальный"]);
      expect(program?.extension).toBe("1 ч");
      expect(program?.addons).toEqual(["Логотип на экранах", "Призы и медали", "Выезд за город"]);
      const line = P.calcSummary({ pkg: "quiz", tier: 2, date, today, extras: ["music"], ext: 2, addons: ["far"] }).text;
      expect(parseLeadText(line, today).day, date).toBe(date);
      expect(programFromCalc(line)?.addons).toEqual(["Выезд за город"]);
    }
    // Старые программы с «Выездом за Московскую область» читаются как «Выезд за город».
    expect(programFromCalc("Пакет: Квиз\nДопы: Выезд за Московскую область")?.addons).toEqual(["Выезд за город"]);
  });
});
