// Проверка «ответ гостя при обрыве сети» (ревью 29 октября 2026, CLAUDE.md, раздел «Честная живая игра»):
// настоящий браузер (Chromium, Playwright) на test.games.joy-rest.ru. Пульт, экран зала и три телефона:
//   • Аня — сеть пропала надолго: «Ответ не дошёл…», кнопки снова доступны, сеть вернулась — ответ засчитан;
//   • Борис — обрыв на полсекунды: ответ уходит сам повтором, без ошибки и без нового касания;
//   • Вера — запрос дошёл до сервера, а ответ сервера потерялся (3 раза): телефон пишет «не дошёл», Вера больше
//     не нажимает — после «Показать ответ» телефон сверяется с сервером и показывает «Верно!», очки начислены.
// Итог — аннотацией в Actions, снимки — в папку E2E_SHOTS. Запуск — workflow «Проверка ответа без сети».
//
// Файл .mjs и вне сборки: Playwright ставится только в этом workflow, в зависимостях его нет.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = (process.env.E2E_BASE ?? "https://test.games.joy-rest.ru").replace(/\/$/, "");
const EMAIL = process.env.LOAD_HOST_EMAIL ?? "";
const PASSWORD = process.env.LOAD_HOST_PASSWORD ?? "";
const SHOTS = process.env.E2E_SHOTS ?? "e2e-shots";
const WAIT = 20_000;
const NOT_DELIVERED = "Ответ не дошёл";

const report = [];
const problems = [];
let shotNo = 0;
let currentStep = "начало";
let currentPage = null;
const step = (name, page) => {
  currentStep = name;
  if (page) currentPage = page;
  console.log(`— ${name}`);
};
const say = (line) => {
  report.push(line);
  console.log(line);
};
const ok = (text) => say(`✅ ${text}`);
const bad = (text) => {
  problems.push(text);
  say(`❌ ${text}`);
};

function finish(code) {
  if (process.env.GITHUB_ACTIONS === "true") {
    const head = problems.length > 0 ? [`Замечаний: ${problems.length}`, ...problems.map((p) => `❌ ${p}`), "", "— Подробно —"] : [];
    const text = [...head, ...report].join("\n").replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, "%0A");
    console.log(`::${code === 0 ? "notice" : "error"} title=Ответ без сети::${text}`);
  }
  process.exit(code);
}

if (!/^https:\/\/test\./.test(BASE)) {
  say(`Отказ: только тестовый адрес (сейчас ${BASE}).`);
  finish(2);
}
if (!EMAIL || !PASSWORD) {
  say("Нужны LOAD_HOST_EMAIL и LOAD_HOST_PASSWORD.");
  finish(2);
}

async function api(method, path, cookie, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", "X-JoyRest": "1", Origin: BASE, Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${data?.error ?? ""}`);
  return { res, data };
}

async function login() {
  const { res } = await api("POST", "/api/auth/login", "", { email: EMAIL, password: PASSWORD });
  let token = "";
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    if (pair.startsWith("__Host-jr_s=")) token = pair.slice("__Host-jr_s=".length);
  }
  if (!token) throw new Error("вход ведущего: нет cookie");
  const me = await api("GET", "/api/auth/me", `__Host-jr_s=${token}`);
  if (me.data?.profile?.mustChangePassword) {
    await api("POST", "/api/auth/password", `__Host-jr_s=${token}`, { currentPassword: PASSWORD, newPassword: PASSWORD });
  }
  return token;
}

const CONTENT = {
  questions: [
    { id: "o1", kind: "choice", text: "Какого цвета снег?", options: ["Белый", "Зелёный", "Синий", "Красный"], correct: 0, answers: [], timeLimit: 60, points: 100, imageId: null },
  ],
};

async function createSession(token) {
  const id = `off${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const { data } = await api("POST", "/api/sessions", `__Host-jr_s=${token}`, {
    id,
    gameTitle: "Проверка ответа без сети",
    mechanic: "quiz",
    gameSnapshot: { title: "Проверка ответа без сети", mechanic: "quiz", themeId: "joyrest", content: CONTENT },
    themeId: "joyrest",
    playMode: "solo",
    screenMode: "laptop",
  });
  return { id, code: data.code };
}

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU" };
const TV = { viewport: { width: 1280, height: 720 }, locale: "ru-RU" };

function watch(page, who) {
  page.on("pageerror", (error) => bad(`${who}: ошибка на странице — ${String(error.message).slice(0, 160)}`));
}

async function shot(page, name) {
  shotNo += 1;
  await page.screenshot({ path: join(SHOTS, `${String(shotNo).padStart(2, "0")}-${name}.png`) }).catch(() => undefined);
}

async function guest(browser, code, name) {
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  watch(page, name);
  step(`${name}: вход`, page);
  await page.goto(`${BASE}/play/${code}`);
  await page.getByRole("heading", { name: "Как вас зовут?" }).waitFor({ timeout: WAIT });
  await page.getByLabel("Имя", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Без", exact: true }).click();
  await page.getByRole("button", { name: "Играть" }).click();
  await page.locator(".play-head__name").waitFor({ timeout: WAIT });
  return { context, page, name };
}

const option = (page, i) => page.locator(".quiz-phone__option").nth(i);

/** Видна ли на телефоне ошибка «не дошёл» в течение ms. */
async function sawNotDelivered(page, ms) {
  return page
    .getByText(NOT_DELIVERED)
    .first()
    .waitFor({ timeout: ms })
    .then(() => true)
    .catch(() => false);
}

async function answeredCount(host, n, what) {
  try {
    await host.locator("main").filter({ hasText: `Ответили: ${n}` }).first().waitFor({ timeout: WAIT });
    ok(`${what}: на пульте «Ответили: ${n}»`);
    return true;
  } catch {
    const seen = (await host.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ").match(/Ответили: \d+/)?.[0];
    bad(`${what}: на пульте нет «Ответили: ${n}» (видно: ${seen ?? "ничего"})`);
    return false;
  }
}

mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
let session = null;
let token = "";
try {
  token = await login();
  session = await createSession(token);
  say(`Сессия ${session.code}`);

  const hostContext = await browser.newContext(PHONE);
  await hostContext.addCookies([{ name: "__Host-jr_s", value: token, url: BASE, secure: true, httpOnly: true, sameSite: "Lax" }]);
  const host = await hostContext.newPage();
  watch(host, "Пульт");
  step("пульт открывается", host);
  await host.goto(`${BASE}/host/${session.code}`);
  await host.getByRole("button", { name: "Начать игру" }).waitFor({ timeout: WAIT });

  const screenContext = await browser.newContext(TV);
  const screen = await screenContext.newPage();
  watch(screen, "Экран зала");
  await screen.goto(`${BASE}/screen/${session.code}`);

  const anna = await guest(browser, session.code, "Аня");
  const boris = await guest(browser, session.code, "Борис");
  const vera = await guest(browser, session.code, "Вера");

  step("пульт: начать игру и показать вопрос", host);
  await host.getByRole("button", { name: "Начать игру", exact: true }).click({ timeout: WAIT });
  await host.getByRole("button", { name: "Показать вопрос", exact: true }).click({ timeout: WAIT });
  for (const g of [anna, boris, vera]) await option(g.page, 0).waitFor({ timeout: WAIT });
  ok("Вопрос открыт на трёх телефонах");

  // ---------- Аня: сеть пропала надолго ----------
  step("Аня: отвечает без сети", anna.page);
  await anna.context.setOffline(true);
  const started = Date.now();
  await option(anna.page, 0).click();
  if (await sawNotDelivered(anna.page, 12_000)) ok(`Аня без сети: «${NOT_DELIVERED}…» через ${((Date.now() - started) / 1000).toFixed(1)} с (ответ ушёл ещё два раза)`);
  else bad(`Аня без сети: нет «${NOT_DELIVERED}» за 12 с`);
  await shot(anna.page, "аня-нет-сети");
  if (await option(anna.page, 0).isEnabled()) ok("Аня без сети: кнопки ответа снова доступны");
  else bad("Аня без сети: кнопки ответа заблокированы (прежняя ошибка)");
  if ((await option(anna.page, 0).getAttribute("aria-pressed")) === "true") bad("Аня без сети: ответ всё ещё отмечен выбранным");
  else ok("Аня без сети: ответ не отмечен как отправленный");
  const answers0 = await api("GET", `/api/sessions/${session.id}/answers/0`, `__Host-jr_s=${token}`);
  if ((answers0.data ?? []).length === 0) ok("Сервер: ответа Ани пока нет (он правда не дошёл)");
  else bad(`Сервер: ответов уже ${(answers0.data ?? []).length}, хотя Аня была без сети`);

  // ---------- Борис: короткий обрыв ----------
  step("Борис: обрыв на полсекунды", boris.page);
  await boris.context.setOffline(true);
  await option(boris.page, 0).click();
  await boris.page.waitForTimeout(500);
  await boris.context.setOffline(false);
  await answeredCount(host, 1, "Борис после короткого обрыва");
  if (await sawNotDelivered(boris.page, 3_000)) bad(`Борис: после короткого обрыва всё равно «${NOT_DELIVERED}»`);
  else ok("Борис: ответ ушёл сам повтором, ошибки на телефоне нет");
  if ((await option(boris.page, 0).getAttribute("aria-pressed")) === "true") ok("Борис: ответ отмечен выбранным");
  else bad("Борис: ответ не отмечен выбранным");
  await shot(boris.page, "борис-короткий-обрыв");

  // ---------- Вера: запрос дошёл, ответ сервера потерялся ----------
  step("Вера: ответ сервера теряется", vera.page);
  let lost = 0;
  const served = [];
  await vera.page.route("**/api/sessions/*/answers", async (route) => {
    if (route.request().method() !== "POST" || lost >= 3) return route.continue();
    lost += 1;
    const response = await route.fetch();
    served.push(`${response.status()} ${(await response.text()).slice(0, 40)}`);
    await route.abort("failed");
  });
  await option(vera.page, 0).click();
  if (await sawNotDelivered(vera.page, 12_000)) ok(`Вера: телефон не получил ответ сервера ${lost} раза — «${NOT_DELIVERED}…»`);
  else bad(`Вера: нет «${NOT_DELIVERED}» после потерянных ответов сервера`);
  say(`Сервер на запросы Веры отвечал: ${served.join(" · ")}`);
  await vera.page.unroute("**/api/sessions/*/answers");
  await answeredCount(host, 2, "Вера: запрос всё же дошёл до сервера");
  await shot(vera.page, "вера-ответ-потерялся");

  // ---------- Аня: сеть вернулась, отвечает снова ----------
  step("Аня: сеть вернулась, нажимает снова", anna.page);
  await anna.context.setOffline(false);
  await anna.page.waitForTimeout(1500);
  await option(anna.page, 0).click({ timeout: WAIT });
  await answeredCount(host, 3, "Аня после возврата сети");
  if ((await option(anna.page, 0).getAttribute("aria-pressed")) === "true") ok("Аня: ответ принят и отмечен");
  else bad("Аня: после возврата сети ответ не отмечен");

  // ---------- Показать ответ ----------
  step("пульт: показать ответ", host);
  await host.getByRole("button", { name: "Показать ответ", exact: true }).click({ timeout: WAIT });
  for (const g of [anna, boris, vera]) {
    step(`${g.name}: итог вопроса`, g.page);
    const verdict = await g.page
      .locator(".quiz-phone__verdict")
      .first()
      .innerText({ timeout: WAIT })
      .catch(() => "");
    if (verdict.includes("Верно")) ok(`${g.name}: телефон после ответа — «${verdict.trim()}»`);
    else bad(`${g.name}: телефон после ответа — «${verdict.trim() || "ничего"}», ждали «Верно!»`);
    await shot(g.page, `${g.name}-итог`);
  }
  await shot(screen, "экран-ответ");
  await shot(host, "пульт-ответ");

  // Очки — по серверу.
  step("сервер: очки", host);
  await host.waitForTimeout(1500);
  const { data } = await api("GET", `/api/sessions/${session.id}`, `__Host-jr_s=${token}`);
  const board = Object.values(data?.leaderboard ?? {});
  for (const name of ["Аня", "Борис", "Вера"]) {
    const entry = board.find((e) => e?.name === name);
    if (entry && entry.score > 0) ok(`Сервер: у ${name === "Аня" ? "Ани" : name === "Борис" ? "Бориса" : "Веры"} ${entry.score} очков`);
    else bad(`Сервер: у ${name} нет очков (${entry ? entry.score : "нет в таблице"})`);
  }

  await Promise.all([hostContext.close(), screenContext.close(), anna.context.close(), boris.context.close(), vera.context.close()]);
} catch (error) {
  bad(`Проверка остановилась на шаге «${currentStep}»: ${String(error?.message ?? error).split("\n")[0].slice(0, 200)}`);
  if (currentPage) {
    const text = await currentPage.locator("body").innerText().catch(() => "");
    say(`На странице: ${text.replace(/\s+/g, " ").slice(0, 300)}`);
    await shot(currentPage, "остановка");
  }
} finally {
  if (session && token) await api("POST", `/api/sessions/${session.id}/finish`, `__Host-jr_s=${token}`, { participantsCount: 0 }).catch(() => undefined);
  await browser.close();
}
say(problems.length === 0 ? "\nИтог: замечаний нет" : `\nИтог: замечаний ${problems.length}`);
finish(problems.length === 0 ? 0 : 1);
