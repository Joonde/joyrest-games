/**
 * Музыка ведущих и общая музыкальная библиотека (CLAUDE.md, раздел 7, «Музыка»).
 *
 * Ведущий загружает трек себе (mp3, m4a, ogg до 15 МБ), отмечает, откуда права, и может
 * предложить его в общую библиотеку; admin принимает (запись-копия со scope agency, файл тот же)
 * или отклоняет с причиной. Файлы — MEDIA_DIR/audio/<sha256> (вне корня картинок: ночная уборка
 * картинок их не трогает, в том числе у прошлых релизов при откате). Сервер звук не перекодирует.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import * as permissions from "../../src/data/permissions";
import type { Track, TrackCategory, TrackLicense, TrackShareStatus } from "../../src/data/types";
import { actorOf, apiGuard, identityOf, newUserId, sessionUser, type SessionRow } from "./auth";
import { cleanReason } from "./proposals";

export interface TracksOptions {
  sql: Sql;
  /** Папка медиа (в контейнере /app/media); музыка — в подпапке audio. null — музыка недоступна. */
  mediaDir: string | null;
  isSite?: (request: FastifyRequest) => boolean;
  limits?: Partial<TrackLimits>;
  freeBytes?: (dir: string) => Promise<number>;
}

export interface TrackLimits {
  /** Самый большой файл. */
  fileBytes: number;
  /** Сколько байт музыки на ведущего (по владельцу треков). */
  perHostBytes: number;
  /** Меньше свободного места на диске — загрузка отклоняется. */
  minFreeBytes: number;
}

export const DEFAULT_TRACK_LIMITS: TrackLimits = {
  fileBytes: 15 * 1024 * 1024,
  perHostBytes: 500 * 1024 * 1024,
  minFreeBytes: 3 * 1024 * 1024 * 1024,
};

export const TRACK_CATEGORIES: readonly TrackCategory[] = ["lobby", "background", "contest", "board", "break", "award", "holiday"];
export const TRACK_LICENSES: readonly TrackLicense[] = ["pixabay", "bought", "own", "other"];

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const TITLE_MAX = 120;
const NOTE_MAX = 200;
const LIST_LIMIT = 300;

interface TrackRow {
  id: string;
  owner_id: string;
  owner_name: string | null;
  scope: string;
  title: string;
  category: string;
  license: string;
  license_note: string;
  sha256: string | null;
  mime: string | null;
  size: number;
  duration_ms: number | null;
  share_status: string;
  share_reason: string | null;
  library_track_id: string | null;
  created_at: Date;
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Одна строка без управляющих символов. */
export function cleanLine(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Тип звука по первым байтам: MP3 (ID3 или кадр), M4A/MP4 (ftyp), OGG. Иначе null. */
export function audioMime(bytes: Buffer): "audio/mpeg" | "audio/mp4" | "audio/ogg" | null {
  if (bytes.length >= 3 && bytes.toString("latin1", 0, 3) === "ID3") return "audio/mpeg";
  if (bytes.length >= 2 && bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0) return "audio/mpeg";
  if (bytes.length >= 12 && bytes.toString("latin1", 4, 8) === "ftyp") return "audio/mp4";
  if (bytes.length >= 4 && bytes.toString("latin1", 0, 4) === "OggS") return "audio/ogg";
  return null;
}

export function trackOf(row: TrackRow): Track {
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerName: row.owner_name ?? "",
    scope: row.scope === "agency" ? "agency" : "personal",
    title: row.title,
    category: pick(row.category, TRACK_CATEGORIES, "background"),
    license: pick(row.license, TRACK_LICENSES, "other"),
    licenseNote: row.license_note,
    ready: row.sha256 !== null,
    size: row.size,
    durationMs: row.duration_ms,
    shareStatus: pick<TrackShareStatus>(row.share_status, ["none", "pending", "accepted", "rejected"], "none"),
    shareReason: row.share_reason,
    createdAt: row.created_at.getTime(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function diskFree(dir: string): Promise<number> {
  const stats = await statfs(dir);
  return stats.bavail * stats.bsize;
}

export function registerTracks(app: FastifyInstance, options: TracksOptions): void {
  const { sql } = options;
  const audioDir = options.mediaDir ? join(options.mediaDir, "audio") : null;
  const limits = { ...DEFAULT_TRACK_LIMITS, ...options.limits };
  const freeBytes = options.freeBytes ?? diskFree;
  const select = () => sql`
    select t.id, t.owner_id, u.name as owner_name, t.scope, t.title, t.category, t.license, t.license_note,
           t.sha256, t.mime, t.size, t.duration_ms, t.share_status, t.share_reason, t.library_track_id, t.created_at
    from tracks t left join users u on u.id = t.owner_id`;

  app.register(async (api) => {
    api.addHook("onRequest", apiGuard(options.isSite));
    // Файл приходит «как есть», без multipart. Тип проверяем по первым байтам.
    api.addContentTypeParser(
      ["audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/ogg", "application/octet-stream"],
      { parseAs: "buffer", bodyLimit: limits.fileBytes + 1024 },
      (_request, body, done) => done(null, body),
    );

    function fail(reply: FastifyReply, status: number, code: string) {
      return reply.code(status).send({ error: code });
    }

    async function requireHost(request: FastifyRequest, reply: FastifyReply): Promise<SessionRow | null> {
      const user = await sessionUser(sql, request, reply);
      if (!user) {
        fail(reply, 401, "unauthenticated");
        return null;
      }
      if (!permissions.isActiveHost(actorOf(user))) {
        fail(reply, 403, "permission-denied");
        return null;
      }
      return user;
    }

    async function findTrack(id: string): Promise<TrackRow | null> {
      if (!ID.test(id)) return null;
      const rows = await sql<TrackRow[]>`${select()} where t.id = ${id}`;
      return rows[0] ?? null;
    }

    const ref = (row: TrackRow) => ({ scope: row.scope === "agency" ? ("agency" as const) : ("personal" as const), ownerId: row.owner_id });

    // Свои треки и общая библиотека (только загруженные).
    api.get<{ Querystring: { status?: string } }>("/api/tracks", async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      if (request.query.status === "pending") {
        if (!permissions.canReviewTracks(actorOf(user))) return fail(reply, 403, "permission-denied");
        const rows = await sql<TrackRow[]>`
          ${select()} where t.share_status = 'pending' and t.sha256 is not null order by t.created_at limit ${LIST_LIMIT}`;
        return rows.map(trackOf);
      }
      const mine = await sql<TrackRow[]>`
        ${select()} where t.owner_id = ${user.id} and t.scope = 'personal' order by t.created_at desc limit ${LIST_LIMIT}`;
      const library = await sql<TrackRow[]>`
        ${select()} where t.scope = 'agency' and t.sha256 is not null order by t.category, t.title limit ${LIST_LIMIT}`;
      return { mine: mine.map(trackOf), library: library.map(trackOf) };
    });

    // Описание трека (id от браузера: повтор после обрыва — тот же трек). Файл — следующим запросом.
    api.post<{ Body: unknown }>("/api/tracks", { bodyLimit: 4096 }, async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      const body = isRecord(request.body) ? request.body : {};
      const id = typeof body.id === "string" && ID.test(body.id) ? body.id : null;
      const scope = body.scope === "agency" ? "agency" : "personal";
      const title = cleanLine(body.title, TITLE_MAX);
      if (!id || !title) return fail(reply, 400, "invalid-argument");
      if (!permissions.canUploadTrack(actorOf(user), scope)) return fail(reply, 403, "permission-denied");
      const license = pick(body.license, TRACK_LICENSES, "other");
      const note = cleanLine(body.licenseNote, NOTE_MAX);
      // Права подтверждает ведущий: «другое» — только с пояснением, откуда трек.
      if (license === "other" && !note) return fail(reply, 400, "invalid-argument");
      const existing = await findTrack(id);
      if (existing) return existing.owner_id === user.id ? trackOf(existing) : fail(reply, 409, "already-exists");
      await sql`
        insert into tracks (id, owner_id, scope, title, category, license, license_note)
        values (${id}, ${user.id}, ${scope}, ${title}, ${pick(body.category, TRACK_CATEGORIES, "background")}, ${license}, ${note})
        on conflict (id) do nothing`;
      const created = await findTrack(id);
      request.log.info({ track: "create" }, "track");
      return created ? trackOf(created) : fail(reply, 503, "unavailable");
    });

    api.patch<{ Params: { id: string }; Body: unknown }>("/api/tracks/:id", { bodyLimit: 4096 }, async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      const track = await findTrack(request.params.id);
      if (!track) return fail(reply, 404, "not-found");
      if (!permissions.canEditTrack(actorOf(user), ref(track))) return fail(reply, 403, "permission-denied");
      const body = isRecord(request.body) ? request.body : {};
      const title = body.title === undefined ? track.title : cleanLine(body.title, TITLE_MAX);
      if (!title) return fail(reply, 400, "invalid-argument");
      const category = body.category === undefined ? track.category : pick(body.category, TRACK_CATEGORIES, "background");
      await sql`update tracks set title = ${title}, category = ${category}, updated_at = now() where id = ${track.id}`;
      const updated = await findTrack(track.id);
      return updated ? trackOf(updated) : fail(reply, 404, "not-found");
    });

    api.delete<{ Params: { id: string } }>("/api/tracks/:id", async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      const track = await findTrack(request.params.id);
      if (!track) return { ok: true };
      if (!permissions.canEditTrack(actorOf(user), ref(track))) return fail(reply, 403, "permission-denied");
      // Файл остаётся, пока на него ссылается другой трек (копия в библиотеке); без ссылок — уберёт уборка.
      await sql`delete from tracks where id = ${track.id}`;
      request.log.info({ track: "delete" }, "track");
      return { ok: true };
    });

    // Файл трека: тот же — успех, другой под тем же id — 409 (трек по id не перезаписать).
    api.put<{ Params: { id: string }; Body: unknown }>("/api/tracks/:id/file", { bodyLimit: limits.fileBytes + 1024 }, async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      if (!audioDir || !options.mediaDir) return fail(reply, 501, "unimplemented");
      const track = await findTrack(request.params.id);
      if (!track) return fail(reply, 404, "not-found");
      if (track.owner_id !== user.id || !permissions.canEditTrack(actorOf(user), ref(track))) return fail(reply, 403, "permission-denied");
      const bytes = request.body;
      if (!Buffer.isBuffer(bytes)) return fail(reply, 400, "invalid-argument");
      const mime = audioMime(bytes);
      if (!mime) return fail(reply, 400, "invalid-argument");
      if (bytes.length > limits.fileBytes) return fail(reply, 413, "resource-exhausted");
      const sha = createHash("sha256").update(bytes).digest("hex");
      if (track.sha256) return track.sha256 === sha ? trackOf(track) : fail(reply, 409, "already-exists");

      if ((await freeBytes(options.mediaDir)) < limits.minFreeBytes) {
        request.log.warn("tracks: мало места на диске, загрузка отклонена");
        return fail(reply, 507, "resource-exhausted");
      }
      const [{ used }] = await sql<{ used: string }[]>`
        select coalesce(sum(size), 0)::text as used from tracks where owner_id = ${track.owner_id} and sha256 is not null`;
      if (Number(used) + bytes.length > limits.perHostBytes) return fail(reply, 413, "resource-exhausted");

      await mkdir(audioDir, { recursive: true });
      const path = join(audioDir, sha);
      if (!existsSync(path)) {
        const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
        await writeFile(temp, bytes, { mode: 0o600 });
        await rename(temp, path);
      }
      const duration = Number(request.headers["x-duration"]);
      const durationMs = Number.isInteger(duration) && duration > 0 && duration < 6 * 3600_000 ? duration : null;
      await sql`
        update tracks set sha256 = ${sha}, mime = ${mime}, size = ${bytes.length}, duration_ms = ${durationMs}, updated_at = now()
        where id = ${track.id} and sha256 is null`;
      request.log.info({ track: "upload" }, "track");
      const updated = await findTrack(track.id);
      return updated ? trackOf(updated) : fail(reply, 404, "not-found");
    });

    // Файл открывает любой вошедший — ведущий и экран зала (permissions.canViewMedia): id трека
    // есть только у ведущего и в документе сессии, его не угадать.
    api.get<{ Params: { id: string } }>("/api/tracks/:id/file", async (request, reply) => {
      const who = await identityOf(sql, request, reply);
      if (!permissions.canViewMedia(who?.uid ?? null)) return fail(reply, 401, "unauthenticated");
      if (!audioDir) return fail(reply, 501, "unimplemented");
      const track = await findTrack(request.params.id);
      if (!track?.sha256 || !track.mime) return fail(reply, 404, "not-found");
      const etag = `"${track.sha256}"`;
      reply.header("Cache-Control", "private, max-age=31536000, immutable").header("ETag", etag);
      if (request.headers["if-none-match"] === etag) return reply.code(304).send();
      let file: Buffer;
      try {
        file = await readFile(join(audioDir, track.sha256));
      } catch {
        reply.header("Cache-Control", "no-store");
        return fail(reply, 404, "not-found");
      }
      return reply.type(track.mime).send(file);
    });

    // Ведущий предлагает свой трек в общую. Повтор, пока ждёт, — то же.
    api.post<{ Params: { id: string } }>("/api/tracks/:id/share", async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      const track = await findTrack(request.params.id);
      if (!track) return fail(reply, 404, "not-found");
      if (!permissions.canShareTrack(actorOf(user), ref(track))) return fail(reply, 403, "permission-denied");
      if (!track.sha256) return fail(reply, 409, "failed-precondition");
      await sql`update tracks set share_status = 'pending', share_reason = null, updated_at = now() where id = ${track.id}`;
      request.log.info({ track: "share" }, "track");
      const updated = await findTrack(track.id);
      return updated ? trackOf(updated) : fail(reply, 404, "not-found");
    });

    api.post<{ Params: { id: string } }>("/api/tracks/:id/accept", async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      if (!permissions.canReviewTracks(actorOf(user))) return fail(reply, 403, "permission-denied");
      const track = await findTrack(request.params.id);
      if (!track) return fail(reply, 404, "not-found");
      if (track.share_status === "accepted") return trackOf(track);
      if (track.share_status !== "pending" || !track.sha256) return fail(reply, 409, "failed-precondition");
      await sql.begin(async (tx) => {
        // Уже принимали и копия в библиотеке есть — обновляем её, а не плодим дубль.
        const [previous] = track.library_track_id
          ? await tx<{ id: string }[]>`select id from tracks where id = ${track.library_track_id} and scope = 'agency'`
          : [];
        const target = previous?.id ?? newUserId();
        if (previous) {
          await tx`
            update tracks set title = ${track.title}, category = ${track.category}, license = ${track.license},
              license_note = ${track.license_note}, sha256 = ${track.sha256}, mime = ${track.mime}, size = ${track.size},
              duration_ms = ${track.duration_ms}, updated_at = now()
            where id = ${target}`;
        } else {
          await tx`
            insert into tracks (id, owner_id, scope, title, category, license, license_note, sha256, mime, size, duration_ms)
            values (${target}, ${user.id}, 'agency', ${track.title}, ${track.category}, ${track.license},
                    ${track.license_note}, ${track.sha256}, ${track.mime}, ${track.size}, ${track.duration_ms})`;
        }
        await tx`
          update tracks set share_status = 'accepted', share_reason = null, library_track_id = ${target}, updated_at = now()
          where id = ${track.id}`;
      });
      request.log.info({ track: "accept" }, "track");
      const updated = await findTrack(track.id);
      return updated ? trackOf(updated) : { ok: true };
    });

    api.post<{ Params: { id: string }; Body: unknown }>("/api/tracks/:id/reject", { bodyLimit: 4096 }, async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      if (!permissions.canReviewTracks(actorOf(user))) return fail(reply, 403, "permission-denied");
      const track = await findTrack(request.params.id);
      if (!track) return fail(reply, 404, "not-found");
      if (track.share_status === "rejected") return trackOf(track);
      if (track.share_status !== "pending") return fail(reply, 409, "failed-precondition");
      const reason = cleanReason(isRecord(request.body) ? request.body.reason : null);
      await sql`update tracks set share_status = 'rejected', share_reason = ${reason}, updated_at = now() where id = ${track.id}`;
      request.log.info({ track: "reject" }, "track");
      const updated = await findTrack(track.id);
      return updated ? trackOf(updated) : { ok: true };
    });
  });
}
