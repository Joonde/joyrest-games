/**
 * Путь клиента по ролям (диагностика 12 ноября 2026, по запросу владельца): временные аккаунты — владелец, менеджер по
 * продажам, ведущий с Telegram и ведущий без Telegram — проходят путь «клиент → менеджер → ведущий → проведено» на отдельной
 * базе с «Telegram понарошку». После каждого шага тест записывает, КТО и ГДЕ (колокольчик, Telegram) получил уведомление, —
 * строками `DIAG|{…}` в журнал сборки (так видно весь путь целиком), и проверяет четыре исправленные ошибки:
 * О1 — клиент без телефона становится «Провели»; О2 — мероприятие отключённого ведущего помечено; О3 — «не подтвердил» у
 * срочной записи; О4 — «Снять мероприятие» убирает кнопку в Telegram. Основную и тестовую версии не трогает.
 */
import { resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAdminPassword } from "./admin-password";
import { buildApp } from "./app";
import { migrate } from "./migrate";
import { startBot, type Bot } from "./telegram";

function fakeTelegram() {
  const inbox: Array<{ update_id: number } & Record<string, object | number>> = [];
  const sent: Array<{ chat: number; text: string; buttons: string[] }> = [];
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
    if (url.endsWith("/getBusinessConnection")) return new Response(JSON.stringify({ ok: false }), { status: 400 });
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
    push(chat: number, text: string) {
      id += 1;
      inbox.push({ update_id: id, message: { message_id: id, chat: { id: chat, type: "private" }, from: { username: `user${chat}` }, text } });
    },
    update(body: Record<string, object>) {
      id += 1;
      inbox.push({ update_id: id, ...body });
    },
  };
}

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("путь клиента: уведомления по ролям и исправления диагностики 12 ноября 2026", () => {
  const SCHEMA = "manager_path_test";
  const admin = postgres(url ?? "", { max: 1, onnotice: () => {} });
  const sql = postgres(url ?? "", { max: 3, onnotice: () => {}, connection: { search_path: SCHEMA } });
  const tg = fakeTelegram();
  let fakeNow: number | null = null;
  let bot: Bot;
  let app: ReturnType<typeof buildApp>;
  const HOST = "games.test";
  const CHAT = { owner: 999, manager: 333, anna: 111 } as const;
  const who: Record<string, { cookie: string; id: string; chat: number | null }> = {};
  const day = (n: number) => new Date(Date.now() + 3 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const cookieOf = (res: { headers: Record<string, unknown> }) => {
    const raw = res.headers["set-cookie"];
    return (Array.isArray(raw) ? String(raw[0]) : String(raw ?? "")).split(";")[0] ?? "";
  };
  const headers = (cookie: string) => ({ host: HOST, "x-joyrest": "1", origin: `https://${HOST}`, cookie });
  const post = (path: string, cookie: string, payload: object = {}) => app.inject({ method: "POST", url: path, headers: headers(cookie), payload });
  const del = (path: string, cookie: string) => app.inject({ method: "DELETE", url: path, headers: headers(cookie) });
  const get = (path: string, cookie: string) => app.inject({ method: "GET", url: path, headers: { host: HOST, cookie } });
  const login = async (email: string, password: string) => cookieOf(await post("/api/auth/login", "", { email, password }));

  /** Что уже видели: id записей колокольчика и число сообщений Telegram у каждого. */
  const seenBell: Record<string, Set<string>> = {};
  const seenTg: Record<string, number> = {};
  const out = (line: object) => console.log(`DIAG|${JSON.stringify(line)}`);

  async function bellOf(name: string) {
    const res = await get("/api/notices", who[name]?.cookie ?? "");
    if (res.statusCode !== 200) return [] as Array<{ id: string; kind: string; title: string; line: string }>;
    return (res.json() as { items: Array<{ id: string; kind: string; title: string; line: string }> }).items;
  }
  const tgOf = (name: string) => tg.sent.filter((m) => m.chat === who[name]?.chat);

  /** После шага: кому что пришло нового. */
  async function step(n: string, what: string, extra: object = {}, later?: () => Promise<object>) {
    await sleep(400);
    const got: Record<string, { bell: string[]; telegram: string[] }> = {};
    for (const name of Object.keys(who)) {
      const bell = (await bellOf(name)).filter((i) => !seenBell[name]?.has(i.id));
      for (const i of bell) seenBell[name]?.add(i.id);
      const all = tgOf(name);
      const fresh = all.slice(seenTg[name] ?? 0);
      seenTg[name] = all.length;
      got[name] = { bell: bell.map((i) => `${i.kind}:${i.title}`), telegram: fresh.map((m) => `${m.text.split("\n")[0]}${m.buttons.length ? " [кнопка]" : ""}`) };
    }
    out({ step: n, what, got, ...extra, ...(later ? await later() : {}) });
    return got;
  }
  const clientStatus = async (key: string) => {
    const [row] = await sql<{ status: string }[]>`select status from clients where phone_key = ${key} or links::text ilike ${`%${key}%`} order by created_at desc limit 1`;
    return row?.status ?? "нет карточки";
  };
  const eventOf = async (id: string) => {
    const [row] = await sql<{ host_id: string; accepted: boolean; accept_rev: number; cancelled: boolean; held: boolean | null }[]>`
      select host_id, (accepted_at is not null) as accepted, accept_rev, (cancelled_at is not null) as cancelled, held from events where id = ${id}`;
    return row ?? null;
  };
  async function connect(name: string) {
    const link = (await post("/api/telegram/link", who[name]?.cookie ?? "")).json() as { url: string };
    tg.push(who[name]?.chat ?? 0, `/start ${link.url.split("start=")[1]}`);
    for (let i = 0; i < 100; i++) {
      if ((await get("/api/telegram/me", who[name]?.cookie ?? "")).json().linked === true) return;
      await sleep(50);
    }
    throw new Error(`Telegram не подключился: ${name}`);
  }
  const base = (id: string, hostId: string, more: object = {}) => ({ id, hostId, day: day(10), start: 1080, end: 1380, title: "Корпоратив", clientName: "Ольга", clientPhone: "+7 999 111-22-33", place: "ул. Тайная, 7", guests: 40, note: "", clientContact: "call", ...more });

  beforeAll(async () => {
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.unsafe(`create schema ${SCHEMA}`);
    await migrate(sql, resolve(import.meta.dirname, "../migrations"));
    bot = startBot({ sql, token: "test-token", log: { info: () => undefined, warn: () => undefined }, polling: true, platformUrl: "https://games.test", fetchImpl: tg.fetchImpl, now: () => fakeNow ?? Date.now() });
    app = buildApp({ version: "t", publicDir: null, checkDatabase: async () => true, sql, bot, auth: { limits: { perAccount: 1000, perIp: 1000, deviceDelayMs: () => 0 } } });
    await setAdminPassword(sql, "owner@example.com", "пароль-владельца-12");
    const owner = await login("owner@example.com", "пароль-владельца-12");
    const [o] = await sql<{ id: string }[]>`select id from users where role = 'admin' limit 1`;
    who.owner = { cookie: owner, id: o?.id ?? "", chat: CHAT.owner };
    const make = async (email: string, name: string) => {
      const a = (await post("/api/users", owner, { email, name })).json() as { account: { uid: string }; temporaryPassword: string };
      return { id: a.account.uid, cookie: await login(email, a.temporaryPassword) };
    };
    const m = await make("maria@example.com", "Мария");
    expect((await post(`/api/users/${m.id}/profession`, owner, { profession: "sales" })).statusCode).toBe(200);
    expect((await post(`/api/users/${m.id}/access`, owner, { role: "sales" })).statusCode).toBe(200);
    who.manager = { ...m, chat: CHAT.manager };
    who.anna = { ...(await make("anna@example.com", "Анна")), chat: CHAT.anna };
    who.boris = { ...(await make("boris@example.com", "Борис")), chat: null };
    for (const name of Object.keys(who)) {
      seenBell[name] = new Set();
      seenTg[name] = 0;
    }
    await connect("owner");
    await connect("manager");
    await connect("anna");
    await step("0", "подготовка: владелец, менеджер и Анна подключили Telegram; Борис — без Telegram");
  });

  afterAll(async () => {
    bot.stop();
    await app.close();
    await sql.end();
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  it("путь мероприятия: запись → принял → правки → отмена → возврат", async () => {
    const mgr = who.manager?.cookie ?? "";
    const own = who.owner?.cookie ?? "";
    const anna = who.anna?.id ?? "";
    const boris = who.boris?.id ?? "";

    let r = await post("/api/events", mgr, base("e1", anna));
    await step("1", "менеджер записал мероприятие Анне", { code: r.statusCode, client: await clientStatus("79991112233"), event: await eventOf("e1") });

    r = await post("/api/events/e1/accept", who.anna?.cookie ?? "", { rev: 1 });
    await step("2", "Анна нажала «Принял, готовлюсь» в студии", { code: r.statusCode, event: await eventOf("e1"), edits: tg.edits.slice(-2) });

    r = await post("/api/events", mgr, base("e1", anna, { place: "пр. Новый, 12, зал 2" }));
    await step("3", "менеджер поменял ТОЛЬКО адрес", { code: r.statusCode, event: await eventOf("e1") });

    r = await post("/api/events", mgr, base("e1", anna, { place: "пр. Новый, 12, зал 2", note: "именинник — Пётр, без шуток про возраст" }));
    await step("4", "менеджер поменял ТОЛЬКО комментарий ведущему", { code: r.statusCode, event: await eventOf("e1") });

    r = await post("/api/events", mgr, base("e1", anna, { place: "пр. Новый, 12, зал 2", start: 1140 }));
    await step("5", "менеджер поменял время начала", { code: r.statusCode, event: await eventOf("e1") });

    r = await post("/api/events", own, base("e1", anna, { place: "пр. Новый, 12, зал 2", start: 1140, guests: 55 }));
    await step("6", "ВЛАДЕЛЕЦ поменял число гостей в мероприятии менеджера", { code: r.statusCode, event: await eventOf("e1") });

    r = await post("/api/events", mgr, base("e1", boris, { place: "пр. Новый, 12, зал 2", start: 1140, guests: 55 }));
    await step("7", "менеджер передал мероприятие Борису (у него нет Telegram)", { code: r.statusCode, event: await eventOf("e1") });

    r = await post("/api/events/e1/cancel", own);
    await step("8", "ВЛАДЕЛЕЦ отменил мероприятие менеджера", { code: r.statusCode, client: await clientStatus("79991112233"), event: await eventOf("e1") });

    r = await post("/api/events/e1/restore", mgr);
    await step("9", "менеджер вернул отменённое", { code: r.statusCode, event: await eventOf("e1") });
  });

  it("«Проведено»: клиент с телефоном и клиент только с ником Telegram", async () => {
    const mgr = who.manager?.cookie ?? "";
    const anna = who.anna?.id ?? "";
    let r = await post("/api/events", mgr, base("p1", anna, { clientName: "Ирина", clientPhone: "+7 999 222-33-44", day: day(12) }));
    const a = r.statusCode;
    r = await post("/api/events", mgr, base("p2", anna, { clientName: "Никита", clientPhone: "", clientContact: "telegram:@nikita_party", day: day(13) }));
    await step("10", "менеджер записал два мероприятия: клиент с телефоном и клиент только с ником", {
      codes: [a, r.statusCode],
      answer2: r.json(),
      withPhone: await clientStatus("79992223344"),
      nickOnly: await clientStatus("nikita_party"),
    });
    // Оба мероприятия «прошли»: начало 4 часа назад, конец час назад.
    await sql`update events set starts_at = now() - interval '4 hours', ends_at = now() - interval '1 hour' where id in ('p1', 'p2')`;
    const h1 = await post("/api/events/p1/held", who.anna?.cookie ?? "", { held: true });
    const h2 = await post("/api/events/p2/held", who.anna?.cookie ?? "", { held: true });
    await step("11", "Анна отметила оба «Проведено»", {
      codes: [h1.statusCode, h2.statusCode],
      withPhone: await clientStatus("79992223344"),
      nickOnly: await clientStatus("nikita_party"),
    });
    // О1: клиент, записанный только по нику Telegram, тоже становится «Провели» — менеджер попросит отзыв.
    expect(await clientStatus("79992223344")).toBe("held");
    expect(await clientStatus("nikita_party")).toBe("held");
    // Сняли отметку — обратно «Клиент», и тоже без телефона.
    expect((await post("/api/events/p2/held", who.anna?.cookie ?? "", { held: null })).statusCode).toBe(200);
    expect(await clientStatus("nikita_party")).toBe("client");
  });

  it("ведущий не подтвердил, напоминания, «Снять мероприятие»", async () => {
    const mgr = who.manager?.cookie ?? "";
    const anna = who.anna?.id ?? "";
    const boris = who.boris?.id ?? "";
    await post("/api/events", mgr, base("u1", anna, { clientName: "Вера", clientPhone: "+7 999 333-44-55", day: day(14) }));
    await post("/api/events", mgr, base("u2", boris, { clientName: "Глеб", clientPhone: "+7 999 444-55-66", day: day(15) }));
    await step("12", "менеджер записал u1 Анне и u2 Борису (оба не приняли)");
    // До начала 5 часов, записано 2 часа назад; на часах бота — полдень по Москве.
    await sql`update events set starts_at = now() + interval '5 hours', ends_at = now() + interval '8 hours', updated_at = now() - interval '2 hours' where id in ('u1', 'u2')`;
    const d = new Date();
    fakeNow = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 9, 0, 0);
    await bot.remindNow();
    fakeNow = null;
    await step("13", "прошла проверка напоминаний: до начала 5 часов, никто не принял");
    await bot.remindNow();
    await step("13b", "повторная проверка через минуту (не должно дублироваться)");

    const before = tg.edits.length;
    const r = await del("/api/calendar/ev-u1", mgr);
    await sleep(300);
    const last = tgOf("anna").at(-1)?.text ?? "";
    await step("14", "менеджер нажал «Снять мероприятие» в «Кто может» (u1, Анна)", {
      code: r.statusCode,
      event: await eventOf("u1"),
      telegramText: last,
      buttonRemoved: tg.edits.length > before,
      client: await clientStatus("79993334455"),
    });
    // О4: под прошлым сообщением у Анны кнопки «Принял, готовлюсь» больше нет.
    expect(tg.edits.length).toBeGreaterThan(before);
    expect(tg.edits.at(-1)).toMatchObject({ chat: CHAT.anna, label: null });
    expect(last).toContain("отменено");
  });

  it("входящие клиенты из Telegram для бизнеса", async () => {
    const calc = "🧮 Расчёт JoyRest\nИмя: Света\nПакет: Квиз\nГостей: до 25\nДата: 20.12.2026\nОпытный: 23 900 ₽";
    const msg = (conn: string, n: number, from: object, text: string) =>
      tg.update({ business_message: { message_id: n, business_connection_id: conn, chat: { id: (from as { id: number }).id, type: "private" }, from, text } });

    // Бот подключён к Telegram МЕНЕДЖЕРА (рабочий аккаунт для клиентов).
    tg.update({ business_connection: { id: "bcM", user: { id: CHAT.manager, first_name: "Мария" }, user_chat_id: CHAT.manager, is_enabled: true } });
    await step("15", "менеджер подключил бота к своему Telegram (Telegram для бизнеса)");

    msg("bcM", 7001, { id: 7001, first_name: "Света", username: "sveta_k" }, calc);
    await step("16", "клиент прислал менеджеру в Telegram РАСЧЁТ с сайта", {}, async () => ({ client: await clientStatus("sveta_k") }));

    msg("bcM", 7002, { id: 7002, first_name: "Олег", username: "oleg_m" }, "Здравствуйте! Хочу заказать ведущего на корпоратив 20 декабря, 30 человек. Сколько стоит?");
    await step("17", "ДРУГОЙ клиент написал менеджеру в Telegram обычным текстом, без расчёта", {}, async () => ({ client: await clientStatus("oleg_m") }));

    msg("bcM", 7003, { id: 7001, first_name: "Света", username: "sveta_k" }, "Ау, вы тут?");
    await sql`update tg_chats set waiting_since = now() - interval '45 minutes'`;
    const d = new Date();
    fakeNow = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 9, 0, 0);
    const sent = await bot.waitingNow();
    fakeNow = null;
    await step("18", "клиент с расчётом ждёт ответа 45 минут", { sent });
  });

  it("ведущего отключили, двойная запись на одно время, запись за час до начала", async () => {
    const mgr = who.manager?.cookie ?? "";
    const own = who.owner?.cookie ?? "";
    const anna = who.anna?.id ?? "";
    const boris = who.boris?.id ?? "";
    const a = await post("/api/events", mgr, base("d1", boris, { clientName: "Дина", clientPhone: "+7 999 555-66-77", day: day(20) }));
    const b = await post("/api/events", mgr, base("d2", boris, { clientName: "Егор", clientPhone: "+7 999 666-77-88", day: day(20) }));
    await step("19", "менеджер записал Борису ДВА мероприятия на одно и то же время", { codes: [a.statusCode, b.statusCode] });

    await post("/api/events", mgr, base("x1", anna, { clientName: "Жанна", clientPhone: "+7 999 777-88-99", day: day(21) }));
    await step("20a", "менеджер записал x1 Анне");
    const off = await post(`/api/users/${anna}/active`, own, { active: false });
    const list = (await get("/api/events?scope=upcoming", mgr)).json() as { events: Array<{ id: string; hostId: string; hostName: string; hostOff?: boolean }> };
    const edit = await post("/api/events", mgr, base("x1", anna, { clientName: "Жанна", clientPhone: "+7 999 777-88-99", day: day(21), note: "правка" }));
    await step("20", "ВЛАДЕЛЕЦ отключил Анну, у которой есть предстоящее мероприятие", {
      code: off.statusCode,
      stillAssigned: list.events.filter((e) => e.hostId === anna).map((e) => e.id),
      markedOff: list.events.filter((e) => e.hostOff === true).map((e) => e.id),
      managerEditCode: edit.statusCode,
    });
    // О2: мероприятие отключённого ведущего помечено — менеджер и владелец видят в планировщике, что его надо передать;
    // у мероприятий действующих ведущих пометки нет. Передали Борису — пометка ушла.
    expect(list.events.filter((e) => e.hostOff === true).map((e) => e.id)).toEqual(["x1"]);
    expect((await post("/api/events", mgr, base("x1", boris, { clientName: "Жанна", clientPhone: "+7 999 777-88-99", day: day(21) }))).statusCode).toBe(200);
    const after = (await get("/api/events?scope=upcoming", mgr)).json() as { events: Array<{ id: string; hostOff?: boolean }> };
    expect(after.events.some((e) => e.hostOff === true)).toBe(false);

    // Запись «на сегодня»: до начала 50 минут, ведущий не принял.
    await post("/api/events", mgr, base("s1", boris, { clientName: "Зоя", clientPhone: "+7 999 888-99-00", day: day(22) }));
    await step("21a", "менеджер записал s1 Борису");
    const d = new Date();
    const noon = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 9, 0, 0);
    // Записано 5 минут назад — ведущему ещё дают время (10 минут): никому ничего.
    await sql`update events set starts_at = now() + interval '50 minutes', ends_at = now() + interval '4 hours', updated_at = now() - interval '5 minutes' where id = 's1'`;
    fakeNow = noon;
    await bot.remindNow();
    fakeNow = null;
    const early = await step("21b", "до начала 50 минут, записано 5 минут назад, ведущий не принял");
    expect(early.owner?.telegram ?? []).toEqual([]);
    expect(early.manager?.telegram ?? []).toEqual([]);
    // О3: прошло 12 минут — владельцу и менеджеру «не подтвердил» (раньше ждали час, и сообщение не уходило никогда).
    await sql`update events set updated_at = now() - interval '12 minutes' where id = 's1'`;
    fakeNow = noon;
    await bot.remindNow();
    fakeNow = null;
    const late = await step("21", "до начала 50 минут, записано 12 минут назад, ведущий (без Telegram) не принял");
    expect(late.owner?.telegram.some((t) => t.includes("не подтвердил"))).toBe(true);
    expect(late.manager?.telegram.some((t) => t.includes("не подтвердил"))).toBe(true);
    // Обычная запись (до начала 20 часов) по-прежнему ждёт час: через 30 минут — ничего.
    await post("/api/events", mgr, base("s2", boris, { clientName: "Инна", clientPhone: "+7 999 000-11-22", day: day(23) }));
    await step("22a", "менеджер записал s2 Борису");
    await sql`update events set starts_at = now() + interval '20 hours', ends_at = now() + interval '23 hours', updated_at = now() - interval '30 minutes' where id = 's2'`;
    fakeNow = noon;
    await bot.remindNow();
    fakeNow = null;
    const usual = await step("22", "до начала 20 часов, записано 30 минут назад, ведущий не принял");
    expect(usual.owner?.telegram ?? []).toEqual([]);
  });

  // Предоплата (решение владельца 12 ноября 2026): запись ведущему только с галочкой, ведущему — остаток «к оплате на
  // месте», владельцу — колокольчик и Telegram, «Вернуть предоплату» — не позже чем за 48 часов до начала.
  it("предоплата: запись с галочкой, сумма ведущему, уведомления владельцу, возврат до 48 часов", async () => {
    const mgr = who.manager?.cookie ?? "";
    const own = who.owner?.cookie ?? "";
    const a = (await post("/api/users", own, { email: "vika@example.com", name: "Вика" })).json() as { account: { uid: string }; temporaryPassword: string };
    const vk = { id: a.account.uid, cookie: await login("vika@example.com", a.temporaryPassword), chat: 444 };
    who.vika = vk;
    seenBell.vika = new Set();
    seenTg.vika = 0;
    await connect("vika");
    const vika = vk.id;
    const vera = { clientName: "Вера", clientPhone: "+7 999 555-00-11", place: "ул. Секретная, 3" };
    const noClient = (texts: string[]) => texts.every((t) => !t.includes("Вера") && !t.includes("555-00-11") && !t.includes("Секретная"));
    const fullTg = (name: string, from: number) => tgOf(name).slice(from).map((m) => m.text);

    // Без галочки и без стоимости новое мероприятие не записывается.
    let r = await post("/api/events", mgr, base("pay1", vika, { ...vera, price: 24900, prepaid: false }));
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ reason: "prepay" });
    r = await post("/api/events", mgr, base("pay1", vika, { ...vera, prepaid: true }));
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ reason: "price" });
    expect((await post("/api/events", mgr, base("pay1", vika, { ...vera, price: 1500, prepaid: true }))).statusCode).toBe(400);
    expect((await post("/api/events", mgr, base("pay1", vika, { ...vera, price: "много", prepaid: true }))).statusCode).toBe(400);
    expect(await eventOf("pay1")).toBeNull();
    await step("P0", "менеджер пробует записать без галочки, без стоимости и с неверной стоимостью — отказ, никому ничего");

    // С галочкой: ведущему — остаток, владельцу — «предоплата отмечена».
    const vikaTg = tgOf("vika").length;
    const ownerTg = tgOf("owner").length;
    r = await post("/api/events", mgr, base("pay1", vika, { ...vera, price: 24900, prepaid: true }));
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ price: 24900, prepaidBy: "Мария" });
    expect(typeof (r.json() as { prepaidAt?: number }).prepaidAt).toBe("number");
    const p1 = await step("P1", "менеджер записал мероприятие Вике: стоимость 24 900 ₽, предоплата внесена", { client: await clientStatus("79995550011") });
    expect(fullTg("vika", vikaTg).some((t) => t.includes("К оплате на месте: 22 900 ₽") && t.includes("предоплата 2 000 ₽ уже внесена"))).toBe(true);
    expect(p1.owner?.bell.some((b) => b.includes("Предоплата 2 000 ₽ отмечена"))).toBe(true);
    expect(fullTg("owner", ownerTg).some((t) => t.includes("Предоплата 2 000 ₽ отмечена") && t.includes("22 900 ₽") && t.includes("Мария"))).toBe(true);
    expect(noClient([...fullTg("vika", vikaTg), ...fullTg("owner", ownerTg)])).toBe(true);
    expect((p1.manager?.bell ?? []).some((b) => b.includes("Предоплата"))).toBe(false);
    // Ведущий видит сумму в студии.
    const mine = (await get("/api/events?scope=upcoming", vk.cookie)).json() as { events: Array<{ id: string; price?: number; prepaidAt?: number }> };
    expect(mine.events.find((e) => e.id === "pay1")).toMatchObject({ price: 24900 });
    expect(typeof mine.events.find((e) => e.id === "pay1")?.prepaidAt).toBe("number");

    // Стоимость поменяли — ведущему «Изменено» с новым остатком, «Принял» спрашиваем заново.
    expect((await post("/api/events/pay1/accept", vk.cookie, { rev: 1 })).statusCode).toBe(200);
    const before = tgOf("vika").length;
    r = await post("/api/events", mgr, base("pay1", vika, { ...vera, price: 27900, prepaid: true }));
    expect(r.statusCode).toBe(200);
    const p2 = await step("P2", "менеджер поменял стоимость на 27 900 ₽", { event: await eventOf("pay1") });
    expect(fullTg("vika", before).some((t) => t.includes("изменено") && t.includes("К оплате на месте: 25 900 ₽"))).toBe(true);
    expect((await eventOf("pay1"))?.accepted).toBe(false);
    expect((p2.owner?.bell ?? []).some((b) => b.includes("Предоплата"))).toBe(false);
    // Отметку не снять, стоимость у отмеченного не стереть; правка без поля (старая вкладка) их не трогает.
    r = await post("/api/events", mgr, base("pay1", vika, { ...vera, price: 27900, prepaid: false }));
    expect(r.json()).toMatchObject({ price: 27900 });
    expect(typeof (r.json() as { prepaidAt?: number }).prepaidAt).toBe("number");
    expect((await post("/api/events", mgr, base("pay1", vika, { ...vera, price: null, prepaid: true }))).statusCode).toBe(400);
    r = await post("/api/events", mgr, base("pay1", vika, vera));
    expect(r.json()).toMatchObject({ price: 27900, prepaidBy: "Мария" });
    const quiet = await step("P3", "правки без изменения суммы: галочку «сняли», старая вкладка без полей оплаты");
    expect(quiet.vika?.telegram ?? []).toEqual([]);
    expect(quiet.owner?.telegram ?? []).toEqual([]);

    // Владелец сам отметил предоплату — сам себе не пишет.
    expect((await post("/api/events", own, base("pay4", vika, { clientName: "Глеб", clientPhone: "+7 999 444-00-22", day: day(12), price: 19900, prepaid: true }))).statusCode).toBe(200);
    const self = await step("P4", "ВЛАДЕЛЕЦ сам записал мероприятие с предоплатой");
    expect((self.owner?.bell ?? []).some((b) => b.includes("Предоплата"))).toBe(false);
    expect(self.owner?.telegram ?? []).toEqual([]);

    // Мероприятие без предоплаты (записано раньше): отметили позже — владельцу уведомление, ведущему «Изменено» с суммой.
    expect((await post("/api/events", mgr, base("pay5", vika, { clientName: "Дарья", clientPhone: "+7 999 333-00-44", day: day(13) }))).statusCode).toBe(200);
    await step("P5a", "мероприятие p5 записано по-старому, без оплаты");
    expect((await post("/api/events/pay5/refund", mgr)).json()).toMatchObject({ reason: "not-prepaid" });
    const b5 = tgOf("vika").length;
    expect((await post("/api/events", mgr, base("pay5", vika, { clientName: "Дарья", clientPhone: "+7 999 333-00-44", day: day(13), price: 15900, prepaid: true }))).statusCode).toBe(200);
    const p5 = await step("P5", "менеджер позже вписал стоимость 15 900 ₽ и отметил предоплату");
    expect(p5.owner?.bell.some((b) => b.includes("Предоплата 2 000 ₽ отмечена"))).toBe(true);
    expect(fullTg("vika", b5).some((t) => t.includes("К оплате на месте: 13 900 ₽"))).toBe(true);

    // Напоминание за 2 часа — тоже с суммой.
    await sql`update events set starts_at = now() + interval '100 minutes', ends_at = now() + interval '5 hours' where id = 'pay5'`;
    const b6 = tgOf("vika").length;
    await bot.remindNow();
    await step("P6", "напоминание Вике за 2 часа до начала p5");
    expect(fullTg("vika", b6).some((t) => t.includes("начало мероприятия") && t.includes("К оплате на месте: 13 900 ₽"))).toBe(true);

    // Меньше 48 часов до начала — «Вернуть предоплату» не работает, мероприятие остаётся.
    expect((await post("/api/events", mgr, base("pay7", vika, { clientName: "Ева", clientPhone: "+7 999 222-00-55", day: day(11), price: 21900, prepaid: true }))).statusCode).toBe(200);
    await step("P7a", "мероприятие p7 с предоплатой");
    await sql`update events set starts_at = now() + interval '47 hours', ends_at = now() + interval '51 hours' where id = 'pay7'`;
    r = await post("/api/events/pay7/refund", mgr);
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ reason: "late" });
    expect((await eventOf("pay7"))?.cancelled).toBe(false);
    const late = await step("P7", "до начала 47 часов: менеджер жмёт «Вернуть предоплату» — отказ", { code: r.statusCode });
    expect((late.owner?.bell ?? []).some((b) => b.includes("предоплату"))).toBe(false);
    expect(late.vika?.telegram ?? []).toEqual([]);
    // Ровно на границе — ещё можно.
    await sql`update events set starts_at = now() + interval '48 hours 5 minutes', ends_at = now() + interval '52 hours' where id = 'pay7'`;
    expect((await post("/api/events/pay7/refund", mgr)).statusCode).toBe(200);
    await step("P7b", "до начала 48 часов 5 минут: возврат проходит");

    // Вовремя: ведущий не может, менеджер может. Заказ закрыт у всех, владельцу — «верните предоплату», клиент — «Отказ».
    expect((await post("/api/events/pay1/refund", vk.cookie)).statusCode).toBe(403);
    const bv = tgOf("vika").length;
    const bo = tgOf("owner").length;
    r = await post("/api/events/pay1/refund", mgr);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ cancelled: true, refundBy: "Мария" });
    const p8 = await step("P8", "клиент отказался за 10 дней: менеджер нажал «Вернуть предоплату»", { event: await eventOf("pay1"), client: await clientStatus("79995550011") });
    expect((await eventOf("pay1"))?.cancelled).toBe(true);
    expect(await sql`select 1 from availability where id = 'ev-pay1'`).toHaveLength(0);
    expect(p8.vika?.bell.some((b) => b.includes("отменено"))).toBe(true);
    expect(fullTg("vika", bv).some((t) => t.includes("отменено"))).toBe(true);
    expect(p8.owner?.bell.some((b) => b.includes("Верните предоплату"))).toBe(true);
    expect(fullTg("owner", bo).some((t) => t.includes("Верните предоплату 2 000 ₽") && t.includes("Мария"))).toBe(true);
    expect(noClient([...fullTg("vika", bv), ...fullTg("owner", bo)])).toBe(true);
    expect(await clientStatus("79995550011")).toBe("lost");
    // Повтор — успех без новых сообщений; вернуть закрытое с возвратом нельзя.
    expect((await post("/api/events/pay1/refund", mgr)).statusCode).toBe(200);
    r = await post("/api/events/pay1/restore", mgr);
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ reason: "refunded" });
    const again = await step("P9", "повторное «Вернуть предоплату» и попытка «Вернуть мероприятие»");
    expect(again.owner?.telegram ?? []).toEqual([]);
    expect(again.vika?.telegram ?? []).toEqual([]);

    // «Отметить: вернул» — только владелец; менеджеру — в колокольчик.
    expect((await post("/api/events/pay1/refund-done", mgr)).statusCode).toBe(403);
    expect((await post("/api/events/pay4/refund-done", own)).json()).toMatchObject({ reason: "no-refund" });
    r = await post("/api/events/pay1/refund-done", own);
    expect(r.statusCode).toBe(200);
    expect(typeof (r.json() as { refundDoneAt?: number }).refundDoneAt).toBe("number");
    const done = await step("P10", "ВЛАДЕЛЕЦ отметил: предоплату вернул");
    expect(done.manager?.bell.some((b) => b.includes("Предоплата возвращена"))).toBe(true);
    expect((await post("/api/events/pay1/refund-done", own)).statusCode).toBe(200);
    expect(((await step("P11", "повтор «Отметить: вернул»")).manager?.bell ?? []).some((b) => b.includes("возвращена"))).toBe(false);

    // Обычная отмена мероприятия с предоплатой: предоплата остаётся отмеченной, вернуть мероприятие можно.
    expect((await post("/api/events/pay4/cancel", own)).statusCode).toBe(200);
    r = await post("/api/events/pay4/restore", own);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ price: 19900, cancelled: false });
    await step("P12", "обычная отмена и возврат мероприятия с предоплатой");
  }, 60_000);
});
