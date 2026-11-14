// Проверка телефона «Игр Матрёшки» без сервера (Блок 3b): стенд `matryoshka-phone.tsx` (сборка — build.mjs с
// ROBOT_ENTRY=scripts/robot/matryoshka-phone.tsx).
//   node scripts/robot/matryoshka-phone.mjs <папка сборки> <папка снимков> [scenes|glitch|live|all]
// • scenes — каждая сцена на 360, 390 и 412 px в обоих дворах: снимок и проверки — нет прокрутки вбок, ничего не вылезает за
//   край и не наезжает, кнопки не меньше 52 px (плитки выбора — 44), контраст текста не меньше 4,5 (крупного — 3), нет ошибок
//   страницы и мусора (undefined, NaN, null, [object …]).
// • glitch — зона «Замри!» настоящими событиями указателя: pointercancel, палец съехал, второй палец, скрытая страница, потеря
//   фокуса, прокрутка, «нет сети» — каждый раз «отпустил» уходит в комнату.
// • live — игра на 50: настоящий движок комнаты (server/src/rooms/engine.ts) в этом процессе, 47 ботов, три настоящих телефона в
//   браузере (360, 390, 412 px), Playwright играет ими по экрану — до пьедестала.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const site = path.resolve(process.argv[2] ?? "build/matryoshka-phone");
const out = path.resolve(process.argv[3] ?? "build/matryoshka-phone-shots");
const mode = process.argv[4] ?? "all";
const root = path.resolve(import.meta.dirname, "../..");
const pub = path.join(root, "public");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(site, "index.html"),
  `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><link rel="stylesheet" href="/robot.css"></head><body><div id="root"></div><script type="module" src="/robot.js"></script></body></html>`,
);

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webp": "image/webp", ".png": "image/png" };
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
const problems = [];
const note = (where, what) => {
  problems.push(`${where}: ${what}`);
  console.log(`  ✗ ${where}: ${what}`);
};

/** Проверки раскладки внутри страницы. */
function inspect() {
  const found = [];
  const vw = window.innerWidth;
  const doc = document.documentElement;
  if (doc.scrollWidth > vw + 1) found.push(`прокрутка вбок: ${doc.scrollWidth} > ${vw}`);
  const text = document.body.innerText;
  for (const bad of ["undefined", "NaN", "[object", "null"]) if (text.includes(bad)) found.push(`мусор в тексте: «${bad}»`);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none" && Number(st.opacity) > 0;
  };
  const label = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""} «${(el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 30)}»`;
  for (const el of document.querySelectorAll("button, [role=radio], [role=button], a")) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    const chip = el.getAttribute("role") === "radio" || el.classList.contains("mtp-chair");
    const min = chip ? 44 : 52;
    if (r.height < min - 0.5 || r.width < 44) found.push(`маленькая кнопка ${Math.round(r.width)}×${Math.round(r.height)}: ${label(el)}`);
  }
  // Анимации — только transform и opacity.
  for (const el of document.querySelectorAll(".mtp *")) {
    const t = getComputedStyle(el).transitionProperty;
    if (/box-shadow|width|height|top|left/.test(t) && getComputedStyle(el).transitionDuration !== "0s") found.push(`анимация не transform/opacity: ${t} у ${label(el)}`);
  }
  const leaves = [];
  for (const el of document.querySelectorAll(".mtp *")) {
    if (!visible(el) || el.closest("svg")) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) found.push(`за краем экрана: ${label(el)} (${Math.round(r.left)}…${Math.round(r.right)})`);
    const st = getComputedStyle(el);
    const clipX = st.overflowX === "hidden" || st.overflow === "hidden";
    if (clipX && el.scrollWidth > el.clientWidth + 1 && st.textOverflow !== "ellipsis" && el.children.length === 0) found.push(`текст обрезан: ${label(el)}`);
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== "");
    if (own) leaves.push({ el, r });
  }
  // Надписи друг на друге.
  for (let i = 0; i < leaves.length; i += 1) {
    for (let j = i + 1; j < leaves.length; j += 1) {
      const a = leaves[i];
      const b = leaves[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (w > 4 && h > 4) found.push(`наезжают: ${label(a.el)} и ${label(b.el)}`);
    }
  }
  // Контраст текста с фоном (фон — первый непрозрачный у предков; над картинкой и градиентом не судим).
  const rgb = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const mix = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const bgOf = (el) => {
    const stack = [];
    for (let e = el; e; e = e.parentElement) {
      const st = getComputedStyle(e);
      if (st.backgroundImage && st.backgroundImage !== "none" && !e.classList.contains("mtp")) return null;
      const c = rgb(st.backgroundColor);
      if (c && c.a > 0) {
        stack.push(c);
        if (c.a >= 0.99) break;
      }
    }
    if (stack.length === 0) return null;
    let col = stack[stack.length - 1];
    if (col.a < 0.99) col = mix(col, { r: 255, g: 255, b: 255, a: 1 });
    for (let k = stack.length - 2; k >= 0; k -= 1) col = mix(stack[k], col);
    return col;
  };
  for (const { el } of leaves) {
    if (el.closest("button:disabled, [aria-disabled=true], .mtp-zone[data-state=off], .mtp-cell:disabled, .mtp-option:disabled")) continue;
    const st = getComputedStyle(el);
    const fg = rgb(st.color);
    const bg = bgOf(el);
    if (!fg || !bg) continue;
    const L1 = lum(fg.a < 1 ? mix(fg, bg) : fg);
    const L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(st.fontSize);
    const bold = Number(st.fontWeight) >= 600;
    const large = size >= 24 || (bold && size >= 18.66);
    if (ratio < (large ? 3 : 4.5)) found.push(`бледный текст ${ratio.toFixed(2)}: ${label(el)}`);
  }
  return found;
}

const SCENES = [
  "lobby",
  "late-fan",
  "intro",
  "guess",
  "countdown",
  "freeze-run",
  "freeze-gaze",
  "freeze-caught",
  "freeze-finished",
  "ginger-pick",
  "ginger-unbox",
  "ginger-trace",
  "ginger-crack",
  "ginger-done",
  "chairs-music",
  "chairs-stop",
  "chairs-tap",
  "chairs-seated",
  "chairs-missed",
  "rope",
  "rope-fan",
  "hop-brave",
  "hop-jump",
  "hop-choose",
  "hop-crack",
  "hop-fell",
  "judging",
  "result-pass",
  "result-heart",
  "result-out",
  "result-fan",
  "chance-offer",
  "chance-question",
  "chance-back",
  "chance-wait",
  "dob-intro",
  "dob-choose",
  "dob-results",
  "bracket",
  "duel",
  "duel-show",
  "bet",
  "duel-watch",
  "champion",
  "podium",
  "pause",
  "connecting",
  "tab",
  "removed",
];
const WIDTHS = (process.env.WIDTHS ?? "360,390,412").split(",").map(Number);
const STYLES = (process.env.STYLES ?? "sunny,night").split(",");
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;

async function openScene(scene, style, width, height = 780) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`http://127.0.0.1:${port}/?s=${scene}&style=${style}`, { timeout: 120_000 });
  await page.waitForFunction(() => window.standReady === true, null, { timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
  return { page, errors };
}

async function scenes() {
  for (const scene of SCENES) {
    if (ONLY && !ONLY.includes(scene)) continue;
    for (const style of STYLES) {
      for (const width of WIDTHS) {
        const where = `${scene} · ${style} · ${width}`;
        const { page, errors } = await openScene(scene, style, width);
        // «Держу — бегу»: палец на зоне (как в макете ph-freeze-hold).
        if (scene === "freeze-run") {
          const z = await page.locator(".mtp-zone").boundingBox();
          if (z) {
            await page.mouse.move(z.x + z.width / 2, z.y + z.height / 2);
            await page.mouse.down();
            await page.waitForTimeout(250);
          }
        }
        // Обводка: палец идёт по контуру до половины.
        if (scene === "ginger-trace") await traceShape(page, 0.55);
        const screen = await page.evaluate(() => window.stand.screen());
        const found = await page.evaluate(inspect);
        for (const f of found) note(where, f);
        for (const e of errors) note(where, `ошибка страницы: ${e}`);
        await page.screenshot({ path: path.join(out, `${scene}-${style}-${width}.png`), fullPage: true });
        if (scene === "freeze-run") await page.mouse.up();
        console.log(`${found.length + errors.length === 0 ? "✓" : "•"} ${where} → ${screen}`);
        await page.close();
      }
    }
  }
}

/** Провести пальцем (мышью) по контуру фигуры: точки контура — из правил (`data-points` поля — id фигуры). */
async function traceShape(page, share, opts = {}) {
  const box = await page.locator(".mtp-field").boundingBox();
  const pts = await page.evaluate(() => window.shapePoints?.() ?? null);
  if (!box || !pts) return;
  const n = Math.floor(pts.length * share);
  const at = (p) => [box.x + p[0] * box.width + (opts.jitter ?? 0) * (Math.random() - 0.5) * box.width, box.y + p[1] * box.width];
  const [x0, y0] = at(pts[0]);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= n; i += 1) {
    const [x, y] = at(pts[i % pts.length]);
    await page.mouse.move(x, y, { steps: opts.steps ?? 2 });
  }
  if (opts.keep !== true) await page.mouse.up();
}

// ------------------------------------------------------------------ сбои зоны «Замри!»

async function glitch() {
  const cases = [
    { name: "pointercancel", run: async (page, z) => page.dispatchEvent(".mtp-zone", "pointercancel", { pointerId: 1, bubbles: true }) },
    { name: "палец съехал с зоны", run: async (page, z) => page.mouse.move(z.x + z.width / 2, z.y - 60, { steps: 4 }) },
    {
      name: "страница скрыта",
      run: async (page) =>
        page.evaluate(() => {
          Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
          document.dispatchEvent(new Event("visibilitychange"));
        }),
    },
    { name: "потеря фокуса (уведомление)", run: async (page) => page.evaluate(() => window.dispatchEvent(new Event("blur"))) },
    { name: "прокрутка", run: async (page) => page.evaluate(() => window.dispatchEvent(new Event("scroll"))) },
    { name: "нет сети", run: async (page) => page.evaluate(() => window.dispatchEvent(new Event("offline"))) },
    { name: "сон (пропуск тиков)", run: async (page) => page.evaluate(() => { const t = performance.now(); while (performance.now() - t < 1500) {} }) },
    { name: "пауза", run: async (page) => page.evaluate(() => window.stand.pause()) },
  ];
  for (const c of cases) {
    const { page, errors } = await openScene("freeze-run", "sunny", 390);
    const z = await page.locator(".mtp-zone").boundingBox();
    await page.mouse.move(z.x + z.width / 2, z.y + z.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(120);
    const before = await page.evaluate(() => window.pushes.filter((p) => p.event.t === "h").map((p) => p.event.on));
    await c.run(page, z);
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => window.pushes.filter((p) => p.event.t === "h").map((p) => ({ on: p.event.on, now: p.now, st: typeof p.event.st === "number" })));
    const tail = after.slice(before.length).filter((x) => x.now);
    const state = await page.evaluate(() => document.querySelector(".mtp-zone")?.getAttribute("data-state"));
    const server = await page.evaluate(() => window.stand.server());
    const ok = before.at(-1) === true && tail.length >= 1 && tail.at(-1).on === false && tail.every((x) => x.st) && state !== "run";
    // После сбоя тот же палец не бежит — нужно новое касание.
    await page.mouse.move(z.x + z.width / 2, z.y + z.height / 2 + 10);
    await page.waitForTimeout(150);
    const stillStand = (await page.evaluate(() => document.querySelector(".mtp-zone")?.getAttribute("data-state"))) !== "run";
    await page.mouse.up();
    if (!ok) note(`сбой «${c.name}»`, `нет «отпустил»: до ${JSON.stringify(before)}, после ${JSON.stringify(tail)}, зона ${state}`);
    else if (!stillStand) note(`сбой «${c.name}»`, "лежащий палец снова побежал без нового касания");
    else console.log(`✓ сбой «${c.name}» → «отпустил» (st), зона «${state}», комната: держит ${server.holding}`);
    for (const e of errors) note(`сбой «${c.name}»`, `ошибка страницы: ${e}`);
    if (c.name === "pointercancel") await page.screenshot({ path: path.join(out, `glitch-cancel.png`) });
    await page.close();
  }
  // Второй палец и ладонь (касания CDP): первый держит, второй не в счёт; поднял первый — «отпустил».
  {
    const { page } = await openScene("freeze-run", "night", 390);
    const z = await page.locator(".mtp-zone").boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const p1 = { x: z.x + z.width * 0.3, y: z.y + z.height * 0.5, id: 1 };
    const p2 = { x: z.x + z.width * 0.7, y: z.y + z.height * 0.6, id: 2 };
    const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
    await touch("touchStart", [p1]);
    await page.waitForTimeout(80);
    await touch("touchStart", [p1, p2]);
    await page.waitForTimeout(80);
    await touch("touchEnd", [p2]);
    await page.waitForTimeout(80);
    const mid = await page.evaluate(() => document.querySelector(".mtp-zone")?.getAttribute("data-state"));
    await touch("touchEnd", []);
    await page.waitForTimeout(120);
    const end = await page.evaluate(() => document.querySelector(".mtp-zone")?.getAttribute("data-state"));
    const hs = await page.evaluate(() => window.pushes.filter((p) => p.event.t === "h" && p.now).map((p) => p.event.on));
    if (mid !== "run" || end === "run" || JSON.stringify(hs) !== "[true,false]") note("второй палец", `середина ${mid}, конец ${end}, ушло ${JSON.stringify(hs)}`);
    else console.log("✓ второй палец не в счёт; поднял первый — «отпустил»");
    await page.close();
  }
  // Поворот по сверенным часам телефона: в назначенный T — вспышка зоны и «ЗАМРИ!».
  {
    const { page } = await openScene("freeze-gaze", "sunny", 390);
    const st = await page.evaluate(() => ({ zone: document.querySelector(".mtp-zone")?.getAttribute("data-state"), banner: document.querySelector(".mtp-banner")?.textContent }));
    if (st.zone !== "look" || !/замри/i.test(st.banner ?? "")) note("поворот", `зона ${st.zone}, плашка ${st.banner}`);
    else console.log("✓ поворот: зона «смотрит», плашка «ЗАМРИ!»");
    await page.close();
  }
}

async function main() {
  if (mode === "scenes" || mode === "all") await scenes();
  if (mode === "glitch" || mode === "all") await glitch();
  if (mode === "live" || mode === "all") {
    const { live } = await import("./matryoshka-live.mjs");
    await live({ browser, port, out, note, traceShape });
  }
  await browser.close();
  server.close();
  fs.writeFileSync(path.join(out, "problems.txt"), problems.join("\n") + "\n");
  console.log(`\nзамечаний: ${problems.length}`);
  process.exitCode = problems.length > 0 ? 1 : 0;
}
await main();
