// Проверка ОСНОВНОЙ версии только на чтение (решение владельца 24 октября 2026: «проверь на основе тестировщиком»).
// Ничего не записывает: ни клиентов, ни мероприятий, ни заявок, не входит в студию, по внешним ссылкам не переходит
// (WhatsApp, Telegram, почта, Авито — только проверяем адреса). Полная проверка с записью — на test (calendar.mjs и др.).
//  1. games.joy-rest.ru/health — та версия, что в main.
//  2. joy-rest.ru/calc/ и главная (если включена витрина): дата и время с клавиатуры не стираются, текст для Telegram
//     без «%», «+», «&» и с датой, выбор почты (Gmail, Яндекс, Mail.ru) с расчётом, шаги для Авито.
//  3. Студия: страница входа открывается без ошибок, в коде студии есть новые функции 24 октября.
import { chromium } from "playwright";
import { appendFileSync } from "node:fs";

const SITE = "https://joy-rest.ru";
const PLATFORM = "https://games.joy-rest.ru";
const EXPECT = (process.env.EXPECT_VERSION ?? "").trim();
const problems = [];
const lines = [];
const say = (t) => {
  lines.push(t);
  console.log(t);
};
const ok = (t) => say(`✅ ${t}`);
const bad = (t) => {
  problems.push(t);
  say(`❌ ${t}`);
};
const check = (cond, good, fail) => (cond ? ok(good) : bad(fail ?? good));

const DAY = 86_400_000;
const target = new Date(Date.now() + 60 * DAY);
const iso = target.toISOString().slice(0, 10);
const [y, m, d] = iso.split("-");
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const dateWords = `${Number(d)} ${MONTHS[Number(m) - 1]}`;

// 1. Версия
try {
  const res = await fetch(`${PLATFORM}/health`);
  const body = await res.json();
  check(res.ok && (!EXPECT || body.version === EXPECT), `Основная версия на сервере — ${String(body.version).slice(0, 7)} (main)`, `Основная версия ${String(body.version).slice(0, 7)}, а в main ${EXPECT.slice(0, 7)}`);
} catch (e) {
  bad(`/health не ответил: ${String(e?.message ?? e).slice(0, 120)}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU", permissions: ["clipboard-read", "clipboard-write"] });
// Только наши адреса: внешние ссылки (WhatsApp, Telegram, почта, Авито) не открываем.
await context.route(/^https?:\/\//, (route) => (/^https:\/\/([a-z-]+\.)?joy-rest\.ru\//.test(route.request().url()) ? route.continue() : route.abort()));

async function typeDateTime(page, dateSel, timeSel, where) {
  await page.click(dateSel);
  // Chromium в CI пишет дату как мм/дд/гггг.
  for (const ch of `${m}${d}${y}`) await page.keyboard.type(ch, { delay: 40 });
  await page.click(timeSel);
  for (const ch of "1930") await page.keyboard.type(ch, { delay: 40 });
  await page.click("body", { position: { x: 4, y: 4 } });
  await page.waitForTimeout(300);
  const dv = await page.$eval(dateSel, (e) => e.value);
  const tv = await page.$eval(timeSel, (e) => e.value);
  check(dv === iso && tv === "19:30", `${where}: дата и время, набранные с клавиатуры, не стираются`, `${where}: дата «${dv}», время «${tv}» (ждали ${iso}, 19:30)`);
}

async function checkSheet(page, ids, where) {
  const tg = decodeURIComponent((await page.getAttribute(ids.tg, "href")).split("text=")[1] ?? "");
  check(tg.includes("Расчёт JoyRest") && !/[%+&]/.test(tg), `${where}: текст для Telegram целиком, без «%», «+», «&»`, `${where}: текст Telegram «${tg.slice(0, 120)}»`);
  check(tg.includes(dateWords) && tg.includes("19:30"), `${where}: в расчёте для менеджера есть дата и время`, `${where}: нет даты (${dateWords}) или времени в расчёте`);
  await page.click(ids.mail);
  const mails = await page.$$eval(`${ids.mailList} [data-mail]`, (as) => as.map((a) => [a.dataset.mail, a.getAttribute("href")]));
  const byKind = Object.fromEntries(mails);
  const deep = (h) => decodeURIComponent(decodeURIComponent(h ?? ""));
  check(
    byKind.gmail?.startsWith("https://mail.google.com/") && byKind.yandex?.startsWith("https://mail.yandex.ru/") && byKind.mailru?.startsWith("https://e.mail.ru/") && byKind.app?.startsWith("mailto:joyrest@mail.ru") && deep(byKind.gmail).includes(dateWords),
    `${where}: «Почта» — выбор Gmail, Яндекс, Mail.ru и почтовой программы, в письме расчёт с датой`,
    `${where}: ссылки почты ${JSON.stringify(mails).slice(0, 200)}`,
  );
  await page.click(ids.avito);
  check(await page.isVisible(ids.avitoBox), `${where}: «Авито» сначала показывает шаги (скопировать, «Написать», вставить)`, `${where}: шагов Авито нет`);
  check(((await page.getAttribute(ids.avitoGo, "href")) ?? "").startsWith("https://www.avito.ru/"), `${where}: «Скопировать и открыть Авито» ведёт в профиль на Авито`);
}

try {
  // 2а. Калькулятор без заявки
  const calc = await context.newPage();
  const errs = [];
  calc.on("pageerror", (e) => errs.push(String(e.message)));
  await calc.goto(`${SITE}/calc/`);
  await typeDateTime(calc, "#date", "#time", "joy-rest.ru/calc/");
  await calc.getByRole("button", { name: /Отправить расчёт/ }).first().click();
  await calc.waitForTimeout(300);
  await checkSheet(calc, { tg: "#sTg", mail: "#sMail", mailList: "#sMailList", avito: "#sAvito", avitoBox: "#sAvitoBox", avitoGo: "#sAvitoGo" }, "joy-rest.ru/calc/");
  check(errs.length === 0, "joy-rest.ru/calc/: без ошибок на странице", `joy-rest.ru/calc/: ошибки — ${errs.join("; ").slice(0, 200)}`);

  // 2б. Главная — если открыта витрина или сайт
  const home = await context.newPage();
  const herr = [];
  home.on("pageerror", (e) => herr.push(String(e.message)));
  await home.goto(`${SITE}/`);
  const mode = await home.evaluate(() => document.documentElement.dataset.siteMode ?? (document.getElementById("calcDate") ? "on" : "off"));
  if (mode === "off") say("ℹ️ joy-rest.ru: заглушка «скоро» — главную не проверяем");
  else {
    await typeDateTime(home, "#calcDate", "#calcTime", `joy-rest.ru (${mode === "showcase" ? "витрина" : "сайт"})`);
    if (mode === "showcase") {
      await home.click("#calcSubmit");
      await home.waitForTimeout(300);
      await checkSheet(home, { tg: "#sendTg", mail: "#sendMail", mailList: "#sendMailList", avito: "#sendAvito", avitoBox: "#sendAvitoBox", avitoGo: "#sendAvitoGo" }, "joy-rest.ru (витрина)");
    }
    check(herr.length === 0, "joy-rest.ru: без ошибок на странице", `joy-rest.ru: ошибки — ${herr.join("; ").slice(0, 200)}`);
  }

  // 3. Студия: вход без ошибок и новые функции в коде
  const studio = await context.newPage();
  const serr = [];
  studio.on("pageerror", (e) => serr.push(String(e.message)));
  await studio.goto(`${PLATFORM}/studio`);
  await studio.waitForTimeout(2500);
  const loginShown = (await studio.locator('input[type="password"]').count()) > 0;
  check(loginShown && serr.length === 0, "Студия: страница входа открывается без ошибок", `Студия: вход ${loginShown ? "есть" : "не показан"}, ошибки — ${serr.join("; ").slice(0, 200)}`);
  const html = await (await fetch(`${PLATFORM}/`)).text();
  const queue = [...html.matchAll(/\/assets\/[\w.-]+\.js/g)].map((x) => x[0]);
  const seen = new Set();
  let code = "";
  while (queue.length && seen.size < 400) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    const text = await (await fetch(PLATFORM + path)).text();
    code += text;
    for (const x of text.matchAll(/assets\/[\w.-]+\.js/g)) if (!seen.has(`/${x[0]}`)) queue.push(`/${x[0]}`);
    for (const x of text.matchAll(/["'`]\.\/([\w.-]+\.js)["'`]/g)) if (!seen.has(`/assets/${x[1]}`)) queue.push(`/assets/${x[1]}`);
  }
  const features = [
    ["📅 Записать мероприятие ведущему", "карточка клиента → мероприятие"],
    ["Черновики мероприятий", "черновики мероприятий"],
    ["Закрыть — оставить в черновике", "«Отмена» оставляет черновик"],
    ["Недавно «Клиент» и «В работе»", "клиенты из базы под полями формы"],
    ["Заполнить из сообщения клиента", "анкета из сообщения"],
    ["Формат — касайтесь по порядку вечера", "«Что хочет клиент» полями"],
    ["Статус и рассылка", "статус и рассылка свёрнуты"],
    ["Светлая тема", "светлая и тёмная тема студии"],
  ];
  say(`ℹ️ Код студии: просмотрено файлов — ${seen.size}`);
  // Сборщик может записать русские буквы как \uXXXX — ищем оба вида.
  const escaped = (t) => [...t].map((ch) => (ch.charCodeAt(0) > 127 ? `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}` : ch)).join("");
  const has = (t) => code.includes(t) || code.toLowerCase().includes(escaped(t).toLowerCase());
  for (const [text, what] of features) check(has(text), `Студия на основной версии: ${what}`, `Студия на основной версии: не нашли «${text}» (${what})`);
} catch (e) {
  bad(`Проверка остановилась: ${String(e?.message ?? e).slice(0, 300)}`);
} finally {
  await browser.close();
}

say(problems.length === 0 ? "Основная версия: всё на месте." : `Замечаний: ${problems.length}`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Проверка основной версии (только чтение)\n\n${lines.map((l) => `- ${l}`).join("\n")}\n`);
for (const p of problems) console.log(`::error::${p}`);
console.log(`::notice::${problems.length === 0 ? "Основная версия: всё на месте." : `Замечаний: ${problems.length}`}\n${lines.join("\n")}`.replace(/\n/g, "%0A"));
process.exit(problems.length === 0 ? 0 : 1);
