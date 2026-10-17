/**
 * Бот уведомлений команды (CLAUDE.md, раздел 3, «Telegram команды»; решение владельца 14 октября 2026). Тот же бот,
 * что присылает заявки сайта (`LEAD_TELEGRAM_TOKEN`), — новых ключей и команд сервера не нужно.
 *
 * - Ведущий в студии жмёт «Подключить Telegram» → одноразовая ссылка t.me/<бот>?start=<код> → «Старт» в Telegram:
 *   сервер связывает чат с человеком (`tg_links`). /stop — отключить.
 * - Мероприятие назначено, изменено, снято или отменено — сообщение ведущему; напоминания за день (за сутки) и за 2 часа
 *   (`event_notices` — по одному на мероприятие, вид и время начала). Без имени, телефона и адреса клиента.
 * - Владелец или менеджер по продажам пересылает боту сообщение клиента или текст заявки — клиент попадает в базу клиентов.
 * - Новая заявка клиента (сайт, вопрос, запрос по QR) — менеджерам по продажам «Новая заявка» со ссылкой в студию
 *   (`salesNotice`), без имени, телефона и адреса: их видно только в студии. Владельцу заявки приходят как раньше.
 * - Telegram Business (решение владельца 17 октября 2026): владелец или менеджер подключает бота к своему Telegram
 *   («Настройки → Telegram для бизнеса → Чат-боты»). Клиент прислал ему расчёт с сайта («Расчёт JoyRest») — клиент сам
 *   попадает в базу с текстом расчёта, менеджерам — «Новый клиент из Telegram». Другие переписки бот не читает и не хранит.
 * - «Клиент ждёт ответа» (17 октября 2026): в чате такого клиента бот замечает его новые сообщения и ответ владельца (только время,
 *   без текста, `tg_chats`). Не ответили 30 минут — владельцу и менеджерам «⏰ Клиент ждёт ответа», с 9:00 до 22:00 по Москве.
 *
 * Сообщения бот читает через getUpdates (без вебхука и без открытых адресов). Читать может только одно окружение:
 * TELEGRAM_UPDATES=on у основной версии (compose); без переменной — только на тестовой (адреса test.*).
 * В журнал — только действие и итог, без текста сообщений, имён и номеров.
 */
import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { ORIGIN_TITLES, originOf, parseLinks } from "../../src/core/clients";
import { noticeText, parseLeadText, reminderDue, type NoticeKind } from "../../src/core/events";
import { todayMoscow } from "../../src/core/calendar";
import * as permissions from "../../src/data/permissions";
import type { AgencyEvent, TelegramStatus } from "../../src/data/types";
import { actorOf, apiGuard, sessionUser } from "./auth";
import { upsertClient } from "./clients";

const CODE_TTL_MS = 30 * 60_000;
const POLL_TIMEOUT_S = 25;
const REMIND_EVERY_MS = 60_000;
/** Через сколько без ответа напомнить, что клиент ждёт. */
export const ANSWER_WAIT_MIN = 30;

/** Напоминать о ждущем клиенте — днём, с 9:00 до 22:00 по Москве (ночью не будим). */
export function answerHoursOpen(ms: number): boolean {
  const hour = new Date(ms + 3 * 3_600_000).getUTCHours();
  return hour >= 9 && hour < 22;
}

/** «Клиент ждёт ответа» — без имени и телефона: их видно только в студии. */
export function waitingText(platformUrl: string): string {
  return `⏰ Клиент ждёт ответа в Telegram больше ${ANSWER_WAIT_MIN} минут.
Ответьте ему в Telegram или поставьте статус в студии.
${platformUrl}/studio/clients`;
}

/** Читать сообщения бота: явное on/off из TELEGRAM_UPDATES, без него — только тестовая версия (test.*). */
export function telegramPolling(value: string | undefined, siteHosts: string[]): boolean {
  const v = value?.trim().toLowerCase();
  if (v === "on") return true;
  if (v === "off") return false;
  return siteHosts.some((h) => h.startsWith("test."));
}

/** Состояние бота для владельца: читает ли он сообщения на самом деле. */
export interface BotHealth {
  polling: boolean;
  username: string | null;
  /** Когда последний раз Telegram ответил на чтение сообщений. */
  lastPollAt: number | null;
  /** ok — читает; conflict — сообщения читает другая программа (вебхук, другое окружение); error — нет ответа. */
  state: "ok" | "conflict" | "error" | "starting" | "off";
}

export interface Bot {
  /** Бот читает сообщения на этой версии (подключение Telegram работает). */
  polling: boolean;
  health(): Promise<BotHealth>;
  /** Напоминания сейчас (раз в минуту — само; для проверок). */
  remindNow(): Promise<void>;
  username(): Promise<string | null>;
  sendTo(userId: string, text: string): Promise<boolean>;
  /** Уведомить ведущего о мероприятии и отметить уже наступившие напоминания, чтобы они не пришли следом. */
  eventNotice(kind: NoticeKind, userId: string, event: Pick<AgencyEvent, "id" | "title" | "guests" | "day" | "start" | "end">, startsAt: Date): Promise<void>;
  /** Менеджерам по продажам с подключённым Telegram — о новой заявке (без данных клиента). Ответ — скольким ушло. */
  salesNotice(kind: SalesLeadKind): Promise<number>;
  /** Напомнить о клиентах, которые ждут ответа в Telegram (раз в минуту — само; для проверок). */
  waitingNow(): Promise<number>;
  stop(): void;
}

/** Журнал: только действие и итог (журнал приложения или console до его запуска). */
export interface BotLog {
  info(details: object, message: string): void;
  warn(details: object, message: string): void;
}

export interface BotOptions {
  sql: Sql;
  token: string;
  log: BotLog;
  polling: boolean;
  /** https://games.joy-rest.ru — ссылки в сообщениях. */
  platformUrl: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface TgUser {
  id?: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: TgUser;
  text?: string;
  caption?: string;
  forward_origin?: { type: string; sender_user?: TgUser; sender_user_name?: string };
  forward_from?: TgUser;
  forward_sender_name?: string;
  business_connection_id?: string;
}

/** Подключение бота к Telegram владельца или менеджера (Telegram Business). */
interface TgBusinessConnection {
  id: string;
  user: TgUser;
  user_chat_id: number;
  is_enabled: boolean;
}

/** Сообщение — расчёт с сайта JoyRest (калькулятор, витрина, /calc/). */
export function isCalcMessage(text: string): boolean {
  return /Расч[её]т\s+JoyRest/i.test(text);
}

/** Откуда новая заявка: с сайта, вопрос с сайта, запрос по QR-анкете. */
export type SalesLeadKind = "site" | "question" | "venue" | "telegram";

/** Текст «Новая заявка» для менеджера: что пришло и куда смотреть — без имени, телефона и адреса клиента. */
export function salesNoticeText(kind: SalesLeadKind, platformUrl: string): string {
  const what =
    kind === "site" ? "Новая заявка с сайта"
    : kind === "question" ? "Новый вопрос с сайта"
    : kind === "telegram" ? "Новый клиент прислал расчёт с сайта в Telegram"
    : "Новый запрос клиента по QR-анкете";
  const where = kind === "venue" ? `${platformUrl}/venues` : `${platformUrl}/studio/clients`;
  return `🔔 ${what}.
Свяжитесь с клиентом в течение 30 минут (в рабочее время) и поставьте статус «В работе».
${where}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function startBot(options: BotOptions): Bot {
  const { sql, token, log, platformUrl } = options;
  const f = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const base = `https://api.telegram.org/bot${token}`;
  let stopped = false;
  let me: string | null = null;
  let lastPollAt: number | null = null;
  let pollState: BotHealth["state"] = options.polling ? "starting" : "off";

  async function call(method: string, body: object, timeoutMs = 10_000): Promise<{ ok: boolean; status: number; result?: unknown }> {
    const res = await f(`${base}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown };
    return { ok: res.ok && data.ok === true, status: res.status, result: data.result };
  }

  async function sendChat(chatId: number | string, text: string): Promise<number> {
    try {
      const r = await call("sendMessage", { chat_id: chatId, text, link_preview_options: { is_disabled: true } });
      return r.ok ? 200 : r.status;
    } catch {
      return 0;
    }
  }

  async function username(): Promise<string | null> {
    if (me) return me;
    try {
      const r = await call("getMe", {});
      const u = r.result as { username?: string } | undefined;
      me = r.ok && u?.username ? u.username : null;
    } catch {
      me = null;
    }
    return me;
  }

  async function sendTo(userId: string, text: string): Promise<boolean> {
    const [link] = await sql<{ chat_id: string }[]>`select chat_id::text from tg_links where user_id = ${userId}`;
    if (!link) return false;
    const status = await sendChat(link.chat_id, text);
    // Человек заблокировал бота — отвязываем, чтобы в студии было видно «не подключён».
    if (status === 403) await sql`delete from tg_links where user_id = ${userId}`;
    log.info({ telegram: "send", result: status }, "telegram");
    return status === 200;
  }

  async function eventNotice(kind: NoticeKind, userId: string, event: Pick<AgencyEvent, "id" | "title" | "guests" | "day" | "start" | "end">, startsAt: Date): Promise<void> {
    if (kind === "created" || kind === "changed") {
      // Сутки или 2 часа уже наступили — отдельное напоминание следом не нужно.
      const due = reminderDue(startsAt.getTime(), now());
      const kinds = due === "hours" ? ["day", "hours"] : due === "day" ? ["day"] : [];
      for (const k of kinds) await sql`insert into event_notices (event_id, kind, starts_at) values (${event.id}, ${k}, ${startsAt}) on conflict do nothing`;
    }
    await sendTo(userId, noticeText(kind, event, platformUrl, now(), startsAt.getTime()));
  }

  async function salesNotice(kind: SalesLeadKind): Promise<number> {
    const rows = await sql<{ user_id: string }[]>`
      select l.user_id from tg_links l join users u on u.id = l.user_id where u.active and u.access_role = 'sales'`;
    let sent = 0;
    for (const r of rows) if (await sendTo(r.user_id, salesNoticeText(kind, platformUrl))) sent += 1;
    log.info({ telegram: "sales-notice", kind, sent }, "telegram");
    return sent;
  }

  // ───── напоминания ─────
  async function remind(): Promise<void> {
    const rows = await sql<{ id: string; host_id: string; title: string; guests: number | null; day: string; start_min: number; end_min: number; starts_at: Date }[]>`
      select e.id, e.host_id, e.title, e.guests, to_char(e.day, 'YYYY-MM-DD') as day, e.start_min, e.end_min, e.starts_at
      from events e join tg_links l on l.user_id = e.host_id
      where e.cancelled_at is null and e.starts_at > now() and e.starts_at <= now() + interval '24 hours'`;
    for (const r of rows) {
      const kind = reminderDue(r.starts_at.getTime(), now());
      if (!kind) continue;
      const fresh = await sql`insert into event_notices (event_id, kind, starts_at) values (${r.id}, ${kind}, ${r.starts_at})
        on conflict do nothing returning 1`;
      if (fresh.length === 0) continue;
      await sendTo(r.host_id, noticeText(kind, { title: r.title, guests: r.guests, day: r.day, start: r.start_min, end: r.end_min }, platformUrl, now(), r.starts_at.getTime()));
    }
  }
  /** Клиенты, которые ждут ответа в Telegram дольше получаса: владельцу (чей Telegram) и менеджерам — по одному разу. */
  async function waiting(): Promise<number> {
    if (!answerHoursOpen(now())) return 0;
    const rows = await sql<{ value: string }[]>`
      update tg_chats t set notified_at = now()
      from tg_state s
      where s.key = 'biz:' || t.conn_id and t.waiting_since is not null and t.notified_at is null
        and t.waiting_since < now() - make_interval(mins => ${ANSWER_WAIT_MIN})
      returning s.value`;
    if (rows.length === 0) return 0;
    const sales = await sql<{ user_id: string }[]>`
      select l.user_id from tg_links l join users u on u.id = l.user_id where u.active and u.access_role = 'sales'`;
    let sent = 0;
    for (const r of rows) {
      let owner = "";
      try {
        owner = String((JSON.parse(r.value) as { owner?: string }).owner ?? "");
      } catch {
        owner = "";
      }
      const to = new Set([owner, ...sales.map((s) => s.user_id)].filter(Boolean));
      for (const userId of to) if (await sendTo(userId, waitingText(platformUrl))) sent += 1;
    }
    log.info({ telegram: "waiting", chats: rows.length, sent }, "telegram");
    return sent;
  }

  const remindTimer = setInterval(() => {
    void remind().catch(() => log.warn({ telegram: "remind" }, "telegram: напоминания не отправились"));
    void waiting().catch(() => log.warn({ telegram: "waiting" }, "telegram: «клиент ждёт» не отправилось"));
  }, REMIND_EVERY_MS);
  remindTimer.unref?.();

  // ───── входящие сообщения ─────
  async function handle(m: TgMessage): Promise<void> {
    if (m.chat.type !== "private") return;
    const chatId = m.chat.id;
    const text = (m.text ?? m.caption ?? "").trim();
    const start = /^\/start(?:\s+([A-Za-z0-9_-]{8,64}))?$/.exec(text);
    if (start) {
      const code = start[1];
      if (!code) {
        await sendChat(chatId, "Это бот агентства JoyRest. Чтобы получать свои мероприятия и напоминания, откройте студию → «Мой профиль» → «Подключить Telegram».");
        return;
      }
      const [row] = await sql<{ user_id: string }[]>`delete from tg_codes where code = ${code} and expires_at > now() returning user_id`;
      if (!row) {
        await sendChat(chatId, "Ссылка устарела. Откройте студию → «Мой профиль» → «Подключить Telegram» ещё раз.");
        log.info({ telegram: "link", result: "expired" }, "telegram");
        return;
      }
      await sql.begin(async (tx) => {
        const t = tx as unknown as Sql;
        // Один чат — один человек: если этот Telegram был у другого, переносим.
        await t`delete from tg_links where chat_id = ${chatId} and user_id <> ${row.user_id}`;
        await t`insert into tg_links (user_id, chat_id, username) values (${row.user_id}, ${chatId}, ${m.from?.username ?? ""})
          on conflict (user_id) do update set chat_id = excluded.chat_id, username = excluded.username, linked_at = now()`;
      });
      log.info({ telegram: "link", result: "ok" }, "telegram");
      const [u] = await sql<{ role: string; access_role: string | null }[]>`select role, access_role from users where id = ${row.user_id}`;
      const ownerHint = permissions.canManageClients({ uid: row.user_id, role: u?.role === "admin" ? "admin" : "host", active: true, accessRole: u?.access_role ?? null })
        ? "\n\nКлиенты: перешлите сюда сообщение клиента или текст заявки — клиент попадёт в базу клиентов.\n\nЕщё удобнее: подключите этого бота к своему Telegram («Настройки» → «Telegram для бизнеса» → «Чат-боты»). Тогда расчёты с сайта, которые клиенты присылают вам, сами попадут в «Клиенты»."
        : "";
      await sendChat(chatId, `✅ Telegram подключён. Сюда будут приходить ваши мероприятия JoyRest: назначение, изменения, отмена и напоминания за день (за сутки) и за 2 часа.\n\nОтключить — /stop${ownerHint}`);
      return;
    }
    const [link] = await sql<{ user_id: string; role: string; active: boolean; access_role: string | null }[]>`
      select l.user_id, u.role, u.active, u.access_role from tg_links l join users u on u.id = l.user_id where l.chat_id = ${chatId}`;
    if (text === "/stop") {
      await sql`delete from tg_links where chat_id = ${chatId}`;
      await sendChat(chatId, "Telegram отключён: уведомления больше не придут. Подключить снова — в студии, «Мой профиль».");
      log.info({ telegram: "unlink" }, "telegram");
      return;
    }
    if (!link) {
      await sendChat(chatId, "Это бот агентства JoyRest. Чтобы получать свои мероприятия и напоминания, откройте студию → «Мой профиль» → «Подключить Telegram».");
      return;
    }
    const owner = permissions.canManageClients({ uid: link.user_id, role: link.role === "admin" ? "admin" : "host", active: link.active, accessRole: link.access_role });
    if (!owner) {
      await sendChat(chatId, "Сюда приходят ваши мероприятия JoyRest и напоминания. Подробности — в студии. Отключить — /stop.");
      return;
    }
    await saveClient(m, chatId, text);
  }

  /** Владелец переслал сообщение клиента или текст заявки — клиент в базу. */
  async function saveClient(m: TgMessage, chatId: number, text: string): Promise<void> {
    const sender = m.forward_origin?.sender_user ?? m.forward_from;
    const senderName = [sender?.first_name, sender?.last_name].filter(Boolean).join(" ") || m.forward_origin?.sender_user_name || m.forward_sender_name || "";
    const fill = parseLeadText(text, todayMoscow(now()));
    const links = parseLinks(text);
    if (sender?.username) links.unshift(`https://t.me/${sender.username}`);
    const summary = [fill.title, fill.guests ? `${fill.guests} гостей` : "", fill.day ?? ""].filter(Boolean).join(", ") || text.slice(0, 120);
    const id = await upsertClient(sql, {
      name: fill.clientName || senderName,
      phone: fill.clientPhone ?? "",
      links,
      source: "telegram",
      summary,
      ref: `tg-${chatId}-${m.message_id}`,
      origin: originOf(text) ?? "telegram",
    });
    log.info({ telegram: "client", result: id ? "ok" : "no-contact" }, "telegram");
    if (!id) {
      await sendChat(chatId, "Не нашёл ни телефона, ни ссылки на Telegram, ВКонтакте или Instagram — клиента не добавил. Перешлите сообщение самого клиента или текст с его телефоном.");
      return;
    }
    const got = [fill.clientName || senderName ? "имя" : "", fill.clientPhone ? "телефон" : "", links.length ? "ссылка" : "", fill.title ? "что за мероприятие" : ""].filter(Boolean);
    await sendChat(chatId, `✅ Клиент в базе (${got.join(", ")}).\n${platformUrl}/studio/clients`);
  }

  // ───── Telegram Business: расчёты, которые клиенты пишут владельцу или менеджеру ─────
  /** Кто подключил бота: владелец или менеджер с подключённым в студии Telegram. */
  async function businessOwner(chatId: number): Promise<string | null> {
    const [link] = await sql<{ user_id: string; role: string; active: boolean; access_role: string | null }[]>`
      select l.user_id, u.role, u.active, u.access_role from tg_links l join users u on u.id = l.user_id where l.chat_id = ${chatId}`;
    if (!link) return null;
    return permissions.canManageClients({ uid: link.user_id, role: link.role === "admin" ? "admin" : "host", active: link.active, accessRole: link.access_role }) ? link.user_id : null;
  }

  async function handleConnection(c: TgBusinessConnection, quiet = false): Promise<void> {
    const key = `biz:${c.id}`;
    unknownConnections.delete(c.id);
    if (!c.is_enabled) {
      await sql`delete from tg_state where key = ${key}`;
      // Бот больше не видит этот Telegram — ответы не узнать, «ждёт ответа» снимаем.
      await sql`update tg_chats set waiting_since = null, notified_at = null, updated_at = now() where conn_id = ${c.id}`;
      if (!quiet) await sendChat(c.user_chat_id, "Бот JoyRest отключён от вашего Telegram: расчёты клиентов больше не попадают в «Клиенты» сами.");
      log.info({ telegram: "business", result: "off" }, "telegram");
      return;
    }
    const owner = await businessOwner(c.user_chat_id);
    if (!owner) {
      await sql`delete from tg_state where key = ${key}`;
      if (!quiet) {
        await sendChat(
          c.user_chat_id,
          "Бот JoyRest подключён к вашему Telegram, но клиенты сюда пока не попадут: сначала подключите Telegram в студии («Мой профиль» → «Уведомления в Telegram»), потом в настройках Telegram отключите и снова подключите бота.",
        );
      }
      log.info({ telegram: "business", result: "not-allowed" }, "telegram");
      return;
    }
    const value = JSON.stringify({ user: c.user.id ?? c.user_chat_id, chat: c.user_chat_id, owner });
    await sql`insert into tg_state (key, value) values (${key}, ${value}) on conflict (key) do update set value = excluded.value`;
    if (!quiet) {
      await sendChat(
        c.user_chat_id,
        `✅ Бот JoyRest подключён к вашему Telegram.\n\nКогда клиент пришлёт вам расчёт с сайта («Расчёт JoyRest»), он сам попадёт в «Клиенты» вместе с расчётом, а менеджерам придёт уведомление. Другие переписки бот не читает и не хранит.\n${platformUrl}/studio/clients`,
      );
    }
    log.info({ telegram: "business", result: "on" }, "telegram");
  }

  /** Подключения, которых Telegram не знает или которые нам не подходят, — не спрашиваем о них на каждое сообщение. */
  const unknownConnections = new Set<string>();

  async function connectionOf(id: string): Promise<{ user: number; chat: number } | null> {
    const read = async () => {
      const [row] = await sql<{ value: string }[]>`select value from tg_state where key = ${`biz:${id}`}`;
      try {
        return row ? (JSON.parse(row.value) as { user: number; chat: number }) : null;
      } catch {
        return null;
      }
    };
    const known = await read();
    if (known) return known;
    if (unknownConnections.has(id)) return null;
    // Бота подключили, пока сервер не читал сообщения, — спросим Telegram, кто это.
    try {
      const r = await call("getBusinessConnection", { business_connection_id: id });
      if (r.ok && r.result) await handleConnection(r.result as TgBusinessConnection, true);
    } catch {
      return null;
    }
    const found = await read();
    if (!found) unknownConnections.add(id);
    return found;
  }

  async function handleBusiness(m: TgMessage): Promise<void> {
    const connId = m.business_connection_id;
    if (!connId || m.chat.type !== "private") return;
    const text = (m.text ?? m.caption ?? "").trim();
    const calc = isCalcMessage(text);
    const conn = await connectionOf(connId);
    if (!conn) return;
    const from = m.from;
    const chatId = m.chat.id;
    if (!from || chatId === conn.chat) return;
    // Владелец ответил клиенту — клиент больше не ждёт. Текст ответа не читаем.
    if (from.id === conn.user) {
      await sql`update tg_chats set waiting_since = null, notified_at = null, updated_at = now()
        where conn_id = ${connId} and chat_id = ${chatId} and waiting_since is not null`;
      return;
    }
    // Новый человек пишет по ссылке для бизнеса с готовым текстом («Пишу с Авито», «по вашей визитке», «был(а) на
    // празднике») — тоже клиент, с источником. Остальную переписку не трогаем.
    const marked = calc ? null : originOf(text);
    if (!calc) {
      // Клиент из базы написал ещё — ждёт ответа (только время). Чужие чаты (не клиенты) сюда не попадают.
      const known = await sql`update tg_chats set waiting_since = coalesce(waiting_since, now()), updated_at = now()
        where conn_id = ${connId} and chat_id = ${chatId} returning 1`;
      if (known.length > 0 || !marked) return;
    }
    const links = parseLinks(text);
    links.unshift(from.username ? `https://t.me/${from.username}` : `tg://user?id=${from.id ?? m.chat.id}`);
    const id = await upsertClient(sql, {
      name: [from.first_name, from.last_name].filter(Boolean).join(" "),
      phone: "",
      links,
      source: "telegram",
      summary: calc ? `Расчёт с сайта — прислал в Telegram:\n${text}` : `Написал в Telegram (${ORIGIN_TITLES[marked ?? "telegram"]}):\n${text}`,
      ref: `tgb-${m.chat.id}-${m.message_id}`,
      origin: calc ? (originOf(text) ?? "site") : marked,
    });
    log.info({ telegram: "business-client", result: id ? "ok" : "no-contact" }, "telegram");
    if (!id) return;
    await sql`insert into tg_chats (conn_id, chat_id, client_id, waiting_since) values (${connId}, ${chatId}, ${id}, now())
      on conflict (conn_id, chat_id) do update set client_id = excluded.client_id,
        waiting_since = coalesce(tg_chats.waiting_since, now()), updated_at = now()`;
    await salesNotice("telegram");
  }

  async function poll(): Promise<void> {
    const [state] = await sql<{ value: string }[]>`select value from tg_state where key = 'offset'`.catch(() => []);
    let offset = Number(state?.value) || 0;
    while (!stopped) {
      try {
        const r = await call("getUpdates", { offset, timeout: POLL_TIMEOUT_S, allowed_updates: ["message", "business_connection", "business_message"] }, (POLL_TIMEOUT_S + 10) * 1000);
        if (r.status === 409) pollState = "conflict";
        else if (r.ok) {
          pollState = "ok";
          lastPollAt = now();
        } else pollState = "error";
        if (r.status === 409) {
          // Сообщения бота читает кто-то ещё (другое окружение или вебхук) — не мешаем.
          log.warn({ telegram: "poll", result: 409 }, "telegram: сообщения бота читает другая программа");
          await sleep(60_000);
          continue;
        }
        if (!r.ok) {
          await sleep(10_000);
          continue;
        }
        const updates = Array.isArray(r.result)
          ? (r.result as Array<{ update_id: number; message?: TgMessage; business_connection?: TgBusinessConnection; business_message?: TgMessage }>)
          : [];
        for (const u of updates) {
          offset = u.update_id + 1;
          const fail = () => log.warn({ telegram: "handle" }, "telegram: сообщение не обработано");
          if (u.message) await handle(u.message).catch(fail);
          if (u.business_connection) await handleConnection(u.business_connection).catch(fail);
          if (u.business_message) await handleBusiness(u.business_message).catch(fail);
        }
        if (updates.length > 0) {
          await sql`insert into tg_state (key, value) values ('offset', ${String(offset)}) on conflict (key) do update set value = excluded.value`;
        }
      } catch {
        pollState = "error";
        if (!stopped) await sleep(5_000);
      }
    }
  }
  if (options.polling) void poll();

  return {
    polling: options.polling,
    async health() {
      return { polling: options.polling, username: await username(), lastPollAt, state: pollState };
    },
    remindNow: remind,
    username,
    sendTo,
    eventNotice,
    salesNotice,
    waitingNow: waiting,
    stop() {
      stopped = true;
      clearInterval(remindTimer);
    },
  };
}

export interface TelegramRoutesOptions {
  sql: Sql;
  isSite?: (request: FastifyRequest) => boolean;
  bot: Bot | null;
}

/** Подключение своего Telegram в студии: статус, одноразовая ссылка, отключение. */
export function registerTelegram(app: FastifyInstance, options: TelegramRoutesOptions): void {
  const { sql, bot } = options;
  app.register(async (api) => {
    api.addHook("onRequest", apiGuard(options.isSite));

    async function member(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
      const user = await sessionUser(sql, request, reply);
      if (!user) {
        reply.code(401).send({ error: "unauthenticated" });
        return null;
      }
      if (!permissions.canLinkTelegram(actorOf(user))) {
        reply.code(403).send({ error: "permission-denied" });
        return null;
      }
      return user.id;
    }

    api.get("/api/telegram/me", async (request, reply): Promise<TelegramStatus | FastifyReply> => {
      const uid = await member(request, reply);
      if (!uid) return reply;
      const [link] = await sql<{ username: string }[]>`select username from tg_links where user_id = ${uid}`;
      return { available: Boolean(bot?.polling), linked: Boolean(link), username: link?.username ?? "" };
    });

    // Владельцу: бот на связи? (имя бота, читает ли сообщения, когда последний раз).
    api.get("/api/telegram/health", async (request, reply) => {
      const user = await sessionUser(sql, request, reply);
      if (!user) return reply.code(401).send({ error: "unauthenticated" });
      if (!permissions.canManageClients(actorOf(user))) return reply.code(403).send({ error: "permission-denied" });
      const [links] = await sql<{ count: number }[]>`select count(*)::int as count from tg_links`;
      const health: BotHealth = bot ? await bot.health() : { polling: false, username: null, lastPollAt: null, state: "off" };
      return { ...health, configured: Boolean(bot), linkedPeople: links?.count ?? 0 };
    });

    api.post("/api/telegram/link", { bodyLimit: 1024 }, async (request, reply) => {
      const uid = await member(request, reply);
      if (!uid) return reply;
      const name = bot?.polling ? await bot.username() : null;
      if (!name) return reply.code(503).send({ error: "unavailable" });
      const code = randomBytes(18).toString("base64url");
      await sql`delete from tg_codes where user_id = ${uid} or expires_at < now()`;
      await sql`insert into tg_codes (code, user_id, expires_at) values (${code}, ${uid}, ${new Date(Date.now() + CODE_TTL_MS)})`;
      return { url: `https://t.me/${name}?start=${code}` };
    });

    api.delete("/api/telegram/me", { bodyLimit: 1024 }, async (request, reply) => {
      const uid = await member(request, reply);
      if (!uid) return reply;
      await sql`delete from tg_links where user_id = ${uid}`;
      return { ok: true };
    });
  });
}
