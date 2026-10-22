import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { parseEdition, withEdition } from "./edition";
import { migrate } from "./migrate";

function dir(): string {
  const d = mkdtempSync(join(tmpdir(), "joyrest-edition-"));
  writeFileSync(join(d, "index.html"), "<!doctype html><html><head><title>JoyRest</title></head><body></body></html>");
  return d;
}

function siteDir(): string {
  const d = mkdtempSync(join(tmpdir(), "joyrest-edition-site-"));
  mkdirSync(join(d, "css"));
  writeFileSync(join(d, "index.html"), "<!doctype html><html><head><title>Сайт</title></head><body>Сайт агентства</body></html>");
  return d;
}

describe("редакция платформы: без базы", () => {
  it("Лайт — только точное «lite», остальное — агентство", () => {
    expect(parseEdition("lite")).toBe("lite");
    expect(parseEdition(" LITE\r\n")).toBe("lite");
    for (const v of [undefined, "", "agency", "lite2", "лайт", "on"]) expect(parseEdition(v), String(v)).toBe("agency");
  });

  it("метка редакции в index.html", () => {
    expect(withEdition("<html><head></head></html>", "lite")).toContain('<meta name="joyrest-edition" content="lite"></head>');
    expect(withEdition("<p>", "agency")).toBe('<meta name="joyrest-edition" content="agency"><p>');
  });

  it("страница сообщает редакцию: по умолчанию агентство, в Лайте — lite", async () => {
    const agency = buildApp({ version: "t", publicDir: dir(), checkDatabase: async () => true });
    const lite = buildApp({ version: "t", publicDir: dir(), checkDatabase: async () => true, edition: "lite" });
    for (const url of ["/", "/studio"]) {
      expect((await agency.inject(url)).body).toContain('content="agency"');
      const body = (await lite.inject(url)).body;
      expect(body).toContain('content="lite"');
      expect(body).toContain('name="joyrest-data"');
    }
    await agency.close();
    await lite.close();
  });

  it("в Лайте нет сайта агентства и заявок, даже если переданы настройки сайта", async () => {
    const site = { dir: siteDir(), enabled: true, showcase: false, stubDir: null, hosts: ["joy-rest.ru"], indexing: false };
    const lead = { telegram: null };
    const agency = buildApp({ version: "t", publicDir: dir(), checkDatabase: async () => true, site, lead });
    const lite = buildApp({ version: "t", publicDir: dir(), checkDatabase: async () => true, site, lead, edition: "lite" });
    expect((await agency.inject({ url: "/", headers: { host: "joy-rest.ru" } })).body).toContain("Сайт агентства");
    expect((await lite.inject({ url: "/", headers: { host: "joy-rest.ru" } })).body).not.toContain("Сайт агентства");
    const leadReq = { method: "POST" as const, url: "/api/lead", headers: { host: "joy-rest.ru", origin: "https://joy-rest.ru" }, payload: {} };
    expect((await agency.inject(leadReq)).statusCode).not.toBe(404);
    expect((await lite.inject(leadReq)).statusCode).toBe(404);
    await agency.close();
    await lite.close();
  });

  it("compose: основная и тестовая версии — агентство; Лайт для проверки — отдельно, мало памяти, своя база", () => {
    const root = resolve(import.meta.dirname, "../..");
    const compose = readFileSync(join(root, "deploy/compose.yml"), "utf8");
    const service = (name: string) => {
      const start = compose.indexOf(`\n  ${name}:\n`);
      expect(start, name).toBeGreaterThan(0);
      const next = compose.slice(start + 1).search(/\n {2}[a-z][\w-]*:\n|\nnetworks:/);
      return compose.slice(start, next < 0 ? undefined : start + 1 + next);
    };
    expect(service("app-prod")).not.toContain("EDITION");
    expect(service("app-test")).not.toContain("EDITION");
    const lite = service("app-lite-test");
    expect(lite).toMatch(/^ {6}EDITION: lite$/m);
    expect(lite).toMatch(/^ {6}DATA_BACKEND: server$/m);
    expect(lite).toContain("image: ${APP_TEST_IMAGE}");
    expect(lite).toContain("@postgres:5432/joyrest_lite_test");
    expect(lite).toContain("${TEST_DB_USER:-joyrest}");
    expect(lite).toContain("- /srv/joyrest/media/lite-test:/app/media");
    expect(lite).toMatch(/networks: \[web-test, db-test\]/);
    expect(lite).toMatch(/mem_limit: 192m/);
    expect(lite).not.toMatch(/ports:|LEAD_TELEGRAM|SITE_HOSTS/);
    const caddy = readFileSync(join(root, "deploy/caddy/Caddyfile"), "utf8");
    expect(caddy).toMatch(/lite-test\.joy-rest\.ru \{[^}]*X-Robots-Tag "noindex, nofollow"[^}]*reverse_proxy app-lite-test:8080/s);
    const joyrest = readFileSync(join(root, "deploy/bin/joyrest"), "utf8");
    expect(joyrest).toContain("for db in joyrest_test joyrest_lite_test; do");
    expect(joyrest).toContain("for db in joyrest_prod joyrest_test joyrest_lite_test; do");
    expect(joyrest).toContain("dc up -d --no-deps app-test app-lite-test");
    expect(joyrest).toContain("run_migrations lite");
  });

  it("joyrest: база Лайта мигрирует и при выкладке main, и при joyrest up; пароль владельца Лайта задаётся", () => {
    const joyrest = readFileSync(resolve(import.meta.dirname, "../../deploy/bin/joyrest"), "utf8");
    const fn = (name: string) => {
      const start = joyrest.indexOf(`\n${name}() {`);
      expect(start, name).toBeGreaterThan(0);
      return joyrest.slice(start, joyrest.indexOf("\n}", start + 1));
    };
    // Миграция Лайта — не только для test: иначе после выкладки main app-lite-test стартует на пустой базе.
    const deploy = fn("deploy_env");
    expect(deploy).toContain('if [ "$env" = test ] || [ ! -e "$ROOT_DIR/test-current" ]; then');
    expect(deploy).toContain('migrate_lite "$(release_value test APP_IMAGE)"');
    expect(deploy.indexOf("migrate_lite")).toBeLessThan(deploy.indexOf('switch_to "$env" "$sha"'));
    expect(fn("cmd_up")).toContain('migrate_lite "$(release_value test APP_IMAGE)"');
    // Ошибка миграции Лайта не роняет выкладку.
    expect(fn("migrate_lite")).toMatch(/run_migrations lite "\$1" \|\| log /);
    const run = fn("run_migrations");
    expect(run).toContain("lite) db=joyrest_lite_test ;;");
    expect(run).toContain("prod) db=joyrest_prod ;;");
    const password = fn("cmd_admin_password");
    expect(password).toContain('case "$target" in prod|test|lite) ;;');
    expect(password).toContain("service=app-lite-test env=test host=lite-test.joy-rest.ru");
  });
});

// Адреса разделов агентства: в Лайте — 404, в платформе агентства — есть (без входа — не 404).
const AGENCY_PATHS = [
  "/api/clients",
  "/api/notices",
  "/api/events?scope=upcoming",
  "/api/calendar?from=2026-01-01&to=2026-01-02",
  "/api/venues",
  "/api/venue-requests",
  "/api/telegram/me",
  "/api/team",
  "/api/proposals?mine=1",
  "/api/users/x/points",
  "/api/reviews",
  "/api/photos",
  "/api/brandings",
];
// Игры, сессии, музыка, видео, показы — общие для обеих редакций.
const SHARED_PATHS = ["/api/auth/me", "/api/games?scope=agency", "/api/tracks", "/api/videos", "/api/decks", "/api/time"];

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("редакция Лайт на PostgreSQL: разделов агентства нет", () => {
  const SCHEMA = "edition_test";
  const admin = postgres(url ?? "", { max: 1, onnotice: () => {} });
  const sql = postgres(url ?? "", { max: 3, onnotice: () => {}, connection: { search_path: SCHEMA } });
  const agency = buildApp({ version: "t", publicDir: null, checkDatabase: async () => true, sql });
  const lite = buildApp({ version: "t", publicDir: null, checkDatabase: async () => true, sql, edition: "lite" });
  const get = (app: typeof lite, path: string) => app.inject({ method: "GET", url: path, headers: { host: "games.test" } });

  beforeAll(async () => {
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.unsafe(`create schema ${SCHEMA}`);
    await migrate(sql, resolve(import.meta.dirname, "../migrations"));
  });

  afterAll(async () => {
    await agency.close();
    await lite.close();
    await sql.end();
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  it("CRM, команда, площадки, Telegram и баллы — только у агентства", async () => {
    for (const path of AGENCY_PATHS) {
      expect((await get(agency, path)).statusCode, `агентство ${path}`).not.toBe(404);
      expect((await get(lite, path)).statusCode, `Лайт ${path}`).toBe(404);
    }
  });

  it("Лайт не сохраняет оформление под заказчика в сессии (платный шаблон), агентство — сохраняет", () => {
    const live = readFileSync(resolve(import.meta.dirname, "live.ts"), "utf8");
    expect(live).toContain('const branding = options.brandings === false ? null : parseBranding(body.branding ?? null);');
    const app = readFileSync(resolve(import.meta.dirname, "app.ts"), "utf8");
    expect(app).toContain("registerLive(app, { ...options.live, sql: options.sql, isSite, brandings: !lite });");
  });

  it("игры, музыка, видео и показы есть в обеих редакциях", async () => {
    for (const path of SHARED_PATHS) {
      expect((await get(lite, path)).statusCode, `Лайт ${path}`).not.toBe(404);
    }
  });
});
