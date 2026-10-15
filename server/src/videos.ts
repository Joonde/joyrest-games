/**
 * Видео JoyRest на сервере (решение владельца 15 октября 2026; CLAUDE.md, раздел 7, «Видео JoyRest»).
 *
 * Загружают владелец и заместитель (`permissions.canUploadVideo`), видят и ставят в игры все, кто работает с играми,
 * файл открывает любой вошедший (экран зала входит устройством). Видео большое, связь на площадке плохая, а Caddy
 * пускает в обычный запрос до 2 МБ — поэтому файл идёт частями (`PUT /api/videos/:id/chunk?offset=N`): сервер пишет
 * часть, только если она ровно там, где кончаются уже полученные байты, и всегда отвечает, сколько у него есть, —
 * повтор после обрыва и дозагрузка после закрытия вкладки идут с этого места. Недописанный файл —
 * MEDIA_DIR/video/<id>.tmp (не попадает в ночную копию restic), целиком — MEDIA_DIR/video/<sha256>. Сервер видео не
 * перекодирует; тип — по первым байтам (MP4/MOV — ftyp, WebM/MKV — EBML).
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, open, readdir, rename, stat, statfs, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import * as permissions from "../../src/data/permissions";
import type { LibraryVideo } from "../../src/data/types";
import { actorOf, apiGuard, identityOf, sessionUser, type SessionRow, uploadGuard } from "./auth";
import { byteRange, cleanLine, FOLDER_MAX } from "./tracks";

export interface VideosOptions {
  sql: Sql;
  /** Папка медиа (в контейнере /app/media); видео — в подпапке video. null — видео недоступно. */
  mediaDir: string | null;
  isSite?: (request: FastifyRequest) => boolean;
  limits?: Partial<VideoLimits>;
  freeBytes?: (dir: string) => Promise<number>;
}

export interface VideoLimits {
  /** Самый большой файл. «Пока любые» (решение владельца) — потолок с запасом, чтобы один файл не съел диск. */
  fileBytes: number;
  /** Часть файла за один запрос (меньше 2 МБ — лимита Caddy). */
  chunkBytes: number;
  /** После загрузки на диске должно остаться не меньше — иначе отказ (507). */
  minFreeBytes: number;
}

export const DEFAULT_VIDEO_LIMITS: VideoLimits = {
  fileBytes: 1024 * 1024 * 1024,
  chunkBytes: 1536 * 1024,
  minFreeBytes: 3 * 1024 * 1024 * 1024,
};

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const TITLE_MAX = 120;
const LIST_LIMIT = 500;
/** Недогруженное видео без новых частей дольше — убирает ночная уборка. */
export const STALE_UPLOAD_DAYS = 3;

interface VideoRow {
  id: string;
  owner_id: string;
  owner_name: string | null;
  title: string;
  folder: string;
  size: string | number;
  received: string | number;
  duration_ms: number | null;
  sha256: string | null;
  mime: string | null;
  created_at: Date;
}

/** Тип видео по первым байтам: MP4 / MOV (ftyp, у MOV — бренд qt) или WebM / MKV (EBML). Иначе null. */
export function videoMime(bytes: Buffer): "video/mp4" | "video/quicktime" | "video/webm" | null {
  if (bytes.length >= 12 && bytes.toString("latin1", 4, 8) === "ftyp") return bytes.toString("latin1", 8, 10) === "qt" ? "video/quicktime" : "video/mp4";
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "video/webm";
  return null;
}

export function videoOf(row: VideoRow): LibraryVideo {
  return {
    id: row.id,
    title: row.title,
    folder: row.folder ?? "",
    ownerId: row.owner_id,
    ownerName: row.owner_name ?? "",
    size: Number(row.size),
    received: Number(row.received),
    ready: row.sha256 !== null,
    durationMs: row.duration_ms,
    mime: row.mime,
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

async function sha256Of(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export function registerVideos(app: FastifyInstance, options: VideosOptions): void {
  const { sql } = options;
  const videoDir = options.mediaDir ? join(options.mediaDir, "video") : null;
  const limits = { ...DEFAULT_VIDEO_LIMITS, ...options.limits };
  const freeBytes = options.freeBytes ?? diskFree;
  const select = () => sql`
    select v.id, v.owner_id, u.name as owner_name, v.title, v.folder, v.size, v.received, v.duration_ms, v.sha256, v.mime, v.created_at
    from videos v left join users u on u.id = v.owner_id`;

  app.register(async (api) => {
    api.addHook("onRequest", apiGuard(options.isSite));
    api.addHook("onRequest", uploadGuard(sql));
    api.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: limits.chunkBytes + 1024 }, (_request, body, done) => done(null, body));

    function fail(reply: FastifyReply, status: number, code: string) {
      return reply.code(status).send({ error: code });
    }

    async function requireUser(request: FastifyRequest, reply: FastifyReply, check: (actor: permissions.Actor) => boolean): Promise<SessionRow | null> {
      const user = await sessionUser(sql, request, reply);
      if (!user) {
        fail(reply, 401, "unauthenticated");
        return null;
      }
      if (!check(actorOf(user))) {
        fail(reply, 403, "permission-denied");
        return null;
      }
      return user;
    }

    async function findVideo(id: string): Promise<VideoRow | null> {
      if (!ID.test(id)) return null;
      const rows = await sql<VideoRow[]>`${select()} where v.id = ${id}`;
      return rows[0] ?? null;
    }

    // Все видео JoyRest: загруженные — всем; недогруженные — тем, кто загружает (дозагрузить или убрать).
    api.get("/api/videos", async (request, reply) => {
      const user = await requireUser(request, reply, permissions.canUseVideos);
      if (!user) return reply;
      const uploader = permissions.canUploadVideo(actorOf(user));
      const rows = await sql<VideoRow[]>`
        ${select()} where v.sha256 is not null or ${uploader} order by v.folder, v.title limit ${LIST_LIMIT}`;
      const [{ used }] = await sql<{ used: string }[]>`
        select coalesce(sum(size), 0)::text as used from (select distinct sha256, size from videos where sha256 is not null) d`;
      return { videos: rows.map(videoOf), usedBytes: Number(used) };
    });

    // Описание видео перед загрузкой файла. id создаёт браузер: повтор — то же видео (дозагрузка).
    api.post<{ Body: unknown }>("/api/videos", { bodyLimit: 4096 }, async (request, reply) => {
      const user = await requireUser(request, reply, permissions.canUploadVideo);
      if (!user) return reply;
      if (!videoDir || !options.mediaDir) return fail(reply, 501, "unimplemented");
      const body = isRecord(request.body) ? request.body : {};
      const id = typeof body.id === "string" && ID.test(body.id) ? body.id : null;
      const title = cleanLine(body.title, TITLE_MAX);
      const size = typeof body.size === "number" && Number.isInteger(body.size) ? body.size : 0;
      if (!id || !title || size <= 0) return fail(reply, 400, "invalid-argument");
      const existing = await findVideo(id);
      if (existing) return Number(existing.size) === size ? videoOf(existing) : fail(reply, 409, "already-exists");
      if (size > limits.fileBytes) return fail(reply, 413, "resource-exhausted");
      if ((await freeBytes(options.mediaDir)) - size < limits.minFreeBytes) {
        request.log.warn("videos: мало места на диске, загрузка отклонена");
        return fail(reply, 507, "resource-exhausted");
      }
      const duration = Number(body.durationMs);
      const durationMs = Number.isInteger(duration) && duration > 0 && duration < 6 * 3600_000 ? duration : null;
      await sql`
        insert into videos (id, owner_id, title, folder, size, duration_ms)
        values (${id}, ${user.id}, ${title}, ${cleanLine(body.folder, FOLDER_MAX)}, ${size}, ${durationMs})
        on conflict (id) do nothing`;
      request.log.info({ video: "create" }, "video");
      const created = await findVideo(id);
      return created ? videoOf(created) : fail(reply, 503, "unavailable");
    });

    // Часть файла. Пишется, только если начинается там, где кончаются полученные байты; ответ — всегда текущее
    // состояние (браузер шлёт следующую часть с `received`). Последняя часть — проверка типа, отпечаток, готово.
    api.put<{ Params: { id: string }; Querystring: { offset?: string }; Body: unknown }>(
      "/api/videos/:id/chunk",
      { bodyLimit: limits.chunkBytes + 1024 },
      async (request, reply) => {
        const user = await requireUser(request, reply, permissions.canUploadVideo);
        if (!user) return reply;
        if (!videoDir || !options.mediaDir) return fail(reply, 501, "unimplemented");
        const bytes = request.body;
        const offset = Number(request.query.offset);
        if (!Buffer.isBuffer(bytes) || bytes.length === 0 || !Number.isInteger(offset) || offset < 0) return fail(reply, 400, "invalid-argument");
        if (!ID.test(request.params.id)) return fail(reply, 404, "not-found");
        await mkdir(videoDir, { recursive: true });
        const outcome = await sql.begin(async (tx) => {
          // Блокировка строки: две части одного видео одновременно не пишутся.
          const rows = await tx<VideoRow[]>`
            select v.id, v.owner_id, null as owner_name, v.title, v.folder, v.size, v.received, v.duration_ms, v.sha256, v.mime, v.created_at
            from videos v where v.id = ${request.params.id} for update`;
          const video = rows[0];
          if (!video) return { error: 404 as const };
          const size = Number(video.size);
          const received = Number(video.received);
          if (video.sha256 || offset !== received) return { ok: true as const };
          if (offset === 0 && !videoMime(bytes)) return { error: 415 as const };
          const part = bytes.subarray(0, size - received);
          const temp = join(videoDir, `${video.id}.tmp`);
          const file = await open(temp, received === 0 ? "w" : "r+", 0o600);
          try {
            await file.write(part, 0, part.length, received);
            await file.truncate(received + part.length);
          } finally {
            await file.close();
          }
          const now = received + part.length;
          if (now < size) {
            await tx`update videos set received = ${now}, updated_at = now() where id = ${video.id}`;
            return { ok: true as const };
          }
          // Файл целиком: тип по первым байтам, отпечаток, на место. Тот же файл уже есть — просто ссылка на него.
          const head = Buffer.alloc(16);
          const reader = await open(temp, "r");
          try {
            await reader.read(head, 0, 16, 0);
          } finally {
            await reader.close();
          }
          const mime = videoMime(head);
          if (!mime) return { error: 415 as const };
          const sha = await sha256Of(temp);
          const target = join(videoDir, sha);
          if (existsSync(target)) await unlink(temp).catch(() => undefined);
          else await rename(temp, target);
          await tx`update videos set received = ${size}, sha256 = ${sha}, mime = ${mime}, updated_at = now() where id = ${video.id}`;
          request.log.info({ video: "upload" }, "video");
          return { ok: true as const };
        });
        if ("error" in outcome) {
          if (outcome.error === 415) {
            // Не видео: недописанное убираем, загрузку можно начать заново с начала.
            await sql`update videos set received = 0, updated_at = now() where id = ${request.params.id} and sha256 is null`;
            await unlink(join(videoDir, `${request.params.id}.tmp`)).catch(() => undefined);
            return fail(reply, 400, "invalid-argument");
          }
          return fail(reply, 404, "not-found");
        }
        const video = await findVideo(request.params.id);
        return video ? videoOf(video) : fail(reply, 404, "not-found");
      },
    );

    api.patch<{ Params: { id: string }; Body: unknown }>("/api/videos/:id", { bodyLimit: 4096 }, async (request, reply) => {
      const user = await requireUser(request, reply, permissions.canUploadVideo);
      if (!user) return reply;
      const video = await findVideo(request.params.id);
      if (!video) return fail(reply, 404, "not-found");
      const body = isRecord(request.body) ? request.body : {};
      const title = body.title === undefined ? video.title : cleanLine(body.title, TITLE_MAX);
      if (!title) return fail(reply, 400, "invalid-argument");
      const folder = body.folder === undefined ? video.folder : cleanLine(body.folder, FOLDER_MAX);
      await sql`update videos set title = ${title}, folder = ${folder}, updated_at = now() where id = ${video.id}`;
      const updated = await findVideo(video.id);
      return updated ? videoOf(updated) : fail(reply, 404, "not-found");
    });

    // Убрать видео: в играх, где оно стоит, экран покажет «видео удалено». Файл без ссылок — ночная уборка.
    api.delete<{ Params: { id: string } }>("/api/videos/:id", { bodyLimit: 1024 }, async (request, reply) => {
      const user = await requireUser(request, reply, permissions.canUploadVideo);
      if (!user) return reply;
      if (!ID.test(request.params.id)) return { ok: true };
      await sql`delete from videos where id = ${request.params.id}`;
      if (videoDir) await unlink(join(videoDir, `${request.params.id}.tmp`)).catch(() => undefined);
      request.log.info({ video: "delete" }, "video");
      return { ok: true };
    });

    // Файл открывает любой вошедший (ведущий, экран зала): id видео есть только в игре и в снимке сессии.
    // Отдаётся частями (Range) с диска потоком — память сервера не занимает, браузер играет, не дожидаясь всего файла.
    api.get<{ Params: { id: string } }>("/api/videos/:id/file", async (request, reply) => {
      const who = await identityOf(sql, request, reply);
      if (!permissions.canViewMedia(who?.uid ?? null)) return fail(reply, 401, "unauthenticated");
      if (!videoDir) return fail(reply, 501, "unimplemented");
      const video = await findVideo(request.params.id);
      if (!video?.sha256 || !video.mime) return fail(reply, 404, "not-found");
      const path = join(videoDir, video.sha256);
      const info = await stat(path).catch(() => null);
      if (!info?.isFile()) return fail(reply, 404, "not-found");
      const etag = `"${video.sha256}"`;
      reply.header("Cache-Control", "private, max-age=31536000, immutable").header("ETag", etag).header("Accept-Ranges", "bytes");
      if (request.headers["if-none-match"] === etag) return reply.code(304).send();
      const range = byteRange(request.headers.range, info.size);
      if (range === "invalid") return reply.code(416).header("Content-Range", `bytes */${info.size}`).send();
      if (range) {
        return reply
          .code(206)
          .type(video.mime)
          .header("Content-Range", `bytes ${range.start}-${range.end}/${info.size}`)
          .header("Content-Length", String(range.end - range.start + 1))
          .send(createReadStream(path, { start: range.start, end: range.end }));
      }
      return reply.type(video.mime).header("Content-Length", String(info.size)).send(createReadStream(path));
    });
  });
}

/**
 * Ночная уборка видео: файлы без ссылок в videos (старше 7 дней — как у картинок), недогруженные видео без новых
 * частей дольше `STALE_UPLOAD_DAYS` (запись и `<id>.tmp`), `.tmp` без записи старше суток.
 */
export async function cleanupVideos(sql: Sql, dir: string, now: number = Date.now()): Promise<number> {
  const videoDir = join(dir, "video");
  const info = await stat(videoDir).catch(() => null);
  if (!info?.isDirectory()) return 0;
  const DAY = 86_400_000;
  await sql`delete from videos where sha256 is null and updated_at < ${new Date(now - STALE_UPLOAD_DAYS * DAY)}`;
  const rows = await sql<{ id: string; sha256: string | null }[]>`select id, sha256 from videos`;
  const files = new Set(rows.map((r) => r.sha256).filter((s): s is string => s !== null));
  const uploading = new Set(rows.filter((r) => r.sha256 === null).map((r) => r.id));
  let removed = 0;
  for (const name of await readdir(videoDir)) {
    const isFile = /^[0-9a-f]{64}$/.test(name);
    const temp = /^([A-Za-z0-9_-]{1,64})\.tmp$/.exec(name);
    if (!isFile && !temp) continue;
    if (isFile && files.has(name)) continue;
    if (temp && uploading.has(temp[1] ?? "")) continue;
    const path = join(videoDir, name);
    const st = await stat(path).catch(() => null);
    if (!st?.isFile()) continue;
    if (now - st.mtimeMs < (isFile ? 7 * DAY : DAY)) continue;
    await unlink(path).catch(() => undefined);
    removed += 1;
  }
  return removed;
}
