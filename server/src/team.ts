/**
 * Карточка ведущего и раздел «Команда JoyRest» (CLAUDE.md, раздел 3): аватарка (1:1), обложка
 * (3:1) и «о себе». Карточки видят все активные ведущие и владелец; квалификация и баллы в них
 * не входят. Картинки сжимает устройство, сервер проверяет тип по первым байтам и размер.
 * Файлы — MEDIA_DIR/profile/<sha256> (вне корня картинок игр: их уборка эти файлы не трогает).
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import * as permissions from "../../src/data/permissions";
import type { TeamMember } from "../../src/data/types";
import { actorOf, apiGuard, sessionUser, type SessionRow, uploadGuard } from "./auth";
import { imageMime } from "./games";
import { professionOf } from "../../src/core/professions";

export interface TeamOptions {
  sql: Sql;
  mediaDir: string | null;
  isSite?: (request: FastifyRequest) => boolean;
}

export type ProfileImage = "avatar" | "cover";

/** Самые тяжёлые файлы (устройство сжимает до ~120 и ~250 КБ). */
export const PROFILE_MAX_BYTES: Record<ProfileImage, number> = { avatar: 300 * 1024, cover: 600 * 1024 };
export const BIO_MAX = 300;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

interface TeamRow {
  id: string;
  name: string;
  role: string;
  bio: string | null;
  avatar_sha: string | null;
  cover_sha: string | null;
  created_at: Date | null;
  profession?: string | null;
}

/** «О себе»: без управляющих символов, переводы строк можно (не больше двух подряд). */
export function cleanBio(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, BIO_MAX);
}

export function memberOf(row: TeamRow, adminUid: (id: string) => boolean): TeamMember {
  return {
    uid: row.id,
    name: row.name,
    bio: row.bio ?? "",
    avatar: row.avatar_sha,
    cover: row.cover_sha,
    owner: adminUid(row.id) || row.role === "admin",
    since: row.created_at ? row.created_at.getTime() : null,
    profession: professionOf(row.profession),
  };
}

function isImageKind(value: string): value is ProfileImage {
  return value === "avatar" || value === "cover";
}

export function registerTeam(app: FastifyInstance, options: TeamOptions): void {
  const { sql } = options;
  const profileDir = options.mediaDir ? join(options.mediaDir, "profile") : null;
  const isOwner = (id: string) => permissions.isAdmin({ uid: id, role: "host", active: true });

  app.register(async (api) => {
    api.addHook("onRequest", apiGuard(options.isSite));
    // Большие тела (файлы) — только от вошедшего ведущего и не больше трёх сразу.
    api.addHook("onRequest", uploadGuard(sql));
    api.addContentTypeParser(["image/webp", "image/jpeg"], { parseAs: "buffer", bodyLimit: 700 * 1024 }, (_request, body, done) => done(null, body));

    function fail(reply: FastifyReply, status: number, code: string) {
      return reply.code(status).send({ error: code });
    }

    async function requireHost(request: FastifyRequest, reply: FastifyReply): Promise<SessionRow | null> {
      const user = await sessionUser(sql, request, reply);
      if (!user) {
        fail(reply, 401, "unauthenticated");
        return null;
      }
      if (!permissions.canViewTeam(actorOf(user))) {
        fail(reply, 403, "permission-denied");
        return null;
      }
      return user;
    }

    // Команда: активные ведущие и владелец. Без почт, квалификации и баллов.
    api.get("/api/team", async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      const rows = await sql<TeamRow[]>`
        select id, name, role, bio, avatar_sha, cover_sha, created_at, profession from users
        where active = true order by (role = 'admin') desc, name`;
      return rows.map((row) => memberOf(row, isOwner));
    });

    api.post<{ Body: unknown }>("/api/team/me", { bodyLimit: 4096 }, async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      const body = typeof request.body === "object" && request.body !== null ? (request.body as Record<string, unknown>) : {};
      const bio = cleanBio(body.bio);
      if (bio === null) return fail(reply, 400, "invalid-argument");
      await sql`update users set bio = ${bio}, updated_at = now() where id = ${user.id}`;
      request.log.info({ team: "bio" }, "team");
      return { ok: true, bio };
    });

    api.put<{ Params: { kind: string }; Body: unknown }>("/api/team/me/:kind", { bodyLimit: 700 * 1024 }, async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      if (!profileDir) return fail(reply, 501, "unimplemented");
      const kind = request.params.kind;
      if (!isImageKind(kind)) return fail(reply, 404, "not-found");
      const bytes = request.body;
      if (!Buffer.isBuffer(bytes)) return fail(reply, 400, "invalid-argument");
      const mime = imageMime(bytes);
      if (!mime) return fail(reply, 400, "invalid-argument");
      if (bytes.length > PROFILE_MAX_BYTES[kind]) return fail(reply, 413, "resource-exhausted");
      const sha = createHash("sha256").update(bytes).digest("hex");
      await mkdir(profileDir, { recursive: true });
      const path = join(profileDir, sha);
      if (!existsSync(path)) {
        const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
        await writeFile(temp, bytes, { mode: 0o600 });
        await rename(temp, path);
      }
      if (kind === "avatar") await sql`update users set avatar_sha = ${sha}, avatar_mime = ${mime}, updated_at = now() where id = ${user.id}`;
      else await sql`update users set cover_sha = ${sha}, cover_mime = ${mime}, updated_at = now() where id = ${user.id}`;
      request.log.info({ team: kind }, "team");
      return { ok: true, sha };
    });

    api.delete<{ Params: { kind: string } }>("/api/team/me/:kind", { bodyLimit: 1024 }, async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      const kind = request.params.kind;
      if (!isImageKind(kind)) return fail(reply, 404, "not-found");
      // Файл уберёт ночная уборка, когда на него никто не ссылается.
      if (kind === "avatar") await sql`update users set avatar_sha = null, avatar_mime = null, updated_at = now() where id = ${user.id}`;
      else await sql`update users set cover_sha = null, cover_mime = null, updated_at = now() where id = ${user.id}`;
      return { ok: true };
    });

    // Картинка карточки: адрес с отпечатком (?v=sha) — кэш на год, новая картинка — новый адрес.
    api.get<{ Params: { id: string; kind: string } }>("/api/team/:id/:kind", async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      if (!profileDir) return fail(reply, 501, "unimplemented");
      const { id, kind } = request.params;
      if (!ID.test(id) || !isImageKind(kind)) return fail(reply, 404, "not-found");
      const [row] = await sql<{ sha: string | null; mime: string | null }[]>`
        select ${kind === "avatar" ? sql`avatar_sha` : sql`cover_sha`} as sha,
               ${kind === "avatar" ? sql`avatar_mime` : sql`cover_mime`} as mime
        from users where id = ${id} and active = true`;
      if (!row?.sha || !row.mime) return fail(reply, 404, "not-found");
      const etag = `"${row.sha}"`;
      reply.header("Cache-Control", "private, max-age=31536000, immutable").header("ETag", etag);
      if (request.headers["if-none-match"] === etag) return reply.code(304).send();
      try {
        return reply.type(row.mime).send(await readFile(join(profileDir, row.sha)));
      } catch {
        reply.header("Cache-Control", "no-store");
        return fail(reply, 404, "not-found");
      }
    });
  });
}
