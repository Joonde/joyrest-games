import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { contrastRatio } from "../../src/themes/contrast";
import { buildApp } from "./app";

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
  "css/style.0123456789.css": "body{}",
  "img/logo.0123456789.png": "png",
  "fonts/jost-latin-400-normal.woff2": "font",
  "favicon.svg": "<svg/>",
});

const stubDir = dir({ "index.html": "<title>Скоро</title>", "joyrest-logo.svg": "<svg/>" });

function app(indexing: boolean, enabled = true) {
  return buildApp({
    version: "abc",
    publicDir: platform,
    checkDatabase: async () => true,
    site: { dir: siteDir, enabled, stubDir, hosts: ["joy-rest.ru", "test.joy-rest.ru"], indexing },
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
    expect(robots.body).toBe("User-agent: *\nAllow: /\n");
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

describe("исходники сайта (site/)", () => {
  const root = resolve(import.meta.dirname, "../../site");
  const html = readFileSync(join(root, "index.html"), "utf8");
  const css = readFileSync(join(root, "css/style.css"), "utf8") + readFileSync(join(root, "css/fonts.css"), "utf8");
  const js = readFileSync(join(root, "js/script.js"), "utf8");

  it("без внешних шрифтов и картинок", () => {
    for (const text of [html, css, js]) {
      expect(text).not.toMatch(/fonts\.googleapis|fonts\.gstatic|images\.unsplash/);
    }
  });

  it("виджет Telegram грузится лениво из скрипта, не из разметки", () => {
    expect(html).not.toContain("telegram-widget.js");
    expect(js).toContain("telegram-widget.js");
    expect(js).toContain("IntersectionObserver");
  });

  it("формы шлют на /api/lead, у каждой есть ловушка и место для ошибки", () => {
    expect(js).toContain("fetch('/api/lead'");
    expect(js).not.toContain("sendToTelegram");
    expect(js).not.toContain("api.telegram.org");
    expect(html.match(/name="website"/g)).toHaveLength(3);
    for (const id of ["askError", "reviewError", "formError"]) expect(html).toContain(`id="${id}"`);
  });

  it("в блоке «Шоу» нет кнопок без действия, пожелания — в комментарии к заявке", () => {
    for (const text of [html, css, js]) expect(text).not.toContain("show-pick");
    expect(html).toContain("напишите о пожеланиях в комментарии к заявке");
  });

  it("шапка: «Оставить заявку» ведёт к форме с фокусом, «Услуги» раскрывает раздел", () => {
    expect(html).toMatch(/<a href="#contact" class="hbtn hbtn--primary" data-focus-target="name">Оставить заявку<\/a>/);
    expect(html).toMatch(/<a href="#services" class="hbtn hbtn--secondary" data-open-section="services">Услуги<\/a>/);
    expect(html).toContain('<input type="text" id="name"');
    expect(js).toContain("[data-focus-target]");
    expect(js).toContain("[data-open-section]");
    // Кнопки для пальца — не ниже 44px.
    expect(css).toMatch(/\.hbtn\{[^}]*min-height: 44px/);
  });

  it("полосы с фоном не шире страницы, пятна первого экрана — не ячейки сетки", () => {
    expect(html).not.toMatch(/margin: 0 -32px/);
    expect(css).toMatch(/\.band\{ margin-left: calc\(-1 \* var\(--wrap-pad\)\)/);
    expect(css).toContain(".hero > *:not(.blob){ position: relative;");
  });

  it("свёрнутые разделы компактные, на телефоне между секциями не больше 64px", () => {
    expect(css).toMatch(/section\.is-collapsible:not\(\.is-open\) \.section-head\{ margin-bottom: 0; padding-bottom: 0; border-bottom: none; \}/);
    const phone = css.slice(css.indexOf("@media (max-width: 760px){\n    .nav-links"));
    expect(phone).toMatch(/section\{ padding: 32px 0; \}/);
    expect(html.match(/class="[^"]*is-collapsible[^"]*"/g)).toHaveLength(3);
  });

  it("в политике домен joy-rest.ru", () => {
    expect(html).toContain("joy-rest.ru");
    expect(html).not.toMatch(/[^-.\w]joyrest\.ru/);
  });
});

describe("контраст сайта в светлой и тёмной теме (WCAG AA, как у платформы)", () => {
  const root = resolve(import.meta.dirname, "../..");
  const css = readFileSync(join(root, "site/css/style.css"), "utf8");
  const html = readFileSync(join(root, "site/index.html"), "utf8");

  /** Переменные блока :root{…}: светлая тема — первый, тёмная — внутри prefers-color-scheme: dark. */
  function tokens(block: string): Record<string, string> {
    return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})\b/g)].map((m) => [m[1] ?? "", m[2] ?? ""]));
  }
  const lightBlock = css.slice(css.indexOf(":root{"), css.indexOf("}", css.indexOf(":root{")));
  const darkStart = css.search(/@media \(prefers-color-scheme: dark\)\{\s*:root\{/);
  const darkBlock = css.slice(darkStart, css.indexOf("}", darkStart));
  const light = tokens(lightBlock);
  const dark = { ...light, ...tokens(darkBlock) };
  const dark2 = /\.emblem\{ --emb-1: (#\w{6}); --emb-2: (#\w{6}); --emb-3: (#\w{6})/.exec(css.slice(darkStart));

  // [текст, фон, норма]: 4.5 — текст, 3 — крупный текст, рамки и графика.
  const pairs = (t: Record<string, string>, surfaces: string[]): [string, string, number][] => [
    ...surfaces.flatMap((bg): [string, string, number][] => [
      [t.ink ?? "", bg, 4.5],
      [t["ink-soft"] ?? "", bg, 4.5],
      [t["accent-text"] ?? "", bg, 4.5],
      [t["green-text"] ?? "", bg, 4.5],
      [t["btn-outline-text"] ?? "", bg, 4.5],
      [t["btn-outline"] ?? "", bg, 3],
    ]),
    // Текст на цветных заливках кнопок и плашек.
    ...["coral", "emerald", "gold", "wine", "btn-primary-bg"].map((fill): [string, string, number] => [t["on-accent"] ?? "", t[fill] ?? "", 4.5]),
    [t["btn-primary-text"] ?? "", t["btn-primary-bg"] ?? "", 4.5],
    // «Задать вопрос» и тёмная кнопка меню: фон --ink, текст --bg.
    [t.bg ?? "", t.ink ?? "", 4.5],
  ];

  it.each([
    ["светлая", light, ["#FFFFFF"]],
    ["тёмная", dark, []],
  ] as const)("%s тема: текст, кнопки и рамки", (_name, t, extra) => {
    const surfaces = [t.bg ?? "", t["bg-alt"] ?? "", ...extra];
    for (const [fg, bg, need] of pairs(t, surfaces)) {
      expect(fg, "нет цвета в токенах").toMatch(/^#/);
      expect(bg, "нет цвета в токенах").toMatch(/^#/);
      expect(contrastRatio(fg, bg), `${fg} на ${bg}`).toBeGreaterThanOrEqual(need);
    }
  });

  it("эмблема различима на фоне в обеих темах (≥ 3)", () => {
    const lightEmblem = /\.emblem\{\s*--emb-1: (#\w{6}); --emb-2: (#\w{6}); --emb-3: (#\w{6})/.exec(css);
    for (const [colors, bg] of [[lightEmblem, light.bg], [dark2, dark.bg]] as const) {
      expect(colors).not.toBeNull();
      for (const c of colors?.slice(1) ?? []) expect(contrastRatio(c ?? "", bg ?? ""), `${c} на ${bg}`).toBeGreaterThanOrEqual(3);
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

  it("отзывы: честный подзаголовок, кнопка и форма скрыты одной настройкой, пост Telegram на месте", () => {
    expect(html).toContain("Мы только открываемся — здесь появятся фото и отзывы с наших первых мероприятий. А пока заглядывайте в наш Telegram-канал.");
    expect(html).toContain('<section id="reviews" data-review-form="off">');
    expect(css).toMatch(/\[data-review-form="off"\] #openReviewForm,\s*\[data-review-form="off"\] #reviewFormWrap\{ display: none; \}/);
    expect(html).toContain('id="tgPost"');
  });

  it("свадьбы — «скоро»: в форме заявки варианта нет, на первом экране приглушённо", () => {
    expect(html).not.toMatch(/<option>Свадьба/);
    expect(html).toContain('<li class="dir-soon">💍 Свадьбы — скоро</li>');
    expect(html).toContain("Будем благодарны за согласие на фото и отзыв для нашего портфолио — это по желанию.");
    expect(html).not.toContain("Условие бронирования");
  });

  it("«Форматы программ» внутри сворачиваемых «Услуг», в меню — «Оставить заявку»", () => {
    const start = html.indexOf('id="servicesList"');
    const end = html.indexOf("/servicesList");
    expect(html.indexOf('class="formats-block"')).toBeGreaterThan(start);
    expect(html.indexOf('class="formats-block"')).toBeLessThan(end);
    expect(html).toContain('<a href="#contact" class="nav-cta" data-focus-target="name">Оставить заявку</a>');
    expect(html).not.toContain("Обсудить мероприятие");
  });

  it("карточки, которые не нажимаются, не реагируют на наведение", () => {
    expect(css).not.toMatch(/\.(event|package|step|service-row):hover/);
  });

  it("эмблема: из public/brand, статична при «уменьшить движение», датчик — без запроса разрешения", () => {
    expect(html).toContain('data-brand-svg="joyrest-emblem"');
    expect(html).toContain("--emblem-mask: url(/img/joyrest-emblem-mask.svg)"); // абсолютный: url() в переменной считается от файла стилей
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.emblem-tilt, \.emblem-gradient\{ animation: none; transform: none; \}/);
    expect(reduced).toMatch(/\.emblem-glint\{ animation: none; display: none; \}/);
    // Анимируются только transform и opacity.
    for (const name of ["emblemTilt", "emblemFlow", "emblemGlint"]) {
      const body = css.slice(css.indexOf(`@keyframes ${name}{`), css.indexOf("\n  }", css.indexOf(`@keyframes ${name}{`)));
      const props = [...body.matchAll(/([a-z-]+):/g)].map((m) => m[1]);
      expect(props.every((p) => p === "transform" || p === "opacity"), `${name}: ${props.join(",")}`).toBe(true);
    }
    // Наклон ±8° и без вращения по кругу.
    const tilt = css.slice(css.indexOf("@keyframes emblemTilt{"), css.indexOf("@keyframes emblemFlow{"));
    for (const deg of tilt.match(/rotate[XY]\((-?\d+)deg\)/g) ?? []) expect(Math.abs(Number(/(-?\d+)/.exec(deg)?.[1]))).toBeLessThanOrEqual(8);
    expect(tilt).not.toMatch(/rotateZ|rotate\(/);
    expect(js).toContain("DeviceOrientationEvent.requestPermission === 'function'");
    expect(js).not.toContain("requestPermission()");
  });
});

describe("логотип сайта", () => {
  const root = resolve(import.meta.dirname, "../..");
  const html = readFileSync(join(root, "site/index.html"), "utf8");
  const css = readFileSync(join(root, "site/css/style.css"), "utf8");

  it("логотип — ссылка на начало страницы, файлы из public/brand", () => {
    expect(html).toMatch(/<body id="top">/);
    expect(html).toMatch(/<a href="#top" class="logo"/);
    expect(html).toContain('data-brand-svg="joyrest-logo"');
    expect(html).toContain('data-brand-svg="joyrest-monogram"');
    expect(html).not.toContain("logo.png");
    expect(readdirSync(join(root, "site"), { recursive: true })).not.toContain("img/logo.png");
  });

  it("цвет логотипа и подложки: контраст ≥ 3 в светлой и тёмной теме", () => {
    const darkStart = css.search(/@media \(prefers-color-scheme: dark\)\{\s*:root\{/);
    expect(darkStart).toBeGreaterThan(0);
    const dark = css.slice(darkStart);
    const value = (text: string, name: string) => {
      const m = new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(text);
      if (!m?.[1]) throw new Error(`нет --${name}`);
      return m[1];
    };
    for (const part of [css, dark]) {
      expect(contrastRatio(value(part, "logo-color"), value(part, "logo-bg"))).toBeGreaterThanOrEqual(3);
      // Контур вторичной кнопки шапки — с фоном шапки ≥ 3, её текст ≥ 4.5.
      expect(contrastRatio(value(part, "btn-outline"), value(part, "logo-bg"))).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(value(part, "btn-outline-text"), value(part, "logo-bg"))).toBeGreaterThanOrEqual(4.5);
    }
    // Основная кнопка: тёмный текст на пыльной розе.
    expect(contrastRatio(value(css, "btn-primary-text"), value(css, "btn-primary-bg"))).toBeGreaterThanOrEqual(4.5);
    expect(value(dark, "logo-color")).not.toBe(value(css, "logo-color"));
  });

  it("анимация рамки отключается при «уменьшить движение»", () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\{[\s\S]*?\.logo-frame\{ animation: none; \}/);
  });

  it("сборка встраивает SVG без метаданных, с уникальными id, и делает PNG-иконки", () => {
    execFileSync(process.execPath, [join(root, "node_modules/tsx/dist/cli.mjs"), join(root, "scripts/build-site.ts")], { cwd: root });
    const out = join(root, "build/site");
    const built = readFileSync(join(out, "index.html"), "utf8");
    expect(built.match(/<svg aria-hidden="true"/g)).toHaveLength(3); // логотип, монограмма, эмблема
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
    expect(readdirSync(join(out, "css")).every((name) => /\.[0-9a-f]{10}\.css$/.test(name))).toBe(true);
  }, 30_000);
});
