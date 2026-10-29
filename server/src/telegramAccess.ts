/**
 * Telegram и доступ человека (ревью 29 октября 2026): отключённому сотруднику бот больше ничего не шлёт, а Telegram для
 * бизнеса работает, только пока у подключившего есть право на клиентов. Отдельный модуль: его зовёт и вход (`auth.ts`),
 * и бот (`telegram.ts`), а они уже зависят друг от друга.
 */
import type { Sql } from "postgres";

/**
 * Снять Telegram для бизнеса, подключённый этим человеком: расчёты клиентов из его Telegram больше не попадают в
 * «Клиенты», «ждёт ответа» у его чатов снимается. Сами чаты клиентов (`tg_chats`) остаются — подключит снова, и бот
 * узнает их. Возвращает число снятых подключений.
 */
export async function dropBusinessOf(sql: Sql, userId: string): Promise<number> {
  const rows = await sql<{ key: string }[]>`
    delete from tg_state where key like 'biz:%' and (case when value like '{%' then (value::jsonb ->> 'owner') end) = ${userId}
    returning key`;
  const conns = rows.map((r) => r.key.slice("biz:".length));
  if (conns.length > 0) {
    await sql`update tg_chats set waiting_since = null, notified_at = null, updated_at = now() where conn_id = any(${conns})`;
  }
  return conns.length;
}

/** Отключили человека: его чат с ботом отвязан (уведомления не уходят на телефон, который мог остаться у него) и бизнес — тоже. */
export async function dropTelegramOf(sql: Sql, userId: string): Promise<void> {
  await sql`delete from tg_links where user_id = ${userId}`;
  await dropBusinessOf(sql, userId);
}
