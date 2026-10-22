/**
 * Рисунки гостей для «Аквариума и Ёлки» (решение владельца 18 октября 2026): гость раскрашивает рыбку или игрушку на
 * телефоне, телефон присылает картинку раскраски (WebP или JPEG, ≤ 60 КБ — меньше порога больших загрузок, поэтому
 * присылать может и устройство гостя). Сервер не перекодирует, тип — по первым байтам. Файлы — MEDIA_DIR/drawings/<sha256>,
 * открывает любой вошедший (экран зала входит устройством), адрес — по отпечатку, его не угадать. Пульт ставит рисунок на
 * экран записью `state.result.items`; файлы без ссылок в сессиях убирает ночная уборка. Принимаем только в игру
 * «Аквариум и Ёлка» (в вечере из блоков — пока идёт её блок: у сессии механика блока) и только при свободном месте на
 * диске не меньше 3 ГБ, как картинки, музыка и показы (иначе 507).
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { apiGuard, identityOf } from "./auth";
import { imageMime } from "./games";
import { WindowLimiter } from "./lead";

export interface DrawingsOptions {
  sql: Sql;
  mediaDir: string | null;
  isSite?: (request: FastifyRequest) => boolean;
  now?: () => number;
  /** Свободное место на диске (тесты подменяют). */
  freeBytes?: (dir: string) => Promise<number>;
  /** Меньше — новые рисунки не принимаем (507), как у картинок, музыки и показов. */
  minFreeBytes?: number;
}

/** Механика, в которую принимаем рисунки. */
export const DRAWINGS_MECHANIC = "aquarium";
const MIN_FREE_BYTES = 3 * 1024 ** 3;

async function diskFree(dir: string): Promise<number> {
  const stats = await statfs(dir);
  return stats.bavail * stats.bsize;
}

/** Самый большой рисунок: меньше `LARGE_BODY_BYTES`, чтобы гость мог прислать его без входа ведущего. */
export const DRAWING_MAX_BYTES = 60 * 1024;
/** С одного телефона за 10 минут. */
export const DRAWINGS_PER_DEVICE = 20;
/** На одну игру за час. */
export const DRAWINGS_PER_SESSION = 800;

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const SHA = /^[0-9a-f]{64}$/;

export function registerDrawings(app: FastifyInstance, options: DrawingsOptions): void {
  const { sql } = options;
  const now = options.now ?? Date.now;
  const dir = options.mediaDir ? join(options.mediaDir, "drawings") : null;
  const perDevice = new WindowLimiter(DRAWINGS_PER_DEVICE, 10 * 60_000);
  const perSession = new WindowLimiter(DRAWINGS_PER_SESSION, 60 * 60_000);
  const freeBytes = options.freeBytes ?? diskFree;
  const minFree = options.minFreeBytes ?? MIN_FREE_BYTES;

  app.register(async (api) => {
    api.addHook("onRequest", apiGuard(options.isSite));
    api.addContentTypeParser(["image/webp", "image/jpeg"], { parseAs: "buffer", bodyLimit: DRAWING_MAX_BYTES + 1024 }, (_request, body, done) => done(null, body));

    function fail(reply: FastifyReply, status: number, code: string) {
      return reply.code(status).send({ error: code });
    }

    // Рисунок гостя (или ведущего этой игры) — в идущую игру.
    api.put<{ Params: { id: string }; Body: unknown }>("/api/sessions/:id/drawings", { bodyLimit: DRAWING_MAX_BYTES + 1024 }, async (request, reply) => {
      const who = await identityOf(sql, request, reply);
      if (!who) return fail(reply, 401, "unauthenticated");
      if (!dir) return fail(reply, 501, "unimplemented");
      if (!ID.test(request.params.id)) return fail(reply, 404, "not-found");
      const [session] = await sql<{ id: string; host_id: string; phase: string | null; mechanic: string | null }[]>`
        select id, host_id, state->>'phase' as phase, mechanic from sessions where id = ${request.params.id}`;
      if (!session) return fail(reply, 404, "not-found");
      if (session.phase !== "lobby" && session.phase !== "playing") return fail(reply, 409, "failed-precondition");
      // Только «Аквариум и Ёлка» (в вечере из блоков у сессии механика текущего блока).
      if (session.mechanic !== DRAWINGS_MECHANIC) return fail(reply, 409, "failed-precondition");
      if (session.host_id !== who.uid) {
        const [member] = await sql<{ id: string }[]>`select id from participants where session_id = ${session.id} and id = ${who.uid}`;
        if (!member) return fail(reply, 403, "permission-denied");
      }
      const bytes = request.body;
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) return fail(reply, 400, "invalid-argument");
      if (bytes.length > DRAWING_MAX_BYTES) return fail(reply, 413, "resource-exhausted");
      const mime = imageMime(bytes);
      if (!mime) return fail(reply, 400, "invalid-argument");
      const time = now();
      if (!perDevice.allowed(who.uid, time) || !perSession.allowed(session.id, time)) return fail(reply, 429, "resource-exhausted");
      perDevice.take(who.uid, time);
      perSession.take(session.id, time);
      const sha = createHash("sha256").update(bytes).digest("hex");
      await mkdir(dir, { recursive: true });
      const path = join(dir, sha);
      if (!existsSync(path)) {
        if ((await freeBytes(dir)) < minFree) {
          request.log.warn("drawings: мало места на диске, рисунок отклонён");
          return fail(reply, 507, "resource-exhausted");
        }
        const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
        await writeFile(temp, bytes, { mode: 0o600 });
        await rename(temp, path);
      }
      request.log.info({ drawing: "save" }, "drawing");
      return { sha };
    });

    // Файл рисунка — любому вошедшему (экран зала, пульт, телефон автора).
    api.get<{ Params: { sha: string } }>("/api/drawings/:sha", async (request, reply) => {
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

/** Рисунки, что стоят на экране в сессиях (остальные убирает ночная уборка). */
export async function drawingsInUse(sql: Sql): Promise<Set<string>> {
  const rows = await sql<{ sha: string | null }[]>`
    select i->>'sha' as sha from sessions s, jsonb_array_elements(
      case when jsonb_typeof(s.state->'result'->'items') = 'array' then s.state->'result'->'items' else '[]'::jsonb end) i`;
  return new Set(rows.flatMap((r) => (r.sha ? [r.sha] : [])));
}
