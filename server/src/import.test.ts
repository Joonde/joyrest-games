import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_UID } from "../../src/data/config";
import { setAdminPassword } from "./admin-password";
import { buildApp } from "./app";
import { migrate } from "./migrate";

function webp(size: number, fill = 1): Buffer {
  const body = Buffer.alloc(Math.max(0, size - 12), fill);
  return Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), body]);
}

const DAY = 24 * 60 * 60_000;

// Нужна настоящая PostgreSQL: в CI — сервис, локально — TEST_DATABASE_URL. Своя схема.
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("перенос из Firebase на PostgreSQL", () => {
  const SCHEMA = "import_test";
  const admin = postgres(url ?? "", { max: 1, onnotice: () => {} });
  const sql = postgres(url ?? "", { max: 3, onnotice: () => {}, connection: { search_path: SCHEMA } });
  const HOST = "games.test";
  const mediaDir = mkdtempSync(join(tmpdir(), "joyrest-media-"));
  const app = buildApp({
    version: "t",
    publicDir: null,
    checkDatabase: async () => true,
    sql,
    mediaDir,
    auth: { limits: { perAccount: 1000, perIp: 1000, deviceDelayMs: () => 0 } },
    import: { freeBytes: async () => 100 * 1024 ** 3 },
  });
  let owner = "";
  let host = "";

  const cookieOf = (res: { headers: Record<string, unknown> }) => {
    const raw = res.headers["set-cookie"];
    return (Array.isArray(raw) ? String(raw[0]) : String(raw ?? "")).split(";")[0] ?? "";
  };
  const headers = (cookie: string) => ({ host: HOST, "x-joyrest": "1", origin: `https://${HOST}`, cookie });
  const post = (path: string, cookie: string, payload: object) => app.inject({ method: "POST", url: path, headers: headers(cookie), payload });
  const get = (path: string, cookie: string) => app.inject({ method: "GET", url: path, headers: { host: HOST, cookie } });
  const put = (path: string, cookie: string, bytes: Buffer) =>
    app.inject({ method: "PUT", url: path, headers: { ...headers(cookie), "content-type": "image/webp", "x-width": "1280", "x-height": "720" }, payload: bytes });

  const game = (id: string, title: string, updatedAt: number | null) => ({
    id,
    scope: "personal",
    ownerId: "fbHost1",
    title,
    mechanic: "quiz",
    themeId: "joyrest",
    ageRating: "0+",
    playMode: "solo",
    content: { questions: [{ id: "q1", imageId: "img1" }] },
    createdAt: Date.now() - 10 * DAY,
    updatedAt,
  });

  beforeAll(async () => {
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.unsafe(`create schema ${SCHEMA}`);
    await migrate(sql, resolve(import.meta.dirname, "../migrations"));
    await setAdminPassword(sql, "owner@example.com", "пароль-владельца-12");
    owner = cookieOf(await post("/api/auth/login", "", { email: "owner@example.com", password: "пароль-владельца-12" }));
    const created = (await post("/api/users", owner, { email: "anna@example.com", name: "Анна" })).json();
    host = cookieOf(await post("/api/auth/login", "", { email: "anna@example.com", password: created.temporaryPassword }));
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  it("переносить может только владелец агентства", async () => {
    expect((await post("/api/import/users", "", { users: [] })).statusCode).toBe(401);
    expect((await post("/api/import/users", host, { users: [] })).statusCode).toBe(403);
    expect((await post("/api/import/verify", host, {})).statusCode).toBe(403);
    expect((await post("/api/import/users", owner, { users: [] })).statusCode).toBe(200);
  });

  it("ведущие: новые без пароля, повтор обновляет, владелец и вошедшие не меняются, занятая почта — пропуск", async () => {
    const users = [
      { uid: ADMIN_UID, email: "old-owner@example.com", name: "Старое имя", role: "admin", active: true, createdAt: 1 },
      { uid: "fbHost1", email: "Boris@Example.com", name: "Борис", role: "host", active: true, createdAt: Date.now() - 100 * DAY },
      { uid: "fbHost2", email: "anna@example.com", name: "Другая Анна", role: "host", active: true, createdAt: null },
      { uid: "fbHost3", email: "", name: "Без почты", role: "host", active: false, createdAt: null },
    ];
    const res = await post("/api/import/users", owner, { users });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      saved: 2,
      skipped: [
        { id: "fbHost2", reason: "email-taken" },
        { id: "fbHost3", reason: "invalid" },
      ],
    });
    const [ownerRow] = await sql<{ email: string; name: string }[]>`select email, name from users where id = ${ADMIN_UID}`;
    expect(ownerRow?.email).toBe("owner@example.com");
    const [boris] = await sql<{ email: string; password_hash: string | null }[]>`select email, password_hash from users where id = 'fbHost1'`;
    expect(boris).toEqual({ email: "boris@example.com", password_hash: null });

    // Без пароля войти нельзя; в списке ведущих — «пароль не выдан».
    expect((await post("/api/auth/login", "", { email: "boris@example.com", password: "любой-пароль-123" })).statusCode).toBe(401);
    const list = (await get("/api/users", owner)).json() as Array<{ uid: string; noPassword?: boolean }>;
    expect(list.find((u) => u.uid === "fbHost1")?.noPassword).toBe(true);
    expect(list.find((u) => u.uid === ADMIN_UID)?.noPassword).toBeUndefined();

    // Повтор обновляет, пока пароля нет.
    await post("/api/import/users", owner, { users: [{ ...users[1], name: "Борис П." }] });
    expect((await sql`select name from users where id = 'fbHost1'`)[0]?.name).toBe("Борис П.");

    // Ведущий получил пароль здесь — повтор его больше не трогает.
    const issued = (await post("/api/users/fbHost1/password", owner, {})).json();
    expect(issued.temporaryPassword).toBeTruthy();
    await post("/api/import/users", owner, { users: [{ ...users[1], name: "Старое из Firebase", active: false }] });
    expect((await sql`select name, active from users where id = 'fbHost1'`)[0]).toEqual({ name: "Борис П.", active: true });
  });

  it("игры: повтор не затирает правку, сделанную здесь позже", async () => {
    const old = Date.now() - 5 * DAY;
    expect((await post("/api/import/games", owner, { games: [game("fbGame1", "Квиз", old), game("fbGame2", "Без даты", null)] })).json()).toEqual({ saved: 2, skipped: [] });
    const [row] = await sql<{ title: string; created_at: Date; updated_at: Date }[]>`select title, created_at, updated_at from games where id = 'fbGame1'`;
    expect(row?.updated_at.getTime()).toBe(old);

    // В Firebase новее — обновляется.
    await post("/api/import/games", owner, { games: [game("fbGame1", "Квиз 2", old + 1000)] });
    expect((await sql`select title from games where id = 'fbGame1'`)[0]?.title).toBe("Квиз 2");

    // Здесь правили позже — повтор со старой версией ничего не меняет.
    await sql`update games set title = 'Правка на сервере', updated_at = now() where id = 'fbGame1'`;
    await post("/api/import/games", owner, { games: [game("fbGame1", "Квиз 2", old + 1000)] });
    expect((await sql`select title from games where id = 'fbGame1'`)[0]?.title).toBe("Правка на сервере");

    // Плохая игра — пропуск, остальные пишутся.
    const bad = (await post("/api/import/games", owner, { games: [{ id: "fbBad", title: 5 }] })).json();
    expect(bad).toEqual({ saved: 0, skipped: ["fbBad"] });
  });

  it("картинки: сервер называет недостающие, загрузка повторяема, лимит ведущего не мешает", async () => {
    const items = [
      { game: "fbGame1", media: "img1" },
      { game: "noSuchGame", media: "img9" },
    ];
    const missing = (await post("/api/import/media-missing", owner, { items })).json();
    expect(missing).toEqual({
      missing: [
        { game: "fbGame1", media: "img1", variant: "full" },
        { game: "fbGame1", media: "img1", variant: "small" },
      ],
    });
    // Старые картинки Firebase бывают до 400 КБ — больше обычного лимита small.
    const small = webp(200 * 1024, 2);
    expect((await put("/api/import/media/fbGame1/img1/full", owner, webp(300 * 1024, 1))).statusCode).toBe(200);
    expect((await put("/api/import/media/fbGame1/img1/small", owner, small)).statusCode).toBe(200);
    expect((await put("/api/import/media/fbGame1/img1/small", owner, small)).statusCode).toBe(200);
    expect((await put("/api/import/media/fbGame1/img1/small", owner, webp(1000, 7))).statusCode).toBe(409);
    expect((await put("/api/import/media/fbGame1/img1/hd", owner, small)).statusCode).toBe(400);
    expect((await put("/api/import/media/fbGame1/img2/full", host, small)).statusCode).toBe(403);
    expect((await put("/api/import/media/noSuchGame/img1/full", owner, small)).statusCode).toBe(404);
    expect((await post("/api/import/media-missing", owner, { items })).json()).toEqual({ missing: [] });

    // Картинку открывает обычный адрес.
    const image = await get("/api/media/fbGame1/img1/small", owner);
    expect(image.statusCode).toBe(200);
    expect(image.rawPayload.equals(small)).toBe(true);
  });

  it("история: upsert по id, итоги открываются по ссылке", async () => {
    const result = {
      id: "fbResult1",
      hostId: "fbHost1",
      code: "123456",
      gameTitle: "Квиз",
      mechanic: "quiz",
      themeId: "joyrest-day",
      playMode: "teams",
      playedAt: Date.now() - 20 * DAY,
      participantsCount: 12,
      board: [{ name: "Красные", score: 900, colorIndex: 0 }, { name: "Синие", score: 700 }],
    };
    expect((await post("/api/import/results", owner, { results: [result] })).json()).toEqual({ saved: 1 });
    expect((await post("/api/import/results", owner, { results: [{ ...result, participantsCount: 13 }] })).json()).toEqual({ saved: 1 });
    const res = await get("/api/results/fbResult1", "");
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ id: "fbResult1", hostId: "fbHost1", playMode: "teams", participantsCount: 13, board: result.board });
  });

  it("сверка: сколько из переданного есть здесь и сколько ведущих без пароля", async () => {
    await post("/api/import/users", owner, { users: [{ uid: "fbHost4", email: "vera@example.com", name: "Вера", role: "host", active: true }] });
    const res = await post("/api/import/verify", owner, {
      users: [ADMIN_UID, "fbHost1", "fbHost4", "fbHost2"],
      games: ["fbGame1", "fbGame2", "fbBad"],
      results: ["fbResult1", "nope"],
      media: [
        { game: "fbGame1", media: "img1", variant: "full" },
        { game: "fbGame1", media: "img1", variant: "small" },
        { game: "fbGame2", media: "img1", variant: "full" },
      ],
    });
    expect(res.json()).toEqual({ users: 3, games: 2, results: 1, media: 2, withoutPassword: 1 });
  });
});
