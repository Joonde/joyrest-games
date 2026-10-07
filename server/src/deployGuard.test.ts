/**
 * Защита выкладки (аудит 7 октября 2026): ветка claude/* не может попасть на основную версию —
 * ни через SSH-ключ, ни через тег в GHCR; force — только из Termius.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const GATE = join(ROOT, "deploy/bin/joyrest-gate");
const SHA = "a".repeat(40);

/** Привратник без очереди: только проверка строки (ping не трогает файлы, кроме release.env). */
function gate(mode: string | null, command: string): boolean {
  try {
    execFileSync("bash", ["-c", `sed 's#^DEPLOY_DIR=.*#DEPLOY_DIR=/nonexistent#; s#^RELEASE=.*#RELEASE=/dev/null#' "$0" | bash -s -- "$@"`, GATE, ...(mode ? [mode] : [])], {
      env: { ...process.env, SSH_ORIGINAL_COMMAND: command },
      stdio: "pipe",
    });
    return true;
  } catch (error) {
    const stderr = String((error as { stderr?: Buffer }).stderr ?? "");
    // Разрешённая команда дошла до очереди (её нет в тесте) — это не отказ привратника.
    return !stderr.includes("Команда не разрешена");
  }
}

describe("защита выкладки", () => {
  it("основной ключ: ping, status, deploy, deploy-test; force не принимается", () => {
    expect(gate(null, "ping")).toBe(true);
    expect(gate(null, `deploy ${SHA}`)).toBe(true);
    expect(gate(null, `deploy-test ${SHA}`)).toBe(true);
    expect(gate(null, `deploy ${SHA} force`)).toBe(false);
    expect(gate(null, "deploy main")).toBe(false);
  });

  it("тестовый ключ: только ping, status и deploy-test", () => {
    expect(gate("test", "status")).toBe(true);
    expect(gate("test", `deploy-test ${SHA}`)).toBe(true);
    expect(gate("test", `deploy ${SHA}`)).toBe(false);
    expect(gate("other", "ping")).toBe(false);
  });

  it("сервер сам забирает только тестовый релиз; основной — по SSH из main", () => {
    const joyrest = read("deploy/bin/joyrest");
    const start = joyrest.indexOf("\ncmd_auto_update() {");
    const body = joyrest.slice(start, joyrest.indexOf("\n}", start + 1));
    expect(body).toContain("for env in test; do");
    expect(body).not.toMatch(/\brelease\b(?!-)/);
  });

  it("сборка: окружение production для main, ветки — тестовый ключ, без force и без тега release", () => {
    const build = read(".github/workflows/build.yml");
    expect(build).toContain("environment: ${{ github.ref == 'refs/heads/main' && 'production' || 'test' }}");
    expect(build).toContain("secrets.DEPLOY_SSH_KEY_TEST");
    expect(build).not.toMatch(/inputs\.force|\bFORCE\b/);
    expect(build).not.toContain('echo "tag=release"');
    expect(read("deploy/setup/install.sh")).toContain('restrict,command=\\"/usr/local/bin/joyrest-gate\\"');
  });
});
