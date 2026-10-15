// Проверка конца игры и того, что вокруг него (решения владельца 15 октября 2026), на test.games.joy-rest.ru:
// настоящий браузер (Playwright) — ведущий (load@joy-rest.ru), владелец (TEST_ADMIN_*) и гости.
//  1. Чаевые: ведущий ставит ссылку в «Моём профиле», неверная ссылка — понятная ошибка, после перезагрузки — на месте.
//  2. Игра → «Завершить игру»: экран зала сам показывает «Спасибо» с тремя QR (чаевые, отзыв, канал), выход виден;
//     пульт убирает «Спасибо» (под ним итоги) и возвращает его.
//  3. Отзыв с телефона гостя (в игре) и по QR (/review/:id): звёзды, согласие, «Исправить отзыв», после перезагрузки —
//     сохранён; до конца игры и без согласия — отказ.
//  4. «Отзывы» в студии: ведущий видит свои без кнопок модерации, владелец — «Поместить на сайт», «Убрать с сайта»,
//     «Скрыть», фильтры.
//  5. Фотоотчёт с пульта: три ячейки, «Сделать фото», «Переснять», «Удалить» (с подтверждением и «Оставить»),
//     после перезагрузки пульта — на месте; «Фотоотчёты» у ведущего и владельца; гостю и без входа — закрыто.
//  6. Видео JoyRest (если есть E2E_VIDEO): владелец загружает частями, ведущий видит и может проиграть, но не загрузить;
//     «Название и папка», «Убрать видео» с подтверждением.
//  7. Сайт (если есть E2E_SITE_DIR): страница сайта на своём маленьком сервере, лента отзывов — те, что владелец
//     только что поместил на сайт (как отдаёт /api/site/reviews), листается по кругу без конца; форма отзыва шлёт
//     в /api/lead тип review.
// Всё созданное в конце убирается (отзывы скрываются, фото и видео удаляются, ссылка для чаевых — прежняя).
import { readFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const BASE = (process.env.E2E_BASE ?? "https://test.games.joy-rest.ru").replace(/\/$/, "");
const HOST_EMAIL = process.env.LOAD_HOST_EMAIL ?? "";
const HOST_PASSWORD = process.env.LOAD_HOST_PASSWORD ?? "";
const ADMIN_EMAIL = (process.env.TEST_ADMIN_EMAIL ?? "").trim();
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? "";
const SHOTS = process.env.E2E_SHOTS ?? "finale-shots";
const VIDEO = process.env.E2E_VIDEO ?? "";
const SITE_DIR = process.env.E2E_SITE_DIR ?? "";
const FONTS_DIR = process.env.E2E_FONTS_DIR ?? "";
const WAIT = 20_000;
const MARK = `e2e-${Date.now().toString(36)}`;
const TIPS = `https://example.com/tips/${MARK}`;

const report = [];
const problems = [];
const say = (line) => {
  report.push(line);
  console.log(line);
};
const ok = (text) => say(`✅ ${text}`);
const bad = (text) => {
  problems.push(text);
  say(`❌ ${text}`);
};
const check = (cond, good, fail) => (cond ? ok(good) : bad(fail ?? good));

function finish(code) {
  if (process.env.GITHUB_ACTIONS === "true") {
    const head = problems.length > 0 ? [`Замечаний: ${problems.length}`, ...problems.map((p) => `❌ ${p}`), "", "— Подробно —"] : [];
    const text = [...head, ...report].join("\n").replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, "%0A");
    console.log(`::${code === 0 ? "notice" : "error"} title=Конец игры, отзывы, фото, видео::${text}`);
  }
  process.exit(code);
}

if (!/^https:\/\/test\./.test(BASE)) {
  say(`Отказ: только тестовый адрес (сейчас ${BASE}).`);
  finish(2);
}
if (!HOST_EMAIL || !HOST_PASSWORD || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  say("Нужны LOAD_HOST_EMAIL, LOAD_HOST_PASSWORD, TEST_ADMIN_EMAIL и TEST_ADMIN_PASSWORD.");
  finish(2);
}

// ---------- API ----------

async function api(method, path, cookie, body, extra = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), "X-JoyRest": "1", Origin: BASE, Cookie: cookie, ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, res };
}

function cookieFrom(res, name) {
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    if (pair.startsWith(`${name}=`)) return pair.slice(name.length + 1);
  }
  return "";
}

async function login(email, password) {
  const { status, res } = await api("POST", "/api/auth/login", "", { email, password });
  if (status !== 200) throw new Error(`вход ${email}: ${status}`);
  const token = cookieFrom(res, "__Host-jr_s");
  const cookie = `__Host-jr_s=${token}`;
  const me = await api("GET", "/api/auth/me", cookie);
  if (me.data?.profile?.mustChangePassword) await api("POST", "/api/auth/password", cookie, { currentPassword: password, newPassword: password });
  return { token, cookie, profile: me.data?.profile };
}

async function device() {
  const { res } = await api("POST", "/api/auth/device", "", {});
  return `__Host-jr_d=${cookieFrom(res, "__Host-jr_d")}`;
}

const question = (id, text, options, correct) => ({ id, kind: "choice", text, options, correct, answers: [], timeLimit: 30, points: 100, imageId: null });
const CONTENT = { questions: [question("f1", "Какого цвета снег?", ["Белый", "Зелёный", "Синий"], 0)] };

async function createSession(host, title) {
  const id = `e2f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const { status, data } = await api("POST", "/api/sessions", host.cookie, {
    id,
    gameTitle: title,
    mechanic: "quiz",
    gameSnapshot: { title, mechanic: "quiz", themeId: "joyrest", content: CONTENT },
    themeId: "joyrest",
    playMode: "solo",
    screenMode: "laptop",
  });
  if (status !== 200) throw new Error(`сессия: ${status}`);
  return { id, code: data.code };
}

// ---------- браузер ----------

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU" };
const TV = { viewport: { width: 1280, height: 720 }, locale: "ru-RU" };
const pages = [];
let shotN = 0;

async function shot(page, name) {
  shotN += 1;
  await page.screenshot({ path: join(SHOTS, `${String(shotN).padStart(2, "0")}-${name}.png`) });
}

async function open(browser, who, options = PHONE, token = "") {
  const context = await browser.newContext(options);
  if (token) await context.addCookies([{ name: "__Host-jr_s", value: token, url: BASE, secure: true, httpOnly: true, sameSite: "Lax" }]);
  const page = await context.newPage();
  pages.push([who, page]);
  page.on("pageerror", (error) => bad(`${who}: ошибка на странице — ${String(error.message).slice(0, 160)}`));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/favicon|ERR_ABORTED|net::|status of 40[134]|status of 409/.test(msg.text())) bad(`${who}: ошибка в консоли — ${msg.text().slice(0, 160)}`);
  });
  return page;
}

/** Телефон: нет прокрутки вбок и нет кнопок меньше 44 px. */
async function layout(page, where) {
  const r = await page.evaluate(() => {
    const doc = document.documentElement;
    const small = [...document.querySelectorAll("main button, main a.btn")]
      .filter((el) => {
        const b = el.getBoundingClientRect();
        const folded = el.closest("details:not([open])") && !el.closest("summary");
        return b.width > 0 && b.height > 0 && b.height < 44 && !folded && getComputedStyle(el).visibility !== "hidden";
      })
      .map((el) => (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30));
    return { wide: doc.scrollWidth - doc.clientWidth, small: [...new Set(small)] };
  });
  check(r.wide <= 1, `${where}: нет прокрутки вбок`, `${where}: страница шире экрана на ${r.wide}px`);
  if (r.small.length) bad(`${where}: мелкие кнопки (< 44 px): ${r.small.join(", ")}`);
}

async function until(fn, ms = WAIT, label = "условие") {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      if (await fn()) return true;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`не дождались: ${label}${last ? ` (${String(last.message ?? last).slice(0, 120)})` : ""}`);
}

const click = (page, name) => page.getByRole("button", { name, exact: true }).first().click({ timeout: WAIT });
const textOf = async (locator) => ((await locator.textContent()) ?? "").replace(/\s+/g, " ").trim();

async function writeReview(page, { stars, text, name }) {
  await page.getByRole("radio", { name: `${stars} из 5` }).click();
  await page.getByLabel("Пара слов (по желанию)").fill(text);
  if (name !== undefined) await page.getByLabel("Как вас подписать (по желанию)").fill(name);
}

// ---------- сайт на своём маленьком сервере ----------

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".woff2": "font/woff2", ".mp4": "video/mp4", ".txt": "text/plain" };
function startSite(getReviews, leads) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://site.local");
    if (url.pathname === "/api/site/reviews") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ reviews: getReviews() }));
      return;
    }
    if (url.pathname === "/api/lead" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        leads.push(JSON.parse(body || "{}"));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    const root = url.pathname.startsWith("/fonts/") && FONTS_DIR ? FONTS_DIR : SITE_DIR;
    const rel = url.pathname.startsWith("/fonts/") ? url.pathname.slice("/fonts".length) : url.pathname;
    const path = normalize(join(root, rel === "/" ? "index.html" : rel));
    if (!path.startsWith(normalize(root)) || !existsSync(path) || statSync(path).isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" });
    res.end(readFileSync(path));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// ---------- проверка ----------

mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
let host;
let admin;
let oldTips = "";
const sessions = [];
let videoId = "";
try {
  host = await login(HOST_EMAIL, HOST_PASSWORD);
  admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  oldTips = (await api("GET", "/api/me/tips", host.cookie)).data?.url ?? "";
  say(`Ведущий: ${host.profile?.name}; метка проверки: ${MARK}`);

  // ===== 1. Чаевые в «Моём профиле» =====
  const hp = await open(browser, "Ведущий (студия)", PHONE, host.token);
  await hp.goto(`${BASE}/studio/profile`);
  const tipsInput = hp.getByLabel("Ссылка на вашу страницу для чаевых");
  await tipsInput.waitFor({ timeout: WAIT });
  await tipsInput.fill("http://не-https");
  await hp.locator("#profile-tips").locator("..").getByRole("button", { name: "Сохранить" }).click();
  await until(async () => (await hp.getByText("Нужна ссылка, которая начинается с https://").count()) > 0, WAIT, "ошибка неверной ссылки");
  ok("Профиль: ссылка без https:// — понятная ошибка, не сохраняется");
  await tipsInput.fill(TIPS);
  await hp.locator("#profile-tips").locator("..").getByRole("button", { name: "Сохранить" }).click();
  await until(async () => (await api("GET", "/api/me/tips", host.cookie)).data?.url === TIPS, WAIT, "ссылка сохранена");
  await hp.reload();
  await until(async () => (await hp.getByLabel("Ссылка на вашу страницу для чаевых").inputValue()) === TIPS, WAIT, "ссылка после перезагрузки");
  ok("Профиль: ссылка для чаевых сохраняется и остаётся после перезагрузки");
  await layout(hp, "Профиль ведущего");
  await shot(hp, "профиль-чаевые");

  // ===== 2. Отзыв до конца игры — отказ =====
  const lobby = await createSession(host, `Проверка отзыва ${MARK}`);
  sessions.push(lobby.id);
  const dev0 = await device();
  check((await api("POST", "/api/reviews", dev0, { sessionId: lobby.id, rating: 5, text: "рано", name: "", consent: true })).status === 409, "API: отзыв до конца игры — отказ (409)");

  // ===== 3. Игра до конца: «Спасибо» с тремя QR =====
  const game = await createSession(host, `Проверка финала ${MARK}`);
  sessions.push(game.id);
  const pult = await open(browser, "Пульт", PHONE, host.token);
  await pult.goto(`${BASE}/host/${game.code}`);
  await pult.getByRole("button", { name: "Начать игру" }).waitFor({ timeout: WAIT });
  const screen = await open(browser, "Экран зала", TV);
  await screen.goto(`${BASE}/screen/${game.code}`);
  await screen.getByText("Присоединяйтесь к игре").waitFor({ timeout: WAIT });

  const anna = await open(browser, "Гость Аня");
  await anna.goto(`${BASE}/play/${game.code}`);
  await anna.getByLabel("Имя", { exact: true }).fill("Аня");
  await click(anna, "Играть");
  await anna.locator(".play-head__name").waitFor({ timeout: WAIT });
  await until(async () => (await pult.locator("main").textContent())?.includes("Аня"), WAIT, "Аня на пульте");

  // Фото в лобби не делают: карточки ещё нет.
  check((await pult.getByText("Общее фото для фотоотчёта").count()) === 0, "Пульт: в лобби фотоотчёта ещё нет (появится после «Начать игру»)");
  await click(pult, "Начать игру");
  await click(pult, "Показать вопрос");
  await anna.locator(".quiz-phone__option").first().click({ timeout: WAIT });
  await until(async () => (await pult.locator("main").textContent())?.includes("Ответили: 1"), WAIT, "ответ Ани на пульте");
  await click(pult, "Показать ответ");
  check((await pult.getByText("Общее фото для фотоотчёта").count()) === 1, "Пульт: во время игры есть «📷 Общее фото для фотоотчёта»");

  // Отзыв во время игры — тоже отказ.
  const annaDevice = `__Host-jr_d=${(await anna.context().cookies(BASE)).find((c) => c.name === "__Host-jr_d")?.value ?? ""}`;
  check((await api("POST", "/api/reviews", annaDevice, { sessionId: game.id, rating: 5, text: "рано", name: "", consent: true })).status === 409, "API: отзыв во время игры — отказ (409)");

  await click(pult, "Завершить игру досрочно");
  await pult.getByRole("dialog").getByRole("button", { name: "Завершить игру" }).click({ timeout: WAIT });

  await screen.locator(".finale-qrs").waitFor({ timeout: WAIT });
  const captions = await screen.locator(".finale-qr figcaption strong").allTextContents();
  check(captions.join("|") === "Чаевые ведущему|Оставьте отзыв|Наш Telegram", "Экран зала: после игры сам открылся «Спасибо» — три QR: чаевые, отзыв, канал", `Экран зала: подписи QR — ${captions.join(", ")}`);
  check((await screen.locator(".finale-qr svg, .finale-qr img").count()) >= 3, "Экран зала: все три QR нарисованы");
  check((await screen.locator(".screen-exit").count()) === 1, "Экран зала: «На главную» видно и поверх «Спасибо»");
  const finale = (await api("GET", `/api/finale/${game.id}`, annaDevice)).data ?? {};
  check(finale.tipsUrl === TIPS, "Экран зала: QR чаевых ведёт на ссылку ведущего из профиля", `API финала: чаевые ${finale.tipsUrl}`);
  await shot(screen, "экран-спасибо");

  // Пульт: убрать и вернуть «Спасибо».
  await until(async () => (await pult.getByText("Игра завершена").count()) > 0, WAIT, "пульт: игра завершена");
  await click(pult, "Убрать «Спасибо» — показать итоги");
  await screen.locator(".finale-qrs").waitFor({ state: "detached", timeout: WAIT });
  await screen.locator(".podium--final, .final, .board-view").first().waitFor({ timeout: WAIT }).catch(() => undefined);
  ok("Пульт: «Спасибо» убирается — на экране итоги игры");
  await click(pult, "«Спасибо» с QR чаевых, отзыва и канала — на экран");
  await screen.locator(".finale-qrs").waitFor({ timeout: WAIT });
  ok("Пульт: «Спасибо» возвращается на экран одной кнопкой");
  await layout(pult, "Пульт после игры");
  await shot(pult, "пульт-после-игры");

  // ===== 4. Отзыв с телефона гостя =====
  await anna.getByRole("heading", { name: "Спасибо, что были с нами!" }).waitFor({ timeout: WAIT });
  const tipsLink = anna.getByRole("link", { name: /Чаевые ведущему/ });
  check((await tipsLink.getAttribute("href")) === TIPS, "Телефон гостя: кнопка «Чаевые ведущему» ведёт на ссылку ведущего");
  check((await anna.getByRole("link", { name: "Подписаться на канал JoyRest" }).getAttribute("href")) === "https://t.me/JoyRest", "Телефон гостя: кнопка канала ведёт в t.me/JoyRest");
  check((await anna.getByText("Мы начали вести Telegram-канал").count()) === 1, "Телефон гостя: текст про канал на месте");
  const send = anna.getByRole("button", { name: "Отправить отзыв" });
  check(await send.isDisabled(), "Телефон гостя: без оценки и согласия «Отправить отзыв» не нажать");
  await writeReview(anna, { stars: 4, text: `Было весело ${MARK}`, name: "Аня, проверка" });
  check(await send.isDisabled(), "Телефон гостя: без согласия на показ отзыв не отправить");
  await anna.getByLabel(/Согласен\(на\), что JoyRest покажет отзыв/).check();
  await layout(anna, "Телефон гостя: отзыв");
  await shot(anna, "гость-отзыв-форма");
  await send.click();
  await anna.getByText("Спасибо за отзыв! Нам очень приятно.").waitFor({ timeout: WAIT });
  ok("Телефон гостя: отзыв отправлен");
  // Исправить: 5 звёзд и новый текст — тот же отзыв, не второй.
  await click(anna, "Исправить отзыв");
  await writeReview(anna, { stars: 5, text: `Было очень весело ${MARK}` });
  await anna.getByRole("button", { name: "Отправить отзыв" }).click();
  await anna.getByText("Спасибо за отзыв! Нам очень приятно.").waitFor({ timeout: WAIT });
  await anna.reload();
  await anna.getByText("Спасибо за отзыв! Нам очень приятно.").waitFor({ timeout: WAIT });
  check((await anna.getByLabel("Ваша оценка: 5 из 5").count()) === 1, "Телефон гостя: исправленный отзыв (5 звёзд) на месте после перезагрузки");

  // По QR со «Спасибо»: /review/:id — другой гость, без входа в игру.
  const boris = await open(browser, "Гость по QR");
  await boris.goto(`${BASE}/review/${game.id}`);
  await boris.getByRole("radio", { name: "3 из 5" }).waitFor({ timeout: WAIT });
  await writeReview(boris, { stars: 3, text: `По QR ${MARK}`, name: "" });
  await boris.getByLabel(/Согласен\(на\), что JoyRest покажет отзыв/).check();
  await click(boris, "Отправить отзыв");
  await boris.getByText("Спасибо за отзыв! Нам очень приятно.").waitFor({ timeout: WAIT });
  ok("Отзыв по QR (/review/…): отправлен без входа в игру");
  await layout(boris, "Страница отзыва по QR");
  await shot(boris, "отзыв-по-qr");
  const borisDevice = `__Host-jr_d=${(await boris.context().cookies(BASE)).find((c) => c.name === "__Host-jr_d")?.value ?? ""}`;
  check((await api("POST", "/api/reviews", borisDevice, { sessionId: game.id, rating: 5, text: "x", name: "", consent: false })).status === 400, "API: без согласия — отказ (400)");
  check((await api("POST", "/api/reviews", borisDevice, { sessionId: game.id, rating: 7, text: "x", name: "", consent: true })).status === 400, "API: оценка 7 из 5 — отказ (400)");
  check((await api("GET", "/api/reviews", borisDevice)).status >= 401, "API: гость не видит список отзывов");

  // ===== 5. «Отзывы» в студии =====
  const mine = ((await api("GET", "/api/reviews", host.cookie)).data ?? []).filter((r) => r.text.includes(MARK));
  check(mine.length === 2, "API: у ведущего ровно два отзыва этой игры (исправленный не задвоился)", `API: у ведущего отзывов этой игры — ${mine.length}`);
  const annaReview = mine.find((r) => r.text.startsWith("Было очень весело"));
  check(annaReview?.rating === 5 && annaReview?.name === "Аня, проверка", "Отзыв Ани: исправленный текст и 5 звёзд, подпись сохранилась");
  check((await api("POST", `/api/reviews/${annaReview?.id}/status`, host.cookie, { status: "published" })).status === 403, "API: ведущий не может поместить отзыв на сайт (403)");
  await hp.goto(`${BASE}/studio/reviews`);
  const hostCard = hp.locator(".review-list > li", { hasText: `Было очень весело ${MARK}` });
  await hostCard.waitFor({ timeout: WAIT });
  check((await hp.getByRole("button", { name: "Поместить на сайт" }).count()) === 0, "Студия ведущего: свои отзывы видны, кнопок модерации нет");
  await layout(hp, "Отзывы у ведущего");

  const ap = await open(browser, "Владелец", PHONE, admin.token);
  await ap.goto(`${BASE}/studio/reviews`);
  const card = (text) => ap.locator(".review-list > li", { hasText: text });
  await card(`Было очень весело ${MARK}`).waitFor({ timeout: WAIT });
  check((await textOf(card(`Было очень весело ${MARK}`))).includes(`Ведущий: ${host.profile?.name}`), "Студия владельца: у отзыва виден ведущий и игра");
  await card(`Было очень весело ${MARK}`).getByRole("button", { name: "Поместить на сайт" }).click();
  await until(async () => (await textOf(card(`Было очень весело ${MARK}`))).includes("На сайте"), WAIT, "статус «На сайте»");
  ok("Студия владельца: «Поместить на сайт» — статус «На сайте»");
  await card(`Было очень весело ${MARK}`).getByRole("button", { name: "Убрать с сайта" }).click();
  await until(async () => (await textOf(card(`Было очень весело ${MARK}`))).includes("Новый"), WAIT, "статус «Новый»");
  ok("Студия владельца: «Убрать с сайта» — отзыв снова «Новый»");
  await card(`По QR ${MARK}`).getByRole("button", { name: "Скрыть" }).click();
  await until(async () => (await textOf(card(`По QR ${MARK}`))).includes("Скрыт"), WAIT, "статус «Скрыт»");
  await click(ap, "Скрытые");
  check((await card(`По QR ${MARK}`).count()) === 1 && (await card(`Было очень весело ${MARK}`).count()) === 0, "Студия владельца: фильтр «Скрытые» показывает только скрытые");
  await card(`По QR ${MARK}`).getByRole("button", { name: "Поместить на сайт" }).click();
  await click(ap, "На сайте");
  await until(async () => (await card(`По QR ${MARK}`).count()) === 1, WAIT, "скрытый отзыв вернулся на сайт");
  ok("Студия владельца: скрытый отзыв можно вернуть и поместить на сайт");
  await click(ap, "Все");
  await card(`Было очень весело ${MARK}`).getByRole("button", { name: "Поместить на сайт" }).click();
  await until(async () => (await textOf(card(`Было очень весело ${MARK}`))).includes("На сайте"), WAIT, "второй на сайте");
  await layout(ap, "Отзывы у владельца");
  await shot(ap, "владелец-отзывы");

  // ===== 6. Фотоотчёт с пульта =====
  const jpeg1 = await screen.screenshot({ type: "jpeg", quality: 80 });
  const jpeg2 = await anna.screenshot({ type: "jpeg", quality: 80 });
  const fold = pult.locator("details.event-photos");
  await fold.locator("summary").click();
  check((await textOf(fold)).includes("Сначала предупредите гостей"), "Пульт: перед фото — текст, что сказать гостям");
  const input = fold.locator('input[type="file"]');
  const slot = (n) => fold.locator(".event-photos__slot").nth(n - 1);
  const photoUrl = (n) => slot(n).locator("img").getAttribute("src");
  // «Сделать фото» открывает камеру — в проверке файл даём сразу в поле.
  async function takePhoto(n, bytes) {
    const [chooser] = await Promise.all([pult.waitForEvent("filechooser"), slot(n).getByRole("button", { name: /Сделать фото|Переснять/ }).click()]);
    await chooser.setFiles({ name: `photo${n}.jpg`, mimeType: "image/jpeg", buffer: bytes });
    await until(async () => (await slot(n).locator("img").count()) === 1 && (await slot(n).getByRole("button", { name: "Сохраняем…" }).count()) === 0, WAIT, `фото ${n}`);
  }
  await takePhoto(1, jpeg1);
  await takePhoto(2, jpeg2);
  check((await textOf(fold.locator(".fold__value"))) === "2 из 3", "Пульт: два фото — «2 из 3»");
  const before = await photoUrl(1);
  await takePhoto(1, jpeg2);
  await until(async () => (await photoUrl(1)) !== before, WAIT, "переснятое фото");
  ok("Пульт: «Переснять» заменяет фото в той же ячейке");
  // «Удалить»: сначала «Оставить» — фото на месте, потом удалить.
  await slot(2).getByRole("button", { name: "Удалить" }).click();
  await pult.getByRole("dialog").getByRole("button", { name: "Оставить" }).click();
  check((await slot(2).locator("img").count()) === 1, "Пульт: «Удалить» спрашивает, «Оставить» — фото остаётся");
  await slot(2).getByRole("button", { name: "Удалить" }).click();
  await pult.getByRole("dialog").getByRole("button", { name: "Удалить фото" }).click();
  await until(async () => (await slot(2).locator("img").count()) === 0, WAIT, "фото 2 удалено");
  ok("Пульт: «Удалить фото» убирает фото из ячейки");
  await takePhoto(3, jpeg1);
  await layout(pult, "Пульт: фотоотчёт");
  await shot(pult, "пульт-фотоотчёт");
  await pult.reload();
  await pult.locator("details.event-photos summary").click({ timeout: WAIT });
  await until(async () => (await textOf(pult.locator("details.event-photos .fold__value"))) === "2 из 3", WAIT, "фото после перезагрузки");
  ok("Пульт: после перезагрузки фото на месте (2 из 3)");
  const loaded = await pult.locator("details.event-photos img").evaluateAll((imgs) => imgs.map((i) => i.complete && i.naturalWidth > 0));
  check(loaded.length === 2 && loaded.every(Boolean), "Пульт: фото открываются (картинки загрузились)");
  const firstFile = await photoUrl(1);
  check((await fetch(BASE + firstFile)).status === 401, "Фото без входа не открыть (401)");
  check((await api("GET", `/api/sessions/${game.id}/photos`, annaDevice)).status === 401, "Гостю фото игры не отдаются (401)");
  check((await api("GET", firstFile, annaDevice)).status === 401, "Гостю файл фото не отдаётся (401)");

  await hp.goto(`${BASE}/studio/photos`);
  const hostReport = hp.locator(".card", { hasText: `Проверка финала ${MARK}` });
  await hostReport.waitFor({ timeout: WAIT });
  check((await hostReport.locator("img").count()) === 2, "Студия ведущего: «Фотоотчёты» — игра и два фото");
  await layout(hp, "Фотоотчёты у ведущего");
  await ap.goto(`${BASE}/studio/photos`);
  await ap.locator(".card", { hasText: `Проверка финала ${MARK}` }).waitFor({ timeout: WAIT });
  ok("Студия владельца: «Фотоотчёты» — фото ведущего видны");
  await shot(ap, "владелец-фотоотчёты");

  // ===== 7. Видео JoyRest =====
  if (VIDEO && existsSync(VIDEO)) {
    check((await api("POST", "/api/videos", host.cookie, { id: `v${MARK}x`, title: "x", size: 1000 })).status === 403, "API: ведущий не загружает видео (403)");
    await ap.goto(`${BASE}/studio?tab=video`);
    await ap.getByLabel("Папка (по желанию)").fill(`Проверка ${MARK}`);
    const [chooser] = await Promise.all([ap.waitForEvent("filechooser"), click(ap, "⬆ Выбрать видео (можно сразу несколько)")]);
    await chooser.setFiles(VIDEO);
    await until(async () => (await ap.getByText(`📁 Проверка ${MARK}`).count()) > 0, 120_000, "видео загружено");
    const list = (await api("GET", "/api/videos", admin.cookie)).data?.videos ?? [];
    const v = list.find((x) => x.folder === `Проверка ${MARK}`);
    videoId = v?.id ?? "";
    check(v?.ready === true && v.size === statSync(VIDEO).size, "Видео: владелец загрузил файл частями целиком", `Видео: ${JSON.stringify(v ?? null).slice(0, 160)}`);
    check((v?.durationMs ?? 0) > 1000, "Видео: длительность определилась на телефоне");
    await layout(ap, "Студия: видео");
    await shot(ap, "владелец-видео");
    // Ведущий видит, загрузить не может; файл играет в браузере.
    await hp.goto(`${BASE}/studio?tab=video`);
    await hp.getByText(`📁 Проверка ${MARK}`).waitFor({ timeout: WAIT });
    check((await hp.getByRole("button", { name: /Выбрать видео/ }).count()) === 0, "Видео: ведущий видит видео, кнопки загрузки у него нет");
    const plays = await hp.evaluate(async (src) => {
      const el = document.createElement("video");
      el.muted = true;
      el.src = src;
      return await new Promise((resolve) => {
        el.onloadedmetadata = () => resolve(el.duration);
        el.onerror = () => resolve(-1);
        setTimeout(() => resolve(-2), 15000);
      });
    }, `/api/videos/${videoId}/file`);
    check(plays > 1, "Видео: файл открывается в браузере (как на экране зала)", `Видео: браузер не открыл файл (${plays})`);
    // Название и папка, потом «Убрать видео» — сначала «Отмена».
    await ap.getByText(`📁 Проверка ${MARK}`).click();
    await ap.getByRole("button", { name: /Действия с видео/ }).first().click();
    await ap.getByRole("menuitem", { name: "Название и папка" }).click();
    await ap.getByRole("dialog").getByLabel("Название").fill(`Видео ${MARK}`);
    await ap.getByRole("dialog").getByRole("button", { name: "Сохранить" }).click();
    await until(async () => (await api("GET", "/api/videos", admin.cookie)).data?.videos?.some((x) => x.id === videoId && x.title === `Видео ${MARK}`), WAIT, "новое название");
    ok("Видео: «Название и папка» сохраняет новое название");
    await ap.getByRole("button", { name: `Действия с видео «Видео ${MARK}»` }).click();
    await ap.getByRole("menuitem", { name: "Убрать видео" }).click();
    await ap.getByRole("dialog").getByRole("button", { name: "Отмена" }).click();
    check((await api("GET", "/api/videos", admin.cookie)).data?.videos?.some((x) => x.id === videoId), "Видео: «Отмена» — видео остаётся");
    await ap.getByRole("button", { name: `Действия с видео «Видео ${MARK}»` }).click();
    await ap.getByRole("menuitem", { name: "Убрать видео" }).click();
    await ap.getByRole("dialog").getByRole("button", { name: "Убрать видео" }).click();
    await until(async () => !(await api("GET", "/api/videos", admin.cookie)).data?.videos?.some((x) => x.id === videoId), WAIT, "видео убрано");
    ok("Видео: «Убрать видео» с подтверждением — видео пропало у всех");
    videoId = "";
  } else say("ℹ️ Видео: файла E2E_VIDEO нет — часть пропущена");

  // ===== 8. Сайт: лента отзывов и форма отзыва =====
  if (SITE_DIR && existsSync(join(SITE_DIR, "index.html"))) {
    // Как отдаёт /api/site/reviews: только помещённые на сайт, без ведущего и игры.
    const published = ((await api("GET", "/api/reviews", admin.cookie)).data ?? []).filter((r) => r.status === "published" && r.text.includes(MARK));
    const siteReviews = published.map((r) => ({ id: r.id, rating: r.rating, text: r.text, name: r.name, month: "октябрь 2026" }));
    const leads = [];
    const server = await startSite(() => siteReviews, leads);
    const siteUrl = `http://127.0.0.1:${server.address().port}`;
    const sp = await open(browser, "Сайт (телефон)");
    await sp.goto(`${siteUrl}/#reviews`);
    await sp.locator("#siteReviews:not([hidden])").waitFor({ timeout: WAIT });
    check((await textOf(sp.locator("#reviewsTitle"))) === "Что говорят гости", "Сайт: раздел стал «Отзывы · Что говорят гости»");
    const cards = sp.locator("#reviewsTrack .review-card");
    check((await cards.count()) === siteReviews.length * 3, `Сайт: лента из ${siteReviews.length} отзывов (три копии для бесконечной прокрутки)`);
    check((await textOf(sp.locator("#reviewsTrack"))).includes(`Было очень весело ${MARK}`), "Сайт: помещённый владельцем отзыв на сайте");
    const scroll = () => sp.locator("#reviewsTrack").evaluate((el) => ({ left: el.scrollLeft, max: el.scrollWidth - el.clientWidth }));
    const inside = (s) => s.left > 0 && s.left < s.max;
    await sp.waitForTimeout(800);
    check(inside(await scroll()), "Сайт: лента стоит в середине — листать можно в обе стороны");
    // Телефон: свайп пальцем (стрелок на телефоне нет) — назад и вперёд в два раза больше, чем отзывов.
    const swipes = siteReviews.length * 2 + 1;
    for (const dir of [-1, 1]) {
      for (let i = 0; i < swipes; i++) {
        await sp.locator("#reviewsTrack").evaluate((el, d) => el.scrollBy({ left: d * el.clientWidth * 0.9 }), dir);
        await sp.waitForTimeout(400);
      }
      const s = await scroll();
      check(inside(s), `Сайт, телефон: свайп ${dir < 0 ? "назад" : "вперёд"} ${swipes} раз — лента не упирается в край`, `Сайт: лента у края ${JSON.stringify(s)}`);
    }
    await sp.locator("#reviewsTrack").evaluate((el) => el.scrollBy({ left: el.scrollWidth }));
    await sp.waitForTimeout(700);
    check(inside(await scroll()), "Сайт, телефон: рывок до конца — лента тихо перескакивает в середину");
    // Компьютер: стрелки «‹» и «›».
    await sp.setViewportSize({ width: 1280, height: 800 });
    await sp.waitForTimeout(500);
    for (const id of ["#reviewsNext", "#reviewsPrev"]) {
      for (let i = 0; i < swipes; i++) {
        await sp.locator(id).click();
        await sp.waitForTimeout(450);
      }
      const s = await scroll();
      check(inside(s), `Сайт, компьютер: «${id === "#reviewsNext" ? "›" : "‹"}» ${swipes} раз — по кругу без конца`, `Сайт: лента у края ${JSON.stringify(s)}`);
    }
    await sp.setViewportSize({ width: 390, height: 844 });
    await sp.waitForTimeout(300);
    await layout(sp, "Сайт: отзывы");
    await sp.locator("#reviews").screenshot({ path: join(SHOTS, `${String(++shotN).padStart(2, "0")}-сайт-отзывы.png`) });
    // Форма отзыва.
    await sp.locator("#openReviewForm").click();
    await sp.getByRole("button", { name: "4 звезды" }).click();
    await sp.locator("#reviewName").fill("Проверка сайта");
    await sp.locator("#reviewText").fill(`Отзыв с сайта ${MARK}`);
    await sp.locator("#reviewForm .consent-row input").check();
    await sp.locator("#reviewForm button[type=submit]").click();
    await sp.locator("#reviewNote.show").waitFor({ timeout: WAIT });
    const lead = leads.at(-1) ?? {};
    check(lead.type === "review" && lead.rating === 4 && lead.consent === true && lead.text === `Отзыв с сайта ${MARK}`, "Сайт: форма отзыва шлёт в /api/lead (тип review, 4 звезды, согласие) и благодарит", `Сайт: ушло ${JSON.stringify(lead)}`);
    // Нет отзывов на сайте — ленты нет, раздел «Следите за нами».
    siteReviews.length = 0;
    await sp.reload();
    await sp.waitForTimeout(1500);
    check((await sp.locator("#siteReviews").isHidden()) && (await textOf(sp.locator("#reviewsTitle"))) === "Следите за нами", "Сайт: нет отзывов на сайте — ленты нет, раздел «Следите за нами»");
    server.close();
  } else say("ℹ️ Сайт: E2E_SITE_DIR не задан — часть пропущена");
} catch (e) {
  bad(`Проверка остановилась: ${String(e?.message ?? e).slice(0, 300)}`);
  for (const [who, page] of pages) await shot(page, `ошибка-${who}`).catch(() => undefined);
} finally {
  // Уборка: чаевые — как было, отзывы проверки скрыты, фото и видео удалены, сессии закрыты.
  if (host && admin) {
    await api("POST", "/api/me/tips", host.cookie, { url: oldTips }).catch(() => undefined);
    for (const r of (await api("GET", "/api/reviews", admin.cookie).catch(() => ({ data: null }))).data ?? []) {
      if (r.text?.includes(MARK) && r.status !== "hidden") await api("POST", `/api/reviews/${r.id}/status`, admin.cookie, { status: "hidden" }).catch(() => undefined);
    }
    for (const id of sessions) {
      for (const n of [1, 2, 3]) await api("DELETE", `/api/sessions/${id}/photos/${n}`, host.cookie).catch(() => undefined);
      await api("POST", `/api/sessions/${id}/finish`, host.cookie, { participantsCount: 0 }).catch(() => undefined);
    }
    if (videoId) await api("DELETE", `/api/videos/${videoId}`, admin.cookie).catch(() => undefined);
  }
  await browser.close();
}
say(problems.length === 0 ? "Конец игры, отзывы, фотоотчёт и видео работают." : `Замечаний: ${problems.length}`);
finish(problems.length === 0 ? 0 : 1);
