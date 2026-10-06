/** Запуск миграций при выкладке: `node server/migrate.js` в образе новой версии. */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { migrate } from "./migrate";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Нет DATABASE_URL");
  process.exit(1);
}
const dir = process.env.MIGRATIONS_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
try {
  const applied = await migrate(sql, dir);
  console.log(applied.length ? `Миграции выполнены: ${applied.join(", ")}` : "Новых миграций нет");
} catch (error) {
  console.error("Ошибка миграции:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
