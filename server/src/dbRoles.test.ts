/**
 * Разделение основной и тестовой версии (аудит 7 октября 2026): у приложений свои роли базы без
 * суперправ (`sudo joyrest db-roles`), тестовая версия в своих сетях и не видит основную.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const compose = read("deploy/compose.yml");
const joyrest = read("deploy/bin/joyrest");

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

describe("роли базы и сети", () => {
  it("приложения ходят своими ролями (до db-roles — прежней), каждое в свою базу", () => {
    expect(service("app-prod")).toContain("postgres://${PROD_DB_USER:-joyrest}:${PROD_DB_PASSWORD:-${POSTGRES_PASSWORD}}@postgres:5432/joyrest_prod");
    expect(service("app-test")).toContain("postgres://${TEST_DB_USER:-joyrest}:${TEST_DB_PASSWORD:-${POSTGRES_PASSWORD}}@postgres:5432/joyrest_test");
  });

  it("тестовая версия — в своих сетях: до основной не достучаться ни через Caddy, ни через базу", () => {
    expect(service("app-test")).toMatch(/networks: \[web-test, db-test\]/);
    expect(service("app-prod")).toMatch(/networks: \[web, db\]/);
    expect(service("caddy")).toMatch(/networks: \[web, web-test\]/);
    expect(service("postgres")).toMatch(/networks: \[db, db-test\]/);
    expect(compose).toMatch(/\n {2}db-test:\n {4}internal: true/);
  });

  it("роли без суперправ; тестовой закрыт вход в основную базу; права повторяются при выкладке и восстановлении", () => {
    const roles = bashFunction("cmd_db_roles");
    expect(roles).toContain("nosuperuser nocreatedb nocreaterole");
    expect(roles).toContain("has_database_privilege('$DB_ROLE_TEST', 'joyrest_prod', 'CONNECT')");
    expect(roles).toContain('ensure_no_game "$force" "db-roles"');
    expect(roles).toContain("[ -t 0 ]");
    const grants = bashFunction("db_role_grants");
    expect(grants).toContain("revoke connect, temporary on database $db from public;");
    expect(grants).not.toMatch(/grant [^\n]*(create|truncate|all privileges)/i);
    expect(bashFunction("ensure_test_db")).toContain("db_role_grants");
    expect(bashFunction("cmd_restore")).toContain("db_role_grants");
  });

  it("пароли ролей не попадают в аргументы команд; привратник и CI db-roles не запускают", () => {
    expect(bashFunction("cmd_db_roles")).not.toMatch(/PGPASSWORD|-c ".*password/);
    expect(read("deploy/bin/joyrest-gate")).not.toContain("db-roles");
    expect(read(".github/workflows/build.yml")).not.toContain("db-roles");
  });
});
