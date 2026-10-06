/**
 * Сайт агентства не включается сам (CLAUDE.md, «Сайт агентства»): ни слияние PR, ни выкладка,
 * ни перезагрузка сервера. Включает только владелец командой `sudo joyrest site on`, которая
 * пишет SITE_ENABLED=on в /srv/joyrest/settings.env. Здесь проверяем все места, откуда могло бы
 * прийти «включено»: значения по умолчанию в compose, образ, приложение, команды сервера, CI.
 * test.joy-rest.ru закрыт паролем; без хэша владельца — закрыт для всех (fail-closed).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { isOn } from "./site";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** Переменные окружения сервиса из compose.yml (простой разбор блока environment). */
function composeEnv(service: string): Record<string, string> {
  const lines = read("deploy/compose.yml").split("\n");
  const start = lines.findIndex((line) => line === `  ${service}:`);
  expect(start, service).toBeGreaterThan(0);
  const env: Record<string, string> = {};
  let inside = false;
  for (const line of lines.slice(start + 1)) {
    if (/^ {2}\S/.test(line)) break;
    if (/^ {4}environment:/.test(line)) {
      inside = true;
      continue;
    }
    if (inside && /^ {4}\S/.test(line)) break;
    const m = inside ? /^ {6}([A-Z_]+):\s*(.*)$/.exec(line) : null;
    if (m?.[1]) env[m[1]] = (m[2] ?? "").replace(/^"(.*)"$/, "$1");
  }
  return env;
}

/** Блок сайта в Caddyfile: от «host {» до закрывающей скобки в начале строки. */
function caddyBlock(host: string): string {
  const text = read("deploy/caddy/Caddyfile");
  const start = text.indexOf(`\n${host} {`);
  expect(start, host).toBeGreaterThan(0);
  return text.slice(start, text.indexOf("\n}", start + 1));
}

describe("сайт агентства не включается сам", () => {
  it("включает только точное «on»; нет переменной, пусто, опечатка — выключено", () => {
    for (const value of [undefined, "", "off", "true", "1", "yes", "enabled", "onn", "o n"]) {
      expect(isOn(value), String(value)).toBe(false);
    }
    for (const value of ["on", "ON", " on\r\n"]) expect(isOn(value), value).toBe(true);
  });

  it("compose: основное окружение по умолчанию выключено, индексация выключена", () => {
    const prod = composeEnv("app-prod");
    expect(prod.SITE_ENABLED).toBe("${SITE_ENABLED:-off}");
    expect(prod.SITE_INDEXING).toBe("${SITE_INDEXING:-off}");
    const test = composeEnv("app-test");
    expect(test.SITE_ENABLED).toBe("on");
    expect(test.SITE_INDEXING).toBe("off");
  });

  it("образ и CI не задают SITE_ENABLED / SITE_INDEXING", () => {
    for (const path of ["Dockerfile", ...readdirSync(join(ROOT, ".github/workflows")).map((f) => `.github/workflows/${f}`)]) {
      expect(read(path), path).not.toMatch(/SITE_ENABLED|SITE_INDEXING|joyrest site\b|site-indexing/);
    }
  });

  it("установка, службы и привратник SSH не трогают настройку сайта", () => {
    const files = [
      ...readdirSync(join(ROOT, "deploy/setup")).map((f) => `deploy/setup/${f}`),
      ...readdirSync(join(ROOT, "deploy/systemd")).map((f) => `deploy/systemd/${f}`),
      "deploy/bin/joyrest-gate",
    ];
    for (const path of files) {
      expect(read(path), path).not.toMatch(/SITE_ENABLED|SITE_INDEXING|settings\.env|site-indexing|\bsite on\b/);
    }
    // Привратник пропускает только выкладку и статус — команд сайта через SSH из Actions нет.
    expect(read("deploy/bin/joyrest-gate")).not.toMatch(/\bsite\b/);
  });

  it("joyrest пишет SITE_ENABLED только в команде site и только значением, которое ввёл владелец", () => {
    const script = read("deploy/bin/joyrest");
    const writes = [...script.matchAll(/set_env_value[^\n]*SITE_ENABLED[^\n]*/g)].map((m) => m[0]);
    expect(writes).toEqual(['set_env_value "$SETTINGS_FILE" SITE_ENABLED "$value" || die "Не удалось записать $SETTINGS_FILE."']);
    const fn = script.slice(script.indexOf("cmd_site() {"), script.indexOf("\n}\n", script.indexOf("cmd_site() {")));
    expect(fn).toContain('set_env_value "$SETTINGS_FILE" SITE_ENABLED "$value"');
    expect(fn).toMatch(/case "\$value" in on\|off\)/);
    expect(script).not.toMatch(/SITE_ENABLED=on|SITE_ENABLED on\b/);
    // Индексацию включает только site-indexing и только при включённом сайте.
    const indexing = [...script.matchAll(/set_env_value[^\n]*SITE_INDEXING[^\n]*/g)].map((m) => m[0]);
    expect(indexing).toEqual([
      'set_env_value "$SETTINGS_FILE" SITE_INDEXING off || die "Не удалось записать $SETTINGS_FILE."',
      'set_env_value "$SETTINGS_FILE" SITE_INDEXING "$value" || die "Не удалось записать $SETTINGS_FILE."',
    ]);
    expect(script).toMatch(/if \[ "\$value" = on \] && ! site_enabled; then\n\s+die/);
  });

  it("приложение без SITE_ENABLED отдаёт на joy-rest.ru заглушку и 404 на /api/lead", async () => {
    const app = buildApp({
      version: "abc",
      publicDir: null,
      checkDatabase: async () => true,
      site: { dir: join(ROOT, "site"), enabled: isOn(undefined), stubDir: join(ROOT, "deploy/caddy/soon"), hosts: ["joy-rest.ru"], indexing: isOn("on") },
      lead: { telegram: { token: "t", chatId: "1" }, send: async () => {} },
    });
    const page = await app.inject({ url: "/", headers: { host: "joy-rest.ru" } });
    expect(page.body).toBe(read("deploy/caddy/soon/index.html"));
    expect(page.headers["x-robots-tag"]).toBe("noindex, nofollow");
    const lead = await app.inject({
      method: "POST",
      url: "/api/lead",
      headers: { host: "joy-rest.ru", "content-type": "application/json" },
      payload: "{}",
    });
    expect(lead.statusCode).toBe(404);
    await app.close();
  });

  it("Caddy: joy-rest.ru — только через приложение (переключатель в нём), без своих файлов сайта", () => {
    const block = caddyBlock("joy-rest.ru");
    expect(block).toContain("reverse_proxy app-prod:8080");
    expect(block).not.toMatch(/file_server|root \*/);
  });

  it("Caddy: test.joy-rest.ru закрыт паролем; без хэша владельца — закрыт для всех", () => {
    const block = caddyBlock("test.joy-rest.ru");
    const auth = /basic_auth \{([\s\S]*?)\n\t\}/.exec(block)?.[1] ?? "";
    // Запирающая учётная запись всегда есть: basic_auth не бывает пустым, Caddy не падает.
    expect(auth).toMatch(/^\s*joyrest-locked \$2a\$10\$[./A-Za-z0-9]{53}$/m);
    // Хэш владельца — только из файла на сервере, вне репозитория.
    expect(auth).toContain("import /etc/caddy/auth/test-site-*.caddy");
    expect(readdirSync(join(ROOT, "deploy/caddy"))).not.toContain("auth");
    expect(block.indexOf("basic_auth")).toBeLessThan(block.indexOf("reverse_proxy"));
    expect(block).toContain('X-Robots-Tag "noindex, nofollow"');
  });
});
