// Проверка пульта, конструктора и предпросмотра «Бубликатора» без сервера (Блок 2d): стенд `bublikator-host.tsx` (сборка —
// build.mjs с ROBOT_ENTRY=scripts/robot/bublikator-host.tsx). На телефонах 360 и 412 px, планшете 768 и компьютере 1280:
// полный проход игры пультом от лобби до «Завершить игру» на 50 гостях (10 команд) — двойные касания, «Отмена» в окнах
// подтверждения, «Назад — переиграть перелёт», события, звёзды, пауза, перезагрузка страницы пульта посреди игры; маленькие
// экипажи — «Объединить» и «Убрать» гостя без связи; конструктор и предпросмотр. Каждый шаг — снимок и проверки: нет прокрутки
// вбок, ничего не вылезает за край и не наезжает, текст не обрезан, кнопки не меньше 44 px, нет ошибок страницы и мусора.
// Запуск: node scripts/robot/bublikator-host.mjs <папка сборки> <папка снимков>
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const site = path.resolve(process.argv[2] ?? "build/bublikator-host");
const out = path.resolve(process.argv[3] ?? "build/bublikator-host-shots");
const root = path.resolve(import.meta.dirname, "../..");
const pub = path.join(root, "public");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(site, "index.html"),
  `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><link rel="stylesheet" href="/robot.css"></head><body><div id="root"></div><script type="module" src="/robot.js"></script></body></html>`,
);
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webp": "image/webp", ".png": "image/png", ".mp3": "audio/mpeg" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const file = [path.join(site, url === "/" ? "index.html" : url), path.join(pub, url)].find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
  if (!file) return void res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await chromium.launch({ ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ["--no-sandbox"] });

const VIEWPORTS = [
  { name: "360", width: 360, height: 640, mobile: true },
  { name: "412", width: 412, height: 915, mobile: true },
  { name: "768", width: 768, height: 1024, mobile: true },
  { name: "1280", width: 1280, height: 800, mobile: false },
];

/** Проверки раскладки внутри страницы (как у стендов телефона и экрана). */
function inspect(scope) {
  const found = [];
  const vw = window.innerWidth;
  const doc = document.documentElement;
  if (doc.scrollWidth > vw + 1) found.push(`прокрутка вбок: ${doc.scrollWidth} > ${vw}`);
  const rootEl = document.querySelector(scope) ?? document.body;
  const text = rootEl.innerText;
  for (const bad of ["undefined", "NaN", "[object", "null", "Infinity"]) if (text.includes(bad)) found.push(`мусор в тексте: «${bad}»`);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    if (el.closest("details:not([open])") && !el.closest("summary")) return false;
    if (el.closest("dialog:not([open])")) return false;
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none" && Number(st.opacity) > 0;
  };
  const label = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""} «${(el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 40)}»`;
  for (const el of rootEl.querySelectorAll("button, a, select, input:not([type=radio]):not([type=checkbox]), summary, label.choice")) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 44 || r.width < 44) found.push(`маленькая кнопка ${Math.round(r.width)}×${Math.round(r.height)}: ${label(el)}`);
  }
  const leaves = [];
  for (const el of rootEl.querySelectorAll("*")) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) found.push(`за краем экрана: ${label(el)} (${Math.round(r.left)}…${Math.round(r.right)})`);
    const st = getComputedStyle(el);
    const clipX = st.overflowX === "hidden" || st.overflow === "hidden" || st.overflowX === "clip";
    if (clipX && el.scrollWidth > el.clientWidth + 1 && st.textOverflow !== "ellipsis" && el.children.length === 0 && el.tagName !== "TEXTAREA" && el.tagName !== "INPUT") found.push(`текст обрезан: ${label(el)}`);
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== "");
    if (own && !el.closest(".bks, .bkp, .preview-screen, .preview-phone")) leaves.push({ el, r });
  }
  for (let i = 0; i < leaves.length; i += 1) {
    for (let j = i + 1; j < leaves.length; j += 1) {
      const a = leaves[i];
      const b = leaves[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (x > 1 && y > 1) found.push(`надписи наезжают: ${label(a.el)} и ${label(b.el)}`);
    }
  }
  return found;
}

const report = { checked: 0, shots: 0, problems: [] };
function problem(where, text) {
  report.problems.push(`${where}: ${text}`);
  console.log(`  ✗ ${where}: ${text}`);
}

async function openPage(vp, query) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  await page.goto(`http://127.0.0.1:${port}/?${query}`);
  await page.waitForFunction(() => window.standReady === true, null, { timeout: 15_000 });
  return { ctx, page, errors };
}

async function check(page, errors, where, scope = ".bkh") {
  await page.waitForTimeout(80);
  const found = await page.evaluate(inspect, scope);
  report.checked += 1;
  for (const f of new Set(found)) problem(where, f);
  for (const e of errors.splice(0)) problem(where, `ошибка страницы: ${e}`);
  const file = path.join(out, `${where.replace(/[^\w.-]+/g, "_")}.png`);
  await page.screenshot({ path: file, fullPage: true });
  report.shots += 1;
}

const phase = (page) => page.evaluate(() => window.stand.phase());
const advance = (page, ms) => page.evaluate((x) => window.stand.advance(x), ms);
const tap = async (page, name, opts = {}) => {
  const btn = page.getByRole("button", { name, exact: opts.exact ?? false }).first();
  await btn.scrollIntoViewIfNeeded();
  if (opts.double) await btn.dblclick();
  else await btn.click();
  await page.waitForTimeout(60);
};
const expectPhase = async (page, where, want) => {
  const got = await phase(page);
  if (!got.startsWith(want)) problem(where, `ждали этап ${want}, а ${got}`);
};

/** Полная игра пультом: 50 гостей, 10 команд (экипажей), 3 перелёта, диверсант. */
async function fullGame(vp) {
  const tag = `game-${vp.name}`;
  const { ctx, page, errors } = await openPage(vp, `s=game&guests=50&teams=10&fresh=1`);
  try {
    await page.waitForSelector('.bkh[data-board="lobby"]');
    await check(page, errors, `${tag}-01-lobby`);
    // Двойное касание «Собрать экипажи» — экипажи собираются один раз, отказ второго касания молча.
    await tap(page, "Собрать экипажи", { double: true });
    await page.waitForSelector('.bkh[data-board="crews"]');
    const gathers = (await page.evaluate(() => window.stand.commands())).filter((c) => c.cmd === "gather");
    if (gathers.filter((c) => c.ok).length !== 1) problem(tag, `«Собрать экипажи» выполнено ${gathers.filter((c) => c.ok).length} раз`);
    if (await page.locator(".bkh .error").count()) problem(tag, "после двойного касания — текст ошибки");
    await check(page, errors, `${tag}-02-crews`);
    await tap(page, "Тренировка 30 секунд");
    await expectPhase(page, tag, "drill");
    await advance(page, 3000);
    await check(page, errors, `${tag}-03-drill`);
    await tap(page, "Старт перелёта 1");
    await expectPhase(page, tag, "leg:launch:0");
    await check(page, errors, `${tag}-04-launch`);
    await advance(page, 6000);
    await expectPhase(page, tag, "leg:fly:0");
    // «Медленнее»: сдвиг +2 (из сводки), «Быстрее» возвращает.
    const s0 = await page.evaluate(() => window.stand.shift());
    await tap(page, "Медленнее");
    await page.waitForTimeout(100);
    if ((await page.evaluate(() => window.stand.shift())) !== s0 + 2) problem(tag, "«Медленнее» не прибавило 2 с");
    await tap(page, "Быстрее");
    if ((await page.evaluate(() => window.stand.shift())) !== s0) problem(tag, "«Быстрее» не вернуло");
    await check(page, errors, `${tag}-05-fly`);
    // Событие сейчас — метеоритный дождь, потом «Закончить событие».
    const evOff = !(await page.getByRole("button", { name: "Метеоритный дождь" }).isEnabled().catch(() => false));
    if (!evOff) {
      await tap(page, "Метеоритный дождь");
      if ((await page.evaluate(() => window.stand.event())) !== "meteor") problem(tag, "«Метеоритный дождь» не начался");
      await advance(page, 4000);
      await check(page, errors, `${tag}-06-meteor`);
      await tap(page, "Закончить событие");
      if ((await page.evaluate(() => window.stand.event())) !== null) problem(tag, "событие не закончилось");
    }
    // «Все на палубу!» со своим заданием, звёзды.
    await advance(page, 1000);
    if (await page.getByRole("button", { name: "Все на палубу!" }).isEnabled()) {
      await tap(page, "Все на палубу!");
      await page.getByLabel("Своё задание").fill("Сделайте общее фото с ведущим!");
      await check(page, errors, `${tag}-07-captain-pick`);
      await tap(page, "Начать «Все на палубу!»");
      if ((await page.evaluate(() => window.stand.event())) !== "captain") problem(tag, "«Все на палубу!» не началось");
      await advance(page, 4000);
      const fold = page.locator("details.bkh-fold", { hasText: "Звёзды" }).first();
      if (!(await fold.evaluate((d) => d.open))) await fold.locator("summary").click();
      await page.locator(".bkh-stars").first().getByRole("button", { name: "3★" }).click();
      await page.locator(".bkh-stars").nth(1).getByRole("button", { name: "5★" }).click();
      await check(page, errors, `${tag}-08-stars`);
      await tap(page, "Начислить звёзды");
      if (!(await page.evaluate(() => window.stand.stars())).includes("50")) problem(tag, "звёзды не начислены (5★ = +50)");
      await tap(page, "Закончить событие");
    }
    // Пауза: время стоит, «Продолжить».
    await tap(page, "Пауза");
    if (!(await page.evaluate(() => window.stand.paused()))) problem(tag, "пауза не включилась");
    await check(page, errors, `${tag}-09-paused`);
    await tap(page, "▶ Продолжить");
    if (await page.evaluate(() => window.stand.paused())) problem(tag, "«Продолжить» не сняло паузу");
    // Перезагрузка страницы пульта посреди перелёта: та же игра.
    const before = await phase(page);
    // Перезагрузка — тот же адрес без `fresh` (иначе стенд начнёт новую игру).
    await page.goto(page.url().replace("&fresh=1", ""));
    await page.waitForFunction(() => window.standReady === true);
    await page.waitForSelector(".bkh[data-board]");
    if ((await phase(page)) !== before) problem(tag, `после перезагрузки другой этап: ${await phase(page)} вместо ${before}`);
    if ((await page.locator(".bkh").getAttribute("data-board")) !== "fly") problem(tag, "после перезагрузки пульт не на полёте");
    await check(page, errors, `${tag}-10-reloaded`);
    // До конца перелёта.
    for (let i = 0; i < 40 && (await phase(page)).startsWith("leg:fly"); i += 1) await advance(page, 5000);
    await expectPhase(page, tag, "leg:dock:0");
    await check(page, errors, `${tag}-11-dock`);
    // «Назад — переиграть перелёт»: сначала «Отмена», потом всерьёз.
    await tap(page, "Назад — переиграть перелёт");
    await page.locator("dialog[open]").getByRole("button", { name: "Отмена" }).click();
    await expectPhase(page, tag, "leg:dock:0");
    await tap(page, "Назад — переиграть перелёт");
    await check(page, errors, `${tag}-12-back-confirm`, "dialog[open]");
    await page.locator("dialog[open]").getByRole("button", { name: "Переиграть" }).click();
    await page.waitForTimeout(80);
    // Точка «Назад» — момент перед стартом (у первого перелёта после тренировки — «Экипажи собраны»): снова «Старт».
    await expectPhase(page, tag, "crews");
    await check(page, errors, `${tag}-12b-after-back`);
    await tap(page, "Старт перелёта 1");
    await expectPhase(page, tag, "leg:launch:0");
    for (let leg = 0; leg < 3; leg += 1) {
      for (let i = 0; i < 60 && !(await phase(page)).startsWith("leg:dock") && !(await phase(page)).startsWith("leg:vote"); i += 1) await advance(page, 5000);
      // Голосование откроется само через 10 с «Привала».
      await advance(page, 11_000);
      const p = await phase(page);
      if (p.startsWith("leg:vote")) {
        await check(page, errors, `${tag}-13-vote-${leg + 1}`);
        // Двойное касание «Закончить голосование».
        await tap(page, "Закончить голосование", { double: true });
      }
      await page.waitForSelector('.bkh[data-board="voted"], .bkh[data-board="dock"]');
      await check(page, errors, `${tag}-14-after-vote-${leg + 1}`);
      const label = leg < 2 ? `Старт перелёта ${leg + 2}` : "К награждению";
      await tap(page, label);
      if (leg < 2) {
        await expectPhase(page, tag, `leg:launch:${leg + 1}`);
        await advance(page, 6000);
      }
    }
    await expectPhase(page, tag, "podium");
    await check(page, errors, `${tag}-15-podium`);
    await tap(page, "Завершить игру");
    if ((await page.evaluate(() => window.stand.finished())) !== 1) problem(tag, "«Завершить игру» не дошло до платформы");
    const bad = (await page.evaluate(() => window.stand.commands())).filter((c) => !c.ok && c.error !== "moved");
    if (bad.length) problem(tag, `отказы комнаты: ${bad.map((c) => `${c.cmd}:${c.error}`).join(", ")}`);
  } catch (e) {
    problem(tag, `сценарий сорвался на ${await phase(page).catch(() => "?")}: ${String(e).split("\n")[0]}`);
    await page.screenshot({ path: path.join(out, `${tag}-FAIL.png`), fullPage: true }).catch(() => undefined);
  } finally {
    await page.evaluate(() => window.stand?.clear?.()).catch(() => undefined);
    await ctx.close();
  }
}

/** Маленькие экипажи: «Объединить» (с «Отменой» и всерьёз), гость минуту без связи — «Убрать», длинные названия. */
async function smallCrews(vp) {
  const tag = `small-${vp.name}`;
  const { ctx, page, errors } = await openPage(vp, `s=game&guests=9&teams=5&long=1&saboteur=0&fresh=1`);
  try {
    await tap(page, "Собрать экипажи");
    await page.waitForSelector('.bkh[data-board="crews"]');
    await check(page, errors, `${tag}-01-crews`);
    const n0 = await page.evaluate(() => window.stand.crews());
    await page.locator("details.bkh-fold summary", { hasText: "объединить" }).first().scrollIntoViewIfNeeded();
    if (!(await page.locator("details.bkh-fold").first().evaluate((d) => d.open))) await page.locator("details.bkh-fold summary").first().click();
    await check(page, errors, `${tag}-02-merge-open`);
    await tap(page, "Объединить", { exact: true });
    await check(page, errors, `${tag}-03-merge-confirm`, "dialog[open]");
    await page.locator("dialog[open]").getByRole("button", { name: "Отмена" }).click();
    if ((await page.evaluate(() => window.stand.crews())) !== n0) problem(tag, "«Отмена» всё равно объединила");
    await tap(page, "Объединить", { exact: true });
    await page.locator("dialog[open]").getByRole("button", { name: "Объединить" }).click();
    await page.waitForTimeout(80);
    if ((await page.evaluate(() => window.stand.crews())) !== n0 - 1) problem(tag, "экипажи не объединились");
    // Пересадить гостя.
    await tap(page, "Пересадить", { exact: true });
    await tap(page, "Старт перелёта 1");
    await advance(page, 6000);
    await page.evaluate(() => window.stand.offline("p1"));
    await advance(page, 62_000);
    await page.waitForSelector("text=Давно без связи");
    await check(page, errors, `${tag}-04-removable`);
    await page.locator(".bkh-row", { hasText: "без связи" }).getByRole("button", { name: "Убрать" }).first().click();
    await page.locator("dialog[open]").getByRole("button", { name: "Убрать" }).click();
    await page.waitForTimeout(80);
    if (!(await page.evaluate(() => window.stand.commands())).some((c) => c.cmd === "remove" && c.ok)) problem(tag, "«Убрать» не выполнено");
    if (!(await page.evaluate(() => window.stand.commands())).some((c) => c.cmd === "move" && c.ok)) problem(tag, "«Пересадить» не выполнено");
  } catch (e) {
    problem(tag, `сценарий сорвался: ${String(e).split("\n")[0]}`);
    await page.screenshot({ path: path.join(out, `${tag}-FAIL.png`), fullPage: true }).catch(() => undefined);
  } finally {
    await page.evaluate(() => window.stand?.clear?.()).catch(() => undefined);
    await ctx.close();
  }
}

async function editor(vp) {
  for (const q of ["s=editor", "s=editor&kids=1", "s=editor&bad=1"]) {
    const tag = `editor-${q.replace(/^s=editor&?/, "") || "default"}-${vp.name}`;
    const { ctx, page, errors } = await openPage(vp, q);
    try {
      await check(page, errors, tag, "main");
      if (q.includes("bad")) {
        const errs = await page.evaluate(() => window.errors);
        if (!errs.length) problem(tag, "повтор названия не нашёлся проверкой");
        // Убрали повтор — ошибок нет.
        await page.getByLabel("По одному на строку — по желанию").fill("Тёщемер\nСалатоскоп");
        await page.getByLabel("По одному на строку — по желанию").blur();
        await page.waitForTimeout(500);
        if ((await page.evaluate(() => window.errors)).length) problem(tag, "после правки ошибка осталась");
      } else if (!q.includes("kids")) {
        await page.getByRole("button", { name: "2 перелёта" }).click();
        await page.getByRole("button", { name: "5 минут" }).click();
        await page.getByLabel("Пираты").check();
        const c = await page.evaluate(() => window.content);
        if (c.legs !== 2 || c.legMinutes !== 5 || c.theme !== "pirates" || !c.captainTasks.some((t) => /пират|клад|абордаж/i.test(t))) problem(tag, `правки не дошли: ${JSON.stringify({ legs: c.legs, m: c.legMinutes, theme: c.theme })}`);
        await page.getByLabel("Детская").check();
        const k = await page.evaluate(() => window.content);
        if (k.saboteur) problem(tag, "детская сложность не выключила диверсанта");
        await check(page, errors, `${tag}-edited`, "main");
      }
    } catch (e) {
      problem(tag, `сценарий сорвался: ${String(e).split("\n")[0]}`);
    } finally {
      await ctx.close();
    }
  }
}

async function preview(vp) {
  const tag = `preview-${vp.name}`;
  const { ctx, page, errors } = await openPage(vp, "s=preview");
  try {
    await page.waitForTimeout(2500);
    await check(page, errors, `${tag}-screen`, "main");
    await page.getByRole("tab", { name: "Пульт" }).click();
    await page.waitForTimeout(3000);
    await check(page, errors, `${tag}-host`, "main");
    await page.getByRole("tab", { name: "Телефон" }).click();
    await page.waitForTimeout(1500);
    await check(page, errors, `${tag}-phone`, ".bkpv-tools");
  } catch (e) {
    problem(tag, `сценарий сорвался: ${String(e).split("\n")[0]}`);
  } finally {
    await ctx.close();
  }
}

const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
for (const vp of VIEWPORTS) {
  console.log(`— ${vp.name} px`);
  if (!only || only.includes("game")) await fullGame(vp);
  if (!only || only.includes("small")) await smallCrews(vp);
  if (!only || only.includes("editor")) await editor(vp);
  if (!only || only.includes("preview")) await preview(vp);
}
await browser.close();
server.close();
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 1));
console.log(`проверено видов: ${report.checked}, снимков: ${report.shots}, замечаний: ${report.problems.length}`);
process.exit(report.problems.length ? 1 : 0);
