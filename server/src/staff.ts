/**
 * Квалификация, стаж и баллы ведущих (CLAUDE.md, раздел 3, «Квалификация, стаж и баллы»).
 * Уровень и «опыт с» ставит владелец; баллы за игру начисляет сервер при «Завершить игру»,
 * вручную — владелец с комментарием. Баллы видит только владелец.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { gamePoints, isValidManualPoints, MIN_ANSWERED_STEPS, MIN_PLAYED_ROUNDS, roomGamePoints } from "../../src/core/points";
import * as permissions from "../../src/data/permissions";
import { actorOf, apiGuard, levelOf, sessionUser, type SessionRow } from "./auth";
import { parseSnapshotData, type RoomGame } from "./rooms/engine";
import { roomGames } from "./rooms/registry";

/** Игры игровой комнаты (с проверочной `room-check`): баллы — по раундам, а не по ответам. */
const ROOM_GAMES: ReadonlyMap<string, RoomGame<unknown>> = roomGames({ check: true });

/**
 * Сыграна ли игра комнаты до конца — по её последнему снимку в базе (сервер, не браузер). «Завершить игру» перед этим просит
 * комнату записать снимок (`Hub.flush`). Снимка нет или он не читается — «нет».
 */
async function roomPlayedToEnd(sql: Sql, sessionId: string, game: RoomGame<unknown>): Promise<boolean> {
  if (!game.playedToEnd) return false;
  const [row] = await sql<{ data: unknown }[]>`select data from room_snapshots where session_id = ${sessionId}`;
  const data = parseSnapshotData(row?.data);
  if (!data || data.game !== game.id) return false;
  try {
    const state = game.restore(data.state);
    return state !== null && game.playedToEnd(state);
  } catch {
    return false;
  }
}

export interface StaffOptions {
  sql: Sql;
  isSite?: (request: FastifyRequest) => boolean;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const REASON_MAX = 200;
const HISTORY_LIMIT = 200;

/**
 * Баллы за завершённую игру: не меньше 40 минут от «Начать игру» и больше 10 телефонов (участники-игроки по данным сервера).
 * Телефон засчитывается, если играл: в играх шагами — ответил хотя бы на 3 вопроса (сам или его команда); в играх игровой
 * комнаты (`roomGames`: «Бубликатор») — игра приняла его действия хотя бы в 2 разных раундах (`room_play`). У игры комнаты,
 * которая знает «сыграна до конца» (`RoomGame.playedToEnd`), вместо 40 минут — игра сыграна до конца: все перелёты и пьедестал,
 * по снимку комнаты на сервере (решение владельца 13 ноября 2026). Одна запись на сессию — повтор ничего не добавит.
 * Возвращает начисленные баллы (0 — игра не засчитана).
 */
export async function awardGamePoints(sql: Sql, sessionId: string, now: number, games: ReadonlyMap<string, RoomGame<unknown>> = ROOM_GAMES): Promise<number> {
  const [session] = await sql<{ host_id: string; game_title: string; started_at: Date | null; mechanic: string | null }[]>`
    select host_id, game_title, started_at, mechanic from sessions where id = ${sessionId}`;
  if (!session) return 0;
  const game = session.mechanic !== null ? games.get(session.mechanic) : undefined;
  const room = game !== undefined;
  const toEnd = game?.playedToEnd !== undefined;
  // Игры без «сыграна до конца» — от «Начать игру», как раньше.
  if (!toEnd && !session.started_at) return 0;
  // Пустые подключения скриптом баллы не дают: телефон должен был играть.
  const [row] = room
    ? await sql<{ count: number }[]>`
        with played as (
          select pid from room_play where session_id = ${sessionId}
          group by pid having count(distinct unit) >= ${MIN_PLAYED_ROUNDS}
        )
        select count(*)::int as count from participants p
        where p.session_id = ${sessionId} and p.kind = 'player' and p.id in (select pid from played)`
    : await sql<{ count: number }[]>`
        with active as (
          select pid from answers where session_id = ${sessionId}
          group by pid having count(distinct step) >= ${MIN_ANSWERED_STEPS}
        )
        select count(*)::int as count from participants p
        where p.session_id = ${sessionId} and p.kind = 'player'
          and (p.id in (select pid from active) or p.team_id in (select pid from active))`;
  const phones = row?.count ?? 0;
  const minutes = session.started_at ? Math.floor((now - session.started_at.getTime()) / 60_000) : 0;
  const points = toEnd && game ? roomGamePoints(phones, await roomPlayedToEnd(sql, sessionId, game)) : gamePoints(phones, minutes);
  if (points <= 0) return 0;
  const reason = toEnd ? `«${session.game_title.slice(0, 80)}»: ${phones} тел., сыграна до конца` : `«${session.game_title.slice(0, 80)}»: ${phones} тел., ${minutes} мин`;
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
      // Дата без времени — полночь UTC: «сегодня» по Москве ночью для сервера ещё «завтра», поэтому запас в сутки.
      let since: string | null = null;
      if (raw !== null && raw !== undefined) {
        if (typeof raw !== "string" || !DATE.test(raw) || Number.isNaN(Date.parse(raw)) || Date.parse(raw) > Date.now() + 86_400_000) {
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
