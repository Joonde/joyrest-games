import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { OWNER_CHECKS, OWNER_SETUP, SALES_ESCALATE, SALES_NEVER, SALES_PRICES, SALES_SECTIONS, SALES_SELF_CHECK } from "../../src/core/salesGuide";

/**
 * Инструкция менеджера по продажам (`src/core/salesGuide.ts`): цены в ней совпадают с калькулятором сайта,
 * слова — с условиями сайта («предоплата», не «залог»), в каждом разделе есть что делать.
 */
const root = resolve(import.meta.dirname, "../..");
interface Season { pct: number; min: number; label: string }
const sandbox: { JoyPricing?: { PACKAGES: { name: string; prices: number[] }[]; BUNDLES: { name: string; price: number }[]; seasonFor(d: string): Season | null; TRAVEL: { holiday: number; peak: number } } } = {};
runInNewContext(readFileSync(join(root, "site/js/pricing.js"), "utf8"), sandbox);
const packages = sandbox.JoyPricing?.PACKAGES ?? [];
const bundles = sandbox.JoyPricing?.BUNDLES ?? [];

describe("инструкция менеджера по продажам", () => {
  it("цены пакетов — как в калькуляторе сайта", () => {
    expect(packages.length).toBeGreaterThan(0);
    expect(SALES_PRICES.map((p) => p.name)).toEqual(packages.map((p) => p.name));
    for (const p of SALES_PRICES) {
      const site = packages.find((s) => s.name === p.name);
      expect(site?.prices[0]).toBe(p.from);
      expect(site?.prices[site.prices.length - 1]).toBe(p.to);
    }
  });

  it("готовые пакеты — те же названия и цены, что на сайте", () => {
    expect(bundles.length).toBeGreaterThan(0);
    const text = JSON.stringify(SALES_SECTIONS).replace(/\u00a0/g, " ");
    for (const b of bundles) {
      const price = String(b.price).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ₽";
      expect(text, b.name).toContain(`«${b.name}»`);
      expect(text, b.name).toMatch(new RegExp(`«${b.name}»[^«]*— ${price}`));
    }
  });

  it("каждый раздел говорит, что делать; разделы не повторяются", () => {
    const ids = SALES_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SALES_SECTIONS) expect((s.steps?.length ?? 0) + (s.checks?.length ?? 0)).toBeGreaterThan(0);
    for (const list of [SALES_NEVER, SALES_ESCALATE, SALES_SELF_CHECK, OWNER_CHECKS, OWNER_SETUP]) expect(list.length).toBeGreaterThan(0);
  });

  it("новогодняя надбавка — как в калькуляторе сайта (11 ноября 2026), ранняя бронь только как «больше нет»", () => {
    const P = sandbox.JoyPricing!;
    const text = JSON.stringify([SALES_SECTIONS, SALES_NEVER, SALES_ESCALATE, OWNER_CHECKS]).replace(/\u00a0/g, " ");
    const s10 = P.seasonFor("2026-12-10")!, s20 = P.seasonFor("2026-12-20")!, s21 = P.seasonFor("2026-12-21")!, s31 = P.seasonFor("2026-12-31")!;
    expect(P.seasonFor("2026-12-09")).toBeNull();
    expect([s10.pct, s20.pct, s21.pct, s31.pct, s31.min]).toEqual([20, 20, 35, 35, 50000]);
    expect(text).toContain(`10–20 декабря +${s10.pct}%, 21 декабря — 1 января +${s21.pct}%`);
    expect(text).toContain("не меньше 50 000 ₽");
    expect(text).toContain(`10–20 декабря и в праздничные дни ${P.TRAVEL.holiday.toLocaleString("ru-RU").replace(/\s/g, " ")}`);
    expect(text).not.toMatch(/5–18 декабря|19–30 декабря|19 декабря|с 5 декабря|\+40%/);
    expect(text).toContain("Ранняя бронь Нового года — больше нет");
  });

  it("слова условий — как на сайте: предоплата, не залог", () => {
    const text = JSON.stringify([SALES_SECTIONS, SALES_NEVER, SALES_ESCALATE, OWNER_CHECKS]);
    expect(text).not.toMatch(/залог/i);
    expect(text).toContain("предоплата 2 000 ₽");
    expect(text).toContain("joyrest@mail.ru");
  });
});
