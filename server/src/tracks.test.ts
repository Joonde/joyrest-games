import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAdminPassword } from "./admin-password";
import { buildApp } from "./app";
import { migrate } from "./migrate";
import { audioMime, cleanLine } from "./tracks";

const mp3 = (fill: number) => Buffer.concat([Buffer.from("ID3"), Buffer.alloc(2000, fill)]);

describe("музыка: проверки без базы", () => {
  it("тип звука по первым байтам", () => {
    expect(audioMime(mp3(1))).toBe("audio/mpeg");
    expect(audioMime(Buffer.from([0xff, 0xfb, 0x90, 0x00]))).toBe("audio/mpeg");
    expect(audioMime(Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypM4A ")]))).toBe("audio/mp4");
    expect(audioMime(Buffer.from("OggS\0\0"))).toBe("audio/ogg");
    expect(audioMime(Buffer.from("<html>"))).toBeNull();
  });

  it("название — одна строка", () => {
    expect(cleanLine("  Весёлый\nтрек\u0007 ", 120)).toBe("Весёлый трек");
  });
});

// Нужна настоящая PostgreSQL: в CI — сервис, локально — TEST_DATABASE_URL. Своя схема.
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("музыка на PostgreSQL", () => {
  const SCHEMA = "tracks_test";
  const admin = postgres(url ?? "", { max: 1, onnotice: () => {} });
  const sql = postgres(url ?? "", { max: 3, onnotice: () => {}, connection: { search_path: SCHEMA } });
  const HOST = "games.test";
  const app = buildApp({
    version: "t",
    publicDir: null,
    checkDatabase: async () => true,
    sql,
    mediaDir: mkdtempSync(join(tmpdir(), "joyrest-audio-")),
    auth: { limits: { perAccount: 1000, perIp: 1000, deviceDelayMs: () => 0 } },
  });
  let owner = "";
  let anna = "";
  let boris = "";

  const cookieOf = (res: { headers: Record<string, unknown> }) => {
    const raw = res.headers["set-cookie"];
    return (Array.isArray(raw) ? String(raw[0]) : String(raw ?? "")).split(";")[0] ?? "";
  };
  const headers = (cookie: string) => ({ host: HOST, "x-joyrest": "1", origin: `https://${HOST}`, cookie });
  const post = (path: string, cookie: string, payload: object = {}) => app.inject({ method: "POST", url: path, headers: headers(cookie), payload });
  const get = (path: string, cookie: string) => app.inject({ method: "GET", url: path, headers: { host: HOST, cookie } });
  const upload = (id: string, cookie: string, body: Buffer) =>
    app.inject({ method: "PUT", url: `/api/tracks/${id}/file`, headers: { ...headers(cookie), "content-type": "audio/mpeg", "x-duration": "61000" }, payload: body });
  const login = async (email: string, password: string) => cookieOf(await post("/api/auth/login", "", { email, password }));

  beforeAll(async () => {
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.unsafe(`create schema ${SCHEMA}`);
    await migrate(sql, resolve(import.meta.dirname, "../migrations"));
    await setAdminPassword(sql, "owner@example.com", "пароль-владельца-12");
    owner = await login("owner@example.com", "пароль-владельца-12");
    for (const [email, name] of [["anna@example.com", "Анна"], ["boris@example.com", "Борис"]] as const) {
      const created = (await post("/api/users", owner, { email, name })).json();
      const cookie = await login(email, created.temporaryPassword);
      if (name === "Анна") anna = cookie;
      else boris = cookie;
    }
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  it("ведущий загружает трек себе: описание, потом файл; права подтверждает", async () => {
    expect((await post("/api/tracks", anna, { id: "t1", title: "Лобби", category: "lobby", license: "other" })).statusCode).toBe(400);
    expect((await post("/api/tracks", anna, { id: "t1", title: "Лобби", category: "lobby", license: "pixabay" })).statusCode).toBe(200);
    expect((await post("/api/tracks", anna, { id: "t2", title: "В общую", license: "pixabay", scope: "agency" })).statusCode).toBe(403);
    expect((await upload("t1", anna, Buffer.from("<html>not audio"))).statusCode).toBe(400);
    expect((await upload("t1", boris, mp3(1))).statusCode).toBe(403);
    const done = await upload("t1", anna, mp3(1));
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({ ready: true, durationMs: 61000, category: "lobby", license: "pixabay" });
    // Тот же файл — успех, другой под тем же id — нельзя.
    expect((await upload("t1", anna, mp3(1))).statusCode).toBe(200);
    expect((await upload("t1", anna, mp3(2))).statusCode).toBe(409);
    const lists = (await get("/api/tracks", anna)).json();
    expect(lists.mine.map((t: { id: string }) => t.id)).toEqual(["t1"]);
    expect(lists.library).toEqual([]);
    expect((await get("/api/tracks", boris)).json().mine).toEqual([]);
  });

  it("большой файл без входа отклоняется до чтения тела", async () => {
    const big = Buffer.alloc(200 * 1024, 1);
    expect((await upload("t1", "", big)).statusCode).toBe(401);
    expect((await upload("t1", "__Host-jr_s=fake", big)).statusCode).toBe(401);
    // Маленькие запросы без входа доходят до обработчика (там тот же ответ).
    expect((await post("/api/tracks/t1/share", "")).statusCode).toBe(401);
  });

  it("в общую — через проверку владельца; файл открывает экран зала", async () => {
    expect((await post("/api/tracks/t1/share", boris)).statusCode).toBe(403);
    expect((await post("/api/tracks/t1/share", anna)).json().shareStatus).toBe("pending");
    expect((await get("/api/tracks?status=pending", anna)).statusCode).toBe(403);
    expect((await get("/api/tracks?status=pending", owner)).json().map((t: { id: string }) => t.id)).toEqual(["t1"]);
    expect((await post("/api/tracks/t1/accept", anna)).statusCode).toBe(403);
    expect((await post("/api/tracks/t1/accept", owner)).json().shareStatus).toBe("accepted");
    const library = (await get("/api/tracks", boris)).json().library as Array<{ id: string; title: string; scope: string }>;
    expect(library).toHaveLength(1);
    expect(library[0]).toMatchObject({ title: "Лобби", scope: "agency" });
    // Экран зала — устройство без входа ведущего.
    const device = cookieOf(await post("/api/auth/device", "", {}));
    const file = await get(`/api/tracks/${library[0]?.id}/file`, device);
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toContain("audio/mpeg");
    expect((await get(`/api/tracks/${library[0]?.id}/file`, "")).statusCode).toBe(401);
    // Повторно принятый трек обновляет ту же копию.
    await post("/api/tracks/t1/share", anna);
    await post("/api/tracks/t1/accept", owner);
    expect((await get("/api/tracks", boris)).json().library).toHaveLength(1);
  });

  it("отклонение с причиной; общий трек правит только владелец агентства", async () => {
    await post("/api/tracks", boris, { id: "b1", title: "Мой трек", license: "own" });
    await upload("b1", boris, mp3(3));
    await post("/api/tracks/b1/share", boris);
    const rejected = (await post("/api/tracks/b1/reject", owner, { reason: "Песня с радио — нет прав" })).json();
    expect(rejected).toMatchObject({ shareStatus: "rejected", shareReason: "Песня с радио — нет прав" });
    const lib = (await get("/api/tracks", anna)).json().library[0] as { id: string };
    expect((await app.inject({ method: "DELETE", url: `/api/tracks/${lib.id}`, headers: headers(anna) })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url: `/api/tracks/${lib.id}`, headers: headers(owner), payload: { title: "Лобби JoyRest" } })).json().title).toBe(
      "Лобби JoyRest",
    );
  });
});
