/**
 * База клиентов (CLAUDE.md, раздел 3, «База клиентов»; решение владельца 14 октября 2026). Клиенты попадают
 * сами: заявка и вопрос с сайта (`lead.ts`), запрос клиента по QR (`venues.ts`), мероприятие в планировщике
 * (`events.ts`), сообщение, пересланное владельцем боту (`telegram.ts`). Один человек — одна запись по телефону
 * (без телефона — по ссылке на соцсеть). Видят и правят владелец и менеджер по продажам (роль `sales`); выгрузка,
 * «Данные по номеру» и удаление навсегда — только владелец. Согласие на рассылку — только «да» с сайта или вручную
 * владельцем; автоматически «да» не ставится никогда, «нет» не снимается заявкой. Смена статуса пишется в историю
 * клиента с именем того, кто сменил, — владелец видит, как менеджер ведёт клиента.
 * В журнал — только действие, без имён и телефонов.
 */
import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import {
  cleanLine,
  cleanLinks,
  cleanNotes,
  CLIENT_LIMITS,
  clientsCsv,
  isClientStatus,
  isMarketing,
  CLIENT_STATUS_TITLES,
  phoneKey,
  phoneKeyVariants,
  statusAfterEvent,
  type ClientSource,
  isOrigin,
  REOPEN_STATUSES,
  type ClientOrigin,
  type ClientStatus,
} from "../../src/core/clients";
import { contactQuery, matchesContact, queryLabel, type ContactQuery } from "../../src/core/privacy";
import * as permissions from "../../src/data/permissions";
import type { ClientContact, ClientDetails, ClientRecord } from "../../src/data/types";
import { actorOf, apiGuard, sessionUser, type SessionRow } from "./auth";

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const newId = (prefix: string) => `${prefix}${randomBytes(12).toString("base64url")}`;

export interface ClientInput {
  name?: string;
  phone?: string;
  links?: string[];
  /** true — сам отметил согласие на рассылку (галочка на сайте). */
  marketing?: boolean;
  source: ClientSource;
  /** Что за обращение: «Корпоратив, 25 гостей». */
  summary: string;
  /** Откуда обращение (id заявки, мероприятия): повтор не дублирует историю. */
  ref?: string | null;
  /** Мероприятие записано — клиент сам становится «Клиент» (менеджеру не нужно менять статус вручную). */
  promote?: boolean;
  /** Откуда пришёл (канал): ставится, только если у клиента ещё не указан. */
  origin?: ClientOrigin | null;
  /** Кто записал (мероприятие в планировщике) — в историю и в «кто взял клиента». */
  by?: { id: string | null; name: string };
}

/**
 * Сменить статус внутри транзакции (решение владельца 17 октября 2026). Ушёл из «Нового» — таймер останавливается:
 * сколько ждал и кто взял — в карточку и строкой в `client_responses` (среднее время ответа). Вернулся в «Новый» —
 * таймер с нуля. Любой статус, кроме «Нового», снимает «ждёт ответа в Telegram». В историю — «В работе · Мария».
 *
 * 22 октября 2026 (QA): строка `client_responses` пишется только за первый ответ на обращение. Ручной возврат в
 * «Новый» (`reopen` не задан) не стирает «кто взял» и сколько ждали, а следующий уход из «Нового» не считается
 * новым ответом. Сбрасывает таймер только новое обращение клиента (`reopen: true` — повторная заявка).
 *
 * Повторная проверка QA 22 октября 2026: скорость ответа считается, только если «Новый» стоит из-за обращения клиента
 * (`timer_by_contact`, миграция 0039). Ручной «Новый» у клиента, которому ещё не отвечали (например, заведён сразу
 * «В работе»), строку `client_responses` при выходе тоже не даёт: ответа на обращение не было.
 */
export async function changeStatus(
  t: Sql,
  id: string,
  from: string,
  to: ClientStatus,
  who: { id: string | null; name: string },
  line?: string,
  options: { reopen?: boolean } = {},
): Promise<void> {
  if (from === to) return;
  const whoName = who.name.slice(0, CLIENT_LIMITS.name);
  if (from === "new") {
    const [before] = await t<{ taken_at: Date | null; timer_by_contact: boolean }[]>`select taken_at, timer_by_contact from clients where id = ${id}`;
    if (before && before.taken_at === null && before.timer_by_contact) {
      const [row] = await t<{ taken_ms: string | number | null }[]>`
        update clients set status = ${to}, updated_at = now(), taken_at = now(), taken_by = ${whoName},
          taken_ms = greatest(0, floor(extract(epoch from now() - coalesce(new_since, last_contact_at)) * 1000))::bigint, new_since = null,
          timer_by_contact = false
        where id = ${id} returning taken_ms`;
      const waited = Number(row?.taken_ms ?? 0);
      await t`insert into client_responses (id, client_id, user_id, user_name, waited_ms)
        values (${newId("r")}, ${id}, ${who.id}, ${whoName}, ${waited})`;
    } else {
      // На это обращение уже ответили или «Новый» поставили вручную — скорость ответа не считаем.
      await t`update clients set status = ${to}, updated_at = now(), new_since = null, timer_by_contact = false where id = ${id}`;
    }
  } else if (to === "new" && options.reopen) {
    await t`update clients set status = 'new', updated_at = now(), new_since = now(), taken_at = null, taken_ms = null, taken_by = '',
      timer_by_contact = true where id = ${id}`;
  } else if (to === "new") {
    // Вручную вернули в «Новый»: таймер на карточке идёт, но это не обращение клиента — в скорость ответа не попадёт.
    await t`update clients set status = 'new', updated_at = now(), new_since = now(), timer_by_contact = false where id = ${id}`;
  } else {
    await t`update clients set status = ${to}, updated_at = now() where id = ${id}`;
  }
  // С клиентом связались — «ждёт ответа в Telegram» больше не напоминаем.
  if (to !== "new") await t`update tg_chats set waiting_since = null, notified_at = null, updated_at = now() where client_id = ${id}`;
  const text = line ?? `${CLIENT_STATUS_TITLES[to]}${who.name ? ` · ${who.name}` : ""}`;
  await t`insert into client_contacts (id, client_id, source, summary) values (${newId("c")}, ${id}, 'status', ${text.slice(0, CLIENT_LIMITS.summary)})`;
}

/** Нарушение уникального индекса PostgreSQL (одновременно завели клиента с тем же телефоном). */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505";
}

interface Row {
  id: string;
  name: string;
  phone: string;
  links: unknown;
  status: string;
  marketing: string;
  marketing_at: Date | null;
  marketing_source: string;
  notes: string;
  created_at: Date;
  last_contact_at: Date;
  archived_at: Date | null;
  contacts: number;
  last_source: string | null;
  updated_at: Date;
  status_line: string | null;
  status_at: Date | null;
  tg_waiting: Date | null;
  origin: string;
  new_since: Date | null;
  taken_at: Date | null;
  taken_ms: string | number | null;
  taken_by: string;
}

function recordOf(row: Row): ClientRecord {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    links: Array.isArray(row.links) ? row.links.filter((l): l is string => typeof l === "string") : [],
    status: isClientStatus(row.status) ? row.status : "new",
    marketing: isMarketing(row.marketing) ? row.marketing : "unknown",
    marketingAt: row.marketing_at ? row.marketing_at.getTime() : null,
    marketingSource: row.marketing_source,
    notes: row.notes,
    createdAt: row.created_at.getTime(),
    lastContactAt: row.last_contact_at.getTime(),
    contacts: Number(row.contacts) || 0,
    lastSource: row.last_source ?? "",
    archived: row.archived_at !== null,
    updatedAt: row.updated_at.getTime(),
    statusLine: row.status_line ?? "",
    statusAt: row.status_at ? row.status_at.getTime() : null,
    tgWaitingSince: row.tg_waiting ? row.tg_waiting.getTime() : null,
    origin: isOrigin(row.origin) ? row.origin : "",
    newSince: row.new_since ? row.new_since.getTime() : null,
    takenAt: row.taken_at ? row.taken_at.getTime() : null,
    takenMs: row.taken_ms === null ? null : Number(row.taken_ms),
    takenBy: row.taken_by ?? "",
  };
}

/** Текст обращения: переводы строк сохраняются (заявка с сайта — по строкам), остальные служебные символы — пробел. */
export function cleanSummary(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, CLIENT_LIMITS.summary);
}

/**
 * Записать обращение: найти клиента по телефону или ссылке, дополнить (имя, ссылки, согласие) или создать.
 * Без телефона и ссылок — не записываем (связаться не с кем). Возвращает id клиента или null.
 *
 * Правка или повтор уже учтённого обращения (тот же `ref` в истории клиента — например, правка мероприятия) не
 * возвращает клиента из архива и не сдвигает «последнее обращение». Клиент, которого сразу создаёт записанное
 * мероприятие, — сразу «Клиент» без таймера ответа (он ответа не ждал).
 */
export async function upsertClient(sql: Sql, input: ClientInput): Promise<string | null> {
  const name = cleanLine(input.name, CLIENT_LIMITS.name);
  const phone = cleanLine(input.phone, CLIENT_LIMITS.phone);
  const key = phoneKey(phone);
  const keys = phoneKeyVariants(key);
  const links = cleanLinks(input.links ?? []);
  if (!key && links.length === 0) return null;
  const summary = cleanSummary(input.summary);
  const origin = isOrigin(input.origin) ? input.origin : "";
  const by = input.by ?? { id: null, name: "" };
  const eventLine = `Клиент · мероприятие записано${by.name ? ` · ${by.name}` : ""}`;
  return sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    // Один и тот же человек по телефону (и по прежнему виду ключа городского номера), иначе — по любой из ссылок.
    type Found = { id: string; links: unknown; name: string; phone: string; status: string; phone_key: string };
    let [found] = key ? await t<Found[]>`
      select id, links, name, phone, status, phone_key from clients where phone_key in ${t(keys)}
      order by (phone_key = ${key}) desc limit 1 for update` : [];
    if (!found && links.length > 0) {
      [found] = await t<Found[]>`
        select id, links, name, phone, status, phone_key from clients where links ?| ${t.array(links)} order by created_at limit 1 for update`;
    }
    let id = found?.id ?? newId("k");
    let created = false;
    let knownRef = false;
    if (!found) {
      // Новый клиент — сразу «Новый», таймер ответа пошёл. Мероприятие записано сразу — «Клиент», таймера нет.
      const asClient = input.promote === true;
      const made = await t<{ id: string }[]>`insert into clients (id, name, phone, phone_key, links, origin, status, new_since)
        values (${id}, ${name}, ${phone}, ${key}, ${t.json(links)}, ${origin}, ${asClient ? "client" : "new"}, ${asClient ? null : new Date()})
        on conflict do nothing returning id`;
      created = made.length > 0;
      // Одновременная заявка с тем же телефоном уже создала клиента — пишем обращение ему.
      if (!created) {
        if (!key) return null;
        const [other] = await t<{ id: string }[]>`select id from clients where phone_key in ${t(keys)} order by (phone_key = ${key}) desc limit 1 for update`;
        if (!other) return null;
        id = other.id;
      } else if (asClient) {
        await t`insert into client_contacts (id, client_id, source, summary) values (${newId("c")}, ${id}, 'status', ${eventLine.slice(0, CLIENT_LIMITS.summary)})`;
      }
    }
    // Это обращение уже в истории? Уникальный индекс `client_contacts_ref` — (source, ref) без клиента, поэтому ищем так
    // же. Запись висит на другом клиенте (в мероприятии сменили телефон) — переносим её этому: для него это первое
    // обращение (knownRef = false один раз), а следующие правки того же мероприятия — уже учтённые (повторная проверка
    // QA 22 октября 2026: прежде запись оставалась у первого клиента, и каждая правка возвращала второго из «Провели»,
    // «Отказа» и архива).
    if (input.ref) {
      const [seen] = await t<{ id: string; client_id: string }[]>`
        select id, client_id from client_contacts where source = ${input.source} and ref = ${input.ref} limit 1 for update`;
      if (seen && seen.client_id === id) knownRef = true;
      else if (seen) await t`update client_contacts set client_id = ${id} where id = ${seen.id}`;
    }
    if (!created) {
      const [row] = found ? [found] : await t<Found[]>`select id, links, name, phone, status, phone_key from clients where id = ${id}`;
      const merged = cleanLinks([...(Array.isArray(row?.links) ? row.links : []), ...links]);
      // Ключ городского номера в прежнем виде (без «7») — переводим в новый.
      const legacyKey = row !== undefined && key !== "" && row.phone_key !== key && keys.includes(row.phone_key);
      await t`update clients set
          name = case when name = '' then ${name} else name end,
          phone = case when phone_key = '' and ${key} <> '' then ${phone} else phone end,
          ${legacyKey ? t`phone_key = ${key},` : t`phone_key = case when phone_key = '' and ${key} <> '' then ${key} else phone_key end,`}
          links = ${t.json(merged)},
          origin = case when origin = '' then ${origin} else origin end,
          updated_at = now()
          ${knownRef ? t`` : t`, last_contact_at = now(), archived_at = null`}
        where id = ${id}`;
    }
    if (input.marketing === true) {
      await t`update clients set marketing = 'yes', marketing_at = now(), marketing_source = ${input.source === "site" ? "сайт" : input.source}
        where id = ${id} and marketing <> 'yes'`;
    }
    await t`insert into client_contacts (id, client_id, source, summary, ref)
      values (${newId("c")}, ${id}, ${input.source}, ${summary}, ${input.ref ?? null})
      on conflict do nothing`;
    if (created) return id;
    const [now] = await t<{ status: string }[]>`select status from clients where id = ${id}`;
    const current: ClientStatus = now && isClientStatus(now.status) ? now.status : "new";
    if (input.promote) {
      // Мероприятие записано — «Клиент». Новое мероприятие — и из «Провели» (снова праздник); правка уже учтённого —
      // статус, который поставили люди («Провели», «Отказ»), не трогаем.
      const next = statusAfterEvent(current, knownRef);
      if (next) await changeStatus(t, id, current, next, by, eventLine);
    } else if (found && !knownRef && input.source !== "event" && input.source !== "status" && REOPEN_STATUSES.includes(current)) {
      // Снова написал тот, с кем не договорились или кому уже провели праздник, — снова «Новый», таймер с нуля.
      await changeStatus(t, id, current, "new", { id: null, name: "" }, "Новый · повторное обращение", { reopen: true });
    } else if (found && !knownRef && input.source !== "event" && input.source !== "status" && current === "new") {
      // Клиент в «Новом», которого туда вернули вручную (или на прошлое обращение уже ответили), написал снова — это
      // новое обращение: таймер с нуля и в скорость ответа (как повторное обращение). Ждёт ответа на прежнее — таймер
      // идёт дальше, не сбрасываем.
      await t`update clients set new_since = now(), taken_at = null, taken_ms = null, taken_by = '', timer_by_contact = true
        where id = ${id} and (taken_at is not null or not timer_by_contact)`;
    }
    return id;
  });
}

export interface ClientsOptions {
  sql: Sql;
  isSite?: (request: FastifyRequest) => boolean;
}

export function registerClients(app: FastifyInstance, options: ClientsOptions): void {
  const { sql } = options;

  app.register(async (api) => {
    api.addHook("onRequest", apiGuard(options.isSite));

    function fail(reply: FastifyReply, status: number, code: string) {
      return reply.code(status).send({ error: code });
    }

    async function allowed(
      request: FastifyRequest,
      reply: FastifyReply,
      check: (actor: permissions.Actor) => boolean = permissions.canManageClients,
    ): Promise<SessionRow | null> {
      const user = await sessionUser(sql, request, reply);
      if (!user) {
        fail(reply, 401, "unauthenticated");
        return null;
      }
      if (!check(actorOf(user))) {
        fail(reply, 403, "permission-denied");
        return null;
      }
      return user;
    }
    /** Выгрузка и «Данные по номеру» — только владелец. */
    const owner = (request: FastifyRequest, reply: FastifyReply) => allowed(request, reply, permissions.canErasePersonalData);

    const select = sql`
      select c.id, c.name, c.phone, c.links, c.status, c.marketing, c.marketing_at, c.marketing_source, c.notes, c.origin,
        c.created_at, c.last_contact_at, c.archived_at, c.updated_at,
        -- Кто и когда последним сменил статус («В работе · Мария»): владелец и менеджер видят, кто взял клиента.
        (select h.summary from client_contacts h where h.client_id = c.id and h.source = 'status' order by h.created_at desc limit 1) as status_line,
        (select h.created_at from client_contacts h where h.client_id = c.id and h.source = 'status' order by h.created_at desc limit 1) as status_at,
        (select count(*)::int from client_contacts h where h.client_id = c.id and h.source <> 'status') as contacts,
        -- Откуда пришёл — по настоящим обращениям: смена статуса обращением не считается.
        coalesce((select h.source from client_contacts h where h.client_id = c.id and h.source <> 'status' order by h.created_at desc limit 1), 'status') as last_source,
        -- С какого времени клиент ждёт ответа в Telegram (бот в Telegram для бизнеса).
        (select min(t.waiting_since) from tg_chats t where t.client_id = c.id) as tg_waiting,
        c.new_since, c.taken_at, c.taken_ms, c.taken_by
      from clients c`;

    async function details(id: string): Promise<ClientDetails | null> {
      const [row] = await sql<Row[]>`${select} where c.id = ${id}`;
      if (!row) return null;
      const history = await sql<{ id: string; source: string; summary: string; created_at: Date; ref: string | null }[]>`
        select id, source, summary, created_at, ref from client_contacts where client_id = ${id} order by created_at desc limit 100`;
      return {
        ...recordOf(row),
        history: history.map((h): ClientContact => ({ id: h.id, source: h.source, summary: h.summary, at: h.created_at.getTime(), ref: h.source === "venue" || h.source === "event" ? h.ref : null })),
      };
    }

    api.get("/api/clients", async (request, reply) => {
      if (!(await allowed(request, reply))) return reply;
      const archived = (request.query as Record<string, unknown>)?.archived === "1";
      const rows = await sql<Row[]>`${select}
        where ${archived ? sql`c.archived_at is not null` : sql`c.archived_at is null`}
        order by c.last_contact_at desc limit 3000`;
      return { clients: rows.map(recordOf) };
    });

    // Ответы на новые заявки за период: сколько ждали и кто взял — среднее время ответа в «Клиентах» и «Итогах».
    api.get("/api/clients/responses", async (request, reply) => {
      if (!(await allowed(request, reply))) return reply;
      const q = (request.query ?? {}) as Record<string, unknown>;
      const DAY = /^\d{4}-\d{2}-\d{2}$/;
      const from = typeof q.from === "string" && DAY.test(q.from) ? q.from : null;
      const to = typeof q.to === "string" && DAY.test(q.to) ? q.to : null;
      if (!from || !to || from > to || Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 370 * 86_400_000) {
        return fail(reply, 400, "invalid-argument");
      }
      // Дни — по Москве: с 00:00 первого до 24:00 последнего.
      const rows = await sql<{ user_name: string; waited_ms: string | number; taken_at: Date }[]>`
        select user_name, waited_ms, taken_at from client_responses
        where taken_at >= (${from}::date)::timestamp at time zone 'Europe/Moscow'
          and taken_at < ((${to}::date + 1)::timestamp at time zone 'Europe/Moscow')
        order by taken_at desc limit 5000`;
      return { responses: rows.map((r) => ({ userName: r.user_name, waitedMs: Number(r.waited_ms), takenAt: r.taken_at.getTime() })) };
    });

    // Выгрузка для рассылки: по умолчанию только согласившиеся; ?all=1 — все (для своей работы, не для рассылки).
    api.get("/api/clients/export", async (request, reply) => {
      if (!(await allowed(request, reply, permissions.canExportClients))) return reply;
      const all = (request.query as Record<string, unknown>)?.all === "1";
      const rows = await sql<Row[]>`${select}
        where c.archived_at is null ${all ? sql`` : sql`and c.marketing = 'yes'`}
        order by c.last_contact_at desc`;
      request.log.info({ clients: "export", all, count: rows.length }, "clients");
      const day = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
      reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="joyrest-clients-${all ? "all" : "mailing"}-${day}.csv"`);
      return clientsCsv(rows.map(recordOf));
    });

    api.get<{ Params: { id: string } }>("/api/clients/:id", async (request, reply) => {
      if (!(await allowed(request, reply))) return reply;
      if (!ID.test(request.params.id)) return fail(reply, 404, "not-found");
      return (await details(request.params.id)) ?? fail(reply, 404, "not-found");
    });

    // Новый клиент вручную или правка. Тот же телефон у другого клиента — 409 (не плодим двойников).
    api.post<{ Body: unknown }>("/api/clients", { bodyLimit: 8192 }, async (request, reply) => {
      const user = await allowed(request, reply);
      if (!user) return reply;
      const b = (typeof request.body === "object" && request.body !== null ? request.body : {}) as Record<string, unknown>;
      const id = typeof b.id === "string" && ID.test(b.id) ? b.id : null;
      const name = cleanLine(b.name, CLIENT_LIMITS.name);
      const phone = cleanLine(b.phone, CLIENT_LIMITS.phone);
      const key = phoneKey(phone);
      const links = cleanLinks(b.links);
      // Статус и согласие не прислали — у существующего не трогаем (форма «Сохранить мои правки поверх» шлёт их, только
      // если человек их менял; 22 октября 2026: прежде «по умолчанию „Новый“» откатывало чужую смену статуса).
      const askedStatus = isClientStatus(b.status) ? b.status : null;
      const asked = isMarketing(b.marketing) ? b.marketing : null;
      const notes = cleanNotes(b.notes);
      // Откуда пришёл — вручную в карточке; не прислали — не трогаем (пустое — «не указан»).
      const origin = b.origin === "" || isOrigin(b.origin) ? b.origin : null;
      if (!id || (!key && links.length === 0 && !name)) return fail(reply, 400, "invalid-argument");
      const keys = phoneKeyVariants(key);
      if (key) {
        const [other] = await sql<{ id: string }[]>`select id from clients where phone_key in ${sql(keys)} and id <> ${id} limit 1`;
        if (other) return reply.code(409).send({ error: "already-exists", id: other.id });
      }
      const expect = typeof b.expect === "number" ? b.expect : null;
      const canConsent = permissions.canSetMarketingConsent(actorOf(user));
      // Что хочет клиент («Свадьба, 12 июня, 60 гостей») — первая запись истории нового клиента.
      const request0 = cleanSummary(b.request);
      type Existing = { marketing: string; status: string; updated_at: Date };
      let outcome: { kind: "ok"; existed: boolean } | { kind: "changed" };
      try {
        outcome = await sql.begin(async (tx) => {
          const t = tx as unknown as Sql;
          const [existing] = await t<Existing[]>`select marketing, status, updated_at from clients where id = ${id} for update`;
          // Владелец и менеджер работают одновременно: форма шлёт `expect` — версию, с которой её открыли.
          // Карточку за это время изменили — 409, ничего не затираем (браузер покажет свежую версию).
          if (existing && expect !== null && Math.floor(existing.updated_at.getTime()) !== expect) return { kind: "changed" as const };
          // Согласие «да» вручную ставит только владелец: менеджер может отметить «нет» (отказался), но не «да».
          const before = existing && isMarketing(existing.marketing) ? existing.marketing : "unknown";
          const wanted = asked ?? before;
          const marketing = wanted === "yes" && before !== "yes" && !canConsent ? before : wanted;
          const marketingChanged = !existing || existing.marketing !== marketing;
          const status: ClientStatus = askedStatus ?? (existing && isClientStatus(existing.status) ? existing.status : "new");
          // Статус существующего меняет `changeStatus` (таймер ответа, история), здесь — только поля карточки.
          await t`
            insert into clients (id, name, phone, phone_key, links, status, marketing, marketing_at, marketing_source, notes, origin, new_since)
            values (${id}, ${name}, ${phone}, ${key}, ${t.json(links)}, ${status}, ${marketing},
              ${marketing === "yes" ? new Date() : null}, ${marketing === "yes" ? "вручную владельцем" : ""}, ${notes}, ${origin ?? ""},
              ${status === "new" ? new Date() : null})
            on conflict (id) do update set name = excluded.name, phone = excluded.phone, phone_key = excluded.phone_key,
              links = excluded.links, notes = excluded.notes, updated_at = now()
              ${origin !== null ? t`, origin = excluded.origin` : t``}
              ${marketingChanged ? t`, marketing = excluded.marketing, marketing_at = excluded.marketing_at, marketing_source = excluded.marketing_source` : t``}`;
          if (!existing) {
            await t`insert into client_contacts (id, client_id, source, summary) values (${newId("c")}, ${id}, 'manual',
              ${(request0 ? `${request0}\n— добавлен вручную · ${user.name}` : `Добавлен вручную · ${user.name}`).slice(0, CLIENT_LIMITS.summary)})`;
          } else if (existing.status !== status) {
            // Кто и когда сменил статус — в историю клиента: владелец видит, как идёт работа с заявкой.
            await changeStatus(t, id, existing.status, status, { id: user.id, name: user.name });
          }
          return { kind: "ok" as const, existed: Boolean(existing) };
        });
      } catch (error) {
        // Одновременно завели клиента с тем же телефоном (двойное касание, владелец и менеджер) — уникальный индекс
        // телефона: не 500, а «уже есть» с его id, как при обычной проверке.
        if (!isUniqueViolation(error) || !key) throw error;
        const [other] = await sql<{ id: string }[]>`select id from clients where phone_key in ${sql(keys)} and id <> ${id} limit 1`;
        return reply.code(409).send({ error: "already-exists", ...(other ? { id: other.id } : {}) });
      }
      if (outcome.kind === "changed") return fail(reply, 409, "failed-precondition");
      request.log.info({ clients: outcome.existed ? "edit" : "create" }, "clients");
      return (await details(id)) ?? fail(reply, 500, "internal");
    });

    // Статус одним касанием: меняется только статус (заметка, имя и ссылки не трогаются — их мог править другой человек).
    api.post<{ Params: { id: string }; Body: unknown }>("/api/clients/:id/status", { bodyLimit: 1024 }, async (request, reply) => {
      const user = await allowed(request, reply);
      if (!user) return reply;
      const id = request.params.id;
      const b = (typeof request.body === "object" && request.body !== null ? request.body : {}) as Record<string, unknown>;
      if (!ID.test(id) || !isClientStatus(b.status)) return fail(reply, 400, "invalid-argument");
      const status = b.status;
      const result = await sql.begin(async (tx) => {
        const t = tx as unknown as Sql;
        const [row] = await t<{ status: string; archived_at: Date | null }[]>`select status, archived_at from clients where id = ${id} for update`;
        if (!row) return "not-found" as const;
        if (row.archived_at) return "archived" as const;
        if (row.status === status) return "same" as const;
        await changeStatus(t, id, row.status, status, { id: user.id, name: user.name });
        return "ok" as const;
      });
      if (result === "not-found") return fail(reply, 404, "not-found");
      if (result === "archived") return fail(reply, 409, "failed-precondition");
      request.log.info({ clients: "status" }, "clients");
      return (await details(id)) ?? fail(reply, 404, "not-found");
    });

    // Заметка без формы: `base` — текст, с которого человек начал править. Заметку за это время изменил другой — 409,
    // свою правку браузер не теряет и показывает обе версии.
    api.post<{ Params: { id: string }; Body: unknown }>("/api/clients/:id/notes", { bodyLimit: 16384 }, async (request, reply) => {
      const user = await allowed(request, reply);
      if (!user) return reply;
      const id = request.params.id;
      const b = (typeof request.body === "object" && request.body !== null ? request.body : {}) as Record<string, unknown>;
      if (!ID.test(id) || typeof b.notes !== "string" || typeof b.base !== "string") return fail(reply, 400, "invalid-argument");
      const notes = cleanNotes(b.notes);
      const base = cleanNotes(b.base);
      const result = await sql.begin(async (tx) => {
        const t = tx as unknown as Sql;
        const [row] = await t<{ notes: string; archived_at: Date | null }[]>`select notes, archived_at from clients where id = ${id} for update`;
        if (!row) return "not-found" as const;
        if (row.archived_at) return "archived" as const;
        if (row.notes === notes) return "ok" as const;
        if (row.notes !== base) return "conflict" as const;
        await t`update clients set notes = ${notes}, updated_at = now() where id = ${id}`;
        return "ok" as const;
      });
      if (result === "not-found") return fail(reply, 404, "not-found");
      if (result !== "ok") return fail(reply, 409, "failed-precondition");
      request.log.info({ clients: "notes" }, "clients");
      return (await details(id)) ?? fail(reply, 404, "not-found");
    });

    for (const action of ["archive", "restore"] as const) {
      api.post<{ Params: { id: string } }>(`/api/clients/:id/${action}`, { bodyLimit: 1024 }, async (request, reply) => {
        if (!(await allowed(request, reply))) return reply;
        if (!ID.test(request.params.id)) return fail(reply, 404, "not-found");
        const done = await sql`update clients set archived_at = ${action === "archive" ? sql`coalesce(archived_at, now())` : null}, updated_at = now()
          where id = ${request.params.id} returning id`;
        if (done.length === 0) return fail(reply, 404, "not-found");
        request.log.info({ clients: action }, "clients");
        return { ok: true };
      });
    }

    // «Данные по номеру» (решение владельца 15 октября 2026): человек попросил удалить свои данные.
    // Ищем по телефону, нику или почте во всех местах, где лежат данные клиентов. Записей немного —
    // сравниваем в памяти той же функцией, что проверяют тесты (`matchesContact`).
    async function findMatches(q: ContactQuery) {
      const clients = (await sql<{ id: string; name: string; phone: string; links: unknown; archived_at: Date | null; contacts: number }[]>`
        select c.id, c.name, c.phone, c.links, c.archived_at, (select count(*)::int from client_contacts h where h.client_id = c.id) as contacts
        from clients c`).filter((r) => matchesContact(q, { phones: [r.phone], links: Array.isArray(r.links) ? r.links.filter((l): l is string => typeof l === "string") : [] }));
      const requests = (await sql<{ id: string; number: number; name: string | null; phone: string | null; event: string | null; date: string | null; guests: unknown; archived_at: Date | null }[]>`
        select id, number, data->>'name' as name, data->>'phone' as phone, data->>'eventType' as event, data->>'date' as date, data->'guests' as guests, archived_at
        from venue_requests`).filter((r) => matchesContact(q, { phones: [r.phone ?? ""], texts: [r.phone ?? ""] }));
      const events = (await sql<{ id: string; title: string; day: string; client_name: string; client_phone: string; cancelled_at: Date | null }[]>`
        select id, title, to_char(day, 'YYYY-MM-DD') as day, client_name, client_phone, cancelled_at from events
        where client_phone <> '' or client_name <> ''`).filter((r) => matchesContact(q, { phones: [r.client_phone], texts: [r.client_phone] }));
      const venues = (await sql<{ id: string; name: string | null; person: string | null; phone: string | null; messenger: string | null; email: string | null }[]>`
        select id, data->>'name' as name, data->>'person' as person, data->>'phone' as phone, data->>'messenger' as messenger, data->>'email' as email
        from venues`).filter((r) => matchesContact(q, { phones: [r.phone ?? ""], texts: [r.messenger ?? ""], emails: [r.email ?? ""] }));
      return { clients, requests, events, venues };
    }

    function queryOf(raw: unknown, reply: FastifyReply): ContactQuery | null {
      const q = typeof raw === "string" ? contactQuery(raw) : null;
      if (!q) fail(reply, 400, "invalid-argument");
      return q;
    }

    api.get("/api/privacy", async (request, reply) => {
      if (!(await owner(request, reply))) return reply;
      const q = queryOf((request.query as Record<string, unknown>)?.q, reply);
      if (!q) return reply;
      const m = await findMatches(q);
      request.log.info({ privacy: "search", found: m.clients.length + m.requests.length + m.events.length + m.venues.length }, "clients");
      return {
        label: queryLabel(q),
        clients: m.clients.map((r) => ({ id: r.id, name: r.name, phone: r.phone, contacts: r.contacts, archived: r.archived_at !== null })),
        requests: m.requests.map((r) => ({
          id: r.id,
          number: r.number,
          name: r.name ?? "",
          title: [r.event || "Мероприятие", r.date ?? "", typeof r.guests === "number" ? `${r.guests} гостей` : ""].filter(Boolean).join(" · "),
          archived: r.archived_at !== null,
        })),
        events: m.events.map((r) => ({ id: r.id, title: r.title, day: r.day, clientName: r.client_name, cancelled: r.cancelled_at !== null })),
        venues: m.venues.map((r) => ({ id: r.id, name: r.name ?? "", person: r.person ?? "" })),
      };
    });

    // Удалить навсегда. Клиент — с историей обращений (cascade), заявка на подбор — целиком (в отправленных
    // предложениях данных клиента нет, ссылка на заявку обнуляется). В мероприятии и у площадки стираются
    // только данные человека: мероприятие нужно ведущему и итогам, площадка — базе.
    api.post<{ Body: unknown }>("/api/privacy/erase", { bodyLimit: 1024 }, async (request, reply) => {
      if (!(await owner(request, reply))) return reply;
      const b = (typeof request.body === "object" && request.body !== null ? request.body : {}) as Record<string, unknown>;
      const q = queryOf(b.q, reply);
      if (!q) return reply;
      const report = await sql.begin(async (tx) => {
        const m = await findMatches(q);
        const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
        if (m.clients.length) await tx`delete from clients where id in ${tx(ids(m.clients))}`;
        if (m.requests.length) await tx`delete from venue_requests where id in ${tx(ids(m.requests))}`;
        if (m.events.length) await tx`update events set client_name = '', client_phone = '', updated_at = now() where id in ${tx(ids(m.events))}`;
        if (m.venues.length) {
          await tx`update venues set data = data || ${tx.json({ person: "", role: "", phone: "", messenger: "", email: "" })}, updated_at = now()
            where id in ${tx(ids(m.venues))}`;
        }
        return { clients: m.clients.length, requests: m.requests.length, events: m.events.length, venues: m.venues.length };
      });
      // В журнал — только действие и сколько записей, без телефона.
      request.log.info({ privacy: "erase", ...report }, "clients");
      return report;
    });
  });
}
