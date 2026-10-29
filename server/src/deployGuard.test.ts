/**
 * Защита выкладки (аудит 7 октября 2026): ветка claude/* не может попасть на основную версию —
 * ни через SSH-ключ, ни через тег в GHCR; force — только из Termius.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
    expect(body).toContain('local env=test tag="test-release"');
    expect(body).not.toMatch(/(?<![-\w])release(?![-\w])/);
  });

  it("отложенная из-за игры выкладка основной версии повторяется сама, когда игра кончилась; новый запрос её заменяет", () => {
    const joyrest = read("deploy/bin/joyrest");
    const fn = (name: string) => {
      const start = joyrest.indexOf(`\n${name}() {`);
      expect(start, name).toBeGreaterThan(0);
      return joyrest.slice(start, joyrest.indexOf("\n}\n", start + 1) + 3);
    };
    const dir = mkdtempSync(join(tmpdir(), "joyrest-pending-"));
    const A = "a".repeat(40);
    const B = "b".repeat(40);
    // Настоящие deploy_env, cmd_auto_update и set_status; всё, что трогает Docker, базу и сеть, — заглушки.
    const harness = [
      "set -euo pipefail",
      `ROOT_DIR=${JSON.stringify(dir)}; DEPLOY_DIR="$ROOT_DIR/deploy"; SHA_RE='^[0-9a-f]{40}$'; ACTIVE_MINUTES=30; APP_REPO=x`,
      'mkdir -p "$DEPLOY_DIR"',
      'need_root() { :; }; ensure_dirs() { :; }; die() { echo "die: $*" >&2; exit 1; }',
      'log() { echo "$*" >> "$ROOT_DIR/log"; }; notify() { echo "$*" >> "$ROOT_DIR/notify"; }',
      'active_games() { cat "$ROOT_DIR/active" 2>/dev/null; }',
      'release_value() { echo ""; }; env_link() { echo "$ROOT_DIR/none"; }; health_ok() { return 1; }',
      'fetch_release() { mkdir -p "$ROOT_DIR/releases/$1"; echo "APP_IMAGE=x@sha256:1" > "$ROOT_DIR/releases/$1/release.env"; }',
      "wait_postgres() { :; }; ensure_test_db() { :; }; predeploy_dump() { :; }; run_migrations() { :; }; migrate_lite() { :; }",
      'switch_to() { echo "$2" > "$ROOT_DIR/deployed"; }; start_env() { :; }; wait_healthy() { :; }; prune_releases() { :; }',
      "registry_digest() { return 1; }",
      fn("set_status"),
      fn("deploy_env"),
      fn("cmd_auto_update"),
      'case "$1" in deploy) code=0; ( deploy_env prod "$2" "${3:-}" ) || code=$?; echo "code=$code" ;; auto) cmd_auto_update; echo "auto-ok" ;; esac',
    ].join("\n");
    writeFileSync(join(dir, "harness.sh"), harness);
    const run = (...args: string[]) => execFileSync("bash", [join(dir, "harness.sh"), ...args], { encoding: "utf8" }).trim();
    const file = (name: string) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8") : "");
    try {
      // Идёт игра — отложено, коммит запомнен, в состоянии понятно, что выложится само.
      writeFileSync(join(dir, "active"), "2");
      expect(run("deploy", A)).toBe("code=3");
      expect(file("deploy/pending-prod").trim()).toBe(A);
      expect(file("deploy/status-prod")).toContain(`blocked ${A}: идёт игра`);
      expect(file("deploy/status-prod")).toContain("выложится сама после игры");
      // Таймер во время игры — снова ждём; журнал не засоряется одинаковыми строками, сообщений нет.
      expect(run("auto")).toBe("auto-ok");
      expect(run("auto")).toBe("auto-ok");
      expect(file("log").split("\n").filter((l) => l.includes("отложена"))).toHaveLength(1);
      expect(file("notify")).toBe("");
      expect(file("deployed")).toBe("");
      // Игра кончилась — таймер выкладывает отложенный коммит, запоминание снято, владельцу — сообщение.
      writeFileSync(join(dir, "active"), "0");
      expect(run("auto")).toBe("auto-ok");
      expect(file("deployed").trim()).toBe(A);
      expect(file("deploy/pending-prod")).toBe("");
      expect(file("notify")).toContain("✅ Основная версия aaaaaaa выложена");
      expect(run("auto")).toBe("auto-ok");
      expect(file("notify").split("\n").filter(Boolean)).toHaveLength(1);
      // Отложили A, потом новый запрос B с force (вручную) — A больше не выкладывается.
      writeFileSync(join(dir, "active"), "1");
      expect(run("deploy", A)).toBe("code=3");
      expect(run("deploy", B, "force")).toBe("code=0");
      expect(file("deploy/pending-prod")).toBe("");
      writeFileSync(join(dir, "active"), "0");
      expect(run("auto")).toBe("auto-ok");
      expect(file("deployed").trim()).toBe(B);
      // Не проверить игру (база молчит) — тоже отложено; мусор в файле — не выкладывается.
      writeFileSync(join(dir, "active"), "");
      rmSync(join(dir, "active"));
      expect(run("deploy", A)).toBe("code=3");
      expect(file("deploy/status-prod")).toContain("не удалось проверить");
      writeFileSync(join(dir, "deploy/pending-prod"), "main; rm -rf /");
      writeFileSync(join(dir, "active"), "0");
      expect(run("auto")).toBe("auto-ok");
      expect(file("deployed").trim()).toBe(B);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
