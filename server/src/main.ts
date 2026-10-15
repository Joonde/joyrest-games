/** Точка входа сервера в контейнере: настройки из переменных окружения. */
import { resolve } from "node:path";
import postgres from "postgres";
import { buildApp, parseDataBackend } from "./app";
import { scheduleCleanup } from "./cleanup";
import { startBot, telegramPolling, type BotLog } from "./telegram";
import { isOn } from "./site";
import { venueFormsOpen } from "./venues";

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

const mediaDir = env("MEDIA_DIR") ? resolve(env("MEDIA_DIR") ?? "") : null;

// Адрес платформы для ссылок в Telegram: тестовая версия — test.games.joy-rest.ru.
const platformUrl = env("PLATFORM_URL") ?? (siteHosts.some((h) => h.startsWith("test.")) ? "https://test.games.joy-rest.ru" : "https://games.joy-rest.ru");
// Журнал бота: до запуска приложения — console, потом — журнал приложения.
let logTarget: BotLog = { info: () => undefined, warn: (details, message) => console.warn(message, details) };
const botLog: BotLog = { info: (d, m) => logTarget.info(d, m), warn: (d, m) => logTarget.warn(d, m) };
// Бот уведомлений команды — тот же токен, что у заявок. Сообщения читает только одно окружение (TELEGRAM_UPDATES).
const bot = sql && leadToken ? startBot({ sql, token: leadToken, log: botLog, polling: telegramPolling(process.env.TELEGRAM_UPDATES, siteHosts), platformUrl }) : null;

const app = buildApp({
  bot,
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
  // Слой данных в браузере: app-test — свой сервер, app-prod — Firebase до переключения
  // (CLAUDE.md, «Платформа на своём сервере»).
  dataBackend: parseDataBackend(process.env.DATA_BACKEND),
  sql,
  mediaDir,
  // Анкеты площадок и заявки клиентов без входа — только явным VENUE_FORMS=on (sudo joyrest venues on).
  venues: { formsOpen: venueFormsOpen(process.env.VENUE_FORMS, siteHosts) },
  checkDatabase: async () => {
    if (!sql) return false;
    await sql`select 1`;
    return true;
  },
});

if (siteDir && siteHosts.length > 0 && isOn(process.env.SITE_ENABLED) && !(leadToken && leadChat)) {
  app.log.warn("Уведомления о заявках в Telegram выключены: нет LEAD_TELEGRAM_TOKEN или LEAD_TELEGRAM_CHAT_ID (sudo joyrest lead-bot). Заявки и вопросы сохраняются в «Клиенты»");
}

logTarget = { info: (d, m) => app.log.info(d, m), warn: (d, m) => app.log.warn(d, m) };

// Ночная уборка: картинки без ссылок, недописанные файлы, старые устройства гостей.
const stopCleanup = sql ? scheduleCleanup(sql, mediaDir, app.log) : () => undefined;

async function shutdown(): Promise<void> {
  stopCleanup();
  bot?.stop();
  await app.close();
  await sql?.end({ timeout: 5 });
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

await app.listen({ host: "0.0.0.0", port });
