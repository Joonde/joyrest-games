import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

/**
 * Помощник «Джой» на сайте (решение владельца 6 ноября 2026): бот без ИИ, только заготовленные ответы
 * (site/js/joy-faq.js), цены и условия калькулятора — из site/js/pricing.js, окно — site/js/joy-bot.js.
 */
interface Item { id: string; topic: string; q: string; a: string; keys: string[]; next: string[]; star?: boolean; hidden?: boolean; cta?: string }
interface Faq {
  build(P: unknown, today: string): Item[];
  match(text: string, items: Item[]): { item: Item | null; others: Item[] };
  CONTACTS: string;
}
interface Pricing {
  money(n: number): string;
  PACKAGES: { id: string; name: string; prices: number[] }[];
  TURNKEY: { from: number };
  TRAVEL: { normal: number; holiday: number; peak: number };
  NY_MIN: number;
  ADDONS: { id: string; label: string; price: number }[];
  EXTENSIONS: { price: number; hours: number }[];
}

const root = resolve(import.meta.dirname, "../..");
const sandbox: { JoyPricing?: Pricing; JoyFaq?: Faq } = {};
runInNewContext(readFileSync(join(root, "site/js/pricing.js"), "utf8"), sandbox);
runInNewContext(readFileSync(join(root, "site/js/joy-faq.js"), "utf8"), sandbox);
const P = sandbox.JoyPricing as Pricing;
const F = sandbox.JoyFaq as Faq;
const items = F.build(P, "2026-11-06");
const byId = (id: string) => items.find((i) => i.id === id) as Item;
const nbsp = (s: string) => s.replace(/ /g, " ");

describe("помощник «Джой»: ответы", () => {
  it("у каждого вопроса — свой id, текст кнопки и ответ без заглушек", () => {
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    for (const it of items) {
      expect(it.q.length, it.id).toBeGreaterThan(2);
      expect(it.a, it.id).not.toMatch(/\[|undefined|NaN|null/);
      expect(it.keys.length, it.id).toBeGreaterThan(0);
      for (const n of it.next) expect(byId(n), `${it.id} → ${n}`).toBeDefined();
    }
  });

  it("стартовых кнопок 6, пока действует ранняя бронь, и 5 после неё", () => {
    expect(items.filter((i) => i.star).map((i) => i.id)).toEqual(["games", "price", "early", "booking", "travel", "contact"]);
    for (const day of ["2026-11-16", "2026-08-31", "2027-01-10"]) {
      const later = F.build(P, day);
      expect(later.some((i) => i.id === "early"), day).toBe(false);
      expect(later.filter((i) => i.star)).toHaveLength(5);
      for (const it of later) for (const n of it.next) expect(later.some((i) => i.id === n), `${day}: ${it.id} → ${n}`).toBe(true);
    }
    expect(F.build(P, "2026-09-01").some((i) => i.id === "early")).toBe(true);
  });

  it("цены — из калькулятора", () => {
    const min = Math.min(...P.PACKAGES.map((p) => p.prices[0] ?? 0));
    expect(nbsp(byId("price").a)).toContain(`От ${nbsp(P.money(min))}`);
    const packages = nbsp(byId("packages").a);
    for (const p of P.PACKAGES) {
      expect(packages).toContain(p.name);
      expect(packages).toContain(nbsp(P.money(p.prices[p.prices.length - 1] ?? 0)));
    }
    expect(packages).toContain(nbsp(P.money(P.TURNKEY.from)));
    expect(byId("weekend").a).toContain("+10%");
    const travel = nbsp(byId("travel").a);
    for (const v of [P.TRAVEL.normal, P.TRAVEL.holiday, P.TRAVEL.peak]) expect(travel).toContain(nbsp(P.money(v)));
    const season = nbsp(byId("season").a);
    expect(season).toContain("+20%");
    expect(season).toContain("+40%");
    expect(season).toContain(nbsp(P.money(P.NY_MIN)));
    expect(byId("holidays").a).toMatch(/\+10%.*\+15%.*\+25%/);
    expect(byId("early").a).toMatch(/до 15 ноября 2026.*\+10% вместо \+20%.*\+20% вместо \+40%/);
    const addons = nbsp(byId("addons").a);
    for (const id of ["corp", "logo", "prize", "dance", "out"]) {
      const a = P.ADDONS.find((x) => x.id === id);
      expect(addons, id).toContain(nbsp(P.money(a?.price ?? 0)));
    }
    const ext = P.EXTENSIONS.find((e) => e.hours === 0.5);
    expect(nbsp(byId("extend").a)).toContain(`${nbsp(P.money(ext?.price ?? 0))} за 30 минут`);
  });

  it("бронь, отмена и связь — как в «Условиях работы» и в витрине, без звонков", () => {
    const html = readFileSync(join(root, "site/index.html"), "utf8");
    expect(html).toContain("Бронь даты — предоплата 2 000 ₽, засчитывается в стоимость.");
    expect(html).toContain("Отмена за 2 дня и раньше — возвращаем.");
    expect(byId("prepay").a).toContain("2 000 ₽");
    expect(byId("cancel").a).toContain("Отмена за 2 дня и раньше");
    expect(byId("contact").a).toContain("joyrest@mail.ru");
    expect(byId("call").a).toContain("Звонков нет");
    const all = items.map((i) => i.a).join("\n");
    // Номера телефона нет («+7 000 ₽» — цена, не номер).
    expect(all).not.toMatch(/(\+7|8)[\s(-]*9\d\d[\s)-]*\d{3}/);
    // Как на сайте: без штрафов, залога, почасовой ставки и служебных слов.
    expect(all).not.toMatch(/D&D|комисси|наценк|маржа|агентству|штраф|залог|МКАД|₽\/час/i);
  });

  it("подбор ответа по своему вопросу", () => {
    const cases: [string, string | null][] = [
      ["Сколько стоит квиз?", "price"],
      ["скока стоит", "price"],
      ["Как забронировать дату", "booking"],
      ["куда выезжают ведущие", "travel"],
      ["чем отличаются ведущие", "levels"],
      ["есть что-то для детей?", "kids"],
      ["можно позвонить", "call"],
      ["нужно скачивать приложение?", "app"],
      ["привет", "hello"],
      ["Ранняя бронь Нового года", "early"],
      // Повод праздника — рассказ о JoyRest, а не новогодняя цена или детские программы (проверка 6 ноября 2026).
      ["корпоратив", "about"],
      ["день рождения", "about"],
      ["детский день рождения", "kids"],
      ["новогодний корпоратив", "season"],
      ["цена квиза", "price"],
      ["пятница дороже?", "weekend"],
      ["где вы работаете", "travel"],
      ["нужен договор?", "booking"],
      ["крокодил", null],
      ["", null],
    ];
    for (const [q, id] of cases) expect(F.match(q, items).item?.id ?? null, q).toBe(id);
    const unclear = F.match("новый год", items);
    expect(unclear.item).toBeNull();
    expect(unclear.others.map((i) => i.id).sort()).toEqual(["early", "season"]);
  });
});

describe("помощник «Джой»: страница", () => {
  const html = readFileSync(join(root, "site/index.html"), "utf8");
  const css = readFileSync(join(root, "site/css/style.css"), "utf8");
  const bot = readFileSync(join(root, "site/js/joy-bot.js"), "utf8");

  it("скрипты — после калькулятора, аватар — кадры Джой, работает и в витрине", () => {
    expect(html.indexOf('<script src="js/joy-faq.js"></script>')).toBeGreaterThan(html.indexOf('<script src="js/pricing.js"></script>'));
    expect(html.indexOf('<script src="js/joy-bot.js"></script>')).toBeGreaterThan(html.indexOf('<script src="js/joy-faq.js"></script>'));
    expect(html).toMatch(/<button type="button" class="joy-fab" id="joyFab"[^>]*>.*src="img\/joy-base\.webp".*src="img\/joy-blink\.webp"/);
    // В окне — все пять кадров; у каждого CSS-слой, файлы на месте и лёгкие.
    for (const f of ["base", "blink", "a", "o", "i"]) {
      expect(html).toMatch(new RegExp(`id="joyAvatar"[^>]*>.*src="img/joy-${f}\\.webp" width="240" height="240"`));
      expect(css).toContain(`joy-av__f--${f}`);
      expect(statSync(join(root, `site/img/joy-${f}.webp`)).size).toBeLessThan(20_000);
    }
    expect(css).toMatch(/\.joy-av__f\{[^}]*opacity: 0/);
    expect(html).not.toMatch(/class="joy-[^"]*no-showcase/);
  });

  it("Джой в шапке и в меню телефона открывает то же окно", () => {
    expect(html).toMatch(/<div class="header-actions">\s*<button type="button" class="joy-hbtn" data-joy-open[^>]*>.*src="img\/joy-base\.webp"/);
    expect(html).toMatch(/<div class="mobile-panel"[\s\S]*?<a href="#joy" class="nav-joy" data-joy-open>Спросить помощника Джой<\/a>/);
    expect(bot).toContain("querySelectorAll('[data-joy-open]')");
    // Узко (меньше 340 px) Джой — только в меню; надпись — от 1280 px, меню шапки тогда плотнее (без переносов).
    expect(css).toMatch(/@media \(max-width: 339px\)\{ \.joy-hbtn\{ display: none; \} \}/);
    expect(css).toMatch(/@media \(min-width: 1280px\)\{ \.nav-links\{ gap: 20px; \}[^\n]*\.joy-hbtn__text\{ display: inline; \}/);
  });

  it("бот ничего не отправляет и не хранит", () => {
    expect(bot).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage/);
  });

  it("кнопки не ниже 44px, Escape закрывает, на телефоне кнопка уходит с первого экрана и калькулятора", () => {
    expect(css).toMatch(/\.joy-fab\{[^}]*min-height: 52px/);
    for (const cls of ["joy-cta", "joy-chip"]) expect(css).toMatch(new RegExp(`\\.${cls}\\{[^}]*min-height: 44px`));
    expect(css).toMatch(/\.joy-foot a\{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.joy-close\{[^}]*width: 44px; height: 44px/);
    expect(css).toContain(".joy-fab.is-away{ opacity: 0;");
    expect(bot).toContain("e.key === 'Escape'");
  });
});
