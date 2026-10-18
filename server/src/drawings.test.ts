import { mkdtempSync, readdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAdminPassword } from "./admin-password";
import { buildApp } from "./app";
import { cleanupDrawings } from "./cleanup";
import { DRAWING_MAX_BYTES } from "./drawings";
import { migrate } from "./migrate";

const webp = (fill: number, size = 300) => Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4, 0), Buffer.from("WEBP"), Buffer.alloc(size, fill)]);

// Нужна настоящая PostgreSQL: в CI — сервис, локально — TEST_DATABASE_URL. Своя схема.
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("рисунки «Аквариума и Ёлки» на PostgreSQL", () => {
  const SCHEMA = "drawings_test";
  const admin = postgres(url ?? "", { max: 1, onnotice: () => {} });
  const sql = postgres(url ?? "", { max: 3, onnotice: () => {}, connection: { search_path: SCHEMA } });
  const HOST = "games.test";
  const mediaDir = mkdtempSync(join(tmpdir(), "joyrest-drawings-"));
  const app = buildApp({
    version: "t",
    publicDir: null,
    checkDatabase: async () => true,
    sql,
    mediaDir,
    auth: { limits: { perAccount: 1000, perIp: 1000, deviceDelayMs: () => 0 } },
  });
  let host = "";

  const cookieOf = (res: { headers: Record<string, unknown> }) => {
    const raw = res.headers["set-cookie"];
    return (Array.isArray(raw) ? String(raw[0]) : String(raw ?? "")).split(";")[0] ?? "";
  };
  const call = (method: "GET" | "POST", path: string, cookie: string, payload?: object) =>
    app.inject({ method, url: path, headers: method === "GET" ? { host: HOST, cookie } : { host: HOST, "x-joyrest": "1", origin: `https://${HOST}`, cookie }, payload });
  const upload = (session: string, cookie: string, body: Buffer, type = "image/webp") =>
    app.inject({ method: "PUT", url: `/api/sessions/${session}/drawings`, headers: { host: HOST, "x-joyrest": "1", origin: `https://${HOST}`, cookie, "content-type": type }, payload: body });
  async function device(): Promise<{ cookie: string; uid: string }> {
    const res = await call("POST", "/api/auth/device", "");
    return { cookie: cookieOf(res), uid: res.json().uid };
  }

  beforeAll(async () => {
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.unsafe(`create schema ${SCHEMA}`);
    await migrate(sql, resolve(import.meta.dirname, "../migrations"));
    await setAdminPassword(sql, "owner@example.com", "пароль-владельца-12");
    host = cookieOf(await call("POST", "/api/auth/login", "", { email: "owner@example.com", password: "пароль-владельца-12" }));
    const res = await call("POST", "/api/sessions", host, {
      id: "aqua1",
      gameId: null,
      gameTitle: "Аквариум",
      playMode: "solo",
      screenMode: "laptop",
      themeId: "joyrest",
      mechanic: "aquarium",
      gameSnapshot: { title: "Аквариум", content: { scene: "aqua" } },
    });
    expect(res.statusCode, res.body).toBe(200);
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  it("гость игры присылает рисунок, экран открывает его по отпечатку; чужой телефон и мусор — отказ", async () => {
    const guest = await device();
    // Не игрок этой игры — нельзя.
    expect((await upload("aqua1", guest.cookie, webp(1))).statusCode).toBe(403);
    expect((await call("POST", `/api/sessions/aqua1/participants/${guest.uid}/join`, guest.cookie, { name: "Аня", teamId: null })).statusCode).toBe(200);
    const res = await upload("aqua1", guest.cookie, webp(1));
    expect(res.statusCode, res.body).toBe(200);
    const sha = res.json().sha as string;
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    // Тот же рисунок ещё раз — тот же файл.
    expect((await upload("aqua1", guest.cookie, webp(1))).json().sha).toBe(sha);
    // Без входа — нельзя, не картинка — нельзя, слишком большой — нельзя.
    expect((await upload("aqua1", "", webp(1))).statusCode).toBe(401);
    expect((await upload("aqua1", guest.cookie, Buffer.from("<svg></svg>"), "image/webp")).statusCode).toBe(400);
    expect((await upload("aqua1", guest.cookie, webp(2, DRAWING_MAX_BYTES))).statusCode).toBe(413);
    expect((await upload("nope", guest.cookie, webp(1))).statusCode).toBe(404);
    // Экран зала (другое устройство) открывает файл.
    const screen = await device();
    const file = await call("GET", `/api/drawings/${sha}`, screen.cookie);
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toBe("image/webp");
    expect((await call("GET", `/api/drawings/${sha}`, "")).statusCode).toBe(401);
    expect((await call("GET", `/api/drawings/../etc`, screen.cookie)).statusCode).toBe(404);
    // Ведущий своей игры тоже может прислать.
    expect((await upload("aqua1", host, webp(3))).statusCode).toBe(200);
  });

  it("с одного телефона — не больше 20 рисунков за 10 минут", async () => {
    const guest = await device();
    await call("POST", `/api/sessions/aqua1/participants/${guest.uid}/join`, guest.cookie, { name: "Боря", teamId: null });
    const codes: number[] = [];
    for (let i = 0; i < 21; i++) codes.push((await upload("aqua1", guest.cookie, webp(10 + i))).statusCode);
    expect(codes.slice(0, 20).every((c) => c === 200)).toBe(true);
    expect(codes[20]).toBe(429);
  });

  it("ночная уборка оставляет рисунки на экране и убирает старые без ссылок", async () => {
    const guest = await device();
    await call("POST", `/api/sessions/aqua1/participants/${guest.uid}/join`, guest.cookie, { name: "Вика", teamId: null });
    const kept = (await upload("aqua1", guest.cookie, webp(100))).json().sha as string;
    const lost = (await upload("aqua1", guest.cookie, webp(101))).json().sha as string;
    await sql`update sessions set state = jsonb_set(state, '{result}', ${sql.json({ items: [{ id: "i1", sha: kept }] })}) where id = 'aqua1'`;
    const old = new Date(Date.now() - 30 * 86_400_000);
    for (const sha of [kept, lost]) utimesSync(join(mediaDir, "drawings", sha), old, old);
    await cleanupDrawings(sql, mediaDir);
    const left = readdirSync(join(mediaDir, "drawings"));
    expect(left).toContain(kept);
    expect(left).not.toContain(lost);
  });
});
