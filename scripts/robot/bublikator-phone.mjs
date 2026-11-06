// Проверка телефона «Бубликатора» без сервера (Блок 2b): стенд `bublikator-phone.tsx` (сборка — build.mjs с
// ROBOT_ENTRY=scripts/robot/bublikator-phone.tsx) на 360 и 412 px, каждый сценарий — снимок и проверки: нет прокрутки
// вбок, ничего не вылезает за край и не наезжает, текст не обрезан, кнопки не меньше 44 px, нет ошибок страницы и мусора
// (undefined, NaN, null, [object …]). Запуск: node scripts/robot/bublikator-phone.mjs <папка сборки> <папка снимков>
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const site = path.resolve(process.argv[2] ?? "build/bublikator-phone");
const out = path.resolve(process.argv[3] ?? "build/bublikator-phone-shots");
const root = path.resolve(import.meta.dirname, "../..");
const pub = path.join(root, "public");
fs.mkdirSync(out, { recursive: true });
// Страница стенда — как телефон: ширина по устройству (без meta viewport мобильный браузер раскладывает на 980 px).
fs.writeFileSync(
  path.join(site, "index.html"),
  `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><link rel="stylesheet" href="/robot.css"></head><body><div id="root"></div><script type="module" src="/robot.js"></script></body></html>`,
);

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webp": "image/webp", ".png": "image/png", ".json": "application/json" };
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

/** Проверки раскладки внутри страницы. */
function inspect() {
  const found = [];
  const vw = window.innerWidth;
  const doc = document.documentElement;
  if (doc.scrollWidth > vw + 1) found.push(`прокрутка вбок: ${doc.scrollWidth} > ${vw}`);
  const text = document.body.innerText;
  for (const bad of ["undefined", "NaN", "[object", "null"]) if (text.includes(bad)) found.push(`мусор в тексте: «${bad}»`);
  // Читалке экрана — только текст приказа и итоги: в «живой» области не должно быть тикающих секунд.
  for (const el of document.querySelectorAll("[aria-live]")) {
    if (/\d+ с\b/.test(el.textContent ?? "") || el.querySelector(".bkp-order__left, .bkp-bar")) found.push(`aria-live с секундами: ${(el.textContent ?? "").slice(0, 40)}`);
  }
  // Анимации — только transform и opacity.
  for (const el of document.querySelectorAll(".bkp-root *")) {
    const t = getComputedStyle(el).transitionProperty;
    if (/box-shadow|width|height|top|left/.test(t) && getComputedStyle(el).transitionDuration !== "0s") found.push(`анимация не transform/opacity: ${t} у ${el.className}`);
  }
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none" && Number(st.opacity) > 0;
  };
  const label = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""} «${(el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 30)}»`;
  // Переворот пульта — повёрнутая плитка, её края считаем по-своему: исключаем повёрнутый блок из проверок «за край».
  const flipped = (el) => Boolean(el.closest(".bkp.is-flip .bkp-panel"));
  for (const el of document.querySelectorAll("button, [role=radio], [role=switch], a")) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 44 || r.width < 44) found.push(`маленькая кнопка ${Math.round(r.width)}×${Math.round(r.height)}: ${label(el)}`);
  }
  const leaves = [];
  for (const el of document.querySelectorAll(".bkp-root *")) {
    if (!visible(el) || flipped(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) found.push(`за краем экрана: ${label(el)} (${Math.round(r.left)}…${Math.round(r.right)})`);
    const st = getComputedStyle(el);
    const clipX = st.overflowX === "hidden" || st.overflow === "hidden";
    if (clipX && el.scrollWidth > el.clientWidth + 1 && st.textOverflow !== "ellipsis" && el.children.length === 0) found.push(`текст обрезан: ${label(el)}`);
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== "");
    if (own) leaves.push({ el, r });
  }
  // Надписи друг на друге (не предок и не потомок; меньше 4 px — не в счёт).
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
  // Части шапки не наезжают друг на друга (название экипажа и место).
  for (const head of document.querySelectorAll(".bkp-head")) {
    const [a, b] = [...head.children].map((c) => c.getBoundingClientRect());
    if (a && b && a.right > b.left + 1) found.push(`шапка: название экипажа наезжает на место (${Math.round(a.right)} > ${Math.round(b.left)})`);
  }
  return { found, screen: document.querySelector(".bkp-root")?.dataset.screen ?? null };
}

/** Касания сценариев и что после них должно быть в комнате. */
const ACTIONS = {
  panel: async (p) => {
    const step = p.locator(".bkp-step:not(.is-on), .bkp-switch, .bkp-lever__pos:not(.is-on), .bkp-dial__pos:not(.is-on), .bkp-press").first();
    await step.tap();
  },
  kids: async (p) => p.locator(".bkp-press, .bkp-switch, .bkp-lever__pos:not(.is-on)").first().tap(),
  pull: async (p) => {
    const box = await p.locator(".bkp-hold").boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await p.mouse.down();
    await p.waitForTimeout(300);
  },
  // Голос как в ph-vote: касание выбирает (в комнату ничего), «Голосую: …» — отправляет, повтор касания выбранного не
  // снимает, передумать — другой и снова «Голосую». Возвращает замечания по ходу.
  vote: async (p) => {
    const bad = [];
    const server = () => p.evaluate(() => window.stand.server().vote);
    const start = await server();
    const other = p.locator(".bkp-choice:not(.is-on)").first();
    const pickName = (await other.innerText()).trim();
    await other.tap();
    await p.waitForTimeout(300);
    if ((await server()) !== start) bad.push("голос ушёл по касанию, без «Голосую»");
    const cta = p.locator(".bkp-vote-cta");
    if (!(await cta.innerText()).includes(`Голосую: ${pickName}`)) bad.push(`кнопка не «Голосую: ${pickName}»: ${await cta.innerText()}`);
    await cta.tap();
    await p.waitForTimeout(400);
    const sent = await server();
    if (sent === start || sent === null) bad.push("«Голосую» не отправило голос");
    if (!(await cta.innerText()).includes("✓ Голос принят")) bad.push(`нет «✓ Голос принят»: ${await cta.innerText()}`);
    await p.locator(".bkp-choice.is-on").tap();
    await p.waitForTimeout(400);
    if ((await server()) !== sent) bad.push("повторное касание выбранного сняло голос");
    await p.locator(".bkp-choice:not(.is-on)").first().tap();
    await cta.tap();
    await p.waitForTimeout(400);
    const again = await server();
    if (again === sent || again === null) bad.push("передумать не вышло");
    return bad;
  },
  role: async (p) => p.getByRole("button", { name: "Понятно, скрыть" }).tap(),
  sos: async (p) => p.locator(".bkp-sos__btn").first().tap(),
  // Дождь: датчик присылает движение (как Chrome на Android, без «Разрешить тряску») — «ТРЯСИТЕ!» и сила уходит в комнату.
  meteor: async (p) => {
    await p.evaluate(async () => {
      for (let i = 0; i < 30; i += 1) {
        window.dispatchEvent(new DeviceMotionEvent("devicemotion", { acceleration: { x: 20, y: 5, z: 3 }, accelerationIncludingGravity: { x: 20, y: 14, z: 3 }, interval: 16 }));
        await new Promise((r) => setTimeout(r, 50));
      }
    });
    await p.waitForTimeout(500);
  },
  // Разрешил, но телефон отказал (или отказался в системном окне): «Тряска выключена», «Попробовать снова», тапы считаются.
  "meteor-ask": async (p) => {
    const bad = [];
    const text = () => p.evaluate(() => document.body.innerText);
    if (!(await text()).includes("Можно трясти вместо тапов")) bad.push("нет подсказки до системного окна");
    if ((await p.evaluate(() => window.asked)) !== 0) bad.push("системное окно до касания");
    await p.getByRole("button", { name: "Разрешить тряску" }).tap();
    await p.waitForTimeout(300);
    if ((await p.evaluate(() => window.asked)) !== 1) bad.push("«Разрешить тряску» не открыло системное окно");
    if (!(await text()).includes("Тряска выключена — тапайте по экрану")) bad.push("нет «Тряска выключена — тапайте по экрану»");
    if ((await p.getByRole("button", { name: "Попробовать тряску снова" }).count()) !== 1) bad.push("нет «Попробовать тряску снова»");
    for (let i = 0; i < 6; i += 1) await p.locator(".bkp-tap--big").tap();
    await p.waitForTimeout(400);
    return bad;
  },
  // «Буду тапать»: без системного окна, сразу тапы, выбор помнится после перезагрузки.
  "meteor-taps": async (p) => {
    const bad = [];
    await p.getByRole("button", { name: "Буду тапать" }).tap();
    await p.waitForTimeout(200);
    if ((await p.evaluate(() => window.asked)) !== 0) bad.push("«Буду тапать» открыло системное окно");
    if (!(await p.evaluate(() => document.body.innerText)).includes("Тряска выключена")) bad.push("после «Буду тапать» нет строки о тапах");
    for (let i = 0; i < 6; i += 1) await p.locator(".bkp-tap--big").tap();
    await p.waitForTimeout(400);
    if ((await p.evaluate(() => localStorage.getItem("joyrest.bub.shake"))) !== "tap") bad.push("выбор «Буду тапать» не запомнен");
    return bad;
  },
  // Тренировка: выбор и подсказка про вибрацию; переключатель вибрации в шапке запоминается.
  "drill-taps": async (p) => {
    const bad = [];
    const text = () => p.evaluate(() => document.body.innerText);
    if (!(await text()).includes("Сейчас телефон спросит доступ к движению")) bad.push("нет подсказки до системного окна");
    if (!(await text()).includes("Телефон коротко вибрирует")) bad.push("нет строки про вибрацию");
    await p.getByRole("button", { name: "Буду тапать" }).tap();
    await p.waitForTimeout(200);
    if ((await p.evaluate(() => window.asked)) !== 0) bad.push("«Буду тапать» открыло системное окно");
    const vib = p.locator(".bkp-vib").first();
    if ((await vib.getAttribute("aria-label")) !== "Вибрация: вкл") bad.push("вибрация по умолчанию не вкл");
    await vib.tap();
    await p.waitForTimeout(100);
    if ((await vib.getAttribute("aria-label")) !== "Вибрация: выкл") bad.push("переключатель вибрации не выключил");
    if ((await p.evaluate(() => localStorage.getItem("joyrest.bub.vibration"))) !== "off") bad.push("вибрация не запомнена");
    return bad;
  },
  "meteor-tap": async (p) => {
    for (let i = 0; i < 6; i += 1) await p.locator(".bkp-tap--big").tap();
  },
};
const changed = (a, b) => JSON.stringify(a.panel) !== JSON.stringify(b.panel);
const CHECKS = {
  panel: (a, b) => changed(a, b),
  kids: (a, b) => changed(a, b),
  pull: (a, b) => b.holding === true,
  vote: (a, b) => b.vote !== null,
  role: (a, b, screen) => b.roleSeen === true && screen !== "role",
  sos: (a, b) => b.sos !== a.sos,
  meteor: (a, b) => (b.shake ?? 0) > 50,
  "meteor-tap": (a, b) => (b.taps ?? 0) > (a.taps ?? 0),
  "meteor-ask": (a, b) => (b.taps ?? 0) > (a.taps ?? 0),
  "meteor-taps": (a, b) => (b.taps ?? 0) > (a.taps ?? 0),
  "drill-taps": () => true,
};
/** Что должно быть на экране сразу (без касаний): экран и текст; и чего не должно быть. */
const EXPECT = {
  "card-finished": { screen: "card" },
  "reload-finished": { screen: "over", text: "Игра окончена" },
  "sender-finished": { screen: "over", text: "Игра окончена" },
  "sender-abandoned": { screen: "panel", senders: 2 },
  helped: { screen: "panel", text: "Вы помогли!", selector: ".bkp-order__text", vibes: [[40]] },
  // Вибрация вместо звука (решение владельца 6 ноября 2026): выполнен — одна короткая, не успели — две.
  "feedback-done": { screen: "panel", vibes: [[40]] },
  "feedback-fail": { screen: "panel", vibes: [[40, 90, 40]] },
  "feedback-quiet": { screen: "panel", vibes: [] },
  // Аудит 2b, №10: на финише глагол — к «экипажу», в карточке — «Финишей первыми».
  finish: { screen: "finish", text: "Экипаж «🦊 Лисы» долетел до" },
  card: { screen: "card", text: "Финишей первыми" },
};
/** Что должно быть видно после касаний. */
const SEEN = {
  meteor: "ТРЯСИТЕ!",
  "meteor-tap": "ТАПАЙТЕ!",
};

const report = [];
const scenarios = (process.env.SCENARIOS ?? "").split(",").filter(Boolean);
const first = await browser.newPage();
await first.goto(`http://localhost:${port}/?s=lobby`);
await first.waitForFunction(() => window.stand !== undefined);
const all = scenarios.length > 0 ? scenarios : await first.evaluate(() => window.stand.scenarios);
await first.close();

for (const width of [360, 412]) {
  for (const s of all) {
    const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: process.env.MOTION ?? "reduce" });
    const errors = [];
    page.on("pageerror", (e) => errors.push(`ошибка страницы: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`консоль: ${m.text()}`);
    });
    // Тренировка: показываем шаг «Разрешить тряску», как на iPhone.
    if (s === "meteor-tap") await page.addInitScript(() => delete window.DeviceMotionEvent);
    // Как свежий Chrome на Android: requestPermission есть, но события идут и без вопроса.
    if (s === "meteor") await page.addInitScript(() => window.DeviceMotionEvent && (window.DeviceMotionEvent.requestPermission = () => Promise.resolve("granted")));
    // Системное окно датчика (как iPhone): считаем, сколько раз его открыли; здесь гость отказывается.
    if (s === "meteor-ask" || s === "meteor-taps" || s === "drill-taps") {
      await page.addInitScript(() => {
        window.asked = 0;
        (window.DeviceMotionEvent ??= function () {}).requestPermission = () => {
          window.asked += 1;
          return Promise.resolve("denied");
        };
      });
    }
    if (s === "feedback-quiet") await page.addInitScript(() => localStorage.setItem("joyrest.bub.vibration", "off"));
    // Вибрация понарошку: что телефон просил вибрировать.
    await page.addInitScript(() => {
      window.vibes = [];
      navigator.vibrate = (p) => (window.vibes.push(p), true);
    });
    if (s === "drill") await page.addInitScript(() => (window.DeviceMotionEvent ??= function () {}).requestPermission = () => Promise.resolve("granted"));
    await page.goto(`http://localhost:${port}/?s=${encodeURIComponent(s)}`);
    await page.waitForFunction(() => window.standReady === true, null, { timeout: 15000 });
    await page.waitForTimeout(500);
    const { found, screen } = await page.evaluate(inspect);
    // Главное — в первом экране маленьких телефонов (аудит 2b, №9): пульт третьего перелёта, «Тяга».
    const FOLD = { "panel-leg3": ".bkp-panel", "kids-leg3": ".bkp-panel", panel: ".bkp-panel", pull: ".bkp-hold", "meteor-ask": ".bkp-offer", "meteor-taps": ".bkp-offer", "meteor-tap": ".bkp-tap--big", "drill-taps": ".bkp-offer" };
    if (FOLD[s] && width === 360) {
      for (const [fw, fh] of [[360, 640], [320, 568]]) {
        await page.setViewportSize({ width: fw, height: fh });
        await page.waitForTimeout(200);
        const bottom = await page.evaluate((sel) => document.querySelector(sel)?.getBoundingClientRect().bottom ?? null, FOLD[s]);
        if (bottom === null || bottom > fh) found.push(`${FOLD[s]} не в первом экране ${fw}×${fh}: низ ${Math.round(bottom ?? -1)}`);
      }
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(100);
    }
    // Плашка ошибки или «Нет связи» не закрывает шапку (аудит 2b, №12) — и на 320 px, где она в две строки.
    if (s === "sender-error" || s === "offline") {
      for (const fw of [320, width]) {
        await page.setViewportSize({ width: fw, height: 800 });
        await page.waitForTimeout(150);
        const r = await page.evaluate(() => {
          const b = document.querySelector(".bkp-offline")?.getBoundingClientRect();
          const h = document.querySelector(".bkp-head")?.getBoundingClientRect();
          return b && h ? { b: b.bottom, h: h.top } : null;
        });
        if (!r) found.push("нет плашки или шапки");
        else if (r.b > r.h) found.push(`плашка закрывает шапку на ${fw} px: ${Math.round(r.b)} > ${Math.round(r.h)}`);
      }
    }
    // Тайная роль: «Понятно» — в первом экране и на самом маленьком телефоне (320×568).
    if (s === "role" || s === "role-honest") {
      await page.setViewportSize({ width: 320, height: 568 });
      await page.waitForTimeout(200);
      const r = await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("Понятно"));
        return b ? { bottom: b.getBoundingClientRect().bottom, h: window.innerHeight } : null;
      });
      if (!r || r.bottom > r.h) found.push(`«Понятно» не в первом экране 320×568: ${JSON.stringify(r)}`);
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(100);
    }
    // Положение прибора видно (аудит 2b, №8): выбранное отличается заливкой, рамка выбранного — контраст ≥ 3 с карточкой.
    found.push(
      ...(await page.evaluate(() => {
        const bad = [];
        const rgb = (c) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
        const lum = ([r, g, b]) => [r, g, b].map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
        const ratio = (a, b) => {
          const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
          return (x + 0.05) / (y + 0.05);
        };
        for (const box of document.querySelectorAll(".bkp-lever, .bkp-steps")) {
          const on = box.querySelector(".is-on");
          const off = box.querySelector(":scope > :not(.is-on)");
          const card = box.closest(".bkp-ctl");
          if (!on || !off || !card) continue;
          const so = getComputedStyle(on);
          const sf = getComputedStyle(off);
          if (so.backgroundColor === sf.backgroundColor) bad.push(`положение не видно: заливка выбранного как у остальных (${so.backgroundColor})`);
          // Фон под прибором: карточка, а если она полупрозрачная — фон страницы (`--bk-bg`).
          const cardBg = getComputedStyle(card).backgroundColor;
          const alpha = Number((cardBg.match(/rgba\([^)]*,\s*([\d.]+)\)/) ?? [])[1] ?? 1);
          const hex = getComputedStyle(box.closest(".bkp") ?? document.body).getPropertyValue("--bk-bg").trim();
          const page = /^#[0-9a-f]{6}$/i.test(hex) ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) : [255, 255, 255];
          const bg = alpha >= 0.5 ? rgb(cardBg) : page;
          const r = ratio(rgb(so.borderTopColor), bg);
          if (r < 3 && ratio(rgb(so.backgroundColor), bg) < 3) bad.push(`выбранное положение слабо видно: рамка ${r.toFixed(2)} < 3`);
        }
        return bad;
      })),
    );
    const want = EXPECT[s];
    if (want) {
      if (want.screen && screen !== want.screen) found.push(`экран ${screen}, а должен быть ${want.screen}`);
      const text = await page.evaluate(() => document.body.innerText);
      if (want.text && !text.includes(want.text)) found.push(`не видно «${want.text}»`);
      if (want.selector && (await page.locator(want.selector).count()) === 0) found.push(`нет ${want.selector}`);
      if (want.vibes) {
        const vibes = await page.evaluate(() => window.vibes);
        if (JSON.stringify(vibes) !== JSON.stringify(want.vibes)) found.push(`вибрация ${JSON.stringify(vibes)}, а нужна ${JSON.stringify(want.vibes)}`);
      }
      if (/обновите страницу|Подключаемся/i.test(text)) found.push("лишнее «обновите страницу» / «Подключаемся»");
      if (want.senders && (await page.evaluate(() => window.stand.senders())) !== want.senders) found.push(`отправитель не пересоздан: ${await page.evaluate(() => window.stand.senders())}`);
    }
    // Касания доходят до комнаты (тот же путь, что на сервере: пачка → правила → личное обратно).
    const act = ACTIONS[s];
    if (act && width === 360) {
      const before = await page.evaluate(() => window.stand.server());
      const said = await act(page);
      if (Array.isArray(said)) found.push(...said);
      await page.waitForTimeout(400);
      const after = await page.evaluate(() => window.stand.server());
      const ok = CHECKS[s](before, after, await page.evaluate(() => window.stand.screen()));
      if (!ok) found.push(`касание не дошло: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
      if (SEEN[s] && !(await page.evaluate((t) => document.body.innerText.includes(t), SEEN[s]))) found.push(`не видно «${SEEN[s]}»`);
    }
    const file = path.join(out, `${s}-${width}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const problems = [...errors.filter((e) => !e.includes("/fonts/")), ...found];
    report.push({ scenario: s, width, screen, file, problems });
    console.log(`${problems.length === 0 ? "✓" : "✗"} ${s} @${width} → ${screen}${problems.length ? "\n    " + problems.slice(0, 8).join("\n    ") : ""}`);
    await page.close();
  }
}
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const bad = report.filter((r) => r.problems.length > 0);
console.log(`\nСценариев: ${all.length} × 2 ширины, с замечаниями: ${bad.length}`);
await browser.close();
server.close();
process.exit(bad.length > 0 ? 1 : 0);
