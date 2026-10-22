import { resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { groupPollAnswers, parsePollAnswers, parsePollEdits, parsePollQuestions, pollKey, rootOf, topAnswers } from "../../src/core/polls";
import { setAdminPassword } from "./admin-password";
import { buildApp } from "./app";
import { migrate } from "./migrate";

describe("опрос гостей: сводка и табло", () => {
  const texts = ["Деньги в конверте", "деньги в конверте!", "Конверт", "Посуду", "посуду", "Технику", "Цветы", "Деньги  в конверте", "Путёвку", "путевку", "Сертификат", "Бельё"];

  it("группирует одинаковые по смыслу написания и считает", () => {
    const groups = groupPollAnswers(texts);
    expect(groups[0]).toMatchObject({ key: pollKey("Деньги в конверте"), count: 3 });
    expect(groups.find((g) => g.key === pollKey("путёвку"))?.count).toBe(2);
    expect(pollKey("Ёлка!")).toBe(pollKey("елка"));
  });

  it("объединение и переименование ведущего", () => {
    const edits = { merges: { [pollKey("Конверт")]: pollKey("Деньги в конверте") }, labels: { [pollKey("Деньги в конверте")]: "Деньги в конверте" } };
    const groups = groupPollAnswers(texts, edits);
    expect(groups[0]).toMatchObject({ label: "Деньги в конверте", count: 4 });
    expect(groups[0]?.variants).toContain("Конверт");
    // Петля объединений не зацикливается.
    expect(rootOf("a", { a: "b", b: "a" })).toBe("b");
  });

  it("6 лучших: доля ответивших в пересчёте на 100, сумма не больше 100", () => {
    const top = topAnswers(groupPollAnswers(texts), 12);
    expect(top).toHaveLength(6);
    expect(top[0]?.points).toBe(25);
    expect(top.reduce((s, a) => s + a.points, 0)).toBeLessThanOrEqual(100);
    const three = topAnswers(groupPollAnswers(["а", "б", "в"]), 3, 6);
    expect(three.map((a) => a.points)).toEqual([33, 33, 33]);
    const halves = topAnswers(groupPollAnswers(["а", "б"]), 2);
    expect(halves.reduce((s, a) => s + a.points, 0)).toBe(100);
    expect(topAnswers([], 0)).toEqual([]);
  });

  it("разбор: мусор отбрасывается, текст обрезается, лишние вопросы не принимаются", () => {
    const questions = parsePollQuestions([{ id: "q1", text: "Что дарят?" }, { id: "q1", text: "дубль" }, { id: "../x", text: "x" }, null, { id: "q2", text: "  " }]);
    expect(questions).toEqual([{ id: "q1", text: "Что дарят?" }]);
    expect(parsePollAnswers({ q1: "  деньги\u0000 ", q9: "чужой" }, questions)).toEqual({ q1: "деньги" });
    expect(parsePollAnswers({ q1: "!!!" }, questions)).toEqual({});
    expect(parsePollEdits({ q1: { merges: { a: "b", c: "c" }, labels: { a: "  Аа " } }, "../": {} })).toEqual({ q1: { merges: { a: "b" }, labels: { a: "Аа" } } });
  });
});

// Нужна настоящая PostgreSQL: в CI — сервис, локально — TEST_DATABASE_URL. Своя схема.
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("опрос гостей на PostgreSQL", () => {
  const SCHEMA = "polls_test";
  const admin = postgres(url ?? "", { max: 1, onnotice: () => {} });
  const sql = postgres(url ?? "", { max: 3, onnotice: () => {}, connection: { search_path: SCHEMA } });
  const HOST = "games.test";
  const logs: string[] = [];
  const app = buildApp({
    version: "t",
    publicDir: null,
    checkDatabase: async () => true,
    sql,
    auth: { limits: { perAccount: 1000, perIp: 1000, deviceDelayMs: () => 0 } },
    logStream: { write: (line: string) => void logs.push(line) },
  });
  let owner = "";
  let anna = "";
  let annaId = "";
  let boris = "";

  const cookieOf = (res: { headers: Record<string, unknown> }) => {
    const raw = res.headers["set-cookie"];
    return (Array.isArray(raw) ? String(raw[0]) : String(raw ?? "")).split(";")[0] ?? "";
  };
  const headers = (cookie: string, ip = "203.0.113.5") => ({ host: HOST, "x-joyrest": "1", origin: `https://${HOST}`, cookie, "x-forwarded-for": ip });
  const post = (path: string, cookie: string, payload: object = {}, ip?: string) => app.inject({ method: "POST", url: path, headers: headers(cookie, ip), payload, remoteAddress: "127.0.0.1" });
  const get = (path: string, cookie: string) => app.inject({ method: "GET", url: path, headers: { host: HOST, cookie } });
  const login = async (email: string, password: string) => cookieOf(await post("/api/auth/login", "", { email, password }));
  const QUESTIONS = [
    { id: "q1", text: "Что дарят на свадьбу?" },
    { id: "q2", text: "Куда едут в путешествие?" },
  ];
  const poll = { id: "pollAnna01", gameId: "annaGame", title: "Свадьба Ани и Бори", questions: QUESTIONS, open: true, edits: {} };

  beforeAll(async () => {
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.unsafe(`create schema ${SCHEMA}`);
    await migrate(sql, resolve(import.meta.dirname, "../migrations"));
    await setAdminPassword(sql, "owner@example.com", "пароль-владельца-12");
    owner = await login("owner@example.com", "пароль-владельца-12");
    const a = (await post("/api/users", owner, { email: "anna@example.com", name: "Анна" })).json();
    anna = await login("anna@example.com", a.temporaryPassword);
    annaId = a.account.uid;
    const b = (await post("/api/users", owner, { email: "boris@example.com", name: "Борис" })).json();
    boris = await login("boris@example.com", b.temporaryPassword);
    const created = await post("/api/games", anna, { id: "annaGame", scope: "personal", ownerId: annaId, title: "Что скажет большинство", mechanic: "hundred", themeId: "joyrest", ageRating: "0+", playMode: "teams", content: {} });
    expect(created.statusCode).toBe(200);
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  it("опрос заводит тот, кто правит игру; чужой — нет", async () => {
    expect((await post("/api/polls", boris, { ...poll, id: "pollBoris1" })).statusCode).toBe(403);
    expect((await post("/api/polls", "", poll)).statusCode).toBe(401);
    expect((await post("/api/polls", anna, { ...poll, gameId: "nope" })).statusCode).toBe(404);
    expect((await post("/api/polls", anna, poll)).statusCode).toBe(200);
    // Повтор — тот же опрос.
    expect((await post("/api/polls", anna, poll)).statusCode).toBe(200);
    expect((await post("/api/polls", boris, poll)).statusCode).toBe(403);
  });

  it("гость без входа: анкета, ответ, правка — та же запись, ловушка для ботов", async () => {
    const form = await get(`/api/polls/${poll.id}/form`, "");
    expect(form.statusCode).toBe(200);
    expect(form.json()).toMatchObject({ id: poll.id, open: true, questions: QUESTIONS });
    expect((await get("/api/polls/unknown000/form", "")).statusCode).toBe(404);
    expect((await post(`/api/polls/${poll.id}/answers`, "", { id: "guest00001", answers: { q1: "Деньги в конверте", q2: "На море" } })).statusCode).toBe(200);
    expect((await post(`/api/polls/${poll.id}/answers`, "", { id: "guest00001", answers: { q1: "Конверт", q2: "На море" } })).statusCode).toBe(200);
    expect((await post(`/api/polls/${poll.id}/answers`, "", { id: "guest00002", answers: { q1: "деньги в конверте!" } })).statusCode).toBe(200);
    expect((await post(`/api/polls/${poll.id}/answers`, "", { id: "botbot0001", answers: { q1: "спам" }, website: "http://spam" })).statusCode).toBe(200);
    expect((await post(`/api/polls/${poll.id}/answers`, "", { id: "guest00003", answers: { q1: "   " } })).statusCode).toBe(400);
    // Без заголовка X-JoyRest — отказ.
    const bare = await app.inject({ method: "POST", url: `/api/polls/${poll.id}/answers`, headers: { host: HOST }, payload: { id: "guest00004", answers: { q1: "x" } } });
    expect(bare.statusCode).toBe(403);
    const rows = await sql`select id from poll_answers where poll_id = ${poll.id}`;
    expect(rows.map((r) => r.id).sort()).toEqual(["guest00001", "guest00002"]);
    // В журнале нет текста ответов.
    expect(logs.join("\n")).not.toContain("конверт");
  });

  it("сводка — автору и владельцу, остальным нет", async () => {
    const own = await get(`/api/polls/${poll.id}`, anna);
    expect(own.statusCode).toBe(200);
    expect(own.json()).toMatchObject({ respondents: 2, responses: { q1: ["Конверт", "деньги в конверте!"], q2: ["На море"] } });
    expect((await get(`/api/polls/${poll.id}`, owner)).statusCode).toBe(200);
    expect((await get(`/api/polls/${poll.id}`, boris)).statusCode).toBe(403);
    expect((await get(`/api/polls/${poll.id}`, "")).statusCode).toBe(401);
  });

  it("закрытый опрос ответов не принимает; правки ведущего сохраняются; удаление", async () => {
    const edits = { q1: { merges: { конверт: "деньгивконверте" }, labels: { деньгивконверте: "Деньги в конверте" } } };
    expect((await post("/api/polls", anna, { ...poll, open: false, edits })).statusCode).toBe(200);
    expect((await post(`/api/polls/${poll.id}/answers`, "", { id: "guest00009", answers: { q1: "Цветы" } })).statusCode).toBe(409);
    expect((await get(`/api/polls/${poll.id}`, anna)).json().edits).toEqual(edits);
    expect((await app.inject({ method: "DELETE", url: `/api/polls/${poll.id}`, headers: headers(boris) })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: `/api/polls/${poll.id}`, headers: headers(anna) })).statusCode).toBe(200);
    expect((await get(`/api/polls/${poll.id}/form`, "")).statusCode).toBe(404);
    expect((await sql`select 1 from poll_answers where poll_id = ${poll.id}`).length).toBe(0);
  });

  it("лимит новых ответов с одного адреса", async () => {
    expect((await post("/api/polls", anna, { ...poll, id: "pollLimit1" })).statusCode).toBe(200);
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await post("/api/polls/pollLimit1/answers", "", { id: `limit${String(i).padStart(5, "0")}`, answers: { q1: "Цветы" } }, "198.51.100.7")).statusCode;
    expect(last).toBe(429);
  });
});
