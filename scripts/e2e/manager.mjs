// Проверка пути менеджера (решение владельца 24 октября 2026 — «вся логика работы менеджера должна работать идеально»):
// настоящий браузер (Playwright, телефон 390 px) на test.games.joy-rest.ru под тремя входами — тестовый менеджер по
// продажам (sales-check@joy-rest.ru, создаётся и в конце отключается), ведущий (load@joy-rest.ru) и владелец (TEST_ADMIN_*).
//
// Путь, как в инструкции менеджера:
//  1. Клиент на сайте (калькулятор /calc/ из этого же коммита, свой маленький сервер) пишет имя, дату и время с клавиатуры
//     и жмёт «Отправить расчёт менеджеру» → текст для WhatsApp, Telegram и почты: имя, дата, начало, длительность.
//  2. Менеджер: «Клиенты» → «+ Клиент» → «Заполнить из сообщения» этим текстом + номер из чата → «В работе · имя».
//  3. Карточка клиента → «📅 Записать мероприятие ведущему»: что подставилось («из карточки клиента»), что осталось,
//     «Записать» недоступна, ошибки ввода (ник, почта, неполный телефон, гости), уход в «Клиенты» → черновик → назад.
//  4. «Записать» → ведущему заявка; клиент сам «Клиент»; кружок 🟡 «Ждёт ведущего»; двойное касание — одна запись.
//  5. Ведущий: «Мои мероприятия» → видит программу, связь, «до» → «✅ Принял, готовлюсь» → у менеджера 🟢 «Принято».
//  6. Менеджер меняет комментарий — 🟢 остаётся; меняет «до» — 🟡 снова, ведущий принимает ещё раз.
//  7. Кружки на настоящих мероприятиях: 🔴 «Не подтвердил» (через 10 ч), 🟠 «Идёт», 🟣 «Сверх плана» (игра ведущего
//     открыта после «до»), ⚪ «Прошло — отметьте» → ведущий «Проведено» → 🔵 и клиент «Провели», ⚫ «Отменено» → «Вернуть».
//  8. «По цвету»: порядок «сначала срочное», фильтр по цвету, счётчики; «Рабочее место» показывает, что требует внимания.
//  9. Вставка расчёта прямо в новую форму: заполняет только пустые поля; «Создать похожее»; права менеджера и ведущего.
// Снимки каждого шага — в E2E_SHOTS (workflow кладёт их в ветку e2e-shots, папка manager/). Всё созданное — убирается.
import { createServer } from "node:http";
import { appendFileSync, mkdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { chromium } from "playwright";

const BASE = (process.env.E2E_BASE ?? "https://test.games.joy-rest.ru").replace(/\/$/, "");
const HOST_EMAIL = process.env.LOAD_HOST_EMAIL ?? "";
const HOST_PASSWORD = process.env.LOAD_HOST_PASSWORD ?? "";
const ADMIN_EMAIL = (process.env.TEST_ADMIN_EMAIL ?? "").trim();
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? "";
const SITE_DIR = process.env.SITE_DIR ?? "";
const SHOTS = process.env.E2E_SHOTS ?? "manager-shots";
const SALES_EMAIL = "sales-check@joy-rest.ru";
const WAIT = 20_000;
const TAG = "Проверка Менеджер";

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
const section = (title) => say(`\n— ${title} —`);

function finish(code) {
  // Полный отчёт — файлом рядом со снимками (аннотация Actions обрезается).
  try {
    const md = [`# Проверка пути менеджера`, "", problems.length ? `**Замечаний: ${problems.length}**` : "**Всё работает.**", "", ...problems.map((p) => `- ❌ ${p}`), "", ...report.map((l) => (l.startsWith("\n— ") ? `\n## ${l.slice(3, -2)}\n` : `- ${l.trim()}`))];
    appendFileSync(join(SHOTS, "README.md"), md.join("\n") + "\n");
  } catch {
    /* отчёт в журнале уже есть */
  }
  if (process.env.GITHUB_ACTIONS === "true") {
    const head = problems.length > 0 ? [`Замечаний: ${problems.length}`, ...problems.map((p) => `❌ ${p}`), "", "— Подробно —"] : [];
    const text = [...head, ...report].join("\n").replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, "%0A");
    console.log(`::${code === 0 ? "notice" : "error"} title=Проверка пути менеджера::${text}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      try {
        const lines = [`## Проверка пути менеджера`, "", problems.length ? `**Замечаний: ${problems.length}**` : "**Всё работает.**", "", ...report.map((l) => (l.startsWith("\n— ") ? `\n### ${l.slice(3, -2)}` : `- ${l}`))];
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
      } catch {
        /* итог в аннотации уже есть */
      }
    }
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

// ---------- время (Москва) ----------

const DAY_MS = 86_400_000;
const MSK = 3 * 3_600_000;
const mskDay = (ms) => new Date(ms + MSK).toISOString().slice(0, 10);
const mskMin = (ms) => Math.floor(((ms + MSK) % DAY_MS) / 60_000);
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const TODAY = mskDay(Date.now());
const D_EVENT = addDays(TODAY, 44); // основной праздник клиента
const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
/** Мероприятие вокруг момента: начало через `fromMs` (округление вниз до 15 минут), длина `len` минут. */
function slot(fromMs, len) {
  const at = Date.now() + fromMs;
  const day = mskDay(at);
  const start = Math.floor(mskMin(at) / 15) * 15;
  return { day, start, end: Math.min(start + len, 1800) };
}

// ---------- API ----------

async function api(method, path, cookie, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), "X-JoyRest": "1", Origin: BASE, Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, res };
}

async function login(email, password, newPassword) {
  const { status, res } = await api("POST", "/api/auth/login", "", { email, password });
  if (status !== 200) throw new Error(`вход ${email}: ${status}`);
  let token = "";
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    if (pair.startsWith("__Host-jr_s=")) token = pair.slice("__Host-jr_s=".length);
  }
  let cookie = `__Host-jr_s=${token}`;
  const me = await api("GET", "/api/auth/me", cookie);
  if (me.data?.profile?.mustChangePassword) {
    const changed = await api("POST", "/api/auth/password", cookie, { currentPassword: password, newPassword: newPassword ?? password });
    if (changed.status !== 200) throw new Error(`смена пароля ${email}: ${changed.status}`);
    // Смена пароля закрывает другие сеансы — входим заново новым паролем.
    if (newPassword) return login(email, newPassword);
  }
  return { token, cookie, profile: me.data?.profile };
}

/** Тестовый менеджер по продажам: создать или найти, включить, временный пароль → свой (только в памяти этого прогона). */
async function salesManager(admin) {
  const users = (await api("GET", "/api/users", admin.cookie)).data ?? [];
  let user = users.find((u) => u.email === SALES_EMAIL);
  let temp = "";
  if (!user) {
    const made = await api("POST", "/api/users", admin.cookie, { email: SALES_EMAIL, name: "Мария Проверка", profession: "sales" });
    if (made.status !== 200) throw new Error(`менеджер не создан: ${made.status}`);
    user = made.data.account;
    temp = made.data.temporaryPassword;
  } else {
    if (!user.active) await api("POST", `/api/users/${user.uid}/active`, admin.cookie, { active: true });
    temp = (await api("POST", `/api/users/${user.uid}/password`, admin.cookie, {})).data?.temporaryPassword ?? "";
  }
  await api("POST", `/api/users/${user.uid}/profession`, admin.cookie, { profession: "sales" });
  await api("POST", `/api/users/${user.uid}/access`, admin.cookie, { role: "sales" });
  const own = `Пр0верка-${Math.random().toString(36).slice(2, 10)}-${Date.now() % 100000}`;
  return { uid: user.uid, ...(await login(SALES_EMAIL, temp, own)) };
}

/** Убрать всё созданное проверкой: мероприятия «…проверка менеджера», клиенты «Проверка Менеджер», сессии ведущего. */
async function cleanup(admin, host) {
  const from = addDays(TODAY, -3);
  const to = addDays(TODAY, 60);
  const events = await api("GET", `/api/events?from=${from}&to=${to}`, admin.cookie);
  for (const e of events.data?.events ?? []) {
    if (!/проверка менеджера/i.test(e.title)) continue;
    if (!e.cancelled) await api("POST", `/api/events/${e.id}/cancel`, admin.cookie, {});
    await api("DELETE", `/api/events/${e.id}`, admin.cookie);
  }
  const clients = await api("GET", "/api/clients", admin.cookie);
  for (const c of clients.data?.clients ?? []) if (c.name.includes(TAG)) await api("POST", `/api/clients/${c.id}/archive`, admin.cookie, {});
  if (host) for (const id of liveSessions) await api("POST", `/api/sessions/${id}/finish`, host.cookie, {}).catch(() => undefined);
}

// ---------- сайт: свой маленький сервер для калькулятора этого коммита ----------

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".json": "application/json" };
function siteServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
      let file = normalize(join(SITE_DIR, path));
      if (!file.startsWith(normalize(SITE_DIR))) return res.writeHead(403).end();
      if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
      if (!existsSync(file)) return res.writeHead(404).end();
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(readFileSync(file));
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

// ---------- браузер ----------

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU", timezoneId: "Europe/Moscow" };
const pages = [];
let shotN = 0;
mkdirSync(SHOTS, { recursive: true });
async function shot(page, name) {
  shotN += 1;
  await page.screenshot({ path: join(SHOTS, `${String(shotN).padStart(2, "0")}-${name}.png`), fullPage: true }).catch(() => undefined);
  await layout(page, name);
}

/** Раскладка телефона: нет прокрутки вбок, текст не вылезает из кнопок, кнопки не наезжают друг на друга. */
async function layout(page, where) {
  const found = await page
    .evaluate(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        const folded = el.closest("details:not([open])") && !el.closest("summary");
        return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none" && !folded;
      };
      const label = (el) => (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().replace(/\s+/g, " ").slice(0, 28);
      const controls = [...document.querySelectorAll("main button, main a.btn, main [role=tab], main select, main input:not([type=hidden]):not([type=radio]):not([type=checkbox])")].filter(visible);
      const clipped = controls
        .filter((el) => !["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName))
        .filter((el) => getComputedStyle(el).textOverflow !== "ellipsis" && getComputedStyle(el).overflowX === "visible")
        .filter((el) => el.scrollWidth > el.clientWidth + 2)
        .map(label);
      const overlaps = [];
      for (let i = 0; i < controls.length; i++) {
        const a = controls[i].getBoundingClientRect();
        for (let j = i + 1; j < controls.length; j++) {
          if (controls[i].contains(controls[j]) || controls[j].contains(controls[i])) continue;
          const b = controls[j].getBoundingClientRect();
          const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (w > 3 && h > 3) overlaps.push(`${label(controls[i])} × ${label(controls[j])}`);
        }
      }
      const small = controls
        .filter((el) => el.tagName === "BUTTON" || el.tagName === "A")
        .filter((el) => el.getBoundingClientRect().height < 40 && !el.closest(".plan-client-pick, .fold__summary, .plan-inline, summary"))
        .map(label);
      return { wide: document.documentElement.scrollWidth - document.documentElement.clientWidth, clipped: [...new Set(clipped)].slice(0, 6), overlaps: [...new Set(overlaps)].slice(0, 6), small: [...new Set(small)].slice(0, 6) };
    })
    .catch(() => null);
  if (!found) return;
  if (found.wide > 1) bad(`${where}: страница шире экрана на ${found.wide}px`);
  if (found.clipped.length) bad(`${where}: текст не помещается: ${found.clipped.join(", ")}`);
  if (found.overlaps.length) bad(`${where}: наезжают: ${found.overlaps.join("; ")}`);
  if (found.small.length) say(`ℹ️ ${where}: кнопки ниже 40 px: ${found.small.join(", ")}`);
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
const soft = async (fn, ms, label) => until(fn, ms, label).then(() => true, () => false);

async function newPage(browser, token, who) {
  const context = await browser.newContext(PHONE);
  if (token) await context.addCookies([{ name: "__Host-jr_s", value: token, url: BASE }]);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
  const page = await context.newPage();
  pages.push([who, page]);
  page.on("pageerror", (error) => bad(`${who}: ошибка на странице — ${String(error.message).slice(0, 160)}`));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/favicon|ERR_ABORTED|net::|status of 404|fonts/.test(msg.text())) bad(`${who}: ошибка в консоли — ${msg.text().slice(0, 160)}`);
  });
  // Сервер не должен отвечать 5xx ни на одно действие.
  page.on("response", (r) => {
    if (r.url().startsWith(BASE) && r.status() >= 500) bad(`${who}: сервер ответил ${r.status()} на ${r.request().method()} ${r.url().replace(BASE, "")}`);
  });
  return page;
}

const progressText = async (scope) => ((await scope.locator(".plan-progress").first().textContent()) ?? "").replace(/\s+/g, " ").trim();
const cardOf = (page, text) => page.locator("article.plan-card", { hasText: text });
async function openCard(card) {
  if ((await card.locator(".plan-card__head").getAttribute("aria-expanded")) !== "true") await card.locator(".plan-card__head").click();
}
const lightOf = async (card) => ((await card.locator(".plan-light").first().textContent()) ?? "").trim();
async function eventsList(page) {
  await page.goto(`${BASE}/studio/calendar?tab=events`);
  await until(async () => (await page.locator(".plan-lights").count()) > 0, WAIT, "«Список · По цвету»");
  await until(async () => (await page.locator(".is-stale").count()) === 0, WAIT, "список загрузился");
}
async function apiEvent(cookie, id) {
  const from = addDays(TODAY, -3);
  const to = addDays(TODAY, 60);
  return ((await api("GET", `/api/events?from=${from}&to=${to}`, cookie)).data?.events ?? []).find((e) => e.id === id) ?? null;
}

const liveSessions = [];
let admin;
let host;
let sales;
let site;
const browser = await chromium.launch();
try {
  admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  host = await login(HOST_EMAIL, HOST_PASSWORD);
  await cleanup(admin, null);
  sales = await salesManager(admin);
  const hostName = host.profile?.name ?? "";
  say(`ℹ️ Менеджер: ${SALES_EMAIL} (роль «Менеджер по продажам»), ведущий: ${hostName}, праздник клиента: ${D_EVENT}`);

  // «Сверх плана» ждёт, пока пройдёт «до» (кратно 15 минутам), — заводим его в начале, проверяем в конце.
  const overSlot = (() => {
    const now = Date.now();
    const nowMin = mskMin(now);
    // «До» — ближайшая граница 15 минут не раньше чем через 2 минуты; «с» — за 1 час до неё.
    let end = Math.ceil((nowMin + 2) / 15) * 15;
    const day = mskDay(now);
    if (end >= 1440) return null; // около полуночи — пропускаем
    return { day, start: Math.max(0, end - 60), end };
  })();
  const overId = `e2eover${Date.now() % 100000}`;
  if (overSlot) {
    const r = await api("POST", "/api/events", sales.cookie, { id: overId, hostId: host.profile.uid, ...overSlot, title: "Сверх плана, проверка менеджера", clientName: `Олег ${TAG}`, clientPhone: "", clientContact: "call", place: "Место уточняется", guests: 20, note: "", program: { formats: ["Квиз"], extension: "", addons: [], duration: "" } });
    check(r.status === 200, "Менеджер: мероприятие для проверки «Сверх плана» записано", `Менеджер: запись «Сверх плана» — ${r.status}`);
    const s = await api("POST", "/api/sessions", host.cookie, { id: `e2eses${Date.now() % 1000000}`, mechanic: "quiz", gameTitle: "Проверка менеджера", gameSnapshot: { questions: [] }, playMode: "solo", screenMode: "laptop", themeId: "joyrest" });
    if (s.status === 200) liveSessions.push(s.data.id);
    else bad(`Ведущий: игра для «Сверх плана» не открылась — ${s.status}`);
  } else say("ℹ️ Около полуночи — «Сверх плана» проверяется на сервере тестом, здесь пропуск");

  // ================= 1. Сайт: калькулятор =================
  section("1. Клиент на сайте: калькулятор → расчёт менеджеру");
  let calcText = "";
  if (SITE_DIR && existsSync(join(SITE_DIR, "calc/index.html"))) {
    site = await siteServer();
    const cp = await newPage(browser, "", "Клиент на сайте");
    await cp.goto(`${site.url}/calc/`);
    await cp.locator("#pkgs button").first().waitFor({ timeout: WAIT });
    await cp.locator("#pkgs button", { hasText: "Квиз" }).first().click();
    const tier45 = cp.locator("#tiers button", { hasText: "45" });
    if (await tier45.count()) await tier45.first().click();
    // Дата и время — с клавиатуры (жалоба владельца 24 октября 2026: набранная дата стиралась).
    const [y, m, d] = D_EVENT.split("-");
    await cp.click("#date");
    for (const ch of `${m}${d}${y}`) await cp.keyboard.type(ch, { delay: 30 });
    await cp.click("#time");
    for (const ch of "1900") await cp.keyboard.type(ch, { delay: 30 });
    await cp.click("body", { position: { x: 4, y: 4 } });
    const music = cp.locator("#extras button", { hasText: "Музыкальный" });
    if (await music.count()) await music.first().click();
    const ext = cp.locator("#exts button", { hasText: "30 мин" });
    if (await ext.count()) await ext.first().click();
    const prize = cp.locator("#addons button, #addons label", { hasText: "Призы" });
    if (await prize.count()) await prize.first().click();
    check((await cp.$eval("#date", (e) => e.value)) === D_EVENT && (await cp.$eval("#time", (e) => e.value)) === "19:00", "Сайт: дата и время, набранные с клавиатуры, на месте");
    await shot(cp, "сайт-калькулятор");
    await cp.click("#send");
    await cp.locator("#sName").waitFor({ timeout: WAIT });
    await cp.locator("#sName").fill(`Анна ${TAG}`);
    await shot(cp, "сайт-куда-отправить-с-именем");
    const wa = decodeURIComponent(((await cp.getAttribute("#sWa", "href")) ?? "").split("text=")[1] ?? "");
    const tg = decodeURIComponent(((await cp.getAttribute("#sTg", "href")) ?? "").split("text=")[1] ?? "");
    calcText = wa;
    check(wa.startsWith("🧮 Расчёт JoyRest") && wa.includes(`Имя: Анна ${TAG}`), "Сайт: «Как к вам обращаться» — строкой «Имя» в сообщении менеджеру", `Сайт: WhatsApp «${wa.slice(0, 120)}»`);
    check(/Дата: \d+ [а-я]+ \d{4}/.test(wa) && wa.includes("Начало: в 19:00") && /Длительность: ≈ [\d,]+–[\d,]+ час/.test(wa), "Сайт: в расчёте дата, начало и длительность", `Сайт: «${wa.slice(0, 300)}»`);
    check(tg.includes(`Имя: Анна ${TAG}`) && !/[%+&]/.test(tg), "Сайт: Telegram получает тот же расчёт с именем, без «%», «+», «&»");
    await cp.locator("#sName").fill("<b>Анна</b> +7 915");
    const cleaned = decodeURIComponent(((await cp.getAttribute("#sWa", "href")) ?? "").split("text=")[1] ?? "");
    check(cleaned.includes("Имя: b Анна b") && !cleaned.includes("<b>") && !cleaned.includes("+7 915"), "Сайт: в имени — только буквы (разметка и цифры вырезаются)", `Сайт: «${cleaned.split("\n")[2]}»`);
    await cp.locator("#sName").fill("");
    const noName = decodeURIComponent(((await cp.getAttribute("#sWa", "href")) ?? "").split("text=")[1] ?? "");
    check(!noName.includes("Имя:"), "Сайт: без имени — строки «Имя» нет (поле по желанию)");
    await cp.locator("#sName").fill(`Анна ${TAG}`);
    calcText = decodeURIComponent(((await cp.getAttribute("#sWa", "href")) ?? "").split("text=")[1] ?? "");
  } else {
    say("ℹ️ SITE_DIR не задан — расчёт собран по образцу калькулятора");
  }
  if (!calcText) {
    const [y, m, d] = D_EVENT.split("-");
    const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
    calcText = `🧮 Расчёт JoyRest\n────────────\nИмя: Анна ${TAG}\nПакет: Квиз\nГостей: до 45\nДата: ${Number(d)} ${MONTHS[Number(m) - 1]} ${y}, пт\nНачало: в 19:00 (примерно, подтвердит менеджер)\nДень: пятница–воскресенье\nЕщё игры: Музыкальный\nПродление: 30 мин\nДопы: Призы и медали\nДлительность: ≈ 3–3,5 часа`;
  }
  const hoursMax = Number((/Длительность: ≈ [\d,]+–([\d,]+)/.exec(calcText)?.[1] ?? "4").replace(",", "."));
  const expectEnd = 19 * 60 + Math.round(hoursMax * 60);
  say(`ℹ️ Расчёт: длительность до ${hoursMax} ч → «до» ${hhmm(expectEnd)}`);

  // ================= 2. Менеджер: клиент из сообщения =================
  section("2. Менеджер: новый клиент из сообщения WhatsApp");
  const mp = await newPage(browser, sales.token, "Менеджер");
  await mp.goto(`${BASE}/studio`);
  const desk = mp.locator("#sales-desk");
  check(await soft(async () => (await desk.count()) > 0, WAIT, "рабочее место"), "Менеджер: в студии — «Рабочее место»");
  await shot(mp, "менеджер-рабочее-место");
  const tail = String(Date.now() % 100000).padStart(5, "0");
  const phone = `+7 916 1${tail.slice(0, 2)}-${tail.slice(2, 4)}-${tail.slice(4)}0`;
  await mp.goto(`${BASE}/studio/clients`);
  await mp.getByRole("button", { name: "+ Клиент" }).click();
  await mp.locator("summary", { hasText: "Заполнить из сообщения клиента" }).click();
  await mp.getByLabel("Вставьте сообщение: переписку, заявку или расчёт с сайта").fill(`${calcText}\nТелефон: ${phone}\nПишу из WhatsApp`);
  await mp.getByRole("button", { name: "Заполнить анкету" }).click();
  const anketa = {
    name: await mp.getByLabel("Имя", { exact: true }).inputValue(),
    phone: (await mp.getByLabel("Телефон", { exact: true }).inputValue()).replace(/\D/g, ""),
    day: await mp.getByLabel("Дата", { exact: true }).inputValue(),
    time: await mp.getByLabel("Время", { exact: true }).inputValue(),
  };
  check(anketa.name === `Анна ${TAG}` && anketa.phone.endsWith(phone.replace(/\D/g, "").slice(-10)) && anketa.day === D_EVENT && anketa.time === "19:00", "Менеджер: анкета из расчёта — имя, телефон, дата, время", `Менеджер: анкета ${JSON.stringify(anketa)}`);
  await shot(mp, "менеджер-анкета-из-расчёта");
  await mp.getByRole("button", { name: "Сохранить", exact: true }).click();
  const clientCard = cardOf(mp, `Анна ${TAG}`);
  await clientCard.waitFor({ timeout: WAIT });
  const clientApi = ((await api("GET", "/api/clients", sales.cookie)).data?.clients ?? []).find((c) => c.name === `Анна ${TAG}`);
  check(clientApi?.status === "work" && /^В работе · /.test(clientApi?.statusLine ?? ""), "Менеджер: клиент «В работе», видно кто ведёт", `Менеджер: клиент ${JSON.stringify(clientApi ?? null).slice(0, 160)}`);

  // ================= 3. Карточка клиента → мероприятие =================
  section("3. «📅 Записать мероприятие ведущему»: подставленное, обязательное, ошибки, черновик");
  await openCard(clientCard);
  await clientCard.getByRole("button", { name: "📅 Записать мероприятие ведущему" }).click();
  await until(async () => (await mp.getByPlaceholder("Как обращаться").count()) > 0, WAIT, "форма мероприятия");
  await until(async () => (await mp.getByPlaceholder("Как обращаться").inputValue()) === `Анна ${TAG}`, WAIT, "имя из карточки");
  const p1 = await progressText(mp);
  check(/Заполнено [0-8] из 8/.test(p1) && p1.includes("связь") && p1.includes("повод") && p1.includes("где") && p1.includes("кто ведёт"), "Форма: «Заполнено N из 8 · осталось: связь, повод, где, кто ведёт»", `Форма: «${p1}»`);
  check(!p1.includes("программа") && !p1.includes("дата и время"), "Форма: программа и время из расчёта уже стоят", `Форма: «${p1}»`);
  check((await mp.locator(".plan-got", { hasText: "из карточки клиента" }).count()) >= 3, "Форма: подставленное отмечено «из карточки клиента»");
  check(await mp.getByRole("button", { name: "Записать мероприятие" }).isDisabled(), "Форма: пока не всё обязательное — «Записать» недоступна");
  const whenText = ((await mp.locator(".plan-when").first().textContent()) ?? "").replace(/\s+/g, " ");
  check(whenText.includes(`19:00–${hhmm(expectEnd)}`) && whenText.includes("30 мин запаса"), `Форма: «Когда» — 19:00–${hhmm(expectEnd)}, подпись про 30 минут запаса и доплату`, `Форма: «${whenText}»`);
  const formats = await mp.locator(".plan-formats__name").allTextContents();
  check(formats.join() === "Квиз,Музыкальный", "Форма: программа по порядку — 1 · Квиз, 2 · Музыкальный", `Форма: программа ${formats.join(", ")}`);
  await shot(mp, "форма-из-карточки-клиента");

  // Ошибки, которые делает обычный человек.
  await mp.getByRole("radio", { name: "Telegram", exact: true }).click();
  await mp.getByLabel("Ник Telegram").fill("@an");
  check(((await mp.locator(".plan-warn").allTextContents()).join(" ")).includes("Ник Telegram — латиницей"), "Ошибка: короткий ник — подсказка, как правильно");
  await mp.getByLabel("Ник Telegram").fill("@anna_party");
  check(((await mp.locator(".plan-contact ~ p").allTextContents()).join(" ")).includes("Telegram @anna_party"), "Связь: ник принят — «✓ Telegram @anna_party»");
  await mp.getByRole("radio", { name: "Почта", exact: true }).click();
  await mp.getByLabel("Почта клиента").fill("anna@mail");
  check(((await mp.locator(".plan-warn").allTextContents()).join(" ")).includes("Впишите адрес почты"), "Ошибка: почта без домена — подсказка");
  await mp.getByRole("radio", { name: "WhatsApp", exact: true }).click();
  await mp.getByPlaceholder("+7 …").fill("8915");
  check(((await mp.locator(".plan-warn").allTextContents()).join(" ")).match(/цифр|номер/i) !== null, "Ошибка: неполный телефон — подсказка");
  check(((await mp.locator(".plan-warn").allTextContents()).join(" ")).includes("по номеру"), "Ошибка: WhatsApp без полного номера — нельзя");
  await shot(mp, "форма-ошибки-ввода");
  await mp.getByPlaceholder("+7 …").fill(phone);
  await mp.getByPlaceholder("Например, 37").fill("99999");
  check(((await mp.locator(".plan-warn").allTextContents()).join(" ")).includes("Гостей — числом"), "Ошибка: 99 999 гостей — подсказка, «Записать» недоступна");
  await mp.getByPlaceholder("Например, 37").fill("45");

  // Повод — касанием; место — «уточняется».
  await mp.getByRole("button", { name: "Корпоратив", exact: true }).click();
  await mp.locator('input[list="event-titles"]').fill("Корпоратив, проверка менеджера");
  await mp.getByRole("checkbox", { name: /Место пока уточняется/ }).check();
  const p2 = await progressText(mp);
  check(p2.includes("Заполнено 7 из 8") && p2.includes("кто ведёт"), "Форма: осталось одно — «кто ведёт»", `Форма: «${p2}»`);
  // Касание строки «осталось» — к первому незаполненному.
  await mp.locator(".plan-progress__text").click();
  await mp.waitForTimeout(700);
  const hostInView = await mp.evaluate(() => {
    const el = [...document.querySelectorAll("fieldset.plan-sec")].find((f) => f.querySelector("legend")?.textContent?.includes("Кто ведёт"));
    const r = el?.getBoundingClientRect();
    return Boolean(r && r.top < innerHeight && r.bottom > 0);
  });
  check(hostInView, "Форма: касание «осталось …» прокручивает к «Кто ведёт»");

  // Ушли в «Клиенты» — черновик — вернулись.
  await mp.goto(`${BASE}/studio/clients`);
  await mp.waitForTimeout(800);
  await mp.goto(`${BASE}/studio/calendar?tab=events`);
  const drafts = mp.locator(".plan-drafts");
  check(await soft(async () => (await drafts.count()) > 0, WAIT, "черновики"), "Черновик: после ухода в «Клиенты» — в «Черновиках мероприятий»");
  await shot(mp, "черновики");
  await drafts.getByRole("button", { name: "Продолжить" }).first().click();
  await until(async () => (await mp.getByPlaceholder("Как обращаться").count()) > 0, WAIT, "форма из черновика");
  const resumed = {
    name: await mp.getByPlaceholder("Как обращаться").inputValue(),
    title: await mp.locator('input[list="event-titles"]').inputValue(),
    tbd: await mp.getByRole("checkbox", { name: /Место пока уточняется/ }).isChecked(),
    whatsapp: (await mp.getByRole("radio", { name: "WhatsApp", exact: true }).getAttribute("aria-checked")) === "true",
    progress: await progressText(mp),
  };
  check(resumed.name === `Анна ${TAG}` && resumed.title === "Корпоратив, проверка менеджера" && resumed.tbd && resumed.whatsapp && resumed.progress.includes("7 из 8"), "Черновик: «Продолжить» — всё на месте: имя, повод, связь, «место уточняется», 7 из 8", `Черновик: ${JSON.stringify(resumed)}`);
  // Ведущий — и «Записать» (двойное касание — одна запись).
  const hostRadio = mp.getByRole("radio", { name: new RegExp(hostName) });
  await until(async () => (await hostRadio.count()) > 0, WAIT, "ведущие в форме");
  const hostLine = ((await mp.locator("label.plan-host", { hasText: hostName }).first().textContent()) ?? "").replace(/\s+/g, " ");
  check(/Может|Не отметил|Свободен частично|Занят/.test(hostLine), `Форма: у ведущего видна занятость на это время («${hostLine.slice(0, 60)}»)`);
  await hostRadio.first().check();
  check((await progressText(mp)).includes("Всё обязательное заполнено"), "Форма: «✓ Всё обязательное заполнено», «Записать» доступна");
  await shot(mp, "форма-заполнена");
  const save = mp.getByRole("button", { name: "Записать мероприятие" });
  await save.dblclick();
  await until(async () => (await mp.locator(".plan-seg--views").count()) > 0, WAIT, "форма закрылась");
  check((await mp.locator(".plan-drafts").count()) === 0, "Черновик: после «Записать» — черновика больше нет");

  // ================= 4. Что записалось =================
  section("4. Записано: ведущему заявка, клиент — «Клиент», кружок 🟡");
  const all = (await api("GET", `/api/events?from=${D_EVENT}&to=${D_EVENT}`, sales.cookie)).data?.events ?? [];
  const mine = all.filter((e) => e.title === "Корпоратив, проверка менеджера");
  check(mine.length === 1, "Двойное касание «Записать» — одно мероприятие", `Записано: ${mine.length}`);
  const ev = mine[0];
  check(
    ev && ev.clientName === `Анна ${TAG}` && ev.clientContact === "whatsapp" && ev.start === 1140 && ev.end === expectEnd && ev.place === "Место уточняется" && ev.guests === 45 && ev.program?.formats?.join() === "Квиз,Музыкальный" && ev.program?.extension === "30 мин" && ev.hostId === host.profile.uid && ev.acceptedAt === null,
    `API: записано всё — клиент, связь WhatsApp, 19:00–${hhmm(expectEnd)}, «место уточняется», 45 гостей, программа по порядку, ведущий, ещё не принято`,
    `API: ${JSON.stringify(ev ?? null).slice(0, 400)}`,
  );
  const clientAfter = ((await api("GET", "/api/clients", sales.cookie)).data?.clients ?? []).find((c) => c.name === `Анна ${TAG}`);
  check(clientAfter?.status === "client", "Клиент: после «Записать» сам стал «Клиент»", `Клиент: ${clientAfter?.status}`);
  const booked = ((await api("GET", `/api/calendar?from=${D_EVENT}&to=${D_EVENT}`, host.cookie)).data?.entries ?? []).find((e) => e.id === `ev-${ev?.id}`);
  check(booked && booked.start === 1140 && booked.end === expectEnd && !String(booked.note).includes("Анна"), `Календарь ведущего: занят 19:00–${hhmm(expectEnd)} (вместе с запасом), без имени клиента`);
  await eventsList(mp);
  await mp.getByRole("combobox", { name: "Поиск" }).fill("проверка менеджера");
  const evCard = cardOf(mp, "Корпоратив, проверка менеджера");
  await evCard.waitFor({ timeout: WAIT });
  check((await lightOf(evCard)) === "Ждёт ведущего", "Кружок: 🟡 «Ждёт ведущего»", `Кружок: «${await lightOf(evCard)}»`);
  await openCard(evCard);
  const evText = ((await evCard.textContent()) ?? "").replace(/\s+/g, " ");
  check(evText.includes("WhatsApp по номеру") && evText.includes("Место уточняется") && evText.includes("программа") && evText.includes("30 мин запаса"), "Карточка менеджера: связь, «место уточняется», время с запасом, программа", `Карточка: «${evText.slice(0, 300)}»`);
  check((await evCard.getByRole("button", { name: "Удалить навсегда" }).count()) === 0, "Права: у менеджера нет «Удалить навсегда»");
  check((await mp.getByRole("button", { name: "Итоги", exact: true }).count()) === 0, "Права: у менеджера нет «Итогов»");
  await shot(mp, "менеджер-карточка-ждёт-ведущего");

  // ================= 5. Ведущий принимает =================
  section("5. Ведущий: видит заявку и нажимает «✅ Принял, готовлюсь»");
  const hp = await newPage(browser, host.token, "Ведущий");
  await hp.goto(`${BASE}/studio/calendar?tab=events`);
  await until(async () => (await hp.getByRole("tab", { name: "Мои мероприятия" }).count()) > 0, WAIT, "«Мои мероприятия»");
  await hp.getByRole("button", { name: "Список", exact: true }).click();
  await hp.getByRole("combobox", { name: "Поиск" }).fill("проверка менеджера");
  const hostCard = cardOf(hp, "Корпоратив, проверка менеджера");
  await hostCard.waitFor({ timeout: WAIT });
  check((await lightOf(hostCard)) === "Подтвердите", "Ведущий: кружок — «Подтвердите»", `Ведущий: «${await lightOf(hostCard)}»`);
  await openCard(hostCard);
  const hostText = ((await hostCard.textContent()) ?? "").replace(/\s+/g, " ");
  check(hostText.includes("1 · Квиз → 2 · Музыкальный") && hostText.includes("Анна") && hostText.includes("WhatsApp по номеру") && hostText.includes(`19:00–${hhmm(expectEnd)}`), "Ведущий: программа по порядку, клиент, связь, время «с … до …»", `Ведущий: «${hostText.slice(0, 300)}»`);
  check((await hostCard.getByRole("button", { name: "Изменить" }).count()) === 0, "Права: ведущий не правит мероприятие");
  await shot(hp, "ведущий-заявка");
  await hostCard.getByRole("button", { name: "✅ Принял, готовлюсь" }).click();
  check(await soft(async () => (await lightOf(hostCard)) === "Принято", WAIT, "принято у ведущего"), "Ведущий: после касания — 🟢 «Принято»");
  await shot(hp, "ведущий-принял");
  await eventsList(mp);
  await mp.getByRole("combobox", { name: "Поиск" }).fill("проверка менеджера");
  check(await soft(async () => (await lightOf(evCard)) === "Принято", WAIT, "принято у менеджера"), "Менеджер: кружок стал 🟢 «Принято»");

  // ================= 6. Правки после принятия =================
  section("6. Правки: комментарий не сбрасывает «Принято», время — сбрасывает");
  await openCard(evCard);
  await evCard.getByRole("button", { name: "Изменить" }).click();
  await mp.getByPlaceholder("Пожелания, особенности зала, что взять с собой").fill("Микрофон свой, проверка");
  await mp.getByRole("button", { name: "Сохранить", exact: true }).click();
  await until(async () => (await mp.locator(".plan-seg--views").count()) > 0, WAIT, "сохранено");
  const afterNote = await apiEvent(sales.cookie, ev.id);
  check(Boolean(afterNote?.acceptedAt) && afterNote?.note === "Микрофон свой, проверка", "Правка комментария: «Принято» осталось");
  await eventsList(mp);
  await mp.getByRole("combobox", { name: "Поиск" }).fill("проверка менеджера");
  await openCard(evCard);
  await evCard.getByRole("button", { name: "Изменить" }).click();
  await mp.getByLabel("До", { exact: true }).selectOption(String((expectEnd + 30) % 1440));
  await mp.getByRole("button", { name: "Сохранить", exact: true }).click();
  await until(async () => (await mp.locator(".plan-seg--views").count()) > 0, WAIT, "сохранено");
  const afterTime = await apiEvent(sales.cookie, ev.id);
  check(afterTime?.end === expectEnd + 30 && afterTime?.acceptedAt === null, "Правка «до»: «Принято» снято — ведущему «Изменено»", `API: ${JSON.stringify({ end: afterTime?.end, acceptedAt: afterTime?.acceptedAt })}`);
  await eventsList(mp);
  await mp.getByRole("combobox", { name: "Поиск" }).fill("проверка менеджера");
  check((await lightOf(evCard)) === "Ждёт ведущего", "Менеджер: кружок снова 🟡 «Ждёт ведущего»");
  await hp.reload();
  await hp.getByRole("button", { name: "Список", exact: true }).click();
  await hp.getByRole("combobox", { name: "Поиск" }).fill("проверка менеджера");
  await openCard(hostCard);
  await hostCard.getByRole("button", { name: "✅ Принял, готовлюсь" }).click();
  check(await soft(async () => Boolean((await apiEvent(sales.cookie, ev.id))?.acceptedAt), WAIT, "принято снова"), "Ведущий: принял изменённое — снова 🟢");

  // ================= 7. Все цвета =================
  section("7. Кружки на настоящих мероприятиях");
  const mk = async (id, s, title, extra = {}) => {
    const r = await api("POST", "/api/events", sales.cookie, { id, hostId: host.profile.uid, ...s, title, clientName: `Гость ${TAG}`, clientPhone: "", clientContact: "call", place: "Место уточняется", guests: 10, note: "", program: { formats: ["Квиз"], extension: "", addons: [], duration: "" }, ...extra });
    if (r.status !== 200) bad(`API: «${title}» не записано — ${r.status}`);
    return r.data;
  };
  const idLate = `e2elate${Date.now() % 100000}`;
  const idLive = `e2elive${Date.now() % 100000}`;
  const idPast = `e2epast${Date.now() % 100000}`;
  const idOff = `e2eoff${Date.now() % 100000}`;
  await mk(idLate, slot(10 * 3_600_000, 180), "Скоро, проверка менеджера");
  await mk(idLive, slot(-30 * 60_000, 180), "Сейчас, проверка менеджера");
  const pastSlot = slot(-3 * 3_600_000, 60);
  await mk(idPast, pastSlot, "Прошло, проверка менеджера");
  await mk(idOff, slot(5 * DAY_MS, 120), "Отмена, проверка менеджера");
  await api("POST", `/api/events/${idOff}/cancel`, sales.cookie, {});
  await eventsList(mp);
  await mp.getByRole("combobox", { name: "Поиск" }).fill("проверка менеджера");
  await until(async () => (await mp.locator("article.plan-card").count()) >= 5, WAIT, "пять мероприятий проверки");
  const lights = {
    late: await lightOf(cardOf(mp, "Скоро, проверка менеджера")),
    live: await lightOf(cardOf(mp, "Сейчас, проверка менеджера")),
    past: await lightOf(cardOf(mp, "Прошло, проверка менеджера")),
    off: await lightOf(cardOf(mp, "Отмена, проверка менеджера")),
    ok: await lightOf(evCard),
  };
  check(/^Не подтвердил · через (9|10) ч$/.test(lights.late), "🔴 «Не подтвердил · через 10 ч» — до начала меньше суток", `🔴: «${lights.late}»`);
  check(/^Идёт · до \d\d:\d\d$/.test(lights.live), "🟠 «Идёт · до …» — время мероприятия", `🟠: «${lights.live}»`);
  check(lights.past === "Прошло — отметьте", "⚪ «Прошло — отметьте» — время прошло, отметки нет", `⚪: «${lights.past}»`);
  check(lights.off === "Отменено", "⚫ «Отменено»", `⚫: «${lights.off}»`);
  check(lights.ok === "Принято", "🟢 «Принято»", `🟢: «${lights.ok}»`);
  const order = (await mp.locator("article.plan-card .plan-card__title").allTextContents()).map((t) => t.split(" · ")[0].trim());
  const pos = (t) => order.findIndex((x) => x.startsWith(t));
  check(
    pos("Скоро") < pos("Сейчас") && pos("Сейчас") < pos("Прошло") && pos("Прошло") < pos("Корпоратив") && pos("Корпоратив") < pos("Отмена"),
    "«По цвету»: сначала срочное — 🔴 → 🟠 → ⚪ → 🟢 → ⚫",
    `«По цвету»: порядок ${order.join(" | ")}`,
  );
  await shot(mp, "по-цвету-все");
  // Фильтр по цвету.
  await mp.locator(".plan-lights__btn", { hasText: "Не подтвердил" }).click();
  const filtered = await mp.locator("article.plan-card .plan-card__title").allTextContents();
  check(filtered.length >= 1 && filtered.every((t) => !t.includes("Корпоратив")), "Фильтр «Не подтвердил»: только такие", `Фильтр: ${filtered.join(" | ")}`);
  await shot(mp, "по-цвету-не-подтвердил");
  await mp.locator(".plan-lights__btn", { hasText: "Все" }).click();
  // «Рабочее место» — что требует внимания.
  await mp.goto(`${BASE}/studio`);
  const lightsDesk = mp.locator(".sales-desk__lights");
  check(await soft(async () => ((await lightsDesk.textContent()) ?? "").includes("Не подтвердил"), WAIT, "внимание на рабочем месте"), "«Рабочее место»: «Мероприятия — нужно внимание: Не подтвердил…»");
  await shot(mp, "рабочее-место-внимание");
  // Прошедшее: ведущий отмечает «Проведено» → 🔵, клиент «Провели».
  const pastClient = `Прошлый ${TAG}`;
  const pastPhone = `+7 916 2${tail.slice(0, 2)}-${tail.slice(2, 4)}-${tail.slice(4)}1`;
  await api("POST", "/api/events", sales.cookie, { id: idPast, hostId: host.profile.uid, ...pastSlot, title: "Прошло, проверка менеджера", clientName: pastClient, clientPhone: pastPhone, clientContact: "whatsapp", place: "Место уточняется", guests: 10, note: "", program: { formats: ["Квиз"], extension: "", addons: [], duration: "" } });
  await hp.goto(`${BASE}/studio/calendar?tab=events`);
  await hp.getByRole("button", { name: "Список", exact: true }).click();
  await hp.getByRole("button", { name: "Архив", exact: true }).click();
  const hostPast = cardOf(hp, "Прошло, проверка менеджера");
  await hostPast.waitFor({ timeout: WAIT });
  await openCard(hostPast);
  await hostPast.getByRole("button", { name: "Проведено", exact: true }).click();
  check(await soft(async () => (await lightOf(hostPast)) === "Проведено", WAIT, "проведено"), "Ведущий: «Проведено» — 🔵");
  const pastClientApi = ((await api("GET", "/api/clients", sales.cookie)).data?.clients ?? []).find((c) => c.name === pastClient);
  check(pastClientApi?.status === "held", "Клиент: после «Проведено» — «Провели» (пора просить отзыв)", `Клиент: ${pastClientApi?.status}`);
  // Отменённое — «Вернуть»: снова 🟡 (ведущему «Назначено»).
  await eventsList(mp);
  await mp.getByRole("combobox", { name: "Поиск" }).fill("Отмена, проверка менеджера");
  const offCard = cardOf(mp, "Отмена, проверка менеджера");
  await openCard(offCard);
  await offCard.getByRole("button", { name: "Вернуть мероприятие" }).click();
  await mp.getByRole("dialog").getByRole("button", { name: "Вернуть" }).click();
  check(await soft(async () => (await lightOf(offCard)) === "Ждёт ведущего", WAIT, "вернули"), "«Вернуть»: из ⚫ снова 🟡 «Ждёт ведущего»");

  // ================= 8. Вставка расчёта в новую форму =================
  section("8. «📋 Вставить расчёт или заявку»: только пустые поля, подсветка «из расчёта»");
  await mp.goto(`${BASE}/studio/calendar?tab=events`);
  await mp.getByRole("button", { name: "+ Новое мероприятие" }).click();
  await mp.getByPlaceholder("Как обращаться").fill(`Вера ${TAG}`);
  await mp.locator("summary", { hasText: "Вставить расчёт или заявку" }).click();
  await mp.getByLabel("Расчёт клиента или текст заявки").fill(`${calcText}\nПишите в телеграм @vera_party`);
  await mp.getByRole("button", { name: "Разложить по полям" }).click();
  const filledNote = ((await mp.locator(".plan-filled").first().textContent()) ?? "").replace(/\s+/g, " ");
  check((await mp.getByPlaceholder("Как обращаться").inputValue()) === `Вера ${TAG}`, "Вставка: введённое имя не затёрто именем из расчёта");
  check(filledNote.includes("из расчёта") && filledNote.includes("связь") && filledNote.includes("программа") && filledNote.includes("дата и время"), "Вставка: «Подставлено из расчёта: связь, дата и время, программа…»", `Вставка: «${filledNote}»`);
  check((await mp.getByLabel("Ник Telegram").inputValue()) === "@vera_party", "Вставка: ник Telegram из текста — связь Telegram");
  check((await mp.locator(".plan-got", { hasText: "из расчёта" }).count()) >= 3, "Вставка: подставленное подсвечено «из расчёта»");
  await shot(mp, "вставка-расчёта");
  // Поправили поле — подсветка уходит.
  await mp.getByPlaceholder("Например, 37").fill("40");
  check((await mp.locator("label", { hasText: "Гостей (точное число)" }).locator(".plan-got").count()) === 0, "Вставка: поправил поле — метка «из расчёта» у него ушла");
  await mp.getByRole("button", { name: "Удалить черновик" }).click();
  await mp.getByRole("dialog").getByRole("button", { name: "Удалить черновик" }).click();

  // «Создать похожее».
  await eventsList(mp);
  await mp.getByRole("combobox", { name: "Поиск" }).fill("Корпоратив, проверка менеджера");
  await openCard(evCard);
  await evCard.getByRole("button", { name: "Создать похожее" }).click();
  await until(async () => (await mp.getByPlaceholder("Как обращаться").count()) > 0, WAIT, "похожее");
  check((await mp.getByPlaceholder("Как обращаться").inputValue()) === `Анна ${TAG}` && (await mp.locator(".plan-formats__name").allTextContents()).join() === "Квиз,Музыкальный", "«Создать похожее»: клиент и программа те же");
  await mp.getByRole("button", { name: "Отмена", exact: true }).click();

  // Права через API.
  section("9. Права и старые страницы");
  check((await api("POST", "/api/events", host.cookie, { id: "e2eno", hostId: host.profile.uid, day: D_EVENT, start: 600, end: 700, title: "нельзя, проверка менеджера" })).status === 403, "API: ведущий не записывает мероприятия (403)");
  check((await api("DELETE", `/api/events/${idOff}`, sales.cookie)).status === 403, "API: менеджер не удаляет навсегда (403)");
  check((await api("GET", "/api/clients/export", sales.cookie)).status === 403, "API: менеджер не выгружает клиентов (403)");
  const { clientContact: _c, live: _l, updatedAt: _u, hostName: _h, cancelled: _x, held: _y, acceptedAt: _a, acceptRev: _r, ...oldBody } = (await apiEvent(sales.cookie, ev.id)) ?? {};
  const oldSave = await api("POST", "/api/events", sales.cookie, oldBody);
  check(oldSave.status === 200 && oldSave.data?.clientContact === "whatsapp", "Старая страница без поля «связь» — связь не стирается");

  // ================= 10. Сверх плана =================
  if (overSlot && liveSessions.length) {
    section("10. 🟣 «Сверх плана»: игра ведущего открыта после «до»");
    const endsAt = Date.parse(`${overSlot.day}T00:00:00Z`) - MSK + overSlot.end * 60_000;
    const left = endsAt + 70_000 - Date.now();
    if (left > 0) {
      say(`ℹ️ Ждём «до» ${hhmm(overSlot.end)} — ${Math.ceil(left / 1000)} с`);
      // Пульт «двигается», пока ждём: иначе через 30 минут без действий игра не считается открытой.
      await new Promise((r) => setTimeout(r, left));
    }
    // Пульт «двигается» (действие ведущего): игра считается открытой, если действие было за последние 30 минут.
    await api("POST", `/api/sessions/${liveSessions[0]}/apply`, host.cookie, { state: { revealed: false } }).catch(() => undefined);
    await eventsList(mp);
    await mp.getByRole("combobox", { name: "Поиск" }).fill("Сверх плана, проверка менеджера");
    const overCard = cardOf(mp, "Сверх плана, проверка менеджера");
    await overCard.waitFor({ timeout: WAIT });
    const overLight = await lightOf(overCard);
    check(/^Сверх плана · \d+ мин$/.test(overLight), "🟣 «Сверх плана · N мин» — после «до» игра ещё открыта", `🟣: «${overLight}»`);
    await shot(mp, "сверх-плана");
    await api("POST", `/api/sessions/${liveSessions[0]}/finish`, host.cookie, {});
    liveSessions.length = 0;
    await mp.reload();
    await until(async () => (await mp.locator(".plan-lights").count()) > 0, WAIT, "список");
    await mp.getByRole("combobox", { name: "Поиск" }).fill("Сверх плана, проверка менеджера");
    check(await soft(async () => (await lightOf(overCard)) === "Прошло — отметьте", WAIT, "игру закрыли"), "Игру завершили — ⚪ «Прошло — отметьте»");
  }

  // Узкий телефон и планшет: форма и список.
  section("11. Раскладка: 360 px и планшет");
  for (const size of [{ width: 360, height: 780 }, { width: 820, height: 1180 }]) {
    await mp.setViewportSize(size);
    await eventsList(mp);
    await shot(mp, `список-${size.width}`);
    await mp.getByRole("button", { name: "+ Новое мероприятие" }).click();
    await mp.waitForTimeout(500);
    await shot(mp, `форма-${size.width}`);
    await mp.getByRole("button", { name: "Отмена", exact: true }).click();
  }
  await mp.setViewportSize(PHONE.viewport);
} catch (e) {
  bad(`Проверка остановилась: ${String(e?.message ?? e).slice(0, 300)}`);
  for (const [who, page] of pages) await shot(page, `ошибка-${who}`).catch(() => undefined);
} finally {
  if (admin) await cleanup(admin, host).catch(() => undefined);
  if (admin && sales?.uid) await api("POST", `/api/users/${sales.uid}/active`, admin.cookie, { active: false }).catch(() => undefined);
  site?.server.close();
  await browser.close();
}
say(problems.length === 0 ? "\nПуть менеджера работает от сайта до «Проведено»." : `\nЗамечаний: ${problems.length}`);
finish(problems.length === 0 ? 0 : 1);
