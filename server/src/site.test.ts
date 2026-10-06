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

  it("в политике домен joy-rest.ru", () => {
    expect(html).toContain("joy-rest.ru");
    expect(html).not.toMatch(/[^-.\w]joyrest\.ru/);
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
    }
    expect(value(dark, "logo-color")).not.toBe(value(css, "logo-color"));
  });

  it("анимация рамки отключается при «уменьшить движение»", () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\{[\s\S]*?\.logo-frame\{ animation: none; \}/);
  });

  it("сборка встраивает SVG без метаданных, с уникальными id, и делает PNG-иконки", () => {
    execFileSync(process.execPath, [join(root, "node_modules/tsx/dist/cli.mjs"), join(root, "scripts/build-site.ts")], { cwd: root });
    const out = join(root, "build/site");
    const built = readFileSync(join(out, "index.html"), "utf8");
    expect(built.match(/<svg aria-hidden="true"/g)).toHaveLength(2);
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
