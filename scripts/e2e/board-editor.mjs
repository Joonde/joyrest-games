// Проверка конструктора «Ставки на знания» на test.games.joy-rest.ru (жалоба ведущего 22 октября 2026: «вопросы с текстом и
// картинкой — не отвечает, трек — нормально»). Настоящий браузер (Playwright, телефон 390 px) под входом ведущего
// load@joy-rest.ru: своя игра 4×5, касание клетки (форма видна без прокрутки?), вид клетки (Вопрос, Картинка, Трек, Кот,
// Аукцион), вопрос и ответ по буквам, картинка с телефона, стоимость, название категории, «Готово», другая клетка,
// перезагрузка — после каждого шага сверяется сохранённое на сервере. В конце — ошибки страницы. Игра удаляется.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = (process.env.E2E_BASE ?? "https://test.games.joy-rest.ru").replace(/\/$/, "");
const EMAIL = process.env.LOAD_HOST_EMAIL ?? "";
const PASSWORD = process.env.LOAD_HOST_PASSWORD ?? "";
const SHOTS = process.env.E2E_SHOTS ?? "board-shots";
const WAIT = 15_000;

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
    console.log(`::${code === 0 ? "notice" : "error"} title=Конструктор «Ставки на знания»::${text}`);
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
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), "X-JoyRest": "1", Origin: BASE, Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, res };
}

async function login() {
  const { status, res } = await api("POST", "/api/auth/login", "", { email: EMAIL, password: PASSWORD });
  if (status !== 200) throw new Error(`вход: ${status}`);
  let token = "";
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    if (pair.startsWith("__Host-jr_s=")) token = pair.slice("__Host-jr_s=".length);
  }
  const cookie = `__Host-jr_s=${token}`;
  const me = await api("GET", "/api/auth/me", cookie);
  if (me.data?.profile?.mustChangePassword) await api("POST", "/api/auth/password", cookie, { currentPassword: PASSWORD, newPassword: PASSWORD });
  return { token, cookie, uid: me.data?.user?.uid };
}

const rid = () => Math.random().toString(36).slice(2, 10);
const emptyCell = (col) => ({ id: `c${rid()}`, points: (col + 1) * 100, kind: "question", text: "", answer: "", imageId: null });
const category = (i) => ({ id: `k${rid()}`, title: i === 0 ? "" : `Тема ${i + 1}`, round: 1, cells: Array.from({ length: 5 }, (_, c) => emptyCell(c)) });

async function savedCell(cookie, id, row, col) {
  const { data } = await api("GET", `/api/games/${id}`, cookie);
  const content = data?.game?.content ?? data?.content ?? {};
  const cat = content.categories?.[row];
  return { title: cat?.title ?? null, cell: cat?.cells?.[col] ?? null };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const host = await login();
  ok("Ведущий вошёл");
  const gameId = `e2e${rid()}${rid()}`;
  const created = await api("POST", "/api/games", host.cookie, {
    id: gameId,
    scope: "personal",
    ownerId: host.uid,
    title: "Проверка «Ставки на знания» (робот)",
    mechanic: "board",
    themeId: "joyrest",
    ageRating: "0+",
    playMode: "teams",
    content: { categories: Array.from({ length: 4 }, (_, i) => category(i)), penalty: false, betTime: 30, buzzTime: 15, answerTime: 10, look: "table" },
  });
  if (created.status !== 200 && created.status !== 201) throw new Error(`игра не создалась: ${created.status} ${JSON.stringify(created.data)}`);
  ok("Своя игра «Ставка на знания» 4×5 создана (пустые клетки)");

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU" });
  await context.addCookies([{ name: "__Host-jr_s", value: host.token, url: BASE }]);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message ?? e)));
  page.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && pageErrors.push(m.text()));
  const failedSaves = [];
  page.on("response", (r) => {
    if (r.url().includes(`/api/games/${gameId}`) && r.request().method() === "PATCH" && r.status() >= 400) failedSaves.push(`${r.status()}`);
  });
  let shot = 0;
  const snap = async (name) => {
    shot += 1;
    await page.screenshot({ path: join(SHOTS, `${String(shot).padStart(2, "0")}-${name}.png`), fullPage: false });
  };
  const settle = async () => {
    await page.waitForTimeout(900);
    await page.locator(".save-status--saved").first().waitFor({ timeout: WAIT }).catch(() => bad("Статус «сохранены» не появился за 15 с"));
  };
  const cells = (row) => page.locator(".board-editor__row").nth(row).locator(".board-editor__cell");
  const form = page.locator(".board-cell-form");
  const inView = (loc) =>
    loc.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top < window.innerHeight - 40 && r.bottom > 60;
    });

  try {
    await page.goto(`${BASE}/studio/games/${gameId}`);
    await page.locator(".board-editor__grid").waitFor({ timeout: WAIT });
    check((await page.locator(".board-editor__cell").count()) === 20, "Конструктор открылся: 20 клеток");
    await snap("pole");

    // 1. Касание клетки: открывается форма — и её видно сразу, без прокрутки (иначе кажется, что «не отвечает»).
    await cells(0).nth(0).click();
    await form.waitFor({ timeout: 3000 }).then(() => ok("Касание клетки открыло форму")).catch(() => bad("Касание клетки: форма не открылась"));
    await page.waitForTimeout(1200);
    check(await inView(form.locator("textarea")), "Форма клетки сразу на экране (поле «Вопрос» видно)", "Форма клетки открылась ниже экрана — ведущий её не видит, кажется, что клетка «не отвечает»");
    await snap("forma");

    // 2. Вид клетки: каждая кнопка нажимается и сохраняется.
    for (const [label, kind] of [
      ["Картинка", "picture"],
      ["Трек", "track"],
      ["Кот в мешке", "cat"],
      ["Аукцион", "auction"],
      ["Вопрос", "question"],
    ]) {
      const btn = form.locator(".seg__btn", { hasText: label }).first();
      if ((await btn.count()) === 0) {
        bad(`Нет кнопки вида «${label}»`);
        continue;
      }
      await btn.click();
      const pressed = await btn.getAttribute("aria-pressed");
      check(pressed === "true", `Вид «${label}» нажался`, `Вид «${label}»: кнопка не нажалась (aria-pressed=${pressed})`);
    }
    await settle();
    let s = await savedCell(host.cookie, gameId, 0, 0);
    check(s.cell?.kind === "question", "На сервере вид клетки — «Вопрос»", `На сервере вид клетки: ${s.cell?.kind}`);

    // 3. Вопрос и ответ по буквам (как на телефоне), с паузами — автосохранение уходит посреди набора.
    const q = "Столица Франции — какой город?";
    const a = "Париж";
    const area = form.locator("textarea");
    await area.click();
    await area.pressSequentially(q.slice(0, 12), { delay: 60 });
    await page.waitForTimeout(1200);
    await area.pressSequentially(q.slice(12), { delay: 60 });
    const answer = form.locator("input:not([type=file]):not([inputmode])").last();
    await answer.click();
    await answer.pressSequentially(a, { delay: 80 });
    check((await area.inputValue()) === q, "Вопрос напечатался целиком", `Вопрос в поле: «${await area.inputValue()}»`);
    check((await answer.inputValue()) === a, "Ответ напечатался целиком", `Ответ в поле: «${await answer.inputValue()}»`);
    await settle();
    s = await savedCell(host.cookie, gameId, 0, 0);
    check(s.cell?.text === q && s.cell?.answer === a, "На сервере вопрос и ответ сохранились", `На сервере: «${s.cell?.text}» / «${s.cell?.answer}»`);
    await snap("vopros");

    // 4. Картинка с телефона: вид «Картинка», файл, сжатие, сохранение.
    await form.locator(".seg__btn", { hasText: "Картинка" }).first().click();
    const png = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 900;
      c.height = 600;
      const g = c.getContext("2d");
      g.fillStyle = "#C49E96";
      g.fillRect(0, 0, 900, 600);
      g.fillStyle = "#221E1B";
      g.font = "bold 120px sans-serif";
      g.fillText("Париж", 200, 340);
      return c.toDataURL("image/png").split(",")[1];
    });
    await form.locator("input[type=file]").first().setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
    await form.locator(".board-cell-form__image").waitFor({ timeout: WAIT }).then(() => ok("Картинка добавилась в клетку")).catch(() => bad("Картинка не появилась в клетке"));
    await settle();
    s = await savedCell(host.cookie, gameId, 0, 0);
    check(s.cell?.kind === "picture" && typeof s.cell?.imageId === "string", "На сервере: клетка «Картинка» с картинкой", `На сервере: вид ${s.cell?.kind}, картинка ${s.cell?.imageId}`);
    // Текст и ответ на месте после смены вида.
    check(s.cell?.text === q && s.cell?.answer === a, "Смена вида не стёрла вопрос и ответ");
    await snap("kartinka");

    // 4а. Когда показать: «По кнопке ведущего»; картинка к ответу.
    await form.locator(".seg__btn", { hasText: "По кнопке ведущего" }).first().click();
    await form.locator("input[type=file]").nth(1).setInputFiles({ name: "answer.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
    await page.waitForFunction(() => document.querySelectorAll(".board-cell-form .board-cell-form__image").length === 2, null, { timeout: WAIT }).then(() => ok("Картинка к ответу добавилась")).catch(() => bad("Картинка к ответу не появилась"));
    await settle();
    s = await savedCell(host.cookie, gameId, 0, 0);
    check(s.cell?.imageShow === "host" && typeof s.cell?.answerImageId === "string", "На сервере: картинка по кнопке ведущего и картинка к ответу", `На сервере: imageShow ${s.cell?.imageShow}, к ответу ${s.cell?.answerImageId}`);
    await snap("kartinka-k-otvetu");

    // 5. Стоимость.
    const points = form.locator("input[inputmode]").first();
    await points.fill("350");
    await points.blur();
    await settle();
    s = await savedCell(host.cookie, gameId, 0, 0);
    check(s.cell?.points === 350, "Стоимость 350 сохранилась", `Стоимость на сервере: ${s.cell?.points}`);

    // 6. «Готово» закрывает форму; название категории печатается.
    await form.getByRole("button", { name: "Готово" }).click();
    check((await form.count()) === 0, "«Готово» закрыло форму");
    const title = page.getByLabel("Название категории 1");
    await title.click();
    await title.pressSequentially("География", { delay: 60 });
    await settle();
    s = await savedCell(host.cookie, gameId, 0, 0);
    check(s.title === "География", "Название категории сохранилось", `Название на сервере: «${s.title}»`);

    // 7. Другая клетка (в конце поля) — форма снова на экране, печатается.
    await cells(3).nth(4).click();
    await form.waitFor({ timeout: 3000 }).catch(() => bad("Вторая клетка: форма не открылась"));
    await page.waitForTimeout(1200);
    check(await inView(form.locator("textarea")), "Вторая клетка: форма на экране", "Вторая клетка: форма ниже экрана");
    await form.locator("textarea").pressSequentially("2 + 2?", { delay: 60 });
    await form.locator("input:not([type=file]):not([inputmode])").last().pressSequentially("4", { delay: 60 });
    await settle();
    s = await savedCell(host.cookie, gameId, 3, 4);
    check(s.cell?.text === "2 + 2?" && s.cell?.answer === "4", "Вторая клетка сохранилась", `Вторая клетка на сервере: «${s.cell?.text}» / «${s.cell?.answer}»`);
    await snap("vtoraya");

    // 8. Перезагрузка: всё на месте.
    await page.reload();
    await page.locator(".board-editor__grid").waitFor({ timeout: WAIT });
    await cells(0).nth(0).click();
    await form.waitFor({ timeout: 3000 }).catch(() => {});
    check((await form.locator("textarea").inputValue()) === q, "После перезагрузки вопрос на месте");
    check((await form.locator(".board-cell-form__image").count()) === 2, "После перезагрузки обе картинки на месте");
    await snap("posle-perezagruzki");

    check(failedSaves.length === 0, "Сервер принял все сохранения", `Сервер отказал в сохранении: ${failedSaves.join(", ")}`);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(!wide, "Конструктор без прокрутки вбок");
    check(pageErrors.length === 0, "Ошибок страницы нет", `Ошибки страницы: ${pageErrors.slice(0, 3).join(" | ")}`);
  } catch (error) {
    bad(`Сценарий прервался: ${String(error?.message ?? error).split("\n")[0]}`);
    await snap("oshibka").catch(() => {});
  } finally {
    await browser.close();
    await sleep(300);
    const del = await api("DELETE", `/api/games/${gameId}`, host.cookie);
    say(del.status < 300 ? "Игра проверки удалена" : `Игру проверки удалить не вышло: ${del.status}`);
  }
}

main()
  .then(() => finish(problems.length === 0 ? 0 : 1))
  .catch((error) => {
    bad(String(error?.message ?? error));
    finish(1);
  });
