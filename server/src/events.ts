/**
 * Планировщик мероприятий (CLAUDE.md, раздел 3, «Календарь»; решение владельца 14 октября 2026).
 * Владелец записывает мероприятие (клиент, телефон, дата, время, что за мероприятие, ведущий) — у ведущего
 * это время становится занятым (запись календаря `ev-<id>`, kind booked, без имени и телефона клиента).
 * Ведущий видит только свои мероприятия. Отмена не стирает: мероприятие уходит в «Отменённые».
 * Имена и телефоны клиентов в журнал и Telegram не пишем.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { bookingId, bookingNote, eventSpan, parseEventInput, type EventInput } from "../../src/core/events";
import * as permissions from "../../src/data/permissions";
import type { AgencyEvent } from "../../src/data/types";
import { actorOf, apiGuard, sessionUser, type SessionRow } from "./auth";
import { rangeOf } from "./calendar";

export interface EventsOptions {
  sql: Sql;
  isSite?: (request: FastifyRequest) => boolean;
  now?: () => number;
}

const ID = /^[A-Za-z0-9_-]{1,60}$/;
const LIST_MAX = 300;

interface Row {
  id: string;
  host_id: string;
  host_name: string | null;
  day: string;
  start_min: number;
  end_min: number;
  client_name: string;
  client_phone: string;
  title: string;
  place: string;
  guests: number | null;
  note: string;
  cancelled: boolean;
}

export function eventOf(row: Row): AgencyEvent {
  return {
    id: row.id,
    hostId: row.host_id,
    hostName: row.host_name ?? "",
    day: row.day,
    start: row.start_min,
    end: row.end_min,
    clientName: row.client_name,
    clientPhone: row.client_phone,
    title: row.title,
    place: row.place,
    guests: row.guests,
    note: row.note,
    cancelled: row.cancelled,
  };
}

export function registerEvents(app: FastifyInstance, options: EventsOptions): void {
  const { sql } = options;
  const now = options.now ?? Date.now;

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

    const select = sql`
      select e.id, e.host_id, u.name as host_name, to_char(e.day, 'YYYY-MM-DD') as day, e.start_min, e.end_min,
        e.client_name, e.client_phone, e.title, e.place, e.guests, e.note, (e.cancelled_at is not null) as cancelled
      from events e left join users u on u.id = e.host_id`;

    async function one(id: string): Promise<AgencyEvent | null> {
      const [row] = await sql<Row[]>`${select} where e.id = ${id}`;
      return row ? eventOf(row) : null;
    }

    /** Ведущему — только свои. */
    const own = (user: SessionRow) => (permissions.canManageEvents(actorOf(user)) ? sql`true` : sql`e.host_id = ${user.id}`);
    const canSee = (u: SessionRow) => permissions.canEditOwnCalendar(actorOf(u));

    // За период (день, 7 дней, месяц) или списком: ?scope=upcoming|past|cancelled.
    api.get("/api/events", async (request, reply) => {
      const user = await requireUser(request, reply, canSee);
      if (!user) return reply;
      const q = (request.query ?? {}) as Record<string, unknown>;
      const at = new Date(now());
      if (q.scope === "upcoming") {
        const rows = await sql<Row[]>`${select} where ${own(user)} and e.cancelled_at is null and e.ends_at > ${at}
          order by e.starts_at limit ${LIST_MAX}`;
        return { events: rows.map(eventOf) };
      }
      if (q.scope === "past") {
        const rows = await sql<Row[]>`${select} where ${own(user)} and e.cancelled_at is null and e.ends_at <= ${at}
          order by e.starts_at desc limit ${LIST_MAX}`;
        return { events: rows.map(eventOf) };
      }
      if (q.scope === "cancelled") {
        const rows = await sql<Row[]>`${select} where ${own(user)} and e.cancelled_at is not null
          order by e.starts_at desc limit ${LIST_MAX}`;
        return { events: rows.map(eventOf) };
      }
      const range = rangeOf(q);
      if (!range) return fail(reply, 400, "invalid-argument");
      const rows = await sql<Row[]>`${select} where ${own(user)} and e.day between ${range.from} and ${range.to}
        order by e.day, e.start_min`;
      return { events: rows.map(eventOf) };
    });

    /** Запись календаря ведущего «занят» на время мероприятия (без имени и телефона клиента). */
    async function book(tx: Sql, input: EventInput, by: string) {
      await tx`delete from availability where id = ${bookingId(input.id)} and user_id <> ${input.hostId}`;
      await tx`
        insert into availability (id, user_id, day, start_min, end_min, kind, note, created_by)
        values (${bookingId(input.id)}, ${input.hostId}, ${input.day}, ${input.start}, ${input.end}, 'booked', ${bookingNote(input)}, ${by})
        on conflict (id) do update set day = excluded.day, start_min = excluded.start_min, end_min = excluded.end_min,
          note = excluded.note, updated_at = now()`;
    }

    // Новое мероприятие или правка (id от браузера: повтор — та же запись). Отменённое не правится.
    api.post<{ Body: unknown }>("/api/events", { bodyLimit: 4096 }, async (request, reply) => {
      const user = await requireUser(request, reply, (u) => permissions.canManageEvents(actorOf(u)));
      if (!user) return reply;
      const input = parseEventInput(request.body, now());
      if (!input) return fail(reply, 400, "invalid-argument");
      const span = eventSpan(input);
      if (!span) return fail(reply, 400, "invalid-argument");
      const [host] = await sql<{ active: boolean }[]>`select active from users where id = ${input.hostId}`;
      if (!host?.active) return fail(reply, 404, "not-found");
      const [existing] = await sql<{ cancelled: boolean }[]>`select (cancelled_at is not null) as cancelled from events where id = ${input.id}`;
      if (existing?.cancelled) return fail(reply, 409, "failed-precondition");
      await sql.begin(async (tx) => {
        await tx`
          insert into events (id, host_id, day, start_min, end_min, starts_at, ends_at, client_name, client_phone, title, place, guests, note, created_by)
          values (${input.id}, ${input.hostId}, ${input.day}, ${input.start}, ${input.end}, ${new Date(span.from)}, ${new Date(span.to)},
            ${input.clientName}, ${input.clientPhone}, ${input.title}, ${input.place}, ${input.guests}, ${input.note}, ${user.id})
          on conflict (id) do update set host_id = excluded.host_id, day = excluded.day, start_min = excluded.start_min,
            end_min = excluded.end_min, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
            client_name = excluded.client_name, client_phone = excluded.client_phone, title = excluded.title,
            place = excluded.place, guests = excluded.guests, note = excluded.note, updated_at = now()`;
        await book(tx as unknown as Sql, input, user.id);
      });
      request.log.info({ events: existing ? "edit" : "create" }, "events");
      const saved = await one(input.id);
      return saved ?? fail(reply, 500, "internal");
    });

    // Отменить: мероприятие остаётся в «Отменённых», у ведущего время освобождается. Повтор — успех.
    api.post<{ Params: { id: string } }>("/api/events/:id/cancel", { bodyLimit: 1024 }, async (request, reply) => {
      const user = await requireUser(request, reply, (u) => permissions.canManageEvents(actorOf(u)));
      if (!user) return reply;
      const id = request.params.id;
      if (!ID.test(id)) return fail(reply, 404, "not-found");
      await sql.begin(async (tx) => {
        await tx`update events set cancelled_at = coalesce(cancelled_at, now()), updated_at = now() where id = ${id}`;
        await tx`delete from availability where id = ${bookingId(id)}`;
      });
      const event = await one(id);
      if (!event) return fail(reply, 404, "not-found");
      request.log.info({ events: "cancel" }, "events");
      return event;
    });

    // Вернуть отменённое: время у ведущего снова занято.
    api.post<{ Params: { id: string } }>("/api/events/:id/restore", { bodyLimit: 1024 }, async (request, reply) => {
      const user = await requireUser(request, reply, (u) => permissions.canManageEvents(actorOf(u)));
      if (!user) return reply;
      const id = request.params.id;
      if (!ID.test(id)) return fail(reply, 404, "not-found");
      const event = await one(id);
      if (!event) return fail(reply, 404, "not-found");
      const [host] = await sql<{ active: boolean }[]>`select active from users where id = ${event.hostId}`;
      if (!host?.active) return fail(reply, 409, "failed-precondition");
      await sql.begin(async (tx) => {
        await tx`update events set cancelled_at = null, updated_at = now() where id = ${id}`;
        await book(tx as unknown as Sql, { ...event, id, guests: event.guests }, user.id);
      });
      request.log.info({ events: "restore" }, "events");
      return (await one(id)) ?? fail(reply, 500, "internal");
    });

    // Удалить навсегда — только отменённое (ошибочная запись). Повтор — успех.
    api.delete<{ Params: { id: string } }>("/api/events/:id", { bodyLimit: 1024 }, async (request, reply) => {
      const user = await requireUser(request, reply, (u) => permissions.canManageEvents(actorOf(u)));
      if (!user) return reply;
      const id = request.params.id;
      if (!ID.test(id)) return fail(reply, 404, "not-found");
      const [row] = await sql<{ cancelled: boolean }[]>`select (cancelled_at is not null) as cancelled from events where id = ${id}`;
      if (!row) return { ok: true };
      if (!row.cancelled) return fail(reply, 409, "failed-precondition");
      await sql`delete from events where id = ${id} and cancelled_at is not null`;
      request.log.info({ events: "delete" }, "events");
      return { ok: true };
    });
  });
}
