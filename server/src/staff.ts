/**
 * Квалификация, стаж и баллы ведущих (CLAUDE.md, раздел 3, «Квалификация, стаж и баллы»).
 * Уровень и «опыт с» ставит владелец; баллы за игру начисляет сервер при «Завершить игру»,
 * вручную — владелец с комментарием. Баллы видит только владелец.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { gamePoints, isValidManualPoints } from "../../src/core/points";
import * as permissions from "../../src/data/permissions";
import { actorOf, apiGuard, levelOf, sessionUser, type SessionRow } from "./auth";

export interface StaffOptions {
  sql: Sql;
  isSite?: (request: FastifyRequest) => boolean;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const REASON_MAX = 200;
const HISTORY_LIMIT = 200;

/**
 * Баллы за завершённую игру: не меньше 40 минут от «Начать игру» и больше 10 телефонов
 * (участники-игроки по данным сервера). Одна запись на сессию — повтор ничего не добавит.
 * Возвращает начисленные баллы (0 — игра не засчитана).
 */
export async function awardGamePoints(sql: Sql, sessionId: string, now: number): Promise<number> {
  const [session] = await sql<{ host_id: string; game_title: string; started_at: Date | null }[]>`
    select host_id, game_title, started_at from sessions where id = ${sessionId}`;
  if (!session?.started_at) return 0;
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count from participants where session_id = ${sessionId} and kind = 'player'`;
  const phones = row?.count ?? 0;
  const minutes = Math.floor((now - session.started_at.getTime()) / 60_000);
  const points = gamePoints(phones, minutes);
  if (points <= 0) return 0;
  const reason = `«${session.game_title.slice(0, 80)}»: ${phones} тел., ${minutes} мин`;
  const added = await sql`
    insert into host_points (id, host_id, points, kind, reason, session_id)
    values (${`game-${sessionId}`}, ${session.host_id}, ${points}, 'game', ${reason}, ${sessionId})
    on conflict do nothing returning id`;
  return added.length > 0 ? points : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Комментарий: без управляющих символов, обрезан по краям, до 200 символов. */
export function cleanText(value: unknown, max = REASON_MAX): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

interface PointsRow {
  id: string;
  points: string;
  kind: string;
  reason: string;
  created_at: Date;
}

export function registerStaff(app: FastifyInstance, options: StaffOptions): void {
  const { sql } = options;

  app.register(async (api) => {
    api.addHook("onRequest", apiGuard(options.isSite));

    function fail(reply: FastifyReply, status: number, code: string) {
      return reply.code(status).send({ error: code });
    }

    async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<SessionRow | null> {
      const user = await sessionUser(sql, request, reply);
      if (!user) {
        fail(reply, 401, "unauthenticated");
        return null;
      }
      if (!permissions.canManageHosts(actorOf(user))) {
        fail(reply, 403, "permission-denied");
        return null;
      }
      return user;
    }

    async function hostExists(id: string): Promise<boolean> {
      if (!ID.test(id)) return false;
      return (await sql`select 1 from users where id = ${id}`).length > 0;
    }

    // Квалификация и «опыт с». level: null — снять; experienceSince: "ГГГГ-ММ-ДД" или null — с даты добавления.
    api.post<{ Params: { id: string }; Body: unknown }>("/api/users/:id/level", { bodyLimit: 1024 }, async (request, reply) => {
      if (!(await requireAdmin(request, reply))) return reply;
      const id = request.params.id;
      if (!(await hostExists(id))) return fail(reply, 404, "not-found");
      const body = isRecord(request.body) ? request.body : {};
      const level = body.level === null ? null : levelOf(body.level);
      if (body.level !== null && level === null) return fail(reply, 400, "invalid-argument");
      const raw = body.experienceSince;
      let since: string | null = null;
      if (raw !== null && raw !== undefined) {
        if (typeof raw !== "string" || !DATE.test(raw) || Number.isNaN(Date.parse(raw)) || Date.parse(raw) > Date.now()) {
          return fail(reply, 400, "invalid-argument");
        }
        since = raw;
      }
      await sql`update users set level = ${level}, experience_since = ${since}, updated_at = now() where id = ${id}`;
      request.log.info({ staff: "level" }, "staff");
      return { ok: true };
    });

    api.get<{ Params: { id: string } }>("/api/users/:id/points", async (request, reply) => {
      if (!(await requireAdmin(request, reply))) return reply;
      const id = request.params.id;
      if (!(await hostExists(id))) return fail(reply, 404, "not-found");
      const rows = await sql<PointsRow[]>`
        select id, points::text as points, kind, reason, created_at from host_points
        where host_id = ${id} order by created_at desc limit ${HISTORY_LIMIT}`;
      const [sum] = await sql<{ total: string }[]>`select coalesce(sum(points), 0)::text as total from host_points where host_id = ${id}`;
      return {
        total: Number(sum?.total ?? 0),
        items: rows.map((r) => ({
          id: r.id,
          points: Number(r.points),
          kind: r.kind === "game" ? "game" : "manual",
          reason: r.reason,
          createdAt: r.created_at.getTime(),
        })),
      };
    });

    // Вручную: id от браузера — повтор после обрыва связи не начислит дважды.
    api.post<{ Params: { id: string }; Body: unknown }>("/api/users/:id/points", { bodyLimit: 2048 }, async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return reply;
      const hostId = request.params.id;
      if (!(await hostExists(hostId))) return fail(reply, 404, "not-found");
      const body = isRecord(request.body) ? request.body : {};
      const entryId = typeof body.id === "string" && ID.test(body.id) ? body.id : null;
      const points = typeof body.points === "number" ? body.points : Number.NaN;
      const reason = cleanText(body.reason);
      if (!entryId || !isValidManualPoints(points) || !reason) return fail(reply, 400, "invalid-argument");
      await sql`
        insert into host_points (id, host_id, points, kind, reason, created_by)
        values (${`manual-${entryId}`}, ${hostId}, ${points}, 'manual', ${reason}, ${admin.id})
        on conflict (id) do nothing`;
      request.log.info({ staff: "points" }, "staff");
      return { ok: true };
    });
  });
}
