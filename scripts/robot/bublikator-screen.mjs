// Проверка экрана зала «Бубликатора» без сервера (Блок 2c): стенд `bublikator-screen.tsx` (сборка — build.mjs с
// ROBOT_ENTRY=scripts/robot/bublikator-screen.tsx) на 1920×1080, 1280×800 и 1024×768, 1/3/5/12/20 экипажей, 50 гостей,
// длинные имена, все темы. Каждый вид — снимок и проверки: нет прокрутки, ничего не вылезает за край кадра и за свою рамку,
// надписи не наезжают, текст не меньше 1,7% высоты экрана, контраст (≥ 4,5, крупный ≥ 3; над картинкой не судим), нет мусора
// (undefined, NaN, null, [object …]), ошибок страницы и битых файлов, анимации — только transform и opacity.
// Запуск: node scripts/robot/bublikator-screen.mjs <папка сборки> <папка снимков>; FILTER=<сценарий> — только он.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const site = path.resolve(process.argv[2] ?? "build/bublikator-screen");
const out = path.resolve(process.argv[3] ?? "build/bublikator-screen-shots");
const root = path.resolve(import.meta.dirname, "../..");
const pub = path.join(root, "public");
fs.mkdirSync(out, { recursive: true });

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

/** Какой экран должен быть у сценария. */
const BOARD = {
  lobby: "lobby",
  "lobby-wait": "lobby",
  crews: "crews",
  drill: "drill",
  "drill-over": "drill",
  launch: "launch",
  flight: "flight",
  "flight-leg2": "flight",
  finish: "flight",
  warn: "flight",
  meteor: "flight",
  glitch: "flight",
  pull: "pull",
  sos: "sos",
  captain: "captain",
  dock: "dock",
  vote: "vote",
  reveal: "reveal",
  "reveal-seq": "reveal",
  podium: "podium",
  over: "over",
  tab: "tab",
  abandoned: "abandoned",
  connecting: "connecting",
  pause: "flight",
};

/** Проверки раскладки внутри страницы. */
function inspect() {
  const found = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const doc = document.documentElement;
  if (doc.scrollWidth > vw + 1 || doc.scrollHeight > vh + 1) found.push(`прокрутка: ${doc.scrollWidth}×${doc.scrollHeight} > ${vw}×${vh}`);
  const rootEl = document.querySelector(".bks");
  if (!rootEl) return { found: ["нет экрана .bks"], board: null };
  const text = rootEl.innerText;
  for (const bad of ["undefined", "NaN", "[object", "null", "Infinity"]) if (text.includes(bad)) found.push(`мусор в тексте: «${bad}»`);
  if (/-\d+:\d\d|−\d+ с/.test(text)) found.push("отрицательный отсчёт");
  const skip = (el) => Boolean(el.closest(".bks-fx, .bks-meteors, .bks__bg, .qr, svg"));
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none" && Number(st.opacity) > 0.05;
  };
  const label = (el) => `${el.tagName.toLowerCase()}${typeof el.className === "string" && el.className ? "." + el.className.split(" ")[0] : ""} «${(el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 34)}»`;
  // Анимации и переходы — только transform и opacity.
  // Кнопки платформы (`.btn`) — со своими переходами из общих стилей.
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
      if (r.type !== CSSRule.KEYFRAMES_RULE || !r.name.startsWith("bks-")) continue;
      for (const k of r.cssRules) for (const p of k.style) if (!["transform", "opacity"].includes(p)) found.push(`анимация ${r.name} меняет ${p}`);
    }
  }
  const leaves = [];
  const minFont = vh * 0.017;
  for (const el of rootEl.querySelectorAll("*")) {
    if (skip(el) || !visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1 || r.bottom > vh + 1 || r.top < -1) found.push(`за краем экрана: ${label(el)} (${Math.round(r.left)},${Math.round(r.top)}…${Math.round(r.right)},${Math.round(r.bottom)})`);
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== "");
    if (!own) continue;
    const st = getComputedStyle(el);
    leaves.push({ el, r });
    const fs = parseFloat(st.fontSize);
    if (fs < minFont - 0.2) found.push(`мелко для зала ${fs.toFixed(1)} px < ${minFont.toFixed(1)}: ${label(el)}`);
    const ell = st.textOverflow === "ellipsis" || st.webkitLineClamp !== "none";
    if (!ell && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2) && (st.overflow !== "visible" || st.overflowX !== "visible")) found.push(`текст обрезан: ${label(el)}`);
    // Обрезан рамкой предка (карточка с overflow: hidden): нижний или правый край — за рамкой.
    for (let a = el.parentElement; a && a !== rootEl; a = a.parentElement) {
      const as = getComputedStyle(a);
      if (as.overflow === "visible" && as.overflowX === "visible" && as.overflowY === "visible") continue;
      const ar = a.getBoundingClientRect();
      const ellA = as.textOverflow === "ellipsis";
      if (r.bottom > ar.bottom + 2 || r.top < ar.top - 2 || (!ell && !ellA && (r.right > ar.right + 2 || r.left < ar.left - 2))) {
        found.push(`обрезано рамкой: ${label(el)} в ${label(a)}`);
        break;
      }
    }
    // Контраст: цвет текста и ближайшая непрозрачная подложка; над картинкой или градиентом не судим.
    const rgb = (s) => (s.match(/[\d.]+/g) ?? []).map(Number);
    const lum = ([r0, g0, b0]) => {
      const f = (c) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r0) + 0.7152 * f(g0) + 0.0722 * f(b0);
    };
    let bg = null;
    for (let a = el; a; a = a.parentElement) {
      const as = getComputedStyle(a);
      if (as.backgroundImage !== "none" && !a.classList.contains("bks")) break;
      const c = rgb(as.backgroundColor);
      if (c.length >= 3 && (c[3] ?? 1) >= 0.6) {
        const al = c[3] ?? 1;
        // Полупрозрачная тёмная плашка — над тёмным фоном сцены (#0e0b1e).
        bg = [c[0] * al + 14 * (1 - al), c[1] * al + 11 * (1 - al), c[2] * al + 30 * (1 - al)];
        break;
      }
      if (a.classList.contains("bks")) break;
    }
    if (bg) {
      const fg = rgb(st.color);
      const [l1, l2] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      const ratio = (l1 + 0.05) / (l2 + 0.05);
      const big = fs >= 24 || (fs >= 18.66 && Number(st.fontWeight) >= 600);
      if (ratio < (big ? 3 : 4.5)) found.push(`бледно ${ratio.toFixed(2)}: ${label(el)}`);
    }
  }
  // Надписи друг на друге (не предок и не потомок; плашка паузы лежит поверх нарочно).
  const over = (el) => Boolean(el.closest(".bks-pause, .bks-error"));
  for (let i = 0; i < leaves.length; i += 1) {
    for (let j = i + 1; j < leaves.length; j += 1) {
      const a = leaves[i];
      const b = leaves[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      if (over(a.el) !== over(b.el)) continue;
      const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (x > 2 && y > 2) found.push(`надписи наезжают: ${label(a.el)} и ${label(b.el)}`);
    }
  }
  // Корабль не наезжает на карточку своей дорожки (стоит на старте) и на финишную черту не заходит дальше носа.
  for (const lane of rootEl.querySelectorAll(".bks-lane")) {
    const card = lane.querySelector(".bks-lane__card")?.getBoundingClientRect();
    const ship = lane.querySelector(".bks-lane__ship .bks-craft")?.getBoundingClientRect();
    if (card && ship && ship.left < card.right - 1) found.push(`корабль наезжает на карточку дорожки: ${label(lane)}`);
    for (const tag of lane.querySelectorAll(".bks-tag")) {
      const t = tag.getBoundingClientRect();
      if (card && t.left < card.right - 1) found.push(`плашка наезжает на карточку: ${label(tag)}`);
      const fin = rootEl.querySelector(".bks-finish")?.getBoundingClientRect();
      if (fin && t.right > fin.left + 1 && t.left < fin.left) found.push(`плашка заходит за финиш: ${label(tag)}`);
    }
  }
  return { found: [...new Set(found)], board: rootEl.dataset.board ?? null };
}

/** Прогоны: [сценарий, параметры, ширина, высота]. */
const VIEWS = [
  [1920, 1080],
  [1280, 800],
  [1024, 768],
];
const scenarios = Object.keys(BOARD).filter((s) => !process.env.FILTER || process.env.FILTER.split(",").includes(s));
const runs = [];
for (const s of scenarios) {
  for (const crews of [1, 3, 5, 12, 20]) runs.push({ s, q: { crews }, view: VIEWS[0] });
  for (const view of VIEWS.slice(1)) for (const crews of [5, 20]) runs.push({ s, q: { crews }, view });
  for (const view of [VIEWS[0], VIEWS[2]]) for (const crews of [5, 12]) runs.push({ s, q: { crews, long: 1 }, view });
}
for (const s of ["lobby", "crews", "launch", "flight", "pull", "sos", "dock", "podium"].filter((x) => scenarios.includes(x))) {
  for (const theme of ["space", "pirates", "submarine", "wedding"]) runs.push({ s, q: { crews: 5, theme }, view: VIEWS[0] });
}
for (const s of ["flight", "finish", "reveal-seq", "meteor"].filter((x) => scenarios.includes(x))) runs.push({ s, q: { crews: 5, reduce: 1 }, view: VIEWS[0] });

const report = [];
async function one(run) {
  const [width, height] = run.view;
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: run.q.reduce ? "reduce" : "no-preference" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(`ошибка страницы: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("/fonts/")) errors.push(`консоль: ${m.text()}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().includes("/fonts/")) errors.push(`файл ${r.status()}: ${r.url().replace(/^https?:\/\/[^/]+/, "")}`);
  });
  page.on("requestfailed", (r) => errors.push(`не загрузилось: ${r.url().replace(/^https?:\/\/[^/]+/, "")}`));
  const qs = new URLSearchParams({ s: run.s, guests: "50", ...Object.fromEntries(Object.entries(run.q).map(([k, v]) => [k, String(v)])) });
  await page.goto(`http://localhost:${port}/?${qs}`);
  try {
    await page.waitForFunction(() => window.standReady === true, null, { timeout: 20000 });
  } catch {
    errors.push("стенд не дождался готовности");
  }
  // Салют живёт 1,3 с — считаем сразу после момента.
  await page.waitForTimeout(150);
  const bursts = await page.locator(".bks-burst").count();
  await page.waitForTimeout(run.s === "reveal-seq" ? 700 : 450);
  await page.evaluate(() => document.fonts.ready);
  const { found, board } = await page.evaluate(inspect);
  const want = BOARD[run.s];
  // Один экипаж без диверсанта (меньше 5 игроков) — голосования нет, «Привал» остаётся.
  const crews = run.q.crews;
  const noVote = ["vote", "reveal", "reveal-seq"].includes(run.s) && board === "dock" && crews >= 12;
  // Единственный экипаж долетел — перелёт кончился, «Привал».
  const alone = run.s === "finish" && crews === 1 && board === "dock";
  if (board !== want && !noVote && !alone) found.push(`не тот экран: ${board}, ждали ${want}`);
  if (run.s === "finish" && !alone && !run.q.reduce && bursts === 0) found.push("нет салюта на финише");
  if (run.q.reduce && bursts > 0) found.push("салют при «уменьшить движение»");
  if (run.s === "reveal-seq" && !run.q.reduce) {
    const open = await page.locator(".bks-spy.is-open").count();
    const all = await page.locator(".bks-spy").count();
    if (all > 1 && open >= all) found.push("раскрытие не по одному");
  }
  if (run.s === "pause" && !(await page.locator(".bks-pause").count())) found.push("нет плашки паузы");
  const name = `${run.s}-${Object.entries(run.q).map(([k, v]) => `${k}${v}`).join("-")}-${width}x${height}`;
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file });
  const problems = [...errors, ...found];
  report.push({ name, scenario: run.s, q: run.q, view: run.view, board, file, problems });
  console.log(`${problems.length === 0 ? "✓" : "✗"} ${name} → ${board}${problems.length ? "\n    " + problems.slice(0, 10).join("\n    ") : ""}`);
  await page.close();
}

const queue = [...runs];
await Promise.all(
  Array.from({ length: Number(process.env.PAR ?? 4) }, async () => {
    for (let run = queue.shift(); run; run = queue.shift()) await one(run);
  }),
);
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const bad = report.filter((r) => r.problems.length > 0);
console.log(`\nВидов: ${report.length}, с замечаниями: ${bad.length}`);
await browser.close();
server.close();
process.exit(bad.length > 0 ? 1 : 0);
