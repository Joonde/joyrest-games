// Проверка глазами гостя (CLAUDE.md, раздел 9): настоящий браузер (Chromium, Playwright) проходит
// игру на test.games.joy-rest.ru — вход гостей со смайликом, пульт, экран зала, ответ, финал,
// итоги, режим команд. Проверяет, что имена со смайликом видны везде, что нет ошибок на странице,
// горизонтальной прокрутки на телефоне и слишком мелких кнопок. Итог — аннотацией в Actions
// (в Telegram ничего не шлём — владелец попросил). Запуск — workflow «Проверка гостем».
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

const report = [];
/** Что сейчас делаем и на какой странице: в сообщении об остановке и на снимке. */
let currentStep = "начало";
let currentPage = null;
const step = (name, page) => {
  currentStep = name;
  if (page) currentPage = page;
};
const problems = [];
const shots = [];
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
    const text = report.join("\n").replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, "%0A");
    console.log(`::${code === 0 ? "notice" : "error"} title=Проверка гостем::${text}`);
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

// ---------- API: вход ведущего и сессия ----------

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

const question = (id, text, options, correct) => ({
  id,
  kind: "choice",
  text,
  options,
  correct,
  answers: [],
  timeLimit: 30,
  points: 100,
  imageId: null,
});
const CONTENT = {
  questions: [
    question("e1", "Какого цвета снег?", ["Белый", "Зелёный", "Синий", "Красный"], 0),
    { ...question("e2", "Сколько месяцев в году?", ["10", "12", "14"], 1), round: "Финал" },
  ],
};

async function login() {
  const { res } = await api("POST", "/api/auth/login", "", { email: EMAIL, password: PASSWORD });
  let token = "";
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    if (pair.startsWith("__Host-jr_s=")) token = pair.slice("__Host-jr_s=".length);
  }
  if (!token) throw new Error("вход ведущего: нет cookie");
  // Временный пароль: студия и пульт сначала просят задать свой. Задаём тот же — секрет не меняется.
  const me = await api("GET", "/api/auth/me", `__Host-jr_s=${token}`);
  if (me.data?.profile?.mustChangePassword) {
    await api("POST", "/api/auth/password", `__Host-jr_s=${token}`, { currentPassword: PASSWORD, newPassword: PASSWORD });
    say("Ведущий проверки: временный пароль заменён тем же (студия больше не просит сменить)");
  }
  return token;
}

async function createSession(token, playMode) {
  const id = `e2e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const { data } = await api("POST", "/api/sessions", `__Host-jr_s=${token}`, {
    id,
    gameTitle: `Проверка гостем (${playMode === "teams" ? "команды" : "каждый сам"})`,
    mechanic: "quiz",
    gameSnapshot: { title: "Проверка гостем", mechanic: "quiz", themeId: "joyrest", content: CONTENT },
    themeId: "joyrest",
    playMode,
    screenMode: "laptop",
  });
  return { id, code: data.code };
}

// ---------- Браузер ----------

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU" };
const TV = { viewport: { width: 1280, height: 720 }, locale: "ru-RU" };

function watch(page, who) {
  page.on("pageerror", (error) => bad(`${who}: ошибка на странице — ${String(error.message).slice(0, 160)}`));
  page.on("console", (msg) => {
    // 404 — обычный ответ «ещё нет» (гость ещё не вошёл, ответа на шаг нет): браузер пишет его в консоль сам.
    if (msg.type() === "error" && !/favicon|ERR_ABORTED|net::|status of 404/.test(msg.text())) {
      bad(`${who}: ошибка в консоли — ${msg.text().slice(0, 160)}`);
    }
  });
}

async function shot(page, name, caption) {
  const path = join(SHOTS, `${String(shots.length + 1).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path, fullPage: false });
  shots.push({ path, caption });
}

/** Телефон: нет прокрутки вбок и нет кнопок меньше 44 px. */
async function layoutCheck(page, who) {
  const result = await page.evaluate(() => {
    const doc = document.documentElement;
    const overflow = doc.scrollWidth - doc.clientWidth;
    const small = [...document.querySelectorAll("button, a.btn, input:not([type=radio]):not([type=checkbox]):not([type=hidden]):not(.visually-hidden)")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.height < 44 && getComputedStyle(el).visibility !== "hidden";
      })
      .map((el) => (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30));
    return { overflow, small };
  });
  if (result.overflow > 1) bad(`${who}: страница шире экрана телефона на ${result.overflow} px`);
  if (result.small.length > 0) bad(`${who}: мелкие кнопки (< 44 px): ${[...new Set(result.small)].join(", ")}`);
}

async function expectText(page, locator, text, what) {
  try {
    await locator.filter({ hasText: text }).first().waitFor({ timeout: WAIT });
    ok(`${what}: «${text}»`);
    return true;
  } catch {
    const seen = (await locator.allInnerTexts().catch(() => [])).join(" | ").slice(0, 200);
    bad(`${what}: нет «${text}» (видно: ${seen || "ничего"})`);
    return false;
  }
}

async function guestJoin(browser, code, { name, emoji, teamName, teamEmoji, joinTeam }, who) {
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  watch(page, who);
  step(`${who}: вход`, page);
  await page.goto(`${BASE}/play/${code}`);
  await page.getByRole("heading", { name: "Как вас зовут?" }).waitFor({ timeout: WAIT });
  if (await page.getByText("выключите VPN").count()) ok(`${who}: просьба выключить VPN на входе`);
  else bad(`${who}: нет просьбы выключить VPN на входе`);
  await page.getByLabel("Имя", { exact: true }).fill(name);
  if (joinTeam) {
    await page.getByRole("button", { name: "Обновить список команд" }).click();
    await page.getByLabel(joinTeam).check({ timeout: WAIT });
  } else if (teamName) {
    await page.getByLabel("Название команды").fill(teamName);
  }
  const pick = teamName ? teamEmoji : emoji;
  if (pick !== undefined) {
    await page.getByRole("button", pick === null ? { name: "Без", exact: true } : { name: `Смайлик ${pick}` }).click();
    const expected = pick === null ? (teamName ?? name) : `${pick} ${teamName ?? name}`;
    const preview = await page.locator(".emoji-picker__preview").innerText();
    if (preview.includes(expected)) ok(`${who}: предпросмотр «${preview.trim()}»`);
    else bad(`${who}: предпросмотр «${preview.trim()}», ждали «${expected}»`);
  }
  await layoutCheck(page, `${who} (вход)`);
  await shot(page, `${who}-вход`, `${who}: вход`);
  await page.getByRole("button", { name: "Играть" }).click();
  await page.locator(".play-head__name").waitFor({ timeout: WAIT });
  await layoutCheck(page, `${who} (в игре)`);
  return { context, page };
}

async function clickButton(page, name) {
  await page.getByRole("button", { name, exact: true }).first().click({ timeout: WAIT });
}

async function soloGame(browser, token) {
  say("— Каждый сам за себя —");
  const { id, code } = await createSession(token, "solo");
  const hostContext = await browser.newContext(PHONE);
  await hostContext.addCookies([{ name: "__Host-jr_s", value: token, url: BASE, secure: true, httpOnly: true, sameSite: "Lax" }]);
  const host = await hostContext.newPage();
  watch(host, "Пульт");
  step("пульт открывается", host);
  await host.goto(`${BASE}/host/${code}`);
  await host.getByRole("button", { name: "Начать игру" }).waitFor({ timeout: WAIT });
  await layoutCheck(host, "Пульт");

  const screenContext = await browser.newContext(TV);
  const screen = await screenContext.newPage();
  watch(screen, "Экран зала");
  step("экран зала открывается", screen);
  await screen.goto(`${BASE}/screen/${code}`);
  await screen.getByText("Присоединяйтесь к игре").waitFor({ timeout: WAIT });
  if (await screen.getByText("выключите VPN").count()) ok("Экран зала: просьба выключить VPN у QR");
  else bad("Экран зала: нет просьбы выключить VPN");

  const anna = await guestJoin(browser, code, { name: "Аня", emoji: "🦊" }, "Гость Аня");
  await expectText(anna.page, anna.page.locator(".play-head__name"), "🦊 Аня", "Телефон Ани, шапка");
  const boris = await guestJoin(browser, code, { name: "Борис", emoji: null }, "Гость Борис");
  await expectText(boris.page, boris.page.locator(".play-head__name"), "Борис", "Телефон Бориса, шапка");

  await expectText(screen, screen.locator(".chip"), "🦊 Аня", "Экран зала, список гостей");
  await expectText(host, host.locator("main"), "🦊 Аня", "Пульт, игроки");
  await shot(screen, "экран-лобби", "Экран зала: лобби");
  await shot(host, "пульт-лобби", "Пульт: лобби");

  step("пульт: слайд «Правила» на экране", host);
  await clickButton(host, "Слайды");
  await layoutCheck(host, "Пульт: слайды");
  await clickButton(host, "Правила");
  await clickButton(host, "Показать на экране");
  await expectText(screen, screen.locator(".slide__title"), "Правила игры", "Экран зала, слайд правил");
  await shot(screen, "экран-слайд", "Экран зала: слайд «Правила»");
  await clickButton(host, "Убрать слайд — вернуть игру");
  await screen.locator(".slide").waitFor({ state: "detached", timeout: WAIT });
  ok("Экран зала: слайд убран, игра снова на экране");
  await clickButton(host, "Звуки");
  await layoutCheck(host, "Пульт: звуки");
  await clickButton(host, "Гонг");
  await clickButton(host, "Игра");

  step("пульт: начать игру и показать вопрос", host);
  await clickButton(host, "Начать игру");
  await clickButton(host, "Показать вопрос");
  step("Аня отвечает", anna.page);
  await anna.page.locator(".quiz-phone__option").first().click({ timeout: WAIT });
  await shot(anna.page, "аня-ответ", "Телефон Ани: ответила");
  await shot(screen, "экран-вопрос", "Экран зала: вопрос");
  step("пульт: показать ответ и итоги раунда", host);
  await clickButton(host, "Показать ответ");
  await clickButton(host, "Итоги раунда");
  await expectText(screen, screen.locator(".board-view__title"), "Итоги: Раунд 1", "Экран зала, итоги раунда");
  await expectText(screen, screen.locator(".board-view__name"), "🦊 Аня", "Экран зала, таблица раунда");
  await expectText(screen, screen.locator(".board-view__star"), "★", "Экран зала, лучший в раунде");
  await expectText(anna.page, anna.page.locator(".quiz-phone"), "Лучший в раунде", "Телефон Ани, лучший в раунде");
  await clickButton(host, "Общий счёт");
  await expectText(screen, screen.locator(".board-view__title"), "Общий счёт после раунда 1", "Экран зала, общий счёт");
  await shot(screen, "экран-таблица", "Экран зала: общий счёт");
  step("пульт: второй раунд", host);
  await clickButton(host, "Следующий вопрос");
  await expectText(screen, screen.locator(".quiz-screen__intro"), "Финал", "Экран зала, заставка раунда");
  await expectText(anna.page, anna.page.locator(".quiz-phone"), "Раунд 2: Финал", "Телефон Ани, раунд");
  await clickButton(host, "Начать раунд");
  await anna.page.locator(".quiz-phone__option").nth(1).click({ timeout: WAIT });
  await clickButton(host, "Показать ответ");
  await clickButton(host, "Итоги раунда");
  await clickButton(host, "Общий счёт");
  step("пульт: награждение", host);
  await clickButton(host, "Награждение");
  await expectText(screen, screen.locator(".podium__eyebrow"), "Награждение", "Экран зала, заставка награждения");
  await expectText(anna.page, anna.page.locator(".quiz-phone"), "Награждение", "Телефон Ани, награждение");
  await layoutCheck(host, "Пульт: награждение");
  await clickButton(host, "Показать 1 место");
  await expectText(screen, screen.locator(".podium__slot--1 .podium__name"), "🦊 Аня", "Экран зала, 1 место на пьедестале");
  await expectText(anna.page, anna.page.locator(".quiz-phone__place"), "1", "Телефон Ани, своё место");
  const winnerVisible = await screen
    .locator(".podium__slot--1 .name-emoji")
    .first()
    .evaluate((el) => getComputedStyle(el).color !== "rgba(0, 0, 0, 0)")
    .catch(() => false);
  if (winnerVisible) ok("Экран зала: смайлик победителя не прозрачный");
  else bad("Экран зала: смайлик победителя прозрачный или его нет");
  await shot(screen, "экран-пьедестал", "Экран зала: пьедестал");
  await layoutCheck(anna.page, "Телефон Ани: награждение");
  step("пульт: завершить игру", host);
  await clickButton(host, "Завершить игру");
  await host.getByRole("dialog").getByRole("button", { name: "Завершить игру" }).click({ timeout: WAIT });
  await expectText(screen, screen.locator(".podium--final .podium__name"), "🦊 Аня", "Экран зала, финал: пьедестал");
  await shot(screen, "экран-финал", "Экран зала: финал");
  await shot(anna.page, "аня-финал", "Телефон Ани: финал");

  step("итоги", host);
  await host.getByRole("link", { name: "Открыть итоги" }).click({ timeout: WAIT });
  await expectText(host, host.locator("main"), "🦊 Аня", "Итоги игры");
  await layoutCheck(host, "Итоги");
  await shot(host, "итоги", "Итоги игры на телефоне");
  if (await host.getByRole("link", { name: "В студию" }).count()) ok("Итоги/пульт: есть путь в студию");

  await Promise.all([hostContext.close(), screenContext.close(), anna.context.close(), boris.context.close()]);
  return id;
}

async function teamsGame(browser, token) {
  say("— Команды —");
  const { code } = await createSession(token, "teams");
  const hostContext = await browser.newContext(PHONE);
  await hostContext.addCookies([{ name: "__Host-jr_s", value: token, url: BASE, secure: true, httpOnly: true, sameSite: "Lax" }]);
  const host = await hostContext.newPage();
  watch(host, "Пульт (команды)");
  await host.goto(`${BASE}/host/${code}`);
  await host.getByRole("button", { name: "Начать игру" }).waitFor({ timeout: WAIT });
  const screenContext = await browser.newContext(TV);
  const screen = await screenContext.newPage();
  watch(screen, "Экран зала (команды)");
  await screen.goto(`${BASE}/screen/${code}`);

  const captain = await guestJoin(browser, code, { name: "Капитан", teamName: "Утки", teamEmoji: "🐯" }, "Капитан");
  await expectText(captain.page, captain.page.locator(".play-head__who"), "🐯 Утки", "Телефон капитана, команда");
  const member = await guestJoin(browser, code, { name: "Игрок", joinTeam: "🐯 Утки" }, "Игрок команды");
  await expectText(member.page, member.page.locator(".play-head__who"), "🐯 Утки", "Телефон игрока команды, команда");
  await expectText(screen, screen.locator(".chip"), "🐯 Утки", "Экран зала, команды");
  await expectText(host, host.locator("main"), "🐯 Утки", "Пульт, команды");
  await shot(captain.page, "капитан", "Телефон капитана");
  await shot(screen, "экран-команды", "Экран зала: команды");
  await clickButton(host, "Начать игру");
  await clickButton(host, "Завершить игру досрочно").catch(() => undefined);
  await host.getByRole("dialog").getByRole("button", { name: "Завершить игру" }).click({ timeout: 5000 }).catch(() => undefined);
  await Promise.all([hostContext.close(), screenContext.close(), captain.context.close(), member.context.close()]);
}

/** Страницы ведущего: музыка, профиль и команда — без ошибок и прокрутки вбок на телефоне. */
async function studioPages(browser, token) {
  say("— Студия ведущего —");
  const context = await browser.newContext(PHONE);
  await context.addCookies([{ name: "__Host-jr_s", value: token, url: BASE, secure: true, httpOnly: true, sameSite: "Lax" }]);
  const page = await context.newPage();
  watch(page, "Студия");
  for (const [path, text, what] of [
    ["/studio?tab=music", "Загрузить трек", "Студия: музыка"],
    ["/studio/profile", "О себе", "Мой профиль"],
    ["/studio/team", "Ведущие JoyRest", "Команда JoyRest"],
  ]) {
    step(`${what} открывается`, page);
    await page.goto(`${BASE}${path}`);
    await expectText(page, page.locator("main"), text, what);
    await layoutCheck(page, what);
  }
  await context.close();
}

mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
try {
  const token = await login();
  await soloGame(browser, token);
  await teamsGame(browser, token);
  await studioPages(browser, token);
} catch (error) {
  bad(`Проверка остановилась на шаге «${currentStep}»: ${String(error?.message ?? error).split("\n")[0].slice(0, 160)}`);
  if (currentPage) {
    say(`Адрес: ${currentPage.url().replace(BASE, "")}`);
    const text = await currentPage.locator("body").innerText().catch(() => "");
    say(`На странице: ${text.replace(/\s+/g, " ").slice(0, 300)}`);
    await shot(currentPage, "остановка", `Остановка: ${currentStep}`).catch(() => undefined);
  }
} finally {
  await browser.close();
}
say(problems.length === 0 ? "\nИтог: замечаний нет" : `\nИтог: замечаний ${problems.length}`);
finish(problems.length === 0 ? 0 : 1);
