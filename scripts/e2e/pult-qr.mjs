// Проверка «QR пульта» (решение владельца 1 ноября 2026): настоящий браузер на test.games.joy-rest.ru.
//   • ноутбук (вошёл ведущий): выбор «Это устройство —», под «Пульт» — QR, он ведёт на /host/<код>;
//   • телефон без входа сканирует (открывает адрес из QR): вход ведущего → сразу пульт этой игры, без выбора устройства;
//   • ноутбук жмёт «Экран зала» — экран зала; «📱 Пульт на телефон» в углу — окно с тем же QR, «Готово» его закрывает;
//   • на телефоне выбор устройства без QR (сканировать нечем).
// Итог — аннотацией в Actions, снимки — в папку E2E_SHOTS. Запуск — workflow «Проверка QR пульта».
// Файл .mjs и вне сборки: Playwright, jsqr и pngjs ставятся только в этом workflow.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import jsQR from "jsqr";
import { PNG } from "pngjs";

const BASE = (process.env.E2E_BASE ?? "https://test.games.joy-rest.ru").replace(/\/$/, "");
const EMAIL = process.env.LOAD_HOST_EMAIL ?? "";
const PASSWORD = process.env.LOAD_HOST_PASSWORD ?? "";
const SHOTS = process.env.E2E_SHOTS ?? "e2e-shots";
const WAIT = 20_000;

const report = [];
const problems = [];
let shotNo = 0;
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
    console.log(`::${code === 0 ? "notice" : "error"} title=QR пульта::${text}`);
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
    { id: "p1", kind: "choice", text: "Какого цвета снег?", options: ["Белый", "Зелёный"], correct: 0, answers: [], timeLimit: 30, points: 100, imageId: null },
  ],
};

async function createSession(token) {
  const id = `pqr${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const { data } = await api("POST", "/api/sessions", `__Host-jr_s=${token}`, {
    id,
    gameTitle: "Проверка QR пульта",
    mechanic: "quiz",
    gameSnapshot: { title: "Проверка QR пульта", mechanic: "quiz", themeId: "joyrest", content: CONTENT },
    themeId: "joyrest",
    playMode: "solo",
    screenMode: "laptop",
  });
  return { id, code: data.code };
}

const LAPTOP = { viewport: { width: 1280, height: 800 }, locale: "ru-RU" };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU" };

function watch(page, who) {
  page.on("pageerror", (error) => bad(`${who}: ошибка на странице — ${String(error.message).slice(0, 160)}`));
}

async function shot(page, name) {
  shotNo += 1;
  await page.screenshot({ path: join(SHOTS, `${String(shotNo).padStart(2, "0")}-${name}.png`) }).catch(() => undefined);
}

/** Что зашито в QR на странице: снимок элемента → распознавание (как камера телефона). */
async function readQr(locator) {
  const png = PNG.sync.read(await locator.screenshot());
  const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return code?.data ?? null;
}

mkdirSync(SHOTS, { recursive: true });
let token = "";
let session = null;
const browser = await chromium.launch();
try {
  token = await login();
  session = await createSession(token);
  const pultLink = `${BASE}/host/${session.code}`;
  say(`Игра ${session.code}`);

  // 1. Ноутбук: выбор устройства, QR под «Пульт».
  const laptopContext = await browser.newContext(LAPTOP);
  await laptopContext.addCookies([{ name: "__Host-jr_s", value: token, url: BASE, secure: true, httpOnly: true, sameSite: "Lax" }]);
  const laptop = await laptopContext.newPage();
  watch(laptop, "Ноутбук");
  await laptop.goto(`${BASE}/host/${session.code}?pick=1`);
  await laptop.getByRole("heading", { name: "Это устройство —" }).waitFor({ timeout: WAIT });
  const pickQr = laptop.locator(".role-picker__qr .qr");
  await shot(laptop, "ноутбук-выбор-устройства");
  if (!(await pickQr.isVisible())) bad("Ноутбук: под «Пульт» нет QR-кода");
  else {
    const box = await pickQr.boundingBox();
    const pultTile = await laptop.getByRole("button", { name: "Пульт", exact: true }).boundingBox();
    if (box && pultTile && box.y > pultTile.y + pultTile.height - 1 && Math.abs(box.x + box.width / 2 - (pultTile.x + pultTile.width / 2)) < pultTile.width / 2)
      ok(`Ноутбук: QR под плиткой «Пульт» (${Math.round(box.width)}×${Math.round(box.height)} px)`);
    else bad("Ноутбук: QR не под плиткой «Пульт»");
    const text = await readQr(pickQr);
    if (text === pultLink) ok(`QR распознаётся: ${text}`);
    else bad(`QR распознан как «${text}», ждали ${pultLink}`);
  }
  if (await laptop.getByText("Наведите камеру телефона — он станет пультом").isVisible()) ok("Под QR — подпись «Наведите камеру телефона…»");
  else bad("Нет подписи под QR");

  // 2. Телефон без входа «сканирует» QR: вход ведущего → сразу пульт.
  const phoneContext = await browser.newContext(PHONE);
  const phone = await phoneContext.newPage();
  watch(phone, "Телефон");
  await phone.goto(pultLink);
  await phone.getByLabel("Почта").waitFor({ timeout: WAIT });
  ok("Телефон без входа: открылся вход ведущего");
  await shot(phone, "телефон-вход");
  await phone.getByLabel("Почта").fill(EMAIL);
  await phone.getByLabel("Пароль").fill(PASSWORD);
  await phone.getByRole("button", { name: "Войти" }).click();
  await phone.getByRole("button", { name: /Начать игру/ }).first().waitFor({ timeout: WAIT }).catch(() => undefined);
  await phone.waitForTimeout(1000);
  await shot(phone, "телефон-пульт");
  if (await phone.getByRole("heading", { name: "Это устройство —" }).isVisible()) bad("Телефон: после входа снова спрашивает «Пульт или экран»");
  else if (!phone.url().startsWith(pultLink)) bad(`Телефон: после входа адрес ${phone.url()}`);
  else ok("Телефон: после входа сразу пульт этой игры (без выбора устройства)");
  const startBtn = phone.getByRole("button", { name: /Начать игру/ });
  if (await startBtn.first().isVisible().catch(() => false)) ok("Пульт: видна «Начать игру»");
  else bad("Пульт: не видно «Начать игру»");

  // 3. Ноутбук: «Экран зала», запасная кнопка в углу.
  await laptop.getByRole("button", { name: "Экран зала", exact: true }).click();
  await laptop.waitForURL(`**/screen/${session.code}`, { timeout: WAIT });
  await laptop.waitForTimeout(2000);
  if (await laptop.locator(".pult-qr").isVisible()) bad("Экран зала: окно QR пульта появилось само");
  else ok("Ноутбук: «Экран зала» — экран зала, лишнего окна нет");
  await shot(laptop, "экран-зала");
  await laptop.mouse.move(640, 400);
  const corner = laptop.getByRole("button", { name: "📱 Пульт на телефон" });
  await corner.waitFor({ timeout: WAIT });
  await corner.click();
  const overlayQr = laptop.locator(".pult-qr .qr");
  await overlayQr.waitFor({ timeout: WAIT });
  await shot(laptop, "экран-зала-окно-пульта");
  const overlayText = await readQr(overlayQr);
  if (overlayText === pultLink) ok("Кнопка «📱 Пульт на телефон»: окно с тем же QR");
  else bad(`Окно QR: распознано «${overlayText}»`);
  await laptop.getByRole("button", { name: "Готово — вернуться к экрану" }).click();
  await laptop.locator(".pult-qr").waitFor({ state: "hidden", timeout: WAIT });
  ok("«Готово — вернуться к экрану» закрывает окно");

  // 4. Телефон на выборе устройства: QR не нужен.
  await phone.goto(`${pultLink}?pick=1`);
  await phone.getByRole("heading", { name: "Это устройство —" }).waitFor({ timeout: WAIT });
  await shot(phone, "телефон-выбор-устройства");
  if (await phone.locator(".role-picker__qr").isVisible()) bad("Телефон: на выборе устройства виден QR");
  else ok("Телефон: на выборе устройства QR скрыт");
  const wide = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (wide) bad("Телефон: выбор устройства прокручивается вбок");
} catch (error) {
  bad(`Сбой: ${String(error?.message ?? error).slice(0, 300)}`);
} finally {
  if (session && token) await api("POST", `/api/sessions/${session.id}/finish`, `__Host-jr_s=${token}`, { participantsCount: 0 }).catch(() => undefined);
  await browser.close();
}
finish(problems.length === 0 ? 0 : 1);
