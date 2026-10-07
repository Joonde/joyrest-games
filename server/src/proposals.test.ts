import { resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_UID } from "../../src/data/config";
import { setAdminPassword } from "./admin-password";
import { buildApp } from "./app";
import { cleanReason } from "./proposals";
import { migrate } from "./migrate";

describe("причина отказа", () => {
  it("без управляющих символов, переводы строк остаются, не длиннее 300", () => {
    expect(cleanReason("  Мало\u0007 вопросов\nдобавьте 5  ")).toBe("Мало вопросов\nдобавьте 5");
    expect(cleanReason("   ")).toBeNull();
    expect(cleanReason(5)).toBeNull();
    expect(cleanReason("а".repeat(400))?.length).toBe(300);
  });
});

// Нужна настоящая PostgreSQL: в CI — сервис, локально — TEST_DATABASE_URL. Своя схема.
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("предложения в библиотеку на PostgreSQL", () => {
  const SCHEMA = "proposals_test";
  const admin = postgres(url ?? "", { max: 1, onnotice: () => {} });
  const sql = postgres(url ?? "", { max: 3, onnotice: () => {}, connection: { search_path: SCHEMA } });
  const HOST = "games.test";
  const app = buildApp({ version: "t", publicDir: null, checkDatabase: async () => true, sql, auth: { limits: { perAccount: 1000, perIp: 1000 } } });
  let owner = "";
  let anna = "";
  let annaId = "";
  let boris = "";

  const cookieOf = (res: { headers: Record<string, unknown> }) => {
    const raw = res.headers["set-cookie"];
    return (Array.isArray(raw) ? String(raw[0]) : String(raw ?? "")).split(";")[0] ?? "";
  };
  const headers = (cookie: string) => ({ host: HOST, "x-joyrest": "1", origin: `https://${HOST}`, cookie });
  const post = (path: string, cookie: string, payload: object = {}) => app.inject({ method: "POST", url: path, headers: headers(cookie), payload });
  const get = (path: string, cookie: string) => app.inject({ method: "GET", url: path, headers: { host: HOST, cookie } });

  async function login(email: string, password: string) {
    return cookieOf(await post("/api/auth/login", "", { email, password }));
  }
  async function addHost(email: string, name: string) {
    const created = (await post("/api/users", owner, { email, name })).json();
    return { cookie: await login(email, created.temporaryPassword), uid: created.account.uid as string };
  }
  const game = (id: string, ownerId: string, title: string, scope = "personal") =>
    post("/api/games", scope === "agency" ? owner : anna, {
      id,
      scope,
      ownerId,
      title,
      mechanic: "quiz",
      themeId: "joyrest",
      ageRating: "0+",
      playMode: "teams",
      content: { questions: [{ id: "q1", imageId: "img1" }] },
    });

  beforeAll(async () => {
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.unsafe(`create schema ${SCHEMA}`);
    await migrate(sql, resolve(import.meta.dirname, "../migrations"));
    await setAdminPassword(sql, "owner@example.com", "пароль-владельца-12");
    owner = await login("owner@example.com", "пароль-владельца-12");
    ({ cookie: anna, uid: annaId } = await addHost("anna@example.com", "Анна"));
    ({ cookie: boris } = await addHost("boris@example.com", "Борис"));
    expect((await game("annaGame", annaId, "Квиз Анны")).statusCode).toBe(200);
    await sql`insert into media (game_id, media_id, variant, sha256, mime, width, height, size)
              values ('annaGame', 'img1', 'full', ${"a".repeat(64)}, 'image/webp', 10, 10, 100),
                     ('annaGame', 'img1', 'small', ${"b".repeat(64)}, 'image/webp', 5, 5, 50)`;
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  it("ведущий предлагает свою игру; повтор, пока ждёт, — то же предложение; чужую — нельзя", async () => {
    expect((await post("/api/proposals", "", { id: "p1", gameId: "annaGame" })).statusCode).toBe(401);
    const res = await post("/api/proposals", anna, { id: "p1", gameId: "annaGame" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ id: "p1", gameId: "annaGame", hostName: "Анна", title: "Квиз Анны", status: "pending" });
    expect((await post("/api/proposals", anna, { id: "p2", gameId: "annaGame" })).json().id).toBe("p1");
    expect((await post("/api/proposals", boris, { id: "p3", gameId: "annaGame" })).statusCode).toBe(403);
    expect((await post("/api/proposals", owner, { id: "p4", gameId: "annaGame" })).statusCode).toBe(403);
    expect((await post("/api/proposals", anna, { id: "p5", gameId: "nope" })).statusCode).toBe(404);
  });

  it("ожидающие видит только владелец", async () => {
    expect((await get("/api/proposals?status=pending", anna)).statusCode).toBe(403);
    const list = (await get("/api/proposals?status=pending", owner)).json() as Array<{ id: string }>;
    expect(list.map((p) => p.id)).toEqual(["p1"]);
    expect(((await get("/api/proposals?mine=1", boris)).json() as unknown[]).length).toBe(0);
  });

  it("принять: копия в библиотеку с картинками; повторное принятие обновляет ту же игру", async () => {
    expect((await post("/api/proposals/p1/accept", anna)).statusCode).toBe(403);
    const res = await post("/api/proposals/p1/accept", owner);
    expect(res.statusCode, res.body).toBe(200);
    const accepted = res.json();
    expect(accepted.status).toBe("accepted");
    const libraryId = accepted.libraryGameId as string;
    const [copy] = await sql<{ scope: string; owner_id: string; title: string; play_mode: string }[]>`
      select scope, owner_id, title, play_mode from games where id = ${libraryId}`;
    expect(copy).toEqual({ scope: "agency", owner_id: ADMIN_UID, title: "Квиз Анны", play_mode: "teams" });
    expect((await sql`select 1 from media where game_id = ${libraryId}`).length).toBe(2);
    // Игра ведущего осталась у него.
    expect((await sql`select scope from games where id = 'annaGame'`)[0]?.scope).toBe("personal");
    // Повтор после обрыва связи — то же.
    expect((await post("/api/proposals/p1/accept", owner)).json().libraryGameId).toBe(libraryId);
    expect(((await get("/api/proposals?mine=1", anna)).json() as Array<{ status: string }>)[0]?.status).toBe("accepted");

    // Ведущий доработал игру и предложил снова — обновляется та же игра библиотеки.
    await post("/api/proposals", anna, { id: "p6", gameId: "annaGame" }); // ещё ждёт? нет — p1 принято, это новое
    await app.inject({ method: "PATCH", url: "/api/games/annaGame", headers: headers(anna), payload: { title: "Квиз Анны 2" } });
    const again = await post("/api/proposals/p6/accept", owner);
    expect(again.json().libraryGameId).toBe(libraryId);
    expect((await sql`select title from games where id = ${libraryId}`)[0]?.title).toBe("Квиз Анны 2");
    expect((await sql`select 1 from games where scope = 'agency'`).length).toBe(1);
  });

  it("отклонить с причиной; решённое второй раз не меняется", async () => {
    await post("/api/proposals", anna, { id: "p7", gameId: "annaGame" });
    const res = await post("/api/proposals/p7/reject", owner, { reason: "Добавьте\u0007 картинки" });
    expect(res.json()).toMatchObject({ status: "rejected", reason: "Добавьте картинки" });
    expect((await post("/api/proposals/p7/accept", owner)).statusCode).toBe(409);
    expect((await post("/api/proposals/p6/reject", owner)).statusCode).toBe(409);
  });

  it("игру удалили до решения — принять нельзя", async () => {
    expect((await game("annaGame2", annaId, "Вторая")).statusCode).toBe(200);
    await post("/api/proposals", anna, { id: "p8", gameId: "annaGame2" });
    await app.inject({ method: "DELETE", url: "/api/games/annaGame2", headers: headers(anna) });
    expect((await post("/api/proposals/p8/accept", owner)).statusCode).toBe(404);
  });
});
