// Проверка жребия «Аукциона»: монетка, колесо фортуны, барабан × число имён × тема × середина вращения и итог.
// node scripts/robot/draw-check.mjs <папка сборки> <папка снимков>. Сборка: ROBOT_ENTRY=scripts/robot/draw-check.tsx.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const site = path.resolve(process.argv[2] ?? "build/draw");
const shots = path.resolve(process.argv[3] ?? path.join(site, "shots"));
fs.mkdirSync(shots, { recursive: true });
const pub = path.resolve(import.meta.dirname, "../../public");
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
const cases = [];
for (const effect of ["coin", "wheel", "reel"])
  for (const n of [2, 3, 4, 8, 12, 13])
    for (const theme of ["joyrest", "joyrest-day"]) {
      cases.push({ effect, n, theme, left: 2600, long: n === 4 ? 1 : 0, win: n - 1 });
      cases.push({ effect, n, theme, left: -500, long: n === 4 ? 1 : 0, win: n - 1 });
    }
for (const view of [{ width: 1920, height: 1080 }, { width: 1024, height: 768 }])
  for (const c of cases) {
    if (view.width !== 1920 && c.theme !== "joyrest") continue;
    const page = await browser.newPage({ viewport: view });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.clock.install({ time: new Date("2026-10-23T12:00:00Z") });
    const name = `${c.effect}-${c.n}-${c.theme}-${c.left > 0 ? "spin" : "done"}-${view.width}`;
    await page.goto(`http://127.0.0.1:${port}/?effect=${c.effect}&n=${c.n}&theme=${c.theme}&left=${c.left}&long=${c.long}&win=${c.win}`);
    await page.clock.runFor(200);
    await page.waitForSelector(".slide--draw");
    await page.evaluate(() => document.fonts.ready);
    const r = await page.evaluate(({ effect, n, done }) => {
      const bad = [];
      const winner = window.drawWinner;
      const vw = innerWidth;
      const vh = innerHeight;
      const effectual = effect === "wheel" && n > 12 ? "coin" : effect;
      if (!document.querySelector(`.slide--draw-${effectual}`)) bad.push(`нет эффекта ${effectual}`);
      if (done) {
        const title = document.querySelector(".draw-winner")?.textContent ?? "";
        if (title !== winner) bad.push(`победитель «${title}» вместо «${winner}»`);
        if (effectual === "wheel") {
          const w = document.querySelector(".draw-wheel__seg.is-win text")?.textContent ?? "";
          if (!winner.startsWith(w.replace("…", ""))) bad.push(`под стрелкой «${w}»`);
          // Стрелка над серединой выигравшего сектора: центр сектора ближе всех к верхней точке колеса.
          const svg = document.querySelector(".draw-wheel__svg").getBoundingClientRect();
          const segs = [...document.querySelectorAll(".draw-wheel__seg text")].map((t) => ({ t: t.textContent, y: t.getBoundingClientRect().top }));
          const top = segs.sort((a, b) => a.y - b.y)[0];
          if (top && !winner.startsWith(top.t.replace("…", ""))) bad.push(`сверху сектор «${top.t}»`);
          if (svg.top < 0 || svg.bottom > vh) bad.push("колесо за краем экрана");
        }
        if (effectual === "reel") {
          const now = document.querySelector(".draw-reel__row.is-now")?.textContent ?? "";
          if (now !== winner) bad.push(`в окне барабана «${now}»`);
        }
        if (effectual === "coin") {
          const now = document.querySelector(".draw-coin__name")?.textContent ?? "";
          if (now !== winner) bad.push(`на монетке «${now}»`);
        }
      }
      for (const el of document.querySelectorAll(".slide *")) {
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height || el.closest("svg") || el.closest(".confetti")) continue;
        if (b.left < -1 || b.right > vw + 1 || b.top < -1 || b.bottom > vh + 1) bad.push(`за краем: ${el.className || el.tagName} «${(el.textContent ?? "").slice(0, 30)}»`);
        const cs = getComputedStyle(el);
        if (el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== "ellipsis" && cs.overflow !== "visible" && el.children.length === 0) bad.push(`обрезан текст: ${el.className}`);
      }
      return bad;
    }, { effect: c.effect, n: c.n, done: c.left < 0 });
    await page.screenshot({ path: path.join(shots, `${name}.png`) });
    if (c.left > 0) {
      // Во время вращения кадр меняется (колесо и барабан не стоят).
      const a = await page.screenshot();
      await page.clock.runFor(400);
      const b = await page.screenshot();
      if (a.equals(b)) r.push("кадр не меняется во время вращения");
    }
    for (const x of [...r, ...errors]) problems.push(`${name}: ${x}`);
    await page.close();
  }
await browser.close();
server.close();
fs.writeFileSync(path.join(shots, "report.json"), JSON.stringify({ cases: cases.length, problems }, null, 1));
console.log(problems.length ? problems.join("\n") : "Проблем не найдено");
console.log(`Проверено кадров: ${cases.length + cases.filter((c) => c.theme === "joyrest").length}`);
process.exit(problems.length ? 1 : 0);
