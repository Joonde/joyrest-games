/**
 * Бот уведомлений на PostgreSQL с «Telegram понарошку»: два ведущих нажимают «Старт» каждый в своём чате — каждому
 * приходят только его мероприятия, без имени, телефона и адреса клиента; напоминания за день и за 2 часа — по одному разу; /stop
 * отключает; владелец пересылает сообщение клиента — клиент в базе; чужой чат получает подсказку.
 */
import { resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAdminPassword } from "./admin-password";
import { buildApp } from "./app";
import { migrate } from "./migrate";
import { answerHoursOpen, startBot, type Bot } from "./telegram";

interface Sent {
  chat: number;
  text: string;
  /** callback_data кнопок под сообщением. */
  buttons: string[];
}

/** Telegram понарошку: getMe, getUpdates (очередь входящих), sendMessage (журнал отправленного). */
function fakeTelegram() {
  const inbox: Array<{ update_id: number } & Record<string, object | number>> = [];
  const sent: Sent[] = [];
  /** Кнопки, которые бот поменял под отправленными сообщениями (номер сообщения = номер в `sent` с 1). */
  const edits: Array<{ chat: number; message: number; label: string | null }> = [];
  let id = 0;
  const reply = (body: unknown) => new Response(JSON.stringify({ ok: true, result: body }), { status: 200, headers: { "content-type": "application/json" } });
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (url.endsWith("/getMe")) return reply({ username: "joyrest_test_bot" });
    if (url.endsWith("/sendMessage")) {
      const markup = body.reply_markup as { inline_keyboard?: Array<Array<{ callback_data?: string }>> } | undefined;
      sent.push({ chat: Number(body.chat_id), text: String(body.text), buttons: (markup?.inline_keyboard ?? []).flat().map((b) => String(b.callback_data ?? "")) });
      return reply({ message_id: sent.length });
    }
    if (url.endsWith("/editMessageReplyMarkup")) {
      const markup = body.reply_markup as { inline_keyboard?: Array<Array<{ text?: string }>> } | undefined;
      edits.push({ chat: Number(body.chat_id), message: Number(body.message_id), label: (markup?.inline_keyboard ?? []).flat()[0]?.text ?? null });
      return reply(true);
    }
    if (url.endsWith("/answerCallbackQuery")) return reply(true);
    if (url.endsWith("/getUpdates")) {
      const offset = Number(body.offset ?? 0);
      const ready = inbox.filter((u) => u.update_id >= offset);
      if (ready.length === 0) await new Promise((r) => setTimeout(r, 30));
      return reply(ready);
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return {
    fetchImpl,
    sent,
    edits,
    push(chat: number, text: string, extra: object = {}) {
      id += 1;
      inbox.push({ update_id: id, message: { message_id: id, chat: { id: chat, type: "private" }, from: { username: `user${chat}` }, text, ...extra } });
    },
    /** Любое обновление Telegram: подключение бота к бизнес-аккаунту, сообщение клиента бизнес-аккаунту. */
    update(body: Record<string, object>) {
      id += 1;
      inbox.push({ update_id: id, ...body });
    },
  };
}

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("бот уведомлений: каждому — свои мероприятия", () => {
  const SCHEMA = "telegram_test";
  const admin = postgres(url ?? "", { max: 1, onnotice: () => {} });
  const sql = postgres(url ?? "", { max: 3, onnotice: () => {}, connection: { search_path: SCHEMA } });
  const tg = fakeTelegram();
  const log = { info: () => undefined, warn: () => undefined };
  let bot: Bot;
  let app: ReturnType<typeof buildApp>;
  const HOST = "games.test";
  let owner = "";
  let anna = "";
  let annaId = "";
  let boris = "";
  let borisId = "";
  const ANNA = 111;
  const BORIS = 222;
  const OWNER = 999;
  const day = (n: number) => new Date(Date.now() + 3 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);

  const cookieOf = (res: { headers: Record<string, unknown> }) => {
    const raw = res.headers["set-cookie"];
    return (Array.isArray(raw) ? String(raw[0]) : String(raw ?? "")).split(";")[0] ?? "";
  };
  const headers = (cookie: string) => ({ host: HOST, "x-joyrest": "1", origin: `https://${HOST}`, cookie });
  const post = (path: string, cookie: string, payload: object = {}) => app.inject({ method: "POST", url: path, headers: headers(cookie), payload });
  const get = (path: string, cookie: string) => app.inject({ method: "GET", url: path, headers: { host: HOST, cookie } });
  const login = async (email: string, password: string) => cookieOf(await post("/api/auth/login", "", { email, password }));
  const to = (chat: number) => tg.sent.filter((m) => m.chat === chat).map((m) => m.text);
  async function until(check: () => Promise<boolean> | boolean, label: string) {
    for (let i = 0; i < 100; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`не дождались: ${label}`);
  }
  /** «Подключить Telegram» в студии → код из ссылки → «Старт» в своём чате. */
  async function connect(cookie: string, chat: number) {
    const link = (await post("/api/telegram/link", cookie)).json() as { url: string };
    expect(link.url).toMatch(/^https:\/\/t\.me\/joyrest_test_bot\?start=[A-Za-z0-9_-]{20,}$/);
    tg.push(chat, `/start ${link.url.split("start=")[1]}`);
    await until(async () => (await get("/api/telegram/me", cookie)).json().linked === true, `подключение чата ${chat}`);
  }

  beforeAll(async () => {
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.unsafe(`create schema ${SCHEMA}`);
    await migrate(sql, resolve(import.meta.dirname, "../migrations"));
    bot = startBot({ sql, token: "test-token", log, polling: true, platformUrl: "https://games.test", fetchImpl: tg.fetchImpl });
    app = buildApp({ version: "t", publicDir: null, checkDatabase: async () => true, sql, bot, auth: { limits: { perAccount: 1000, perIp: 1000, deviceDelayMs: () => 0 } } });
    await setAdminPassword(sql, "owner@example.com", "пароль-владельца-12");
    owner = await login("owner@example.com", "пароль-владельца-12");
    const a = (await post("/api/users", owner, { email: "anna@example.com", name: "Анна" })).json();
    annaId = a.account.uid;
    anna = await login("anna@example.com", a.temporaryPassword);
    const b = (await post("/api/users", owner, { email: "boris@example.com", name: "Борис" })).json();
    borisId = b.account.uid;
    boris = await login("boris@example.com", b.temporaryPassword);
  });

  afterAll(async () => {
    bot.stop();
    await app.close();
    await sql.end();
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  it("каждый ведущий подключает свой Telegram; бот отвечает «подключён»; владелец видит «на связи»", async () => {
    await connect(anna, ANNA);
    await connect(boris, BORIS);
    expect(to(ANNA).at(-1)).toContain("Telegram подключён");
    expect(to(BORIS).at(-1)).toContain("Telegram подключён");
    expect(to(ANNA).at(-1)).not.toContain("перешлите сюда сообщение клиента");
    const health = (await get("/api/telegram/health", owner)).json();
    expect(health).toMatchObject({ configured: true, polling: true, username: "joyrest_test_bot", state: "ok", linkedPeople: 2 });
    expect((await get("/api/telegram/health", anna)).statusCode).toBe(403);
  });

  it("назначение, перенос на другого и отмена — каждому своё, без данных клиента", async () => {
    const event = { id: "ev1", hostId: annaId, day: day(10), start: 1080, end: 1380, title: "Свадьба", clientName: "Ольга", clientPhone: "+7 999 111-22-33", place: "ул. Тайная, 7", guests: 60, note: "" };
    const before = { anna: to(ANNA).length, boris: to(BORIS).length };
    expect((await post("/api/events", owner, event)).statusCode).toBe(200);
    await until(() => to(ANNA).length === before.anna + 1, "уведомление Анне");
    const created = to(ANNA).at(-1) ?? "";
    expect(created).toContain("Вам назначено мероприятие");
    expect(created).toContain("Свадьба · 60 гостей");
    expect(created).toContain("18:00–23:00");
    expect(created).toContain("https://games.test/studio/calendar?tab=events");
    for (const secret of ["Ольга", "111-22-33", "Тайная"]) expect(created).not.toContain(secret);
    expect(to(BORIS)).toHaveLength(before.boris);

    // Правка без смены времени и вида (комментарий) — без уведомления; смена времени — «изменено».
    await post("/api/events", owner, { ...event, note: "торт в 21:00" });
    await post("/api/events", owner, { ...event, note: "торт в 21:00", start: 1140 });
    await until(() => to(ANNA).length === before.anna + 2, "«изменено» Анне");
    expect(to(ANNA).at(-1)).toContain("Мероприятие изменено");

    // Передали Борису: Анне — «больше не за вами», Борису — «назначено».
    await post("/api/events", owner, { ...event, start: 1140, hostId: borisId });
    await until(() => to(ANNA).length === before.anna + 3 && to(BORIS).length === before.boris + 1, "перенос на Бориса");
    expect(to(ANNA).at(-1)).toContain("больше не за вами");
    expect(to(BORIS).at(-1)).toContain("Вам назначено мероприятие");

    await post("/api/events/ev1/cancel", owner);
    await until(() => to(BORIS).length === before.boris + 2, "отмена Борису");
    expect(to(BORIS).at(-1)).toContain("Мероприятие отменено");
    expect(to(ANNA)).toHaveLength(before.anna + 3);
  });

  it("«Принял, готовлюсь»: кнопка в Telegram и в студии — одна отметка; новая программа — новая кнопка, старая не засчитывается", async () => {
    const program = { formats: ["Квиз", "Музыкальный"], extension: "30 мин", addons: ["Призы и медали"], duration: "≈ 3–3,5 часа" };
    const event = { id: "ev5", hostId: borisId, day: day(11), start: 1140, end: 1350, title: "Выпускной", clientName: "Ольга", clientPhone: "+7 999 555-44-33", place: "", guests: 40, note: "", program };
    const n = to(BORIS).length;
    expect((await post("/api/events", owner, event)).statusCode).toBe(200);
    await until(() => to(BORIS).length === n + 1, "назначение с программой");
    const msg = tg.sent.filter((m) => m.chat === BORIS).at(-1);
    expect(msg?.text).toContain("🎯 Программа: 1 · Квиз → 2 · Музыкальный · продление 30 мин");
    expect(msg?.text).not.toContain("Ольга");
    expect(msg?.buttons).toEqual(["acc:ev5:1"]);
    const mine = async () => ((await get("/api/events?scope=upcoming", boris)).json().events as Array<{ id: string; acceptedAt: number | null; acceptRev: number; program: unknown }>).find((e) => e.id === "ev5");
    expect(await mine()).toMatchObject({ acceptedAt: null, acceptRev: 1, program });

    // Нажал в Telegram — отметка ставится; ещё раз в студии — время первого нажатия не меняется.
    tg.update({ callback_query: { id: "cb1", from: { id: BORIS }, data: "acc:ev5:1", message: { message_id: 1, chat: { id: BORIS } } } });
    await until(async () => Boolean((await mine())?.acceptedAt), "принял в Telegram");
    const first = (await mine())?.acceptedAt;
    expect((await post("/api/events/ev5/accept", boris, { rev: 1 })).statusCode).toBe(200);
    expect((await mine())?.acceptedAt).toBe(first);
    expect((await post("/api/events/ev5/accept", anna, { rev: 1 })).statusCode).toBe(403);

    // Комментарий поменяли — отметка остаётся, сообщений нет.
    await post("/api/events", owner, { ...event, note: "торт в 22:00" });
    await new Promise((r) => setTimeout(r, 200));
    expect(to(BORIS)).toHaveLength(n + 1);
    expect((await mine())?.acceptedAt).toBe(first);

    // Программу поменяли — отметка снимается, новое сообщение с новой кнопкой; старая кнопка не засчитывается.
    await post("/api/events", owner, { ...event, note: "торт в 22:00", program: { ...program, extension: "1 ч" } });
    await until(() => to(BORIS).length === n + 2, "«изменено» с новой кнопкой");
    expect(tg.sent.filter((m) => m.chat === BORIS).at(-1)?.buttons).toEqual(["acc:ev5:2"]);
    expect(await mine()).toMatchObject({ acceptedAt: null, acceptRev: 2 });
    tg.update({ callback_query: { id: "cb2", from: { id: BORIS }, data: "acc:ev5:1", message: { message_id: 1, chat: { id: BORIS } } } });
    await new Promise((r) => setTimeout(r, 300));
    expect((await mine())?.acceptedAt).toBeNull();
    expect((await post("/api/events/ev5/accept", boris, { rev: 1 })).statusCode).toBe(409);
    expect((await post("/api/events/ev5/accept", boris, { rev: 2 })).statusCode).toBe(200);
    expect((await mine())?.acceptedAt).toBeGreaterThan(0);

    // Принял в студии — кнопка последнего сообщения в Telegram стала «✅ Принято …».
    const askMsg = tg.sent.lastIndexOf(tg.sent.filter((m) => m.chat === BORIS).at(-1) as Sent) + 1;
    await until(() => tg.edits.some((e) => e.message === askMsg && e.label?.startsWith("✅ Принято") === true), "кнопка «Принято» после студии");

    // Отменили — принять нельзя, кнопка убрана.
    const n2 = to(BORIS).length;
    await post("/api/events/ev5/cancel", owner);
    expect((await post("/api/events/ev5/accept", boris, { rev: 2 })).statusCode).toBe(409);
    await until(() => to(BORIS).length === n2 + 1 && tg.edits.some((e) => e.message === askMsg && e.label === null), "отмена убрала кнопку");

    // Вернули — снова «Назначено» с новой кнопкой; повтор «Вернуть» (двойное касание) отметку не снимает и не пишет.
    expect((await post("/api/events/ev5/restore", owner)).statusCode).toBe(200);
    await until(() => to(BORIS).length === n2 + 2, "вернули — назначено");
    expect(tg.sent.filter((m) => m.chat === BORIS).at(-1)?.buttons).toEqual(["acc:ev5:3"]);
    expect((await post("/api/events/ev5/accept", boris, { rev: 3 })).statusCode).toBe(200);
    const accepted = (await mine())?.acceptedAt;
    expect((await post("/api/events/ev5/restore", owner)).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 200));
    expect(await mine()).toMatchObject({ acceptedAt: accepted, acceptRev: 3 });
    expect(to(BORIS)).toHaveLength(n2 + 2);

    // Окружение, которое не читает нажатия (тестовая версия): сообщение без кнопки — «Принял» только в студии.
    const quiet = startBot({ sql, token: "test-token", log, polling: false, platformUrl: "https://games.test", fetchImpl: tg.fetchImpl });
    try {
      const sent = tg.sent.length;
      await quiet.eventNotice("changed", borisId, { id: "ev5", title: "Выпускной", guests: 40, day: day(11), start: 1140, end: 1350, acceptedAt: null, acceptRev: 4 }, new Date(Date.now() + 11 * 86_400_000));
      expect(tg.sent.length).toBe(sent + 1);
      expect(tg.sent.at(-1)?.buttons).toEqual([]);
    } finally {
      quiet.stop();
    }
  });

  it("напоминание за сутки — один раз; начавшееся скоро сразу после назначения — без дубля", async () => {
    // Мероприятие через 20 часов, записанное напрямую (как давно назначенное): напоминание «через сутки».
    const at = new Date(Date.now() + 20 * 3_600_000);
    const msk = new Date(at.getTime() + 3 * 3_600_000);
    const d = msk.toISOString().slice(0, 10);
    const startMin = msk.getUTCHours() * 60 + msk.getUTCMinutes();
    await sql`insert into events (id, host_id, day, start_min, end_min, starts_at, ends_at, title, guests)
      values ('ev2', ${annaId}, ${d}, ${startMin}, ${startMin + 60}, ${at}, ${new Date(at.getTime() + 3_600_000)}, 'Корпоратив', 30)`;
    const n = to(ANNA).length;
    await bot.remindNow();
    await bot.remindNow();
    expect(to(ANNA)).toHaveLength(n + 1);
    expect(to(ANNA).at(-1)).toContain("Напоминание: мероприятие завтра");
    expect(to(BORIS).some((t) => t.includes("Корпоратив"))).toBe(false);
    // Наступили последние 2 часа — второе напоминание «через 2 ч», тоже один раз.
    const near = new Date(Date.now() + 2 * 3_600_000 - 5 * 60_000);
    await sql`update events set starts_at = ${near} where id = 'ev2'`;
    await sql`delete from event_notices where event_id = 'ev2'`;
    await sql`insert into event_notices (event_id, kind, starts_at) values ('ev2', 'day', ${near})`;
    await bot.remindNow();
    await bot.remindNow();
    expect(to(ANNA)).toHaveLength(n + 2);
    expect(to(ANNA).at(-1)).toContain("Через 2 ч начало мероприятия");

    // Назначено за 2 часа до начала: приходит «назначено», напоминания следом не дублируют.
    const soon = new Date(Date.now() + 90 * 60_000);
    const sm = new Date(soon.getTime() + 3 * 3_600_000);
    const sMin = Math.ceil((sm.getUTCHours() * 60 + sm.getUTCMinutes()) / 15) * 15;
    if (sMin < 1440 - 60) {
      const m = to(BORIS).length;
      await post("/api/events", owner, { id: "ev3", hostId: borisId, day: sm.toISOString().slice(0, 10), start: sMin, end: sMin + 60, title: "Квиз", clientName: "", clientPhone: "", place: "", guests: null, note: "" });
      await until(() => to(BORIS).length === m + 1, "назначение Борису");
      await bot.remindNow();
      expect(to(BORIS)).toHaveLength(m + 1);
    }
  });

  it("чужой чат — подсказка; /stop — уведомления больше не приходят", async () => {
    tg.push(333, "привет");
    await until(() => to(333).length === 1, "ответ незнакомцу");
    expect(to(333)[0]).toContain("Подключить Telegram");
    tg.push(ANNA, "/stop");
    await until(async () => (await get("/api/telegram/me", anna)).json().linked === false, "отключение Анны");
    const n = to(ANNA).length;
    await post("/api/events", owner, { id: "ev4", hostId: annaId, day: day(12), start: 1080, end: 1200, title: "Юбилей", clientName: "", clientPhone: "", place: "", guests: null, note: "" });
    await new Promise((r) => setTimeout(r, 300));
    expect(to(ANNA)).toHaveLength(n);
  });

  it("владелец пересылает боту сообщение клиента — клиент в базе; ведущему так нельзя", async () => {
    await connect(owner, OWNER);
    expect(to(OWNER).at(-1)).toContain("перешлите сюда сообщение клиента");
    tg.push(OWNER, "Здравствуйте! Хотим корпоратив 12.12, нас 35 человек. Мой телефон 8 901 222-33-44", {
      forward_origin: { type: "user", sender_user: { first_name: "Ира", username: "ira_party" } },
    });
    await until(() => to(OWNER).some((t) => t.includes("Клиент в базе")), "клиент в базе");
    const clients = (await get("/api/clients", owner)).json().clients as Array<{ name: string; phone: string; links: string[] }>;
    expect(clients.find((c) => c.name === "Ира")).toMatchObject({ links: ["https://t.me/ira_party"] });
    const n = (await get("/api/clients", owner)).json().clients.length;
    tg.push(BORIS, "Телефон клиента 8 902 000-00-00");
    await until(() => to(BORIS).some((t) => t.includes("Сюда приходят ваши мероприятия")), "ответ ведущему");
    expect((await get("/api/clients", owner)).json().clients).toHaveLength(n);
  });

  it("менеджер по продажам: «Новая заявка» без данных клиента только ему; пересланное сообщение — клиент в базе", async () => {
    const SALES = 444;
    const m = (await post("/api/users", owner, { email: "sales@example.com", name: "Мария" })).json();
    expect((await post(`/api/users/${m.account.uid}/access`, owner, { role: "sales" })).statusCode).toBe(200);
    const maria = await login("sales@example.com", m.temporaryPassword);
    await connect(maria, SALES);
    expect(to(SALES).at(-1)).toContain("перешлите сюда сообщение клиента");
    const others = { anna: to(ANNA).length, boris: to(BORIS).length, owner: to(OWNER).length };
    expect(await bot.salesNotice("site")).toBe(1);
    const notice = to(SALES).at(-1) ?? "";
    expect(notice).toContain("Новая заявка с сайта");
    expect(notice).toContain("https://games.test/studio/clients");
    expect(notice).not.toMatch(/\d{3}[-\s]?\d{2}[-\s]?\d{2}/);
    expect(await bot.salesNotice("venue")).toBe(1);
    expect(to(SALES).at(-1)).toContain("https://games.test/venues");
    expect({ anna: to(ANNA).length, boris: to(BORIS).length, owner: to(OWNER).length }).toEqual(others);
    tg.push(SALES, "Добрый день, нужен квиз на день рождения 20.11, 18 человек, телефон 8 903 111-22-33");
    await until(() => to(SALES).some((t) => t.includes("Клиент в базе")), "клиент от менеджера в базе");
    const clients = (await get("/api/clients", maria)).json().clients as Array<{ phone: string }>;
    expect(clients.some((c) => c.phone.includes("903"))).toBe(true);
  });
  it("Telegram для бизнеса: клиент прислал расчёт владельцу — клиент в базе, менеджеру уведомление; остальное не трогаем", async () => {
    const SALES = 444;
    const CALC = "🧮 Расчёт JoyRest\n────────────\nПакет: Квиз\nГостей: до 25\nСтоимость по формату ведущего:\n✅ Опытный: 34 300 ₽ — выбран";
    tg.update({ business_connection: { id: "bc1", user: { id: OWNER, first_name: "Михаил" }, user_chat_id: OWNER, is_enabled: true } });
    await until(() => to(OWNER).some((t) => t.includes("подключён к вашему Telegram")), "бот подключён к Telegram владельца");
    const before = (await get("/api/clients", owner)).json().clients.length as number;
    const notices = to(SALES).length;
    const msg = (n: number, from: object, text: string, conn = "bc1") => ({
      business_message: { message_id: n, business_connection_id: conn, chat: { id: (from as { id: number }).id, type: "private" }, from, text },
    });
    // Обычная переписка — не клиент; своё сообщение владельца с расчётом — тоже.
    tg.update(msg(9001, { id: 7001, first_name: "Друг" }, "Привет! Как дела?"));
    tg.update(msg(9002, { id: OWNER, first_name: "Михаил" }, CALC));
    tg.update(msg(9003, { id: 7002, first_name: "Оля", username: "olya_fest" }, CALC));
    tg.update(msg(9004, { id: 7003, first_name: "Без", last_name: "Ника" }, CALC));
    await until(async () => (await get("/api/clients", owner)).json().clients.length === before + 2, "два клиента с расчётом");
    const clients = (await get("/api/clients", owner)).json().clients as Array<{ id: string; name: string; links: string[] }>;
    const olya = clients.find((c) => c.name === "Оля");
    expect(olya?.links).toEqual(["https://t.me/olya_fest"]);
    expect(clients.find((c) => c.name === "Без Ника")?.links).toEqual(["tg://user?id=7003"]);
    expect(clients.some((c) => c.name === "Друг" || c.name === "Михаил")).toBe(false);
    const card = (await get(`/api/clients/${olya?.id}`, owner)).json() as { history: Array<{ summary: string; source: string }> };
    expect(card.history[0]?.summary).toContain("Пакет: Квиз");
    expect(card.history[0]?.source).toBe("telegram");
    await until(() => to(SALES).length === notices + 2, "менеджеру — два уведомления");
    expect(to(SALES).at(-1)).toContain("прислал расчёт с сайта в Telegram");
    expect(to(SALES).at(-1)).not.toContain("Оля");
    // Тот же расчёт ещё раз — та же карточка.
    tg.update(msg(9005, { id: 7002, first_name: "Оля", username: "olya_fest" }, CALC));
    await until(() => to(SALES).length === notices + 3, "повтор");
    expect((await get("/api/clients", owner)).json().clients).toHaveLength(before + 2);
    // Ведущий без права на клиентов подключил бота — клиенты не попадают.
    tg.update({ business_connection: { id: "bc2", user: { id: ANNA }, user_chat_id: ANNA, is_enabled: true } });
    await until(() => to(ANNA).some((t) => t.includes("клиенты сюда пока не попадут")), "ведущему — нельзя");
    tg.update(msg(9006, { id: 7004, first_name: "Вера", username: "vera_x" }, CALC, "bc2"));
    // Отключил бота — расчёты больше не попадают.
    tg.update({ business_connection: { id: "bc1", user: { id: OWNER }, user_chat_id: OWNER, is_enabled: false } });
    await until(() => to(OWNER).some((t) => t.includes("отключён от вашего Telegram")), "отключение");
    tg.update(msg(9007, { id: 7005, first_name: "Гоша", username: "gosha_x" }, CALC));
    await new Promise((r) => setTimeout(r, 400));
    const after = (await get("/api/clients", owner)).json().clients as Array<{ name: string }>;
    expect(after.some((c) => c.name === "Вера" || c.name === "Гоша")).toBe(false);
  });
  it("клиент ждёт ответа: напоминание через 30 минут днём — владельцу и менеджеру, один раз; ответ и статус снимают ожидание", async () => {
    const SALES = 444;
    const CALC = "🧮 Расчёт JoyRest\nПакет: Шоу-вечер";
    const noon = Date.UTC(2026, 9, 17, 9, 0); // 12:00 по Москве
    expect(answerHoursOpen(noon)).toBe(true);
    expect(answerHoursOpen(Date.UTC(2026, 9, 17, 20, 30))).toBe(false); // 23:30 по Москве — не будим
    tg.update({ business_connection: { id: "bc3", user: { id: OWNER }, user_chat_id: OWNER, is_enabled: true } });
    await until(() => to(OWNER).filter((t) => t.includes("подключён к вашему Telegram")).length >= 2, "снова подключён");
    const msg = (n: number, from: object, text: string) => ({
      business_message: { message_id: n, business_connection_id: "bc3", chat: { id: 8001, type: "private" }, from, text },
    });
    const client = { id: 8001, first_name: "Лена", username: "lena_wait" };
    tg.update(msg(9101, client, CALC));
    const lena = async () => ((await get("/api/clients", owner)).json().clients as Array<{ id: string; name: string; tgWaitingSince: number | null }>).find((c) => c.name === "Лена");
    await until(async () => typeof (await lena())?.tgWaitingSince === "number", "Лена ждёт ответа");
    // Ответ владельца — не ждёт; клиент написал снова — опять ждёт (текст не хранится).
    tg.update(msg(9102, { id: OWNER, first_name: "Михаил" }, "Здравствуйте! Сейчас посчитаем"));
    await until(async () => (await lena())?.tgWaitingSince === null, "ответили");
    tg.update(msg(9103, client, "А на субботу свободно?"));
    await until(async () => typeof (await lena())?.tgWaitingSince === "number", "снова ждёт");
    // Чат не клиента — ничего не записано.
    tg.update({ business_message: { message_id: 9104, business_connection_id: "bc3", chat: { id: 8002, type: "private" }, from: { id: 8002, first_name: "Друг" }, text: "Привет" } });
    await new Promise((r) => setTimeout(r, 300));
    expect((await sql`select 1 from tg_chats where chat_id = 8002`).length).toBe(0);
    // Прошло 31 минута — днём напоминание владельцу и менеджеру, без имени; второй раз — нет.
    await sql`update tg_chats set waiting_since = now() - interval '31 minutes' where chat_id = 8001`;
    const day = startBot({ sql, token: "test-token", log, polling: false, platformUrl: "https://games.test", fetchImpl: tg.fetchImpl, now: () => noon });
    const night = startBot({ sql, token: "test-token", log, polling: false, platformUrl: "https://games.test", fetchImpl: tg.fetchImpl, now: () => noon + 12 * 3_600_000 });
    try {
      expect(await night.waitingNow()).toBe(0);
      const before = { owner: to(OWNER).length, sales: to(SALES).length };
      expect(await day.waitingNow()).toBe(2);
      expect(to(OWNER).length).toBe(before.owner + 1);
      expect(to(SALES).length).toBe(before.sales + 1);
      expect(to(SALES).at(-1)).toContain("Клиент ждёт ответа в Telegram");
      expect(to(SALES).at(-1)).not.toContain("Лена");
      expect(await day.waitingNow()).toBe(0);
    } finally {
      day.stop();
      night.stop();
    }
    // Статус в студии — с клиентом связались, больше не ждёт.
    const id = (await lena())?.id ?? "";
    expect((await post(`/api/clients/${id}/status`, owner, { status: "work" })).statusCode).toBe(200);
    expect((await lena())?.tgWaitingSince).toBeNull();
  });
  it("колокольчик студии: новые обращения клиентов владельцу и менеджеру, «прочитано» — каждому своё; ведущему — нельзя", async () => {
    const first = (await get("/api/notices", owner)).json() as { unread: number; items: Array<{ kind: string; title: string; name: string; line: string; unread: boolean; clientId: string }> };
    const olya = first.items.find((n) => n.name === "Оля");
    expect(olya).toMatchObject({ kind: "new", title: "Из Telegram", unread: true });
    expect(olya?.line).toContain("Расчёт с сайта");
    expect(first.unread).toBeGreaterThan(0);
    // Владелец открыл колокольчик — у него прочитано.
    expect((await post("/api/notices/seen", owner)).statusCode).toBe(200);
    const after = (await get("/api/notices", owner)).json() as { unread: number; items: Array<{ unread: boolean; kind: string }> };
    expect(after.unread).toBe(after.items.filter((n) => n.kind === "waiting").length);
    expect(after.items.some((n) => n.kind === "new" && n.unread)).toBe(false);
    // Новое обращение после этого — снова новое.
    tg.update({ business_connection: { id: "bc4", user: { id: OWNER }, user_chat_id: OWNER, is_enabled: true } });
    await until(() => to(OWNER).filter((t) => t.includes("подключён к вашему Telegram")).length >= 3, "снова подключён");
    tg.update({ business_message: { message_id: 9201, business_connection_id: "bc4", chat: { id: 8301, type: "private" }, from: { id: 8301, first_name: "Ира", username: "ira_bell" }, text: "🧮 Расчёт JoyRest\nПакет: Квиз" } });
    await until(async () => ((await get("/api/notices", owner)).json() as { items: Array<{ name: string; unread: boolean }> }).items.some((n) => n.name === "Ира" && n.unread), "новое у владельца");
    // Ведущему без права на клиентов колокольчика нет.
    expect((await get("/api/notices", anna)).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/notices", headers: { host: HOST } })).statusCode).toBe(401);
  });
  it("откуда пришёл: расчёт — «Сайт», по ссылке «Пишу с Авито» — новый клиент «Авито», вручную — можно сменить", async () => {
    tg.update({ business_message: { message_id: 9301, business_connection_id: "bc4", chat: { id: 8401, type: "private" }, from: { id: 8401, first_name: "Дина", username: "dina_avito" }, text: "Здравствуйте! Пишу с Авито, нужен ведущий на юбилей" } });
    tg.update({ business_message: { message_id: 9302, business_connection_id: "bc4", chat: { id: 8402, type: "private" }, from: { id: 8402, first_name: "Просто", username: "just_hi" }, text: "Привет, как дела?" } });
    const list = async () => (await get("/api/clients", owner)).json().clients as Array<{ id: string; name: string; origin: string }>;
    await until(async () => (await list()).some((c) => c.name === "Дина"), "клиент с Авито");
    const all = await list();
    expect(all.find((c) => c.name === "Дина")?.origin).toBe("avito");
    expect(all.find((c) => c.name === "Ира")?.origin).toBe("site");
    expect(all.some((c) => c.name === "Просто")).toBe(false);
    // Дина написала ещё — ждёт ответа, второй карточки нет.
    tg.update({ business_message: { message_id: 9303, business_connection_id: "bc4", chat: { id: 8401, type: "private" }, from: { id: 8401, first_name: "Дина", username: "dina_avito" }, text: "Ещё раз с Авито пишу" } });
    await new Promise((r) => setTimeout(r, 300));
    expect((await list()).filter((c) => c.name === "Дина")).toHaveLength(1);
    // Владелец поправил источник вручную.
    const dina = (await list()).find((c) => c.name === "Дина");
    const card = (await get(`/api/clients/${dina?.id}`, owner)).json() as { id: string; name: string; phone: string; links: string[]; status: string; marketing: string; notes: string; updatedAt: number };
    const saved = await post("/api/clients", owner, { id: card.id, name: card.name, phone: card.phone, links: card.links, status: card.status, marketing: card.marketing, notes: card.notes, origin: "recommend", expect: card.updatedAt });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().origin).toBe("recommend");
  });
});




