// Проверка экрана зала «Бубликатора» без сервера (Блок 2c): стенд `bublikator-screen.tsx` (сборка — build.mjs с
// ROBOT_ENTRY=scripts/robot/bublikator-screen.tsx) на 1920×1080, 1280×800, 1024×768 и 3840×2160, 1/3/5/8/12/20 экипажей, 50 гостей,
// длинные имена, все темы. Аудит 2c: наезды не-текста (щиты, корабли, плашки, финиш, цель), обрезка по высоте у надписей с
// многоточием, надписи нулевой ширины, круглая кнопка звука платформы (`.screen-tap`, как в HallScreen) и контраст по пикселям
// для текста над картинкой (кадр без текста, 90-й процентиль светлоты под надписью). Каждый вид — снимок и проверки: нет прокрутки, ничего не вылезает за край кадра и за свою рамку,
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
  "captain-long": "captain",
  "meteor-kids": "flight",
  "pause-rain": "flight",
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


/** Проверки аудита 2c (не-текст, высота, нулевая ширина, кнопка звука) и надписи над картинкой — для контраста по пикселям. */
function extra() {
  const found = [];
  const root = document.querySelector(".bks");
  if (!root) return { found, over: [] };
  const R = (el) => el.getBoundingClientRect();
  const lab = (el) => `${typeof el.className === "string" && el.className ? "." + el.className.split(" ")[0] : el.tagName} «${(el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 30)}»`;
  const own = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== "");
  const inter = (a, b, pad = 2) => {
    const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return x > pad && y > pad;
  };
  // Щит — эллипс: точки эллипса внутри прямоугольника; два эллипса — точка одного внутри другого.
  const ellipseHits = (e, r) => {
    const cx = (e.left + e.right) / 2;
    const cy = (e.top + e.bottom) / 2;
    for (let k = 0; k < 64; k += 1) {
      const t = (k / 64) * 2 * Math.PI;
      for (const sc of [1, 0.85, 0.6]) {
        const x = cx + Math.cos(t) * (e.width / 2) * sc;
        const y = cy + Math.sin(t) * (e.height / 2) * sc;
        if (x > r.left + 2 && x < r.right - 2 && y > r.top + 2 && y < r.bottom - 2) return true;
      }
    }
    return false;
  };
  const ellipses = (a, b) => {
    const bx = (b.left + b.right) / 2;
    const by = (b.top + b.bottom) / 2;
    for (let k = 0; k < 64; k += 1) {
      const t = (k / 64) * 2 * Math.PI;
      const x = (a.left + a.right) / 2 + Math.cos(t) * (a.width / 2);
      const y = (a.top + a.bottom) / 2 + Math.sin(t) * (a.height / 2);
      if (((x - bx) / (b.width / 2)) ** 2 + ((y - by) / (b.height / 2)) ** 2 < 0.95) return true;
    }
    return false;
  };
  const lanes = [...root.querySelectorAll(".bks-lane")];
  const fin = root.querySelector(".bks-finish");
  const goal = root.querySelector(".bks-flight .bks-goal");
  const bar = root.querySelector(".bks-flight__bar");
  lanes.forEach((la, i) => {
    const sh = la.querySelector(".bks-shield");
    const shText = la.querySelector(".bks-shield__text");
    const tag = la.querySelector(".bks-tag");
    if (sh) {
      const track = la.querySelector(".bks-lane__track");
      const s = R(sh);
      if (track && (s.top < R(track).top - 1 || s.bottom > R(track).bottom + 1)) found.push(`щит дорожки ${i + 1} выше своей дорожки`);
    }
    if (shText && tag && inter(R(shText), R(tag))) found.push(`подпись щита на плашке дорожки ${i + 1}`);
    lanes.forEach((lb, j) => {
      if (i === j) return;
      const craftB = lb.querySelector(".bks-lane__ship .bks-craft");
      const shB = lb.querySelector(".bks-shield");
      const cardB = lb.querySelector(".bks-lane__card");
      if (sh && craftB && ellipseHits(R(sh), R(craftB))) found.push(`щит дорожки ${i + 1} наезжает на корабль дорожки ${j + 1}`);
      if (sh && shB && j > i && ellipses(R(sh), R(shB))) found.push(`щиты дорожек ${i + 1} и ${j + 1} перекрываются`);
      if (sh && cardB && ellipseHits(R(sh), R(cardB))) found.push(`щит дорожки ${i + 1} на карточке дорожки ${j + 1}`);
      if (shText && craftB && inter(R(shText), R(craftB))) found.push(`подпись щита дорожки ${i + 1} на корабле дорожки ${j + 1}`);
      if (shText && shB && inter(R(shText), R(shB)) && ellipseHits(R(shB), R(shText))) found.push(`подпись щита дорожки ${i + 1} в щите дорожки ${j + 1}`);
      if (tag && craftB && inter(R(tag), R(craftB))) found.push(`плашка ${lab(tag)} дорожки ${i + 1} на корабле дорожки ${j + 1}`);
    });
    for (const el of [shText, tag].filter(Boolean)) {
      if (fin && inter(R(el), R(fin), 0)) found.push(`${lab(el)} заходит на финишную черту`);
      if (goal && inter(R(el), R(goal))) found.push(`${lab(el)} наезжает на цель`);
    }
    if (bar && sh && inter(R(sh), R(bar))) found.push(`щит дорожки ${i + 1} под плашкой события`);
  });
  const gt = root.querySelector(".bks-goal__title");
  if (fin && gt && inter(R(fin), R(gt), 0)) found.push(`название цели на финишной черте`);
  // Метеоры — только над полосой трасс: не над карточками экипажей и не за финишной чертой (аудит 2c, №14).
  const met = root.querySelector(".bks-meteors");
  const track = root.querySelector(".bks-lane__track");
  if (met && track && fin && R(met).width > 0) {
    const m = R(met);
    if (m.left < R(track).left - 2 || m.right > R(fin).left + 2) found.push("метеоры не только над трассами");
  }
  // «Беда» Притяжения — своя у каждой темы (аудит 2c, №9).
  const puller = root.querySelector(".bks-puller");
  const want = { space: "Чёрная дыра", pirates: "Кракен", submarine: "Осьминог", wedding: "Грозовая туча", newyear: "Снежный ком" }[[...root.classList].find((c) => c.startsWith("bks--"))?.slice(5) ?? ""];
  if (puller && want && puller.getAttribute("aria-label") !== want) found.push(`беда Притяжения не своей темы: ${puller.getAttribute("aria-label")}, ждали ${want}`);
  // Корабли и щиты — не на чужих кораблях (лобби, взлёт, привал — ряды кораблей).
  const crafts = [...root.querySelectorAll(".bks-craft")].filter((c) => !c.closest(".bks-lane"));
  for (let i = 0; i < crafts.length; i += 1) for (let j = i + 1; j < crafts.length; j += 1) if (inter(R(crafts[i]), R(crafts[j]), 4)) found.push(`корабли наезжают друг на друга: ${lab(crafts[i])}`);
  for (const el of root.querySelectorAll("*")) {
    if (el.closest(".bks-fx, .bks-meteors, .bks__bg, svg")) continue;
    if (!own(el)) continue;
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden") continue;
    const r = R(el);
    // Надпись есть, а места ей нет.
    if (r.width < 2 || r.height < 2) {
      found.push(`надпись нулевого размера: ${lab(el)}`);
      continue;
    }
    // Многоточие — по ширине; по высоте строка должна помещаться целиком.
    const lh = parseFloat(st.lineHeight) || parseFloat(st.fontSize) * 1.2;
    const clamp = st.webkitLineClamp !== "none" && st.webkitLineClamp !== "";
    if (st.textOverflow === "ellipsis" && !clamp && el.clientHeight + 1 < Math.min(lh, el.scrollHeight)) found.push(`строка обрезана по высоте: ${lab(el)}`);
    if (clamp && el.clientHeight + 1 < lh) found.push(`строки обрезаны по высоте: ${lab(el)}`);
  }
  // Надпись с многоточием читается: видно не меньше 4 знаков; названия экипажей на карточках — не меньше 8 (или целиком), чтобы
  // «Лисы 11» отличался от «Лисы» (повторный аудит 2c, №6, №10).
  for (const el of root.querySelectorAll("*")) {
    const st = getComputedStyle(el);
    const clamp = st.webkitLineClamp !== "none" && st.webkitLineClamp !== "";
    if (st.textOverflow !== "ellipsis" && !clamp) continue;
    const text = (el.innerText || "").trim();
    if (!text || el.children.length > 2 || el.closest(".bks-fx, .bks-meteors")) continue;
    const over = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2;
    if (!over) continue;
    const chars = [...text].length;
    const vis = Math.max(0, clamp ? Math.floor((chars * el.clientHeight) / el.scrollHeight) : Math.floor((chars * el.clientWidth) / el.scrollWidth) - 1);
    const need = el.matches(".bks-card__name, .bks-sos__name .bks-name") ? Math.min(8, chars) : 4;
    if (vis < need) found.push(`видно ~${vis} из ${chars} знаков: ${lab(el)}`);
  }
  // Круглая кнопка звука платформы.
  const tap = document.querySelector(".screen-tap");
  if (tap) {
    const t = R(tap);
    for (const el of root.querySelectorAll("*")) {
      const r = R(el);
      if (r.width === 0 || el.closest(".bks-fx, .bks-meteors, .bks__bg")) continue;
      const cls = typeof el.className === "string" ? el.className : "";
      if ((own(el) || /bks-rest__bar|bks-qr|bks-code|bks-craft|btn/.test(cls)) && inter(r, t, 3)) found.push(`кнопка звука платформы закрывает ${lab(el)}`);
    }
  }
  // Надписи без плотной подложки — для контраста по пикселям.
  const over = [];
  const rgb = (x) => (x.match(/[\d.]+/g) ?? []).map(Number);
  for (const el of root.querySelectorAll("*")) {
    if (el.closest(".bks-fx, .bks-meteors, .bks__bg, svg, .bks-pause") || !own(el)) continue;
    const r = R(el);
    if (r.width < 2 || r.height < 2) continue;
    let solid = false;
    for (let a = el; a && a !== root; a = a.parentElement) {
      const c = rgb(getComputedStyle(a).backgroundColor);
      if (c.length >= 3 && (c[3] ?? 1) >= 0.6) {
        solid = true;
        break;
      }
    }
    if (solid) continue;
    const st = getComputedStyle(el);
    over.push({ text: el.innerText.trim().replace(/\s+/g, " ").slice(0, 40), x: r.left, y: r.top, w: r.width, h: r.height, color: rgb(st.color), fs: parseFloat(st.fontSize), fw: Number(st.fontWeight) });
  }
  return { found: [...new Set(found)], over };
}

/** Контраст по пикселям: кадр без текста под прямоугольником надписи, светлота фона — 90-й процентиль. */
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
    const bg = ls[Math.max(0, Math.floor(ls.length * 0.9) - 1)];
    const fg = lum(o.color);
    const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    const big = o.fs >= 24 || (o.fs >= 18.66 && o.fw >= 600);
    if (ratio < (big ? 3 : 4.5)) found.push(`бледно над картинкой ${ratio.toFixed(2)}: «${o.text}»`);
  }
  return [...new Set(found)];
}

/** Прогоны: [сценарий, параметры, ширина, высота]. */
const VIEWS = [
  [1920, 1080],
  [1280, 800],
  [1024, 768],
  [3840, 2160],
];
const scenarios = Object.keys(BOARD).filter((s) => !process.env.FILTER || process.env.FILTER.split(",").includes(s));
const runs = [];
for (const s of scenarios) {
  for (const crews of [1, 3, 5, 8, 12, 20]) runs.push({ s, q: { crews }, view: VIEWS[0] });
  for (const view of VIEWS.slice(1, 3)) for (const crews of [5, 8, 20]) runs.push({ s, q: { crews }, view });
  for (const crews of [5, 8, 20]) runs.push({ s, q: { crews }, view: VIEWS[3] });
  for (const view of [VIEWS[0], VIEWS[2]]) for (const crews of [5, 12]) runs.push({ s, q: { crews, long: 1 }, view });
}
for (const s of ["lobby", "crews", "drill", "launch", "flight", "pull", "sos", "dock", "podium"].filter((x) => scenarios.includes(x))) {
  for (const theme of ["space", "pirates", "submarine", "wedding"]) for (const crews of [5, 20]) runs.push({ s, q: { crews, theme }, view: VIEWS[0] });
}
// Длинные названия на привале и пьедестале — переносом на две строки (аудит 2c, №17), детский дождь (№20), 4K с длинными (№18).
for (const s of ["dock", "podium"].filter((x) => scenarios.includes(x))) for (const crews of [3, 5, 8]) runs.push({ s, q: { crews, long: 1 }, view: VIEWS[0] });
for (const s of ["flight", "meteor", "dock", "podium", "lobby"].filter((x) => scenarios.includes(x))) runs.push({ s, q: { crews: 8, long: 1 }, view: VIEWS[3] });
for (const s of ["flight", "finish", "reveal-seq", "meteor"].filter((x) => scenarios.includes(x))) runs.push({ s, q: { crews: 5, reduce: 1 }, view: VIEWS[0] });
// Самые широкие названия и имена (до 30 знаков без пробелов) на 5–20 экипажах (повторный аудит 2c, №6–№9).
for (const s of ["lobby", "crews", "drill", "flight", "pull", "sos", "captain", "dock", "vote", "reveal", "podium"].filter((x) => scenarios.includes(x))) {
  for (const view of [VIEWS[0], VIEWS[2]]) for (const crews of [5, 8, 10, 12, 20]) runs.push({ s, q: { crews, wide: 1 }, view });
}
// Лобби и экипажи с длинными названиями на 7–10 экипажей (аудит 2c, №2), все темы — на щитах, событиях и шапке (№1, №9, №10).
for (const s of ["lobby", "lobby-wait", "crews"].filter((x) => scenarios.includes(x))) for (const view of [VIEWS[0], VIEWS[2]]) for (const crews of [7, 8, 10]) runs.push({ s, q: { crews, long: 1 }, view });
for (const s of ["meteor", "warn", "captain", "captain-long", "vote", "reveal"].filter((x) => scenarios.includes(x))) {
  for (const theme of ["space", "pirates", "submarine", "wedding"]) runs.push({ s, q: { crews: 8, theme }, view: VIEWS[0] });
}

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
  // Салют живёт 1,3 с: под нагрузкой кадр с ним может прийти позже снимка — считаем все вспышки с открытия страницы.
  await page.addInitScript(() => {
    window.__bursts = 0;
    new MutationObserver(() => {
      window.__bursts = Math.max(window.__bursts, document.querySelectorAll(".bks-burst").length);
    }).observe(document, { subtree: true, childList: true });
  });
  const qs = new URLSearchParams({ s: run.s, guests: "50", ...Object.fromEntries(Object.entries(run.q).map(([k, v]) => [k, String(v)])) });
  await page.goto(`http://localhost:${port}/?${qs}`);
  try {
    await page.waitForFunction(() => window.standReady === true, null, { timeout: 20000 });
  } catch {
    errors.push("стенд не дождался готовности");
  }
  if (run.s === "finish") await page.waitForFunction(() => window.__bursts > 0, null, { timeout: 2000 }).catch(() => undefined);
  else await page.waitForTimeout(150);
  const bursts = await page.evaluate(() => window.__bursts);
  await page.waitForTimeout(run.s === "reveal-seq" ? 700 : 450);
  await page.evaluate(() => document.fonts.ready);
  // Кнопка звука платформы, как в HallScreen до касания экрана.
  await page.evaluate(() => {
    const b = document.createElement("button");
    b.className = "screen-tap is-waiting";
    document.body.appendChild(b);
  });
  const { found, board } = await page.evaluate(inspect);
  const more = await page.evaluate(extra);
  found.push(...more.found);
  if (run.s === "pause-rain") {
    const want = await page.evaluate(() => window.stand.eventLeft());
    const shown = await page.locator(".bks-banner--event").innerText();
    if (want === null || !new RegExp(`(^|\\D)${want}(\\D|$)`).test(shown)) found.push(`открыли на паузе: на экране «${shown.replace(/\s+/g, " ")}», а осталось ${want} с`);
  }
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
  // Пауза: всё живое стоит — пламя, метеоры, рывки, «беда» (аудит 2c, №14).
  if (run.s === "pause" || run.s === "pause-rain") {
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && String(a.animationName ?? "").startsWith("bks-")).map((a) => a.animationName));
    if (running.length > 0) found.push(`на паузе идут анимации: ${[...new Set(running)].join(", ")}`);
  }
  const name = `${run.s}-${Object.entries(run.q).map(([k, v]) => `${k}${v}`).join("-")}-${width}x${height}`;
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file });
  if (more.over.length > 0) {
    await page.addStyleTag({ content: ".bks *{color:transparent!important;-webkit-text-fill-color:transparent!important}" });
    await page.waitForTimeout(50);
    const png = (await page.screenshot()).toString("base64");
    found.push(...(await page.evaluate(pixelContrast, { png, over: more.over })));
  }
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
