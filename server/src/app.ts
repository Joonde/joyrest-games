/**
 * HTTP-сервер JoyRest Games: проверка здоровья, раздача платформы и сайта агентства.
 * Снаружи его закрывает Caddy (HTTPS, сжатие); сюда приходят /health, файлы платформы
 * (games.joy-rest.ru), сайт агентства и заявки (joy-rest.ru, по заголовку Host),
 * а на следующих этапах — /api и /ws платформы.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { registerLead, type LeadOptions } from "./lead";
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
  /** Куда писать журнал (тесты); по умолчанию stdout. */
  logStream?: { write: (line: string) => void };
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
  if (options.site && options.lead) {
    registerLead(app, { ...options.lead, hosts: options.site.hosts }, { constraints: { host: hostPattern(options.site.hosts) } });
  }

  const publicDir = options.publicDir;
  if (publicDir && existsSync(join(publicDir, "index.html"))) {
    app.register(fastifyStatic, {
      root: publicDir,
      wildcard: false,
      index: false,
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
      if (!isPage || IMMUTABLE.test(path) || path.startsWith("/api/") || /\.[a-z0-9]+$/i.test(path)) {
        reply.code(404).send({ error: "not_found" });
        return;
      }
      reply.header("Cache-Control", "no-cache");
      reply.sendFile("index.html");
    });
  } else if (site) {
    app.setNotFoundHandler((request, reply) => {
      if (site.isSite(request)) return site.notFound(request, reply);
      reply.code(404).send({ error: "not_found" });
    });
  }

  return app;
}
