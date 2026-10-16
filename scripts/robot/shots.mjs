// Снимки экранов игр (для портфолио и сайта): робот-ведущий идёт только вперёд, на каждом новом виде —
// снимок экрана зала (1920×1080) и первого телефона. Запуск: node scripts/robot/shots.mjs <папка сборки> <папка снимков> [игры]
// Игра — «механика:шаблон:режим:гостей», например dragon:0:teams:3.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const site = path.resolve(process.argv[2] ?? "build/robot");
const out = path.resolve(process.argv[3] ?? "build/shots");
const root = path.resolve(import.meta.dirname, "../..");
const pub = path.join(root, "public");
const DEFAULT = "dragon:0:teams:3,dragon:1:teams:3,millionaire:0:teams:3,board:0:teams:3,quiz:0:solo:4,hundred:0:teams:2,lotto:0:solo:4,stage:0:teams:3,dance:0:teams:3,spy:0:solo:5,mafia:0:solo:6";
const jobs = (process.argv[4] || DEFAULT).split(",").map((s) => {
  const [m, demo = "0", mode = "teams", n = "3"] = s.split(":");
  return { m, demo, mode, n };
});
const LIMIT = Number(process.env.SHOTS_LIMIT ?? 45);

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".mp3": "audio/mpeg", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const file = [path.join(site, url === "/" ? "index.html" : url), path.join(pub, url)].find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
  if (!file) return void res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await chromium.launch({ ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });

async function shoot({ m, demo, mode, n }) {
  const name = `${m}-${demo}-${mode}`;
  const dir = path.join(out, name);
  fs.mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2, reducedMotion: "no-preference" });
  let shots = 0;
  let last = "";
  await page.exposeFunction("robotShot", async (tick) => {
    if (shots >= LIMIT) return;
    const hall = page.locator(".preview-screen").first();
    const sig = await hall.evaluate((e) => e.innerText.replace(/\s+/g, " ").slice(0, 600) + "|" + e.innerHTML.length).catch(() => "");
    if (!sig || sig === last) return;
    last = sig;
    const n3 = String(++shots).padStart(3, "0");
    await hall.screenshot({ path: path.join(dir, `${n3}-hall.jpg`), type: "jpeg", quality: 90 }).catch(() => {});
    const phone = page.locator("[data-phone]").first();
    await phone.screenshot({ path: path.join(dir, `${n3}-phone.jpg`), type: "jpeg", quality: 88 }).catch(() => {});
    console.log(`${name} #${n3} (ход ${tick})`);
  });
  try {
    await page.goto(`http://localhost:${port}/?m=${m}&mode=${mode}&n=${n}&seed=1&demo=${demo}&budget=${process.env.BUDGET ?? 90}&shots=1`);
    await page.waitForFunction(() => window.robotDone === true, null, { timeout: Number(process.env.TIMEOUT ?? 600_000), polling: 1000 });
  } catch (e) {
    console.log(`${name}: ${String(e).slice(0, 200)}`);
  }
  console.log(`${name}: снимков ${shots}`);
  await page.close();
}
let next = 0;
await Promise.all(Array.from({ length: Number(process.env.PAR ?? 4) }, async () => {
  while (next < jobs.length) await shoot(jobs[next++]);
}));
await browser.close();
server.close();
