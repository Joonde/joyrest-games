/**
 * Показы ведущего (решение владельца 15 октября 2026; `src/core/decks.ts`): фото и страницы PDF на весь экран зала.
 * Страницы готовит устройство ведущего (WebP/JPEG до 1920 px), сервер принимает файл как есть, тип — по первым байтам.
 * Файлы — MEDIA_DIR/slides/<sha256> (в ночной копии вместе с media/prod), показ — строка `decks` с порядком страниц.
 * Страницу открывает любой вошедший (экран зала входит устройством). Файлы без ссылок убирает ночная уборка.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, stat, statfs, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { cleanDeckTitle, DECK_LIMITS, parseDeckPages } from "../../src/core/decks";
import * as permissions from "../../src/data/permissions";
import type { Deck } from "../../src/data/types";
import { actorOf, apiGuard, identityOf, sessionUser, type SessionRow, uploadGuard } from "./auth";
import { imageMime } from "./games";

export interface DecksOptions {
  sql: Sql;
  mediaDir: string | null;
  isSite?: (request: FastifyRequest) => boolean;
  /** Свободное место на диске (тесты подменяют). */
  freeBytes?: (dir: string) => Promise<number>;
  /** Меньше — новые страницы не принимаем (507), как у картинок и музыки. */
  minFreeBytes?: number;
  /** Место под показы ведущего (по умолчанию `DECK_LIMITS.totalBytes`, 500 МБ; тесты уменьшают). */
  totalBytes?: number;
}

const MIN_FREE_BYTES = 3 * 1024 ** 3;

async function diskFree(dir: string): Promise<number> {
  const stats = await statfs(dir);
  return stats.bavail * stats.bsize;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const SHA = /^[0-9a-f]{64}$/;

interface Row {
  id: string;
  title: string;
  pages: unknown;
  updated_at: Date;
}

const deckOf = (row: Row): Deck => ({ id: row.id, title: row.title, pages: parseDeckPages(row.pages), updatedAt: row.updated_at.getTime() });

function dimension(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : null;
}

export function registerDecks(app: FastifyInstance, options: DecksOptions): void {
  const { sql } = options;
  const dir = options.mediaDir ? join(options.mediaDir, "slides") : null;
  const freeBytes = options.freeBytes ?? diskFree;
  const minFree = options.minFreeBytes ?? MIN_FREE_BYTES;
  const totalBytes = options.totalBytes ?? DECK_LIMITS.totalBytes;

  /** Настоящий размер файла страницы на диске (размеру из запроса не верим — QA 22 октября 2026); нет файла — null. */
  async function fileSize(sha: string): Promise<number | null> {
    if (!dir) return null;
    const info = await stat(join(dir, sha)).catch(() => null);
    return info?.isFile() ? info.size : null;
  }

  /** Страницы всех показов ведущего (кроме `except`): отпечаток → размер, одинаковые файлы — один раз. */
  async function usedPages(owner: string, except: string | null): Promise<Map<string, number>> {
    const rows = await sql<{ sha: string; size: string }[]>`
      select distinct p->>'sha' as sha, (p->>'size')::bigint::text as size
      from decks d, jsonb_array_elements(d.pages) p where d.owner_id = ${owner} and d.id <> ${except ?? ""}`;
    return new Map(rows.map((r) => [r.sha, Number(r.size)]));
  }

  app.register(async (api) => {
    api.addHook("onRequest", apiGuard(options.isSite));
    api.addHook("onRequest", uploadGuard(sql));
    api.addContentTypeParser(["image/webp", "image/jpeg"], { parseAs: "buffer", bodyLimit: DECK_LIMITS.pageBytes + 1024 }, (_request, body, done) => done(null, body));

    function fail(reply: FastifyReply, status: number, code: string) {
      return reply.code(status).send({ error: code });
    }

    async function requireHost(request: FastifyRequest, reply: FastifyReply): Promise<SessionRow | null> {
      const user = await sessionUser(sql, request, reply);
      if (!user) {
        fail(reply, 401, "unauthenticated");
        return null;
      }
      if (!permissions.canCreateSession(actorOf(user))) {
        fail(reply, 403, "permission-denied");
        return null;
      }
      return user;
    }

    api.get("/api/decks", async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      const rows = await sql<Row[]>`select id, title, pages, updated_at from decks where owner_id = ${user.id} order by updated_at desc limit ${DECK_LIMITS.decks}`;
      return { decks: rows.map(deckOf) };
    });

    // Новый показ или правка (название, порядок и состав страниц). id от браузера; чужой — 404.
    api.post<{ Body: unknown }>("/api/decks", { bodyLimit: 32 * 1024 }, async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      const body = typeof request.body === "object" && request.body !== null ? (request.body as Record<string, unknown>) : {};
      const id = typeof body.id === "string" && ID.test(body.id) ? body.id : null;
      const pages = parseDeckPages(body.pages);
      if (!id || (Array.isArray(body.pages) && body.pages.length > DECK_LIMITS.pages)) return fail(reply, 400, "invalid-argument");
      const title = cleanDeckTitle(body.title) || "Показ";
      // Страницы — только файлы, которые уже на сервере; размер — настоящий, с диска (не из запроса).
      if (dir) {
        for (const p of pages) {
          const size = await fileSize(p.sha);
          if (size === null) return fail(reply, 400, "invalid-argument");
          p.size = size;
        }
      }
      const [count] = await sql<{ n: number }[]>`select count(*)::int as n from decks where owner_id = ${user.id} and id <> ${id}`;
      if ((count?.n ?? 0) >= DECK_LIMITS.decks) return fail(reply, 429, "resource-exhausted");
      // Место: страницы всех показов ведущего (одинаковые файлы — один раз).
      const used = await usedPages(user.id, id);
      for (const p of pages) used.set(p.sha, p.size);
      if (deckBytes(used) > totalBytes) return fail(reply, 413, "resource-exhausted");
      const rows = await sql<Row[]>`
        insert into decks (id, owner_id, title, pages) values (${id}, ${user.id}, ${title}, ${sql.json(pages as never)})
        on conflict (id) do update set title = excluded.title, pages = excluded.pages, updated_at = now() where decks.owner_id = ${user.id}
        returning id, title, pages, updated_at`;
      const row = rows[0];
      if (!row) return fail(reply, 404, "not-found");
      request.log.info({ decks: "save", pages: pages.length }, "decks");
      return deckOf(row);
    });

    api.delete<{ Params: { id: string } }>("/api/decks/:id", async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      await sql`delete from decks where id = ${request.params.id} and owner_id = ${user.id}`;
      return { ok: true };
    });

    // Страница: файл как есть (WebP/JPEG до 900 КБ), размеры — в X-Width/X-Height. Ответ — отпечаток для показа.
    api.put<{ Body: unknown }>("/api/decks/page", { bodyLimit: DECK_LIMITS.pageBytes + 1024 }, async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      if (!dir) return fail(reply, 501, "unimplemented");
      const bytes = request.body;
      if (!Buffer.isBuffer(bytes)) return fail(reply, 400, "invalid-argument");
      if (bytes.length > DECK_LIMITS.pageBytes) return fail(reply, 413, "resource-exhausted");
      if (!imageMime(bytes)) return fail(reply, 400, "invalid-argument");
      const w = dimension(request.headers["x-width"]);
      const h = dimension(request.headers["x-height"]);
      if (!w || !h) return fail(reply, 400, "invalid-argument");
      const sha = createHash("sha256").update(bytes).digest("hex");
      // Лимит ведущего проверяем уже здесь (не только при сохранении показа): новый файл не должен выйти за 500 МБ.
      const used = await usedPages(user.id, null);
      if (!used.has(sha)) {
        used.set(sha, bytes.length);
        if (deckBytes(used) > totalBytes) return fail(reply, 413, "resource-exhausted");
      }
      await mkdir(dir, { recursive: true });
      const path = join(dir, sha);
      if (!existsSync(path)) {
        if ((await freeBytes(dir)) < minFree) {
          request.log.warn("decks: мало места на диске, загрузка отклонена");
          return fail(reply, 507, "resource-exhausted");
        }
        const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
        await writeFile(temp, bytes, { mode: 0o600 });
        await rename(temp, path);
      } else {
        // Тот же файл уже лежит (давно и без ссылок): освежаем время, иначе ночная уборка (7 дней без ссылок) может
        // убрать его раньше, чем показ сохранится.
        const t = new Date();
        await utimes(path, t, t).catch(() => undefined);
      }
      return { sha, w, h, size: bytes.length };
    });

    // Страницу открывает любой вошедший: ведущий, экран зала. По отпечатку файл не перезаписать.
    api.get<{ Params: { sha: string } }>("/api/decks/page/:sha", async (request, reply) => {
      const who = await identityOf(sql, request, reply);
      if (!who) return fail(reply, 401, "unauthenticated");
      if (!dir || !SHA.test(request.params.sha)) return fail(reply, 404, "not-found");
      let file: Buffer;
      try {
        file = await readFile(join(dir, request.params.sha));
      } catch {
        return fail(reply, 404, "not-found");
      }
      const mime = imageMime(file);
      if (!mime) return fail(reply, 404, "not-found");
      reply.header("Cache-Control", "private, max-age=31536000, immutable").header("ETag", `"${request.params.sha}"`);
      return reply.type(mime).send(file);
    });
  });
}

/** Сколько места занимают страницы (отпечаток → размер). */
export function deckBytes(pages: Map<string, number>): number {
  let total = 0;
  for (const size of pages.values()) total += size;
  return total;
}

/** Страницы, на которые ссылаются показы и идущие слайды сессий (остальные убирает ночная уборка). */
export async function deckPagesInUse(sql: Sql): Promise<Set<string>> {
  const rows = await sql<{ sha: string }[]>`
    select distinct p->>'sha' as sha from decks d, jsonb_array_elements(d.pages) p
    union select state->'slide'->'media'->>'sha' from sessions where state->'slide'->'media'->>'sha' is not null`;
  return new Set(rows.map((r) => r.sha));
}
