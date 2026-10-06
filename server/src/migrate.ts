/**
 * Миграции базы: SQL-файлы `server/migrations/NNNN_название.sql` выполняются по порядку,
 * каждый в своей транзакции, выполненные отмечаются в `schema_migrations`.
 * Правило: миграции только добавляют (таблицы, колонки, индексы) — тогда прошлую версию
 * приложения можно вернуть без отката базы.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Sql } from "postgres";

const FILE = /^\d{4}_[a-z0-9_]+\.sql$/;

export function migrationFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => FILE.test(name))
    .sort();
}

/** Выполняет новые миграции; возвращает имена выполненных. */
export async function migrate(sql: Sql, dir: string): Promise<string[]> {
  const files = migrationFiles(dir);
  await sql`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`;
  const applied: string[] = [];
  // Две выкладки одновременно не мигрируют одну базу.
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(724501)`;
    const done = new Set((await tx<{ name: string }[]>`select name from schema_migrations`).map((row) => row.name));
    for (const name of files) {
      if (done.has(name)) continue;
      await tx.unsafe(readFileSync(join(dir, name), "utf8"));
      await tx`insert into schema_migrations (name) values (${name})`;
      applied.push(name);
    }
  });
  return applied;
}
