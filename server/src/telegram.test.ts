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
import { startBot, type Bot } from "./telegram";

interface Sent {
  chat: number;
  text: string;
}

/** Telegram понарошку: getMe, getUpdates (очередь входящих), sendMessage (журнал отправленного). */
function fakeTelegram() {
  const inbox: Array<{ update_id: number; message: object }> = [];
  const sent: Sent[] = [];
  let id = 0;
  const reply = (body: unknown) => new Response(JSON.stringify({ ok: true, result: body }), { status: 200, headers: { "content-type": "application/json" } });
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (url.endsWith("/getMe")) return reply({ username: "joyrest_test_bot" });
    if (url.endsWith("/sendMessage")) {
      sent.push({ chat: Number(body.chat_id), text: String(body.text) });
      return reply({ message_id: 1 });
    }
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
    push(chat: number, text: string, extra: object = {}) {
      id += 1;
      inbox.push({ update_id: id, message: { message_id: id, chat: { id: chat, type: "private" }, from: { username: `user${chat}` }, text, ...extra } });
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
});
