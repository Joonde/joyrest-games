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
const sandbox: { JoyPricing?: { PACKAGES: { name: string; prices: number[] }[] } } = {};
runInNewContext(readFileSync(join(root, "site/js/pricing.js"), "utf8"), sandbox);
const packages = sandbox.JoyPricing?.PACKAGES ?? [];

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

  it("каждый раздел говорит, что делать; разделы не повторяются", () => {
    const ids = SALES_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SALES_SECTIONS) expect((s.steps?.length ?? 0) + (s.checks?.length ?? 0)).toBeGreaterThan(0);
    for (const list of [SALES_NEVER, SALES_ESCALATE, SALES_SELF_CHECK, OWNER_CHECKS, OWNER_SETUP]) expect(list.length).toBeGreaterThan(0);
  });

  it("слова условий — как на сайте: предоплата, не залог", () => {
    const text = JSON.stringify([SALES_SECTIONS, SALES_NEVER, SALES_ESCALATE, OWNER_CHECKS]);
    expect(text).not.toMatch(/залог/i);
    expect(text).toContain("предоплата 2 000 ₽");
    expect(text).toContain("joyrest@mail.ru");
  });
});
