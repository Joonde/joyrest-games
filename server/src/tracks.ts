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
import { parseTrackClip } from "../../src/data/trackClip";
import type { Track, TrackCategory, TrackLicense, TrackShareStatus } from "../../src/data/types";
import { actorOf, apiGuard, identityOf, newUserId, sessionUser, type SessionRow, uploadGuard } from "./auth";
import { cleanReason } from "./proposals";
import { takeTracks } from "./libraryTracks";

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

export const TRACK_CATEGORIES: readonly TrackCategory[] = ["music", "lobby", "background", "contest", "board", "break", "award", "holiday"];
export const TRACK_LICENSES: readonly TrackLicense[] = ["pixabay", "bought", "own", "other"];

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const TITLE_MAX = 120;
const NOTE_MAX = 200;
/** Название папки трека (решение владельца 15 октября 2026). */
export const FOLDER_MAX = 40;
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
  clip: unknown;
  folder: string | null;
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
/** Заголовок Range «bytes=начало-конец» (один отрезок): null — весь файл, invalid — за пределами файла. */
export function byteRange(header: string | undefined, size: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    // «bytes=-500» — последние 500 байт.
    const tail = Number(m[2]);
    if (tail <= 0) return "invalid";
    start = Math.max(0, size - tail);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isFinite(start) || start >= size || end < start) return "invalid";
  return { start, end };
}

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
    clip: parseTrackClip(row.clip),
    folder: row.folder ?? "",
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
           t.sha256, t.mime, t.size, t.duration_ms, t.share_status, t.share_reason, t.library_track_id, t.created_at, t.clip, t.folder
    from tracks t left join users u on u.id = t.owner_id`;

  app.register(async (api) => {
    api.addHook("onRequest", apiGuard(options.isSite));
    // Большие тела (файлы) — только от вошедшего ведущего и не больше трёх сразу.
    api.addHook("onRequest", uploadGuard(sql));
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
      if (!permissions.canUseTracks(actorOf(user))) {
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
      return { mine: mine.map(trackOf), library: library.map(trackOf), folders: await folderLists(user.id) };
    });

    // Папки «Музыки»: создать (можно пустую), переименовать (треки переезжают), удалить (треки остаются без папки).
    const folderOwner = (scope: "personal" | "agency", userId: string) => (scope === "agency" ? "agency" : userId);
    async function folderLists(userId: string): Promise<{ mine: string[]; library: string[] }> {
      const rows = await sql<{ scope: string; name: string }[]>`
        select scope, name from track_folders where (owner_id = ${userId} and scope = 'personal') or (owner_id = 'agency' and scope = 'agency')
        order by name limit ${LIST_LIMIT}`;
      return { mine: rows.filter((r) => r.scope === "personal").map((r) => r.name), library: rows.filter((r) => r.scope === "agency").map((r) => r.name) };
    }
    function folderScope(body: Record<string, unknown>): "personal" | "agency" {
      return body.scope === "agency" ? "agency" : "personal";
    }

    api.post<{ Body: unknown }>("/api/track-folders", { bodyLimit: 1024 }, async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      const body = isRecord(request.body) ? request.body : {};
      const scope = folderScope(body);
      if (!permissions.canUploadTrack(actorOf(user), scope)) return fail(reply, 403, "permission-denied");
      const name = cleanLine(body.name, FOLDER_MAX);
      if (!name) return fail(reply, 400, "invalid-argument");
      await sql`insert into track_folders (owner_id, scope, name) values (${folderOwner(scope, user.id)}, ${scope}, ${name}) on conflict do nothing`;
      return folderLists(user.id);
    });

    api.post<{ Body: unknown }>("/api/track-folders/rename", { bodyLimit: 1024 }, async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      const body = isRecord(request.body) ? request.body : {};
      const scope = folderScope(body);
      if (!permissions.canUploadTrack(actorOf(user), scope)) return fail(reply, 403, "permission-denied");
      const from = cleanLine(body.from, FOLDER_MAX);
      const to = cleanLine(body.to, FOLDER_MAX);
      // Пустое название — не «удалить»: для этого отдельная кнопка.
      if (!from || !to) return fail(reply, 400, "invalid-argument");
      const owner = folderOwner(scope, user.id);
      await sql.begin(async (tx) => {
        await tx`delete from track_folders where owner_id = ${owner} and scope = ${scope} and name = ${from}`;
        await tx`insert into track_folders (owner_id, scope, name) values (${owner}, ${scope}, ${to}) on conflict do nothing`;
        if (scope === "agency") await tx`update tracks set folder = ${to}, updated_at = now() where scope = 'agency' and folder = ${from}`;
        else await tx`update tracks set folder = ${to}, updated_at = now() where scope = 'personal' and owner_id = ${user.id} and folder = ${from}`;
      });
      return folderLists(user.id);
    });

    // Ведущий предлагает в общую всю папку: все её готовые треки — на проверку владельцу (он принимает их папкой).
    api.post<{ Body: unknown }>("/api/track-folders/share", { bodyLimit: 1024 }, async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      const body = isRecord(request.body) ? request.body : {};
      const name = cleanLine(body.name, FOLDER_MAX);
      if (!name) return fail(reply, 400, "invalid-argument");
      const rows = await sql<TrackRow[]>`${select()} where t.owner_id = ${user.id} and t.scope = 'personal' and t.folder = ${name} and t.sha256 is not null`;
      const ids = rows.filter((t) => permissions.canShareTrack(actorOf(user), ref(t)) && (t.share_status === "none" || t.share_status === "rejected")).map((t) => t.id);
      if (ids.length > 0) await sql`update tracks set share_status = 'pending', share_reason = null, updated_at = now() where id = any(${ids})`;
      request.log.info({ track: "share-folder", count: ids.length }, "track");
      return { shared: ids.length };
    });

    // «Взять папку себе»: общая папка со всеми треками — личной папкой ведущего (тот же файл, место не тратится).
    api.post<{ Body: unknown }>("/api/track-folders/take", { bodyLimit: 1024 }, async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      if (!permissions.canUploadTrack(actorOf(user), "personal")) return fail(reply, 403, "permission-denied");
      const body = isRecord(request.body) ? request.body : {};
      const name = cleanLine(body.name, FOLDER_MAX);
      if (!name) return fail(reply, 400, "invalid-argument");
      const rows = await sql<{ id: string }[]>`select id from tracks where scope = 'agency' and folder = ${name} and sha256 is not null limit ${LIST_LIMIT}`;
      const map = await sql.begin((tx) => takeTracks(tx, rows.map((r) => r.id), user.id, name));
      request.log.info({ track: "take-folder", count: map.size }, "track");
      return folderLists(user.id);
    });

    api.post<{ Body: unknown }>("/api/track-folders/delete", { bodyLimit: 1024 }, async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      const body = isRecord(request.body) ? request.body : {};
      const scope = folderScope(body);
      if (!permissions.canUploadTrack(actorOf(user), scope)) return fail(reply, 403, "permission-denied");
      const name = cleanLine(body.name, FOLDER_MAX);
      if (!name) return fail(reply, 400, "invalid-argument");
      const owner = folderOwner(scope, user.id);
      await sql.begin(async (tx) => {
        await tx`delete from track_folders where owner_id = ${owner} and scope = ${scope} and name = ${name}`;
        if (scope === "agency") await tx`update tracks set folder = '', updated_at = now() where scope = 'agency' and folder = ${name}`;
        else await tx`update tracks set folder = '', updated_at = now() where scope = 'personal' and owner_id = ${user.id} and folder = ${name}`;
      });
      return folderLists(user.id);
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
      // Откуда трек — больше не спрашиваем (решение владельца 11 октября 2026): «другое» без пояснения.
      const existing = await findTrack(id);
      if (existing) return existing.owner_id === user.id ? trackOf(existing) : fail(reply, 409, "already-exists");
      await sql`
        insert into tracks (id, owner_id, scope, title, category, license, license_note, folder)
        values (${id}, ${user.id}, ${scope}, ${title}, ${pick(body.category, TRACK_CATEGORIES, "background")}, ${license}, ${note}, ${cleanLine(body.folder, FOLDER_MAX)})
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
      const clip = body.clip === undefined ? parseTrackClip(track.clip) : parseTrackClip(body.clip);
      // «Откуда трек» — ссылка или пара слов (сайт, канал, купил); хранится в license_note.
      const note = body.licenseNote === undefined ? track.license_note : cleanLine(body.licenseNote, NOTE_MAX);
      // Папка: '' — без папки; переименовать папку — браузер переносит её треки по одному.
      const folder = body.folder === undefined ? (track.folder ?? "") : cleanLine(body.folder, FOLDER_MAX);
      await sql`update tracks set title = ${title}, category = ${category}, clip = ${sql.json(clip as never)}, license_note = ${note}, folder = ${folder}, updated_at = now() where id = ${track.id}`;
      const updated = await findTrack(track.id);
      return updated ? trackOf(updated) : fail(reply, 404, "not-found");
    });

    api.delete<{ Params: { id: string } }>("/api/tracks/:id", { bodyLimit: 1024 }, async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      const track = await findTrack(request.params.id);
      if (!track) return { ok: true };
      if (!permissions.canEditTrack(actorOf(user), ref(track))) return fail(reply, 403, "permission-denied");
      // Файл остаётся, пока на него ссылается другой трек (копия в библиотеке); без ссылок — уберёт уборка.
      await sql.begin(async (tx) => {
        await tx`delete from tracks where id = ${track.id}`;
        // Убрали копию из общей музыки — у исходного трека ведущего снова можно «Предложить в общую».
        await tx`update tracks set share_status = 'none', share_reason = null, library_track_id = null, updated_at = now() where library_track_id = ${track.id}`;
      });
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
        select coalesce(sum(t.size), 0)::text as used from tracks t where t.owner_id = ${track.owner_id} and t.sha256 is not null and t.scope = 'personal'
          and not exists (select 1 from tracks a where a.scope = 'agency' and a.sha256 = t.sha256)`;
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
      // Отдаём частями по запросу браузера (Range): Safari на iPhone иначе не перематывает прослушивание
      // к началу отрезка, а длинный трек играет только после полной загрузки.
      reply.header("Accept-Ranges", "bytes");
      const range = byteRange(request.headers.range, file.length);
      if (range === "invalid") return reply.code(416).header("Content-Range", `bytes */${file.length}`).send();
      if (range) {
        return reply
          .code(206)
          .type(track.mime)
          .header("Content-Range", `bytes ${range.start}-${range.end}/${file.length}`)
          .send(file.subarray(range.start, range.end + 1));
      }
      return reply.type(track.mime).send(file);
    });

    // Ведущий предлагает свой трек в общую. Повтор, пока ждёт, — то же.
    api.post<{ Params: { id: string } }>("/api/tracks/:id/share", { bodyLimit: 1024 }, async (request, reply) => {
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

    api.post<{ Params: { id: string } }>("/api/tracks/:id/accept", { bodyLimit: 1024 }, async (request, reply) => {
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
              duration_ms = ${track.duration_ms}, clip = ${sql.json(parseTrackClip(track.clip) as never)}, updated_at = now()
            where id = ${target}`;
        } else {
          // Трек из папки ведущего — в общую папку с тем же названием (решение владельца 15 октября 2026).
          const folder = track.folder ?? "";
          if (folder) await tx`insert into track_folders (owner_id, scope, name) values ('agency', 'agency', ${folder}) on conflict do nothing`;
          await tx`
            insert into tracks (id, owner_id, scope, title, category, license, license_note, sha256, mime, size, duration_ms, clip, folder)
            values (${target}, ${user.id}, 'agency', ${track.title}, ${track.category}, ${track.license},
                    ${track.license_note}, ${track.sha256}, ${track.mime}, ${track.size}, ${track.duration_ms}, ${sql.json(parseTrackClip(track.clip) as never)}, ${folder})`;
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
