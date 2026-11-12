/**
 * Планировщик мероприятий (CLAUDE.md, раздел 3, «Календарь»; решение владельца 14 октября 2026).
 * Владелец записывает мероприятие (клиент, телефон, дата, время, что за мероприятие, ведущий) — у ведущего
 * это время становится занятым (запись календаря `ev-<id>`, kind booked, без имени и телефона клиента).
 * Ведущий видит только свои мероприятия. Отмена не стирает: мероприятие уходит в «Отменённые».
 * Имена и телефоны клиентов в журнал и Telegram не пишем.
 */
import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { bookingId, bookingNote, contactLinks, eventLink, eventSpan, parseContact, parseEventInput, type EventInput } from "../../src/core/events";
import { PREPAY_RUB, prepaidOwnerText, refundOpen, refundOwnerText, rub } from "../../src/core/prepay";
import { cleanProgram, sameProgram } from "../../src/core/eventProgram";
import * as permissions from "../../src/data/permissions";
import type { AgencyEvent } from "../../src/data/types";
import { addDays, availabilityOf, dayTitle, rangeLabel } from "../../src/core/calendar";
import { icsCalendar, icsFileName } from "../../src/core/ics";
import { actorOf, apiGuard, sessionUser, type SessionRow, type UserRow } from "./auth";
import { rangeOf } from "./calendar";
import { dayIndex as dayIdx, dayOf } from "../../src/core/calendar";
import { changeStatus, upsertClient, type ClientInput } from "./clients";

/** Паузы перед попытками записать клиента мероприятия в базу: сразу, через 0,3 с и через 1 с. */
const CLIENT_RETRY_MS = [0, 300, 1000];
import { phoneKey, phoneKeyVariants } from "../../src/core/clients";
import type { Bot } from "./telegram";
import { recordHostNotice } from "./notices";

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
  /** Ведущий отключён владельцем (false) — мероприятие надо передать другому. В запросах без этого поля — нет. */
  host_active?: boolean | null;
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
  updated_at?: Date | null;
  program?: unknown;
  accepted_at?: Date | null;
  accept_rev?: number;
  client_contact?: string;
  live?: boolean;
  price?: number | null;
  prepaid_at?: Date | null;
  prepaid_by_name?: string | null;
  refund_at?: Date | null;
  refund_by_name?: string | null;
  refund_done_at?: Date | null;
  owner_id?: string | null;
  owner_name?: string | null;
  declined_at?: Date | null;
  declined_reason?: string | null;
  rest_paid?: string | null;
  rest_amount?: number | null;
  called_at?: Date | null;
  called_by_name?: string | null;
  review?: string | null;
  overtime_paid?: number | null;
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
    clientContact: row.client_contact ?? "",
    title: row.title,
    place: row.place,
    guests: row.guests,
    note: row.note,
    cancelled: row.cancelled,
    held: row.held,
    updatedAt: row.updated_at ? row.updated_at.getTime() : 0,
    program: cleanProgram(row.program),
    acceptedAt: row.accepted_at ? row.accepted_at.getTime() : null,
    acceptRev: row.accept_rev ?? 0,
    live: row.live === true,
    ...(row.host_active === false ? { hostOff: true } : {}),
    // Предоплата (12 ноября 2026): поля есть только у мероприятий со стоимостью или отметками.
    ...(row.price != null ? { price: row.price } : {}),
    ...(row.prepaid_at ? { prepaidAt: row.prepaid_at.getTime(), ...(row.prepaid_by_name ? { prepaidBy: row.prepaid_by_name } : {}) } : {}),
    ...(row.refund_at ? { refundAt: row.refund_at.getTime(), ...(row.refund_by_name ? { refundBy: row.refund_by_name } : {}) } : {}),
    ...(row.refund_done_at ? { refundDoneAt: row.refund_done_at.getTime() } : {}),
    // Кто ведёт заявку (12 ноября 2026): только действующий человек — отключённый никого не держит.
    ...(row.owner_id && row.owner_name ? { ownerId: row.owner_id, ownerName: row.owner_name } : {}),
    ...(row.declined_at ? { declinedAt: row.declined_at.getTime(), declinedReason: row.declined_reason ?? "" } : {}),
    ...(row.rest_paid === "yes" || row.rest_paid === "no" || row.rest_paid === "part" ? { restPaid: row.rest_paid, restAmount: row.rest_amount ?? null } : {}),
    ...(row.called_at ? { calledAt: row.called_at.getTime(), calledBy: row.called_by_name ?? "" } : {}),
    ...(row.review === "asked" || row.review === "got" ? { review: row.review } : {}),
    ...(row.overtime_paid != null ? { overtimePaid: row.overtime_paid } : {}),
  };
}

/**
 * История мероприятия (решение владельца 12 ноября 2026): кто и когда записал, изменил, отметил предоплату, принял,
 * отказался, провёл. Только действие и имя сотрудника — без имени, телефона и адреса клиента. Не записалась — не беда.
 */
export async function logEvent(sql: Sql, eventId: string, byName: string, text: string): Promise<void> {
  try {
    await sql`insert into event_log (id, event_id, by_name, text) values (${`l${randomBytes(12).toString("base64url")}`}, ${eventId}, ${byName.slice(0, 80)}, ${text.slice(0, 300)})`;
  } catch {
    /* история — подсказка, а не учёт: ошибка не мешает действию */
  }
}

export function registerEvents(app: FastifyInstance, options: EventsOptions): void {
  const { sql } = options;
  const now = options.now ?? Date.now;
  const bot = options.bot ?? null;

  /** Уведомление в Telegram — не задерживает ответ и не ломает запись, если Telegram недоступен. */
  /** Уведомления идут по очереди: при смене ведущего «снято» прежнему — раньше «назначено» новому (кнопка одна). */
  let queue: Promise<void> = Promise.resolve();
  function notice(request: FastifyRequest, kind: Parameters<Bot["eventNotice"]>[0], userId: string, event: AgencyEvent) {
    if (!bot) return;
    const span = eventSpan(event);
    if (!span) return;
    queue = queue
      .then(() => bot.eventNotice(kind, userId, event, new Date(span.from)))
      .catch(() => request.log.warn({ events: "notice" }, "events: уведомление не отправилось"));
  }

  /** Колокольчик того, кого касается мероприятие (6 ноября 2026): независимо от Telegram, ошибка не мешает ответу. */
  async function bell(request: FastifyRequest, kind: Parameters<typeof recordHostNotice>[1]["kind"], userId: string, event: AgencyEvent, by: { id: string; name: string }) {
    try {
      await recordHostNotice(sql, { kind, userId, event, by });
    } catch {
      request.log.warn({ events: "bell" }, "events: уведомление в колокольчик не записалось");
    }
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
      select e.id, e.host_id, u.name as host_name, u.active as host_active, to_char(e.day, 'YYYY-MM-DD') as day, e.start_min, e.end_min,
        e.client_name, e.client_phone, e.title, e.place, e.guests, e.note, (e.cancelled_at is not null) as cancelled, e.held, e.updated_at,
        e.program, e.accepted_at, e.accept_rev, e.client_contact,
        e.price, e.prepaid_at, e.refund_at, e.refund_done_at,
        (select pu.name from users pu where pu.id = e.prepaid_by) as prepaid_by_name,
        (select ru.name from users ru where ru.id = e.refund_by) as refund_by_name,
        e.created_by as owner_id, (select ou.name from users ou where ou.id = e.created_by and ou.active) as owner_name,
        e.declined_at, e.declined_reason, e.rest_paid, e.rest_amount,
        e.called_at, (select cu.name from users cu where cu.id = e.called_by) as called_by_name, e.review, e.overtime_paid,
        -- Игра этого вечера открыта у ведущего (как в «Мероприятие идёт дольше плана»): кружок «Идёт» / «Сверх плана».
        (e.cancelled_at is null and exists (select 1 from sessions s where s.host_id = e.host_id and s.phase in ('lobby', 'playing')
          and s.hidden_at is null and s.created_at between e.starts_at - interval '3 hours' and e.ends_at
          and s.updated_at > now() - interval '30 minutes')) as live
      from events e left join users u on u.id = e.host_id`;

    async function one(id: string): Promise<AgencyEvent | null> {
      const [row] = await sql<Row[]>`${select} where e.id = ${id}`;
      return row ? eventOf(row) : null;
    }

    /**
     * Владельцу агентства — колокольчик и Telegram о предоплате (решение владельца 12 ноября 2026): менеджер отметил
     * «Предоплата внесена» или нажал «Вернуть предоплату». Без имени, телефона и адреса клиента; сам себе — не пишем.
     */
    async function tellOwners(request: FastifyRequest, kind: "prepaid" | "refund", event: AgencyEvent, by: { id: string; name: string }) {
      const what = `${event.title || "Мероприятие"}${event.guests ? ` · ${event.guests} гостей` : ""}`;
      const when = `${dayTitle(event.day)}, ${rangeLabel(event.start, event.end)}`;
      const link = eventLink(platformOf(request), event.id);
      const text = kind === "prepaid" ? prepaidOwnerText(what, when, event.price ?? null, by.name, link) : refundOwnerText(what, when, by.name, link);
      const owners = await sql<{ id: string }[]>`select id from users where role = 'admin' and active`;
      for (const o of owners) {
        await bell(request, kind, o.id, event, by);
        if (!bot || o.id === by.id) continue;
        queue = queue
          .then(() => bot.sendTo(o.id, text))
          .then(() => undefined)
          .catch(() => request.log.warn({ events: "owner-notice" }, "events: уведомление владельцу не отправилось"));
      }
    }

    /**
     * Клиент мероприятия в «Клиентах»: по телефону, без телефона — по нику Telegram из «Связи», а если в мероприятии
     * потом сменили и телефон, и ник — по записи истории этого мероприятия. Строка блокируется до конца транзакции.
     */
    type FoundClient = { id: string; status: string };
    async function clientOfEvent(t: Sql, ev: AgencyEvent): Promise<FoundClient | null> {
      const key = phoneKey(ev.clientPhone);
      const links = contactLinks(ev.clientContact ?? "");
      let [client] = key
        ? await t<FoundClient[]>`select id, status from clients where phone_key in ${t(phoneKeyVariants(key))}
            order by (phone_key = ${key}) desc limit 1 for update`
        : [];
      if (!client && links.length > 0) {
        [client] = await t<FoundClient[]>`select id, status from clients where links ?| ${t.array(links)} order by created_at limit 1 for update`;
      }
      if (!client) {
        [client] = await t<FoundClient[]>`select c.id, c.status from clients c
          join client_contacts h on h.client_id = c.id and h.source = 'event' and h.ref = ${ev.id} limit 1 for update of c`;
      }
      return client ?? null;
    }

    /**
     * «Кто взял — тот и ведёт» (решение владельца 12 ноября 2026): мероприятие правит, отменяет и закрывает с возвратом
     * только тот, кто его ведёт (записал или «Забрал себе»). Остальным — 409 `owned` с именем, кнопка «Забрать себе».
     */
    function owned(reply: FastifyReply, event: AgencyEvent | null, user: SessionRow): boolean {
      if (!event?.ownerId || event.ownerId === user.id) return false;
      reply.code(409).send({ error: "failed-precondition", reason: "owned", by: event.ownerName ?? "" });
      return true;
    }

    /**
     * Ведущий занят в это время (решение владельца 12 ноября 2026): уже записан на другое мероприятие, закреплён или сам
     * отметил «занят» — записать его нельзя. «Свободен» и «не отметил» — можно. Возвращает, чем занят, или null.
     */
    async function hostBusy(hostId: string, eventId: string, day: string, start: number, end: number): Promise<string | null> {
      const rows = await sql<{ id: string; day: string; start_min: number; end_min: number; kind: string; note: string }[]>`
        select id, to_char(day, 'YYYY-MM-DD') as day, start_min, end_min, kind, note from availability
        where user_id = ${hostId} and day in (${day}, ${addDays(day, -1)}) and id <> ${bookingId(eventId)}`;
      const info = availabilityOf(
        rows.map((r) => ({ id: r.id, uid: hostId, day: r.day, start: r.start_min, end: r.end_min, kind: r.kind === "free" ? "free" : r.kind === "booked" ? "booked" : "busy", note: r.note })),
        day,
        start,
        end,
      );
      if (info.status !== "busy") return null;
      return info.busy.map((b) => `${rangeLabel(b.start, b.end)}${b.note ? ` — ${b.note}` : ""}`).join("; ") || "занят";
    }

    /** Колокольчик и (по желанию) Telegram нескольким людям сразу — без повторов; себе не пишем. */
    async function tell(request: FastifyRequest, userIds: Array<string | null | undefined>, kind: Parameters<typeof recordHostNotice>[1]["kind"], event: AgencyEvent, by: { id: string; name: string }, telegram?: string) {
      for (const uid of new Set(userIds.filter((u): u is string => Boolean(u)))) {
        if (uid === by.id) continue;
        await bell(request, kind, uid, event, by);
        if (!bot || !telegram) continue;
        queue = queue
          .then(() => bot.sendTo(uid, telegram))
          .then(() => undefined)
          .catch(() => request.log.warn({ events: "tell" }, "events: уведомление не отправилось"));
      }
    }
    const admins = async () => (await sql<{ id: string }[]>`select id from users where role = 'admin' and active`).map((r) => r.id);

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
      const [existing] = await sql<{ cancelled: boolean; host_id: string; day: string; start_min: number; end_min: number; title: string; guests: number | null; updated_at: Date; program: unknown; client_contact: string; price: number | null; prepaid: boolean; place: string; note: string; client_name: string; client_phone: string }[]>`
        select (cancelled_at is not null) as cancelled, host_id, to_char(day, 'YYYY-MM-DD') as day, start_min, end_min, title, guests, updated_at, program, client_contact,
          price, (prepaid_at is not null) as prepaid, place, note, client_name, client_phone
        from events where id = ${input.id}`;
      if (existing?.cancelled) return fail(reply, 409, "failed-precondition");
      if (existing && owned(reply, await one(input.id), user)) return reply;
      // Занятого ведущего не записать: новое мероприятие или сменили ведущего, дату или время (старую двойную запись,
      // которую не трогают, правка не ломает).
      if (!existing || existing.host_id !== input.hostId || existing.day !== input.day || existing.start_min !== input.start || existing.end_min !== input.end) {
        const busy = await hostBusy(input.hostId, input.id, input.day, input.start, input.end);
        if (busy) return reply.code(409).send({ error: "failed-precondition", reason: "host-busy", what: busy.slice(0, 300) });
      }
      // Владелец и менеджер правят одно мероприятие: форма шлёт `expect` — версию, с которой её открыли.
      const expect = (request.body as Record<string, unknown> | null)?.expect;
      if (existing && typeof expect === "number" && Math.floor(existing.updated_at.getTime()) !== expect) {
        return reply.code(409).send({ error: "changed" });
      }
      // Предоплата (решение владельца 12 ноября 2026): новое мероприятие записывается ведущему только с галочкой
      // «Предоплата внесена» и стоимостью по расчёту. Форма без этих полей (вкладка, открытая до обновления) — как раньше.
      // Отметка ставится один раз и не снимается; стоимость у отмеченного мероприятия стереть нельзя.
      const wasPrepaid = existing?.prepaid === true;
      const markPrepaid = input.prepaid === true && !wasPrepaid;
      const newPrice = input.price !== undefined ? input.price : (existing?.price ?? null);
      if (!existing && input.prepaid === false) return reply.code(400).send({ error: "invalid-argument", reason: "prepay" });
      if ((markPrepaid || wasPrepaid) && newPrice === null) return reply.code(400).send({ error: "invalid-argument", reason: "price" });
      // Сумма «к оплате на месте» поменялась (стоимость или новая отметка предоплаты) — ведущему «Изменено».
      const dueChanged = Boolean(existing) && ((existing?.price ?? null) !== newPrice || markPrepaid);
      // Программа: форма её не прислала (старая страница) — остаётся прежняя.
      const given = input.program !== undefined;
      const oldProgram = existing ? cleanProgram(existing.program) : null;
      const newProgram = given ? (input.program ?? null) : oldProgram;
      const programChanged = Boolean(existing) && !sameProgram(oldProgram, newProgram);
      // «Принял, готовлюсь» снимается, если поменяли программу, ведущего, дату или время: ведущему — новое сообщение.
      // Ровно то, о чём ведущему приходит «Изменено» (и смена ведущего): тогда же — новая кнопка и новая отметка.
      const reaccept =
        Boolean(existing) &&
        (programChanged ||
          existing?.host_id !== input.hostId ||
          existing?.day !== input.day ||
          existing?.start_min !== input.start ||
          existing?.end_min !== input.end ||
          existing?.title !== input.title ||
          existing?.guests !== input.guests ||
          dueChanged);
      const programJson = newProgram ? sql.json(newProgram as never) : null;
      // Связь с клиентом: форма её не прислала (старая страница) — остаётся прежняя.
      const contact = input.clientContact ?? existing?.client_contact ?? "";
      // Двойное касание «Сохранить»: два одинаковых запроса почти одновременно. «Назначено» в Telegram — только тому,
      // чей запрос действительно создал запись (`xmax = 0` — вставка, а не правка), иначе ведущему пришло бы два.
      const prepaidAt = markPrepaid ? new Date(now()) : null;
      const inserted = await sql.begin(async (tx) => {
        const t = tx as unknown as Sql;
        const [row] = await t<{ inserted: boolean }[]>`
          insert into events (id, host_id, day, start_min, end_min, starts_at, ends_at, client_name, client_phone, client_contact, title, place, guests, note, program, accept_rev, created_by,
            price, prepaid_at, prepaid_by)
          values (${input.id}, ${input.hostId}, ${input.day}, ${input.start}, ${input.end}, ${new Date(span.from)}, ${new Date(span.to)},
            ${input.clientName}, ${input.clientPhone}, ${contact}, ${input.title}, ${input.place}, ${input.guests}, ${input.note}, ${programJson}, 1, ${user.id},
            ${newPrice}, ${prepaidAt}, ${markPrepaid ? user.id : null})
          on conflict (id) do update set host_id = excluded.host_id, day = excluded.day, start_min = excluded.start_min,
            end_min = excluded.end_min, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
            client_name = excluded.client_name, client_phone = excluded.client_phone, client_contact = excluded.client_contact, title = excluded.title,
            place = excluded.place, guests = excluded.guests, note = excluded.note, program = excluded.program,
            price = excluded.price,
            declined_reason = case when events.host_id <> excluded.host_id then '' else events.declined_reason end,
            declined_at = case when events.host_id <> excluded.host_id then null else events.declined_at end,
            prepaid_by = case when events.prepaid_at is null then excluded.prepaid_by else events.prepaid_by end,
            prepaid_at = coalesce(events.prepaid_at, excluded.prepaid_at),
            accepted_at = case when ${reaccept} then null else events.accepted_at end,
            accept_rev = events.accept_rev + case when ${reaccept} then 1 else 0 end, updated_at = now()
          returning (xmax = 0) as inserted`;
        await book(t, input, user.id);
        return row?.inserted === true;
      });
      request.log.info({ events: existing ? "edit" : "create" }, "events");
      const saved = await one(input.id);
      if (!saved) return fail(reply, 500, "internal");
      const by = { id: user.id, name: user.name };
      // История: что сделали (без данных клиента — только какие поля поменяли).
      if (!existing) {
        if (inserted) await logEvent(sql, saved.id, user.name, `Записал(а) мероприятие · ведущий ${saved.hostName}${markPrepaid ? ` · предоплата ${rub(PREPAY_RUB)} отмечена` : ""}`);
      } else {
        const what = [
          existing.host_id !== saved.hostId ? `ведущий → ${saved.hostName}` : "",
          existing.day !== saved.day || existing.start_min !== saved.start || existing.end_min !== saved.end ? `дата и время → ${dayTitle(saved.day)}, ${rangeLabel(saved.start, saved.end)}` : "",
          existing.title !== saved.title ? "повод" : "",
          existing.guests !== saved.guests ? "гости" : "",
          programChanged ? "программа" : "",
          (existing.price ?? null) !== (saved.price ?? null) ? `стоимость → ${saved.price != null ? rub(saved.price) : "—"}` : "",
          existing.place !== saved.place ? "адрес" : "",
          existing.note !== saved.note ? "комментарий" : "",
          existing.client_name !== saved.clientName || existing.client_phone !== saved.clientPhone || existing.client_contact !== (saved.clientContact ?? "") ? "клиент и связь" : "",
          markPrepaid ? `предоплата ${rub(PREPAY_RUB)} отмечена` : "",
        ].filter(Boolean);
        if (what.length) await logEvent(sql, saved.id, user.name, `Изменил(а): ${what.join(", ")}`);
      }
      if (!existing) {
        if (inserted) {
          notice(request, "created", saved.hostId, saved);
          await bell(request, "created", saved.hostId, saved, by);
        }
      } else if (existing.host_id !== saved.hostId) {
        const before = { ...saved, title: existing.title, day: existing.day, start: existing.start_min, end: existing.end_min };
        notice(request, "removed", existing.host_id, { ...saved, day: existing.day, start: existing.start_min, end: existing.end_min });
        notice(request, "created", saved.hostId, saved);
        await bell(request, "removed", existing.host_id, before, by);
        await bell(request, "created", saved.hostId, saved, by);
      } else if (
        existing.day !== saved.day ||
        existing.start_min !== saved.start ||
        existing.end_min !== saved.end ||
        existing.title !== saved.title ||
        existing.guests !== saved.guests ||
        programChanged ||
        dueChanged
      ) {
        notice(request, "changed", saved.hostId, saved);
        await bell(request, "changed", saved.hostId, saved, by);
      }
      // Предоплату отметили (при записи или позже, у мероприятия без отметки) — владельцу: колокольчик и Telegram.
      if (markPrepaid && (existing || inserted)) await tellOwners(request, "prepaid", saved, by);
      // Клиент мероприятия — в базу клиентов (по телефону; повтор не дублирует историю). Ждём записи и при сбое
      // повторяем (17 октября 2026: раньше запись шла без ожидания — клиент мог молча не попасть в «Клиентов»).
      // Не записался и после повторов — мероприятие всё равно сохранено, а форма говорит добавить клиента вручную.
      const links = contactLinks(saved.clientContact ?? "");
      if (saved.clientName || saved.clientPhone || links.length) {
        const client: ClientInput = {
          name: saved.clientName,
          phone: saved.clientPhone,
          links,
          source: "event",
          summary: `${saved.title || "Мероприятие"}, ${dayTitle(saved.day)}${saved.guests ? `, ${saved.guests} гостей` : ""}${saved.prepaidAt ? ` · предоплата ${rub(PREPAY_RUB)} внесена` : ""}`,
          ref: saved.id,
          promote: !saved.cancelled,
          by: { id: user.id, name: user.name },
          // Где писать клиенту мероприятия — и в его карточку «Клиентов», если там способ связи ещё не указан.
          contact: (() => {
            const kind = parseContact(saved.clientContact ?? "").kind;
            return kind === "telegram" || kind === "whatsapp" || kind === "call" ? kind : "";
          })(),
        };
        let stored = false;
        let clientId: string | null = null;
        for (const pause of CLIENT_RETRY_MS) {
          if (pause) await new Promise((r) => setTimeout(r, pause));
          try {
            clientId = await upsertClient(sql, client);
            stored = true;
            break;
          } catch {
            request.log.warn({ events: "client" }, "events: клиент не записан, повтор");
          }
        }
        if (!stored) {
          request.log.error({ events: "client" }, "events: клиент не записан после повторов");
          return { ...saved, clientNotSaved: true };
        }
        // Неполный телефон («8915») или только имя — связаться не с кем, в «Клиенты» не попал. Мероприятие сохранено,
        // а форма говорит, что нужен полный телефон или ссылка (раньше это считалось успехом и терялось молча).
        if (clientId === null) return { ...saved, clientNotSaved: true, clientIncomplete: true };
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
      if (owned(reply, before, user)) return reply;
      // Что с клиентом (решение владельца 12 ноября 2026): «lost» — отказался (клиент — «Отказ»), иначе — перенос, остаётся «Клиент».
      const clientLost = (request.body as Record<string, unknown> | null)?.client === "lost";
      await sql.begin(async (tx) => {
        await tx`update events set cancelled_at = coalesce(cancelled_at, now()), updated_at = now() where id = ${id}`;
        await tx`delete from availability where id = ${bookingId(id)}`;
      });
      const event = await one(id);
      if (!event) return fail(reply, 404, "not-found");
      request.log.info({ events: "cancel" }, "events");
      if (before && !before.cancelled) {
        await logEvent(sql, id, user.name, clientLost ? "Отменил(а) · клиент отказался" : "Отменил(а) · перенос, клиент остаётся");
        notice(request, "cancelled", event.hostId, event);
        await bell(request, "cancelled", event.hostId, event, { id: user.id, name: user.name });
        if (clientLost) {
          await sql
            .begin(async (tx) => {
              const t = tx as unknown as Sql;
              const client = await clientOfEvent(t, event);
              if (!client || client.status === "lost" || client.status === "held") return;
              await changeStatus(t, client.id, client.status, "lost", { id: user.id, name: user.name }, `Отказ · мероприятие отменено · ${event.title || "Мероприятие"}, ${dayTitle(event.day)} · ${user.name}`);
            })
            .catch(() => request.log.warn({ events: "client-cancel" }, "events: статус клиента не обновлён"));
        }
      }
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
      // Закрыто кнопкой «Вернуть предоплату»: брони больше нет. Клиент передумал — новое мероприятие с новой предоплатой.
      if (event.cancelled && event.refundAt) return reply.code(409).send({ error: "failed-precondition", reason: "refunded" });
      if (owned(reply, event, user)) return reply;
      if (event.cancelled) {
        const busy = await hostBusy(event.hostId, id, event.day, event.start, event.end);
        if (busy) return reply.code(409).send({ error: "failed-precondition", reason: "host-busy", what: busy.slice(0, 300) });
      }
      const [host] = await sql<{ active: boolean }[]>`select active from users where id = ${event.hostId}`;
      if (!host?.active) return fail(reply, 409, "failed-precondition");
      await sql.begin(async (tx) => {
        // Вернули — ведущему снова «Назначено» с новой кнопкой: прежняя отметка не считается.
        // Повтор «Вернуть» (двойное касание, повтор запроса) отметку не трогает: сообщения ведущему тогда нет.
        await tx`update events set accepted_at = case when cancelled_at is not null then null else accepted_at end,
          accept_rev = accept_rev + case when cancelled_at is not null then 1 else 0 end, cancelled_at = null, updated_at = now() where id = ${id}`;
        await book(tx as unknown as Sql, { ...event, id, guests: event.guests }, user.id);
      });
      request.log.info({ events: "restore" }, "events");
      if (event.cancelled) await logEvent(sql, id, user.name, "Вернул(а) мероприятие");
      const restored = await one(id);
      if (!restored) return fail(reply, 500, "internal");
      if (event.cancelled) {
        notice(request, "created", restored.hostId, restored);
        await bell(request, "created", restored.hostId, restored, { id: user.id, name: user.name });
      }
      return restored;
    });

    // «Вернуть предоплату» (решение владельца 12 ноября 2026): клиент отказался не позже чем за 48 часов до начала.
    // Мероприятие закрывается у ведущего и у менеджера (уходит в «Отменённые», время ведущего свободно, ему — «Отменено»),
    // клиент становится «Отказ», владельцу — колокольчик и Telegram «верните предоплату». Меньше 48 часов — 409 `late`:
    // предоплата не возвращается. Повтор — успех без новых сообщений.
    api.post<{ Params: { id: string } }>("/api/events/:id/refund", { bodyLimit: 1024 }, async (request, reply) => {
      const user = await requireUser(request, reply, (u) => permissions.canManageEvents(actorOf(u)));
      if (!user) return reply;
      const id = request.params.id;
      if (!ID.test(id)) return fail(reply, 404, "not-found");
      const [row] = await sql<{ starts_at: Date; held: boolean | null; prepaid: boolean; refund: boolean }[]>`
        select starts_at, held, (prepaid_at is not null) as prepaid, (refund_at is not null) as refund from events where id = ${id}`;
      if (!row) return fail(reply, 404, "not-found");
      if (!row.prepaid) return reply.code(409).send({ error: "failed-precondition", reason: "not-prepaid" });
      if (row.refund) return (await one(id)) ?? fail(reply, 404, "not-found");
      if (row.held === true) return reply.code(409).send({ error: "failed-precondition", reason: "held" });
      if (!refundOpen(row.starts_at.getTime(), now())) return reply.code(409).send({ error: "failed-precondition", reason: "late" });
      const before = await one(id);
      if (owned(reply, before, user)) return reply;
      const at = new Date(now());
      const by = { id: user.id, name: user.name };
      const done = await sql.begin(async (tx) => {
        const marked = await tx`update events set refund_at = ${at}, refund_by = ${user.id}, cancelled_at = coalesce(cancelled_at, now()), updated_at = now()
          where id = ${id} and refund_at is null and prepaid_at is not null returning 1`;
        await tx`delete from availability where id = ${bookingId(id)}`;
        return marked.length > 0;
      });
      const event = await one(id);
      if (!event) return fail(reply, 404, "not-found");
      request.log.info({ events: "refund" }, "events");
      if (!done) return event;
      await logEvent(sql, id, user.name, `Вернуть предоплату ${rub(PREPAY_RUB)} · заказ закрыт`);
      if (before && !before.cancelled) {
        notice(request, "cancelled", event.hostId, event);
        await bell(request, "cancelled", event.hostId, event, by);
      }
      await tellOwners(request, "refund", event, by);
      // Клиент отказался — в «Клиентах» он «Отказ», в истории видно, что предоплату нужно вернуть.
      await sql
        .begin(async (tx) => {
          const t = tx as unknown as Sql;
          const client = await clientOfEvent(t, event);
          // «Провели» — у клиента уже был праздник с нами: он остаётся прежним клиентом, отказ — только от этого заказа.
          if (!client || client.status === "lost" || client.status === "held") return;
          await changeStatus(t, client.id, client.status, "lost", by, `Отказ · вернуть предоплату ${rub(PREPAY_RUB)} · ${event.title || "Мероприятие"}, ${dayTitle(event.day)} · ${user.name}`);
        })
        .catch(() => request.log.warn({ events: "client-refund" }, "events: статус клиента не обновлён"));
      return event;
    });

    // «Отметить: вернул» — владелец вернул предоплату клиенту. Менеджеру, который запросил возврат, — в колокольчик.
    api.post<{ Params: { id: string } }>("/api/events/:id/refund-done", { bodyLimit: 1024 }, async (request, reply) => {
      const user = await requireUser(request, reply, (u) => permissions.canConfirmRefund(actorOf(u)));
      if (!user) return reply;
      const id = request.params.id;
      if (!ID.test(id)) return fail(reply, 404, "not-found");
      const [row] = await sql<{ refund: boolean; refund_by: string | null }[]>`select (refund_at is not null) as refund, refund_by from events where id = ${id}`;
      if (!row) return fail(reply, 404, "not-found");
      if (!row.refund) return reply.code(409).send({ error: "failed-precondition", reason: "no-refund" });
      const marked = await sql`update events set refund_done_at = ${new Date(now())}, updated_at = now() where id = ${id} and refund_done_at is null returning 1`;
      const event = await one(id);
      if (!event) return fail(reply, 404, "not-found");
      request.log.info({ events: "refund-done" }, "events");
      if (marked.length > 0) await logEvent(sql, id, user.name, `Предоплата возвращена клиенту`);
      if (marked.length > 0 && row.refund_by) await bell(request, "refunded", row.refund_by, event, { id: user.id, name: user.name });
      return event;
    });

    // «Забрать себе» (решение владельца 12 ноября 2026): владелец или менеджер берёт мероприятие — дальше правит он,
    // прежнему — в колокольчик. Повтор — успех.
    api.post<{ Params: { id: string } }>("/api/events/:id/take", { bodyLimit: 1024 }, async (request, reply) => {
      const user = await requireUser(request, reply, (u) => permissions.canManageEvents(actorOf(u)));
      if (!user) return reply;
      const id = request.params.id;
      if (!ID.test(id)) return fail(reply, 404, "not-found");
      const before = await one(id);
      if (!before) return fail(reply, 404, "not-found");
      if (before.ownerId !== user.id) {
        await sql`update events set created_by = ${user.id}, updated_at = now() where id = ${id}`;
        request.log.info({ events: "take" }, "events");
        await logEvent(sql, id, user.name, `Забрал(а) себе${before.ownerName ? ` у ${before.ownerName}` : ""}`);
        const event = (await one(id)) ?? before;
        await tell(request, [before.ownerId], "taken", event, { id: user.id, name: user.name });
        return event;
      }
      return before;
    });

    // «Не смогу провести» (решение владельца 12 ноября 2026): ведущий этого мероприятия отказывается — тому, кто ведёт
    // заявку, и владельцу срочно (колокольчик и Telegram без клиента и без текста причины), кружок — «Нужна замена».
    // Сменили ведущего — отметка снимается сама. Повтор — успех без новых сообщений.
    api.post<{ Params: { id: string }; Body: unknown }>("/api/events/:id/decline", { bodyLimit: 2048 }, async (request, reply) => {
      const user = await requireUser(request, reply, canSee);
      if (!user) return reply;
      const id = request.params.id;
      if (!ID.test(id)) return fail(reply, 404, "not-found");
      const before = await one(id);
      if (!before) return fail(reply, 404, "not-found");
      if (before.hostId !== user.id || !permissions.canAcceptEvent(actorOf(user), { hostId: before.hostId })) return fail(reply, 403, "permission-denied");
      const span = eventSpan(before);
      if (before.cancelled || !span || span.to <= now()) return fail(reply, 409, "failed-precondition");
      const raw = (request.body as Record<string, unknown> | null)?.reason;
      const reason = typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) : "";
      const marked = await sql`update events set declined_at = ${new Date(now())}, declined_reason = ${reason}, accepted_at = null, updated_at = now()
        where id = ${id} and declined_at is null and cancelled_at is null returning 1`;
      const event = (await one(id)) ?? before;
      request.log.info({ events: "decline" }, "events");
      if (marked.length > 0) {
        await logEvent(sql, id, user.name, `Не сможет провести${reason ? ` · ${reason}` : ""}`);
        if (bot?.declineMarked) void bot.declineMarked(id).catch(() => undefined);
        const what = `${event.title || "Мероприятие"}${event.guests ? ` · ${event.guests} гостей` : ""}`;
        const text = `🚨 Ведущий не сможет провести — нужна замена\n\n${what}\n${dayTitle(event.day)}, ${rangeLabel(event.start, event.end)}\nВедущий: ${user.name}\n\nНайдите замену и поменяйте ведущего в мероприятии:\n${eventLink(platformOf(request), id)}`;
        await tell(request, [event.ownerId, ...(await admins())], "declined", event, { id: user.id, name: user.name }, text);
      }
      return event;
    });

    // «Остаток получен» после «Проведено» (решение владельца 12 ноября 2026): yes / no / part (+ сумма). Не получил или
    // не весь — владельцу и тому, кто ведёт заявку, в колокольчик.
    api.post<{ Params: { id: string }; Body: unknown }>("/api/events/:id/rest", { bodyLimit: 1024 }, async (request, reply) => {
      const user = await requireUser(request, reply, canSee);
      if (!user) return reply;
      const id = request.params.id;
      if (!ID.test(id)) return fail(reply, 404, "not-found");
      const b = (typeof request.body === "object" && request.body !== null ? request.body : {}) as Record<string, unknown>;
      const rest = b.rest === "yes" || b.rest === "no" || b.rest === "part" ? b.rest : null;
      const amount = rest === "part" && typeof b.amount === "number" && Number.isInteger(b.amount) && b.amount >= 0 && b.amount <= 3_000_000 ? b.amount : null;
      if (!rest) return fail(reply, 400, "invalid-argument");
      const before = await one(id);
      if (!before) return fail(reply, 404, "not-found");
      if (!permissions.canMarkEventHeld(actorOf(user), { hostId: before.hostId })) return fail(reply, 403, "permission-denied");
      if (before.held !== true) return fail(reply, 409, "failed-precondition");
      await sql`update events set rest_paid = ${rest}, rest_amount = ${amount}, updated_at = now() where id = ${id}`;
      const event = (await one(id)) ?? before;
      request.log.info({ events: "rest", rest }, "events");
      if (before.restPaid !== rest || before.restAmount !== amount) {
        await logEvent(sql, id, user.name, rest === "yes" ? "Остаток на месте получен" : rest === "no" ? "Остаток на месте не получен" : `Остаток получен частично${amount != null ? `: ${rub(amount)}` : ""}`);
      }
      if (rest !== "yes" && (before.restPaid !== rest || before.restAmount !== amount)) {
        await tell(request, [event.ownerId, ...(await admins())], "debt", event, { id: user.id, name: user.name });
      }
      return event;
    });

    // «Созвонились с клиентом» (решение владельца 12 ноября 2026): тот, кто ведёт заявку, отмечает созвон перед
    // мероприятием — напоминание «за 3 дня» больше не приходит, владелец видит, что созвон был. `called: false` — снять.
    api.post<{ Params: { id: string }; Body: unknown }>("/api/events/:id/called", { bodyLimit: 1024 }, async (request, reply) => {
      const user = await requireUser(request, reply, (u) => permissions.canManageEvents(actorOf(u)));
      if (!user) return reply;
      const id = request.params.id;
      if (!ID.test(id)) return fail(reply, 404, "not-found");
      const before = await one(id);
      if (!before) return fail(reply, 404, "not-found");
      if (owned(reply, before, user)) return reply;
      const on = (request.body as Record<string, unknown> | null)?.called !== false;
      await sql`update events set called_at = ${on ? new Date(now()) : null}, called_by = ${on ? user.id : null}, updated_at = now() where id = ${id}`;
      if (on !== Boolean(before.calledAt)) await logEvent(sql, id, user.name, on ? "Созвонился(ась) с клиентом" : "Снял(а) отметку о созвоне");
      return (await one(id)) ?? fail(reply, 404, "not-found");
    });

    // Отзыв после «Проведено»: попросили (asked) / получен (got) / снять (''). Владелец видит, у кого ещё не попросили.
    api.post<{ Params: { id: string }; Body: unknown }>("/api/events/:id/review", { bodyLimit: 1024 }, async (request, reply) => {
      const user = await requireUser(request, reply, (u) => permissions.canManageEvents(actorOf(u)));
      if (!user) return reply;
      const id = request.params.id;
      if (!ID.test(id)) return fail(reply, 404, "not-found");
      const raw = (request.body as Record<string, unknown> | null)?.review;
      const review = raw === "asked" || raw === "got" || raw === "" ? raw : null;
      if (review === null) return fail(reply, 400, "invalid-argument");
      const before = await one(id);
      if (!before) return fail(reply, 404, "not-found");
      if (before.held !== true) return fail(reply, 409, "failed-precondition");
      if (owned(reply, before, user)) return reply;
      await sql`update events set review = ${review}, updated_at = now() where id = ${id}`;
      if ((before.review ?? "") !== review) await logEvent(sql, id, user.name, review === "asked" ? "Попросил(а) отзыв" : review === "got" ? "Отзыв получен" : "Снял(а) отметку об отзыве");
      return (await one(id)) ?? fail(reply, 404, "not-found");
    });

    // Доплата за продление (после «Проведено»): сколько получили, 0 — продления не было, null — снять.
    api.post<{ Params: { id: string }; Body: unknown }>("/api/events/:id/overtime", { bodyLimit: 1024 }, async (request, reply) => {
      const user = await requireUser(request, reply, canSee);
      if (!user) return reply;
      const id = request.params.id;
      if (!ID.test(id)) return fail(reply, 404, "not-found");
      const raw = (request.body as Record<string, unknown> | null)?.amount;
      const amount = raw === null ? null : typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 3_000_000 ? raw : undefined;
      if (amount === undefined) return fail(reply, 400, "invalid-argument");
      const before = await one(id);
      if (!before) return fail(reply, 404, "not-found");
      if (!permissions.canMarkEventHeld(actorOf(user), { hostId: before.hostId })) return fail(reply, 403, "permission-denied");
      if (before.held !== true) return fail(reply, 409, "failed-precondition");
      await sql`update events set overtime_paid = ${amount}, updated_at = now() where id = ${id}`;
      if ((before.overtimePaid ?? null) !== amount) {
        await logEvent(sql, id, user.name, amount === null ? "Снял(а) отметку о продлении" : amount === 0 ? "Продления не было" : `Доплата за продление получена: ${rub(amount)}`);
      }
      return (await one(id)) ?? fail(reply, 404, "not-found");
    });

    // История мероприятия — владельцу, менеджеру и ведущему этого мероприятия.
    api.get<{ Params: { id: string } }>("/api/events/:id/log", async (request, reply) => {
      const user = await requireUser(request, reply, canSee);
      if (!user) return reply;
      const event = ID.test(request.params.id) ? await one(request.params.id) : null;
      if (!event || !permissions.canViewEvent(actorOf(user), event)) return fail(reply, 404, "not-found");
      const rows = await sql<{ at: Date; by_name: string; text: string }[]>`
        select at, by_name, text from event_log where event_id = ${event.id} order by at desc limit 100`;
      reply.header("Cache-Control", "no-store");
      return { log: rows.map((r) => ({ at: r.at.getTime(), by: r.by_name, text: r.text })) };
    });

    // «Принял, готовлюсь» — ведущий этого мероприятия (из студии; из Telegram — кнопкой бота). Повтор — успех, время — первое.
    // `rev` — версия программы, которую видел ведущий: её успели поменять — 409 `changed`, принять заново.
    api.post<{ Params: { id: string }; Body: unknown }>("/api/events/:id/accept", { bodyLimit: 1024 }, async (request, reply) => {
      const user = await requireUser(request, reply, canSee);
      if (!user) return reply;
      const id = request.params.id;
      if (!ID.test(id)) return fail(reply, 404, "not-found");
      const rev = (request.body as Record<string, unknown> | null)?.rev;
      const result = await acceptEvent(sql, id, user.id, typeof rev === "number" ? rev : null, (hostId) => permissions.canAcceptEvent(actorOf(user), { hostId }));
      if (result === "not-found") return fail(reply, 404, "not-found");
      if (result === "denied") return fail(reply, 403, "permission-denied");
      if (result === "changed") return reply.code(409).send({ error: "changed" });
      if (result === "cancelled" || result === "past") return fail(reply, 409, "failed-precondition");
      // «already» — тоже успех: отметка уже стоит, время первого нажатия не меняется.
      request.log.info({ events: "accept" }, "events");
      // Кнопка в Telegram становится «✅ Принято» — второй раз нажимать нечего.
      if (bot && result === "ok") void bot.acceptMarked(id).catch(() => request.log.warn({ events: "accept-sync" }, "events: кнопка в Telegram не обновилась"));
      return (await one(id)) ?? fail(reply, 404, "not-found");
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
      const [row] = await sql<{ host_id: string; started: boolean; cancelled: boolean; held: boolean | null }[]>`
        select host_id, starts_at <= ${new Date(now())} as started, (cancelled_at is not null) as cancelled, held from events where id = ${id}`;
      if (!row) return fail(reply, 404, "not-found");
      if (!permissions.canMarkEventHeld(actorOf(user), { hostId: row.host_id })) return fail(reply, 403, "permission-denied");
      if (!row.started || row.cancelled) return fail(reply, 409, "failed-precondition");
      await sql`update events set held = ${held}, held_at = ${held === null ? null : new Date(now())}, held_by = ${held === null ? null : user.id}, updated_at = now()
        ${held === true ? sql`` : sql`, rest_paid = '', rest_amount = null`}
        where id = ${id}`;
      request.log.info({ events: "held", held }, "events");
      if (row.held !== held) await logEvent(sql, id, user.name, held === true ? "Проведено" : held === false ? "Не состоялось" : "Снял(а) отметку «Проведено»");
      // «Проведено» — клиент мероприятия сам становится «Провели» (менеджер просит отзыв и предлагает следующий праздник);
      // отметку сняли или «Не состоялось» — обратно «Клиент». Сразу видно в «Клиентах» (обновляются раз в 30 с).
      // Клиент ищется так же, как при записи мероприятия: по телефону, без телефона — по нику Telegram из «Связи»
      // (диагностика 12 ноября 2026: клиент, записанный только по нику, оставался «Клиентом» — отзыв у него не просили),
      // а если в мероприятии потом сменили и телефон, и ник — по записи истории этого мероприятия.
      const ev = await one(id);
      // «Проведено» — тому, кто ведёт заявку: попросить у клиента отзыв (12 ноября 2026).
      if (ev && held === true && row.held !== true) await tell(request, [ev.ownerId], "held", ev, { id: user.id, name: user.name });
      if (ev) {
        await sql
          .begin(async (tx) => {
            const t = tx as unknown as Sql;
            const client = await clientOfEvent(t, ev);
            if (!client) return;
            const what = `${ev.title || "Мероприятие"}, ${dayTitle(ev.day)}`;
            if (held === true && client.status !== "held") {
              await changeStatus(t, client.id, client.status, "held", { id: user.id, name: user.name }, `Провели · ${what} · ${user.name}`);
            } else if (held !== true && client.status === "held") {
              await changeStatus(t, client.id, client.status, "client", { id: user.id, name: user.name }, `Клиент · ${held === false ? "мероприятие не состоялось" : "отметку «Проведено» сняли"} · ${user.name}`);
            }
          })
          .catch(() => request.log.warn({ events: "client-held" }, "events: статус клиента не обновлён"));
      }
      return (await one(id)) ?? fail(reply, 404, "not-found");
    });

    // ───── «Добавить в мой календарь» (решение владельца 15 октября 2026) ─────
    // Без имени, телефона и адреса клиента: календари телефонов хранят Apple и Google (не в России).
    const platformOf = (request: FastifyRequest) => `https://${String(request.headers.host ?? "games.joy-rest.ru").replace(/[^A-Za-z0-9.:-]/g, "")}`;
    const feedUrl = (request: FastifyRequest, token: string) => `${platformOf(request)}/api/calendar/feed/${token}.ics`;
    const newToken = () => randomBytes(24).toString("base64url");

    // Одно мероприятие файлом .ics — ведущему этого мероприятия и владельцу.
    api.get<{ Params: { id: string } }>("/api/events/:id/ics", async (request, reply) => {
      const user = await requireUser(request, reply, canSee);
      if (!user) return reply;
      const event = ID.test(request.params.id) ? await one(request.params.id) : null;
      if (!event || !permissions.canViewEvent(actorOf(user), event)) return fail(reply, 404, "not-found");
      reply
        .header("Cache-Control", "no-store")
        .header("Content-Disposition", `inline; filename="${icsFileName(event)}"`)
        .type("text/calendar; charset=utf-8");
      return icsCalendar([event], { platformUrl: platformOf(request), withHost: event.hostId !== user.id, now: now() });
    });

    // Ссылка подписки на свои мероприятия: создаётся при первом запросе.
    api.get("/api/calendar/feed", async (request, reply) => {
      const user = await requireUser(request, reply, canSee);
      if (!user) return reply;
      const [row] = await sql<{ calendar_token: string | null }[]>`select calendar_token from users where id = ${user.id}`;
      let token = row?.calendar_token ?? null;
      if (!token) {
        token = newToken();
        await sql`update users set calendar_token = ${token} where id = ${user.id} and calendar_token is null`;
        const [again] = await sql<{ calendar_token: string | null }[]>`select calendar_token from users where id = ${user.id}`;
        token = again?.calendar_token ?? token;
      }
      reply.header("Cache-Control", "no-store");
      return { url: feedUrl(request, token) };
    });

    // «Сменить ссылку»: старая перестаёт работать (ссылку кому-то переслали, телефон потерян).
    api.post("/api/calendar/feed/reset", { bodyLimit: 1024 }, async (request, reply) => {
      const user = await requireUser(request, reply, canSee);
      if (!user) return reply;
      const token = newToken();
      await sql`update users set calendar_token = ${token} where id = ${user.id}`;
      request.log.info({ events: "feed-reset" }, "events");
      return { url: feedUrl(request, token) };
    });

    // Сам календарь по секретной ссылке — телефон забирает его без входа. Ведущему — свои, владельцу — все;
    // за 30 дней назад и год вперёд, без отменённых (отменили — пропадёт из календаря при следующем обновлении).
    api.get<{ Params: { file: string } }>("/api/calendar/feed/:file", async (request, reply) => {
      const token = request.params.file.replace(/\.ics$/, "");
      if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return fail(reply, 404, "not-found");
      const [user] = await sql<UserRow[]>`select * from users where calendar_token = ${token} and active`;
      const actor = user ? actorOf(user) : null;
      if (!user || !actor || !permissions.canEditOwnCalendar(actor)) return fail(reply, 404, "not-found");
      const all = permissions.canManageEvents(actor);
      const at = now();
      const rows = await sql<Row[]>`${select}
        where (${all} or e.host_id = ${user.id}) and e.cancelled_at is null
          and e.ends_at > ${new Date(at - 30 * 86_400_000)} and e.starts_at < ${new Date(at + 370 * 86_400_000)}
        order by e.starts_at limit 1000`;
      reply.header("Cache-Control", "private, no-cache").type("text/calendar; charset=utf-8");
      return icsCalendar(rows.map(eventOf), {
        platformUrl: platformOf(request),
        name: all ? "JoyRest — мероприятия" : "JoyRest — мои мероприятия",
        withHost: all,
        now: at,
      });
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

export type AcceptResult = "ok" | "already" | "not-found" | "denied" | "changed" | "cancelled" | "past";

/**
 * «Принял, готовлюсь»: одна отметка на мероприятие, из студии или из Telegram. Время — первого нажатия (повтор ничего
 * не меняет). `rev` — версия, которую видел ведущий; программу, ведущего или время с тех пор поменяли — `changed`.
 */
export async function acceptEvent(sql: Sql, id: string, userId: string, rev: number | null, allowed: (hostId: string) => boolean): Promise<AcceptResult> {
  const [row] = await sql<{ host_id: string; accept_rev: number; cancelled: boolean; accepted: boolean; past: boolean }[]>`
    select host_id, accept_rev, (cancelled_at is not null) as cancelled, (accepted_at is not null) as accepted,
      ends_at <= now() as past from events where id = ${id}`;
  if (!row) return "not-found";
  if (row.host_id !== userId || !allowed(row.host_id)) return "denied";
  if (row.cancelled) return "cancelled";
  if (rev !== null && rev !== row.accept_rev) return "changed";
  if (row.past) return "past";
  if (row.accepted) return "already";
  // Программу поменяли между чтением и записью — отметка не ставится, ведущему придёт новое сообщение.
  const done = await sql`update events set accepted_at = coalesce(accepted_at, now()), declined_at = null, declined_reason = ''
    where id = ${id} and accept_rev = ${row.accept_rev} and cancelled_at is null returning 1`;
  if (done.length === 0) return "changed";
  const [who] = await sql<{ name: string }[]>`select name from users where id = ${userId}`;
  await logEvent(sql, id, who?.name ?? "", "Принял, готовится");
  // Ведущий принял — тому, кто ведёт заявку, в колокольчик (12 ноября 2026): не нужно заходить и смотреть цвет кружка.
  try {
    const [e] = await sql<{ created_by: string | null; title: string; day: string; start_min: number; end_min: number; host_name: string | null; owner_active: boolean | null }[]>`
      select e.created_by, e.title, to_char(e.day, 'YYYY-MM-DD') as day, e.start_min, e.end_min, h.name as host_name, o.active as owner_active
      from events e left join users h on h.id = e.host_id left join users o on o.id = e.created_by where e.id = ${id}`;
    if (e?.created_by && e.owner_active) {
      await recordHostNotice(sql, { kind: "accepted", userId: e.created_by, event: { id, title: e.title, day: e.day, start: e.start_min, end: e.end_min }, by: { id: userId, name: e.host_name ?? "" } });
    }
  } catch {
    // Колокольчик не записался — отметка «Принял» всё равно стоит.
  }
  return "ok";
}
