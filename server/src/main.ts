/** Точка входа сервера в контейнере: настройки из переменных окружения. */
import { resolve } from "node:path";
import postgres from "postgres";
import { buildApp } from "./app";
import { isOn } from "./site";

const port = Number(process.env.PORT ?? 8080);
const databaseUrl = process.env.DATABASE_URL;
const sql = databaseUrl ? postgres(databaseUrl, { max: 5, idle_timeout: 60, connect_timeout: 5 }) : null;

/** Значение переменной без пробелов и \r по краям; пустое — null. */
function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

const siteHosts = (env("SITE_HOSTS") ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
const siteDirRaw = env("SITE_DIR");
const siteDir = siteDirRaw ? resolve(siteDirRaw) : null;
const leadToken = env("LEAD_TELEGRAM_TOKEN");
const leadChat = env("LEAD_TELEGRAM_CHAT_ID");

const app = buildApp({
  version: process.env.APP_VERSION ?? "dev",
  publicDir: process.env.PUBLIC_DIR ?? null,
  trustedProxies: env("TRUSTED_PROXIES")?.split(",").map((p) => p.trim()) ?? undefined,
  // Сайт включается только явным SITE_ENABLED=on (sudo joyrest site on); иначе — заглушка.
  site:
    siteDir && siteHosts.length > 0
      ? {
          dir: siteDir,
          enabled: isOn(process.env.SITE_ENABLED),
          stubDir: env("SITE_STUB_DIR") ? resolve(env("SITE_STUB_DIR") ?? "") : null,
          hosts: siteHosts,
          indexing: isOn(process.env.SITE_INDEXING),
        }
      : null,
  lead: {
    // Токен и чат — только из /srv/joyrest/secrets.env (sudo joyrest lead-bot).
    telegram: leadToken && leadChat ? { token: leadToken, chatId: leadChat } : null,
    label: env("LEAD_LABEL") ?? undefined,
  },
  checkDatabase: async () => {
    if (!sql) return false;
    await sql`select 1`;
    return true;
  },
});

if (siteDir && siteHosts.length > 0 && isOn(process.env.SITE_ENABLED) && !(leadToken && leadChat)) {
  app.log.warn("Заявки с сайта выключены: нет LEAD_TELEGRAM_TOKEN или LEAD_TELEGRAM_CHAT_ID (sudo joyrest lead-bot)");
}

async function shutdown(): Promise<void> {
  await app.close();
  await sql?.end({ timeout: 5 });
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

await app.listen({ host: "0.0.0.0", port });
