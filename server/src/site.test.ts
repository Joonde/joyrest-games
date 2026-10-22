import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Resvg } from "@resvg/resvg-js";
import jsQR from "jsqr";
import { contrastRatio } from "../../src/themes/contrast";
import { buildApp } from "./app";
import { siteMode } from "./site";

function dir(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "joyrest-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const platform = dir({ "index.html": "<title>Платформа</title>", "assets/app-1.js": "1" });
const siteDir = dir({
  "index.html": "<title>Сайт агентства</title>",
  "showcase.html": '<html data-site-mode="showcase"><title>Витрина агентства</title>',
  "css/style.0123456789.css": "body{}",
  "img/logo.0123456789.png": "png",
  "fonts/jost-latin-400-normal.woff2": "font",
  "favicon.svg": "<svg/>",
  "calc/index.html": "<title>Калькулятор праздника</title>",
  "korporativ/index.html": "<title>Корпоратив</title>",
  "sitemap.xml": "<urlset></urlset>",
});

const stubDir = dir({ "index.html": "<title>Скоро</title>", "joyrest-logo.svg": "<svg/>" });

function app(indexing: boolean, enabled = true, showcase = false) {
  return buildApp({
    version: "abc",
    publicDir: platform,
    checkDatabase: async () => true,
    site: { dir: siteDir, enabled, stubDir, hosts: ["joy-rest.ru", "test.joy-rest.ru"], indexing, showcase },
    lead: { telegram: { token: "t", chatId: "1" }, send: async () => {} },
  });
}

describe("сайт агентства", () => {
  const closed = app(false);
  const open = app(true);
  afterAll(async () => {
    await closed.close();
    await open.close();
  });

  it("joy-rest.ru отдаёт сайт, games.joy-rest.ru — платформу", async () => {
    const site = await closed.inject({ url: "/", headers: { host: "joy-rest.ru" } });
    expect(site.statusCode).toBe(200);
    expect(site.body).toContain("Сайт агентства");
    expect(site.headers["cache-control"]).toBe("no-cache");

    for (const host of ["JOY-REST.RU", "joy-rest.ru:8080", "test.joy-rest.ru"]) {
      expect((await closed.inject({ url: "/", headers: { host } })).body, host).toContain("Сайт агентства");
    }

    const games = await closed.inject({ url: "/", headers: { host: "games.joy-rest.ru" } });
    expect(games.body).toContain("Платформа");
    expect(games.headers["x-robots-tag"]).toBeUndefined();
    expect((await closed.inject({ url: "/studio", headers: { host: "games.joy-rest.ru" } })).body).toContain("Платформа");
    expect((await closed.inject({ url: "/css/style.0123456789.css", headers: { host: "games.joy-rest.ru" } })).statusCode).toBe(404);
  });

  it("файлы с отпечатком и шрифты кэшируются на год", async () => {
    for (const url of ["/css/style.0123456789.css", "/img/logo.0123456789.png", "/fonts/jost-latin-400-normal.woff2"]) {
      const res = await closed.inject({ url, headers: { host: "joy-rest.ru" } });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers["cache-control"], url).toBe("public, max-age=31536000, immutable");
    }
    const icon = await closed.inject({ url: "/favicon.svg", headers: { host: "joy-rest.ru" } });
    expect(icon.headers["cache-control"]).toBe("no-cache");
    const head = await closed.inject({ method: "HEAD", url: "/", headers: { host: "joy-rest.ru" } });
    expect(head.statusCode).toBe(200);
  });

  it("нет файла — 404, страница не подменяет файл", async () => {
    const page = await closed.inject({ url: "/nope", headers: { host: "joy-rest.ru" } });
    expect(page.statusCode).toBe(404);
    expect(page.body).toContain("Страница не найдена");
    expect((await closed.inject({ url: "/css/missing.css", headers: { host: "joy-rest.ru" } })).statusCode).toBe(404);
    const api = await closed.inject({ url: "/api/nothing", headers: { host: "joy-rest.ru" } });
    expect(api.statusCode).toBe(404);
    expect(api.json()).toEqual({ error: "not_found" });
  });

  it("индексация выключена: robots.txt Disallow и X-Robots-Tag на всех ответах сайта", async () => {
    const robots = await closed.inject({ url: "/robots.txt", headers: { host: "joy-rest.ru" } });
    expect(robots.body).toBe("User-agent: *\nDisallow: /\n");
    expect(robots.headers["cache-control"]).toBe("no-cache");
    for (const url of ["/", "/css/style.0123456789.css", "/nope", "/robots.txt"]) {
      const res = await closed.inject({ url, headers: { host: "joy-rest.ru" } });
      expect(res.headers["x-robots-tag"], url).toBe("noindex, nofollow");
    }
  });

  it("индексация включена: robots.txt Allow, без X-Robots-Tag", async () => {
    const robots = await open.inject({ url: "/robots.txt", headers: { host: "joy-rest.ru" } });
    expect(robots.body).toBe("User-agent: *\nAllow: /\n\nSitemap: https://joy-rest.ru/sitemap.xml\n");
    const page = await open.inject({ url: "/", headers: { host: "joy-rest.ru" } });
    expect(page.headers["x-robots-tag"]).toBeUndefined();
  });
});

describe("сайт выключен (по умолчанию): заглушка «скоро»", () => {
  const off = app(true, false);
  afterAll(() => off.close());

  it("на joy-rest.ru заглушка, файлов сайта нет, платформа не задета", async () => {
    const page = await off.inject({ url: "/", headers: { host: "joy-rest.ru" } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("Скоро");
    expect(page.headers["cache-control"]).toBe("no-cache");
    expect((await off.inject({ url: "/joyrest-logo.svg", headers: { host: "joy-rest.ru" } })).statusCode).toBe(200);
    expect((await off.inject({ url: "/css/style.0123456789.css", headers: { host: "joy-rest.ru" } })).statusCode).toBe(404);
    expect((await off.inject({ url: "/", headers: { host: "games.joy-rest.ru" } })).body).toContain("Платформа");
  });

  it("калькулятор без заявки открыт и при заглушке: /calc/ и шрифты, остальные файлы сайта — нет", async () => {
    const calc = await off.inject({ url: "/calc/", headers: { host: "joy-rest.ru" } });
    expect(calc.statusCode).toBe(200);
    expect(calc.body).toContain("Калькулятор праздника");
    expect(calc.headers["cache-control"]).toBe("no-cache");
    expect(calc.headers["x-robots-tag"]).toBe("noindex, nofollow");
    const font = await off.inject({ url: "/fonts/jost-latin-400-normal.woff2", headers: { host: "joy-rest.ru" } });
    expect(font.statusCode).toBe(200);
    expect(font.headers["cache-control"]).toContain("immutable");
    expect((await off.inject({ url: "/css/style.0123456789.css", headers: { host: "joy-rest.ru" } })).statusCode).toBe(404);
    expect((await off.inject({ url: "/calc/", headers: { host: "games.joy-rest.ru" } })).body).not.toContain("Калькулятор праздника");
  });

  it("заявки не принимаются: /api/lead — 404", async () => {
    const res = await off.inject({
      method: "POST",
      url: "/api/lead",
      headers: { host: "joy-rest.ru", "content-type": "application/json" },
      payload: JSON.stringify({ type: "question", consent: true, text: "Вопрос" }),
    });
    expect(res.statusCode).toBe(404);
  });

  it("поисковикам закрыто, даже если индексация включена", async () => {
    const robots = await off.inject({ url: "/robots.txt", headers: { host: "joy-rest.ru" } });
    expect(robots.body).toBe("User-agent: *\nDisallow: /\n");
    const page = await off.inject({ url: "/", headers: { host: "joy-rest.ru" } });
    expect(page.headers["x-robots-tag"]).toBe("noindex, nofollow");
  });
});

describe("витрина до ИП (SITE_ENABLED=showcase)", () => {
  const showcase = app(true, false, true);
  afterAll(() => showcase.close());

  it("режим сайта: только точные «on» и «showcase», остальное — заглушка", () => {
    for (const value of [undefined, "", "off", "true", "show", "showcase1", "show case", "витрина"]) {
      expect(siteMode(value), String(value)).toBe("off");
    }
    for (const value of ["on", "ON", " on\r\n"]) expect(siteMode(value), value).toBe("on");
    for (const value of ["showcase", "SHOWCASE", " Showcase\r\n"]) expect(siteMode(value), value).toBe("showcase");
  });

  it("на «/» — витрина (showcase.html), файлы сайта открыты, полной страницы с формами нет", async () => {
    const page = await showcase.inject({ url: "/", headers: { host: "joy-rest.ru" } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("Витрина агентства");
    expect(page.body).toContain('data-site-mode="showcase"');
    expect(page.headers["cache-control"]).toBe("no-cache");
    expect((await showcase.inject({ url: "/index.html", headers: { host: "joy-rest.ru" } })).statusCode).toBe(404);
    const css = await showcase.inject({ url: "/css/style.0123456789.css", headers: { host: "joy-rest.ru" } });
    expect(css.statusCode).toBe(200);
    expect(css.headers["cache-control"]).toContain("immutable");
    expect((await showcase.inject({ url: "/calc/", headers: { host: "joy-rest.ru" } })).body).toContain("Калькулятор праздника");
    expect((await showcase.inject({ url: "/korporativ/", headers: { host: "joy-rest.ru" } })).body).toContain("Корпоратив");
    expect((await showcase.inject({ url: "/sitemap.xml", headers: { host: "joy-rest.ru" } })).statusCode).toBe(200);
    expect((await showcase.inject({ url: "/", headers: { host: "games.joy-rest.ru" } })).body).toContain("Платформа");
  });

  it("заявки не принимаются: /api/lead — 404", async () => {
    for (const type of ["lead", "question", "review"]) {
      const res = await showcase.inject({
        method: "POST",
        url: "/api/lead",
        headers: { host: "joy-rest.ru", "content-type": "application/json" },
        payload: JSON.stringify({ type, consent: true, text: "Текст" }),
      });
      expect(res.statusCode, type).toBe(404);
    }
  });

  it("индексация включена — витрина открыта поисковикам (решение владельца 22 октября 2026)", async () => {
    const robots = await showcase.inject({ url: "/robots.txt", headers: { host: "joy-rest.ru" } });
    expect(robots.body).toBe("User-agent: *\nAllow: /\n\nSitemap: https://joy-rest.ru/sitemap.xml\n");
    const page = await showcase.inject({ url: "/", headers: { host: "joy-rest.ru" } });
    expect(page.headers["x-robots-tag"]).toBeUndefined();
  });

  it("индексация выключена (по умолчанию) — витрина закрыта поисковикам", async () => {
    const hidden = app(false, false, true);
    const robots = await hidden.inject({ url: "/robots.txt", headers: { host: "joy-rest.ru" } });
    expect(robots.body).toBe("User-agent: *\nDisallow: /\n");
    for (const url of ["/", "/calc/", "/css/style.0123456789.css"]) {
      const res = await hidden.inject({ url, headers: { host: "joy-rest.ru" } });
      expect(res.headers["x-robots-tag"], url).toBe("noindex, nofollow");
    }
    await hidden.close();
  });

  it("включённый сайт сильнее витрины: on + showcase — обычный сайт", async () => {
    const both = app(false, true, true);
    const page = await both.inject({ url: "/", headers: { host: "joy-rest.ru" } });
    expect(page.body).toContain("Сайт агентства");
    await both.close();
  });

  it("исходники: сборка кладёт showcase.html с меткой, страница прячет формы и шлёт расчёт текстом", () => {
    const root = resolve(import.meta.dirname, "../..");
    const build = readFileSync(join(root, "scripts/build-site.ts"), "utf8");
    expect(build).toContain('"showcase.html"');
    expect(build).toContain('data-site-mode="showcase"');
    const html = readFileSync(join(root, "site/index.html"), "utf8");
    expect(html).toContain('<html lang="ru" data-theme="dark">');
    expect(html).toMatch(/<form id="leadForm" class="[^"]*\bno-showcase\b/);
    expect(html).toContain('class="ask-fab no-showcase" id="askFabBtn"');
    expect(html).toContain('id="showcaseContact"');
    const css = readFileSync(join(root, "site/css/style.css"), "utf8");
    expect(css).toContain('[data-site-mode="showcase"] .no-showcase{ display: none !important; }');
    const js = readFileSync(join(root, "site/js/script.js"), "utf8");
    expect(js).toContain("document.documentElement.dataset.siteMode === 'showcase'");
    expect(js).toContain("'Отправить расчёт менеджеру'");
    expect(js).toContain("if(!SHOWCASE) attachCalc(calcOpts(), false);");
  });
});

describe("исходники сайта (site/)", () => {
  const root = resolve(import.meta.dirname, "../../site");
  const html = readFileSync(join(root, "index.html"), "utf8");
  const css = readFileSync(join(root, "css/style.css"), "utf8") + readFileSync(join(root, "css/fonts.css"), "utf8");
  const js = ["js/script.js", "js/pricing.js", "js/theme.js"].map((f) => readFileSync(join(root, f), "utf8")).join("\n");

  it("без внешних шрифтов, картинок и скриптов", () => {
    for (const text of [html, css, js]) {
      expect(text).not.toMatch(/fonts\.googleapis|fonts\.gstatic|images\.unsplash|cdn\./);
    }
    expect(html).not.toMatch(/<script[^>]+src="https?:/);
    // Внешних файлов нет; адрес страницы для поисковиков (canonical) — не загрузка.
    expect(html.replace(/<link rel="canonical" href="https:\/\/joy-rest\.ru\/[a-z-/]*">/g, "")).not.toMatch(/<link[^>]+href="https?:/);
  });

  it("Telegram: своя карточка канала без внешних скриптов, старого поста нет", () => {
    for (const text of [html, css, js]) {
      expect(text).not.toMatch(/telegram-widget|telegram\.org\/js|data-telegram-post|JoyRest\/3/);
    }
    expect(html).toContain("<h3>JoyRest в Telegram</h3>");
    expect(html).toContain("Анонсы, идеи для праздников и закулисье наших мероприятий.");
    expect(html).toContain('<a class="hbtn hbtn--primary" href="https://t.me/JoyRest" target="_blank" rel="noopener">Открыть канал</a>');
    // «Беседа»: пустая ссылка — кнопки нет; добавить — вписать ссылку в href.
    expect(html).toContain('<a class="hbtn hbtn--secondary" data-tg-chat href="" target="_blank" rel="noopener">Беседа</a>');
    expect(css).toContain('.tg-card a[data-tg-chat][href=""]{ display: none; }');
    expect(html).toContain('data-brand-qr="https://t.me/JoyRest"');
    // Стили QR — только для внешнего SVG: вложенная монограмма держит свои размеры.
    expect(css).toContain(".tg-card__qr > svg{");
    expect(css).not.toMatch(/\.tg-card__qr svg\b/);
    // QR — только от 760px.
    expect(css).toMatch(/\.tg-card__qr\{ display: none; \}[\s\S]*@media \(min-width: 761px\)\{\s*\.tg-card__qr\{ display: block;/);
  });

  it("формы шлют на /api/lead, у каждой есть ловушка и место для ошибки", () => {
    expect(js).toContain("fetch('/api/lead'");
    expect(js).not.toContain("sendToTelegram");
    expect(js).not.toContain("api.telegram.org");
    expect(html.match(/name="website"/g)).toHaveLength(3);
    for (const id of ["askError", "reviewError", "formError"]) expect(html).toContain(`id="${id}"`);
  });

  it("шапка: «Оставить заявку» ведёт к форме с фокусом, переключатель темы, кнопки не ниже 44px", () => {
    expect(html).toMatch(/<a href="#contact" class="hbtn hbtn--primary" data-focus-target="name">Оставить заявку<\/a>/);
    expect(html).toContain('<a href="#contact" class="nav-cta" data-focus-target="name">Оставить заявку</a>');
    expect(html).toContain('<input type="text" id="name"');
    expect(js).toContain("[data-focus-target]");
    expect(html).toContain('id="themeToggle"');
    expect(css).toMatch(/\.hbtn\{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.theme-toggle\{[^}]*width: 44px; height: 44px/);
    expect(css).toMatch(/\.chip\{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.filter\{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.info\{[^}]*width: 44px/);
  });

  it("тема: вечерняя по умолчанию, выбор запоминается и применяется до отрисовки", () => {
    expect(html).toContain('<html lang="ru" data-theme="dark">');
    // theme.js — в <head>, до <body>: тема ставится до отрисовки.
    expect(html.indexOf('<script src="js/theme.js"></script>')).toBeLessThan(html.indexOf("<body"));
    expect(js).toContain("localStorage.getItem('jr-theme')");
    expect(js).toContain("localStorage.setItem('jr-theme', next)");
    // localStorage может быть недоступен — без него страница работает.
    expect(js.match(/try\s*\{[^}]*localStorage/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("полосы с фоном и первый экран не шире страницы", () => {
    expect(html).not.toMatch(/margin: 0 -32px/);
    expect(css).toMatch(/body\{[^}]*overflow-x: hidden/);
    expect(css).toContain(".hero{ position: relative; overflow: hidden;");
  });

  it("в политике домен joy-rest.ru", () => {
    expect(html).toContain("joy-rest.ru");
    expect(html).not.toMatch(/[^-.\w]joyrest\.ru/);
  });
});

describe("контраст сайта в вечерней и дневной теме (WCAG AA, как у платформы)", () => {
  const root = resolve(import.meta.dirname, "../..");
  const css = readFileSync(join(root, "site/css/style.css"), "utf8");
  const html = readFileSync(join(root, "site/index.html"), "utf8");

  /** Переменные блока: вечерняя тема — :root{…}, дневная — :root[data-theme="light"]{…} поверх неё. */
  function tokens(block: string): Record<string, string> {
    return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})\b/g)].map((m) => [m[1] ?? "", m[2] ?? ""]));
  }
  const block = (start: string) => css.slice(css.indexOf(start), css.indexOf("}", css.indexOf(start)));
  const dark = tokens(block(":root{"));
  const light = { ...dark, ...tokens(block(':root[data-theme="light"]{')) };
  const EMBLEM = /--emb-1: (#\w{6}); --emb-2: (#\w{6}); --emb-3: (#\w{6}); --emb-4: (#\w{6})/;

  // [текст, фон, норма]: 4.5 — текст, 3 — рамки и графика.
  const pairs = (t: Record<string, string>): [string, string, number][] => [
    ...[t.bg, t["bg-alt"], t.card].flatMap((bg): [string, string, number][] => [
      [t.ink ?? "", bg ?? "", 4.5],
      [t["ink-soft"] ?? "", bg ?? "", 4.5],
      [t["accent-text"] ?? "", bg ?? "", 4.5],
      [t["green-text"] ?? "", bg ?? "", 4.5],
      [t.total ?? "", bg ?? "", 4.5],
      [t["error-text"] ?? "", bg ?? "", 4.5],
      [t["btn-outline-text"] ?? "", bg ?? "", 4.5],
      [t["btn-outline"] ?? "", bg ?? "", 3],
    ]),
    // Текст на цветных заливках кнопок и плашек.
    ...["coral", "emerald", "gold", "wine", "btn-primary-bg"].map((fill): [string, string, number] => [t["on-accent"] ?? "", t[fill] ?? "", 4.5]),
    [t["btn-primary-text"] ?? "", t["btn-primary-bg"] ?? "", 4.5],
    // Выбранные кнопки, «Задать вопрос»: фон --ink, текст --bg.
    [t.bg ?? "", t.ink ?? "", 4.5],
    // Логотип на подложке.
    [t["logo-color"] ?? "", t["logo-bg"] ?? "", 3],
  ];

  it.each([
    ["вечерняя", dark],
    ["дневная", light],
  ] as const)("%s тема: текст, кнопки и рамки", (_name, t) => {
    for (const [fg, bg, need] of pairs(t)) {
      expect(fg, "нет цвета в токенах").toMatch(/^#/);
      expect(bg, "нет цвета в токенах").toMatch(/^#/);
      expect(contrastRatio(fg, bg), `${fg} на ${bg}`).toBeGreaterThanOrEqual(need);
    }
    expect(light["logo-color"]).not.toBe(dark["logo-color"]);
  });

  it("эмблема и «без хлопот»: каждый цвет градиента с фоном ≥ 4.5 в обеих темах", () => {
    const darkEmblem = EMBLEM.exec(css.slice(css.indexOf(".emblem{")));
    const lightEmblem = EMBLEM.exec(css.slice(css.indexOf(':root[data-theme="light"] .emblem{')));
    for (const [colors, bg] of [[darkEmblem, dark.bg], [lightEmblem, light.bg]] as const) {
      expect(colors).not.toBeNull();
      for (const c of colors?.slice(1) ?? []) expect(contrastRatio(c ?? "", bg ?? ""), `${c} на ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("нет белого текста на пастели и пастельного текста на фоне — только токены", () => {
    expect(css).not.toMatch(/(?<![-\w])color:\s*(#fff\b|#ffffff\b|white\b)/i);
    expect(css).not.toMatch(/(?<![-\w])color:\s*var\(--(coral|emerald|gold|wine)\)/);
    expect(html).not.toMatch(/(?<![-\w])color:\s*(#fff\b|white\b|var\(--(coral|emerald|gold|wine)\))/i);
  });
});

describe("тексты и устройство страницы", () => {
  const root = resolve(import.meta.dirname, "../..");
  const css = readFileSync(join(root, "site/css/style.css"), "utf8");
  const html = readFileSync(join(root, "site/index.html"), "utf8");
  const js = readFileSync(join(root, "site/js/script.js"), "utf8");
  const pricing = readFileSync(join(root, "site/js/pricing.js"), "utf8");
  const plain = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  it("резервная копия прежнего сайта лежит вне site/ и не выкладывается", () => {
    const archive = join(root, "site-archive/v1-2026-10-12");
    expect(readFileSync(join(archive, "README.md"), "utf8")).toContain("Сайт JoyRest v1 — до редизайна");
    expect(readFileSync(join(archive, "index.html"), "utf8")).toContain("Пакеты услуг");
    expect(readFileSync(join(root, "scripts/build-site.ts"), "utf8")).toContain('const SOURCE = join(ROOT, "site");');
  });

  it("отзывы: пока нет опубликованных — «Следите за нами»; форма отзыва открыта, лента из студии, карточка Telegram на месте", () => {
    expect(html).toContain('<h2 id="reviewsTitle">Следите за нами</h2>');
    expect(html).toContain("Мы только открываемся — фото и отзывы с первых мероприятий появятся здесь. А пока заглядывайте в наш Telegram-канал.");
    expect(html).toMatch(/<section id="reviews" [^>]*data-review-form="on">/);
    expect(html).toContain('<div class="reviews" id="siteReviews" hidden>');
    expect(html).toContain('<script src="js/reviews.js"></script>');
    expect(readFileSync(join(root, "site/js/reviews.js"), "utf8")).toContain("/api/site/reviews");
    expect(css).toMatch(/\[data-review-form="off"\] #openReviewForm,\s*\[data-review-form="off"\] #reviewFormWrap\{ display: none; \}/);
    expect(html).toContain('class="tg-card');
  });

  it("свадьбы — только «скоро» на первом экране: ни варианта в заявке, ни карточки", () => {
    expect(html).not.toMatch(/<option>Свадьба/);
    expect(html).toContain('<div class="tile tile--soon" aria-label="Свадьбы — скоро"><span class="soon-badge">Скоро</span>');
    expect(html).not.toContain("<h3>Свадьбы</h3>");
    expect(html).not.toContain('data-event-type="Свадьба"');
  });

  it("форматы ведущего: тексты владельца дословно, −20% и −35%, одни и те же значения в заявке", () => {
    for (const phrase of [
      "Новые лица — для тех, кто любит пробовать новое",
      "Ведущие, которые уже провели свои первые праздники и сейчас набирают опыт. Много энергии, свежие идеи и большое желание сделать ваш вечер особенным.",
      "Опыта у них меньше, чем у наших основных ведущих, поэтому цена ниже на 20% — мы честно делим с вами возможные шероховатости.",
      "сценарий и программу готовим вместе с опытным ведущим JoyRest;",
      "на празднике ведущий работает самостоятельно и сам справляется с неожиданностями — именно так растёт настоящее мастерство.",
      "Первый старт — для самых смелых",
      "Ведущие, для которых ваш праздник станет одним из первых. Волнение, искренность и стремление выложиться на все сто — такого вы больше нигде не увидите.",
      "Это максимальный эксперимент, поэтому и скидка максимальная — 35%.",
      "сценарий готовим вместе с опытным ведущим JoyRest и заранее репетируем;",
      "на празднике ведущий работает самостоятельно — для него это настоящий первый выход.",
      "Хотите без сюрпризов — выберите обычный формат с опытным ведущим. А если вы за эксперимент и хотите сэкономить — эти форматы для вас.",
    ]) expect(plain, phrase).toContain(phrase);
    expect(plain.match(/игры, реквизит и оборудование — как в обычном формате;/g)).toHaveLength(2);
    expect(html).toContain('<span class="host__badge">−20%</span>');
    expect(html).toContain('<span class="host__badge">−35%</span>');
    expect(html).not.toMatch(/25%/);
    const opts = [...html.slice(html.indexOf('id="hostLevel"'), html.indexOf("</select>", html.indexOf('id="hostLevel"'))).matchAll(/value="(\w+)"/g)].map((m) => m[1]);
    expect(opts).toEqual(["standard", "new", "first"]);
    expect(html).toContain("<option value=\"new\">Новые лица (−20%)</option>");
    for (const level of ["standard", "new", "first"]) expect(html).toContain(`data-host-level="${level}">Выбрать этот формат`);
    expect(pricing).toContain("{ id: 'new', name: 'Новые лица', badge: '−20%', discount: 0.2 }");
    expect(pricing).toContain("{ id: 'first', name: 'Первый старт', badge: '−35%', discount: 0.35 }");
    expect(js).toContain("hostLevel: hostLevelField.value");
    expect(html.slice(html.indexOf('id="mobilePanel"'), html.indexOf("</header>"))).not.toMatch(/Новые лица|Первый старт/);
  });

  /** Видимый текст страницы при текущих data-service-*: без элементов data-needs с выключенным
   *  направлением и без замен data-unless, когда все их направления включены. */
  function visibleText(): string {
    const services = Object.fromEntries([...html.matchAll(/data-service-(\w+)="(on|off)"/g)].map((m) => [m[1], m[2] === "on"]));
    const VOID = new Set(["br", "img", "input", "meta", "link", "hr", "source", "rect", "circle", "line", "ellipse", "path"]);
    const body = html.slice(html.indexOf("<body"), html.indexOf("</body>")).replace(/<!--[\s\S]*?-->/g, "").replace(/<script[\s\S]*?<\/script>/g, "");
    let out = "", hiddenDepth = 0, depth = 0, last = 0;
    for (const m of body.matchAll(/<(\/?)(\w+)([^>]*?)(\/?)>/g)) {
      if (hiddenDepth === 0) out += body.slice(last, m.index);
      last = (m.index ?? 0) + m[0].length;
      const [, close, tag, attrs, selfClose] = m;
      if (VOID.has((tag ?? "").toLowerCase()) || selfClose) continue;
      if (close) { if (hiddenDepth && depth === hiddenDepth) hiddenDepth = 0; depth--; continue; }
      depth++;
      if (hiddenDepth) continue;
      const needs = /data-needs="([^"]*)"/.exec(attrs ?? "")?.[1]?.split(" ") ?? [];
      const unless = /data-unless="([^"]*)"/.exec(attrs ?? "")?.[1]?.split(" ") ?? [];
      if (needs.some((n) => !services[n]) || (unless.length > 0 && unless.every((n) => services[n]))) hiddenDepth = depth;
      out += " ";
    }
    return out.replace(/\s+/g, " ");
  }

  it("диджеи, музыканты и площадки пока скрыты одним переключателем на направление", () => {
    expect(html).toContain('<body id="top" data-service-dj="off" data-service-music="off" data-service-venue="off">');
    // Единственное разрешённое упоминание диджея — индивидуально, в комментарии к заявке.
    const EXTRA = "Диджей и другие услуги — обсуждаем индивидуально. Напишите о пожеланиях в комментарии к заявке.";
    const text = visibleText();
    expect(text).toContain(EXTRA);
    expect(text.replace(EXTRA, "")).not.toMatch(/дидже|площадк|музыкант|подрядчик|кавер|квартет/i);
    expect(text).toContain("JoyRest берёт на себя программу вашего праздника: ведущий, квизы, викторины и интерактивные игры-шоу под ваш формат — вам остаётся только прийти и радоваться.");
    // Старый текст первого экрана сохранён рядом — вернётся вместе с услугами.
    expect(html).toContain("площадку, ведущего, диджея и музыкантов подбираем под ваш формат и бюджет");
    expect(html).not.toMatch(/фокусник|шоу-блок/i);
    // Каждая комбинация замен data-unless покрыта правилом скрытия в CSS.
    for (const combo of new Set([...html.matchAll(/data-unless="([^"]*)"/g)].map((m) => m[1]))) {
      const selector = (combo ?? "").split(" ").map((n) => `[data-service-${n}="on"]`).join("") + ` [data-unless="${combo}"]`;
      expect(css, combo).toContain(`body${selector}`);
    }
    for (const n of ["dj", "music", "venue"]) expect(css).toContain(`body[data-service-${n}="off"] [data-needs~="${n}"]`);
    // Варианты списков убирает скрипт (iPhone не прячет <option> стилями).
    expect(js).toContain("option[data-needs], option[data-unless]");
  });

  it("смягчённые условия: без почасовой ставки, штрафов и залога; бронь, продление, договор", () => {
    for (const bad of ["₽/час", "штраф", "Штраф", "каждые начатые", "доплата за размер группы", "Доплата за размер группы", "Квиз, любой формат", "МКАД", "залог", "Залог", "8 500", "7 000 ₽/"]) {
      expect(html, bad).not.toContain(bad);
      expect(js, bad).not.toContain(bad);
    }
    for (const word of [/комисси/i, /маржа/i, /наценк/i, /агентству/i]) {
      for (const text of [html, js, pricing, css]) expect(text).not.toMatch(word);
    }
    const terms = html.slice(html.indexOf('<section id="terms"'), html.indexOf("</section>", html.indexOf('<section id="terms"')));
    const t = terms.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(t).toContain("Время программы считаем целиком, вместе с перерывами.");
    expect(t).toContain("Продление — 3 900 ₽ за 30 минут.");
    expect(t).toContain("Бронь даты — предоплата 2 000 ₽, засчитывается в стоимость. Отмена за 2 дня и раньше — возвращаем.");
    expect(t).toContain("По Москве выезд включён; если рядом с площадкой нет метро (дальше 10–15 минут пешком) — такси ведущему по факту.");
    expect(t).toContain("Города Подмосковья (Химки, Мытищи, Балашиха и другие) — +2 000 ₽ и такси ведущему; в праздничные дни — 5 000 ₽, с 19 декабря по 1 января — 7 000 ₽.");
    expect(t).toContain("Подробные условия — в договоре.");
    expect(plain).toContain("Утверждаем программу и тайминг. Бронь даты — предоплата 2 000 ₽, засчитывается в стоимость.");
    expect(plain).toContain("Пакеты рассчитаны на 1,5–2 часа. Нужно дольше — добавьте продление");
  });

  it("заявка: обязательные галочки данных, брони и условий; необязательное — в «Дополнительно»", () => {
    const form = html.slice(html.indexOf('<form id="leadForm"'), html.indexOf("</form>", html.indexOf('<form id="leadForm"')));
    expect(form).toContain('<input type="checkbox" id="termsAccept" required>');
    expect(form).toContain('<input type="checkbox" id="depositAccept" required>');
    expect(form.replace(/<[^>]+>/g, "")).toContain("Согласен(на) с условиями брони: предоплата 2 000 ₽ в счёт стоимости");
    expect(form.replace(/<[^>]+>/g, "")).toContain("Согласен(на) с условиями работы (подробно — в договоре)");
    // Галочка согласия на данные — первая в форме (её читает sendLead), условия — после.
    expect(form.indexOf("consent-row")).toBeLessThan(form.indexOf("terms-row"));
    expect(js).toContain("deposit: document.getElementById('depositAccept').checked");
    expect(js).toContain("terms: document.getElementById('termsAccept').checked");
    // Согласие на рассылку — необязательное и не отмечено заранее.
    expect(form).toContain('<input type="checkbox" id="marketingAccept">');
    expect(js).toContain("marketing: document.getElementById('marketingAccept').checked");
    const more = html.slice(html.indexOf('<details class="form-more" id="formMore">'), html.indexOf("</details>", html.indexOf('id="formMore"')));
    for (const id of ["hostLevel", "contactMethod", "contactLink"]) expect(more).toContain(`id="${id}"`);
    for (const id of ["name", "phone", "type", "guests", "message"]) expect(more).not.toContain(`id="${id}"`);
    expect(js).toContain("formMore.open = true");
  });

  it("частые вопросы — только факты о платформе и сроках, без брони и предоплаты", () => {
    const faq = html.slice(html.indexOf('<section id="faq"'), html.indexOf('<section id="reviews"'));
    expect(faq.match(/<details class="faq__item">/g)?.length).toBeGreaterThanOrEqual(5);
    expect(faq).not.toMatch(/предоплат|бронирован|бронь|аванс|договор/i);
  });

  it("калькулятор: шесть шагов, три цены сразу, длительность, полоска итога на телефоне", () => {
    for (const id of ["calcPacks", "calcTiers", "calcDays", "calcExtras", "calcExt", "calcAddons", "calcLevels", "calcDuration", "calcLines", "calcSubmit", "calcBar", "calcCard", "calcCardTotals", "calcCardEdit", "calcCardRemove", "calcLink", "calcLinked", "calcBarSend", "topToast"]) {
      expect(html, id).toContain(`id="${id}"`);
    }
    expect(html.indexOf('<script src="js/pricing.js"></script>')).toBeLessThan(html.indexOf('<script src="js/script.js"></script>'));
    expect(plain).toContain("Больше двух дополнительных игр — индивидуальный заказ:");
    expect(plain).toContain("Каждые следующие 30 минут — 3 900 ₽.");
    expect(plain).toContain("Это итог за весь вечер — без скрытых доплат. Отдельно только такси ведущему — за город и туда, где рядом нет метро.");
    expect(plain).toContain("Выезд по Москве");
    // Праздничная цена (22 октября 2026): дата праздника, причина и подсказка, блок ранней брони.
    for (const id of ["calcDate", "calcDateInfo", "calcDateClear", "calcSeason", "calcSeasonTitle", "calcSeasonBadge", "calcSeasonText", "calcSeasonEarly", "calcSeasonHint", "calcNoDate", "earlyPromo", "earlyCalc"]) {
      expect(html, id).toContain(`id="${id}"`);
    }
    expect(plain).toContain("Праздничная цена зависит от даты праздника, а не от дня брони");
    expect(plain).toContain("Новый год дешевле — если забронировать заранее!");
    expect(js).toContain("window.JoyPricing");
    // Старого почасового калькулятора нет.
    for (const old of ["calcHours", "calcGuests", "calcCustom", "calcComplexity", "calcQuiz", "calcHostLevel", "isWeekend ? 8500"]) {
      expect(html + js, old).not.toContain(old);
    }
  });

  it("обзор игр: 37 игр без «Олимпа», фильтр со счётчиками, правила у каждой", () => {
    const games = [...html.matchAll(/<article class="game" data-cat="(\w+)"( data-phone)?>/g)];
    expect(games).toHaveLength(37);
    expect(games.filter((g) => g[2])).toHaveLength(22);
    expect(plain + js).not.toMatch(/олимп/i);
    const counts: Record<string, number> = { all: 37, phone: 22, quiz: 6, tv: 3, music: 3, dance: 3, cards: 6, active: 5, party: 7, out: 3, custom: 1 };
    for (const [key, n] of Object.entries(counts)) {
      expect(html, key).toMatch(new RegExp(`data-filter="${key}"[^>]*>[^<]+<span class="filter__n">${n}</span>`));
    }
    const keys = [...html.matchAll(/class="game__rules" data-rule-key="([\w-]+)"/g)].map((m) => m[1]);
    expect(keys).toHaveLength(37);
    for (const key of keys) expect(js, key).toContain(`'${key}': { title:`);
    // Снимки — настоящие экраны и карточки платформы, с понятным описанием.
    for (const img of ["platform-hall", "platform-phone", "cards-mafia", "cards-bunker", "cards-truth", "cards-durak", "cards-loto", "game-board", "game-millionaire", "game-dragon", "game-checkers", "game-survival", "game-sweet", "game-alco", "game-meet", "game-hundred", "game-perudo", "game-wager", "game-wine", "cards-spy", "game-dance", "cover-toasts", "cover-freeze", "cover-silent", "cover-orchestra"]) {
      expect(html).toMatch(new RegExp(`<img src="img/${img}\\.webp" width="\\d+" height="\\d+" loading="lazy"[^>]* alt="[^"]{20,}"`));
    }
    // У каждой игры картинка: снимок платформы или своя обложка, без латинской подписи «JOYREST».
    for (const m of html.matchAll(/<article class="game"[\s\S]*?<\/article>/g)) {
      expect(m[0]).toMatch(/<div class="game__media[^"]*"><img src="img\/[\w-]+\.(webp|svg)"/);
    }
    expect(html).not.toContain("game__cover-mark");
    expect(html).not.toContain(">JOYREST<");
    // Каждая игра есть в списке «Тип мероприятия» заявки.
    for (const m of html.matchAll(/<article class="game"[\s\S]*?<h3>([^<]+)<\/h3>/g)) expect(html, m[1]).toContain(`<option>${m[1]}</option>`);
  });

  it("география — строкой в контактах, без карты", () => {
    expect(html).not.toContain("coverage-map");
    expect(plain).toContain("Москва — выезд включён, Подмосковье — +2 000 ₽ и такси, другие регионы — по договорённости");
  });

  it("окна правил и политики: закрываются кнопкой, фоном и Escape, фокус возвращается", () => {
    expect(js).toContain("e.key === 'Escape'");
    expect(js).toContain("lastFocus.focus");
    expect(html).toMatch(/id="ruleModalOverlay" role="dialog" aria-modal="true"/);
    expect(html).toMatch(/id="privacyModalOverlay" role="dialog" aria-modal="true"/);
  });

  it("эмблема: из public/brand, статична при «уменьшить движение», датчик — без запроса разрешения", () => {
    expect(html).toContain('data-brand-svg="joyrest-emblem"');
    expect(html).toContain("--emblem-mask: url(/img/joyrest-emblem-mask.svg)"); // абсолютный: url() в переменной считается от файла стилей
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.emblem-tilt, \.emblem-gradient\{ animation: none; transform: none; \}/);
    expect(reduced).toMatch(/\.emblem-glint\{ animation: none; display: none; \}/);
    // Анимируются только transform и opacity.
    for (const name of ["emblemTilt", "emblemFlow", "emblemGlint", "emblemGlow"]) {
      const body = css.slice(css.indexOf(`@keyframes ${name}{`), css.indexOf("\n}", css.indexOf(`@keyframes ${name}{`)));
      const props = [...body.matchAll(/([a-z-]+):/g)].map((m) => m[1]);
      expect(props.every((p) => p === "transform" || p === "opacity"), `${name}: ${props.join(",")}`).toBe(true);
    }
    const tilt = css.slice(css.indexOf("@keyframes emblemTilt{"), css.indexOf("@keyframes emblemFlow{"));
    for (const deg of tilt.match(/rotate[XY]\((-?\d+)deg\)/g) ?? []) expect(Math.abs(Number(/(-?\d+)/.exec(deg)?.[1]))).toBeLessThanOrEqual(12);
    expect(tilt).not.toMatch(/rotateZ|rotate\(/);
    expect(js).toContain("DeviceOrientationEvent.requestPermission === 'function'");
    expect(css).toMatch(/\.emblem-glint\{[^}]*animation: emblemGlint 5s/);
    expect(css).toMatch(/\.emblem-glow\{[^}]*animation: emblemGlow 5s/);
    // Пока эмблема видна — логотип в шапке скрыт, место сохраняется (opacity/visibility, не display).
    expect(css).toMatch(/header\.logo-hidden \.logo\{ opacity: 0;[^}]*visibility: hidden;/);
    expect(css).not.toMatch(/logo-hidden[^{]*\{[^}]*display: none/);
    expect(js).toContain("siteHeader.classList.toggle('logo-hidden', entries[0].isIntersecting)");
    expect(js).not.toContain("requestPermission()");
  });
});

describe("логотип сайта", () => {
  const root = resolve(import.meta.dirname, "../..");
  const html = readFileSync(join(root, "site/index.html"), "utf8");
  const css = readFileSync(join(root, "site/css/style.css"), "utf8");

  it("логотип — ссылка на начало страницы, файлы из public/brand", () => {
    expect(html).toMatch(/<body id="top"[ >]/);
    expect(html).toMatch(/<a href="#top" class="logo"/);
    expect(html).toContain('data-brand-svg="joyrest-logo"');
    expect(html).toContain('data-brand-svg="joyrest-monogram"');
    expect(html).not.toContain("logo.png");
    expect(readdirSync(join(root, "site"), { recursive: true })).not.toContain("img/logo.png");
  });

  it("анимации рамки и сцены отключаются при «уменьшить движение»", () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\{[\s\S]*?\.logo-frame\{ animation: none; \}/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\{[\s\S]*?\.spot, \.blob, \.dust, \.ticker__in/);
  });

  it("сборка встраивает SVG без метаданных, с уникальными id, и делает PNG-иконки", () => {
    execFileSync(process.execPath, [join(root, "node_modules/tsx/dist/cli.mjs"), join(root, "scripts/build-site.ts")], { cwd: root });
    const out = join(root, "build/site");
    const built = readFileSync(join(out, "index.html"), "utf8");
    expect(built.match(/<svg aria-hidden="true"/g)).toHaveLength(3); // логотип, монограмма, эмблема (у QR — свой атрибут)
    expect(built).not.toMatch(/<svg[^>]*aria-hidden="true"[^>]*aria-hidden=/);
    // QR канала распознаётся, как QR платформы (src/brand/qrSvg.test.ts): крупно и мелко.
    const qr = /data-brand-qr="https:\/\/t\.me\/JoyRest">(<svg[\s\S]*?<\/svg>)<\/div>/.exec(built)?.[1] ?? "";
    expect(qr).toContain("<svg");
    for (const width of [600, 240]) {
      const image = new Resvg(qr, { fitTo: { mode: "width", value: width } }).render();
      const pixels = new Uint8ClampedArray(image.pixels.buffer, image.pixels.byteOffset, image.pixels.length);
      expect(jsQR(pixels, image.width, image.height)?.data, `ширина ${width}`).toBe("https://t.me/JoyRest");
    }
    expect(built).not.toContain("<metadata");
    expect(built).not.toContain("c2pa");
    const ids = [...built.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids.filter((id) => id?.startsWith("jrc"))) expect(built).toContain(`url(#${id})`);

    const size = (file: string) => {
      const png = readFileSync(join(out, file));
      return [png.readUInt32BE(16), png.readUInt32BE(20)];
    };
    expect(size("favicon-32.png")).toEqual([32, 32]);
    expect(size("apple-touch-icon.png")).toEqual([180, 180]);
    expect(built).toContain('rel="apple-touch-icon" href="/apple-touch-icon.png"');
    for (const dir of ["css", "js", "img"]) {
      expect(readdirSync(join(out, dir)).every((name) => /\.[0-9a-f]{10}\.\w+$/.test(name)), dir).toBe(true);
    }
    // Все три скрипта и снимки игр — с отпечатком в именах.
    for (const name of ["theme", "pricing", "script"]) expect(built).toMatch(new RegExp(`<script src="js/${name}\\.[0-9a-f]{10}\\.js"></script>`));
    expect(built).toMatch(/<img src="img\/cards-loto\.[0-9a-f]{10}\.webp"/);
    // Калькулятор без заявки — самодостаточная страница: стили и скрипты встроены, формы заявки нет.
    const calc = readFileSync(join(out, "calc/index.html"), "utf8");
    expect(calc).not.toContain("data-inline");
    expect(calc).not.toMatch(/<script src=|<link rel="stylesheet"/);
    expect(calc).toContain("JoyPricing");
    expect(calc).toContain("@font-face");
    expect(calc).not.toMatch(/<form\b|fetch\(|XMLHttpRequest|sendBeacon/);
    // Страницы услуг: логотипы встроены, стили и скрипт темы — с отпечатком, sitemap.xml на месте.
    const page = readFileSync(join(out, "korporativ/index.html"), "utf8");
    expect(page).not.toMatch(/data-brand-svg="[a-z-]+"><\/span>/);
    expect(page.match(/<svg aria-hidden="true"/g)).toHaveLength(2);
    for (const name of ["fonts", "style", "landing"]) expect(page).toMatch(new RegExp(`href="/css/${name}\\.[0-9a-f]{10}\\.css"`));
    expect(page).toMatch(/<script src="\/js\/theme\.[0-9a-f]{10}\.js"><\/script>/);
    expect(readFileSync(join(out, "sitemap.xml"), "utf8")).toContain("<loc>https://joy-rest.ru/korporativ/</loc>");
  }, 30_000);
});

describe("поисковики: главная, страницы услуг, sitemap (решение владельца 22 октября 2026)", () => {
  const root = resolve(import.meta.dirname, "../..");
  const html = readFileSync(join(root, "site/index.html"), "utf8");
  const sitemap = readFileSync(join(root, "site/sitemap.xml"), "utf8");
  const slugs = [...html.matchAll(/<a href="\/([a-z-]+)\/">/g)].map((m) => m[1] ?? "");
  const pages = slugs.map((slug) => ({ slug, html: readFileSync(join(root, "site", slug, "index.html"), "utf8") }));
  const ld = (text: string) => [...text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1] ?? "") as unknown);

  it("главная: адрес страницы, описание с ключевыми словами, разметка услуги", () => {
    expect(html).toContain('<link rel="canonical" href="https://joy-rest.ru/">');
    const title = /<title>([^<]+)<\/title>/.exec(html)?.[1] ?? "";
    expect(title.length).toBeLessThanOrEqual(70);
    const description = /<meta name="description" content="([^"]+)">/.exec(html)?.[1] ?? "";
    for (const word of ["квиз", "викторин", "интерактивн", "корпоратив", "новогодний", "Москва и Подмосковье"]) {
      expect(`${title} ${description}`, word).toContain(word);
    }
    expect(JSON.stringify(ld(html))).toContain('"Московская область"');
    // Подтверждение прав в Яндекс Вебмастере — на главной (и в витрине, она собирается из неё).
    expect(html).toContain('<meta name="yandex-verification" content="3d43ff22d0fc43dd">');
    expect(html).toContain('<meta name="google-site-verification" content="Ter0pWYDr5FiCEQqDWRFaFRQlDQUyMNk-qzEGYNxcsw">');
  });

  it("каждая страница услуги — своя: адрес, заголовок, описание, разметка, ссылка в подвале и в sitemap", () => {
    expect(slugs.length).toBeGreaterThanOrEqual(7);
    const titles = new Set<string>();
    for (const { slug, html: page } of pages) {
      const url = `https://joy-rest.ru/${slug}/`;
      expect(page, slug).toContain(`<link rel="canonical" href="${url}">`);
      expect(sitemap, slug).toContain(`<loc>${url}</loc>`);
      const title = /<title>([^<]+)<\/title>/.exec(page)?.[1] ?? "";
      expect(title.length, slug).toBeLessThanOrEqual(80);
      expect(titles.has(title), slug).toBe(false);
      titles.add(title);
      expect(page.match(/<h1>/g), slug).toHaveLength(1);
      expect(page, slug).toMatch(/<meta name="description" content="[^"]{80,200}">/);
      expect(page, slug).toContain("Москва и Подмосковье");
      const graph = JSON.stringify(ld(page));
      for (const type of ['"Service"', '"BreadcrumbList"', '"FAQPage"']) expect(graph, `${slug} ${type}`).toContain(type);
      // Ведут в калькулятор и к связи; форм и сбора данных нет — работают и в витрине.
      expect(page, slug).toContain('href="/calc/"');
      expect(page, slug).not.toMatch(/<form\b|fetch\(|<input/);
    }
  });

  it("на страницах услуг — только то, что есть на главной: без площадок, диджеев, штрафов и чужих названий", () => {
    for (const { slug, html: page } of pages) {
      const text = page.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ");
      expect(text, slug).not.toMatch(/дидже|площадк|музыкант|подрядчик|кавер|квартет|фокусник|шоу-блок|МКАД|залог|штраф|₽\/час/i);
      expect(text, slug).not.toMatch(/комисси|маржа|наценк|агентству/i);
      expect(text, slug).not.toMatch(/Своя игра|Кто хочет стать миллионером|100 к 1|Угадай мелодию|Just Dance|Бункер|Перудо/);
    }
    // Цены — из таблицы калькулятора.
    const pricing = readFileSync(join(root, "site/js/pricing.js"), "utf8");
    for (const sum of ["14900", "19900", "22900", "21400"]) expect(pricing).toContain(sum);
  });

  it("sitemap.xml — только адреса joy-rest.ru, главная и калькулятор", () => {
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1] ?? "");
    expect(locs).toContain("https://joy-rest.ru/");
    expect(locs).toContain("https://joy-rest.ru/calc/");
    expect(locs.every((loc) => loc.startsWith("https://joy-rest.ru/"))).toBe(true);
    expect(new Set(locs).size).toBe(locs.length);
  });
});
