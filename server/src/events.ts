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
import { dayTitle } from "../../src/core/calendar";
import { actorOf, apiGuard, sessionUser, type SessionRow } from "./auth";
import { rangeOf } from "./calendar";
import { dayIndex as dayIdx, dayOf } from "../../src/core/calendar";
import { upsertClient } from "./clients";
import type { Bot } from "./telegram";

export interface EventsOptions {
  sql: Sql;
  /** Бот уведомлений: ведущему — назначение, изменения, отмена (null — бота нет). */
  bot?: Bot | null;
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
  held: boolean | null;
}

/** Окно итогов: from ≤ to, не больше 370 дней (год с запасом), с прошлым днём (вечер за полночь). */
export function statsRangeOf(query: unknown): { from: string; to: string } | null {
  const q = (typeof query === "object" && query !== null ? query : {}) as Record<string, unknown>;
  const a = dayIdx(typeof q.from === "string" ? q.from : "");
  const b = dayIdx(typeof q.to === "string" ? q.to : "");
  if (a === null || b === null || b < a || b - a > 370) return null;
  return { from: dayOf(a - 1), to: dayOf(b) };
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
    held: row.held,
  };
}

export function registerEvents(app: FastifyInstance, options: EventsOptions): void {
  const { sql } = options;
  const now = options.now ?? Date.now;
  const bot = options.bot ?? null;

  /** Уведомление в Telegram — не задерживает ответ и не ломает запись, если Telegram недоступен. */
  function notice(request: FastifyRequest, kind: Parameters<Bot["eventNotice"]>[0], userId: string, event: AgencyEvent) {
    if (!bot) return;
    const span = eventSpan(event);
    if (!span) return;
    void bot.eventNotice(kind, userId, event, new Date(span.from)).catch(() => request.log.warn({ events: "notice" }, "events: уведомление не отправилось"));
  }

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
        e.client_name, e.client_phone, e.title, e.place, e.guests, e.note, (e.cancelled_at is not null) as cancelled, e.held
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
      // Итоги за квартал и год (только владелец): окно до 370 дней.
      const range = q.stats === "1" && permissions.canViewEventStats(actorOf(user)) ? statsRangeOf(q) : rangeOf(q);
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
      const [existing] = await sql<{ cancelled: boolean; host_id: string; day: string; start_min: number; end_min: number; title: string; guests: number | null }[]>`
        select (cancelled_at is not null) as cancelled, host_id, to_char(day, 'YYYY-MM-DD') as day, start_min, end_min, title, guests
        from events where id = ${input.id}`;
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
      if (!saved) return fail(reply, 500, "internal");
      if (!existing) notice(request, "created", saved.hostId, saved);
      else if (existing.host_id !== saved.hostId) {
        notice(request, "removed", existing.host_id, { ...saved, day: existing.day, start: existing.start_min, end: existing.end_min });
        notice(request, "created", saved.hostId, saved);
      } else if (
        existing.day !== saved.day ||
        existing.start_min !== saved.start ||
        existing.end_min !== saved.end ||
        existing.title !== saved.title ||
        existing.guests !== saved.guests
      ) {
        notice(request, "changed", saved.hostId, saved);
      }
      // Клиент мероприятия — в базу клиентов (по телефону; повтор не дублирует историю).
      if (saved.clientName || saved.clientPhone) {
        void upsertClient(sql, {
          name: saved.clientName,
          phone: saved.clientPhone,
          source: "event",
          summary: `${saved.title || "Мероприятие"}, ${dayTitle(saved.day)}${saved.guests ? `, ${saved.guests} гостей` : ""}`,
          ref: saved.id,
        }).catch(() => request.log.warn({ events: "client" }, "events: клиент не записан"));
      }
      return saved;
    });

    // Отменить: мероприятие остаётся в «Отменённых», у ведущего время освобождается. Повтор — успех.
    api.post<{ Params: { id: string } }>("/api/events/:id/cancel", { bodyLimit: 1024 }, async (request, reply) => {
      const user = await requireUser(request, reply, (u) => permissions.canManageEvents(actorOf(u)));
      if (!user) return reply;
      const id = request.params.id;
      if (!ID.test(id)) return fail(reply, 404, "not-found");
      const before = await one(id);
      await sql.begin(async (tx) => {
        await tx`update events set cancelled_at = coalesce(cancelled_at, now()), updated_at = now() where id = ${id}`;
        await tx`delete from availability where id = ${bookingId(id)}`;
      });
      const event = await one(id);
      if (!event) return fail(reply, 404, "not-found");
      request.log.info({ events: "cancel" }, "events");
      if (before && !before.cancelled) notice(request, "cancelled", event.hostId, event);
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
      const restored = await one(id);
      if (!restored) return fail(reply, 500, "internal");
      if (event.cancelled) notice(request, "created", restored.hostId, restored);
      return restored;
    });

    // «Проведено» / «Не состоялось» (или снять отметку) — после начала мероприятия, владелец или ведущий.
    api.post<{ Params: { id: string }; Body: unknown }>("/api/events/:id/held", { bodyLimit: 1024 }, async (request, reply) => {
      const user = await requireUser(request, reply, canSee);
      if (!user) return reply;
      const id = request.params.id;
      if (!ID.test(id)) return fail(reply, 404, "not-found");
      const body = (typeof request.body === "object" && request.body !== null ? request.body : {}) as Record<string, unknown>;
      const held = body.held === true ? true : body.held === false ? false : body.held === null ? null : undefined;
      if (held === undefined) return fail(reply, 400, "invalid-argument");
      const [row] = await sql<{ host_id: string; started: boolean; cancelled: boolean }[]>`
        select host_id, starts_at <= ${new Date(now())} as started, (cancelled_at is not null) as cancelled from events where id = ${id}`;
      if (!row) return fail(reply, 404, "not-found");
      if (!permissions.canMarkEventHeld(actorOf(user), { hostId: row.host_id })) return fail(reply, 403, "permission-denied");
      if (!row.started || row.cancelled) return fail(reply, 409, "failed-precondition");
      await sql`update events set held = ${held}, held_at = ${held === null ? null : new Date(now())}, held_by = ${held === null ? null : user.id}, updated_at = now()
        where id = ${id}`;
      request.log.info({ events: "held", held }, "events");
      return (await one(id)) ?? fail(reply, 404, "not-found");
    });

    // Удалить навсегда — только отменённое (ошибочная запись), только владелец. Повтор — успех.
    api.delete<{ Params: { id: string } }>("/api/events/:id", { bodyLimit: 1024 }, async (request, reply) => {
      const user = await requireUser(request, reply, (u) => permissions.canDeleteEvent(actorOf(u)));
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
