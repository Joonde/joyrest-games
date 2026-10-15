/**
 * Конец игры (решение владельца 15 октября 2026): после награждения экран зала и телефоны гостей ведут к трём делам —
 * чаевые ведущему (его ссылка из профиля, нет — ссылка владельца агентства), отзыв о вечере и Telegram-канал JoyRest.
 *
 * Отзыв оставляет любой вошедший (телефон гостя — устройство) по завершённой игре; один на телефон и игру, можно
 * исправить. Отзыв хранит название игры, ведущего и дату сам: сессии удаляются через 30 дней, отзывы остаются. Ведущий
 * видит отзывы о своих мероприятиях, владелец — все и отмечает, какие показать на сайте. В журнал — только действие.
 */
import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { ADMIN_UID } from "../../src/data/config";
import * as permissions from "../../src/data/permissions";
import type { Finale, GuestReview, ReviewStatus } from "../../src/data/types";
import { actorOf, apiGuard, identityOf, sessionUser } from "./auth";

export interface FinaleOptions {
  sql: Sql;
  isSite?: (request: FastifyRequest) => boolean;
}

export const REVIEW_TEXT_MAX = 1000;
export const REVIEW_NAME_MAX = 60;
export const TIPS_URL_MAX = 300;
/** Отзывов на одну игру — не больше (защита от накрутки новыми устройствами). */
export const REVIEWS_PER_SESSION = 500;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const STATUSES: readonly ReviewStatus[] = ["new", "published", "hidden"];

/** Ссылка для чаевых: только https, без пробелов; пусто — убрать. null — неверная. */
export function cleanTipsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const url = value.trim();
  if (url === "") return "";
  if (url.length > TIPS_URL_MAX || /\s/.test(url)) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname.includes(".") ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Текст отзыва: без управляющих символов (переводы строк остаются), не длиннее max. */
export function cleanReviewText(value: unknown, max: number, multiline: boolean): string {
  if (typeof value !== "string") return "";
  const text = value.replace(multiline ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, " ");
  return (multiline ? text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n") : text.replace(/\s+/g, " ")).trim().slice(0, max);
}

interface ReviewRow {
  id: string;
  session_id: string;
  host_id: string;
  host_name: string | null;
  game_title: string;
  played_at: Date | null;
  rating: number;
  text: string;
  name: string;
  status: string;
  created_at: Date;
}

function reviewOf(row: ReviewRow): GuestReview {
  return {
    id: row.id,
    sessionId: row.session_id,
    hostId: row.host_id,
    hostName: row.host_name ?? "",
    gameTitle: row.game_title,
    playedAt: row.played_at ? row.played_at.getTime() : null,
    rating: row.rating,
    text: row.text,
    name: row.name,
    status: (STATUSES as readonly string[]).includes(row.status) ? (row.status as ReviewStatus) : "new",
    createdAt: row.created_at.getTime(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function registerFinale(app: FastifyInstance, options: FinaleOptions): void {
  const { sql } = options;

  app.register(async (api) => {
    api.addHook("onRequest", apiGuard(options.isSite));

    function fail(reply: FastifyReply, status: number, code: string) {
      return reply.code(status).send({ error: code });
    }

    /** Ссылка для чаевых ведущего, иначе владельца агентства. */
    async function tipsFor(hostId: string): Promise<string> {
      const rows = await sql<{ id: string; tips_url: string | null }[]>`
        select id, tips_url from users where id in (${hostId}, ${ADMIN_UID}) and active`;
      const own = rows.find((r) => r.id === hostId)?.tips_url;
      return own || rows.find((r) => r.id === ADMIN_UID)?.tips_url || "";
    }

    // Что показать в конце игры: экран зала, телефон гостя, страница отзыва. Любой вошедший.
    api.get<{ Params: { id: string } }>("/api/finale/:id", async (request, reply) => {
      const who = await identityOf(sql, request, reply);
      if (!who) return fail(reply, 401, "unauthenticated");
      if (!ID.test(request.params.id)) return fail(reply, 404, "not-found");
      const [session] = await sql<{ id: string; host_id: string; game_title: string; host_name: string | null }[]>`
        select s.id, s.host_id, s.game_title, u.name as host_name from sessions s left join users u on u.id = s.host_id
        where s.id = ${request.params.id}`;
      if (!session) return fail(reply, 404, "not-found");
      const [mine] = await sql<{ rating: number; text: string; name: string }[]>`
        select rating, text, name from reviews where session_id = ${session.id} and author_uid = ${who.uid}`;
      reply.header("Cache-Control", "no-store");
      const finale: Finale = {
        sessionId: session.id,
        hostName: session.host_name ?? "",
        gameTitle: session.game_title,
        tipsUrl: await tipsFor(session.host_id),
        myReview: mine ? { rating: mine.rating, text: mine.text, name: mine.name } : null,
      };
      return finale;
    });

    // Отзыв гостя о завершённой игре: один на телефон и игру, повтор — правка.
    api.post<{ Body: unknown }>("/api/reviews", { bodyLimit: 8 * 1024 }, async (request, reply) => {
      const who = await identityOf(sql, request, reply);
      if (!who) return fail(reply, 401, "unauthenticated");
      const body = isRecord(request.body) ? request.body : {};
      const sessionId = typeof body.sessionId === "string" && ID.test(body.sessionId) ? body.sessionId : null;
      const rating = typeof body.rating === "number" && Number.isInteger(body.rating) && body.rating >= 1 && body.rating <= 5 ? body.rating : null;
      if (!sessionId || rating === null || body.consent !== true) return fail(reply, 400, "invalid-argument");
      const text = cleanReviewText(body.text, REVIEW_TEXT_MAX, true);
      const name = cleanReviewText(body.name, REVIEW_NAME_MAX, false);
      const [session] = await sql<{ id: string; host_id: string; game_title: string; phase: string; created_at: Date }[]>`
        select id, host_id, game_title, phase, created_at from sessions where id = ${sessionId}`;
      if (!session) return fail(reply, 404, "not-found");
      if (session.phase !== "finished") return fail(reply, 409, "failed-precondition");
      const [{ count }] = await sql<{ count: string }[]>`select count(*)::text as count from reviews where session_id = ${sessionId}`;
      const [existing] = await sql<{ id: string }[]>`select id from reviews where session_id = ${sessionId} and author_uid = ${who.uid}`;
      if (!existing && Number(count) >= REVIEWS_PER_SESSION) return fail(reply, 429, "resource-exhausted");
      // Правка возвращает отзыв на проверку: на сайте показывается только то, что видел владелец.
      await sql`
        insert into reviews (id, session_id, host_id, game_title, played_at, author_uid, rating, text, name)
        values (${randomBytes(12).toString("base64url")}, ${sessionId}, ${session.host_id}, ${session.game_title}, ${session.created_at},
                ${who.uid}, ${rating}, ${text}, ${name})
        on conflict (session_id, author_uid) do update
          set rating = excluded.rating, text = excluded.text, name = excluded.name, status = 'new', updated_at = now()`;
      request.log.info({ review: existing ? "update" : "create" }, "review");
      return { ok: true };
    });

    // Отзывы: ведущему — о своих мероприятиях, владельцу — все.
    api.get("/api/reviews", async (request, reply) => {
      const user = await sessionUser(sql, request, reply);
      if (!user) return fail(reply, 401, "unauthenticated");
      const actor = actorOf(user);
      if (!permissions.canReadReviews(actor, user.id)) return fail(reply, 403, "permission-denied");
      const all = permissions.canModerateReviews(actor);
      const rows = await sql<ReviewRow[]>`
        select r.id, r.session_id, r.host_id, u.name as host_name, r.game_title, r.played_at, r.rating, r.text, r.name, r.status, r.created_at
        from reviews r left join users u on u.id = r.host_id
        where ${all} or r.host_id = ${user.id}
        order by r.created_at desc limit 500`;
      reply.header("Cache-Control", "no-store");
      return rows.map(reviewOf);
    });

    // Владелец: показать на сайте, скрыть, вернуть в новые.
    api.post<{ Params: { id: string }; Body: unknown }>("/api/reviews/:id/status", { bodyLimit: 1024 }, async (request, reply) => {
      const user = await sessionUser(sql, request, reply);
      if (!user) return fail(reply, 401, "unauthenticated");
      if (!permissions.canModerateReviews(actorOf(user))) return fail(reply, 403, "permission-denied");
      const body = isRecord(request.body) ? request.body : {};
      const status = (STATUSES as readonly unknown[]).includes(body.status) ? (body.status as ReviewStatus) : null;
      if (!status || !ID.test(request.params.id)) return fail(reply, 400, "invalid-argument");
      const updated = await sql`update reviews set status = ${status}, updated_at = now() where id = ${request.params.id} returning id`;
      if (updated.length === 0) return fail(reply, 404, "not-found");
      request.log.info({ review: status }, "review");
      return { ok: true, status };
    });

    // Своя ссылка для чаевых (профиль ведущего).
    api.get("/api/me/tips", async (request, reply) => {
      const user = await sessionUser(sql, request, reply);
      if (!user) return fail(reply, 401, "unauthenticated");
      if (!permissions.canSetTips(actorOf(user))) return fail(reply, 403, "permission-denied");
      const [row] = await sql<{ tips_url: string | null }[]>`select tips_url from users where id = ${user.id}`;
      reply.header("Cache-Control", "no-store");
      return { url: row?.tips_url ?? "" };
    });

    api.post<{ Body: unknown }>("/api/me/tips", { bodyLimit: 2048 }, async (request, reply) => {
      const user = await sessionUser(sql, request, reply);
      if (!user) return fail(reply, 401, "unauthenticated");
      if (!permissions.canSetTips(actorOf(user))) return fail(reply, 403, "permission-denied");
      const url = cleanTipsUrl(isRecord(request.body) ? request.body.url : null);
      if (url === null) return fail(reply, 400, "invalid-argument");
      await sql`update users set tips_url = ${url || null}, updated_at = now() where id = ${user.id}`;
      request.log.info({ tips: url ? "set" : "clear" }, "tips");
      return { url };
    });
  });
}
