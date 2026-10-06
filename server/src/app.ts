/**
 * HTTP-сервер JoyRest Games: проверка здоровья и раздача собранного сайта.
 * Снаружи его закрывает Caddy (HTTPS, сжатие); сюда приходят /health, файлы сайта,
 * а на следующих этапах — /api и /ws.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

export interface AppOptions {
  /** Версия (коммит) — выкладка сверяет её через /health. */
  version: string;
  /** Папка с собранным сайтом (dist); null — сайт не раздаём (тесты). */
  publicDir: string | null;
  /** Проверка базы: true — отвечает. */
  checkDatabase: () => Promise<boolean>;
}

// Файлы с хэшем в имени и шрифты под тем же именем не меняются (CLAUDE.md, раздел 8).
const IMMUTABLE = /^\/(assets|fonts)\//;

export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    // За Caddy: адрес гостя берём из X-Forwarded-For.
    trustProxy: true,
    disableRequestLogging: true,
  });

  app.get("/health", async (_request, reply) => {
    const database = await options.checkDatabase().catch(() => false);
    reply.header("Cache-Control", "no-store");
    reply.code(database ? 200 : 503);
    return { ok: database, version: options.version, database: database ? "ok" : "error" };
  });

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
      const path = request.url.split("?")[0];
      const isPage = request.method === "GET" || request.method === "HEAD";
      if (!isPage || IMMUTABLE.test(path) || path.startsWith("/api/") || /\.[a-z0-9]+$/i.test(path)) {
        reply.code(404).send({ error: "not_found" });
        return;
      }
      reply.header("Cache-Control", "no-cache");
      reply.sendFile("index.html");
    });
  }

  return app;
}
