/**
 * Перенос из Firebase (PR 5, CLAUDE.md, «Перенос из Firebase»). Данные читает браузер владельца
 * агентства (/admin/import) и пачками пишет сюда. Всё повторяемо: запись по id из Firebase,
 * повторный запуск обновляет и не создаёт дублей. Право — permissions.canImportFromFirebase.
 *
 * Не меняется повтором: владелец (ADMIN_UID — его пароль задаёт `joyrest admin-password`),
 * ведущий, который уже входил на своём сервере (есть пароль), игра, изменённая здесь позже,
 * чем в Firebase. В журнал — только счётчики, без имён и почт.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { ADMIN_UID } from "../../src/data/config";
import * as permissions from "../../src/data/permissions";
import { actorOf, apiGuard, EMAIL_PATTERN, sessionUser } from "./auth";
import { diskFree, dimension, imageMime, parseGameInput, storeMedia } from "./games";

export interface ImportOptions {
  sql: Sql;
  mediaDir: string | null;
  isSite?: (request: FastifyRequest) => boolean;
  minFreeBytes?: number;
  freeBytes?: (dir: string) => Promise<number>;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Документ Firestore — до 1 МБ, пачка игр — до 4 МБ. */
const GAMES_BODY_LIMIT = 4 * 1024 * 1024;
const LIST_BODY_LIMIT = 2 * 1024 * 1024;
const MAX_USERS = 200;
const MAX_GAMES = 50;
const MAX_RESULTS = 200;
const MAX_ITEMS = 5000;
/** Картинки Firebase — до 400 КБ на документ (firestore.rules), оба варианта. */
const IMPORT_MEDIA_MAX = 400 * 1024;
const IMPORT_VARIANTS = new Set(["full", "small"]);
const MIN_FREE = 3 * 1024 * 1024 * 1024;

type Json = Parameters<Sql["json"]>[0];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function list(body: unknown, key: string, max: number): unknown[] | null {
  const value = isRecord(body) ? body[key] : undefined;
  if (value === undefined) return [];
  return Array.isArray(value) && value.length <= max ? value : null;
}

function id(value: unknown): string | null {
  return typeof value === "string" && ID.test(value) ? value : null;
}

function text(value: unknown, max: number, fallback = ""): string {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

/** Дата из Firebase (мс) или null. */
function date(value: unknown): Date | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? new Date(value) : null;
}

function ids(body: unknown, key: string): string[] | null {
  const raw = list(body, key, MAX_ITEMS);
  if (!raw) return null;
  return [...new Set(raw.map(id).filter((v): v is string => v !== null))];
}

interface MediaKey {
  game: string;
  media: string;
  variant?: string;
}

function mediaKeys(body: unknown, key: string): MediaKey[] | null {
  const raw = list(body, key, MAX_ITEMS);
  if (!raw) return null;
  const keys: MediaKey[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const game = id(item.game);
    const media = id(item.media);
    if (!game || !media) continue;
    const variant = typeof item.variant === "string" && IMPORT_VARIANTS.has(item.variant) ? item.variant : undefined;
    keys.push({ game, media, variant });
  }
  return keys;
}

const keyOf = (game: string, media: string, variant: string) => `${game}/${media}/${variant}`;

export function registerImport(app: FastifyInstance, options: ImportOptions): void {
  const { sql, mediaDir } = options;
  const freeBytes = options.freeBytes ?? diskFree;
  const minFreeBytes = options.minFreeBytes ?? MIN_FREE;

  app.register(async (api) => {
    api.addHook("onRequest", apiGuard(options.isSite));
    api.addContentTypeParser(["image/webp", "image/jpeg"], { parseAs: "buffer", bodyLimit: 1024 * 1024 }, (_request, body, done) => done(null, body));

    function fail(reply: FastifyReply, status: number, code: string) {
      return reply.code(status).send({ error: code });
    }

    async function requireOwner(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
      const user = await sessionUser(sql, request, reply);
      if (!user) {
        fail(reply, 401, "unauthenticated");
        return false;
      }
      if (!permissions.canImportFromFirebase(actorOf(user))) {
        fail(reply, 403, "permission-denied");
        return false;
      }
      return true;
    }

    // ------------------------------------------------------------ ведущие

    api.post<{ Body: unknown }>("/api/import/users", { bodyLimit: LIST_BODY_LIMIT }, async (request, reply) => {
      if (!(await requireOwner(request, reply))) return reply;
      const items = list(request.body, "users", MAX_USERS);
      if (!items) return fail(reply, 400, "invalid-argument");
      let saved = 0;
      const skipped: Array<{ id: string; reason: "invalid" | "email-taken" }> = [];
      for (const item of items) {
        if (!isRecord(item)) continue;
        const uid = id(item.uid);
        if (!uid) continue;
        // Владелец уже здесь (вошёл, чтобы перенести): его почту и пароль не трогаем.
        if (uid === ADMIN_UID) {
          saved += 1;
          continue;
        }
        const email = text(item.email, 200).trim().toLowerCase();
        if (!EMAIL_PATTERN.test(email)) {
          skipped.push({ id: uid, reason: "invalid" });
          continue;
        }
        const name = text(item.name, 80).trim() || email;
        const role = item.role === "admin" ? "admin" : "host";
        const active = item.active === true;
        const created = date(item.createdAt) ?? new Date();
        const taken = await sql`select 1 from users where lower(email) = ${email} and id <> ${uid}`;
        if (taken.length > 0) {
          skipped.push({ id: uid, reason: "email-taken" });
          continue;
        }
        try {
          // Ведущий без пароля ещё не входил здесь — его можно обновить из Firebase.
          await sql`
            insert into users (id, email, name, role, active, password_hash, must_change_password, created_at)
            values (${uid}, ${email}, ${name}, ${role}, ${active}, null, false, ${created})
            on conflict (id) do update set email = excluded.email, name = excluded.name, role = excluded.role,
              active = excluded.active, created_at = excluded.created_at, updated_at = now()
            where users.password_hash is null`;
          saved += 1;
        } catch (error) {
          // Почту успели занять между проверкой и записью.
          if ((error as { code?: string }).code !== "23505") throw error;
          skipped.push({ id: uid, reason: "email-taken" });
        }
      }
      request.log.info({ import: "users", saved, skipped: skipped.length }, "import");
      return { saved, skipped };
    });

    // ------------------------------------------------------------ игры

    api.post<{ Body: unknown }>("/api/import/games", { bodyLimit: GAMES_BODY_LIMIT }, async (request, reply) => {
      if (!(await requireOwner(request, reply))) return reply;
      const items = list(request.body, "games", MAX_GAMES);
      if (!items) return fail(reply, 400, "invalid-argument");
      let saved = 0;
      const skipped: string[] = [];
      for (const item of items) {
        const gameId = isRecord(item) ? id(item.id) : null;
        const input = parseGameInput(item);
        if (!gameId || !input || !isRecord(item)) {
          if (gameId) skipped.push(gameId);
          continue;
        }
        const created = date(item.createdAt) ?? date(item.updatedAt) ?? new Date();
        const updated = date(item.updatedAt);
        const content = sql.json(input.content as Json);
        if (updated) {
          // Правка здесь позже, чем в Firebase, — остаётся.
          await sql`
            insert into games (id, scope, owner_id, title, mechanic, theme_id, age_rating, play_mode, content, created_at, updated_at)
            values (${gameId}, ${input.scope}, ${input.ownerId}, ${input.title}, ${input.mechanic}, ${input.themeId},
                    ${input.ageRating}, ${input.playMode}, ${content}, ${created}, ${updated})
            on conflict (id) do update set scope = excluded.scope, owner_id = excluded.owner_id, title = excluded.title,
              mechanic = excluded.mechanic, theme_id = excluded.theme_id, age_rating = excluded.age_rating,
              play_mode = excluded.play_mode, content = excluded.content, created_at = excluded.created_at,
              updated_at = excluded.updated_at
            where games.updated_at <= excluded.updated_at`;
        } else {
          await sql`
            insert into games (id, scope, owner_id, title, mechanic, theme_id, age_rating, play_mode, content, created_at, updated_at)
            values (${gameId}, ${input.scope}, ${input.ownerId}, ${input.title}, ${input.mechanic}, ${input.themeId},
                    ${input.ageRating}, ${input.playMode}, ${content}, ${created}, ${created})
            on conflict (id) do nothing`;
        }
        saved += 1;
      }
      request.log.info({ import: "games", saved, skipped: skipped.length }, "import");
      return { saved, skipped };
    });

    // ------------------------------------------------------------ картинки

    api.post<{ Body: unknown }>("/api/import/media-missing", { bodyLimit: LIST_BODY_LIMIT }, async (request, reply) => {
      if (!(await requireOwner(request, reply))) return reply;
      const items = mediaKeys(request.body, "items");
      if (!items) return fail(reply, 400, "invalid-argument");
      const gameIds = [...new Set(items.map((i) => i.game))];
      if (gameIds.length === 0) return { missing: [] };
      const games = new Set((await sql<{ id: string }[]>`select id from games where id in ${sql(gameIds)}`).map((r) => r.id));
      const have = new Set(
        (await sql<{ game_id: string; media_id: string; variant: string }[]>`
          select game_id, media_id, variant from media where game_id in ${sql(gameIds)}`).map((r) => keyOf(r.game_id, r.media_id, r.variant)),
      );
      const missing: Array<{ game: string; media: string; variant: string }> = [];
      const seen = new Set<string>();
      for (const item of items) {
        // Игры нет здесь (не перенеслась) — картинку некуда привязать.
        if (!games.has(item.game)) continue;
        for (const variant of item.variant ? [item.variant] : ["full", "small"]) {
          const key = keyOf(item.game, item.media, variant);
          if (have.has(key) || seen.has(key)) continue;
          seen.add(key);
          missing.push({ game: item.game, media: item.media, variant });
        }
      }
      return { missing };
    });

    type MediaParams = { Params: { game: string; media: string; variant: string } };

    api.put<MediaParams & { Body: unknown }>("/api/import/media/:game/:media/:variant", async (request, reply) => {
      if (!(await requireOwner(request, reply))) return reply;
      if (!mediaDir) return fail(reply, 501, "unimplemented");
      const { game, media, variant } = request.params;
      if (!id(game) || !id(media) || !IMPORT_VARIANTS.has(variant)) return fail(reply, 400, "invalid-argument");
      const found = await sql`select 1 from games where id = ${game}`;
      if (found.length === 0) return fail(reply, 404, "not-found");
      const bytes = request.body;
      if (!Buffer.isBuffer(bytes)) return fail(reply, 400, "invalid-argument");
      const mime = imageMime(bytes);
      const width = dimension(request.headers["x-width"]);
      const height = dimension(request.headers["x-height"]);
      if (!mime || !width || !height) return fail(reply, 400, "invalid-argument");
      if (bytes.length > IMPORT_MEDIA_MAX) return fail(reply, 413, "resource-exhausted");
      // Лимит места ведущего не проверяем: переносим то, что уже было; свободное место — да.
      const stored = await storeMedia({ sql, mediaDir, freeBytes, minFreeBytes }, { gameId: game, mediaId: media, variant, bytes, mime, width, height });
      if (stored === "conflict") return fail(reply, 409, "already-exists");
      if (stored === "disk-full") {
        request.log.warn("import: мало места на диске");
        return fail(reply, 507, "resource-exhausted");
      }
      return { ok: true };
    });

    // ------------------------------------------------------------ история

    api.post<{ Body: unknown }>("/api/import/results", { bodyLimit: LIST_BODY_LIMIT }, async (request, reply) => {
      if (!(await requireOwner(request, reply))) return reply;
      const items = list(request.body, "results", MAX_RESULTS);
      if (!items) return fail(reply, 400, "invalid-argument");
      let saved = 0;
      for (const item of items) {
        if (!isRecord(item)) continue;
        const resultId = id(item.id);
        const hostId = id(item.hostId);
        if (!resultId || !hostId) continue;
        const board = Array.isArray(item.board)
          ? item.board.filter(isRecord).map((row) => {
              const entry: Record<string, unknown> = { name: text(row.name, 80), score: typeof row.score === "number" && Number.isFinite(row.score) ? row.score : 0 };
              if (typeof row.colorIndex === "number") entry.colorIndex = row.colorIndex;
              return entry;
            })
          : [];
        const count = typeof item.participantsCount === "number" && Number.isInteger(item.participantsCount) && item.participantsCount >= 0 ? item.participantsCount : 0;
        const playedAt = date(item.playedAt);
        await sql`
          insert into results (id, host_id, code, game_title, mechanic, theme_id, play_mode, played_at, participants_count, board, saved_at)
          values (${resultId}, ${hostId}, ${text(item.code, 12)}, ${text(item.gameTitle, 200)},
                  ${typeof item.mechanic === "string" ? item.mechanic.slice(0, 40) : null}, ${text(item.themeId, 40, "joyrest") || "joyrest"},
                  ${item.playMode === "teams" ? "teams" : "solo"}, ${playedAt}, ${count}, ${sql.json(board as Json)}, ${playedAt ?? new Date()})
          on conflict (id) do update set host_id = excluded.host_id, code = excluded.code, game_title = excluded.game_title,
            mechanic = excluded.mechanic, theme_id = excluded.theme_id, play_mode = excluded.play_mode,
            played_at = excluded.played_at, participants_count = excluded.participants_count, board = excluded.board`;
        saved += 1;
      }
      request.log.info({ import: "results", saved }, "import");
      return { saved };
    });

    // ------------------------------------------------------------ сверка

    api.post<{ Body: unknown }>("/api/import/verify", { bodyLimit: LIST_BODY_LIMIT }, async (request, reply) => {
      if (!(await requireOwner(request, reply))) return reply;
      const users = ids(request.body, "users");
      const games = ids(request.body, "games");
      const results = ids(request.body, "results");
      const media = mediaKeys(request.body, "media");
      if (!users || !games || !results || !media) return fail(reply, 400, "invalid-argument");
      const count = async (table: "users" | "games" | "results", list: string[]) =>
        list.length === 0 ? 0 : (await sql`select 1 from ${sql(table)} where id in ${sql(list)}`).length;
      const withoutPassword =
        users.length === 0 ? 0 : (await sql`select 1 from users where id in ${sql(users)} and password_hash is null`).length;
      let mediaFound = 0;
      const gameIds = [...new Set(media.map((m) => m.game))];
      if (gameIds.length > 0) {
        const have = new Set(
          (await sql<{ game_id: string; media_id: string; variant: string }[]>`
            select game_id, media_id, variant from media where game_id in ${sql(gameIds)}`).map((r) => keyOf(r.game_id, r.media_id, r.variant)),
        );
        mediaFound = media.filter((m) => have.has(keyOf(m.game, m.media, m.variant ?? "full"))).length;
      }
      return {
        users: await count("users", users),
        games: await count("games", games),
        results: await count("results", results),
        media: mediaFound,
        withoutPassword,
      };
    });
  });
}
