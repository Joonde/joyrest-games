/**
 * Календарь команды (CLAUDE.md, раздел 3, «Календарь»): каждый активный человек отмечает, когда
 * свободен и занят; владелец видит всех и закрепляет время за человеком («Мероприятие JoyRest»).
 * Проверки времени и дат — общие функции src/core/calendar.ts, права — src/data/permissions.ts.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { cleanNote, dayIndex, dayInWindow, dayOf, isKind, PER_DAY_MAX, RANGE_MAX_DAYS, todayMoscow, validTime } from "../../src/core/calendar";
import { professionOf } from "../../src/core/professions";
import * as permissions from "../../src/data/permissions";
import type { AvailabilityEntry, CalendarMember } from "../../src/data/types";
import { actorOf, apiGuard, sessionUser, type SessionRow } from "./auth";

export interface CalendarOptions {
  sql: Sql;
  isSite?: (request: FastifyRequest) => boolean;
  /** Часы (тесты). */
  now?: () => number;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

interface Row {
  id: string;
  user_id: string;
  day: string;
  start_min: number;
  end_min: number;
  kind: string;
  note: string;
}

export function entryOf(row: Row): AvailabilityEntry {
  return {
    id: row.id,
    uid: row.user_id,
    day: row.day,
    start: row.start_min,
    end: row.end_min,
    kind: isKind(row.kind) ? row.kind : "busy",
    note: row.note,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Окно запроса: from ≤ to, не больше 62 дней; захватываем и прошлый день (вечер за полночь). */
export function rangeOf(query: unknown): { from: string; to: string } | null {
  const q = isRecord(query) ? query : {};
  const from = typeof q.from === "string" ? q.from : "";
  const to = typeof q.to === "string" ? q.to : "";
  const a = dayIndex(from);
  const b = dayIndex(to);
  if (a === null || b === null || b < a || b - a > RANGE_MAX_DAYS) return null;
  return { from: dayOf(a - 1), to };
}

export function registerCalendar(app: FastifyInstance, options: CalendarOptions): void {
  const { sql } = options;
  const now = options.now ?? Date.now;
  const isOwner = (id: string) => permissions.isAdmin({ uid: id, role: "host", active: true });

  app.register(async (api) => {
    api.addHook("onRequest", apiGuard(options.isSite));

    function fail(reply: FastifyReply, status: number, code: string) {
      return reply.code(status).send({ error: code });
    }

    async function requireUser(request: FastifyRequest, reply: FastifyReply, check: (user: SessionRow) => boolean): Promise<SessionRow | null> {
      const user = await sessionUser(sql, request, reply);
      if (!user) {
        fail(reply, 401, "unauthenticated");
        return null;
      }
      if (!check(user)) {
        fail(reply, 403, "permission-denied");
        return null;
      }
      return user;
    }

    const select = sql`select id, user_id, to_char(day, 'YYYY-MM-DD') as day, start_min, end_min, kind, note from availability`;

    /** Проверенная запись из тела запроса (без владельца и вида). */
    function parseBody(body: unknown): { id: string; day: string; start: number; end: number; note: string } | null {
      const b = isRecord(body) ? body : {};
      const id = typeof b.id === "string" && ID.test(b.id) ? b.id : null;
      const day = typeof b.day === "string" ? b.day : "";
      if (!id || !dayInWindow(day, todayMoscow(now())) || !validTime(b.start, b.end)) return null;
      return { id, day, start: b.start as number, end: b.end as number, note: cleanNote(b.note) };
    }

    async function dayFull(uid: string, day: string, id: string): Promise<boolean> {
      const [row] = await sql<{ count: number }[]>`
        select count(*)::int as count from availability where user_id = ${uid} and day = ${day} and id <> ${id}`;
      return (row?.count ?? 0) >= PER_DAY_MAX;
    }

    // Свои записи за период (и записи прошлого дня — вечер за полночь).
    api.get("/api/calendar", async (request, reply) => {
      const user = await requireUser(request, reply, (u) => permissions.canEditOwnCalendar(actorOf(u)));
      if (!user) return reply;
      const range = rangeOf(request.query);
      if (!range) return fail(reply, 400, "invalid-argument");
      const rows = await sql<Row[]>`${select}
        where user_id = ${user.id} and day between ${range.from} and ${range.to} order by day, start_min`;
      return { entries: rows.map(entryOf) };
    });

    // Вся команда за период — только владелец: люди (без почт) и их записи.
    api.get("/api/calendar/team", async (request, reply) => {
      const user = await requireUser(request, reply, (u) => permissions.canViewTeamCalendar(actorOf(u)));
      if (!user) return reply;
      const range = rangeOf(request.query);
      if (!range) return fail(reply, 400, "invalid-argument");
      const people = await sql<{ id: string; name: string; role: string; profession: string | null }[]>`
        select id, name, role, profession from users where active = true order by (role = 'admin') desc, name`;
      const rows = await sql<Row[]>`${select}
        where day between ${range.from} and ${range.to}
          and user_id in (select id from users where active = true)
        order by day, start_min`;
      const members: CalendarMember[] = people.map((p) => ({
        uid: p.id,
        name: p.name,
        profession: professionOf(p.profession),
        owner: isOwner(p.id) || p.role === "admin",
      }));
      return { members, entries: rows.map(entryOf) };
    });

    // Своя отметка «свободен» или «занят». id создаёт браузер: повтор — та же запись (правка).
    api.post<{ Body: unknown }>("/api/calendar", { bodyLimit: 2048 }, async (request, reply) => {
      const user = await requireUser(request, reply, (u) => permissions.canEditOwnCalendar(actorOf(u)));
      if (!user) return reply;
      const input = parseBody(request.body);
      const kind = isRecord(request.body) ? request.body.kind : null;
      if (!input || (kind !== "free" && kind !== "busy")) return fail(reply, 400, "invalid-argument");
      const [existing] = await sql<{ user_id: string; kind: string }[]>`select user_id, kind from availability where id = ${input.id}`;
      if (existing && (existing.user_id !== user.id || existing.kind === "booked")) return fail(reply, 403, "permission-denied");
      if (await dayFull(user.id, input.day, input.id)) return fail(reply, 429, "resource-exhausted");
      const [row] = await sql<Row[]>`
        insert into availability (id, user_id, day, start_min, end_min, kind, note, created_by)
        values (${input.id}, ${user.id}, ${input.day}, ${input.start}, ${input.end}, ${kind}, ${input.note}, ${user.id})
        on conflict (id) do update set day = excluded.day, start_min = excluded.start_min, end_min = excluded.end_min,
          kind = excluded.kind, note = excluded.note, updated_at = now()
        returning id, user_id, to_char(day, 'YYYY-MM-DD') as day, start_min, end_min, kind, note`;
      request.log.info({ calendar: "save" }, "calendar");
      return row ? entryOf(row) : fail(reply, 500, "internal");
    });

    // Владелец закрепляет время за человеком: у того это время становится занятым.
    api.post<{ Body: unknown }>("/api/calendar/book", { bodyLimit: 2048 }, async (request, reply) => {
      const user = await requireUser(request, reply, (u) => permissions.canViewTeamCalendar(actorOf(u)));
      if (!user) return reply;
      const input = parseBody(request.body);
      const uid = isRecord(request.body) && typeof request.body.uid === "string" ? request.body.uid : "";
      if (!input || !ID.test(uid)) return fail(reply, 400, "invalid-argument");
      const [person] = await sql<{ active: boolean }[]>`select active from users where id = ${uid}`;
      if (!person?.active) return fail(reply, 404, "not-found");
      const [existing] = await sql<{ user_id: string; kind: string }[]>`select user_id, kind from availability where id = ${input.id}`;
      if (existing && (existing.user_id !== uid || existing.kind !== "booked")) return fail(reply, 409, "already-exists");
      if (await dayFull(uid, input.day, input.id)) return fail(reply, 429, "resource-exhausted");
      const [row] = await sql<Row[]>`
        insert into availability (id, user_id, day, start_min, end_min, kind, note, created_by)
        values (${input.id}, ${uid}, ${input.day}, ${input.start}, ${input.end}, 'booked', ${input.note}, ${user.id})
        on conflict (id) do update set day = excluded.day, start_min = excluded.start_min, end_min = excluded.end_min,
          note = excluded.note, updated_at = now()
        returning id, user_id, to_char(day, 'YYYY-MM-DD') as day, start_min, end_min, kind, note`;
      request.log.info({ calendar: "book" }, "calendar");
      return row ? entryOf(row) : fail(reply, 500, "internal");
    });

    api.delete<{ Params: { id: string } }>("/api/calendar/:id", { bodyLimit: 1024 }, async (request, reply) => {
      const user = await requireUser(request, reply, (u) => permissions.canEditOwnCalendar(actorOf(u)));
      if (!user) return reply;
      const id = request.params.id;
      if (!ID.test(id)) return fail(reply, 404, "not-found");
      const [existing] = await sql<{ user_id: string; kind: string }[]>`select user_id, kind from availability where id = ${id}`;
      // Уже нет — повтор после обрыва связи: успех.
      if (!existing) return { ok: true };
      if (!permissions.canRemoveCalendarEntry(actorOf(user), { uid: existing.user_id, kind: existing.kind })) {
        return fail(reply, 403, "permission-denied");
      }
      await sql`delete from availability where id = ${id}`;
      request.log.info({ calendar: "remove" }, "calendar");
      return { ok: true };
    });
  });
}
