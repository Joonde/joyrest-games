/**
 * Сайт агентства (joy-rest.ru): статические файлы из build/site, выбор по заголовку Host.
 *
 * Кэш: css/, js/, img/ — с отпечатком содержимого в имени (собирает scripts/build-site.ts),
 * fonts/ — под тем же именем не меняются (CLAUDE.md, раздел 8), поэтому хранятся год.
 * index.html и robots.txt браузер перепроверяет каждый раз.
 * Индексация (SITE_INDEXING) выключена по умолчанию: robots.txt Disallow и X-Robots-Tag.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export interface SiteOptions {
  /** Папка собранного сайта (build/site, в образе /app/site). */
  dir: string;
  /** Адреса сайта без порта: joy-rest.ru (основное), test.joy-rest.ru (тестовое). */
  hosts: string[];
  /** true — сайт открыт поисковикам. Переключает `sudo joyrest site-indexing on|off`. */
  indexing: boolean;
}

export interface Site {
  isSite: (request: FastifyRequest) => boolean;
  notFound: (request: FastifyRequest, reply: FastifyReply) => void;
}

export const SITE_IMMUTABLE = /^\/(css|js|img|fonts)\//;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Host с портом или без, без учёта регистра. Используется в ограничениях маршрутов. */
export function hostPattern(hosts: string[]): RegExp {
  return new RegExp(`^(${hosts.map(escapeRegExp).join("|")})(:\\d+)?$`, "i");
}

const NOT_FOUND_PAGE =
  '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>Страница не найдена — JoyRest</title><body style="font-family:sans-serif;background:#FBF6F1;color:#322D28;padding:32px">' +
  '<h1>Страница не найдена</h1><p><a href="/" style="color:#8A5148">На главную JoyRest</a></p></body></html>';

export function registerSite(app: FastifyInstance, options: SiteOptions): Site {
  const pattern = hostPattern(options.hosts);
  const isSite = (request: FastifyRequest) => pattern.test(request.headers.host ?? "");

  if (!options.indexing) {
    app.addHook("onSend", async (request, reply, payload) => {
      if (isSite(request)) reply.header("X-Robots-Tag", "noindex, nofollow");
      return payload;
    });
  }

  app.get("/robots.txt", { constraints: { host: pattern } }, async (_request, reply) => {
    reply.type("text/plain; charset=utf-8").header("Cache-Control", "no-cache");
    return options.indexing ? "User-agent: *\nAllow: /\n" : "User-agent: *\nDisallow: /\n";
  });

  const dir = options.dir;
  if (existsSync(join(dir, "index.html"))) {
    app.register(fastifyStatic, {
      root: dir,
      wildcard: false,
      index: ["index.html"],
      // reply.sendFile оставляем платформе (она регистрирует свой экземпляр).
      decorateReply: false,
      constraints: { host: pattern },
      setHeaders(reply, path) {
        const url = "/" + path.slice(dir.length).replace(/\\/g, "/").replace(/^\/+/, "");
        reply.header("Cache-Control", SITE_IMMUTABLE.test(url) ? "public, max-age=31536000, immutable" : "no-cache");
      },
    });
  }

  return {
    isSite,
    notFound(request, reply) {
      const path = request.url.split("?")[0];
      reply.code(404).header("Cache-Control", "no-cache");
      if (path.startsWith("/api/") || (request.method !== "GET" && request.method !== "HEAD")) {
        reply.send({ error: "not_found" });
        return;
      }
      reply.type("text/html; charset=utf-8").send(NOT_FOUND_PAGE);
    },
  };
}
