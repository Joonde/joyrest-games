/**
 * Игры и картинки на своём сервере (PR 3.2, CLAUDE.md, «Платформа на своём сервере»).
 *
 * Права — функции src/data/permissions.ts (те же, что в интерфейсе и в firestore.rules).
 * id игр и картинок создаёт браузер: повтор записи после обрыва связи не создаёт дубль.
 * Картинки — файлы MEDIA_DIR/<sha256> (одинаковая картинка хранится один раз, копия игры
 * ссылается на те же файлы), в базе — таблица media. Сервер картинки не перекодирует:
 * сжимает устройство ведущего, сервер проверяет тип по первым байтам и размер.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rename, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import * as permissions from "../../src/data/permissions";
import type { AgeRating, Game, GameScope, MediaVariant, PlayMode } from "../../src/data/types";
import { actorOf, apiGuard, identityOf, sessionUser, type SessionRow, uploadGuard } from "./auth";

/** Лимиты места (CLAUDE.md, «Медиа»). */
export interface MediaLimits {
  /** Сколько байт картинок на ведущего (по владельцу игр). */
  perHostBytes: number;
  /** Меньше свободного места на диске — загрузка отклоняется. */
  minFreeBytes: number;
}

export const DEFAULT_MEDIA_LIMITS: MediaLimits = { perHostBytes: 500 * 1024 * 1024, minFreeBytes: 3 * 1024 * 1024 * 1024 };

/** Самый большой файл варианта (устройство сжимает до ~380 КБ и ~120 КБ, запас на старые браузеры). */
export const VARIANT_MAX_BYTES: Record<string, number> = { hd: 900 * 1024, full: 400 * 1024, small: 150 * 1024 };

export interface GamesOptions {
  sql: Sql;
  /** Папка картинок (в контейнере /app/media); null — картинки недоступны. */
  mediaDir: string | null;
  isSite?: (request: FastifyRequest) => boolean;
  limits?: Partial<MediaLimits>;
  /** Свободное место на диске с картинками (подменяется в тестах). */
  freeBytes?: (dir: string) => Promise<number>;
}

interface GameRow {
  id: string;
  scope: string;
  owner_id: string;
  title: string;
  mechanic: string;
  theme_id: string;
  age_rating: string;
  play_mode: string;
  content: unknown;
  created_at: Date | null;
  updated_at: Date | null;
}

interface MediaRow {
  sha256: string;
  mime: string;
}

const GAME_COLUMNS = ["id", "scope", "owner_id", "title", "mechanic", "theme_id", "age_rating", "play_mode", "content", "created_at", "updated_at"];
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MEDIA_ID = /^[A-Za-z0-9_-]{1,64}$/;
const VARIANTS = new Set<MediaVariant | "hd">(["hd", "full", "small"]);
const GAME_BODY_LIMIT = 1024 * 1024;
/** Сколько игр в одной вкладке студии (как у Firebase-версии). */
const LIST_LIMIT = 200;

function parseScope(value: unknown): GameScope | null {
  return value === "agency" || value === "personal" ? value : null;
}

function parseAge(value: unknown): AgeRating {
  return value === "12+" || value === "18+" ? value : "0+";
}

function parsePlay(value: unknown): PlayMode {
  return value === "teams" ? "teams" : "solo";
}

export function gameOf(row: GameRow): Game {
  return {
    id: row.id,
    scope: row.scope === "agency" ? "agency" : "personal",
    ownerId: row.owner_id,
    title: row.title,
    mechanic: row.mechanic,
    themeId: row.theme_id,
    ageRating: parseAge(row.age_rating),
    playMode: parsePlay(row.play_mode),
    content: row.content ?? null,
    createdAt: row.created_at ? row.created_at.getTime() : null,
    updatedAt: row.updated_at ? row.updated_at.getTime() : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length <= max ? value : null;
}

/** Игра из тела запроса (создание и копия): без id, дат и лишних полей. */
interface GameInput {
  scope: GameScope;
  ownerId: string;
  title: string;
  mechanic: string;
  themeId: string;
  ageRating: AgeRating;
  playMode: PlayMode;
  content: unknown;
}

export function parseGameInput(value: unknown): GameInput | null {
  if (!isRecord(value)) return null;
  const scope = parseScope(value.scope);
  const ownerId = text(value.ownerId, 64);
  const title = text(value.title, 200);
  const mechanic = text(value.mechanic, 40);
  const themeId = text(value.themeId, 40);
  if (!scope || !ownerId || title === null || !mechanic || !themeId) return null;
  return { scope, ownerId, title, mechanic, themeId, ageRating: parseAge(value.ageRating), playMode: parsePlay(value.playMode), content: value.content ?? null };
}

/** Тип картинки по первым байтам: WebP (RIFF…WEBP) или JPEG (FF D8 FF). Иначе null. */
export function imageMime(bytes: Buffer): "image/webp" | "image/jpeg" | null {
  if (bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

function dimension(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : null;
}

async function diskFree(dir: string): Promise<number> {
  const stats = await statfs(dir);
  return stats.bavail * stats.bsize;
}

export function registerGames(app: FastifyInstance, options: GamesOptions): void {
  const { sql, mediaDir } = options;
  const limits = { ...DEFAULT_MEDIA_LIMITS, ...options.limits };
  const freeBytes = options.freeBytes ?? diskFree;

  app.register(async (api) => {
    api.addHook("onRequest", apiGuard(options.isSite));
    // Большие тела (файлы) — только от вошедшего ведущего и не больше трёх сразу.
    api.addHook("onRequest", uploadGuard(sql));
    // Картинки приходят «как есть» (сжатые на устройстве), без multipart.
    api.addContentTypeParser(["image/webp", "image/jpeg"], { parseAs: "buffer", bodyLimit: 1024 * 1024 }, (_request, body, done) => done(null, body));

    function fail(reply: FastifyReply, status: number, code: string) {
      return reply.code(status).send({ error: code });
    }

    /** Активный ведущий или admin; иначе ответ 401/403 уже отправлен. */
    async function requireHost(request: FastifyRequest, reply: FastifyReply): Promise<SessionRow | null> {
      const user = await sessionUser(sql, request, reply);
      if (!user) {
        fail(reply, 401, "unauthenticated");
        return null;
      }
      if (!permissions.hostsGames(actorOf(user))) {
        fail(reply, 403, "permission-denied");
        return null;
      }
      return user;
    }

    async function findGame(id: string): Promise<GameRow | null> {
      if (!ID.test(id)) return null;
      const rows = await sql<GameRow[]>`select ${sql(GAME_COLUMNS)} from games where id = ${id}`;
      return rows[0] ?? null;
    }

    const ref = (row: GameRow) => ({ scope: row.scope === "agency" ? ("agency" as const) : ("personal" as const), ownerId: row.owner_id });

    // ------------------------------------------------------------ игры

    api.get<{ Querystring: { scope?: string; owner?: string } }>("/api/games", async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      const actor = actorOf(user);
      const scope = parseScope(request.query.scope);
      if (scope === "agency") {
        const rows = await sql<GameRow[]>`select ${sql(GAME_COLUMNS)} from games where scope = 'agency' limit ${LIST_LIMIT}`;
        return rows.map(gameOf);
      }
      const owner = request.query.owner ?? "";
      if (scope !== "personal" || !ID.test(owner)) return fail(reply, 400, "invalid-argument");
      // Личные игры видит владелец и admin (canReadGame).
      if (!permissions.canReadGame(actor, { scope: "personal", ownerId: owner })) return fail(reply, 403, "permission-denied");
      const rows = await sql<GameRow[]>`
        select ${sql(GAME_COLUMNS)} from games where scope = 'personal' and owner_id = ${owner} limit ${LIST_LIMIT}`;
      return rows.map(gameOf);
    });

    api.get<{ Params: { id: string } }>("/api/games/:id", { bodyLimit: 1024 }, async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      const game = await findGame(request.params.id);
      if (!game) return fail(reply, 404, "not-found");
      if (!permissions.canReadGame(actorOf(user), ref(game))) return fail(reply, 403, "permission-denied");
      return gameOf(game);
    });

    api.post<{ Body: unknown }>("/api/games", { bodyLimit: GAME_BODY_LIMIT }, async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      const body = request.body;
      const id = isRecord(body) ? text(body.id, 64) : null;
      const input = parseGameInput(body);
      if (!id || !ID.test(id) || !input) return fail(reply, 400, "invalid-argument");
      if (!permissions.canCreateGame(actorOf(user), input.scope, input.ownerId)) return fail(reply, 403, "permission-denied");
      const created = await sql`
        insert into games (id, scope, owner_id, title, mechanic, theme_id, age_rating, play_mode, content)
        values (${id}, ${input.scope}, ${input.ownerId}, ${input.title}, ${input.mechanic}, ${input.themeId},
                ${input.ageRating}, ${input.playMode}, ${sql.json(input.content as Parameters<typeof sql.json>[0])})
        on conflict (id) do nothing returning id`;
      if (created.length === 0) {
        // Повтор после обрыва связи — та же игра того же владельца; иначе id занят.
        const existing = await findGame(id);
        if (!existing || existing.owner_id !== input.ownerId || existing.scope !== input.scope) return fail(reply, 409, "already-exists");
      }
      return { id };
    });

    api.post<{ Params: { id: string }; Body: unknown }>("/api/games/:id/copy", { bodyLimit: GAME_BODY_LIMIT }, async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      const actor = actorOf(user);
      const id = request.params.id;
      const body = isRecord(request.body) ? request.body : {};
      const input = parseGameInput(body.game);
      const sourceId = text(body.sourceId, 64);
      const mediaIds = Array.isArray(body.mediaIds) ? [...new Set(body.mediaIds.filter((m): m is string => typeof m === "string" && MEDIA_ID.test(m)))] : [];
      if (!ID.test(id) || !input || !sourceId) return fail(reply, 400, "invalid-argument");
      const source = await findGame(sourceId);
      if (!source) return fail(reply, 404, "not-found");
      if (!permissions.canReadGame(actor, ref(source)) || !permissions.canCreateGame(actor, input.scope, input.ownerId)) {
        return fail(reply, 403, "permission-denied");
      }
      const done = await sql.begin(async (tx) => {
        const created = await tx`
          insert into games (id, scope, owner_id, title, mechanic, theme_id, age_rating, play_mode, content)
          values (${id}, ${input.scope}, ${input.ownerId}, ${input.title}, ${input.mechanic}, ${input.themeId},
                  ${input.ageRating}, ${input.playMode}, ${tx.json(input.content as Parameters<typeof tx.json>[0])})
          on conflict (id) do nothing returning id`;
        if (created.length === 0) return false;
        // Картинки копии — те же файлы: копируются только ссылки.
        if (mediaIds.length > 0) {
          await tx`
            insert into media (game_id, media_id, variant, sha256, mime, width, height, size)
            select ${id}, media_id, variant, sha256, mime, width, height, size from media
            where game_id = ${sourceId} and media_id in ${tx(mediaIds)}`;
        }
        return true;
      });
      if (!done) {
        const existing = await findGame(id);
        if (!existing || existing.owner_id !== input.ownerId) return fail(reply, 409, "already-exists");
      }
      return { id };
    });

    api.patch<{ Params: { id: string }; Body: unknown }>("/api/games/:id", { bodyLimit: GAME_BODY_LIMIT }, async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      const game = await findGame(request.params.id);
      if (!game) return fail(reply, 404, "not-found");
      if (!permissions.canEditGame(actorOf(user), ref(game))) return fail(reply, 403, "permission-denied");
      const patch = isRecord(request.body) ? request.body : null;
      if (!patch) return fail(reply, 400, "invalid-argument");
      // Область и владелец не меняются (GamePatch).
      const title = patch.title === undefined ? undefined : text(patch.title, 200);
      const themeId = patch.themeId === undefined ? undefined : text(patch.themeId, 40);
      if (title === null || themeId === null) return fail(reply, 400, "invalid-argument");
      await sql.begin(async (tx) => {
        if (title !== undefined) await tx`update games set title = ${title} where id = ${game.id}`;
        if (themeId !== undefined) await tx`update games set theme_id = ${themeId} where id = ${game.id}`;
        if (patch.ageRating !== undefined) await tx`update games set age_rating = ${parseAge(patch.ageRating)} where id = ${game.id}`;
        if (patch.playMode !== undefined) await tx`update games set play_mode = ${parsePlay(patch.playMode)} where id = ${game.id}`;
        if ("content" in patch) {
          await tx`update games set content = ${tx.json((patch.content ?? null) as Parameters<typeof tx.json>[0])} where id = ${game.id}`;
        }
        await tx`update games set updated_at = now() where id = ${game.id}`;
      });
      return { ok: true };
    });

    api.delete<{ Params: { id: string } }>("/api/games/:id", async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      const game = await findGame(request.params.id);
      if (!game) return { ok: true };
      if (!permissions.canDeleteGame(actorOf(user), ref(game))) return fail(reply, 403, "permission-denied");
      await sql.begin(async (tx) => {
        await tx`delete from media where game_id = ${game.id}`;
        await tx`delete from games where id = ${game.id}`;
      });
      return { ok: true };
    });

    // ------------------------------------------------------------ картинки

    type MediaParams = { Params: { game: string; media: string; variant: string } };

    api.put<MediaParams & { Body: unknown }>("/api/media/:game/:media/:variant", async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      if (!mediaDir) return fail(reply, 501, "unimplemented");
      const { media, variant } = request.params;
      if (!MEDIA_ID.test(media) || !VARIANTS.has(variant as MediaVariant)) return fail(reply, 400, "invalid-argument");
      const game = await findGame(request.params.game);
      if (!game) return fail(reply, 404, "not-found");
      if (!permissions.canChangeMedia(actorOf(user), ref(game))) return fail(reply, 403, "permission-denied");

      const bytes = request.body;
      if (!Buffer.isBuffer(bytes)) return fail(reply, 400, "invalid-argument");
      const mime = imageMime(bytes);
      const width = dimension(request.headers["x-width"]);
      const height = dimension(request.headers["x-height"]);
      if (!mime || !width || !height) return fail(reply, 400, "invalid-argument");
      if (bytes.length > (VARIANT_MAX_BYTES[variant] ?? 0)) return fail(reply, 413, "resource-exhausted");

      const sha = createHash("sha256").update(bytes).digest("hex");
      const existing = await sql<MediaRow[]>`
        select sha256, mime from media where game_id = ${game.id} and media_id = ${media} and variant = ${variant}`;
      // Картинку по id не перезаписать: повтор той же — успех, другая — ошибка.
      if (existing[0]) return existing[0].sha256 === sha ? { ok: true } : fail(reply, 409, "already-exists");

      if ((await freeBytes(mediaDir)) < limits.minFreeBytes) {
        request.log.warn("media: мало места на диске, загрузка отклонена");
        return fail(reply, 507, "resource-exhausted");
      }
      const [{ used }] = await sql<{ used: string }[]>`
        select coalesce(sum(m.size), 0)::text as used from media m join games g on g.id = m.game_id where g.owner_id = ${game.owner_id}`;
      if (Number(used) + bytes.length > limits.perHostBytes) return fail(reply, 413, "resource-exhausted");

      const path = join(mediaDir, sha);
      if (!existsSync(path)) {
        // Сначала во временный файл, потом переименование: читатель не увидит половину файла.
        const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
        await writeFile(temp, bytes, { mode: 0o600 });
        await rename(temp, path);
      }
      await sql`
        insert into media (game_id, media_id, variant, sha256, mime, width, height, size)
        values (${game.id}, ${media}, ${variant}, ${sha}, ${mime}, ${width}, ${height}, ${bytes.length})
        on conflict (game_id, media_id, variant) do nothing`;
      return { ok: true };
    });

    api.get<MediaParams>("/api/media/:game/:media/:variant", async (request, reply) => {
      // Картинку по id открывает любой вошедший — ведущий, экран зала, телефон гостя
      // (permissions.canViewMedia): id есть только в игре и снимке сессии, его не угадать.
      const who = await identityOf(sql, request, reply);
      if (!permissions.canViewMedia(who?.uid ?? null)) return fail(reply, 401, "unauthenticated");
      if (!mediaDir) return fail(reply, 501, "unimplemented");
      const { media, variant } = request.params;
      if (!MEDIA_ID.test(media) || !VARIANTS.has(variant as MediaVariant)) return fail(reply, 400, "invalid-argument");
      const game = await findGame(request.params.game);
      if (!game) return fail(reply, 404, "not-found");
      const rows = await sql<MediaRow[]>`
        select sha256, mime from media where game_id = ${game.id} and media_id = ${media} and variant = ${variant}`;
      const row = rows[0];
      if (!row) return fail(reply, 404, "not-found");
      const etag = `"${row.sha256}"`;
      reply.header("Cache-Control", "private, max-age=31536000, immutable").header("ETag", etag);
      if (request.headers["if-none-match"] === etag) return reply.code(304).send();
      let file: Buffer;
      try {
        file = await readFile(join(mediaDir, row.sha256));
      } catch {
        reply.header("Cache-Control", "no-store");
        return fail(reply, 404, "not-found");
      }
      return reply.type(row.mime).send(file);
    });

    api.delete<{ Params: { game: string; media: string } }>("/api/media/:game/:media", { bodyLimit: 1024 }, async (request, reply) => {
      const user = await requireHost(request, reply);
      if (!user) return reply;
      const game = await findGame(request.params.game);
      if (!game) return { ok: true };
      if (!permissions.canChangeMedia(actorOf(user), ref(game))) return fail(reply, 403, "permission-denied");
      // Файл остаётся: на него могут ссылаться копии игры; без ссылок его уберёт ночная уборка.
      await sql`delete from media where game_id = ${game.id} and media_id = ${request.params.media}`;
      return { ok: true };
    });
  });
}
