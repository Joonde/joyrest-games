import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { cleanProgram, programFromCalc, programLines, PROGRAM_ADDONS, PROGRAM_FORMATS, sameProgram } from "../../src/core/eventProgram";
import { noticeText, overtimeNoticeText } from "../../src/core/events";
import { EXTENSION_PRICES, overtimeOf } from "../../src/core/overtime";
import { isCalcMessage } from "./telegram";

/**
 * Программа мероприятия (решение владельца 22 октября 2026): расчёт клиента с сайта — в форматы, продление и допы
 * (без цены); списки и цены продления — как в калькуляторе сайта (`site/js/pricing.js`).
 */
interface Pricing {
  PACKAGES: { id: string; name: string }[];
  TURNKEY: { name: string };
  ADDONS: { id: string; label: string }[];
  EXTENSIONS: { price: number }[];
  calcMessage(opts: object, level: string): string;
  calcSummary(opts: object): { text: string };
  BUNDLES: { id: string; name: string }[];
  bundleMessage(id: string, name?: string): string;
}
const root = resolve(import.meta.dirname, "../..");
const sandbox: { JoyPricing?: Pricing } = {};
runInNewContext(readFileSync(join(root, "site/js/pricing.js"), "utf8"), sandbox);
const P = sandbox.JoyPricing as Pricing;

describe("программа мероприятия из расчёта клиента", () => {
  it("форматы, допы и цены продления — как в калькуляторе сайта", () => {
    expect([...PROGRAM_FORMATS].sort()).toEqual([...P.PACKAGES.map((p) => p.name), P.TURNKEY.name].sort());
    expect([...PROGRAM_ADDONS].sort()).toEqual(P.ADDONS.map((a) => a.label).sort());
    expect(P.EXTENSIONS.slice(1).map((e) => e.price)).toEqual(EXTENSION_PRICES);
  });

  it("сообщение «🧮 Расчёт JoyRest»: форматы по порядку, продление, допы, длительность — без цены", () => {
    const text = P.calcMessage({ pkg: "quiz", tier: 2, weekend: true, extras: ["music"], ext: 1, addons: ["logo", "prize"] }, "standard");
    const program = programFromCalc(text);
    expect(program).toEqual({ formats: ["Квиз", "Музыкальный"], extension: "30 мин", addons: ["Логотип на экранах", "Призы и медали"], duration: "≈ 3–3,5 часа" });
    expect(JSON.stringify(program)).not.toMatch(/₽|\d{2} \d{3}/);
  });

  it("строка заявки (calcSummary) тоже разбирается", () => {
    const { text } = P.calcSummary({ pkg: "show", tier: 1, extras: ["game"], ext: 2, addons: ["corp"] });
    expect(programFromCalc(text)).toMatchObject({ formats: ["Шоу-вечер", "Игровой вечер"], extension: "1 ч", addons: ["Квиз под компанию"] });
  });

  it("«Квиз под компанию» — доп, а не пакет «Квиз»", () => {
    const text = P.calcMessage({ pkg: "music", tier: 0, addons: ["corp"] }, "standard");
    expect(programFromCalc(text)?.formats).toEqual(["Музыкальный"]);
  });

  it("все пакеты, продления и допы калькулятора узнаются", () => {
    for (const pkg of P.PACKAGES) {
      for (let ext = 0; ext < P.EXTENSIONS.length; ext += 1) {
        const p = programFromCalc(P.calcMessage({ pkg: pkg.id, tier: 1, ext, addons: P.ADDONS.map((a) => a.id) }, "standard"));
        expect(p?.formats[0]).toBe(pkg.name);
        expect(p?.addons.length).toBe(P.ADDONS.length);
        expect(Boolean(p?.extension)).toBe(ext > 0);
      }
    }
    expect(programFromCalc("Привет, хотим праздник")).toBeNull();
  });

  it("готовый пакет с сайта: программа — из строк «Программа», «Допы», «Длительность», не из «Что входит»", () => {
    const want: Record<string, { formats: string[]; addons: string[]; duration: string }> = {
      joyrest: { formats: ["Квиз", "Игровой вечер"], addons: [], duration: "≈ 2,5–3 часа" },
      tvshow: { formats: ["Шоу-вечер"], addons: [], duration: "≈ 1,5–2 часа" },
      nyshow: { formats: ["Шоу-вечер"], addons: ["Призы и медали"], duration: "≈ 1,5–2 часа" },
      nyquiz: { formats: ["Квиз"], addons: ["Призы и медали"], duration: "≈ 1,5–2 часа" },
      mix: { formats: ["Музыкальный"], addons: ["Танцевальная пауза"], duration: "≈ 1,5–2 часа" },
      mafia: { formats: ["Игровой вечер"], addons: ["Призы и медали"], duration: "≈ 1,5–2 часа" },
      // Детский — ровно 1,5 часа без «≈ …–…»: длительность ведущий видит в «до» мероприятия.
      kids: { formats: ["Активные настолки"], addons: [], duration: "" },
    };
    expect(P.BUNDLES.map((b) => b.id)).toEqual(Object.keys(want));
    for (const b of P.BUNDLES) {
      const text = P.bundleMessage(b.id, "Анна");
      expect(programFromCalc(text), b.name).toMatchObject(want[b.id] ?? {});
      // В Telegram для бизнеса такое сообщение — тоже заявка с сайта: клиент попадает в «Клиенты».
      expect(isCalcMessage(text), b.name).toBe(true);
    }
    expect(isCalcMessage("🧮 Расчёт JoyRest\nПакет: Квиз")).toBe(true);
    expect(isCalcMessage("Здравствуйте, сколько стоит квиз?")).toBe(false);
  });

  it("сервер принимает только известное; пустое — null", () => {
    expect(cleanProgram({ formats: ["Квиз", "Взлом", "Квиз"], extension: "5 ч", addons: ["Призы и медали", "x"], duration: "≈ 2 часа" })).toEqual({
      formats: ["Квиз"],
      extension: "",
      addons: ["Призы и медали"],
      duration: "≈ 2 часа",
    });
    expect(cleanProgram({})).toBeNull();
    expect(cleanProgram("<script>")).toBeNull();
    expect(sameProgram(null, cleanProgram({}))).toBe(true);
  });

  it("сообщение ведущему — с программой, без клиента", () => {
    const program = cleanProgram({ formats: ["Квиз", "Музыкальный"], extension: "30 мин", addons: ["Логотип на экранах"] });
    const text = noticeText("created", { title: "Корпоратив", guests: 40, day: "2026-11-14", start: 19 * 60, end: 22 * 60 + 30, program }, "https://games.joy-rest.ru");
    expect(text).toContain("Программа: 1 · Квиз → 2 · Музыкальный · продление 30 мин");
    expect(text).toContain("Допы: Логотип на экранах");
    expect(programLines(null)).toEqual([]);
    expect(noticeText("cancelled", { title: "Корпоратив", guests: 40, day: "2026-11-14", start: 1140, end: 1350, program }, "x")).not.toContain("Программа");
  });

  it("игра идёт дольше плана: ведущему — сколько идёт и цена продления, владельцу — кто ведёт", () => {
    const e = { title: "Корпоратив", guests: 40, day: "2026-11-14", start: 19 * 60, end: 22 * 60 };
    const forHost = overtimeNoticeText(e, overtimeOf(21 * 60_000, 0), "Антон", true, "https://games.joy-rest.ru");
    expect(forHost).toContain("по плану 19:00–22:00 (3 ч)");
    expect(forHost).toContain("Идёт уже 3 ч 21 мин — сверх плана 21 мин");
    expect(forHost).toContain("продление +30 мин — 3 900 ₽");
    expect(forHost).toContain("только с его согласия");
    const forOwner = overtimeNoticeText(e, overtimeOf(55 * 60_000, 0), "Антон", false, "https://games.joy-rest.ru");
    expect(forOwner).toContain("продление +1 ч — 7 900 ₽");
    expect(forOwner).toContain("Ведёт: Антон");
  });
});
