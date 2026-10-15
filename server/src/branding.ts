/**
 * Оформление под заказчика (решение владельца 15 октября 2026; `src/core/branding.ts`): ведущий сохраняет оформления
 * компаний и пар (название, 1–2 цвета, логотип) и выбирает при запуске — сессия хранит свою копию. Логотип сжимает телефон
 * ведущего (WebP или PNG с прозрачностью, до 800 px), сервер не перекодирует, тип — по первым байтам; файлы —
 * MEDIA_DIR/brand/<sha256> (в ночной копии вместе с media/prod). Открывает логотип любой вошедший (экран зала и телефоны
 * гостей входят устройством). Файлы без ссылок убирает ночная уборка (`cleanupBrandLogos`).
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { BRANDING_LIMITS, parseBranding, type SavedBranding } from "../../src/core/branding";
import * as permissions from "../../src/data/permissions";
import { actorOf, apiGuard, identityOf, sessionUser, type SessionRow, uploadGuard } from "./auth";
import { imageMime } from "./games";

export interface BrandingOptions {
  sql: Sql;
  mediaDir: string | null;
  isSite?: (request: FastifyRequest) => boolean;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const SHA = /^[0-9a-f]{64}$/;

/** Логотип: WebP и JPEG — как у картинок игр, плюс PNG (прозрачный фон). */
export function logoMime(bytes: Buffer): "image/webp" | "image/jpeg" | "image/png" | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return imageMime(bytes);
}

interface Row {
  id: string;
  owner_id: string;
  name: string;
  colors: unknown;
  logo: string | null;
  updated_at: Date;
}

function savedOf(row: Row): SavedBranding {
  const parsed = parseBranding({ name: row.name, colors: row.colors, logo: row.logo });
  return { id: row.id, name: parsed?.name ?? row.name, colors: parsed?.colors ?? [], logo: parsed?.logo ?? null, updatedAt: row.updated_at.getTime() };
}

export function registerBranding(app: FastifyInstance, options: BrandingOptions): void {
  const { sql } = options;
  const dir = options.mediaDir ? join(options.mediaDir, "brand") : null;

  app.register(async (api) => {
    api.addHook("onRequest", apiGuard(options.isSite));
    api.addHook("onRequest", uploadGuard(sql));
    api.addContentTypeParser(["image/webp", "image/jpeg", "image/png"], { parseAs: "buffer", bodyLimit: BRANDING_LIMITS.logoBytes + 1024 }, (_request, body, done) => done(null, body));

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

    // Свои сохранённые оформления (свежие — первыми).
    api.get("/api/brandings", async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      const rows = await sql<Row[]>`select id, owner_id, name, colors, logo, updated_at from brandings where owner_id = ${user.id}
        order by updated_at desc limit ${BRANDING_LIMITS.saved}`;
      return { brandings: rows.map(savedOf) };
    });

    // Новое или правка (id от браузера: повтор — та же запись). Чужое — 404.
    api.post<{ Body: unknown }>("/api/brandings", { bodyLimit: 4096 }, async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      const body = typeof request.body === "object" && request.body !== null ? (request.body as Record<string, unknown>) : {};
      const id = typeof body.id === "string" && ID.test(body.id) ? body.id : null;
      const branding = parseBranding(body);
      if (!id || !branding) return fail(reply, 400, "invalid-argument");
      const [count] = await sql<{ n: number }[]>`select count(*)::int as n from brandings where owner_id = ${user.id} and id <> ${id}`;
      if ((count?.n ?? 0) >= BRANDING_LIMITS.saved) return fail(reply, 429, "resource-exhausted");
      const rows = await sql<Row[]>`
        insert into brandings (id, owner_id, name, colors, logo) values (${id}, ${user.id}, ${branding.name}, ${sql.json(branding.colors)}, ${branding.logo})
        on conflict (id) do update set name = excluded.name, colors = excluded.colors, logo = excluded.logo, updated_at = now()
          where brandings.owner_id = ${user.id}
        returning id, owner_id, name, colors, logo, updated_at`;
      const row = rows[0];
      if (!row) return fail(reply, 404, "not-found");
      request.log.info({ branding: "save" }, "branding");
      return savedOf(row);
    });

    api.delete<{ Params: { id: string } }>("/api/brandings/:id", async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      await sql`delete from brandings where id = ${request.params.id} and owner_id = ${user.id}`;
      return { ok: true };
    });

    // Логотип: файл как есть; ответ — его отпечаток (им логотип и ссылается).
    api.put<{ Body: unknown }>("/api/brandings/logo", { bodyLimit: BRANDING_LIMITS.logoBytes + 1024 }, async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      if (!dir) return fail(reply, 501, "unimplemented");
      const bytes = request.body;
      if (!Buffer.isBuffer(bytes)) return fail(reply, 400, "invalid-argument");
      if (bytes.length > BRANDING_LIMITS.logoBytes) return fail(reply, 413, "resource-exhausted");
      if (!logoMime(bytes)) return fail(reply, 400, "invalid-argument");
      const sha = createHash("sha256").update(bytes).digest("hex");
      await mkdir(dir, { recursive: true });
      const path = join(dir, sha);
      if (!existsSync(path)) {
        const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
        await writeFile(temp, bytes, { mode: 0o600 });
        await rename(temp, path);
      }
      request.log.info({ branding: "logo" }, "branding");
      return { logo: sha };
    });

    // Логотип открывает любой вошедший: ведущий, экран зала, телефон гостя. Файл по отпечатку не перезаписать.
    api.get<{ Params: { sha: string } }>("/api/brandings/logo/:sha", async (request, reply) => {
      const who = await identityOf(sql, request, reply);
      if (!who) return fail(reply, 401, "unauthenticated");
      if (!dir || !SHA.test(request.params.sha)) return fail(reply, 404, "not-found");
      let file: Buffer;
      try {
        file = await readFile(join(dir, request.params.sha));
      } catch {
        return fail(reply, 404, "not-found");
      }
      const mime = logoMime(file);
      if (!mime) return fail(reply, 404, "not-found");
      reply.header("Cache-Control", "private, max-age=31536000, immutable").header("ETag", `"${request.params.sha}"`);
      return reply.type(mime).send(file);
    });
  });
}

/** Логотипы, на которые ссылаются сохранённые оформления и сессии (остальные убирает ночная уборка). */
export async function brandLogosInUse(sql: Sql): Promise<Set<string>> {
  const rows = await sql<{ sha: string }[]>`
    select logo as sha from brandings where logo is not null
    union select branding->>'logo' from sessions where branding->>'logo' is not null`;
  return new Set(rows.map((r) => r.sha));
}
