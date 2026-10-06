import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { migrate, migrationFiles } from "./migrate";

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "joyrest-migrations-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

describe("список миграций", () => {
  it("берёт только NNNN_имя.sql и сортирует", () => {
    const dir = dirWith({ "0002_b.sql": "", "0001_a.sql": "", "README.md": "", "1_bad.sql": "" });
    expect(migrationFiles(dir)).toEqual(["0001_a.sql", "0002_b.sql"]);
  });
});

// Нужна настоящая PostgreSQL: в CI — сервис, локально — TEST_DATABASE_URL.
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("миграции на PostgreSQL", () => {
  const sql = postgres(url ?? "", { max: 1, onnotice: () => {} });
  afterAll(() => sql.end());

  it("выполняет новые по одному разу, сломанная не оставляет следов", async () => {
    await sql`drop table if exists schema_migrations, m_a, m_b`;
    const dir = dirWith({ "0001_a.sql": "create table m_a (id int);" });
    expect(await migrate(sql, dir)).toEqual(["0001_a.sql"]);
    expect(await migrate(sql, dir)).toEqual([]);

    writeFileSync(join(dir, "0002_b.sql"), "create table m_b (id int); select * from nowhere;");
    await expect(migrate(sql, dir)).rejects.toThrow();
    const [{ exists }] = await sql<{ exists: boolean }[]>`select to_regclass('m_b') is not null as exists`;
    expect(exists).toBe(false);
    const names = (await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name);
    expect(names).toEqual(["0001_a.sql"]);
    await sql`drop table if exists schema_migrations, m_a, m_b`;
  });
});
