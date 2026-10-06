/**
 * Переезд платформы на свой сервер (CLAUDE.md, «Платформа на своём сервере»): основная версия
 * остаётся на Firebase, пока владелец её явно не переключит; тестовое окружение — всегда на своём
 * сервере. Картинки — файлы вне базы, у каждого окружения своя папка.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const compose = read("deploy/compose.yml");
const joyrest = read("deploy/bin/joyrest");

/** Блок сервиса compose: от «  имя:» до следующего сервиса. */
function service(name: string): string {
  const start = compose.indexOf(`\n  ${name}:\n`);
  expect(start, name).toBeGreaterThan(0);
  const next = compose.slice(start + 1).search(/\n {2}[a-z][\w-]*:\n|\nnetworks:/);
  return compose.slice(start, next < 0 ? undefined : start + 1 + next);
}

function bashFunction(name: string): string {
  const start = joyrest.indexOf(`\n${name}() {`);
  expect(start, name).toBeGreaterThan(0);
  return joyrest.slice(start, joyrest.indexOf("\n}", start + 1));
}

describe("переключатель слоя данных", () => {
  it("основная версия по умолчанию на Firebase, тестовая — на своём сервере", () => {
    expect(service("app-prod")).toMatch(/^ {6}DATA_BACKEND: \$\{DATA_BACKEND:-firebase\}$/m);
    expect(service("app-test")).toMatch(/^ {6}DATA_BACKEND: server$/m);
  });

  it("ни выкладка, ни CI не переключают основную версию (это делает владелец, PR 9)", () => {
    expect(joyrest).not.toContain("DATA_BACKEND");
    for (const file of ["build.yml", "mirror-images.yml", "ports.yml"]) {
      expect(read(`.github/workflows/${file}`), file).not.toContain("DATA_BACKEND");
    }
  });
});

describe("картинки — файлы вне базы", () => {
  it("у каждого окружения своя папка", () => {
    expect(service("app-prod")).toContain("- /srv/joyrest/media/prod:/app/media");
    expect(service("app-test")).toContain("- /srv/joyrest/media/test:/app/media");
    for (const name of ["app-prod", "app-test"]) expect(service(name)).toMatch(/^ {6}MEDIA_DIR: \/app\/media$/m);
  });

  it("папки создаёт joyrest с владельцем — пользователем приложения (node, uid 1000)", () => {
    expect(bashFunction("ensure_dirs")).toContain(
      'install -d -m 700 -o 1000 -g 1000 "$ROOT_DIR/media/prod" "$ROOT_DIR/media/test"',
    );
    expect(read("Dockerfile")).toMatch(/^USER node$/m);
  });
});

describe("пароль владельца агентства", () => {
  it("вводится скрыто и уходит в приложение через stdin, не аргументом", () => {
    const command = bashFunction("cmd_admin_password");
    expect(command).toContain('IFS= read -rsp "Пароль: " password');
    expect(command).toContain(
      `printf '%s\\n%s\\n' "$email" "$password" | dc exec -T "$service" node server/admin-password.js`,
    );
    expect(command).not.toMatch(/--arg[^\n]*password/);
    expect(command).toContain('-ge 12 ] || die "Пароль короче 12 символов.');
  });

  it("CI и привратник SSH команду не вызывают", () => {
    expect(read(".github/workflows/build.yml")).not.toContain("admin-password");
    expect(read("deploy/bin/joyrest-gate")).not.toContain("admin");
  });
});
