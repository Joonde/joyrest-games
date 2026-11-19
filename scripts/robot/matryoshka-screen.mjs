// Проверка экрана зала «Игр Матрёшки» без сервера (Блок 3c): стенд `matryoshka-screen.tsx` (сборка — build.mjs с
// ROBOT_ENTRY=scripts/robot/matryoshka-screen.tsx) — настоящий экран против комнаты в памяти с ботами. Каждый этап — на 1920×1080,
// 1280×800 и 1024×768, оба двора («Солнечный» — гжель, «Ночной» — хохлома), 6, 50 и 100 игроков, длинные имена, «уменьшить
// движение». Проверки: нет прокрутки, ничего не вылезает за край экрана, надписи не наезжают друг на друга, текст не меньше 1,7%
// высоты экрана, контраст ≥ 4,5 (крупный ≥ 3; над картинкой — по пикселям кадра без текста), нет мусора (undefined, NaN, null,
// [object …]), ошибок страницы и битых файлов, тайны не видны раньше времени, анимации — только transform и opacity. Отдельно —
// плавность: 100 фишек в «Замри!» вживую, кадры по requestAnimationFrame.
// Запуск: node scripts/robot/matryoshka-screen.mjs <папка сборки> <папка снимков>; FILTER=<сценарий,…> — только они; QUICK=1 — только 1920×1080.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const site = path.resolve(process.argv[2] ?? "build/matryoshka-screen");
const out = path.resolve(process.argv[3] ?? "build/matryoshka-screen-shots");
const root = path.resolve(import.meta.dirname, "../..");
const pub = path.join(root, "public");
fs.mkdirSync(out, { recursive: true });

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webp": "image/webp", ".png": "image/png", ".json": "application/json", ".mp3": "audio/mpeg" };
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

/** Сценарий стенда → какой экран (`data-board`) должен быть. */
const BOARD = {
  lobby: "lobby",
  open: "open",
  rules: "rules",
  countdown: "countdown",
  "freeze-run": "freeze",
  "freeze-turn": "freeze",
  judging: "judging",
  "reveal-live": "reveal",
  results: "results",
  "ginger-pick": "ginger",
  "ginger-unbox": "ginger",
  "ginger-trace": "ginger",
  "chairs-music": "chairs",
  "chairs-stop": "chairs",
  "chairs-seat": "chairs",
  "rope-pull": "rope",
  "rope-rest": "rope",
  "hop-brave": "hop",
  "hop-choose": "hop",
  "hop-crack": "hop",
  "chance-offer": "chance",
  "chance-question": "chance",
  "chance-back": "chance",
  "dobivka-rows": "dobivka",
  "dobivka-crack": "dobivka",
  bracket: "bracket",
  "duel-pick": "duel",
  "duel-show": "duel",
  bestfan: "bestFan",
  champion: "champion",
  podium: "podium",
  pause: "freeze",
  board: "freeze",
  tab: "tab",
  over: "over",
  connecting: "connecting",
};

/** Тайны по этапам: что не должно быть видно на экране (ТЗ: экран — без тайн). */
const SECRETS = {
  "ginger-pick": [/звезд|ёлочк|елочк|матрёшк[аи]\b.*\d|зонт|круг\b|треугольн/i],
  "hop-brave": [/Тонкий лёд — (слева|справа)/, /лёд держит|провалились/],
  "hop-choose": [/Тонкий лёд — (слева|справа)/, /лёд держит|провалились/],
  "dobivka-rows": [/Тонкий лёд — (слева|справа)/],
  judging: [/Поймала:/, /В сугроб!/],
  "chance-question": [/Возвращаются в игру/],
  // Название игры «Камень, ножницы, бумага» — можно; жест дуэлянта до показа — нельзя.
  "duel-pick": [/№ \d{3} · (камень|ножницы|бумага)/i],
};

function inspect() {
  const found = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const doc = document.documentElement;
  if (doc.scrollWidth > vw + 1 || doc.scrollHeight > vh + 1) found.push(`прокрутка: ${doc.scrollWidth}×${doc.scrollHeight} > ${vw}×${vh}`);
  const rootEl = document.querySelector(".mts");
  if (!rootEl) return { found: ["нет экрана .mts"], board: null, text: "", over: [] };
  const text = rootEl.innerText;
  for (const bad of ["undefined", "NaN", "[object", "null", "Infinity"]) if (text.includes(bad)) found.push(`мусор в тексте: «${bad}»`);
  if (/-\d+:\d\d|−\d+ с|через -\d/.test(text)) found.push("отрицательный отсчёт");
  // Украшения, частицы, фон и картинки: текста в них нет, их наложения задуманы.
  const decor = (el) => Boolean(el.closest(".mts__bg, .mts-fall, .mts-confetti, .mts-fx, .mts-note, .mts-sparks, .mt-open, .mts-burst, svg, .qr"));
  // Фишки-смайлики — значки, не надписи (размер шрифта и наезды судим у подписей).
  const icon = (el) => Boolean(el.closest(".mts-chip, .mts-strip__fan, .mts-strip__out, .mts-gc__chip, .mts-mini, .mts-gc__ok, .mts-runner, .mts-dance__chip, .mts-stool__chip, .mts-demo__pic, .mts-coin"));
  const overlay = (el) => (el.closest(".mts-pause") ? 2 : el.closest(".mts-board") ? 1 : 0);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none" && Number(st.opacity) > 0.05;
  };
  const label = (el) => `${el.tagName.toLowerCase()}${typeof el.className === "string" && el.className ? "." + el.className.split(" ")[0] : ""} «${(el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 34)}»`;
  for (const el of rootEl.querySelectorAll("*:not(.btn)")) {
    const st = getComputedStyle(el);
    if (st.transitionDuration !== "0s" && /box-shadow|width|height|top|left|right|bottom|margin|background|all/.test(st.transitionProperty)) found.push(`переход не transform/opacity: ${st.transitionProperty} у ${label(el)}`);
  }
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const r of rules) {
      if (r.type !== CSSRule.KEYFRAMES_RULE || !r.name.startsWith("mts-")) continue;
      for (const k of r.cssRules) for (const p of k.style) if (!["transform", "opacity"].includes(p)) found.push(`анимация ${r.name} меняет ${p}`);
    }
  }
  const rgb = (s) => (s.match(/[\d.]+/g) ?? []).map(Number);
  const lum = ([r0, g0, b0]) => {
    const f = (c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r0) + 0.7152 * f(g0) + 0.0722 * f(b0);
  };
  const leaves = [];
  const over = [];
  const minFont = vh * 0.017;
  for (const el of rootEl.querySelectorAll("*")) {
    if (decor(el) || !visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (!el.closest(".mts-strip, .mts-dim") && (r.right > vw + 1 || r.left < -1 || r.bottom > vh + 1 || r.top < -1) && !el.matches(".mts__bg, .mts-dim, .mts-strip__bank")) found.push(`за краем экрана: ${label(el)} (${Math.round(r.left)},${Math.round(r.top)}…${Math.round(r.right)},${Math.round(r.bottom)})`);
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== "");
    if (!own || icon(el)) continue;
    if (r.right > vw + 1 || r.left < -1 || r.bottom > vh + 1 || r.top < -1) found.push(`надпись за краем экрана: ${label(el)}`);
    const st = getComputedStyle(el);
    const fs = parseFloat(st.fontSize);
    // Строчный элемент занимает высоту шрифта с запасом над и под буквами — сравниваем по буквам (без 18% сверху и снизу).
    const inset = st.display.startsWith("inline") && !st.display.includes("block") ? fs * 0.18 : 0;
    leaves.push({ el, r: { left: r.left, right: r.right, top: r.top + inset, bottom: r.bottom - inset } });
    if (fs < minFont - 0.2) found.push(`мелко для зала ${fs.toFixed(1)} px < ${minFont.toFixed(1)}: ${label(el)}`);
    const ell = st.textOverflow === "ellipsis" || (st.webkitLineClamp !== "none" && st.webkitLineClamp !== "");
    if (!ell && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2) && (st.overflow !== "visible" || st.overflowX !== "visible")) found.push(`текст обрезан: ${label(el)}`);
    const inl = st.display.startsWith("inline") && !st.display.includes("block") ? fs * 0.18 : 0;
    for (let a = el.parentElement; a && a !== rootEl; a = a.parentElement) {
      const as = getComputedStyle(a);
      if (as.overflow === "visible" && as.overflowX === "visible" && as.overflowY === "visible") continue;
      const ar = a.getBoundingClientRect();
      if (r.bottom - inl > ar.bottom + 2 || r.top + inl < ar.top - 2 || (!ell && (r.right > ar.right + 2 || r.left < ar.left - 2))) {
        found.push(`обрезано рамкой: ${label(el)} в ${label(a)}`);
        break;
      }
    }
    // Контраст: цвет текста и ближайшая плотная подложка; нет её — по пикселям (ниже).
    let bg = null;
    for (let a = el; a && a !== rootEl; a = a.parentElement) {
      const as = getComputedStyle(a);
      if (as.backgroundImage !== "none") break;
      const c = rgb(as.backgroundColor);
      if (c.length >= 3 && (c[3] ?? 1) >= 0.85) {
        bg = c.slice(0, 3);
        break;
      }
    }
    const big = fs >= 24 || (fs >= 18.66 && Number(st.fontWeight) >= 600);
    if (bg) {
      const fg = rgb(st.color);
      const [l1, l2] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      const ratio = (l1 + 0.05) / (l2 + 0.05);
      if (ratio < (big ? 3 : 4.5)) found.push(`бледно ${ratio.toFixed(2)}: ${label(el)}`);
    } else if (!document.querySelector(".mts-pause") || el.closest(".mts-pause")) {
      // Под плашкой паузы всё нарочно притемнено — судим только то, что на самой паузе.
      over.push({ text: el.innerText.trim().replace(/\s+/g, " ").slice(0, 40), x: r.left, y: r.top, w: r.width, h: r.height, color: rgb(st.color), big });
    }
  }
  for (let i = 0; i < leaves.length; i += 1) {
    for (let j = i + 1; j < leaves.length; j += 1) {
      const a = leaves[i];
      const b = leaves[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      if (overlay(a.el) !== overlay(b.el)) continue;
      const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (x > 2 && y > 2) found.push(`надписи наезжают: ${label(a.el)} и ${label(b.el)}`);
    }
  }
  // Плашки (заголовок, счётчики, таймер, подсказки) — не друг на друге.
  const plates = [...rootEl.querySelectorAll(".mts-plate, .mts-timer, .mts-strip__lbl, .mts-foot, .mts-chalk, .mts-tag")].filter((el) => visible(el) && !overlay(el));
  for (let i = 0; i < plates.length; i += 1) {
    for (let j = i + 1; j < plates.length; j += 1) {
      const a = plates[i].getBoundingClientRect();
      const b = plates[j].getBoundingClientRect();
      if (plates[i].contains(plates[j]) || plates[j].contains(plates[i])) continue;
      if (plates[i].matches(".mts-tag") && plates[j].matches(".mts-tag")) continue;
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (x > 3 && y > 3) found.push(`плашки наезжают: ${label(plates[i])} и ${label(plates[j])}`);
    }
  }
  return { found: [...new Set(found)], board: rootEl.dataset.board ?? null, text, over };
}

/** Контраст по пикселям: кадр без текста, светлота фона под надписью — 90-й или 10-й процентиль (худший случай). */
async function pixelContrast({ png, over }) {
  const img = new Image();
  img.src = `data:image/png;base64,${png}`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const lum = ([r0, g0, b0]) => {
    const f = (v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r0) + 0.7152 * f(g0) + 0.0722 * f(b0);
  };
  const found = [];
  for (const o of over) {
    const x0 = Math.max(0, Math.floor(o.x));
    const y0 = Math.max(0, Math.floor(o.y));
    const w = Math.min(c.width, Math.floor(o.x + o.w)) - x0;
    const h = Math.min(c.height, Math.floor(o.y + o.h)) - y0;
    if (w < 2 || h < 2) continue;
    const d = g.getImageData(x0, y0, w, h).data;
    const ls = [];
    for (let i = 0; i < d.length; i += 4) ls.push(lum([d[i], d[i + 1], d[i + 2]]));
    ls.sort((a, b) => a - b);
    const fg = lum(o.color);
    // Тёмный текст судим по светлым пикселям фона, светлый — по тёмным.
    const bg = fg < 0.3 ? ls[Math.max(0, Math.floor(ls.length * 0.1))] : ls[Math.max(0, Math.floor(ls.length * 0.9) - 1)];
    const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    if (ratio < (o.big ? 3 : 4.5)) found.push(`бледно над картинкой ${ratio.toFixed(2)}: «${o.text}»`);
  }
  return [...new Set(found)];
}

const VIEWS = [
  [1920, 1080],
  [1280, 800],
  [1024, 768],
];
const scenarios = Object.keys(BOARD).filter((s) => !process.env.FILTER || process.env.FILTER.split(",").includes(s));
const runs = [];
for (const s of scenarios) {
  runs.push({ s, q: { n: 50 }, view: VIEWS[0] });
  runs.push({ s, q: { n: 50, style: "night" }, view: VIEWS[0] });
  if (process.env.QUICK) continue;
  // LITE=1 — по одному виду на размер (слабая машина): 7 прогонов на этап вместо 11.
  if (process.env.LITE) {
    runs.push({ s, q: { n: 50 }, view: VIEWS[1] });
    runs.push({ s, q: { n: 50, style: "night" }, view: VIEWS[2] });
  } else {
    for (const view of VIEWS.slice(1)) {
      runs.push({ s, q: { n: 50 }, view });
      runs.push({ s, q: { n: 50, style: "night" }, view });
    }
  }
  // На 6 игроках финалистов не больше половины зала — «Второго шанса» и «Добивки» может не быть (правила 3a).
  if (!/^(chance|dobivka)/.test(s)) runs.push({ s, q: { n: 6 }, view: VIEWS[0] });
  runs.push({ s, q: { n: 100, style: "night" }, view: VIEWS[0] });
  runs.push({ s, q: { n: 100 }, view: VIEWS[2] });
  runs.push({ s, q: { n: 50, long: 1 }, view: VIEWS[0] });
  runs.push({ s, q: { n: 50, long: 1, style: "night" }, view: VIEWS[2] });
}
for (const s of ["reveal-live", "open", "champion", "freeze-turn", "chairs-music"].filter((x) => scenarios.includes(x))) runs.push({ s, q: { n: 50, reduce: 1 }, view: VIEWS[0] });

const report = [];
async function one(run) {
  const [width, height] = run.view;
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: run.q.reduce ? "reduce" : "no-preference" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(`ошибка страницы: ${e.message}`));
  page.on("console", (m) => {
    // Значок вкладки (favicon) браузер просит сам — у стенда его нет.
    if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push(`консоль: ${m.text()}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().includes("favicon")) errors.push(`файл ${r.status()}: ${r.url().replace(/^https?:\/\/[^/]+/, "")}`);
  });
  page.on("requestfailed", (r) => {
    if (!r.url().startsWith("blob:")) errors.push(`не загрузилось: ${r.url().replace(/^https?:\/\/[^/]+/, "")}`);
  });
  const qs = new URLSearchParams({ s: run.s, ...Object.fromEntries(Object.entries(run.q).map(([k, v]) => [k, String(v)])) });
  await page.goto(`http://localhost:${port}/?${qs}`, { timeout: 120000 });
  try {
    await page.waitForFunction(() => window.standReady === true, null, { timeout: 120000 });
  } catch {
    errors.push("стенд не дождался готовности");
  }
  const reached = await page.evaluate(() => window.stand?.reached ?? true);
  if (!reached) errors.push("стенд не довёл игру до этапа");
  await page.waitForTimeout(run.s.endsWith("-live") ? 2600 : 500);
  await page.evaluate(() => document.fonts.ready);
  // Кнопка звука платформы (как в HallScreen до касания) — правый нижний угол не должен закрывать надписи.
  await page.evaluate(() => {
    const b = document.createElement("button");
    b.className = "screen-tap is-waiting";
    document.body.appendChild(b);
  });
  const { found, board, text, over } = await page.evaluate(inspect);
  const tap = await page.evaluate(() => {
    const t = document.querySelector(".screen-tap")?.getBoundingClientRect();
    const rootEl = document.querySelector(".mts");
    if (!t || !rootEl) return [];
    const hit = [];
    for (const el of rootEl.querySelectorAll("*")) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== "");
      if (!own) continue;
      // Видимая часть: обрезанное рамкой предка (overflow) под кнопкой не считаем.
      const r0 = el.getBoundingClientRect();
      const r = { left: r0.left, right: r0.right, top: r0.top, bottom: r0.bottom };
      for (let a = el.parentElement; a && a !== rootEl; a = a.parentElement) {
        const as = getComputedStyle(a);
        if (as.overflow === "visible" && as.overflowX === "visible" && as.overflowY === "visible") continue;
        const ar = a.getBoundingClientRect();
        r.left = Math.max(r.left, ar.left);
        r.right = Math.min(r.right, ar.right);
        r.top = Math.max(r.top, ar.top);
        r.bottom = Math.min(r.bottom, ar.bottom);
      }
      const x = Math.min(r.right, t.right) - Math.max(r.left, t.left);
      const y = Math.min(r.bottom, t.bottom) - Math.max(r.top, t.top);
      if (x > 3 && y > 3) hit.push(`кнопка звука платформы закрывает «${el.innerText.trim().slice(0, 30)}»`);
    }
    return hit;
  });
  found.push(...tap);
  const want = BOARD[run.s];
  if (board !== want) found.push(`не тот экран: ${board}, ждали ${want}`);
  for (const re of SECRETS[run.s] ?? []) if (re.test(text)) found.push(`тайна видна раньше времени: ${re}`);
  if (run.s === "pause" && !(await page.locator(".mts-pause").count())) found.push("нет плашки паузы");
  if (run.s === "board" && !(await page.locator(".mts-board").count())) found.push("нет табло");
  if (run.s === "pause") {
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && String(a.animationName ?? "").startsWith("mts-")).map((a) => a.animationName));
    if (running.length > 0) found.push(`на паузе идут анимации: ${[...new Set(running)].join(", ")}`);
  }
  if (run.q.reduce) {
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && String(a.animationName ?? "").startsWith("mts-")).map((a) => a.animationName));
    if (running.length > 0) found.push(`при «уменьшить движение» идут анимации: ${[...new Set(running)].join(", ")}`);
  }
  const name = `${run.s}-${Object.entries(run.q).map(([k, v]) => `${k}${v}`).join("-")}-${width}x${height}`;
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file });
  if (over.length > 0) {
    await page.addStyleTag({ content: ".mts *{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important}" });
    await page.waitForTimeout(60);
    const png = (await page.screenshot()).toString("base64");
    found.push(...(await page.evaluate(pixelContrast, { png, over })));
  }
  const problems = [...new Set([...errors, ...found])];
  report.push({ name, scenario: run.s, q: run.q, view: run.view, board, file, problems });
  console.log(`${problems.length === 0 ? "✓" : "✗"} ${name} → ${board}${problems.length ? "\n    " + problems.slice(0, 12).join("\n    ") : ""}`);
  await page.close();
}

const queue = [...runs];
await Promise.all(
  Array.from({ length: Number(process.env.PAR ?? 4) }, async () => {
    for (let run = queue.shift(); run; run = queue.shift()) {
      try {
        await one(run);
      } catch (e) {
        const name = `${run.s}-${Object.entries(run.q).map(([k, v]) => `${k}${v}`).join("-")}-${run.view.join("x")}`;
        report.push({ name, scenario: run.s, q: run.q, view: run.view, board: null, file: null, problems: [`прогон упал: ${e instanceof Error ? e.message.split("\n")[0] : e}`] });
        console.log(`✗ ${name}\n    прогон упал: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      }
    }
  }),
);

/** Плавность: «Замри!» вживую — 100 фишек (холст) и 50 (по элементу): кадры по requestAnimationFrame 5 с. */
async function smooth(n) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(`http://localhost:${port}/?s=freeze-run&n=${n}&live=1`, { timeout: 120000 });
  await page.waitForFunction(() => window.standReady === true, null, { timeout: 120000 });
  await page.waitForTimeout(500);
  const r = await page.evaluate(
    () =>
      new Promise((done) => {
        const gaps = [];
        let last = performance.now();
        const t0 = last;
        const tick = (t) => {
          gaps.push(t - last);
          last = t;
          if (t - t0 < 5000) requestAnimationFrame(tick);
          else {
            gaps.sort((a, b) => a - b);
            done({ frames: gaps.length, p50: gaps[Math.floor(gaps.length * 0.5)], p95: gaps[Math.floor(gaps.length * 0.95)], max: gaps[gaps.length - 1], canvas: document.querySelectorAll(".mts-crowd").length, dom: document.querySelectorAll(".mts-runner").length });
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  await page.close();
  const problems = [];
  if (r.p95 > 40) problems.push(`кадры неровные: 95% ≤ ${r.p95.toFixed(1)} мс (нужно ≤ 40)`);
  if (n > 60 && r.canvas === 0) problems.push("больше 60 фишек — не холст");
  console.log(`${problems.length ? "✗" : "✓"} плавность «Замри!» ${n} игроков: кадров ${r.frames} за 5 с, медиана ${r.p50.toFixed(1)} мс, 95% ${r.p95.toFixed(1)} мс, максимум ${r.max.toFixed(1)} мс, холст ${r.canvas}, фишек-элементов ${r.dom}${problems.length ? "\n    " + problems.join("\n    ") : ""}`);
  report.push({ name: `smooth-${n}`, scenario: "smooth", q: { n }, view: [1920, 1080], board: "freeze", file: null, problems, perf: r });
}
if (!process.env.FILTER || process.env.FILTER.includes("smooth")) {
  await smooth(100);
  await smooth(50);
}

fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const bad = report.filter((r) => r.problems.length > 0);
console.log(`\nВидов: ${report.length}, с замечаниями: ${bad.length}`);
await browser.close();
server.close();
process.exit(bad.length > 0 ? 1 : 0);
