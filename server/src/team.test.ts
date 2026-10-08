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

  it("другие профессии: диджей входит и видит команду, игр и сессий у него нет; профессию меняет владелец", async () => {
    const created = (await post("/api/users", owner, { email: "dj@example.com", name: "Диджей Макс", profession: "dj" })).json();
    expect(created.account.profession).toBe("dj");
    const dj = await login("dj@example.com", created.temporaryPassword);
    expect(dj).not.toBe("");
    expect((await get("/api/auth/me", dj)).json().profile.profession).toBe("dj");
    const team = (await get("/api/team", dj)).json() as Array<{ uid: string; profession: string }>;
    expect(team.find((m) => m.uid === created.account.uid)?.profession).toBe("dj");
    expect((await get("/api/games?scope=agency", dj)).statusCode).toBe(403);
    expect((await post("/api/sessions", dj, { id: "dj-session-1" })).statusCode).toBe(403);
    expect((await post(`/api/users/${created.account.uid}/profession`, dj, { profession: "host" })).statusCode).toBe(403);
    expect((await post(`/api/users/${created.account.uid}/profession`, owner, { profession: "космонавт" })).statusCode).toBe(400);
    expect((await post(`/api/users/${created.account.uid}/profession`, owner, { profession: "host" })).statusCode).toBe(200);
    expect((await get("/api/games?scope=agency", dj)).statusCode).toBe(200);
  });

  it("роли доступа: даёт только владелец; роль добавляет права и не даёт владельческих", async () => {
    const make = async (email: string, name: string, profession = "dj") => {
      const c = (await post("/api/users", owner, { email, name, profession })).json();
      return { uid: c.account.uid as string, cookie: await login(email, c.temporaryPassword) };
    };
    const kim = await make("kim@example.com", "Ким");
    const lena = await make("lena@example.com", "Лена", "host");
    const access = (who: string, cookie: string, role: unknown) => post(`/api/users/${who}/access`, cookie, { role });
    const game = (id: string, ownerId: string) => ({ id, scope: "personal", ownerId, title: "Квиз", mechanic: "quiz", themeId: "joyrest", ageRating: "0+", playMode: "solo", content: { questions: [] } });

    // Дать роль может только владелец; неизвестная роль — 400; себе и владельцу — нельзя.
    expect((await access(kim.uid, kim.cookie, "creator")).statusCode).toBe(403);
    expect((await access(kim.uid, lena.cookie, "creator")).statusCode).toBe(403);
    expect((await access(kim.uid, owner, "admin")).statusCode).toBe(400);
    expect((await access(kim.uid, owner, "owner")).statusCode).toBe(400);
    const me = (await get("/api/auth/me", owner)).json().profile.uid as string;
    expect((await access(me, owner, "tester")).statusCode).toBe(403);

    // Создатель игр: своя игра — да, сессия — нет, библиотека — нет.
    expect((await access(kim.uid, owner, "creator")).statusCode).toBe(200);
    expect((await get("/api/auth/me", kim.cookie)).json().profile.accessRole).toBe("creator");
    expect((await post("/api/games", kim.cookie, game("kimGame1", kim.uid))).statusCode).toBe(200);
    expect((await post("/api/games", kim.cookie, { ...game("kimAgency", me), scope: "agency" })).statusCode).toBe(403);
    expect((await post("/api/sessions", kim.cookie, { id: "kim-session-1", gameTitle: "Квиз", mechanic: "quiz", playMode: "solo" })).statusCode).toBe(403);
    expect((await post("/api/tracks", kim.cookie, { id: "kimTrack", title: "Т", license: "pixabay" })).statusCode).toBe(403);

    // Тестировщик: смотрит библиотеку, ничего не создаёт.
    expect((await access(kim.uid, owner, "tester")).statusCode).toBe(200);
    expect((await get("/api/games?scope=agency", kim.cookie)).statusCode).toBe(200);
    expect((await post("/api/games", kim.cookie, game("kimGame2", kim.uid))).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url: "/api/games/kimGame1", headers: headers(kim.cookie), payload: { title: "Новое" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: "/api/games/kimGame1", headers: headers(kim.cookie) })).statusCode).toBe(403);

    // Музыкальный редактор: трек себе — да, в общую — нет, игры — нет.
    expect((await access(kim.uid, owner, "music")).statusCode).toBe(200);
    expect((await post("/api/tracks", kim.cookie, { id: "kimTrack", title: "Т", license: "pixabay" })).statusCode).toBe(200);
    expect((await post("/api/tracks", kim.cookie, { id: "kimTrack2", title: "Т", license: "pixabay", scope: "agency" })).statusCode).toBe(403);
    expect((await get("/api/games?scope=agency", kim.cookie)).statusCode).toBe(403);

    // Помощник владельца: видит все игры сейчас, но не людей, баллы и роли.
    expect((await access(kim.uid, owner, "assistant")).statusCode).toBe(200);
    expect((await get("/api/sessions/overview", kim.cookie)).statusCode).toBe(200);
    expect((await get("/api/users", kim.cookie)).statusCode).toBe(403);
    expect((await post("/api/users", kim.cookie, { email: "x@example.com", name: "Икс" })).statusCode).toBe(403);
    expect((await post(`/api/users/${lena.uid}/active`, kim.cookie, { active: false })).statusCode).toBe(403);
    expect((await post(`/api/users/${lena.uid}/points`, kim.cookie, { delta: 5, comment: "за так" })).statusCode).toBe(403);
    expect((await post(`/api/users/${lena.uid}/password`, kim.cookie, {})).statusCode).toBe(403);
    expect((await access(lena.uid, kim.cookie, "assistant")).statusCode).toBe(403);
    expect((await post("/api/sessions/cleanup", kim.cookie, { before: Date.now() })).statusCode).toBe(403);

    // Роль ведущему только добавляет: Лена-тестировщик по-прежнему создаёт игры и сессии.
    expect((await access(lena.uid, owner, "tester")).statusCode).toBe(200);
    expect((await post("/api/games", lena.cookie, game("lenaGame", lena.uid))).statusCode).toBe(200);
    expect((await post("/api/sessions", lena.cookie, { id: "lena-session-1", gameTitle: "Квиз", mechanic: "quiz", playMode: "solo" })).statusCode).toBe(200);
    expect((await post("/api/tracks", lena.cookie, { id: "lenaTrack", title: "Т", license: "pixabay" })).statusCode).toBe(200);

    // Помощник не завершает чужую идущую игру (только брошенную 12 часов).
    expect((await post("/api/sessions/lena-session-1/finish", kim.cookie, {})).statusCode).toBe(403);
    await sql`update sessions set updated_at = now() - interval '13 hours' where id = 'lena-session-1'`;
    expect((await post("/api/sessions/lena-session-1/finish", kim.cookie, {})).statusCode).toBe(200);
    // Завершённую чужую игру помощник из списка не убирает (это решает ведущий или владелец).
    expect((await post("/api/sessions/lena-session-1/hide", kim.cookie, {})).statusCode).toBe(409);
    expect((await post("/api/sessions/lena-session-1/hide", lena.cookie, {})).statusCode).toBe(200);

    // Снять роль — снова только своё.
    expect((await access(kim.uid, owner, null)).statusCode).toBe(200);
    expect((await get("/api/sessions/overview", kim.cookie)).statusCode).toBe(200);
    expect(((await get("/api/sessions/overview", kim.cookie)).json() as unknown[]).length).toBe(0);
    expect((await get("/api/users", owner)).json().find((u: { uid: string }) => u.uid === kim.uid)?.accessRole).toBeNull();
  });
});
