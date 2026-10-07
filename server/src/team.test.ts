import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAdminPassword } from "./admin-password";
import { buildApp } from "./app";
import { migrate } from "./migrate";
import { cleanBio } from "./team";

const webp = (fill: number) => Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4, 0), Buffer.from("WEBP"), Buffer.alloc(500, fill)]);

describe("карточка ведущего: без базы", () => {
  it("«о себе» — до 300 символов, переводы строк можно", () => {
    expect(cleanBio(" Веду свадьбы\n\n\n\nи корпоративы\u0007 ")).toBe("Веду свадьбы\n\nи корпоративы");
    expect(cleanBio(5)).toBeNull();
    expect(cleanBio("я".repeat(400))?.length).toBe(300);
  });
});

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("команда JoyRest на PostgreSQL", () => {
  const SCHEMA = "team_test";
  const admin = postgres(url ?? "", { max: 1, onnotice: () => {} });
  const sql = postgres(url ?? "", { max: 3, onnotice: () => {}, connection: { search_path: SCHEMA } });
  const HOST = "games.test";
  const app = buildApp({
    version: "t",
    publicDir: null,
    checkDatabase: async () => true,
    sql,
    mediaDir: mkdtempSync(join(tmpdir(), "joyrest-team-")),
    auth: { limits: { perAccount: 1000, perIp: 1000, deviceDelayMs: () => 0 } },
  });
  let owner = "";
  let anna = "";
  let annaId = "";

  const cookieOf = (res: { headers: Record<string, unknown> }) => {
    const raw = res.headers["set-cookie"];
    return (Array.isArray(raw) ? String(raw[0]) : String(raw ?? "")).split(";")[0] ?? "";
  };
  const headers = (cookie: string) => ({ host: HOST, "x-joyrest": "1", origin: `https://${HOST}`, cookie });
  const post = (path: string, cookie: string, payload: object = {}) => app.inject({ method: "POST", url: path, headers: headers(cookie), payload });
  const get = (path: string, cookie: string) => app.inject({ method: "GET", url: path, headers: { host: HOST, cookie } });
  const login = async (email: string, password: string) => cookieOf(await post("/api/auth/login", "", { email, password }));

  beforeAll(async () => {
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.unsafe(`create schema ${SCHEMA}`);
    await migrate(sql, resolve(import.meta.dirname, "../migrations"));
    await setAdminPassword(sql, "owner@example.com", "пароль-владельца-12");
    owner = await login("owner@example.com", "пароль-владельца-12");
    const created = (await post("/api/users", owner, { email: "anna@example.com", name: "Анна" })).json();
    annaId = created.account.uid;
    anna = await login("anna@example.com", created.temporaryPassword);
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  it("ведущий ставит «о себе», аватарку и обложку; все видят карточку без почты", async () => {
    expect((await post("/api/team/me", anna, { bio: "Веду свадьбы" })).statusCode).toBe(200);
    const bad = await app.inject({ method: "PUT", url: "/api/team/me/avatar", headers: { ...headers(anna), "content-type": "image/jpeg" }, payload: Buffer.from("not an image") });
    expect(bad.statusCode).toBe(400);
    const put = await app.inject({ method: "PUT", url: "/api/team/me/avatar", headers: { ...headers(anna), "content-type": "image/webp" }, payload: webp(1) });
    expect(put.statusCode).toBe(200);
    const sha = put.json().sha as string;
    const team = (await get("/api/team", owner)).json() as Array<Record<string, unknown>>;
    const card = team.find((m) => m.uid === annaId);
    expect(card).toMatchObject({ name: "Анна", bio: "Веду свадьбы", avatar: sha, cover: null, owner: false });
    expect(card?.email).toBeUndefined();
    expect(team[0]?.owner).toBe(true);
    const image = await get(`/api/team/${annaId}/avatar?v=${sha}`, owner);
    expect(image.statusCode).toBe(200);
    expect(image.headers["content-type"]).toContain("image/webp");
    // Гость (устройство) карточек не видит.
    const device = cookieOf(await post("/api/auth/device", "", {}));
    expect((await get("/api/team", device)).statusCode).toBe(401);
  });

  it("убрать аватарку; отключённого ведущего в команде нет", async () => {
    expect((await app.inject({ method: "DELETE", url: "/api/team/me/avatar", headers: headers(anna) })).statusCode).toBe(200);
    expect(((await get("/api/team", owner)).json() as Array<{ uid: string; avatar: string | null }>).find((m) => m.uid === annaId)?.avatar).toBeNull();
    await post(`/api/users/${annaId}/active`, owner, { active: false });
    expect(((await get("/api/team", owner)).json() as Array<{ uid: string }>).some((m) => m.uid === annaId)).toBe(false);
  });
});
