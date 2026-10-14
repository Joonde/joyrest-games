/**
 * База клиентов (CLAUDE.md, раздел 3, «База клиентов»; решение владельца 14 октября 2026). Клиенты попадают
 * сами: заявка и вопрос с сайта (`lead.ts`), запрос клиента по QR (`venues.ts`), мероприятие в планировщике
 * (`events.ts`), сообщение, пересланное владельцем боту (`telegram.ts`). Один человек — одна запись по телефону
 * (без телефона — по ссылке на соцсеть). Видит и правит только владелец. Согласие на рассылку — только «да»
 * с сайта или вручную владельцем; автоматически «да» не ставится никогда, «нет» не снимается заявкой.
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
  phoneKey,
  type ClientSource,
} from "../../src/core/clients";
import * as permissions from "../../src/data/permissions";
import type { ClientContact, ClientDetails, ClientRecord } from "../../src/data/types";
import { actorOf, apiGuard, sessionUser } from "./auth";

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
  };
}

/**
 * Записать обращение: найти клиента по телефону или ссылке, дополнить (имя, ссылки, согласие) или создать.
 * Без телефона и ссылок — не записываем (связаться не с кем). Возвращает id клиента или null.
 */
export async function upsertClient(sql: Sql, input: ClientInput): Promise<string | null> {
  const name = cleanLine(input.name, CLIENT_LIMITS.name);
  const phone = cleanLine(input.phone, CLIENT_LIMITS.phone);
  const key = phoneKey(phone);
  const links = cleanLinks(input.links ?? []);
  if (!key && links.length === 0) return null;
  const summary = cleanLine(input.summary, CLIENT_LIMITS.summary);
  return sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    // Один и тот же человек по телефону, иначе — по любой из ссылок.
    let [found] = key ? await t<{ id: string; links: unknown; name: string; phone: string }[]>`
      select id, links, name, phone from clients where phone_key = ${key} for update` : [];
    if (!found && links.length > 0) {
      [found] = await t<{ id: string; links: unknown; name: string; phone: string }[]>`
        select id, links, name, phone from clients where links ?| ${t.array(links)} order by created_at limit 1 for update`;
    }
    let id = found?.id ?? newId("k");
    if (!found) {
      const made = await t<{ id: string }[]>`insert into clients (id, name, phone, phone_key, links)
        values (${id}, ${name}, ${phone}, ${key}, ${t.json(links)}) on conflict do nothing returning id`;
      // Одновременная заявка с тем же телефоном уже создала клиента — пишем обращение ему.
      if (made.length === 0 && key) {
        const [other] = await t<{ id: string }[]>`select id from clients where phone_key = ${key}`;
        if (!other) return null;
        id = other.id;
      }
    } else {
      const merged = cleanLinks([...(Array.isArray(found.links) ? found.links : []), ...links]);
      await t`update clients set
          name = case when name = '' then ${name} else name end,
          phone = case when phone_key = '' and ${key} <> '' then ${phone} else phone end,
          phone_key = case when phone_key = '' and ${key} <> '' then ${key} else phone_key end,
          links = ${t.json(merged)},
          last_contact_at = now(), updated_at = now(), archived_at = null
        where id = ${id}`;
    }
    if (input.marketing === true) {
      await t`update clients set marketing = 'yes', marketing_at = now(), marketing_source = ${input.source === "site" ? "сайт" : input.source}
        where id = ${id} and marketing <> 'yes'`;
    }
    await t`insert into client_contacts (id, client_id, source, summary, ref)
      values (${newId("c")}, ${id}, ${input.source}, ${summary}, ${input.ref ?? null})
      on conflict do nothing`;
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

    async function owner(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
      const user = await sessionUser(sql, request, reply);
      if (!user) {
        fail(reply, 401, "unauthenticated");
        return false;
      }
      if (!permissions.canManageClients(actorOf(user))) {
        fail(reply, 403, "permission-denied");
        return false;
      }
      return true;
    }

    const select = sql`
      select c.id, c.name, c.phone, c.links, c.status, c.marketing, c.marketing_at, c.marketing_source, c.notes,
        c.created_at, c.last_contact_at, c.archived_at,
        (select count(*)::int from client_contacts h where h.client_id = c.id) as contacts,
        (select h.source from client_contacts h where h.client_id = c.id order by h.created_at desc limit 1) as last_source
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
      if (!(await owner(request, reply))) return reply;
      const archived = (request.query as Record<string, unknown>)?.archived === "1";
      const rows = await sql<Row[]>`${select}
        where ${archived ? sql`c.archived_at is not null` : sql`c.archived_at is null`}
        order by c.last_contact_at desc limit 3000`;
      return { clients: rows.map(recordOf) };
    });

    // Выгрузка для рассылки: по умолчанию только согласившиеся; ?all=1 — все (для своей работы, не для рассылки).
    api.get("/api/clients/export", async (request, reply) => {
      if (!(await owner(request, reply))) return reply;
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
      if (!(await owner(request, reply))) return reply;
      if (!ID.test(request.params.id)) return fail(reply, 404, "not-found");
      return (await details(request.params.id)) ?? fail(reply, 404, "not-found");
    });

    // Новый клиент вручную или правка. Тот же телефон у другого клиента — 409 (не плодим двойников).
    api.post<{ Body: unknown }>("/api/clients", { bodyLimit: 8192 }, async (request, reply) => {
      if (!(await owner(request, reply))) return reply;
      const b = (typeof request.body === "object" && request.body !== null ? request.body : {}) as Record<string, unknown>;
      const id = typeof b.id === "string" && ID.test(b.id) ? b.id : null;
      const name = cleanLine(b.name, CLIENT_LIMITS.name);
      const phone = cleanLine(b.phone, CLIENT_LIMITS.phone);
      const key = phoneKey(phone);
      const links = cleanLinks(b.links);
      const status = isClientStatus(b.status) ? b.status : "new";
      const marketing = isMarketing(b.marketing) ? b.marketing : "unknown";
      const notes = cleanNotes(b.notes);
      if (!id || (!key && links.length === 0 && !name)) return fail(reply, 400, "invalid-argument");
      if (key) {
        const [other] = await sql<{ id: string }[]>`select id from clients where phone_key = ${key} and id <> ${id}`;
        if (other) return reply.code(409).send({ error: "already-exists", id: other.id });
      }
      const [existing] = await sql<{ marketing: string }[]>`select marketing from clients where id = ${id}`;
      const marketingChanged = existing?.marketing !== marketing;
      await sql`
        insert into clients (id, name, phone, phone_key, links, status, marketing, marketing_at, marketing_source, notes)
        values (${id}, ${name}, ${phone}, ${key}, ${sql.json(links)}, ${status}, ${marketing},
          ${marketing === "yes" ? new Date() : null}, ${marketing === "yes" ? "вручную владельцем" : ""}, ${notes})
        on conflict (id) do update set name = excluded.name, phone = excluded.phone, phone_key = excluded.phone_key,
          links = excluded.links, status = excluded.status, notes = excluded.notes, updated_at = now()
          ${marketingChanged ? sql`, marketing = excluded.marketing, marketing_at = excluded.marketing_at, marketing_source = excluded.marketing_source` : sql``}`;
      if (!existing) {
        await sql`insert into client_contacts (id, client_id, source, summary) values (${newId("c")}, ${id}, 'manual', 'Добавлен вручную')`;
      }
      request.log.info({ clients: existing ? "edit" : "create" }, "clients");
      return (await details(id)) ?? fail(reply, 500, "internal");
    });

    for (const action of ["archive", "restore"] as const) {
      api.post<{ Params: { id: string } }>(`/api/clients/:id/${action}`, { bodyLimit: 1024 }, async (request, reply) => {
        if (!(await owner(request, reply))) return reply;
        if (!ID.test(request.params.id)) return fail(reply, 404, "not-found");
        await sql`update clients set archived_at = ${action === "archive" ? sql`coalesce(archived_at, now())` : null}, updated_at = now()
          where id = ${request.params.id}`;
        request.log.info({ clients: action }, "clients");
        return { ok: true };
      });
    }
  });
}
