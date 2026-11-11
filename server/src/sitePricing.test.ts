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
interface Season { id: string; ny: boolean; label: string; pct: number; min: number; travel: string; title: string; text: string; holiday?: string }
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
interface Options { pkg: string; tier: number; weekend?: boolean; extras?: string[]; ext?: number; addons?: string[]; date?: string; time?: string; today?: string; name?: string }
interface Summary { type: string; guests: number | null; parts: string[]; totals: { name: string; price: number }[] | null; duration: string; season: string; date: string; text: string }
interface Pricing {
  calcPrice(o: Options): Result;
  calcSummary(o: Options): Summary;
  calcMessage(o: Options, level: string): string;
  hoursWord(n: number): string;
  gamesWord(n: number): string;
  seasonFor(date: string): Season | null;
  seasonHint(date: string): string;
  seasonBadge(s: Season | null): string;
  moscowToday(nowMs?: number): string;
  parseDate(iso: string): { y: number; m: number; d: number; t: number; wd: number } | null;
  telegramText(text: string): string;
  cleanName(n: unknown): string;
  mailLinks(text: string, subject?: string): { gmail: string; yandex: string; mailru: string; app: string };
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
  it("«Как к вам обращаться» — по желанию: первой строкой «Имя», мусор вырезается, в краткий расчёт не идёт", () => {
    const m = P.calcMessage({ pkg: "quiz", tier: 1, name: "  Анна-Мария  " }, "standard").split("\n");
    expect(m[2]).toBe("Имя: Анна-Мария");
    expect(m[3]).toBe("Пакет: Квиз");
    expect(P.calcMessage({ pkg: "quiz", tier: 1, name: "   " }, "standard")).not.toContain("Имя:");
    expect(P.calcMessage({ pkg: "quiz", tier: 1 }, "standard")).not.toContain("Имя:");
    expect(P.cleanName("<b>Олег</b> +7 915 000-00-00")).toBe("b Олег b");
    expect(P.cleanName("Ёлка O'Neil")).toBe("Ёлка O'Neil");
    expect(P.cleanName("Я".repeat(80)).length).toBe(40);
    expect(P.cleanName(null)).toBe("");
    expect(P.calcSummary({ pkg: "quiz", tier: 1, name: "Анна" } as Options).text).not.toContain("Анна");
  });
});

/**
 * Новогодняя надбавка (решение владельца 11 ноября 2026) и праздничная цена (22 октября 2026). Своя независимая модель
 * здесь, в тесте: процент по дате праздника (границы включительно), без ранней брони и без зависимости от «сегодня»,
 * минимум 50 000 ₽ в новогоднюю ночь, выезд за город по периодам, день недели из даты. Сверяем каждый день трёх лет,
 * все пути калькулятора на ключевых датах и тексты менеджеру.
 */
const DAY = 86400000;
const utc = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y!, m! - 1, d!); };
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
interface Want { kind: string; pct: number; min: number; travel: number; ny: boolean }
function want(date: string): Want | null {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  let pct = 0;
  let min = 0;
  let peak = false;
  let kind = "";
  if ((m === 12 && d === 31) || (m === 1 && d === 1)) { pct = 35; min = 50000; peak = true; kind = "nynight"; }
  else if (m === 12 && d >= 21) { pct = 35; peak = true; kind = "nypeak"; }
  else if (m === 12 && d >= 10) { pct = 20; kind = "nyseason"; }
  else {
    let best = Infinity;
    for (const yy of [y, y + 1]) for (const [hm, hd] of [[2, 14], [2, 23], [3, 8]] as const) {
      const diff = (Date.UTC(yy, hm - 1, hd) - utc(date)) / DAY;
      if (diff >= 0 && diff <= 14) best = Math.min(best, diff);
    }
    if (best === 0) { pct = 25; kind = "holiday"; }
    else if (best <= 7) { pct = 15; kind = "week"; }
    else if (best <= 14) { pct = 10; kind = "twoweeks"; }
  }
  if (!pct) return null;
  return { kind, pct, min, travel: peak ? 7000 : 5000, ny: kind.startsWith("ny") };
}
const weekendOf = (date: string) => { const wd = new Date(utc(date)).getUTCDay(); return wd === 0 || wd === 5 || wd === 6; };
function modelAt(pkg: string, tier: number, date: string, extras: string[], ext: number, addons: string[]): { price: number; base: number; extra: number }[] {
  const w = want(date);
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

describe("калькулятор сайта: новогодняя надбавка и праздничная цена", () => {
  it("каждый день 2026–2028 — процент, минимум, выезд, название; «сегодня» на цену не влияет (ранней брони нет)", () => {
    let days = 0;
    for (let t = utc("2026-01-01"); t <= utc("2028-12-31"); t += DAY) {
      const date = isoOf(t);
      const w = want(date);
      const s = P.seasonFor(date);
      if (!w) {
        if (s) throw new Error(`${date}: лишняя надбавка ${s.pct}%`);
      } else {
        if (!s) throw new Error(`${date}: нет надбавки, ждали ${w.pct}%`);
        const got = [s.id, s.pct, s.min, s.ny, s.label, s.travel === "peak" ? 7000 : 5000].join();
        const exp = [w.kind, w.pct, w.min, w.ny, w.ny ? "Новогодняя надбавка" : "Праздничная цена", w.travel].join();
        if (got !== exp) throw new Error(`${date}: ${got} ≠ ${exp}`);
        if (!s.title || !s.text) throw new Error(`${date}: нет причины`);
        if ("early" in s || "fullPct" in s) throw new Error(`${date}: остатки ранней брони`);
      }
      // Тот же расчёт при любом «сегодня» (поле today осталось только у старых вызовов и игнорируется).
      const a = P.calcPrice({ pkg: "quiz", tier: 1, date, today: "2026-11-01", addons: ["far"] });
      const b = P.calcPrice({ pkg: "quiz", tier: 1, date, today: "2026-11-30", addons: ["far"] });
      if (JSON.stringify(a.totals) !== JSON.stringify(b.totals)) throw new Error(`${date}: цена зависит от «сегодня»`);
      days += 1;
    }
    expect(days).toBe(366 + 365 + 365 - 1 + 1);
  }, 30000);

  it("границы включительно — эталонная таблица", () => {
    const table: [string, number | null, number, string][] = [
      // дата, процент (null — без), выезд, название
      ["2026-12-04", null, 2000, ""],
      ["2026-12-05", null, 2000, ""],
      ["2026-12-09", null, 2000, ""],
      ["2026-12-10", 20, 5000, "Новогодняя надбавка"],
      ["2026-12-18", 20, 5000, "Новогодняя надбавка"],
      ["2026-12-19", 20, 5000, "Новогодняя надбавка"],
      ["2026-12-20", 20, 5000, "Новогодняя надбавка"],
      ["2026-12-21", 35, 7000, "Новогодняя надбавка"],
      ["2026-12-28", 35, 7000, "Новогодняя надбавка"],
      ["2026-12-30", 35, 7000, "Новогодняя надбавка"],
      ["2026-12-31", 35, 7000, "Новогодняя надбавка"],
      ["2027-01-01", 35, 7000, "Новогодняя надбавка"],
      ["2027-01-02", null, 2000, ""],
      ["2027-01-08", null, 2000, ""],
      // праздники: 14 → 8 дней — 10%, 7 → 1 — 15%, в сам день — 25%, на следующий день — следующий праздник или ничего
      ["2027-02-22", 15, 5000, "Праздничная цена"],
      ["2027-02-23", 25, 5000, "Праздничная цена"],
      ["2027-02-24", 10, 5000, "Праздничная цена"],
      ["2027-02-28", 10, 5000, "Праздничная цена"],
      ["2027-03-01", 15, 5000, "Праздничная цена"],
      ["2027-03-07", 15, 5000, "Праздничная цена"],
      ["2027-03-08", 25, 5000, "Праздничная цена"],
      ["2027-03-09", null, 2000, ""],
      ["2027-01-30", null, 2000, ""],
      ["2027-01-31", 10, 5000, "Праздничная цена"],
      ["2027-02-06", 10, 5000, "Праздничная цена"],
      ["2027-02-07", 15, 5000, "Праздничная цена"],
      ["2027-02-14", 25, 5000, "Праздничная цена"],
      ["2027-02-15", 10, 5000, "Праздничная цена"],
      ["2027-02-16", 15, 5000, "Праздничная цена"],
      ["2027-07-15", null, 2000, ""],
    ];
    for (const [date, pct, travel, label] of table) {
      const r = P.calcPrice({ pkg: "quiz", tier: 1, date, addons: ["far"] });
      expect(r.season?.pct ?? null, date).toBe(pct);
      expect(r.season?.label ?? "", date).toBe(label);
      expect(r.travel, `${date}: выезд`).toBe(travel);
    }
  });

  const KEY_DATES: [string, string][] = [
    // дата праздника, «сегодня» (для разбора планировщиком)
    ["2026-11-12", "2026-11-11"], // обычный четверг
    ["2026-12-05", "2026-11-11"], // суббота, надбавки ещё нет
    ["2026-12-10", "2026-11-11"], // первый день +20%, четверг
    ["2026-12-19", "2026-11-11"], // +20%, суббота
    ["2026-12-21", "2026-11-11"], // первый день +35%, понедельник
    ["2026-12-31", "2026-11-20"], // новогодняя ночь, минимум
    ["2027-02-23", "2027-01-10"], // сам праздник
    ["2027-03-03", "2027-01-10"], // неделя до 8 марта
  ];
  for (const [date] of KEY_DATES) {
    it(`все пути калькулятора на дату ${date} совпадают с моделью`, () => {
      let paths = 0;
      for (const pkg of PACKS) {
        const others = PACKS.filter((p) => p !== pkg);
        for (let tier = 0; tier < 5; tier++) {
          for (const extras of subsets(others).filter((s) => s.length <= 2)) {
            for (let ext = 0; ext < 5; ext++) {
              for (const addons of subsets(Object.keys(ADDONS))) {
                paths += 1;
                // день недели берётся из даты, даже если выбран другой
                const r = P.calcPrice({ pkg, tier, weekend: !weekendOf(date), date, extras, ext, addons });
                const want2 = modelAt(pkg, tier, date, extras, ext, addons);
                const got = r.totals.map((t) => `${t.price}/${t.base}/${t.extra}`).join();
                const exp = want2.map((t) => `${t.price}/${t.base}/${t.extra}`).join();
                if (got !== exp) throw new Error(`${date} ${pkg}/${tier}/${extras}/${ext}/${addons}: ${got} ≠ ${exp}`);
                if (r.weekend !== weekendOf(date)) throw new Error("день недели не из даты");
                const p = r.totals.map((t) => t.price);
                if (!(p[0]! >= p[1]! && p[1]! >= p[2]!)) throw new Error(`порядок ведущих: ${p}`);
                if (p.some((x) => x % 100 !== 0)) throw new Error(`не кратно 100: ${p}`);
                if (r.totals.some((t) => t.extra < 0)) throw new Error("надбавка меньше нуля");
              }
            }
          }
        }
      }
      expect(paths).toBe(6 * 5 * 16 * 5 * 64);
    }, 60000);
  }

  it("надбавка считается последней: от итога с выходным, ведущим и призами", () => {
    // Квиз до 25, пятница 18 декабря: 24 900 × 1,1 = 27 400; + призы 2 500 = 29 900; +20% = 5 980 → 6 000.
    const r = P.calcPrice({ pkg: "quiz", tier: 1, date: "2026-12-18", addons: ["prize"] });
    expect(r.totals.map((t) => [t.base, t.extra, t.price])).toEqual([[29900, 6000, 35900], [24500, 4900, 29400], [20400, 4100, 24500]]);
    // Добавили игру — надбавка пересчиталась от новой суммы.
    const more = P.calcPrice({ pkg: "quiz", tier: 1, date: "2026-12-18", addons: ["prize"], extras: ["game"] });
    expect(more.totals[0]!.base).toBe(up((24900 + 9500) * 1.1) + 2500);
    expect(more.totals[0]!.extra).toBe(up(more.totals[0]!.base * 0.2));
    // Выезд — своей ценой, без процента.
    const far = P.calcPrice({ pkg: "quiz", tier: 1, date: "2026-12-18", addons: ["prize", "far"] });
    expect(far.totals[0]!.price).toBe(35900 + 5000);
    // Понедельник 21 декабря: +35%. 24 900 × 1,35 = 33 615 → 33 700.
    expect(P.calcPrice({ pkg: "quiz", tier: 1, date: "2026-12-21" }).totals[0]!.price).toBe(33700);
    // 9 декабря (среда) — без надбавки, 10 декабря (четверг) — +20%.
    expect(P.calcPrice({ pkg: "quiz", tier: 1, date: "2026-12-09" }).totals[0]!.price).toBe(24900);
    expect(P.calcPrice({ pkg: "quiz", tier: 1, date: "2026-12-10" }).totals[0]!.price).toBe(29900);
  });

  it("31 декабря и 1 января — не меньше 50 000 ₽ у всех трёх ведущих, выезд сверху", () => {
    for (const date of ["2026-12-31", "2027-01-01", "2027-12-31", "2028-01-01"]) {
      const small = P.calcPrice({ pkg: "game", tier: 0, date });
      expect(small.totals.map((t) => t.price), date).toEqual([50000, 50000, 50000]);
      const far = P.calcPrice({ pkg: "game", tier: 0, date, addons: ["far"] });
      expect(far.totals.map((t) => t.price), date).toEqual([57000, 57000, 57000]);
      // Большой вечер дороже минимума — просто +35%.
      const big = P.calcPrice({ pkg: "show", tier: 4, date });
      expect(big.totals[0]!.price).toBe(big.totals[0]!.base + up(big.totals[0]!.base * 0.35));
      expect(big.totals[0]!.price).toBeGreaterThan(50000);
    }
  });

  it("ранней брони больше нет: ни в расчёте, ни в данных, ни в текстах", () => {
    const api = P as unknown as Record<string, unknown>;
    expect(api.EARLY_UNTIL).toBeUndefined();
    expect(api.earlyUntilLabel).toBeUndefined();
    for (let t = utc("2026-12-01"); t <= utc("2027-01-02"); t += DAY) {
      const date = isoOf(t);
      const m = P.calcMessage({ pkg: "quiz", tier: 2, date, today: "2026-11-01" }, "standard");
      expect(m, date).not.toMatch(/ранн|вместо/i);
      expect(P.calcSummary({ pkg: "quiz", tier: 2, date }).text, date).not.toMatch(/ранн|вместо/i);
    }
  });

  it("без даты, с кривой или несуществующей датой — как раньше: без надбавки, день — из кнопок", () => {
    for (const date of ["", "abc", "2026-02-30", "2026-13-01", "2026-1-5", "10.12.2026"]) {
      const r = P.calcPrice({ pkg: "quiz", tier: 1, weekend: true, date, addons: ["far"] });
      expect(r.date, date).toBeNull();
      expect(r.season, date).toBeNull();
      expect(r.weekend).toBe(true);
      expect(r.travel).toBe(2000);
      expect(r.totals.map((t) => t.price)).toEqual(prices({ pkg: "quiz", tier: 1, weekend: true, addons: ["far"] }));
    }
    expect(P.parseDate("2028-02-29")).not.toBeNull();
    expect(P.parseDate("2027-02-29")).toBeNull();
    // Пока год набирают с клавиатуры, браузер отдаёт «0002-12-15» — это ещё не дата, надбавка не падает.
    for (const date of ["0002-12-15", "0020-12-15", "0202-12-15", "1999-12-31", "3000-01-01"]) {
      expect(P.parseDate(date), date).toBeNull();
      expect(P.calcPrice({ pkg: "quiz", tier: 1, weekend: true, date }).date, date).toBeNull();
    }
  });

  it("Telegram: в тексте ссылки нет «%», «+» и «&» — иначе Telegram обрезает расчёт", () => {
    const opts = { pkg: "quiz", tier: 2, weekend: true, date: "2026-12-20", time: "19:00", ext: 2, addons: ["prizes", "far", "logo"] };
    const text = P.calcMessage(opts, "new");
    expect(text).toMatch(/[%+]/);
    const tg = P.telegramText(text);
    expect(tg).not.toMatch(/[%+&]/);
    expect(tg.split("\n").length).toBe(text.split("\n").length);
    expect(tg).toContain("Расчёт JoyRest");
    expect(tg).toContain("＋20％");
    expect(P.telegramText("A & B")).toBe("A  и  B");
  });

  it("почта: письмо на joyrest@mail.ru в Gmail, Яндексе, Mail.ru и почтовой программе — с полным расчётом", () => {
    const text = P.calcMessage({ pkg: "quiz", tier: 2, weekend: true, date: "2026-12-20", time: "19:00" }, "new");
    const m = P.mailLinks(text);
    const gm = new URL(m.gmail);
    expect(gm.origin).toBe("https://mail.google.com");
    expect(gm.searchParams.get("to")).toBe("joyrest@mail.ru");
    expect(gm.searchParams.get("su")).toBe("Расчёт JoyRest");
    expect(gm.searchParams.get("body")).toBe(text);
    for (const [url, origin] of [[m.yandex, "https://mail.yandex.ru"], [m.mailru, "https://e.mail.ru"]] as const) {
      const u = new URL(url);
      expect(u.origin).toBe(origin);
      expect(u.searchParams.get("mailto")).toBe(m.app);
    }
    expect(m.app.startsWith("mailto:joyrest@mail.ru?subject=")).toBe(true);
    expect(decodeURIComponent(m.app.split("&body=")[1])).toBe(text);
    expect(text).toContain("Дата: 20 декабря 2026");
  });

  it("«Под ключ» и больше 90 гостей на праздничную дату — без цены, но с причиной", () => {
    for (const o of [{ pkg: "turnkey", tier: 1 }, { pkg: "quiz", tier: 5 }, { pkg: "quiz", tier: 0, extras: ["game", "show", "music"] }]) {
      const r = P.calcPrice({ ...o, date: "2026-12-25" });
      expect(r.individual).toBe(true);
      expect(r.totals).toEqual([]);
      expect(r.season?.pct).toBe(35);
      const m = P.calcMessage({ ...o, date: "2026-12-25" }, "standard");
      expect(m).toContain("Стоимость: обсудим индивидуально");
      expect(m).toContain("Новогодняя надбавка: +35% — Пик новогодних праздников");
    }
  });

  it("сегодня по Москве: в 23:59 по Москве — ещё тот же день, в 00:00 — следующий", () => {
    expect(P.moscowToday(Date.UTC(2026, 10, 15, 20, 59))).toBe("2026-11-15");
    expect(P.moscowToday(Date.UTC(2026, 10, 15, 21, 0))).toBe("2026-11-16");
    expect(P.moscowToday(Date.UTC(2026, 11, 31, 21, 0))).toBe("2027-01-01");
  });

  it("подсказка «до 9 декабря — без новогодней надбавки»: с 1 ноября по 9 декабря", () => {
    expect(P.seasonHint("2026-10-31")).toBe("");
    for (let t = utc("2026-11-01"); t <= utc("2026-12-09"); t += DAY) expect(P.seasonHint(isoOf(t)), isoOf(t)).toContain("до 9 декабря");
    expect(P.seasonHint("2026-12-10")).toBe("");
    expect(P.calcPrice({ pkg: "quiz", tier: 1, date: "2026-11-20" }).hint).toContain("9 декабря");
    expect(P.calcPrice({ pkg: "quiz", tier: 1, date: "2026-12-07" }).hint).toContain("С 10 декабря");
  });

  it("сообщение менеджеру: дата, причина, из чего цена, выезд с такси", () => {
    const m = P.calcMessage({ pkg: "quiz", tier: 1, date: "2026-12-10", addons: ["prize", "far"] }, "new");
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
      "Новогодняя надбавка: +20% — Новогодний сезон",
      "────────────",
      "Стоимость по формату ведущего (новогодняя надбавка уже в итоге):",
      "▫️ Опытный: 37 900 ₽ (27 400 ₽ + 5 500 ₽ новогодняя надбавка + 5 000 ₽ выезд)",
      "✅ Новые лица (−20%): 32 000 ₽ (22 500 ₽ + 4 500 ₽ новогодняя надбавка + 5 000 ₽ выезд) — выбран",
      "▫️ Первый старт (−35%): 27 500 ₽ (18 700 ₽ + 3 800 ₽ новогодняя надбавка + 5 000 ₽ выезд)",
    ]);
    const night = P.calcMessage({ pkg: "game", tier: 0, date: "2026-12-31" }, "");
    expect(night).toContain("Новогодняя надбавка: +35%, от 50 000 ₽ — Новогодняя ночь");
    expect(night).toContain("▫️ Опытный: 50 000 ₽ (14 900 ₽ → минимум 50 000 ₽)");
    const holiday = P.calcMessage({ pkg: "quiz", tier: 1, date: "2027-03-08" }, "standard");
    expect(holiday).toContain("Праздничная цена: +25% — Праздничный день: 8 марта");
    expect(holiday).toContain("Стоимость по формату ведущего (праздничная цена уже в итоге):");
    expect(holiday).toContain("✅ Опытный: 31 200 ₽ (24 900 ₽ + 6 300 ₽ праздничная цена) — выбран");
    // Цены сообщения — те же, что у калькулятора.
    const r = P.calcPrice({ pkg: "quiz", tier: 1, date: "2027-03-08" });
    expect(r.totals[0]!.price).toBe(31200);
  });

  it("строка заявки (поле calc, Telegram владельцу): дата и надбавка, не длиннее 1000 знаков на любых выборах", () => {
    const s = P.calcSummary({ pkg: "quiz", tier: 1, date: "2026-12-22", addons: ["far"] });
    expect(s.date).toBe("22 декабря 2026, вт");
    expect(s.parts).toContain("дата 22 декабря 2026, вт");
    expect(s.parts).toContain("новогодняя надбавка +35% — Пик новогодних праздников");
    expect(s.parts).toContain("выезд за город 7 000 ₽ + такси ведущему");
    expect(s.text).toContain("Итого (новогодняя надбавка уже в итоге): Опытный —");
    expect(P.calcSummary({ pkg: "quiz", tier: 1, date: "2027-03-08" }).text).toContain("Итого (праздничная цена уже в итоге)");
    let longest = 0;
    for (const [date] of KEY_DATES) {
      for (const pkg of [...PACKS, "turnkey"]) {
        const all = P.calcSummary({ pkg, tier: 4, date, extras: PACKS.filter((p) => p !== pkg).slice(0, 2), ext: 4, addons: Object.keys(ADDONS) });
        longest = Math.max(longest, all.text.length);
      }
    }
    expect(longest).toBeLessThanOrEqual(1000);
  });

  it("дальше по цепочке: менеджер вставляет расчёт в планировщик — дата, гости и программа разбираются, цены не берутся", () => {
    for (const [date, today] of KEY_DATES) {
      const msg = P.calcMessage({ pkg: "quiz", tier: 2, date, extras: ["music"], ext: 2, addons: ["logo", "prize", "far"] }, "standard");
      expect(msg).toMatch(/Расч[её]т\s+JoyRest/); // так его узнаёт бот в Telegram для бизнеса
      const fill = parseLeadText(msg, today);
      expect(fill.day, date).toBe(date);
      expect(fill.guests, date).toBe(45);
      const program = programFromCalc(msg);
      expect(program?.formats).toEqual(["Квиз", "Музыкальный"]);
      expect(program?.extension).toBe("1 ч");
      expect(program?.addons).toEqual(["Логотип на экранах", "Призы и медали", "Выезд за город"]);
      const line = P.calcSummary({ pkg: "quiz", tier: 2, date, extras: ["music"], ext: 2, addons: ["far"] }).text;
      expect(parseLeadText(line, today).day, date).toBe(date);
      expect(programFromCalc(line)?.addons).toEqual(["Выезд за город"]);
    }
    // Старые программы с «Выездом за Московскую область» читаются как «Выезд за город».
    expect(programFromCalc("Пакет: Квиз\nДопы: Выезд за Московскую область")?.addons).toEqual(["Выезд за город"]);
    // Старый расчёт с ранней бронью (присланный до 11 ноября 2026) по-прежнему даёт дату праздника, а не «15 ноября».
    const old = "🧮 Расчёт JoyRest\n────────────\nПакет: Квиз\nГостей: до 25\nДата: 10 декабря 2026, чт\nДень: будни\nПраздничная цена: +10% вместо +20% — Новогодний сезон\nРанняя бронь: до 15 ноября 2026 — посчитано 22 октября 2026";
    expect(parseLeadText(old, "2026-11-11").day).toBe("2026-12-10");
    expect(programFromCalc(old)?.formats).toEqual(["Квиз"]);
  });
});

describe("готовые пакеты (решение владельца 7–8 ноября 2026)", () => {
  interface Bundle { id: string; name: string; tag: string; time: string; price: number; sub: string; includes: string[]; calc: { pkg: string; extras: string[]; addons: string[] }; compare?: boolean; guests?: string }
  const B = P as unknown as Pricing & {
    BUNDLES: Bundle[];
    BUNDLE_TIER: number;
    bundleById(id: string): Bundle | null;
    bundleCalcPrice(b: Bundle): number;
    bundleMessage(id: string, name?: string): string;
  };
  const html = readFileSync(join(root, "site/index.html"), "utf8");
  const nb = (s: string) => s.replace(/ /g, " ");
  const rub = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ₽";

  it("семь пакетов; каждый дешевле той же сборки в калькуляторе (опытный, будни, до 25 гостей), цена кратна 100", () => {
    expect(B.BUNDLES.map((b) => b.id)).toEqual(["joyrest", "tvshow", "nyshow", "nyquiz", "mix", "mafia", "kids"]);
    expect(B.TIERS[B.BUNDLE_TIER]).toBe(25);
    // «Телешоу» и детский (решение владельца 11 ноября 2026): 24 900 ₽ и 10 900 ₽ (до 10 детей, 1,5 часа — без сравнения с калькулятором).
    expect(B.bundleById("tvshow")?.price).toBe(24900);
    expect(B.bundleById("kids")).toMatchObject({ price: 10900, guests: "до 10 детей", time: "1,5 часа", compare: false });
    for (const b of B.BUNDLES) {
      expect(b.price % 100, b.name).toBe(0);
      expect(b.includes.length, b.name).toBeGreaterThanOrEqual(3);
      if (b.compare === false) continue;
      const calc = B.bundleCalcPrice(b);
      // Независимо: пакет + добавленные игры по 50% + обычные допы → вверх до 100 → + призы.
      const flex = PRICES[b.calc.pkg]![1]! + b.calc.extras.reduce((s, id) => s + Math.ceil(PRICES[id]![1]! * 0.5 / 100) * 100, 0)
        + b.calc.addons.filter((a) => !FIXED.has(a)).reduce((s, a) => s + ADDONS[a]!, 0);
      const fixed = b.calc.addons.filter((a) => FIXED.has(a)).reduce((s, a) => s + ADDONS[a]!, 0);
      expect(calc, b.name).toBe(up(flex) + fixed);
      expect(b.price % 100, b.name).toBe(0);
      expect(calc - b.price, b.name).toBeGreaterThanOrEqual(1000);
      expect(calc - b.price, b.name).toBeLessThanOrEqual(4500);
      expect(b.includes.length, b.name).toBeGreaterThanOrEqual(3);
    }
    expect(B.bundleById("joyrest")?.price).toBe(29900);
    expect(Math.max(...B.BUNDLES.map((b) => b.price))).toBeLessThan(30000);
  });

  it("карточки на странице — те же названия, цены, зачёркнутая цена калькулятора и выгода; кнопка «Выбрать пакет» у каждой", () => {
    const cards = [...html.matchAll(/<article class="bundle[^"]*" data-bundle-card="(\w+)">([\s\S]*?)<\/article>/g)];
    expect(cards.map((c) => c[1])).toEqual(B.BUNDLES.map((b) => b.id));
    for (const [, id, body] of cards) {
      const b = B.bundleById(id ?? "")!;
      const text = nb(body ?? "");
      const calc = B.bundleCalcPrice(b);
      expect(text, b.name).toContain(`<h3 class="bundle__name">${b.name}</h3>`);
      expect(text, b.name).toContain(`<b data-bundle-price>${rub(b.price)}</b>`);
      if (b.compare === false) {
        expect(text, b.name).not.toContain("data-bundle-old");
        expect(text, b.name).not.toContain("Выгода");
      } else {
        expect(text, b.name).toContain(`<span class="vh">в калькуляторе </span>${rub(calc)}</s>`);
        expect(text, b.name).toContain(`Выгода ${rub(calc - b.price)}`);
      }
      expect(text, b.name).toContain(`<span class="bundle__time">${b.time}</span>`);
      expect(text, b.name).toContain(`data-bundle="${b.id}">Выбрать пакет</a>`);
      for (const line of b.includes) expect(text, line).toContain(`<span>${line}</span>`);
    }
    // Пакеты — первый раздел «Пакеты и цены» (11 ноября 2026), калькулятор «Свой вечер» — ниже, после игр и «Как играют гости»;
    // в заявке — свой вариант «Тип мероприятия».
    expect(html.indexOf('id="packages"')).toBeGreaterThan(html.indexOf('<section id="prices"'));
    expect(html.indexOf('id="packages"')).toBeLessThan(html.indexOf('<section id="look"'));
    expect(html.indexOf('<section id="games"')).toBeLessThan(html.indexOf('<section id="calculator"'));
    expect(html.indexOf('<section id="platform"')).toBeLessThan(html.indexOf('<section id="calculator"'));
    expect(html.indexOf('id="packages"')).toBeLessThan(html.indexOf('id="calcPacks"'));
    for (const b of B.BUNDLES) expect(html).toContain(`<option>Готовый пакет «${b.name}»</option>`);
    expect(nb(html)).toContain("Цены — с опытным ведущим, в будни, до 25 гостей; «День рождения ребёнка» — до 10 детей, 1,5 часа.");
    expect(nb(html)).toContain("с 10 декабря — новогодняя надбавка, перед 14 февраля, 23 февраля и 8 марта — праздничная цена");
    // Скрытая подпись «в калькуляторе» не должна растягивать страницу: карточки и лента — точка отсчёта.
    const css = readFileSync(join(root, "site/css/style.css"), "utf8");
    expect(css).toMatch(/\.bundles\{ position: relative;/);
    expect(css).toMatch(/\.bundle\{ position: relative;/);
  });

  it("сообщение менеджеру о пакете: состав, цена, условия; имя — только очищенное", () => {
    const text = nb(B.bundleMessage("mix", "Анна<script>"));
    expect(text.split("\n")[0]).toBe("🎁 Готовый пакет JoyRest");
    expect(text).toContain("Имя: Анна");
    expect(text).not.toContain("<");
    expect(text).toContain("Пакет: Всего понемногу");
    expect(text).toContain("Гостей: до 25");
    expect(text).toContain("Цена: 24 900 ₽ — опытный ведущий, будни");
    expect(text).toContain("Программа: Музыкальный\nДопы: Танцевальная пауза\nДлительность: ≈ 1,5–2 часа");
    expect(text).toContain("выходные, новогодняя надбавка и праздничные дни — по правилам калькулятора");
    const kids = nb(B.bundleMessage("kids"));
    expect(kids).toContain("Пакет: День рождения ребёнка");
    expect(kids).toContain("Длительность: 1,5 часа\nГостей: до 10 детей");
    expect(kids).toContain("Цена: 10 900 ₽ — опытный ведущий, будни, до 10 детей");
    expect(nb(B.bundleMessage("tvshow"))).toContain("Цена: 24 900 ₽ — опытный ведущий, будни");
    // Студия разбирает сообщение пакета («Заполнить из сообщения», «Вставить расчёт», бот): даты клиент не называл — её нет.
    for (const b of B.BUNDLES) {
      for (const today of ["2026-11-08", "2027-01-10", "2027-06-01"]) {
        const fill = parseLeadText(B.bundleMessage(b.id, "Анна"), today);
        expect(fill.day, `${b.name} ${today}`).toBeUndefined();
        expect(fill.clientName, b.name).toBe("Анна");
      }
    }
    expect(nb(B.bundleMessage("joyrest"))).toContain("Программа: Квиз → Игровой вечер\nДопы: нет\nДлительность: ≈ 2,5–3 часа");
    // Тема письма у пакета — своя, у расчёта — прежняя.
    expect(decodeURIComponent(P.mailLinks("x", "Готовый пакет JoyRest").gmail)).toContain("su=Готовый пакет JoyRest");
    expect(decodeURIComponent(P.mailLinks("x").gmail)).toContain("su=Расчёт JoyRest");
    expect(text).toContain("праздничные дни — по правилам калькулятора");
    expect(B.bundleMessage("mix")).not.toContain("Имя:");
    expect(B.bundleMessage("nope")).toBe("");
  });

  it("«Как проходят наши вечера»: 6 фото целиком (img/moment-*.webp), подписи и формат у каждого", () => {
    const thumbs = [...html.matchAll(/<button type="button" class="moments__thumb[^"]*" data-moment="(\d)" data-tag="([^"]+)" data-cap="([^"]+)" data-alt="([^"]+)"[^>]*><img src="(img\/moment-[a-z]+\.webp)" alt=""/g)];
    expect(thumbs).toHaveLength(6);
    for (const t of thumbs) expect(readFileSync(join(root, "site", t[5] ?? "")).length).toBeGreaterThan(1000);
    expect(html).toContain('id="momentImg" src="img/moment-mafia.webp"');
    // Свадьбы на сайте — «скоро / на заказ»: подпись фото это не нарушает.
    expect(html).toContain('data-tag="Свадьбы — на заказ"');
  });
});
