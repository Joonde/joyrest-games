/**
 * Колокольчик уведомлений студии (CLAUDE.md, раздел 3, «Уведомления в студии»; решение владельца 17 октября 2026).
 * Владельцу и менеджеру по продажам (`permissions.canManageClients`): новые обращения клиентов — заявка и вопрос с сайта,
 * запрос по QR, расчёт или пересланное сообщение из Telegram — и клиенты, которые ждут ответа в Telegram больше 30 минут.
 * Отдельной таблицы уведомлений нет: их собирает сервер из истории клиентов (`client_contacts`) и `tg_chats`; помним
 * только, когда человек последний раз открывал колокольчик (`notice_seen`). В журнал — только действие.
 * Колокольчик ведущего (решение владельца 6 ноября 2026): каждому активному человеку команды — его мероприятия
 * (назначено, изменено, снято, отменено) из `host_notices`; без имени, телефона и адреса клиента. Там же (12 ноября 2026):
 * владельцу — «предоплата отмечена» и «верните предоплату», менеджеру, запросившему возврат, — «предоплата возвращена».
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { randomBytes } from "node:crypto";
import { dayTitle, rangeLabel } from "../../src/core/calendar";
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

/** Что случилось с мероприятием человека — вид записи колокольчика ведущего. */
export type HostNoticeKind = "created" | "changed" | "removed" | "cancelled" | "prepaid" | "refund" | "refunded";
export const HOST_NOTICE_TITLES: Record<HostNoticeKind, string> = {
  created: "📅 Вам назначено мероприятие",
  changed: "✏️ Мероприятие изменено",
  removed: "↩️ Мероприятие снято с вас",
  cancelled: "✖️ Мероприятие отменено",
  // Предоплата (решение владельца 12 ноября 2026): владельцу — отметка менеджера и просьба вернуть, менеджеру — «вернули».
  prepaid: "💰 Предоплата 2 000 ₽ отмечена — проверьте, что деньги пришли",
  refund: "💸 Верните предоплату 2 000 ₽ — клиент отказался",
  refunded: "✅ Предоплата возвращена клиенту",
};
function isHostNoticeKind(value: string): value is HostNoticeKind {
  return Object.prototype.hasOwnProperty.call(HOST_NOTICE_TITLES, value);
}

/**
 * Записать уведомление тому, кого касается мероприятие. Что и когда — на момент записи (потом мероприятие могут
 * изменить, а строка «снято с вас» должна говорить о прежнем). Назначил сам себя — записи нет.
 */
export async function recordHostNotice(
  sql: Sql,
  input: { kind: HostNoticeKind; userId: string; event: { id: string; title: string; day: string; start: number; end: number }; by: { id: string; name: string } },
): Promise<void> {
  const { kind, userId, event, by } = input;
  if (!userId || userId === by.id) return;
  await sql`insert into host_notices (id, user_id, event_id, kind, title, day, start_min, end_min, by_name)
    values (${randomBytes(12).toString("base64url")}, ${userId}, ${event.id}, ${kind}, ${event.title.slice(0, 200)}, ${event.day},
      ${event.start}, ${event.end}, ${by.name.slice(0, 120)})`;
}

/** Уведомления ведущих старше 90 дней не нужны (показываем 30) — ночная уборка их удаляет. */
export const HOST_NOTICE_KEEP_DAYS = 90;
export async function cleanupHostNotices(sql: Sql, now: number = Date.now()): Promise<number> {
  const rows = await sql`delete from host_notices where created_at < ${new Date(now - HOST_NOTICE_KEEP_DAYS * 86_400_000)} returning id`;
  return rows.length;
}

/** Строка мероприятия в колокольчике: «Свадьба — пятница, 20 ноября, 18:00–23:00». */
export function hostNoticeName(title: string, day: string, start: number, end: number): string {
  return `${title || "Мероприятие"} — ${dayTitle(day)}, ${rangeLabel(start, end)}`;
}

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

    async function member(request: FastifyRequest, reply: FastifyReply): Promise<{ id: string; clients: boolean } | null> {
      const user = await sessionUser(sql, request, reply);
      if (!user) {
        reply.code(401).send({ error: "unauthenticated" });
        return null;
      }
      if (!permissions.canSeeNotices(actorOf(user))) {
        reply.code(403).send({ error: "permission-denied" });
        return null;
      }
      return { id: user.id, clients: permissions.canManageClients(actorOf(user)) };
    }

    api.get("/api/notices", async (request, reply) => {
      const who = await member(request, reply);
      if (!who) return reply;
      const uid = who.id;
      reply.header("cache-control", "no-store");
      const [seen] = await sql<{ seen_at: Date }[]>`select seen_at from notice_seen where user_id = ${uid}`;
      const since = seen?.seen_at ?? new Date(Date.now() - FIRST_UNREAD_HOURS * 3_600_000);
      const mine = await sql<{ id: string; event_id: string; kind: string; title: string; day: string; start_min: number; end_min: number; by_name: string; created_at: Date }[]>`
        select id, event_id, kind, title, to_char(day, 'YYYY-MM-DD') as day, start_min, end_min, by_name, created_at
        from host_notices where user_id = ${uid} and created_at > now() - make_interval(days => ${NOTICE_DAYS})
        order by created_at desc limit ${NOTICE_LIMIT}`;
      const events: Notice[] = mine.map(
        (r): Notice => ({
          id: `ev-${r.id}`,
          clientId: "",
          eventId: r.event_id,
          kind: "event",
          title: isHostNoticeKind(r.kind) ? HOST_NOTICE_TITLES[r.kind] : "Мероприятие",
          name: hostNoticeName(r.title, r.day, r.start_min, r.end_min),
          line: r.by_name
            ? r.kind === "created"
              ? `Назначил(а): ${r.by_name}`
              : r.kind === "prepaid"
                ? `Отметил(а): ${r.by_name}`
                : r.kind === "refund"
                  ? `Запросил(а): ${r.by_name}`
                  : r.kind === "refunded"
                    ? `Вернул(а): ${r.by_name}`
                    : `Кто: ${r.by_name}`
            : "",
          at: r.created_at.getTime(),
          unread: r.created_at > since,
        }),
      );
      if (!who.clients) {
        return { unread: events.filter((i) => i.unread).length, items: events };
      }
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
      // Свои мероприятия — вместе с обращениями, по времени (ждущие ответа — сверху, как раньше).
      const merged = [...items.filter((i) => i.kind === "waiting"), ...[...items.filter((i) => i.kind !== "waiting"), ...events].sort((a, b) => b.at - a.at).slice(0, NOTICE_LIMIT)];
      return { unread: merged.filter((i) => i.unread).length, items: merged };
    });

    // Открыл колокольчик — всё, что пришло до этого, прочитано (ждущие ответа остаются, пока им не ответят).
    api.post("/api/notices/seen", { bodyLimit: 1024 }, async (request, reply) => {
      const who = await member(request, reply);
      if (!who) return reply;
      await sql`insert into notice_seen (user_id, seen_at) values (${who.id}, now())
        on conflict (user_id) do update set seen_at = now()`;
      request.log.info({ notices: "seen" }, "notices");
      return { ok: true };
    });
  });
}
