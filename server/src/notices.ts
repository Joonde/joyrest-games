/**
 * Колокольчик уведомлений студии (CLAUDE.md, раздел 3, «Уведомления в студии»; решение владельца 17 октября 2026).
 * Владельцу и менеджеру по продажам (`permissions.canManageClients`): новые обращения клиентов — заявка и вопрос с сайта,
 * запрос по QR, расчёт или пересланное сообщение из Telegram — и клиенты, которые ждут ответа в Telegram больше 30 минут.
 * Отдельной таблицы уведомлений нет: их собирает сервер из истории клиентов (`client_contacts`) и `tg_chats`; помним
 * только, когда человек последний раз открывал колокольчик (`notice_seen`). В журнал — только действие.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { SOURCE_TITLES, type ClientSource } from "../../src/core/clients";
import * as permissions from "../../src/data/permissions";
import type { Notice } from "../../src/data/types";
import { actorOf, apiGuard, sessionUser } from "./auth";

/** Какие обращения — уведомления: пришли от клиента сами, а не записаны командой. */
export const NOTICE_SOURCES: ClientSource[] = ["site", "question", "venue", "telegram"];
/** Сколько последних уведомлений показывать. */
export const NOTICE_LIMIT = 30;
/** Уведомления старше — не показываем (клиент уже в «Клиентах»). */
const NOTICE_DAYS = 30;
/** Колокольчик ещё ни разу не открывали — новыми считаем обращения за последние сутки. */
const FIRST_UNREAD_HOURS = 24;
const WAIT_MINUTES = 30;

/** Первая строка обращения — коротко для списка. */
export function noticeLine(summary: string): string {
  const first = summary.split("\n").find((l) => l.trim()) ?? "";
  return first.length > 120 ? `${first.slice(0, 119)}…` : first;
}

export interface NoticesOptions {
  sql: Sql;
  isSite?: (request: FastifyRequest) => boolean;
}

export function registerNotices(app: FastifyInstance, options: NoticesOptions): void {
  const { sql } = options;
  app.register(async (api) => {
    api.addHook("onRequest", apiGuard(options.isSite));

    async function member(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
      const user = await sessionUser(sql, request, reply);
      if (!user) {
        reply.code(401).send({ error: "unauthenticated" });
        return null;
      }
      if (!permissions.canManageClients(actorOf(user))) {
        reply.code(403).send({ error: "permission-denied" });
        return null;
      }
      return user.id;
    }

    api.get("/api/notices", async (request, reply) => {
      const uid = await member(request, reply);
      if (!uid) return reply;
      reply.header("cache-control", "no-store");
      const [seen] = await sql<{ seen_at: Date }[]>`select seen_at from notice_seen where user_id = ${uid}`;
      const since = seen?.seen_at ?? new Date(Date.now() - FIRST_UNREAD_HOURS * 3_600_000);
      const rows = await sql<{ id: string; client_id: string; source: string; summary: string; created_at: Date; name: string; phone: string }[]>`
        select h.id, h.client_id, h.source, h.summary, h.created_at, c.name, c.phone
        from client_contacts h join clients c on c.id = h.client_id
        where h.source in ${sql(NOTICE_SOURCES)} and c.archived_at is null
          and h.created_at > now() - make_interval(days => ${NOTICE_DAYS})
        order by h.created_at desc limit ${NOTICE_LIMIT}`;
      const waiting = await sql<{ client_id: string; since: Date; name: string; phone: string }[]>`
        select t.client_id, min(t.waiting_since) as since, c.name, c.phone
        from tg_chats t join clients c on c.id = t.client_id
        where t.waiting_since is not null and t.waiting_since < now() - make_interval(mins => ${WAIT_MINUTES}) and c.archived_at is null
        group by t.client_id, c.name, c.phone
        order by min(t.waiting_since)`;
      const items: Notice[] = [
        ...waiting.map(
          (w): Notice => ({
            id: `wait-${w.client_id}`,
            clientId: w.client_id,
            kind: "waiting",
            title: "Ждёт ответа в Telegram",
            name: w.name || w.phone || "Клиент",
            line: "",
            at: w.since.getTime(),
            unread: true,
          }),
        ),
        ...rows.map(
          (r): Notice => ({
            id: r.id,
            clientId: r.client_id,
            kind: "new",
            title: SOURCE_TITLES[r.source as ClientSource] ?? "Обращение",
            name: r.name || r.phone || "Клиент",
            line: noticeLine(r.summary),
            at: r.created_at.getTime(),
            unread: r.created_at > since,
          }),
        ),
      ];
      return { unread: items.filter((i) => i.unread).length, items };
    });

    // Открыл колокольчик — всё, что пришло до этого, прочитано (ждущие ответа остаются, пока им не ответят).
    api.post("/api/notices/seen", { bodyLimit: 1024 }, async (request, reply) => {
      const uid = await member(request, reply);
      if (!uid) return reply;
      await sql`insert into notice_seen (user_id, seen_at) values (${uid}, now())
        on conflict (user_id) do update set seen_at = now()`;
      request.log.info({ notices: "seen" }, "notices");
      return { ok: true };
    });
  });
}
