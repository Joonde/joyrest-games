// Проверка календаря команды на test.games.joy-rest.ru (CLAUDE.md, раздел 3, «Календарь»): настоящий браузер
// (Playwright, телефон 390 px) под двумя входами — ведущий (load@joy-rest.ru) и владелец (TEST_ADMIN_*).
// Ведущий отмечает свободное и занятое время (весь день, часы, за полночь, повтор по неделям), убирает отметку;
// владелец видит «Может / Свободен частично / Не отметил / Занят», закрепляет время за ведущим, ведущий видит
// мероприятие и не может его снять, владелец снимает. Планировщик: мероприятие с клиентом и телефоном, день по
// часам, 7 дней, месяц, списки, отмена и удаление; ведущий видит свои мероприятия без правки. Права проверяются и через API. Даты — через 40+ дней
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
    // Без тела — без Content-Type (иначе сервер отвечает 400 «пустое тело»).
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), "X-JoyRest": "1", Origin: BASE, Cookie: cookie },
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
  // Клиенты проверки — в архив (из базы клиентов ничего не стирается).
  const clients = await api("GET", "/api/clients", admin.cookie);
  for (const c of clients.data?.clients ?? []) {
    if (/Проверка/.test(c.name)) await api("POST", `/api/clients/${c.id}/archive`, admin.cookie, {});
  }
  // Мероприятия проверки: отменить и удалить навсегда.
  const events = await api("GET", `/api/events?from=${TODAY}&to=${D3}`, admin.cookie);
  for (const e of events.data?.events ?? []) {
    if (!/проверка/.test(e.title)) continue;
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
  await fits(page, name);
}

/** Текст не вылезает за кнопки, вкладки и плашки; кнопки не наезжают друг на друга. */
async function fits(page, where) {
  const found = await page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      // Содержимое свёрнутого <details> скрыто, хотя Chrome отдаёт ему координаты.
      const folded = el.closest("details:not([open])") && !el.closest("summary");
      return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none" && !folded;
    };
    const label = (el) => (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().replace(/\s+/g, " ").slice(0, 28);
    const controls = [...document.querySelectorAll("main button, main a.btn, main [role=tab], main .status-pill, main select, main input:not([type=hidden]):not([type=radio]):not([type=checkbox])")].filter(visible);
    const clipped = controls
      .filter((el) => !["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName))
      .filter((el) => getComputedStyle(el).textOverflow !== "ellipsis" && getComputedStyle(el).overflowX === "visible")
      .filter((el) => el.scrollWidth > el.clientWidth + 2)
      .map(label);
    const overlaps = [];
    const boxes = controls.filter((el) => el.tagName !== "SPAN");
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i].getBoundingClientRect();
      for (let j = i + 1; j < boxes.length; j++) {
        if (boxes[i].contains(boxes[j]) || boxes[j].contains(boxes[i])) continue;
        // Плашки таймлайна стоят на сетке часов по задумке; сравниваем их только между собой.
        const b = boxes[j].getBoundingClientRect();
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 3 && h > 3) overlaps.push(`${label(boxes[i])} × ${label(boxes[j])}`);
      }
    }
    return { clipped: [...new Set(clipped)].slice(0, 6), overlaps: [...new Set(overlaps)].slice(0, 6) };
  });
  if (found.clipped.length) bad(`${where}: текст не помещается: ${found.clipped.join(", ")}`);
  if (found.overlaps.length) bad(`${where}: наезжают: ${found.overlaps.join("; ")}`);
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
  pages.push([who, page]);
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
const pages = [];
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
  const noteInput = hp.getByLabel(/Заметка/);
  await noteInput.click();
  await noteInput.fill("Своё мероприятие (проверка)");
  const typed = await noteInput.inputValue();
  check(typed === "Своё мероприятие (проверка)", "Ведущий: заметка набрана в поле", `Ведущий: в поле заметки «${typed}»`);
  await hp.getByRole("button", { name: /^Добавить:/ }).click();
  await until(async () => (await entryTexts(hp)).some((t) => t.includes("Занят") && t.includes("12:00–14:00")), WAIT, "запись «занят 12–14»");
  ok("Ведущий: «Занят 12:00–14:00» — запись появилась");
  const busySaved = ((await api("GET", `/api/calendar?from=${D1}&to=${D1}`, host.cookie)).data?.entries ?? []).find((e) => e.kind === "busy");
  check(busySaved?.note === "Своё мероприятие (проверка)", "Ведущий: заметка сохранилась на сервере", `Ведущий: на сервере заметка «${busySaved?.note ?? "нет записи"}»`);
  check((await entryTexts(hp)).some((t) => t.includes("Своё мероприятие (проверка)")), "Ведущий: заметка видна в списке дня", "Ведущий: заметки нет в списке дня");
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
  ok("Владелец: вкладки «Кто может», «Мероприятия» и «Мой календарь»");
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

  // Закрепить время за ведущим — форма мероприятия (клиент, телефон, что за мероприятие).
  const { row } = await statusOf(ap, hostName);
  await row.getByRole("button", { name: /Закрепить это время/ }).click();
  const hostRadio = row.getByRole("radio", { name: new RegExp(hostName) });
  await until(async () => (await hostRadio.count()) > 0, WAIT, "ведущие в форме").catch(() => undefined);
  check((await hostRadio.isChecked().catch(() => false)) === true, "Владелец: в форме уже выбран этот ведущий", "Владелец: в форме ведущий не выбран");
  const hostOption = ((await row.locator("label.plan-host", { hasText: hostName }).first().textContent()) ?? "").replace(/\s+/g, " ");
  check(hostOption.includes("Может"), "Владелец: у ведущего в форме — «Может»", `Владелец: в форме у ведущего «${hostOption}»`);
  await row.locator('input[list="event-titles"]').fill("Корпоратив, проверка");
  await row.getByLabel("Клиент — имя").fill("Клиент Проверка");
  await row.getByLabel("Телефон клиента").fill("+7 900 000-00-00");
  await row.getByLabel("Гостей (точное число)").fill("45");
  await row.getByLabel("Комментарий ведущему (пожелания, особенности)").fill("Квиз и танцы, проверка");
  await shot(ap, "владелец-форма-мероприятия");
  await noSideScroll(ap, "Владелец, форма в «Кто может»");
  await row.locator("summary", { hasText: "Заполнить из заявки" }).click();
  await noSideScroll(ap, "Владелец, форма в «Кто может», «Заполнить из заявки» открыто");
  await row.locator("summary", { hasText: "Заполнить из заявки" }).click();
  await row.getByRole("button", { name: "Записать мероприятие" }).click();
  await expectStatus(ap, hostName, "Занят", "Владелец: после «Записать мероприятие» ведущий занят");
  const booked = await statusOf(ap, hostName);
  check(booked.text.includes("Мероприятие JoyRest") && booked.text.includes("Корпоратив, проверка, 45 гостей"), "Владелец: в строке «Мероприятие JoyRest» и что за мероприятие", `Владелец: в строке «${booked.text.slice(0, 120)}»`);
  await shot(ap, "владелец-закрепил");
  const saved = ((await api("GET", `/api/events?from=${D1}&to=${D1}`, admin.cookie)).data?.events ?? []).find((e) => e.title === "Корпоратив, проверка");
  check(
    saved?.clientName === "Клиент Проверка" && saved?.clientPhone === "+7 900 000-00-00" && saved?.guests === 45 && saved?.hostName === hostName && saved?.start === 1080 && saved?.end === 1380,
    "API: сохранено с клиентом, телефоном, гостями, ведущим и временем 18:00–23:00",
    `API: сохранено ${JSON.stringify(saved ?? null).slice(0, 200)}`,
  );
  check(!booked.text.includes("Клиент Проверка"), "Владелец: в календаре ведущего имени клиента нет (только в мероприятии)");

  // Ведущий видит мероприятие в календаре и не может его снять.
  await hp.goto(`${BASE}/studio/calendar?tab=mine`);
  await until(async () => (await hp.locator(".cal-grid").count()) > 0, WAIT, "сетка после перезагрузки");
  await openDay(hp, D1);
  const t1 = await entryTexts(hp);
  check(t1.some((t) => t.includes("Мероприятие JoyRest") && t.includes("Закрепил владелец")), "Ведущий: видит «Мероприятие JoyRest — Закрепил владелец»", `Ведущий: записи дня — ${t1.join(" | ").slice(0, 160)}`);
  const removeBooked = await hp.locator(".cal-entry").filter({ hasText: "Мероприятие JoyRest" }).getByRole("button", { name: "Убрать" }).count();
  check(removeBooked === 0, "Ведущий: у мероприятия нет кнопки «Убрать»", "Ведущий может убрать мероприятие владельца");
  const bookedEntry = ((await api("GET", `/api/calendar?from=${D1}&to=${D1}`, host.cookie)).data?.entries ?? []).find((e) => e.kind === "booked");
  check(bookedEntry && (await api("DELETE", `/api/calendar/${bookedEntry.id}`, host.cookie)).status === 403, "API: ведущий не может удалить мероприятие (403)");
  check((await api("POST", "/api/events", host.cookie, { id: "e2eev0", hostId: host.profile.uid, day: D1, start: 600, end: 700, title: "проверка" })).status === 403, "API: ведущий не может записывать мероприятия (403)");
  await shot(hp, "ведущий-видит-мероприятие");

  // ===== Владелец: вкладка «Мероприятия» — день по часам, 7 дней, месяц, списки =====
  await ap.goto(`${BASE}/studio/calendar?tab=events`);
  await until(async () => (await ap.locator(".plan-timeline").count()) > 0, WAIT, "таймлайн дня");
  ok("Владелец: вкладка «Мероприятия» открывается днём по часам");
  await ap.locator('input[type="date"]').fill(D1);
  const evBlock = ap.locator(".plan-event", { hasText: "Корпоратив, проверка" });
  await until(async () => (await evBlock.count()) === 1, WAIT, "мероприятие на таймлайне");
  const blockText = ((await evBlock.textContent()) ?? "").replace(/\s+/g, " ");
  check(blockText.includes("18:00–23:00") && blockText.includes(`Ведёт: ${hostName}`), "Владелец: на таймлайне — время и кто ведёт", `Владелец: на плашке «${blockText}»`);
  // Плашка стоит на сетке часов там, где её время: верх — на линии 18:00.
  const geo = await ap.evaluate(() => {
    const block = document.querySelector(".plan-event")?.getBoundingClientRect();
    const hour = [...document.querySelectorAll(".plan-hour")].find((h) => h.textContent?.trim() === "18:00")?.getBoundingClientRect();
    return block && hour ? Math.abs(block.top - hour.top) : -1;
  });
  check(geo >= 0 && geo <= 3, "Владелец: плашка начинается ровно на линии 18:00", `Владелец: плашка смещена от 18:00 на ${geo}px`);
  await evBlock.click();
  const card = ap.locator(".plan-card").first();
  await card.waitFor({ timeout: WAIT });
  const cardText = ((await card.textContent()) ?? "").replace(/\s+/g, " ");
  check(cardText.includes("Клиент Проверка") && cardText.includes("+7 900 000-00-00") && cardText.includes("Квиз и танцы") && cardText.includes("Предстоит"), "Владелец: касание плашки — карточка раскрыта: клиент, телефон, комментарий, «Предстоит»", `Владелец: карточка «${cardText.slice(0, 160)}»`);
  await shot(ap, "владелец-день-по-часам");
  await noSideScroll(ap, "Владелец, день по часам");

  // Второе мероприятие в то же время — предупреждение «занято» и две колонки на таймлайне.
  await ap.getByRole("button", { name: "+ Мероприятие в этот день" }).click();
  await ap.getByRole("button", { name: "19:00–00:00", exact: true }).click();
  await ap.getByRole("button", { name: "3 ч", exact: true }).click();
  const busyRadio = ap.getByRole("radio", { name: new RegExp(hostName) });
  await until(async () => /Занят/.test((await ap.locator("label.plan-host", { hasText: hostName }).first().textContent()) ?? ""), WAIT, "ведущий занят в списке");
  await busyRadio.check();
  check((await ap.locator(".plan-warn").count()) === 1, "Владелец: форма предупреждает, что у ведущего время занято");
  await ap.getByRole("button", { name: "Корпоратив", exact: true }).click();
  await ap.locator('input[list="event-titles"]').fill("Квиз-вечер, проверка");
  await ap.getByRole("button", { name: "Записать мероприятие" }).click();
  await until(async () => (await ap.locator(".plan-event").count()) === 2, WAIT, "два мероприятия на таймлайне");
  const quizSaved = ((await api("GET", `/api/events?from=${D1}&to=${D1}`, admin.cookie)).data?.events ?? []).find((e) => e.title === "Квиз-вечер, проверка");
  check(quizSaved?.start === 1140 && quizSaved?.end === 1320, "Владелец: «19:00–00:00» и «3 ч» — сохранилось 19:00–22:00", `API: время ${quizSaved?.start}–${quizSaved?.end}`);
  const widths = await ap.locator(".plan-event").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
  const lanesW = await ap.locator(".plan-lanes").evaluate((el) => el.getBoundingClientRect().width);
  check(widths.every((w) => w < lanesW * 0.6), "Владелец: два пересекающихся — в две колонки", `Владелец: ширины ${widths.map(Math.round).join(", ")} из ${Math.round(lanesW)}`);
  await shot(ap, "владелец-два-мероприятия");

  // Пять и больше в одно время: на телефоне — одна плашка «Одновременно: N», касание — все карточки.
  for (let i = 1; i <= 4; i++) {
    await api("POST", "/api/events", admin.cookie, { id: `e2emany${i}${Date.now() % 100000}`, hostId: host.profile.uid, day: D1, start: 1080 + i * 15, end: 1380, title: `Банкет ${i}, проверка` });
  }
  await ap.reload();
  await until(async () => (await ap.locator(".plan-timeline").count()) > 0, WAIT, "таймлайн после перезагрузки");
  await ap.locator('input[type="date"]').fill(D1);
  const group = ap.locator(".plan-event--group");
  await until(async () => (await group.count()) === 1, WAIT, "общая плашка одновременных");
  const groupText = ((await group.textContent()) ?? "").replace(/\s+/g, " ");
  check(groupText.includes("Одновременно: 6 мероприятий"), "Владелец: 6 мероприятий в одно время — одна читаемая плашка «Одновременно: 6»", `Владелец: плашка «${groupText.slice(0, 120)}»`);
  check((await ap.locator(".plan-event:not(.plan-event--group)").count()) === 0, "Владелец: узкие колонки по 1/6 ширины не рисуются");
  await group.click();
  await until(async () => (await ap.locator(".plan-card").count()) === 6, WAIT, "6 карточек под таймлайном");
  ok("Владелец: касание общей плашки — все 6 мероприятий карточками");
  await shot(ap, "владелец-шесть-сразу");

  // 7 дней и месяц.
  await ap.getByRole("button", { name: "7 дней", exact: true }).click();
  await until(async () => (await ap.locator(".plan-chip", { hasText: "Корпоратив, проверка" }).count()) === 1, WAIT, "мероприятие в 7 днях");
  ok("Владелец: «7 дней» — мероприятие в своём дне");
  await shot(ap, "владелец-7-дней");
  await noSideScroll(ap, "Владелец, 7 дней");
  await ap.getByRole("button", { name: "Месяц", exact: true }).click();
  const n = Number((await ap.locator(`.cal-grid button[aria-label="${dayTitle(D1)}"] .cal-count`).textContent())?.trim() || "0");
  check(n === 6, "Владелец: в месяце у дня — 6 мероприятий", `Владелец: в месяце у дня ${n}`);
  await shot(ap, "владелец-месяц");

  // Списком: карточки свёрнуты; поиск; отменить квиз → отменённые → удалить навсегда.
  await ap.getByRole("button", { name: "Список", exact: true }).click();
  const quizCard = ap.locator(".plan-card", { hasText: "Квиз-вечер, проверка" });
  await until(async () => (await quizCard.count()) === 1, WAIT, "квиз в «Предстоящих»");
  const collapsed = ((await quizCard.textContent()) ?? "").replace(/\s+/g, " ");
  check(collapsed.includes("19:00–22:00") && collapsed.includes(`Ведёт: ${hostName}`) && collapsed.includes("Подробнее") && (await quizCard.getByRole("button", { name: "Изменить" }).count()) === 0, "Владелец: в списке карточка свёрнута — что, когда, кто ведёт", `Владелец: свёрнутая карточка «${collapsed.slice(0, 140)}»`);
  await ap.getByRole("combobox", { name: "Поиск" }).fill("Клиент Проверка");
  await until(async () => (await ap.locator(".plan-card").count()) === 1, WAIT, "поиск по клиенту");
  ok("Владелец: поиск по имени клиента оставляет одно мероприятие");
  await ap.getByRole("combobox", { name: "Поиск" }).fill("");
  await shot(ap, "владелец-списки");
  await quizCard.locator(".plan-card__head").click();
  await quizCard.getByRole("button", { name: "Отменить мероприятие" }).click();
  await ap.getByRole("dialog").getByRole("button", { name: "Отменить мероприятие" }).click();
  await until(async () => (await quizCard.count()) === 0, WAIT, "квиз ушёл из «Предстоящих»");
  await ap.getByRole("button", { name: "Отменённые", exact: true }).click();
  await until(async () => (await quizCard.count()) === 1, WAIT, "квиз в «Отменённых»");
  ok("Владелец: отменённое — в «Отменённых»");
  await ap.getByRole("button", { name: "Архив", exact: true }).click();
  await ap.waitForTimeout(800);
  check((await ap.locator(".plan-card", { hasText: "проверка" }).count()) === 0, "Владелец: будущие мероприятия в архив не попадают");
  await ap.getByRole("button", { name: "Отменённые", exact: true }).click();
  await quizCard.locator(".plan-card__head").click();
  await quizCard.getByRole("button", { name: "Удалить навсегда" }).click();
  await ap.getByRole("dialog").getByRole("button", { name: "Удалить навсегда" }).click();
  await until(async () => (await quizCard.count()) === 0, WAIT, "квиз удалён");
  ok("Владелец: «Удалить навсегда» — запись исчезла");

  // Сверка времени: мероприятие, которое идёт прямо сейчас (по московскому времени сервера).
  const nowMin = Math.floor((Date.now() + 3 * 3_600_000) / 60_000) % 1440;
  const nowStart = Math.max(0, Math.floor((nowMin - 60) / 15) * 15);
  const nowEnd = Math.min(1800, Math.ceil((nowMin + 120) / 15) * 15);
  const nowId = `e2enow${Date.now() % 100000}`;
  await api("POST", "/api/events", admin.cookie, { id: nowId, hostId: host.profile.uid, day: TODAY, start: nowStart, end: nowEnd, title: "Сейчас, проверка" });
  await ap.getByRole("button", { name: "Идут сейчас", exact: true }).click();
  const nowCard = ap.locator(".plan-card", { hasText: "Сейчас, проверка" });
  await until(async () => (await nowCard.count()) === 1, WAIT, "мероприятие в «Идут сейчас»").catch(() => undefined);
  const nowText = ((await nowCard.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
  check(nowText.includes("Идёт сейчас"), "Сверка времени: мероприятие на текущий час — в «Идут сейчас» с плашкой «Идёт сейчас»", `Сверка времени: в «Идут сейчас» — «${nowText.slice(0, 100)}»`);
  await ap.getByRole("button", { name: "День", exact: true }).click();
  await ap.locator('input[type="date"]').fill(TODAY);
  await until(async () => (await ap.locator(".plan-now").count()) === 1, WAIT, "линия «сейчас»").catch(() => undefined);
  await until(async () => (await ap.locator(".plan-timeline:not(.is-stale) .plan-event", { hasText: "Сейчас, проверка" }).count()) === 1, WAIT, "мероприятие «сейчас» на таймлайне").catch(() =>
    bad("Сверка времени: мероприятие на сегодня не появилось на таймлайне"),
  );
  const lineOk = await ap.evaluate(() => {
    const line = document.querySelector(".plan-now")?.getBoundingClientRect();
    const block = [...document.querySelectorAll(".plan-event")].find((b) => b.textContent?.includes("Сейчас, проверка"))?.getBoundingClientRect();
    return Boolean(line && block && line.top > block.top && line.top < block.bottom);
  });
  check(lineOk, "Сверка времени: линия «сейчас» проходит через это мероприятие", "Сверка времени: линия «сейчас» не там, где мероприятие");
  await shot(ap, "владелец-сейчас");
  await api("POST", `/api/events/${nowId}/cancel`, admin.cookie, {});
  await api("DELETE", `/api/events/${nowId}`, admin.cookie);

  // Заполнить из текста заявки.
  await ap.getByRole("button", { name: "+ Новое мероприятие" }).click();
  await ap.locator("summary", { hasText: "Заполнить из заявки" }).click();
  await ap.getByLabel("Текст заявки").fill("📩 Заявка с сайта JoyRest\n\nИмя: Софья\nТелефон: +7 915 241-59-99\nТип мероприятия: Корпоратив\nГостей: 25\nКомментарий: Нужен квиз\n15.12 18:00–23:00");
  await ap.getByRole("button", { name: "Заполнить из текста" }).click();
  const filledOk =
    (await ap.getByLabel("Клиент — имя").inputValue()) === "Софья" &&
    (await ap.getByLabel("Телефон клиента").inputValue()) === "+7 915 241-59-99" &&
    (await ap.locator('input[list="event-titles"]').inputValue()) === "Корпоратив" &&
    (await ap.getByLabel("Гостей (точное число)").inputValue()) === "25" &&
    ((await ap.locator(".plan-when").textContent()) ?? "").includes("15 декабря") &&
    ((await ap.locator(".plan-when").textContent()) ?? "").includes("18:00–23:00");
  check(filledOk, "Владелец: «Заполнить из текста» — имя, телефон, вид, гости, дата и время подставились", "Владелец: из текста заявки заполнилось не всё");
  await shot(ap, "владелец-из-текста");
  // С 24 октября 2026 введённое не пропадает: «Закрыть — оставить в черновике», черновик — в списке.
  await ap.getByRole("button", { name: "Закрыть — оставить в черновике" }).click();
  await until(async () => (await ap.locator(".plan-seg--views").count()) === 1, WAIT, "форма закрыта");
  const sofia = ap.locator(".plan-drafts__item", { hasText: "Софья" });
  check((await sofia.count()) === 1, "Владелец: закрыл форму с введённым — оно в «Черновиках мероприятий»");
  await sofia.getByRole("button", { name: "Удалить" }).click();
  await ap.getByRole("dialog").getByRole("button", { name: "Удалить черновик" }).click();
  await until(async () => (await sofia.count()) === 0, WAIT, "черновик удалён");
  ok("Владелец: «Удалить» у черновика — с подтверждением, черновик ушёл");

  // Узкий телефон (360 px): текст в кнопках и вкладках не вылезает.
  await ap.setViewportSize({ width: 360, height: 780 });
  await ap.getByRole("button", { name: "Список", exact: true }).click();
  await ap.waitForTimeout(500);
  await fits(ap, "Владелец, 360 px, списки");
  await ap.getByRole("button", { name: "+ Новое мероприятие" }).click();
  await ap.waitForTimeout(500);
  await fits(ap, "Владелец, 360 px, форма");
  await noSideScroll(ap, "Владелец, 360 px, форма");
  await ap.getByRole("button", { name: "Отмена", exact: true }).click();
  await ap.setViewportSize({ width: 390, height: 844 });

  // Итоги: прошедшее мероприятие → «Не отмечено» → владелец отмечает «Проведено» → гости в итогах.
  const pastDay = addDays(TODAY, -1);
  const pastId = `e2epast${Date.now() % 100000}`;
  await api("POST", "/api/events", admin.cookie, { id: pastId, hostId: host.profile.uid, day: pastDay, start: 600, end: 720, title: "Итоги, проверка", guests: 37 });
  await ap.getByRole("button", { name: "Итоги", exact: true }).click();
  const periodSeg = ap.getByRole("group", { name: "Период" });
  await periodSeg.getByRole("button", { name: "Неделя", exact: true }).click();
  const pastCard = ap.locator(".plan-card", { hasText: "Итоги, проверка" });
  // Вчера может быть в прошлой неделе (понедельник) — листаем назад, пока не найдём.
  for (let i = 0; i < 2 && (await pastCard.count()) === 0; i++) {
    await ap.waitForTimeout(1500);
    if ((await pastCard.count()) === 0) await ap.getByRole("button", { name: "Прошлый период" }).click();
  }
  await until(async () => (await pastCard.count()) === 1, WAIT, "прошедшее в «Отметьте, состоялись ли»");
  ok("Владелец: «Итоги» — прошедшее без отметки в списке «Отметьте, состоялись ли»");
  const tileText = async (title) => Number(((await ap.locator(".plan-tile", { hasText: title }).first().locator(".plan-tile__n").textContent()) ?? "0").trim());
  const heldBefore = await tileText("Проведено");
  const guestsBefore = await tileText("Гостей");
  await pastCard.locator(".plan-card__head").click();
  await pastCard.getByRole("button", { name: "Проведено", exact: true }).click();
  await until(async () => (await tileText("Проведено")) === heldBefore + 1, WAIT, "«Проведено» +1");
  check((await tileText("Гостей")) === guestsBefore + 37, "Владелец: «Проведено» — в итогах +1 мероприятие и +37 гостей (точное число)", `Владелец: гостей ${guestsBefore} → ${await tileText("Гостей")}`);
  check((await ap.locator(".plan-table", { hasText: hostName }).count()) > 0, "Владелец: в итогах — таблица по ведущим");
  await shot(ap, "владелец-итоги");
  await periodSeg.getByRole("button", { name: "Год", exact: true }).click();
  await until(async () => (await ap.locator("#plan-stats").textContent())?.trim() === TODAY.slice(0, 4), WAIT, "итоги за год");
  ok("Владелец: итоги переключаются на год");
  for (const k of ["Месяц", "Квартал"]) await periodSeg.getByRole("button", { name: k, exact: true }).click();
  await fits(ap, "Владелец, итоги за квартал");

  // База клиентов: клиент из мероприятия уже там; выгрузка — только владельцу.
  await ap.goto(`${BASE}/studio/clients`);
  const clientCard = ap.locator(".plan-card", { hasText: "Клиент Проверка" });
  await until(async () => (await clientCard.count()) === 1, WAIT, "клиент из мероприятия в базе");
  ok("Владелец: «Клиенты» — клиент из мероприятия сам попал в базу");
  await clientCard.locator(".plan-card__head").click();
  await until(async () => ((await clientCard.textContent()) ?? "").includes("Мероприятие"), WAIT, "история обращений");
  ok("Владелец: в карточке клиента — история обращений");
  check((await api("GET", "/api/clients", host.cookie)).status === 403, "API: ведущему база клиентов закрыта (403)");
  const csv = await fetch(`${BASE}/api/clients/export?all=1`, { headers: { Cookie: admin.cookie } });
  check(csv.status === 200 && (await csv.text()).includes("Клиент Проверка"), "Владелец: выгрузка таблицы клиентов работает");
  await shot(ap, "владелец-клиенты");
  await noSideScroll(ap, "Владелец, клиенты");
  // Настоящий бот на test: читает ли сообщения (тогда ведущие могут подключиться).
  const health = (await api("GET", "/api/telegram/health", admin.cookie)).data ?? {};
  say(`ℹ️ Бот: ${health.username ? "@" + health.username : "—"}, состояние ${health.state}, подключили Telegram: ${health.linkedPeople}`);
  // Сообщения бота читает одно окружение (TELEGRAM_UPDATES): после переключения основной версии — она, на test «off» — так и задумано.
  if (health.state === "off") say("ℹ️ Telegram: на test бот только отправляет, сообщения читает основная версия (TELEGRAM_UPDATES) — подключение проверяется на основной");
  else check(health.configured === true && health.state === "ok", "Telegram: бот на test на связи — получает сообщения (ведущие могут подключиться)", `Telegram: бот на test — ${JSON.stringify(health)}`);
  const tgButton = ap.getByRole("button", { name: "Подключить Telegram" });
  if ((await tgButton.count()) > 0) {
    await tgButton.click();
    const tgLink = ap.getByRole("link", { name: "Открыть бота в Telegram" });
    await until(async () => (await tgLink.count()) === 1, WAIT, "ссылка на бота");
    check(/^https:\/\/t\.me\/[A-Za-z0-9_]+\?start=[A-Za-z0-9_-]{20,}$/.test((await tgLink.getAttribute("href")) ?? ""), "Telegram: «Подключить» даёт одноразовую ссылку на бота", `Telegram: ссылка ${await tgLink.getAttribute("href")}`);
  } else {
    say(`ℹ️ Telegram: ${((await ap.locator("#tg-connect").locator("..").textContent()) ?? "").replace(/\s+/g, " ").slice(0, 160)}`);
  }
  await api("POST", `/api/events/${pastId}/cancel`, admin.cookie, {});
  await api("DELETE", `/api/events/${pastId}`, admin.cookie);

  // Ведущий: «Мои мероприятия» — видит своё, без правки.
  await hp.goto(`${BASE}/studio/calendar?tab=events`);
  await until(async () => (await hp.getByRole("tab", { name: "Мои мероприятия" }).count()) > 0, WAIT, "вкладка «Мои мероприятия»");
  await hp.locator('input[type="date"]').fill(D1);
  const hostGroup = hp.locator(".plan-event--group");
  await until(async () => (await hostGroup.count()) === 1, WAIT, "мероприятия у ведущего");
  await hostGroup.click();
  const hostCard = hp.locator(".plan-card", { hasText: "Корпоратив, проверка" });
  await hostCard.waitFor({ timeout: WAIT });
  await hostCard.locator(".plan-card__head").click();
  check(((await hostCard.textContent()) ?? "").includes("Клиент Проверка"), "Ведущий: видит своё мероприятие с клиентом");
  check((await hostCard.getByRole("button", { name: "Изменить" }).count()) === 0 && (await hp.getByRole("button", { name: "+ Новое мероприятие" }).count()) === 0, "Ведущий: без «Изменить» и «Новое мероприятие»");
  // «📅 Добавить в календарь телефона»: файл .ics без клиента, с напоминаниями.
  const icsHref = await hostCard.getByRole("link", { name: "📅 Добавить в календарь телефона" }).getAttribute("href");
  const ics = await fetch(BASE + icsHref, { headers: { Cookie: host.cookie } });
  const icsText = (await ics.text()).replace(/\r\n /g, "");
  check(ics.status === 200 && /text\/calendar/.test(ics.headers.get("content-type") ?? ""), "Ведущий: «Добавить в календарь телефона» отдаёт файл календаря");
  check(icsText.includes("SUMMARY:JoyRest: Корпоратив\\, проверка") && icsText.includes("TRIGGER:-P1D") && icsText.includes("TRIGGER:-PT2H"), "Календарь телефона: что за мероприятие и напоминания за день и за 2 часа");
  check(!icsText.includes("Клиент Проверка") && !/\d{3}-\d{2}-\d{2}/.test(icsText.split("DESCRIPTION")[1] ?? ""), "Календарь телефона: имени и телефона клиента нет");
  // Подписка: ссылка, календарь по ней, смена ссылки.
  await hp.getByRole("button", { name: "Подключить календарь телефона" }).click();
  const feedLine = hp.locator(".cal-feed-url");
  await feedLine.waitFor({ timeout: WAIT });
  const feedUrl = ((await feedLine.textContent()) ?? "").trim();
  check((await hp.getByRole("link", { name: "iPhone и Mac: подписаться" }).getAttribute("href")) === feedUrl.replace("https://", "webcal://"), "Подписка: кнопка для iPhone — webcal://");
  const feed1 = await fetch(feedUrl);
  check(feed1.status === 200 && (await feed1.text()).replace(/\r\n /g, "").includes("Корпоратив\\, проверка"), "Подписка: календарь по ссылке открывается без входа и содержит мероприятие");
  await hp.getByRole("button", { name: "Сменить ссылку" }).click();
  await hp.getByRole("dialog").getByRole("button", { name: "Сменить ссылку" }).click();
  await until(async () => ((await feedLine.textContent()) ?? "").trim() !== feedUrl, WAIT, "новая ссылка");
  check((await fetch(feedUrl)).status === 404, "Подписка: после «Сменить ссылку» старая не работает");
  await shot(hp, "ведущий-мои-мероприятия");
  await noSideScroll(hp, "Ведущий, мои мероприятия");

  // Убираем «банкеты», чтобы «Кто может» проверял одно мероприятие.
  for (const e of (await api("GET", `/api/events?from=${D1}&to=${D1}`, admin.cookie)).data?.events ?? []) {
    if (/^Банкет/.test(e.title)) {
      await api("POST", `/api/events/${e.id}/cancel`, admin.cookie, {});
      await api("DELETE", `/api/events/${e.id}`, admin.cookie);
    }
  }

  // Владелец снимает мероприятие в «Кто может» — оно уходит в «Отменённые».
  await ap.goto(`${BASE}/studio/calendar`);
  await until(async () => (await ap.getByRole("tab", { name: "Кто может" }).count()) > 0, WAIT, "вкладка «Кто может»");
  await query(ap, D1, 1080, 1380);
  const { row: row2 } = await statusOf(ap, hostName);
  await row2.getByRole("button", { name: "Снять мероприятие" }).click();
  await ap.getByRole("dialog").getByRole("button", { name: "Снять" }).click();
  await expectStatus(ap, hostName, "Может", "Владелец: после «Снять мероприятие» ведущий снова может");
  const after = ((await api("GET", `/api/events?from=${D1}&to=${D1}`, admin.cookie)).data?.events ?? []).find((e) => e.title === "Корпоратив, проверка");
  check(after?.cancelled === true, "Владелец: снятое мероприятие ушло в «Отменённые»", `API: мероприятие ${JSON.stringify(after ?? null).slice(0, 100)}`);

  // «Вся команда» — список не меньше.
  const before = await ap.locator("li.cal-person").count();
  await ap.getByRole("checkbox", { name: /Вся команда/ }).check();
  await ap.waitForTimeout(300);
  check((await ap.locator("li.cal-person").count()) >= before, "Владелец: «Вся команда» добавляет остальные профессии");

  // ---------- Черновик мероприятия и клиенты из базы (решение владельца 24 октября 2026) ----------
  const draftClientId = `e2e-draft-${Date.now()}`;
  await api("POST", "/api/clients", admin.cookie, { id: draftClientId, name: "Анна Проверка Черновик", phone: "+7 915 000-77-66", status: "client" });
  await ap.goto(`${BASE}/studio/calendar?tab=events`);
  await ap.getByRole("button", { name: "+ Новое мероприятие" }).click();
  await ap.getByLabel("Что за мероприятие").fill("Черновик, проверка");
  const nameField = ap.getByLabel("Клиент — имя");
  await nameField.click();
  const pick = ap.locator(".plan-client-pick__item", { hasText: "Анна Проверка Черновик" });
  await until(async () => (await pick.count()) > 0, WAIT, "свежий «Клиент» под полем имени");
  ok("Форма: при касании имени — свежие «Клиент» из базы");
  await nameField.fill("Проверка Черн");
  await until(async () => (await pick.count()) > 0, WAIT, "клиент по имени");
  await shot(ap, "владелец-клиент-из-базы");
  await pick.first().click();
  check((await nameField.inputValue()) === "Анна Проверка Черновик" && (await ap.getByLabel("Телефон клиента").inputValue()) === "+7 915 000-77-66", "Форма: касание клиента подставило имя и полный телефон");
  await ap.getByLabel("Телефон клиента").fill("");
  await ap.getByLabel("Телефон клиента").pressSequentially("77 66", { delay: 30 });
  await until(async () => (await pick.count()) > 0, WAIT, "клиент по цифрам номера");
  ok("Форма: клиент находится и по цифрам номера");
  await pick.first().click();
  await ap.waitForTimeout(700);
  // Ушли в «Клиенты» и вернулись — черновик на месте.
  await ap.goto(`${BASE}/studio/clients`);
  await ap.waitForTimeout(800);
  await ap.goto(`${BASE}/studio/calendar?tab=events`);
  const drafts = ap.locator(".plan-drafts");
  await drafts.waitFor({ timeout: WAIT });
  check(((await drafts.textContent()) ?? "").includes("Черновик, проверка · Анна Проверка Черновик"), "Черновик: после ухода в «Клиенты» — в «Черновиках мероприятий»");
  await shot(ap, "владелец-черновики");
  await drafts.getByRole("button", { name: "Продолжить" }).first().click();
  check((await ap.getByLabel("Клиент — имя").inputValue()) === "Анна Проверка Черновик" && (await ap.getByLabel("Что за мероприятие").inputValue()) === "Черновик, проверка", "Черновик: «Продолжить» — форма с тем же заполненным");
  await ap.getByRole("button", { name: "Закрыть — оставить в черновике" }).click();
  await drafts.waitFor({ timeout: WAIT });
  ok("Черновик: «Закрыть — оставить в черновике» — он в списке");
  // Черновик виден и в «Кто может», «Продолжить» ведёт в «Мероприятия».
  await ap.goto(`${BASE}/studio/calendar`);
  await drafts.waitFor({ timeout: WAIT });
  await drafts.getByRole("button", { name: "Продолжить" }).first().click();
  await until(async () => (await ap.getByLabel("Клиент — имя").count()) > 0 && (await ap.getByLabel("Клиент — имя").inputValue()) === "Анна Проверка Черновик", WAIT, "черновик из «Кто может»");
  ok("Черновик: «Продолжить» из «Кто может» открывает его в «Мероприятиях»");
  await ap.getByRole("button", { name: "Удалить черновик" }).click();
  await ap.getByRole("dialog").getByRole("button", { name: "Удалить черновик" }).click();
  await ap.waitForTimeout(300);
  check((await ap.locator(".plan-drafts").count()) === 0, "Черновик: «Удалить черновик» — списка больше нет");
  await noSideScroll(ap, "Владелец, черновики");
  // Карточка клиента → «📅 Записать мероприятие ведущему»: имя, телефон, дата, время и гости — уже в форме.
  const d2dots = `${D2.slice(8)}.${D2.slice(5, 7)}.${D2.slice(0, 4)}`;
  await api("POST", "/api/clients", admin.cookie, { id: draftClientId, name: "Анна Проверка Черновик", phone: "+7 915 000-77-66", notes: `Корпоратив ${d2dots}, 30 гостей, с 19:00 до 22:00` });
  await ap.goto(`${BASE}/studio/clients?id=${draftClientId}`);
  const bookBtn = ap.getByRole("button", { name: "📅 Записать мероприятие ведущему" });
  await bookBtn.waitFor({ timeout: WAIT });
  await shot(ap, "владелец-карточка-клиента-записать");
  await bookBtn.click();
  await until(async () => (await ap.getByLabel("Клиент — имя").count()) > 0, WAIT, "форма мероприятия из карточки клиента");
  await until(async () => (await ap.getByLabel("Клиент — имя").inputValue()) === "Анна Проверка Черновик", WAIT, "имя из карточки");
  const fromCard = {
    phone: await ap.getByLabel("Телефон клиента").inputValue(),
    day: await ap.getByLabel("Дата").first().inputValue(),
    title: await ap.getByLabel("Что за мероприятие").inputValue(),
    guests: await ap.getByLabel(/Гостей|гостей/).first().inputValue().catch(() => ""),
    filled: (await ap.locator(".plan-filled").first().textContent().catch(() => "")) ?? "",
  };
  check(
    fromCard.phone === "+7 915 000-77-66" && fromCard.day === D2 && fromCard.title === "Корпоратив" && fromCard.filled.includes("Из карточки клиента"),
    "Клиент → мероприятие: имя, телефон, дата и повод перенесены из карточки",
    `Клиент → мероприятие: ${JSON.stringify(fromCard)}`,
  );
  await shot(ap, "владелец-мероприятие-из-клиента");
  await ap.getByRole("button", { name: "Удалить черновик" }).click();
  await ap.getByRole("dialog").getByRole("button", { name: "Удалить черновик" }).click();
  await api("POST", `/api/clients/${draftClientId}/archive`, admin.cookie, {});

  // ---------- Светлая и тёмная тема студии (решение владельца 24 октября 2026) ----------
  for (const [label, size] of [["телефон", { width: 390, height: 844 }], ["планшет", { width: 820, height: 1180 }], ["ноутбук", { width: 1440, height: 900 }]]) {
    await ap.setViewportSize(size);
    await ap.goto(`${BASE}/studio`);
    const toLight = ap.getByRole("button", { name: "Светлая тема" });
    await toLight.waitFor({ timeout: WAIT });
    await toLight.click();
    await until(async () => (await ap.evaluate(() => document.documentElement.dataset.theme)) === "joyrest-day", WAIT, "светлая тема");
    await shot(ap, `светлая-студия-${label}`);
    await ap.reload();
    await ap.getByRole("button", { name: "Тёмная тема" }).waitFor({ timeout: WAIT });
    check((await ap.evaluate(() => document.documentElement.dataset.theme)) === "joyrest-day", `Тема (${label}): светлая сохраняется после перезагрузки`);
    for (const [path, name] of [["/studio/calendar?tab=events", "мероприятия"], ["/studio/clients", "клиенты"], ["/studio/team", "команда"]]) {
      await ap.goto(BASE + path);
      await ap.waitForTimeout(1500);
      await shot(ap, `светлая-${name}-${label}`);
      await noSideScroll(ap, `Светлая тема, ${name}, ${label}`);
    }
    await ap.goto(`${BASE}/studio`);
    await ap.getByRole("button", { name: "Тёмная тема" }).click();
    await until(async () => (await ap.evaluate(() => document.documentElement.dataset.theme)) === "joyrest", WAIT, "тёмная тема");
    ok(`Тема (${label}): переключается в светлую и обратно`);
  }
  await ap.setViewportSize(PHONE.viewport);
} catch (e) {
  bad(`Проверка остановилась: ${String(e?.message ?? e).slice(0, 300)}`);
  for (const [who, page] of pages) await shot(page, `ошибка-${who}`).catch(() => undefined);
} finally {
  if (host && admin) await cleanup(host, admin).catch(() => undefined);
  await browser.close();
}
say(problems.length === 0 ? "Календарь работает с обеих сторон." : `Замечаний: ${problems.length}`);
finish(problems.length === 0 ? 0 : 1);
