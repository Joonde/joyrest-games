/** Точка входа сервера в контейнере: настройки из переменных окружения. */
import postgres from "postgres";
import { buildApp } from "./app";

const port = Number(process.env.PORT ?? 8080);
const databaseUrl = process.env.DATABASE_URL;
const sql = databaseUrl ? postgres(databaseUrl, { max: 5, idle_timeout: 60, connect_timeout: 5 }) : null;

const app = buildApp({
  version: process.env.APP_VERSION ?? "dev",
  publicDir: process.env.PUBLIC_DIR ?? null,
  checkDatabase: async () => {
    if (!sql) return false;
    await sql`select 1`;
    return true;
  },
});

async function shutdown(): Promise<void> {
  await app.close();
  await sql?.end({ timeout: 5 });
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

await app.listen({ host: "0.0.0.0", port });
