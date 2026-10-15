/**
 * Фотоотчёт мероприятия (решение владельца 15 октября 2026): ведущий с пульта делает до 3 общих фото на игру (переснять,
 * удалить) — для отчётности, Telegram-канала и сайта. Фото сжимает телефон ведущего (WebP или JPEG до ~1,2 МБ), сервер не
 * перекодирует, тип — по первым байтам. Файлы — MEDIA_DIR/photos/<sha256>, попадают в ночную копию вместе с media/prod.
 * Строка хранит название игры, ведущего и дату сама: сессии удаляются через 30 дней, фотоотчёт остаётся. Смотрят ведущий —
 * свои мероприятия, владелец — все (студия → «Фотоотчёты»). Файлы без ссылок убирает ночная уборка.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import * as permissions from "../../src/data/permissions";
import type { EventPhoto } from "../../src/data/types";
import { actorOf, apiGuard, sessionUser, type SessionRow, uploadGuard } from "./auth";
import { imageMime } from "./games";

export interface PhotosOptions {
  sql: Sql;
  mediaDir: string | null;
  isSite?: (request: FastifyRequest) => boolean;
}

export const PHOTO_SLOTS = 3;
export const PHOTO_MAX_BYTES = 1536 * 1024;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

interface PhotoRow {
  session_id: string;
  slot: number;
  host_id: string;
  host_name: string | null;
  game_title: string;
  played_at: Date | null;
  sha256: string;
  width: number | null;
  height: number | null;
  created_at: Date;
}

function photoOf(row: PhotoRow): EventPhoto {
  return {
    sessionId: row.session_id,
    slot: row.slot,
    hostId: row.host_id,
    hostName: row.host_name ?? "",
    gameTitle: row.game_title,
    playedAt: row.played_at ? row.played_at.getTime() : null,
    width: row.width,
    height: row.height,
    createdAt: row.created_at.getTime(),
    url: `/api/sessions/${encodeURIComponent(row.session_id)}/photos/${row.slot}/file?v=${row.sha256.slice(0, 12)}`,
  };
}

function dimension(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : null;
}

export function registerPhotos(app: FastifyInstance, options: PhotosOptions): void {
  const { sql } = options;
  const dir = options.mediaDir ? join(options.mediaDir, "photos") : null;
  const select = () => sql`
    select p.session_id, p.slot, p.host_id, u.name as host_name, p.game_title, p.played_at, p.sha256, p.width, p.height, p.created_at
    from event_photos p left join users u on u.id = p.host_id`;

  app.register(async (api) => {
    api.addHook("onRequest", apiGuard(options.isSite));
    api.addHook("onRequest", uploadGuard(sql));
    api.addContentTypeParser(["image/webp", "image/jpeg"], { parseAs: "buffer", bodyLimit: PHOTO_MAX_BYTES + 1024 }, (_request, body, done) => done(null, body));

    function fail(reply: FastifyReply, status: number, code: string) {
      return reply.code(status).send({ error: code });
    }

    async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<SessionRow | null> {
      const user = await sessionUser(sql, request, reply);
      if (!user) {
        fail(reply, 401, "unauthenticated");
        return null;
      }
      return user;
    }

    async function findSession(id: string) {
      if (!ID.test(id)) return null;
      const [row] = await sql<{ id: string; host_id: string; game_title: string; created_at: Date }[]>`
        select id, host_id, game_title, created_at from sessions where id = ${id}`;
      return row ?? null;
    }

    /** Чьё мероприятие: из сессии, а если она уже удалена — из самих фото. */
    async function ownerOf(sessionId: string): Promise<string | null> {
      const session = await findSession(sessionId);
      if (session) return session.host_id;
      const [row] = await sql<{ host_id: string }[]>`select host_id from event_photos where session_id = ${sessionId} limit 1`;
      return row?.host_id ?? null;
    }

    const slotOf = (raw: string) => {
      const n = Number(raw);
      return Number.isInteger(n) && n >= 1 && n <= PHOTO_SLOTS ? n : null;
    };

    // Фото одной игры (пульт).
    api.get<{ Params: { id: string } }>("/api/sessions/:id/photos", async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return reply;
      const hostId = await ownerOf(request.params.id);
      if (!hostId) return [];
      if (!permissions.canViewEventPhotos(actorOf(user), hostId)) return fail(reply, 403, "permission-denied");
      const rows = await sql<PhotoRow[]>`${select()} where p.session_id = ${request.params.id} order by p.slot`;
      reply.header("Cache-Control", "no-store");
      return rows.map(photoOf);
    });

    // Снять или переснять фото в ячейке 1–3.
    api.put<{ Params: { id: string; slot: string }; Body: unknown }>(
      "/api/sessions/:id/photos/:slot",
      { bodyLimit: PHOTO_MAX_BYTES + 1024 },
      async (request, reply) => {
        const user = await requireUser(request, reply);
        if (!user) return reply;
        if (!dir) return fail(reply, 501, "unimplemented");
        const slot = slotOf(request.params.slot);
        const session = await findSession(request.params.id);
        if (!slot || !session) return fail(reply, 404, "not-found");
        if (!permissions.canTakeEventPhotos(actorOf(user), { hostId: session.host_id })) return fail(reply, 403, "permission-denied");
        const bytes = request.body;
        if (!Buffer.isBuffer(bytes)) return fail(reply, 400, "invalid-argument");
        const mime = imageMime(bytes);
        if (!mime) return fail(reply, 400, "invalid-argument");
        if (bytes.length > PHOTO_MAX_BYTES) return fail(reply, 413, "resource-exhausted");
        const sha = createHash("sha256").update(bytes).digest("hex");
        await mkdir(dir, { recursive: true });
        const path = join(dir, sha);
        if (!existsSync(path)) {
          const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
          await writeFile(temp, bytes, { mode: 0o600 });
          await rename(temp, path);
        }
        const width = dimension(request.headers["x-width"]);
        const height = dimension(request.headers["x-height"]);
        await sql`
          insert into event_photos (session_id, slot, host_id, game_title, played_at, sha256, mime, width, height, size)
          values (${session.id}, ${slot}, ${session.host_id}, ${session.game_title}, ${session.created_at}, ${sha}, ${mime}, ${width}, ${height}, ${bytes.length})
          on conflict (session_id, slot) do update
            set sha256 = excluded.sha256, mime = excluded.mime, width = excluded.width, height = excluded.height,
                size = excluded.size, created_at = now()`;
        request.log.info({ photo: "save" }, "photo");
        const [row] = await sql<PhotoRow[]>`${select()} where p.session_id = ${session.id} and p.slot = ${slot}`;
        return row ? photoOf(row) : fail(reply, 503, "unavailable");
      },
    );

    api.delete<{ Params: { id: string; slot: string } }>("/api/sessions/:id/photos/:slot", async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return reply;
      const slot = slotOf(request.params.slot);
      const hostId = await ownerOf(request.params.id);
      if (!slot || !hostId) return { ok: true };
      if (!permissions.canTakeEventPhotos(actorOf(user), { hostId })) return fail(reply, 403, "permission-denied");
      await sql`delete from event_photos where session_id = ${request.params.id} and slot = ${slot}`;
      request.log.info({ photo: "delete" }, "photo");
      return { ok: true };
    });

    // Файл фото — ведущему этой игры и владельцу (на сайт и в канал фото уносит владелец сам).
    api.get<{ Params: { id: string; slot: string } }>("/api/sessions/:id/photos/:slot/file", async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return reply;
      if (!dir) return fail(reply, 501, "unimplemented");
      const slot = slotOf(request.params.slot);
      if (!slot || !ID.test(request.params.id)) return fail(reply, 404, "not-found");
      const [row] = await sql<{ host_id: string; sha256: string; mime: string }[]>`
        select host_id, sha256, mime from event_photos where session_id = ${request.params.id} and slot = ${slot}`;
      if (!row) return fail(reply, 404, "not-found");
      if (!permissions.canViewEventPhotos(actorOf(user), row.host_id)) return fail(reply, 403, "permission-denied");
      let file: Buffer;
      try {
        file = await readFile(join(dir, row.sha256));
      } catch {
        return fail(reply, 404, "not-found");
      }
      reply.header("Cache-Control", "private, max-age=31536000, immutable").header("ETag", `"${row.sha256}"`);
      return reply.type(row.mime).send(file);
    });

    // «Фотоотчёты» в студии: ведущему — свои мероприятия, владельцу — все.
    api.get("/api/photos", async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return reply;
      const actor = actorOf(user);
      if (!permissions.canViewEventPhotos(actor, user.id)) return fail(reply, 403, "permission-denied");
      const all = permissions.isAdmin(actor);
      const rows = await sql<PhotoRow[]>`
        ${select()} where ${all} or p.host_id = ${user.id}
        order by coalesce(p.played_at, p.created_at) desc, p.session_id, p.slot limit 600`;
      reply.header("Cache-Control", "no-store");
      return rows.map(photoOf);
    });
  });
}
