// Проверка календаря команды на test.games.joy-rest.ru (CLAUDE.md, раздел 3, «Календарь»): настоящий браузер
// (Playwright, телефон 390 px) под двумя входами — ведущий (load@joy-rest.ru) и владелец (TEST_ADMIN_*).
// Ведущий отмечает свободное и занятое время (весь день, часы, за полночь, повтор по неделям), убирает отметку;
// владелец видит «Может / Свободен частично / Не отметил / Занят», закрепляет время за ведущим, ведущий видит
// мероприятие и не может его снять, владелец снимает. Права проверяются и через API. Даты — через 40+ дней
// от сегодня, всё созданное в конце убирается. Снимки — в папку E2E_SHOTS (workflow кладёт их в ветку e2e-shots).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = (process.env.E2E_BASE ?? "https://test.games.joy-rest.ru").replace(/\/$/, "");
const HOST_EMAIL = process.env.LOAD_HOST_EMAIL ?? "";
const HOST_PASSWORD = process.env.LOAD_HOST_PASSWORD ?? "";
const ADMIN_EMAIL = (process.env.TEST_ADMIN_EMAIL ?? "").trim();
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? "";
const SHOTS = process.env.E2E_SHOTS ?? "calendar-shots";
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
    console.log(`::${code === 0 ? "notice" : "error"} title=Проверка календаря::${text}`);
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

// ---------- даты ----------

const DAY_MS = 86_400_000;
const moscowToday = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const MONTHS_OF = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
function dayTitle(day) {
  const d = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS_OF[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
const monthTitle = (day) => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;

const TODAY = moscowToday();
const D1 = addDays(TODAY, 40); // весь день свободен + занят днём
const D2 = addDays(TODAY, 41); // свободен вечером за полночь, повтор 4 недели
const D3 = addDays(TODAY, 42); // ничего не отмечено

// ---------- API ----------

async function api(method, path, cookie, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", "X-JoyRest": "1", Origin: BASE, Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, res };
}

async function login(email, password) {
  const { status, res } = await api("POST", "/api/auth/login", "", { email, password });
  if (status !== 200) throw new Error(`вход ${email}: ${status}`);
  let token = "";
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    if (pair.startsWith("__Host-jr_s=")) token = pair.slice("__Host-jr_s=".length);
  }
  const cookie = `__Host-jr_s=${token}`;
  const me = await api("GET", "/api/auth/me", cookie);
  if (me.data?.profile?.mustChangePassword) await api("POST", "/api/auth/password", cookie, { currentPassword: password, newPassword: password });
  return { token, cookie, profile: me.data?.profile };
}

/** Убрать свои записи ведущего и закреплённые владельцем в окне проверки. */
async function cleanup(host, admin) {
  const to = addDays(D2, 7 * 4 + 1);
  const mine = await api("GET", `/api/calendar?from=${D1}&to=${to}`, host.cookie);
  for (const e of mine.data?.entries ?? []) {
    if (e.day < D1) continue;
    await api("DELETE", `/api/calendar/${e.id}`, e.kind === "booked" ? admin.cookie : host.cookie);
  }
}

// ---------- браузер ----------

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU" };
let shotN = 0;
async function shot(page, name) {
  shotN += 1;
  await page.screenshot({ path: join(SHOTS, `${String(shotN).padStart(2, "0")}-${name}.png`), fullPage: true });
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

async function newPage(browser, token, who) {
  const context = await browser.newContext(PHONE);
  await context.addCookies([{ name: "__Host-jr_s", value: token, url: BASE }]);
  const page = await context.newPage();
  page.on("pageerror", (error) => bad(`${who}: ошибка на странице — ${String(error.message).slice(0, 160)}`));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/favicon|ERR_ABORTED|net::|status of 404/.test(msg.text())) bad(`${who}: ошибка в консоли — ${msg.text().slice(0, 160)}`);
  });
  return page;
}

async function noSideScroll(page, where) {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(wide <= 1, `${where}: нет прокрутки вбок`, `${where}: страница шире экрана на ${wide}px`);
}

/** Мой календарь: листаем месяц до нужного дня и касаемся его. */
async function openDay(page, day) {
  const title = monthTitle(day);
  for (let i = 0; i < 6; i++) {
    if ((await page.locator(".cal-month__title").first().textContent())?.trim() === title) break;
    await page.getByRole("button", { name: "Следующий месяц" }).first().click();
    await page.waitForTimeout(400);
  }
  await page.getByRole("button", { name: dayTitle(day), exact: true }).click();
  await until(async () => (await page.locator("#my-day").textContent())?.trim() === dayTitle(day), WAIT, `день ${day}`);
}

const entryTexts = async (page) => (await page.locator(".cal-entry").allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());

/** «Кто может»: дата и время, статус человека. */
async function query(page, day, start, end) {
  await page.locator('input[type="date"]').fill(day);
  await page.getByLabel("С", { exact: true }).selectOption(String(start));
  await page.getByLabel("До", { exact: true }).selectOption(String(end % 1440));
}
async function statusOf(page, name) {
  // Пока грузится другой месяц, список тусклый и старый — ждём свежий.
  await page.locator("ul.cal-people:not(.is-stale)").waitFor({ timeout: WAIT });
  const row = page.locator("li.cal-person", { has: page.locator(".cal-person__name", { hasText: name }) }).first();
  await row.waitFor({ timeout: WAIT });
  return { row, pill: ((await row.locator(".status-pill").first().textContent()) ?? "").trim(), text: ((await row.textContent()) ?? "").replace(/\s+/g, " ") };
}
async function expectStatus(page, name, want, where) {
  let got = "";
  try {
    await until(async () => (got = (await statusOf(page, name)).pill) === want, WAIT, `${name}: ${want}`);
    ok(`${where}: «${want}»`);
  } catch {
    bad(`${where}: ждали «${want}», на экране «${got}»`);
  }
}

// ---------- проверка ----------

mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
let host;
let admin;
try {
  host = await login(HOST_EMAIL, HOST_PASSWORD);
  admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const hostName = host.profile?.name ?? "";
  say(`Ведущий: ${hostName}; даты проверки: ${D1}, ${D2}, ${D3}`);
  await cleanup(host, admin);

  // Права через API.
  check((await api("GET", `/api/calendar/team?from=${D1}&to=${D2}`, host.cookie)).status === 403, "API: ведущему календарь всей команды закрыт (403)");
  check((await api("GET", `/api/calendar?from=${D1}&to=${D2}`, "")).status === 401, "API: без входа календарь закрыт (401)");
  check((await api("POST", "/api/calendar/book", host.cookie, { id: "e2ebook0", uid: host.profile.uid, day: D1, start: 1080, end: 1380 })).status === 403, "API: ведущий не может закреплять время (403)");
  check((await api("POST", "/api/calendar", host.cookie, { id: "e2ebad1", day: D1, start: 1200, end: 1100, kind: "free" })).status === 400, "API: конец раньше начала — отказ (400)");

  // ===== Ведущий: «Мой календарь» =====
  const hp = await newPage(browser, host.token, "Ведущий");
  await hp.goto(`${BASE}/studio/calendar`);
  await hp.getByRole("heading", { name: "Календарь" }).first().waitFor({ timeout: WAIT }).catch(() => undefined);
  await until(async () => (await hp.locator(".cal-grid").count()) > 0, WAIT, "сетка месяца у ведущего");
  check((await hp.getByRole("tab", { name: "Кто может" }).count()) === 0, "Ведущий: вкладки «Кто может» нет — только свой календарь", "Ведущий видит вкладку «Кто может»");
  await shot(hp, "ведущий-мой-календарь");
  await noSideScroll(hp, "Ведущий, мой календарь");

  // День 1: свободен весь день + занят 12:00–14:00.
  await openDay(hp, D1);
  await hp.getByRole("button", { name: "Свободен весь день", exact: true }).click();
  await until(async () => (await entryTexts(hp)).some((t) => t.includes("Свободен") && t.includes("весь день")), WAIT, "запись «весь день»");
  ok("Ведущий: «Свободен весь день» — запись появилась");
  await hp.getByRole("radio", { name: /^Занят/ }).check();
  await hp.getByLabel("С", { exact: true }).selectOption("720");
  await hp.getByLabel("До", { exact: true }).selectOption("840");
  await hp.getByLabel(/Заметка/).fill("Своё мероприятие (проверка)");
  await hp.getByRole("button", { name: /^Добавить:/ }).click();
  await until(async () => (await entryTexts(hp)).some((t) => t.includes("Занят") && t.includes("12:00–14:00")), WAIT, "запись «занят 12–14»");
  ok("Ведущий: «Занят 12:00–14:00» с заметкой — запись появилась");
  const dots = await hp.locator(`button[aria-label="${dayTitle(D1)}"] .cal-dot`).count();
  check(dots === 2, "Ведущий: на дне две точки — свободен и занят", `Ведущий: точек на дне ${dots}, ждали 2`);
  await shot(hp, "ведущий-день-1");

  // День 2: свободен 20:00–02:00, каждую неделю 4 недели.
  await openDay(hp, D2);
  await hp.getByRole("radio", { name: /^Свободен/ }).check();
  await hp.getByLabel("С", { exact: true }).selectOption("1200");
  await hp.getByLabel("До", { exact: true }).selectOption("120");
  await hp.getByLabel("Повторять").selectOption("4");
  const addLabel = (await hp.getByRole("button", { name: /^Добавить:/ }).textContent()) ?? "";
  check(addLabel.includes("20:00–02:00"), "Ведущий: 20:00 – 02:00 понимается как вечер за полночь", `Ведущий: кнопка «${addLabel.trim()}»`);
  await hp.getByRole("button", { name: /^Добавить:/ }).click();
  await until(async () => (await entryTexts(hp)).some((t) => t.includes("20:00–02:00")), WAIT, "запись за полночь");
  const weekly = (await api("GET", `/api/calendar?from=${D2}&to=${addDays(D2, 21)}`, host.cookie)).data?.entries ?? [];
  const nights = weekly.filter((e) => e.kind === "free" && e.start === 1200 && e.end === 1560);
  check(nights.length === 4, "Ведущий: повтор — 4 вечера по неделям сохранены на сервере", `Ведущий: повтор сохранил ${nights.length} вечеров из 4`);
  // Следующий день показывает хвост вечера.
  await openDay(hp, addDays(D2, 1));
  check((await entryTexts(hp)).some((t) => t.includes("продолжение вечера") && t.includes("02:00")), "Ведущий: на следующем дне виден хвост вечера до 02:00", "Ведущий: хвост вечера на следующем дне не виден");
  await shot(hp, "ведущий-за-полночь");

  // Убрать одну из повторённых отметок.
  const last = addDays(D2, 21);
  await openDay(hp, last);
  await hp.locator(".cal-entry").filter({ hasText: "20:00" }).getByRole("button", { name: "Убрать" }).click();
  await hp.getByRole("dialog").getByRole("button", { name: "Убрать" }).click();
  await until(async () => (await hp.locator(".cal-entry").count()) === 0, WAIT, "отметка убрана");
  ok("Ведущий: «Убрать» с подтверждением — отметка исчезла");

  // ===== Владелец: «Кто может» =====
  const ap = await newPage(browser, admin.token, "Владелец");
  await ap.goto(`${BASE}/studio/calendar`);
  await until(async () => (await ap.getByRole("tab", { name: "Кто может" }).count()) > 0, WAIT, "вкладка «Кто может»");
  ok("Владелец: вкладки «Кто может» и «Мой календарь»");
  await query(ap, D1, 1080, 1380);
  await expectStatus(ap, hostName, "Может", `Владелец, ${D1} 18:00–23:00`);
  await shot(ap, "владелец-может");
  await query(ap, D1, 690, 780);
  await expectStatus(ap, hostName, "Занят", `Владелец, ${D1} 11:30–13:00 (днём занят)`);
  const busyRow = await statusOf(ap, hostName);
  check(busyRow.text.includes("Своё мероприятие (проверка)"), "Владелец: видна заметка ведущего о занятости", "Владелец: заметки о занятости не видно");
  await shot(ap, "владелец-занят");
  await query(ap, D2, 1260, 60);
  await expectStatus(ap, hostName, "Может", `Владелец, ${D2} 21:00–01:00 (за полночь)`);
  await query(ap, D2, 1080, 1380);
  await expectStatus(ap, hostName, "Свободен частично", `Владелец, ${D2} 18:00–23:00 (свободен с 20:00)`);
  const part = await statusOf(ap, hostName);
  check(part.text.includes("20:00–23:00"), "Владелец: показано, с какого часа свободен (20:00–23:00)", `Владелец: в строке «${part.text.slice(0, 120)}»`);
  await query(ap, D3, 1080, 1380);
  await expectStatus(ap, hostName, "Не отметил", `Владелец, ${D3} (ничего не отмечено)`);
  await shot(ap, "владелец-не-отметил");
  await noSideScroll(ap, "Владелец, кто может");

  // Месяц: в дне D1 на 18–23 — хотя бы один свободный (наш ведущий).
  await query(ap, D1, 1080, 1380);
  await expectStatus(ap, hostName, "Может", `Владелец, ${D1} снова`);
  const count = Number((await ap.locator(`.cal-grid button[aria-label="${dayTitle(D1)}"] .cal-count`).textContent())?.trim() || "0");
  check(count >= 1, `Владелец: в месяце у ${D1} число свободных — ${count}`, `Владелец: у ${D1} в месяце 0 свободных`);

  // Закрепить время за ведущим.
  const { row } = await statusOf(ap, hostName);
  await row.getByRole("button", { name: /Закрепить это время/ }).click();
  await row.getByLabel(/Что за мероприятие/).fill("Корпоратив, проверка");
  await row.getByRole("button", { name: "Закрепить время" }).click();
  await expectStatus(ap, hostName, "Занят", "Владелец: после «Закрепить» ведущий занят");
  const booked = await statusOf(ap, hostName);
  check(booked.text.includes("Мероприятие JoyRest") && booked.text.includes("Корпоратив, проверка"), "Владелец: в строке «Мероприятие JoyRest» и заметка", `Владелец: в строке «${booked.text.slice(0, 120)}»`);
  await shot(ap, "владелец-закрепил");

  // Ведущий видит мероприятие и не может его снять.
  await hp.goto(`${BASE}/studio/calendar`);
  await until(async () => (await hp.locator(".cal-grid").count()) > 0, WAIT, "сетка после перезагрузки");
  await openDay(hp, D1);
  const t1 = await entryTexts(hp);
  check(t1.some((t) => t.includes("Мероприятие JoyRest") && t.includes("Закрепил владелец")), "Ведущий: видит «Мероприятие JoyRest — Закрепил владелец»", `Ведущий: записи дня — ${t1.join(" | ").slice(0, 160)}`);
  const removeBooked = await hp.locator(".cal-entry").filter({ hasText: "Мероприятие JoyRest" }).getByRole("button", { name: "Убрать" }).count();
  check(removeBooked === 0, "Ведущий: у мероприятия нет кнопки «Убрать»", "Ведущий может убрать мероприятие владельца");
  const bookedEntry = ((await api("GET", `/api/calendar?from=${D1}&to=${D1}`, host.cookie)).data?.entries ?? []).find((e) => e.kind === "booked");
  check(bookedEntry && (await api("DELETE", `/api/calendar/${bookedEntry.id}`, host.cookie)).status === 403, "API: ведущий не может удалить мероприятие (403)");
  await shot(hp, "ведущий-видит-мероприятие");

  // Владелец снимает мероприятие.
  const { row: row2 } = await statusOf(ap, hostName);
  await row2.getByRole("button", { name: "Снять мероприятие" }).click();
  await ap.getByRole("dialog").getByRole("button", { name: "Снять" }).click();
  await expectStatus(ap, hostName, "Может", "Владелец: после «Снять мероприятие» ведущий снова может");

  // «Вся команда» — список не меньше.
  const before = await ap.locator("li.cal-person").count();
  await ap.getByRole("checkbox", { name: /Вся команда/ }).check();
  await ap.waitForTimeout(300);
  check((await ap.locator("li.cal-person").count()) >= before, "Владелец: «Вся команда» добавляет остальные профессии");
} catch (e) {
  bad(`Проверка остановилась: ${String(e?.message ?? e).slice(0, 300)}`);
} finally {
  if (host && admin) await cleanup(host, admin).catch(() => undefined);
  await browser.close();
}
say(problems.length === 0 ? "Календарь работает с обеих сторон." : `Замечаний: ${problems.length}`);
finish(problems.length === 0 ? 0 : 1);
