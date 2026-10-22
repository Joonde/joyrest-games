// Проверка рабочего места менеджера по продажам на test.games.joy-rest.ru (CLAUDE.md, раздел 3, «Роли доступа
// помощников» → `sales`, «База клиентов», «Статусы и таймер ответа», «Планировщик мероприятий»).
// Владелец (TEST_ADMIN_*) заводит менеджера sales-check@joy-rest.ru (профессия и роль «Менеджер по продажам», новый
// временный пароль при каждом запуске), менеджер работает через API и в настоящем браузере (телефон 390 px):
// клиент вручную, тот же телефон в другом виде, статус одним касанием и таймер ответа, заметка с конфликтом,
// согласие на рассылку «да» (менеджеру нельзя), мероприятие с телефоном клиента → «Клиент», отмена и возврат;
// закрытое менеджеру — выгрузка, «Данные по номеру», «Итоги», «Удалить навсегда», игры; ведущему — «Клиенты».
// Даты — через 45+ дней, всё созданное убирается, менеджер в конце отключается. Снимки — в E2E_SHOTS.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = (process.env.E2E_BASE ?? "https://test.games.joy-rest.ru").replace(/\/$/, "");
const HOST_EMAIL = process.env.LOAD_HOST_EMAIL ?? "";
const HOST_PASSWORD = process.env.LOAD_HOST_PASSWORD ?? "";
const ADMIN_EMAIL = (process.env.TEST_ADMIN_EMAIL ?? "").trim();
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? "";
const SHOTS = process.env.E2E_SHOTS ?? "sales-shots";
const SALES_EMAIL = "sales-check@joy-rest.ru";
const SALES_NAME = "Мария Проверка";
const WAIT = 20_000;

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
    console.log(`::${code === 0 ? "notice" : "error"} title=Проверка менеджера продаж::${text}`);
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

const DAY_MS = 86_400_000;
const moscowToday = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const TODAY = moscowToday();
const DAY = addDays(TODAY, 45);
const RUN = Date.now().toString(36);
const rnd = () => Math.random().toString(36).slice(2, 10);
// Случайный номер в коде 999, чтобы прогоны не мешали друг другу.
const PHONE_DIGITS = `999${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`;
const PHONE_PLUS = `+7 ${PHONE_DIGITS.slice(0, 3)} ${PHONE_DIGITS.slice(3, 6)}-${PHONE_DIGITS.slice(6, 8)}-${PHONE_DIGITS.slice(8)}`;
const PHONE_EIGHT = `8${PHONE_DIGITS}`;
const CLIENT_NAME = `Проверка продаж ${RUN}`;

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

function cookieOf(res) {
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    if (pair.startsWith("__Host-jr_s=")) return { token: pair.slice("__Host-jr_s=".length), cookie: pair };
  }
  return null;
}

async function login(email, password) {
  const { status, res } = await api("POST", "/api/auth/login", "", { email, password });
  if (status !== 200) throw new Error(`вход ${email}: ${status}`);
  const c = cookieOf(res);
  if (!c) throw new Error(`вход ${email}: нет cookie`);
  const me = await api("GET", "/api/auth/me", c.cookie);
  return { ...c, profile: me.data?.profile ?? null };
}

/** Менеджер по продажам: найти или завести, включить, профессия и роль sales, новый временный и свой пароль. */
async function salesManager(admin) {
  const users = await api("GET", "/api/users", admin.cookie);
  let user = (users.data ?? []).find((u) => u.email === SALES_EMAIL);
  let temp = "";
  if (!user) {
    const made = await api("POST", "/api/users", admin.cookie, { email: SALES_EMAIL, name: SALES_NAME, profession: "sales" });
    if (made.status !== 200) throw new Error(`завести менеджера: ${made.status}`);
    user = made.data.account;
    temp = made.data.temporaryPassword;
  }
  const uid = user.uid ?? user.id;
  await api("POST", `/api/users/${uid}/active`, admin.cookie, { active: true });
  await api("POST", `/api/users/${uid}/profession`, admin.cookie, { profession: "sales" });
  const role = await api("POST", `/api/users/${uid}/access`, admin.cookie, { role: "sales" });
  check(role.status === 200, "владелец даёт роль «Менеджер по продажам»", `роль sales не выдалась: ${role.status}`);
  if (!temp) {
    const reset = await api("POST", `/api/users/${uid}/password`, admin.cookie, {});
    if (reset.status !== 200) throw new Error(`временный пароль: ${reset.status}`);
    temp = reset.data.temporaryPassword;
  }
  const first = await login(SALES_EMAIL, temp);
  check(first.profile?.mustChangePassword === true, "временный пароль — платформа просит сменить", "после временного пароля смена не требуется");
  const own = `Sales-${rnd()}-${rnd()}`;
  const changed = await api("POST", "/api/auth/password", first.cookie, { currentPassword: temp, newPassword: own });
  check(changed.status === 200, "менеджер задал свой пароль", `смена пароля: ${changed.status}`);
  const session = await login(SALES_EMAIL, own);
  check(session.profile?.accessRole === "sales", "в профиле роль sales", `роль в профиле: ${session.profile?.accessRole}`);
  return { ...session, uid };
}

async function cleanup(admin) {
  const clients = await api("GET", "/api/clients", admin.cookie);
  for (const c of clients.data?.clients ?? clients.data ?? []) {
    if (typeof c?.name === "string" && c.name.startsWith("Проверка продаж")) await api("POST", `/api/clients/${c.id}/archive`, admin.cookie, {});
  }
  const events = await api("GET", `/api/events?from=${addDays(DAY, -1)}&to=${addDays(DAY, 1)}`, admin.cookie);
  for (const e of events.data?.events ?? []) {
    if (!/проверка продаж/i.test(e.title ?? "")) continue;
    if (!e.cancelled) await api("POST", `/api/events/${e.id}/cancel`, admin.cookie, {});
    await api("DELETE", `/api/events/${e.id}`, admin.cookie);
  }
}

// ---------- браузер ----------

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU" };
let shotN = 0;
async function shot(page, name) {
  shotN += 1;
  await page.screenshot({ path: join(SHOTS, `${String(shotN).padStart(2, "0")}-${name}.png`), fullPage: true });
}

/** Телефон: нет прокрутки вбок, кнопки не меньше 40 px, нет мусора вместо текста. */
async function layout(page, where) {
  const found = await page.evaluate(() => {
    const out = [];
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`прокрутка вбок (${document.documentElement.scrollWidth} > ${window.innerWidth})`);
    for (const el of document.querySelectorAll("main button, main a.btn, main [role=tab]")) {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || st.visibility === "hidden" || el.closest("details:not([open])")) continue;
      if (r.height < 40 && !el.closest(".chips, .meta, .tabs")) out.push(`мелкая кнопка «${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 24)}» ${Math.round(r.height)} px`);
    }
    const text = document.body.innerText;
    for (const junk of ["undefined", "NaN", "[object Object]", "null ₽"]) if (text.includes(junk)) out.push(`на экране «${junk}»`);
    return out.slice(0, 6);
  });
  check(found.length === 0, `${where}: раскладка телефона в порядке`, `${where}: ${found.join("; ")}`);
}

async function browse(session) {
  mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext(PHONE);
  await context.addCookies([{ name: "__Host-jr_s", value: session.token, url: BASE, secure: true, httpOnly: true, sameSite: "Lax" }]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
  page.on("response", (r) => {
    if (r.status() >= 500 && r.url().startsWith(BASE)) errors.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  try {
    await page.goto(`${BASE}/studio`, { waitUntil: "domcontentloaded" });
    const desk = await page.getByRole("heading", { name: "Рабочее место" }).waitFor({ timeout: WAIT }).then(() => true, () => false);
    check(desk, "студия менеджера: «Рабочее место»", "на главной студии нет «Рабочего места»");
    await shot(page, "studio");
    await layout(page, "Студия");
    const games = await page.getByText("Библиотека JoyRest", { exact: true }).count();
    check(games === 0, "менеджеру не показываем библиотеку игр", "менеджер видит «Библиотеку JoyRest»");

    await page.goto(`${BASE}/studio/clients?f=new`, { waitUntil: "domcontentloaded" });
    const card = page.getByText(CLIENT_NAME).first();
    const seen = await card.waitFor({ timeout: WAIT }).then(() => true, () => false);
    check(seen, "«Клиенты» → «Новые»: клиент проверки в списке", "клиента проверки нет в «Новых»");
    await shot(page, "clients-new");
    await layout(page, "Клиенты");
    check((await page.getByText("Выгрузить для рассылки").count()) === 0, "выгрузки у менеджера нет", "менеджер видит «Выгрузить для рассылки»");
    check((await page.getByRole("link", { name: "Данные по номеру" }).count()) === 0, "«Данных по номеру» у менеджера нет", "менеджер видит «Данные по номеру»");
    if (seen) {
      await card.click();
      await page.waitForTimeout(800);
      await shot(page, "client-open");
      await layout(page, "Карточка клиента");
      const timer = await page.getByText(/Ждёт ответа|Ответили за/).count();
      check(timer > 0, "на карточке виден таймер ответа", "на открытой карточке нет таймера ответа");
    }

    await page.goto(`${BASE}/studio/sales-guide`, { waitUntil: "domcontentloaded" });
    const guide = await page.getByText("Путь клиента").first().waitFor({ timeout: WAIT }).then(() => true, () => false);
    check(guide, "«Инструкция менеджера» открывается", "«Инструкция менеджера» не открылась");
    await layout(page, "Инструкция менеджера");

    await page.goto(`${BASE}/studio/calendar?tab=events`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await shot(page, "events");
    await layout(page, "Мероприятия");

    await page.goto(`${BASE}/venues`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await shot(page, "venues");
    const venuesClosed = await page.getByText(/нет доступа|Нет доступа/).count();
    check(venuesClosed === 0, "база площадок открывается менеджеру", "менеджеру закрыта база площадок");
    await layout(page, "База площадок");
  } finally {
    check(errors.length === 0, "в браузере без ошибок страницы и 5xx", `ошибки в браузере: ${[...new Set(errors)].slice(0, 5).join(" · ")}`);
    await browser.close();
  }
}

// ---------- сценарий ----------

let admin;
let sales;
try {
  admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  ok("владелец вошёл");
  await cleanup(admin);
  sales = await salesManager(admin);
  const host = await login(HOST_EMAIL, HOST_PASSWORD);
  const hostId = host.profile?.uid;

  // Клиент вручную
  const clientId = `qa${RUN}`;
  const made = await api("POST", "/api/clients", sales.cookie, { id: clientId, name: CLIENT_NAME, phone: PHONE_PLUS, links: [], status: "new", notes: "", request: "Корпоратив, 40 гостей" });
  check(made.status === 200, "менеджер заводит клиента вручную", `клиент вручную: ${made.status}`);
  check(made.data?.status === "new", "новый клиент — «Новый»", `статус нового клиента: ${made.data?.status}`);
  const dup = await api("POST", "/api/clients", sales.cookie, { id: `qb${RUN}`, name: "Двойник", phone: PHONE_EIGHT, links: [], status: "new", notes: "" });
  check(dup.status === 409 && dup.data?.id === clientId, "тот же телефон через 8… — тот же клиент (409 с его id)", `дубль телефона: ${dup.status} ${JSON.stringify(dup.data)}`);
  const noContact = await api("POST", "/api/clients", sales.cookie, { id: `qc${RUN}`, name: "", phone: "", links: [] });
  check(noContact.status === 400, "клиент без имени, телефона и ссылки не сохраняется", `пустой клиент: ${noContact.status}`);

  // Браузер — пока клиент «Новый» (таймер идёт)
  await browse(sales);

  // Статус одним касанием и таймер
  const work = await api("POST", `/api/clients/${clientId}/status`, sales.cookie, { status: "work" });
  check(work.status === 200 && work.data?.status === "work", "статус «В работе» одним касанием", `статус: ${work.status}`);
  check(typeof work.data?.statusLine === "string" && work.data.statusLine.includes("Мария"), "на карточке видно, кто взял клиента", `statusLine: ${work.data?.statusLine}`);
  check(typeof work.data?.takenMs === "number" || /Ответили|ответ/i.test(JSON.stringify(work.data ?? {})), "таймер ответа остановлен", "после «В работе» нет времени ответа");
  const again = await api("POST", `/api/clients/${clientId}/status`, sales.cookie, { status: "work" });
  check(again.status === 200, "повторное касание того же статуса — без ошибки", `повтор статуса: ${again.status}`);
  const wrongStatus = await api("POST", `/api/clients/${clientId}/status`, sales.cookie, { status: "vip" });
  check(wrongStatus.status === 400, "неизвестный статус отклоняется", `неизвестный статус: ${wrongStatus.status}`);

  // Заметка и конфликт
  const n1 = await api("POST", `/api/clients/${clientId}/notes`, sales.cookie, { notes: "Пришлю цену до 18:00", base: "" });
  check(n1.status === 200 && n1.data?.notes === "Пришлю цену до 18:00", "заметка без формы сохраняется", `заметка: ${n1.status}`);
  const owner = await api("POST", `/api/clients/${clientId}/notes`, admin.cookie, { notes: "Владелец: перезвонить", base: "Пришлю цену до 18:00" });
  check(owner.status === 200, "владелец правит ту же заметку", `заметка владельца: ${owner.status}`);
  const stale = await api("POST", `/api/clients/${clientId}/notes`, sales.cookie, { notes: "Пришлю цену до 19:00", base: "Пришлю цену до 18:00" });
  check(stale.status === 409, "чужая правка заметки — 409, ничего не затёрто", `конфликт заметки: ${stale.status}`);
  const after = await api("GET", `/api/clients/${clientId}`, sales.cookie);
  check(after.data?.notes === "Владелец: перезвонить", "заметка владельца на месте", `заметка после конфликта: ${after.data?.notes}`);

  // Согласие на рассылку
  const base = after.data;
  const consent = await api("POST", "/api/clients", sales.cookie, { id: clientId, name: base.name, phone: base.phone, links: base.links ?? [], status: base.status, notes: base.notes, marketing: "yes", expect: base.updatedAt });
  check(consent.status === 200 && consent.data?.marketing !== "yes", "согласие «да» от менеджера не принимается", `согласие: ${consent.status} ${consent.data?.marketing}`);
  const staleForm = await api("POST", "/api/clients", sales.cookie, { id: clientId, name: "Старое имя", phone: base.phone, links: [], status: base.status, notes: base.notes, expect: base.updatedAt - 5000 });
  check(staleForm.status === 409, "полная форма со старой версией — 409", `старая форма: ${staleForm.status}`);

  // Закрытое менеджеру
  check((await api("GET", "/api/clients/export", sales.cookie)).status === 403, "выгрузка клиентов закрыта (403)", "менеджеру открыта выгрузка клиентов");
  check((await api("GET", `/api/privacy?q=${encodeURIComponent(PHONE_PLUS)}`, sales.cookie)).status === 403, "«Данные по номеру» закрыты (403)", "менеджеру открыты «Данные по номеру»");
  check((await api("GET", `/api/events?stats=1&from=${TODAY}&to=${DAY}`, sales.cookie)).status === 403, "«Итоги» мероприятий закрыты (403)", "менеджеру открыты «Итоги»");
  const gamesList = await api("GET", "/api/games?scope=agency", sales.cookie);
  check(gamesList.status === 403, "игры библиотеки менеджеру закрыты (403)", `игры библиотеки менеджеру: ${gamesList.status}`);
  check((await api("GET", "/api/clients", host.cookie)).status === 403, "ведущему «Клиенты» закрыты (403)", "ведущий видит «Клиентов»");
  check((await api("GET", "/api/notices", sales.cookie)).status === 200, "колокольчик менеджеру открыт", "колокольчик менеджеру закрыт");
  const team = await api("GET", `/api/calendar/team?from=${DAY}&to=${addDays(DAY, 1)}`, sales.cookie);
  check(team.status === 200, "«Кто может» менеджеру открыт", `«Кто может»: ${team.status}`);

  // Мероприятие с телефоном клиента
  const eventId = `qa${RUN}e`;
  const ev = await api("POST", "/api/events", sales.cookie, { id: eventId, hostId, day: DAY, start: 19 * 60, end: 22 * 60, title: "Проверка продаж", clientName: CLIENT_NAME, clientPhone: PHONE_EIGHT, place: "", guests: 40, note: "" });
  check(ev.status === 200 && !ev.data?.clientNotSaved, "менеджер записывает мероприятие", `мероприятие: ${ev.status} ${JSON.stringify(ev.data)?.slice(0, 120)}`);
  const promoted = await api("GET", `/api/clients/${clientId}`, sales.cookie);
  check(promoted.data?.status === "client", "клиент стал «Клиентом» после записи мероприятия", `статус после мероприятия: ${promoted.data?.status}`);
  const stats = await api("GET", "/api/clients", sales.cookie);
  const twins = (stats.data?.clients ?? stats.data ?? []).filter((c) => c?.phoneKey === promoted.data?.phoneKey || c?.phone?.replace(/\D/g, "").endsWith(PHONE_DIGITS));
  check(twins.length === 1, "телефон в форме «8…» не создал второго клиента", `клиентов с этим телефоном: ${twins.length}`);
  const hostView = await api("GET", `/api/events?from=${DAY}&to=${DAY}`, host.cookie);
  check((hostView.data?.events ?? []).some((e) => e.id === eventId), "ведущий видит назначенное мероприятие", "ведущий не видит мероприятие");
  const cancel = await api("POST", `/api/events/${eventId}/cancel`, sales.cookie, {});
  check(cancel.status === 200, "менеджер отменяет мероприятие", `отмена: ${cancel.status}`);
  const restore = await api("POST", `/api/events/${eventId}/restore`, sales.cookie, {});
  check(restore.status === 200, "и возвращает его", `возврат: ${restore.status}`);
  await api("POST", `/api/events/${eventId}/cancel`, sales.cookie, {});
  const del = await api("DELETE", `/api/events/${eventId}`, sales.cookie);
  check(del.status === 403, "«Удалить навсегда» менеджеру закрыто (403)", `удаление мероприятия менеджером: ${del.status}`);
} catch (error) {
  bad(`сбой проверки: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  if (admin) {
    await cleanup(admin).catch(() => undefined);
    if (sales?.uid) await api("POST", `/api/users/${sales.uid}/active`, admin.cookie, { active: false }).catch(() => undefined);
    say("Убрано: клиент проверки в архиве, мероприятие удалено, менеджер отключён.");
  }
}
finish(problems.length === 0 ? 0 : 1);
