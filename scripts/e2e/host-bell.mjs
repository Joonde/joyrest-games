// Путь ведущего «назначили → колокольчик → карточка → ✅ Принял, готовлюсь» в настоящем браузере
// (решение владельца 7 ноября 2026: из колокольчика ведущий попадал в календарь и не находил, где подтвердить).
//
// Работает против любого адреса платформы со своим сервером: в workflow «Проверка пути ведущего» — против
// приложения, запущенного прямо в сборщике (своя база PostgreSQL, ничего не трогает на test и основной версии).
// Нужен владелец: E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD. Ведущего скрипт заводит сам (или берёт уже заведённого).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = (process.env.E2E_BASE ?? "http://localhost:8080").replace(/\/$/, "");
const ADMIN_EMAIL = (process.env.E2E_ADMIN_EMAIL ?? "").trim();
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "";
const HOST_EMAIL = "bell-host@example.com";
const HOST_PASSWORD = "Bell-Host-Check-2026!";
const SHOTS = process.env.E2E_SHOTS ?? "host-bell-shots";
const WAIT = 20_000;
mkdirSync(SHOTS, { recursive: true });

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

async function api(method, path, cookie, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), "X-JoyRest": "1", Origin: BASE, Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, res };
}

async function login(email, password) {
  const { status, res } = await api("POST", "/api/auth/login", "", { email, password });
  if (status !== 200) return null;
  let token = "";
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    if (pair.startsWith("__Host-jr_s=")) token = pair.slice("__Host-jr_s=".length);
  }
  const cookie = `__Host-jr_s=${token}`;
  const me = await api("GET", "/api/auth/me", cookie);
  return { token, cookie, profile: me.data?.profile };
}

const moscowToday = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const DAY = addDays(moscowToday(), 3);
const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const MONTHS_OF = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const dayTitle = (day) => {
  const d = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS_OF[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const monthTitle = (day) => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;

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

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU" };
const LAPTOP = { viewport: { width: 1280, height: 800 }, locale: "ru-RU" };
let shotN = 0;
async function shot(page, name) {
  shotN += 1;
  await page.screenshot({ path: join(SHOTS, `${String(shotN).padStart(2, "0")}-${name}.png`), fullPage: false });
}

const pages = [];
async function newPage(browser, token, who, device = PHONE) {
  const context = await browser.newContext(device);
  // На http://localhost (приложение в сборщике) — явно Secure: Chromium принимает такие cookie у localhost.
  const u = new URL(BASE);
  await context.addCookies([
    u.protocol === "http:" ? { name: "__Host-jr_s", value: token, domain: u.hostname, path: "/", secure: true } : { name: "__Host-jr_s", value: token, url: BASE },
  ]);
  const page = await context.newPage();
  pages.push([who, page]);
  page.on("pageerror", (error) => bad(`${who}: ошибка на странице — ${String(error.message).slice(0, 160)}`));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/favicon|ERR_ABORTED|net::|status of 40[134]/.test(msg.text())) bad(`${who}: ошибка в консоли — ${msg.text().slice(0, 160)}`);
  });
  return page;
}

async function noSideScroll(page, where) {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(wide <= 1, `${where}: нет прокрутки вбок`, `${where}: страница шире экрана на ${wide}px`);
}

/** Колокольчик → строка уведомления с этим заголовком → карточка мероприятия раскрыта, «Принял» на экране. */
async function bellToCard(page, eventId, heading, where) {
  const button = page.locator(".notice-bell__button");
  await button.waitFor({ timeout: WAIT });
  await button.click();
  const item = page.locator(".notice-item", { hasText: heading }).first();
  await until(async () => (await item.count()) > 0, WAIT, `«${heading}» в колокольчике (${where})`);
  ok(`${where}: в колокольчике «${heading}»`);
  await shot(page, `колокольчик-${where}`);
  await item.click();
  const card = page.locator(`[data-event-card="${eventId}"]`);
  await until(async () => (await card.count()) === 1, WAIT, `карточка мероприятия (${where})`);
  check(await card.evaluate((el) => el.classList.contains("is-open")), `${where}: касание открывает карточку этого мероприятия, она раскрыта`);
  check(((await page.getByRole("tab", { selected: true }).textContent()) ?? "").includes("Мои мероприятия"), `${where}: открыта вкладка «Мои мероприятия»`);
  const accept = card.getByRole("button", { name: "✅ Принял, готовлюсь" });
  await until(async () => (await accept.count()) === 1, WAIT, `«Принял, готовлюсь» (${where})`);
  await page.waitForTimeout(900); // плавная прокрутка
  const top = await accept.evaluate((el) => el.getBoundingClientRect().top);
  const height = await page.evaluate(() => window.innerHeight);
  check(top >= 0 && top < height, `${where}: «✅ Принял, готовлюсь» сразу на экране`, `${where}: кнопка вне экрана (верх ${Math.round(top)} из ${height})`);
  check(!page.url().includes("event="), `${where}: адрес очищен после открытия`, `${where}: адрес остался ${page.url()}`);
  check(((await card.textContent()) ?? "").includes("Квиз"), `${where}: в карточке программа (Квиз)`);
  await shot(page, `карточка-${where}`);
  return { card, accept };
}

const browser = await chromium.launch();
try {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error("нет E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD");
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  if (!admin) throw new Error("владелец не вошёл");
  // Ведущий: завести (временный пароль) и задать свой; уже есть — войти.
  let host = await login(HOST_EMAIL, HOST_PASSWORD);
  if (!host) {
    const made = await api("POST", "/api/users", admin.cookie, { email: HOST_EMAIL, name: "Ведущий Проверка" });
    if (made.status !== 200) throw new Error(`ведущий не заведён: ${made.status}`);
    const temp = await login(HOST_EMAIL, made.data.temporaryPassword);
    if (!temp) throw new Error("ведущий не вошёл с временным паролем");
    const changed = await api("POST", "/api/auth/password", temp.cookie, { currentPassword: made.data.temporaryPassword, newPassword: HOST_PASSWORD });
    if (changed.status !== 200) throw new Error(`смена пароля ведущего: ${changed.status}`);
    host = await login(HOST_EMAIL, HOST_PASSWORD);
  }
  if (!host) throw new Error("ведущий не вошёл");
  say(`Дата мероприятия: ${DAY}`);

  // 1. Владелец (как менеджер после брони) записывает мероприятие ведущему.
  const id = `e2ebell${Date.now() % 1_000_000}`;
  const base = {
    id, hostId: host.profile.uid, day: DAY, start: 1140, end: 1350, title: "Корпоратив", guests: 40,
    clientName: "Клиент Проверка", clientPhone: "+7 900 000-00-00", clientContact: "call", place: "Москва, проверка", note: "",
    program: { formats: ["Квиз", "Музыкальный"], extension: "", addons: [], duration: "" },
  };
  const made = await api("POST", "/api/events", admin.cookie, base);
  check(made.status === 200, "Владелец: мероприятие записано ведущему", `Владелец: запись — ${made.status} ${JSON.stringify(made.data).slice(0, 120)}`);

  // 2. Ведущий стоит в «Моём календаре» (как у владельца на проверке) и касается уведомления.
  const hp = await newPage(browser, host.token, "Ведущий");
  await hp.goto(`${BASE}/studio/calendar?tab=mine`);
  const first = await bellToCard(hp, id, "Вам назначено мероприятие", "из-календаря");
  await first.accept.click();
  await until(async () => ((await api("GET", `/api/events?from=${DAY}&to=${DAY}`, admin.cookie)).data?.events ?? []).some((e) => e.id === id && e.acceptedAt), WAIT, "отметка «Принял» на сервере");
  ok("Ведущий: «Принял, готовлюсь» — отметка на сервере");
  await until(async () => (await first.card.getByRole("button", { name: "✅ Принял, готовлюсь" }).count()) === 0, WAIT, "кнопка сменилась");
  ok("Ведущий: после касания кнопка «Принял» сменилась на «принято»");
  await shot(hp, "принято-ведущий");
  await noSideScroll(hp, "Ведущий, карточка");

  // 3. Владелец видит «Принято».
  const ap = await newPage(browser, admin.token, "Владелец");
  await ap.goto(`${BASE}/studio/calendar?tab=events`);
  const ownerCard = ap.locator(`[data-event-card="${id}"]`);
  await until(async () => (await ownerCard.count()) === 1, WAIT, "мероприятие у владельца");
  check(((await ownerCard.textContent()) ?? "").includes("Принято"), "Владелец: у мероприятия «🟢 Принято»", `Владелец: ${((await ownerCard.textContent()) ?? "").replace(/\s+/g, " ").slice(0, 160)}`);
  await shot(ap, "владелец-принято");

  // 4. Владелец меняет время — отметка снимается, ведущему «✏️ Мероприятие изменено», с главной студии — снова карточка с «Принял».
  const edited = await api("POST", "/api/events", admin.cookie, { ...base, start: 1200, end: 1410 });
  check(edited.status === 200 && !edited.data?.acceptedAt, "Владелец: поменял время — отметка «принял» снята", `Правка: ${edited.status} ${JSON.stringify(edited.data).slice(0, 160)}`);
  await hp.goto(`${BASE}/studio`);
  const second = await bellToCard(hp, id, "Мероприятие изменено", "из-студии");
  await second.accept.click();
  await until(async () => ((await api("GET", `/api/events?from=${DAY}&to=${DAY}`, admin.cookie)).data?.events ?? []).some((e) => e.id === id && e.acceptedAt), WAIT, "повторная отметка «Принял»");
  ok("Ведущий: после изменения принял снова из колокольчика");

  // 5. «Мой календарь» → день → «Открыть мероприятие →».
  await hp.goto(`${BASE}/studio/calendar?tab=mine`);
  for (let i = 0; i < 3; i++) {
    if ((await hp.locator(".cal-month__title").first().textContent())?.trim() === monthTitle(DAY)) break;
    await hp.getByRole("button", { name: "Следующий месяц" }).first().click();
    await hp.waitForTimeout(400);
  }
  await hp.getByRole("button", { name: dayTitle(DAY), exact: true }).click();
  const link = hp.getByRole("link", { name: "Открыть мероприятие →" });
  await until(async () => (await link.count()) === 1, WAIT, "«Открыть мероприятие →»");
  await shot(hp, "мой-календарь-открыть");
  await link.click();
  const card3 = hp.locator(`[data-event-card="${id}"]`);
  await until(async () => (await card3.count()) === 1 && (await card3.evaluate((el) => el.classList.contains("is-open"))), WAIT, "карточка из «Моего календаря»");
  ok("Мой календарь: «Открыть мероприятие →» ведёт к раскрытой карточке");

  // 6. Ссылка из Telegram (тот же адрес) на ноутбуке; и на мероприятие, которого нет.
  const lp = await newPage(browser, host.token, "Ведущий-ноутбук", LAPTOP);
  await lp.goto(`${BASE}/studio/calendar?tab=events&event=${id}`);
  const card4 = lp.locator(`[data-event-card="${id}"]`);
  await until(async () => (await card4.count()) === 1 && (await card4.evaluate((el) => el.classList.contains("is-open"))), WAIT, "карточка по ссылке на ноутбуке");
  ok("Ссылка из Telegram (ноутбук): открывает раскрытую карточку");
  await shot(lp, "ноутбук-ссылка");
  await lp.goto(`${BASE}/studio/calendar?tab=events&event=e2e-nope`);
  await until(async () => ((await lp.locator("body").textContent()) ?? "").includes("Этого мероприятия уже нет"), WAIT, "сообщение о пропавшем мероприятии");
  ok("Ссылка на удалённое мероприятие — «Этого мероприятия уже нет»");

  // 7. Отменённое: ведущему «✖️ Мероприятие отменено», касание открывает карточку (без «Принял»).
  await api("POST", `/api/events/${id}/cancel`, admin.cookie, {});
  await hp.goto(`${BASE}/studio`);
  await hp.locator(".notice-bell__button").click();
  const cancelItem = hp.locator(".notice-item", { hasText: "Мероприятие отменено" }).first();
  await until(async () => (await cancelItem.count()) > 0, WAIT, "«Мероприятие отменено» в колокольчике");
  await cancelItem.click();
  await until(async () => (await hp.locator(`[data-event-card="${id}"]`).count()) === 1, WAIT, "карточка отменённого");
  check((await hp.locator(`[data-event-card="${id}"]`).getByRole("button", { name: "✅ Принял, готовлюсь" }).count()) === 0, "Отменённое: карточка открывается, кнопки «Принял» нет");
  await api("DELETE", `/api/events/${id}`, admin.cookie);
} catch (e) {
  bad(`Проверка остановилась: ${String(e?.message ?? e).slice(0, 300)}`);
  for (const [who, page] of pages) await shot(page, `ошибка-${who}`).catch(() => undefined);
} finally {
  await browser.close();
}
say(problems.length === 0 ? "Путь ведущего работает: колокольчик → карточка → «Принял, готовлюсь»." : `Замечаний: ${problems.length}`);
for (const line of report) console.log(`::${line.startsWith("❌") ? "error" : "notice"} title=Путь ведущего::${line}`);
process.exit(problems.length === 0 ? 0 : 1);
