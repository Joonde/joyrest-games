/**
 * HTTP-сервер JoyRest Games: проверка здоровья, раздача платформы и сайта агентства.
 * Снаружи его закрывает Caddy (HTTPS, сжатие); сюда приходят /health, файлы платформы
 * (games.joy-rest.ru), сайт агентства и заявки (joy-rest.ru, по заголовку Host),
 * а на следующих этапах — /api и /ws платформы.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import type { Sql } from "postgres";
import { registerAuth, type AuthOptions } from "./auth";
import { registerGames, type GamesOptions } from "./games";
import { registerLead, type LeadOptions } from "./lead";
import { registerLive, type LiveOptions } from "./live";
import { registerProposals } from "./proposals";
import { registerStaff } from "./staff";
import { registerTracks } from "./tracks";
import { hostPattern, registerSite, type SiteOptions } from "./site";

export interface AppOptions {
  /** Версия (коммит) — выкладка сверяет её через /health. */
  version: string;
  /** Папка с собранным сайтом (dist); null — сайт не раздаём (тесты). */
  publicDir: string | null;
  /** Проверка базы: true — отвечает. */
  checkDatabase: () => Promise<boolean>;
  /**
   * Адреса прокси, которым верим в X-Forwarded-For (Caddy во внутренней сети Docker).
   * От остальных заголовок игнорируется: подделка не меняет адрес гостя.
   */
  trustedProxies?: string[];
  /** Сайт агентства; null — не раздаём. */
  site?: SiteOptions | null;
  /** Заявки с сайта (POST /api/lead только с адресов сайта). */
  lead?: Omit<LeadOptions, "hosts"> | null;
  /**
   * Чья реализация слоя данных работает в браузере: свой сервер или Firebase (на время
   * переезда). Сервер сообщает её меткой в index.html; по умолчанию — Firebase.
   */
  dataBackend?: DataBackend;
  /**
   * База для API платформы (вход и ведущие — PR 3.1); null — API нет (тесты без базы).
   * `auth` — настройки для тестов (часы, лимиты).
   */
  sql?: Sql | null;
  auth?: Omit<AuthOptions, "sql" | "isSite">;
  /** Папка картинок игр (MEDIA_DIR, в контейнере /app/media); null — картинки недоступны. */
  mediaDir?: string | null;
  /** Игры и картинки — настройки для тестов (лимиты, свободное место). */
  games?: Omit<GamesOptions, "sql" | "isSite" | "mediaDir">;
  /** Игра в реальном времени — настройки для тестов (часы, «я жив» в потоке). */
  live?: Omit<LiveOptions, "sql" | "isSite">;
  /** Куда писать журнал (тесты); по умолчанию stdout. */
  logStream?: { write: (line: string) => void };
}

export type DataBackend = "server" | "firebase";

/** Свой сервер — только точное «server»; всё остальное (нет переменной, опечатка) — Firebase. */
export function parseDataBackend(value: string | undefined): DataBackend {
  return value?.trim().toLowerCase() === "server" ? "server" : "firebase";
}

/** index.html с меткой реализации слоя данных (src/data/index.ts читает её при запуске). */
export function withDataBackend(html: string, backend: DataBackend): string {
  const meta = `<meta name="joyrest-data" content="${backend}">`;
  return html.includes("</head>") ? html.replace("</head>", `${meta}</head>`) : meta + html;
}

/** Частные сети: Docker раздаёт адреса контейнерам из них. Наружу у приложения портов нет. */
export const PRIVATE_NETWORKS = ["127.0.0.1/8", "::1/128", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"];

// Файлы с хэшем в имени и шрифты под тем же именем не меняются (CLAUDE.md, раздел 8).
const IMMUTABLE = /^\/(assets|fonts)\//;

export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info", ...(options.logStream ? { stream: options.logStream } : {}) },
    // За Caddy: адрес гостя берём из X-Forwarded-For, но только если запрос пришёл от прокси
    // из внутренней сети. Caddy заголовок перезаписывает (Caddyfile, header_up).
    trustProxy: options.trustedProxies ?? PRIVATE_NETWORKS,
    disableRequestLogging: true,
  });

  app.get("/health", async (_request, reply) => {
    const database = await options.checkDatabase().catch(() => false);
    reply.header("Cache-Control", "no-store");
    reply.code(database ? 200 : 503);
    return { ok: database, version: options.version, database: database ? "ok" : "error" };
  });

  // Сайт агентства и заявки — только на его адресах (ограничение маршрутов по Host).
  const site = options.site ? registerSite(app, options.site) : null;
  // Заявки — только у включённого сайта: при `joyrest site off` /api/lead отвечает 404.
  if (options.site?.enabled && options.lead) {
    registerLead(app, { ...options.lead, hosts: options.site.hosts }, { constraints: { host: hostPattern(options.site.hosts) } });
  }
  // API платформы: вход ведущих и управление ведущими. На адресах сайта агентства — 404.
  if (options.sql) {
    const isSite = site ? site.isSite : undefined;
    registerAuth(app, { ...options.auth, sql: options.sql, isSite });
    registerGames(app, { ...options.games, sql: options.sql, isSite, mediaDir: options.mediaDir ?? null });
    registerLive(app, { ...options.live, sql: options.sql, isSite });
    registerProposals(app, { sql: options.sql, isSite });
    registerStaff(app, { sql: options.sql, isSite });
    registerTracks(app, { sql: options.sql, isSite, mediaDir: options.mediaDir ?? null });
  }

  const publicDir = options.publicDir;
  if (publicDir && existsSync(join(publicDir, "index.html"))) {
    // Страница приложения собирается один раз при запуске: файл в образе не меняется.
    const indexHtml = withDataBackend(readFileSync(join(publicDir, "index.html"), "utf8"), options.dataBackend ?? "firebase");
    const sendIndex = (reply: FastifyReply) => reply.header("Cache-Control", "no-cache").type("text/html; charset=utf-8").send(indexHtml);

    app.register(fastifyStatic, {
      root: publicDir,
      wildcard: false,
      index: false,
      // index.html — только с меткой слоя данных (обработчик ниже), не файлом как есть.
      allowedPath: (pathName) => pathName !== "/index.html",
      setHeaders(reply, path) {
        const url = "/" + path.slice(publicDir.length).replace(/\\/g, "/").replace(/^\/+/, "");
        reply.header("Cache-Control", IMMUTABLE.test(url) ? "public, max-age=31536000, immutable" : "no-cache");
      },
    });

    // SPA: любой адрес страницы (/studio, /play/…) отдаёт index.html. Нет файла скрипта
    // или шрифта — честный 404, а не страница вместо файла.
    app.setNotFoundHandler((request, reply) => {
      if (site?.isSite(request)) return site.notFound(request, reply);
      const path = request.url.split("?")[0];
      const isPage = request.method === "GET" || request.method === "HEAD";
      if (isPage && path === "/index.html") return sendIndex(reply);
      if (!isPage || IMMUTABLE.test(path) || path.startsWith("/api/") || /\.[a-z0-9]+$/i.test(path)) {
        reply.code(404).send({ error: "not_found" });
        return;
      }
      return sendIndex(reply);
    });
  } else if (site) {
    app.setNotFoundHandler((request, reply) => {
      if (site.isSite(request)) return site.notFound(request, reply);
      reply.code(404).send({ error: "not_found" });
    });
  }

  return app;
}
