import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_UID } from "../../src/data/config";
import { parseAdminInput, setAdminPassword } from "./admin-password";
import { buildApp } from "./app";
import { newUserId, readCookie, SESSION_COOKIE } from "./auth";
import { migrate } from "./migrate";
import { hashPassword, SCRYPT_PARALLEL, scryptSlots, Slots, verifyPassword } from "./password";

describe("пароли", () => {
  it("хэш проверяется, чужой пароль и испорченный хэш — нет", async () => {
    const hash = await hashPassword("пароль-ведущего");
    expect(hash).toMatch(/^scrypt\$15\$8\$1\$/);
    expect(hash).not.toContain("пароль");
    expect(await verifyPassword("пароль-ведущего", hash)).toBe(true);
    expect(await verifyPassword("пароль-ведущег", hash)).toBe(false);
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "scrypt$15$8$1$AA$BB")).toBe(false);
    expect(await hashPassword("пароль-ведущего")).not.toBe(hash);
  });
});

describe("очередь проверок пароля", () => {
  it("не больше N задач одновременно, остальные ждут по порядку; ошибка освобождает место", async () => {
    const slots = new Slots(2);
    let running = 0;
    let most = 0;
    const finished: number[] = [];
    const task = (i: number) =>
      slots.run(async () => {
        running += 1;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 10));
        running -= 1;
        if (i === 1) throw new Error("сбой");
        finished.push(i);
        return i;
      });
    const results = await Promise.allSettled([0, 1, 2, 3, 4, 5].map(task));
    expect(most).toBe(2);
    expect(slots.peak).toBe(2);
    expect(results[1]?.status).toBe("rejected");
    expect(finished).toEqual([0, 2, 3, 4, 5]);
    expect(slots.queued).toBe(0);
    expect(await slots.run(async () => "дальше работает")).toBe("дальше работает");
  });

  it(`scrypt: одновременно не больше ${SCRYPT_PARALLEL} хэшей, даже если весь зал входит разом`, async () => {
    expect(SCRYPT_PARALLEL).toBe(2);
    scryptSlots.peak = 0;
    const hashes = await Promise.all(Array.from({ length: 6 }, (_, i) => hashPassword(`пароль-${i}-длинный`)));
    const checks = await Promise.all(hashes.map((hash, i) => verifyPassword(`пароль-${i}-длинный`, hash)));
    expect(checks).toEqual([true, true, true, true, true, true]);
    expect(scryptSlots.peak).toBe(SCRYPT_PARALLEL);
    expect(scryptSlots.queued).toBe(0);
  });
});

describe("cookie и id", () => {
  it("токен читается только своего имени и формата", () => {
    const token = "a".repeat(43);
    expect(readCookie(`x=1; ${SESSION_COOKIE}=${token}; y=2`, SESSION_COOKIE)).toBe(token);
    expect(readCookie(`${SESSION_COOKIE}=коротко`, SESSION_COOKIE)).toBeNull();
    expect(readCookie(undefined, SESSION_COOKIE)).toBeNull();
    expect(readCookie(`other=${token}`, SESSION_COOKIE)).toBeNull();
  });

  it("id ведущего — 20 букв и цифр", () => {
    const ids = new Set(Array.from({ length: 50 }, newUserId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9]{20}$/);
  });
});

describe("пароль владельца из joyrest admin-password", () => {
  it("почта — первая строка, пароль — вторая, не короче 12 символов", () => {
    expect(parseAdminInput("Owner@Example.com\r\nочень-длинный-пароль\n")).toEqual({
      ok: true,
      email: "owner@example.com",
      password: "очень-длинный-пароль",
    });
    expect(parseAdminInput("owner@example.com\nкороткий\n")).toMatchObject({ ok: false });
    expect(parseAdminInput("не почта\nочень-длинный-пароль\n")).toMatchObject({ ok: false });
  });
});

// Нужна настоящая PostgreSQL: в CI — сервис, локально — TEST_DATABASE_URL.
// Своя схема: тесты миграций в соседнем файле чистят общие таблицы.
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("вход ведущих на PostgreSQL", () => {
  const SCHEMA = "auth_test";
  const admin = postgres(url ?? "", { max: 1, onnotice: () => {} });
  const sql = postgres(url ?? "", { max: 2, onnotice: () => {}, connection: { search_path: SCHEMA } });
  const HOST = "games.test";
  const siteDir = mkdtempSync(join(tmpdir(), "joyrest-site-"));
  writeFileSync(join(siteDir, "index.html"), "<html></html>");
  const app = buildApp({
    version: "t",
    publicDir: null,
    checkDatabase: async () => true,
    sql,
    auth: { limits: { perAccount: 1000, perIp: 1000, windowMs: 60_000 } },
    site: { dir: siteDir, enabled: false, stubDir: null, hosts: ["site.test"], indexing: false },
  });
  const OWNER_EMAIL = "owner@example.com";
  const OWNER_PASSWORD = "пароль-владельца-12";

  beforeAll(async () => {
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.unsafe(`create schema ${SCHEMA}`);
    await migrate(sql, resolve(import.meta.dirname, "../migrations"));
    await setAdminPassword(sql, OWNER_EMAIL, OWNER_PASSWORD);
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  function cookieOf(res: { headers: Record<string, unknown> }): string {
    const raw = res.headers["set-cookie"];
    const header = Array.isArray(raw) ? String(raw[0]) : String(raw ?? "");
    return header.split(";")[0] ?? "";
  }

  function post(path: string, body: unknown, cookie = "", headers: Record<string, string> = {}) {
    return app.inject({
      method: "POST",
      url: path,
      headers: { host: HOST, "x-joyrest": "1", origin: `https://${HOST}`, cookie, ...headers },
      payload: body as object,
    });
  }

  function get(path: string, cookie = "") {
    return app.inject({ method: "GET", url: path, headers: { host: HOST, cookie } });
  }

  async function login(email: string, password: string): Promise<string> {
    const res = await post("/api/auth/login", { email, password });
    expect(res.statusCode, res.body).toBe(200);
    return cookieOf(res);
  }

  it("без входа — пустой ответ, без кэша", async () => {
    const res = await get("/api/auth/me");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: null, profile: null });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("изменения без заголовка X-JoyRest или с чужого адреса отклоняются", async () => {
    const noHeader = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { host: HOST },
      payload: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
    });
    expect(noHeader.statusCode).toBe(403);
    const foreign = await post("/api/auth/login", { email: OWNER_EMAIL, password: OWNER_PASSWORD }, "", { origin: "https://evil.test" });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.headers["set-cookie"]).toBeUndefined();
  });

  it("на адресах сайта агентства API нет", async () => {
    const res = await app.inject({ method: "GET", url: "/api/auth/me", headers: { host: "site.test" } });
    expect(res.statusCode).toBe(404);
  });

  it("неверный пароль и неизвестная почта — одинаковая ошибка", async () => {
    const wrong = await post("/api/auth/login", { email: OWNER_EMAIL, password: "не тот пароль" });
    const unknown = await post("/api/auth/login", { email: "nobody@example.com", password: "не тот пароль" });
    for (const res of [wrong, unknown]) {
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "auth/invalid-credential" });
    }
  });

  it("владелец входит: cookie __Host-, httpOnly, Secure, SameSite=Lax, 30 дней", async () => {
    const res = await post("/api/auth/login", { email: "Owner@Example.com ", password: OWNER_PASSWORD });
    expect(res.statusCode).toBe(200);
    const header = String(res.headers["set-cookie"]);
    expect(header).toMatch(/^__Host-jr_s=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax$/);
    expect(res.json().profile).toMatchObject({ uid: ADMIN_UID, role: "admin", active: true, mustChangePassword: false });

    const me = await get("/api/auth/me", cookieOf(res));
    expect(me.json()).toMatchObject({ user: { uid: ADMIN_UID, email: OWNER_EMAIL, anonymous: false }, profile: { role: "admin" } });
    // В базе — только хэш токена.
    const token = cookieOf(res).split("=")[1] ?? "";
    const stored = await sql`select 1 from auth_sessions where token_hash = ${token}`;
    expect(stored.length).toBe(0);
  });

  it("admin добавляет ведущего с временным паролем; почта второй раз — ошибка", async () => {
    const owner = await login(OWNER_EMAIL, OWNER_PASSWORD);
    const res = await post("/api/users", { email: "Host@Example.com", name: "  Аня  Ведущая " }, owner);
    expect(res.statusCode, res.body).toBe(200);
    const { account, temporaryPassword } = res.json();
    expect(account).toMatchObject({ role: "host", name: "Аня Ведущая", active: true, email: "host@example.com" });
    expect(temporaryPassword).toMatch(/^[A-Za-z0-9]{10}$/);

    const again = await post("/api/users", { email: "host@example.com", name: "Другая" }, owner);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: "auth/email-already-in-use" });

    const list = await get("/api/users", owner);
    expect(list.json().map((h: { email: string }) => h.email)).toEqual(expect.arrayContaining([OWNER_EMAIL, "host@example.com"]));
  });

  it("ведущий входит по временному паролю, обязан сменить его; список ведущих ему недоступен", async () => {
    const owner = await login(OWNER_EMAIL, OWNER_PASSWORD);
    const created = (await post("/api/users", { email: "temp@example.com", name: "Боря" }, owner)).json();
    const res = await post("/api/auth/login", { email: "temp@example.com", password: created.temporaryPassword });
    expect(res.json().profile).toMatchObject({ role: "host", mustChangePassword: true });
    const host = cookieOf(res);
    const otherDevice = await login("temp@example.com", created.temporaryPassword);

    expect((await get("/api/users", host)).statusCode).toBe(403);
    expect((await post("/api/users", { email: "x@example.com", name: "X" }, host)).statusCode).toBe(403);

    const wrong = await post("/api/auth/password", { currentPassword: "не тот", newPassword: "новый-пароль" }, host);
    expect(wrong.json()).toEqual({ error: "auth/wrong-password" });
    const weak = await post("/api/auth/password", { currentPassword: created.temporaryPassword, newPassword: "1234" }, host);
    expect(weak.json()).toEqual({ error: "auth/weak-password" });

    const ok = await post("/api/auth/password", { currentPassword: created.temporaryPassword, newPassword: "новый-пароль" }, host);
    expect(ok.statusCode).toBe(200);
    expect((await get("/api/auth/me", host)).json().profile.mustChangePassword).toBe(false);
    // Другие устройства вышли, временный пароль больше не подходит.
    expect((await get("/api/auth/me", otherDevice)).json().user).toBeNull();
    expect((await post("/api/auth/login", { email: "temp@example.com", password: created.temporaryPassword })).statusCode).toBe(401);
    await login("temp@example.com", "новый-пароль");
  });

  it("отключение выводит ведущего и не пускает снова; включение возвращает доступ", async () => {
    const owner = await login(OWNER_EMAIL, OWNER_PASSWORD);
    const created = (await post("/api/users", { email: "off@example.com", name: "Вера" }, owner)).json();
    const uid = created.account.uid;
    const host = await login("off@example.com", created.temporaryPassword);

    expect((await post(`/api/users/${uid}/active`, { active: false }, owner)).statusCode).toBe(200);
    expect((await get("/api/auth/me", host)).json().user).toBeNull();
    const blocked = await post("/api/auth/login", { email: "off@example.com", password: created.temporaryPassword });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toEqual({ error: "auth/user-disabled" });

    expect((await post(`/api/users/${uid}/active`, { active: true }, owner)).statusCode).toBe(200);
    await login("off@example.com", created.temporaryPassword);
  });

  it("владельца и себя отключить или сбросить пароль нельзя", async () => {
    const owner = await login(OWNER_EMAIL, OWNER_PASSWORD);
    expect((await post(`/api/users/${ADMIN_UID}/active`, { active: false }, owner)).statusCode).toBe(403);
    expect((await post(`/api/users/${ADMIN_UID}/password`, {}, owner)).statusCode).toBe(403);
    expect((await post("/api/users/nobody/password", {}, owner)).statusCode).toBe(404);
  });

  it("новый временный пароль: старый не подходит, ведущий выходит со всех устройств", async () => {
    const owner = await login(OWNER_EMAIL, OWNER_PASSWORD);
    const created = (await post("/api/users", { email: "reset@example.com", name: "Гоша" }, owner)).json();
    const host = await login("reset@example.com", created.temporaryPassword);

    const res = await post(`/api/users/${created.account.uid}/password`, {}, owner);
    expect(res.statusCode).toBe(200);
    const { temporaryPassword } = res.json();
    expect(temporaryPassword).not.toBe(created.temporaryPassword);
    expect((await get("/api/auth/me", host)).json().user).toBeNull();
    expect((await post("/api/auth/login", { email: "reset@example.com", password: created.temporaryPassword })).statusCode).toBe(401);
    const again = await post("/api/auth/login", { email: "reset@example.com", password: temporaryPassword });
    expect(again.json().profile.mustChangePassword).toBe(true);
  });

  it("после 3 попыток на адрес и почту — пауза, с другого адреса можно", async () => {
    const limited = buildApp({ version: "t", publicDir: null, checkDatabase: async () => true, sql, auth: { limits: { perAccount: 3 } } });
    const attempt = (ip: string) =>
      limited.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { host: HOST, "x-joyrest": "1", "x-forwarded-for": ip },
        payload: { email: OWNER_EMAIL, password: "не тот пароль" },
      });
    for (let i = 0; i < 3; i += 1) expect((await attempt("203.0.113.7")).statusCode).toBe(401);
    const blocked = await attempt("203.0.113.7");
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toEqual({ error: "auth/too-many-requests" });
    expect((await attempt("203.0.113.8")).statusCode).toBe(401);
    await limited.close();
  });

  it("просроченный сеанс не действует; выход удаляет сеанс", async () => {
    const owner = await login(OWNER_EMAIL, OWNER_PASSWORD);
    await sql`update auth_sessions set expires_at = now() - interval '1 minute'`;
    const expired = await get("/api/auth/me", owner);
    expect(expired.json().user).toBeNull();
    expect(String(expired.headers["set-cookie"])).toContain("Max-Age=0");

    const fresh = await login(OWNER_EMAIL, OWNER_PASSWORD);
    expect((await post("/api/auth/logout", {}, fresh)).statusCode).toBe(200);
    expect((await get("/api/auth/me", fresh)).json().user).toBeNull();
  });

  it("почта владельца, занятая ведущим, не перезаписывается", async () => {
    await expect(setAdminPassword(sql, "host@example.com", "ещё-один-пароль-12")).rejects.toThrow(/уже у ведущего/);
    const [row] = await sql<{ email: string }[]>`select email from users where id = ${ADMIN_UID}`;
    expect(row?.email).toBe(OWNER_EMAIL);
  });
});
