// Прогон робота-ведущего по всем играм: node scripts/robot/run.mjs <папка сборки> [отчёт.json] [игры через запятую]
// Каждая игра — каждый шаблон × режим (каждый сам / команды) × несколько составов и случайных сценариев.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const site = path.resolve(process.argv[2] ?? "build/robot");
const out = process.argv[3] ?? path.join(site, "report.json");
const only = process.argv[4] ? process.argv[4].split(",") : null;
const root = path.resolve(import.meta.dirname, "../..");
const pub = path.join(root, "public");

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webp": "image/webp", ".png": "image/png", ".mp3": "audio/mpeg", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const candidates = [path.join(site, url === "/" ? "index.html" : url), path.join(pub, url)];
  const file = candidates.find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
  if (!file) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const MECHANICS = {
  quiz: { modes: ["solo", "teams"], demos: 2 },
  lotto: { modes: ["solo", "teams"], demos: 1 },
  board: { modes: ["solo", "teams"], demos: 1 },
  checkers: { modes: ["teams"], demos: 1, players: [2] },
  dance: { modes: ["teams"], demos: 1 },
  stage: { modes: ["teams", "solo"], demos: 2 },
  quest: { modes: ["teams"], demos: 2 },
  millionaire: { modes: ["teams", "solo"], demos: 1 },
  survival: { modes: ["teams"], demos: 1 },
  dragon: { modes: ["teams"], demos: 2 },
  mafia: { modes: ["solo"], demos: 1, players: [6, 9] },
  bunker: { modes: ["solo"], demos: 1, players: [5, 8] },
  durak: { modes: ["solo"], demos: 1, players: [2, 4] },
  truth: { modes: ["solo", "teams"], demos: 2 },
  perudo: { modes: ["solo", "teams"], demos: 1, players: [2, 4] },
  wager: { modes: ["teams", "solo"], demos: 1 },
  story: { modes: ["solo", "teams"], demos: 1, players: [4, 6] },
  olymp: { modes: ["teams"], demos: 2, players: [1, 3] },
};

const browser = await chromium.launch({ ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ["--no-sandbox"] });
const reports = [];
const jobs = [];
for (const [m, cfg] of Object.entries(MECHANICS)) {
  if (only && !only.includes(m)) continue;
  for (let demo = 0; demo < cfg.demos; demo++)
    for (const mode of cfg.modes) for (const n of cfg.players ?? [3]) for (const seed of [1, 2, 3]) jobs.push({ m, demo, mode, n, seed });
}
async function runJob({ m, demo, mode, n, seed }) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 300)));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/Failed to load resource|favicon/.test(msg.text())) consoleErrors.push(msg.text().slice(0, 300));
  });
  const url = `http://localhost:${port}/?m=${m}&mode=${mode}&n=${n}&seed=${seed}&demo=${demo}&budget=${process.env.BUDGET ?? 400}`;
  let report;
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.robotDone === true, null, { timeout: Number(process.env.TIMEOUT ?? 240_000), polling: 500 });
    report = await page.evaluate(() => window.robotReport);
  } catch (e) {
    report = await page.evaluate(() => window.robotReport).catch(() => null);
    report = { ...(report ?? { mechanic: m, mode, players: n, seed }), timeout: String(e).slice(0, 200) };
  }
  report.url = url;
  report.console = [...new Set(consoleErrors)].slice(0, 10);
  reports.push(report);
  const bad = (report.errors?.length ?? 0) + report.console.length + (report.stuck ? 1 : 0) + (report.timeout ? 1 : 0);
  console.log(`${bad ? "✗" : "✓"} ${m} ${report.demo ?? demo} ${mode} ×${n} #${seed}: ходов ${report.ticks}, ${report.finished ? "до финала" : "не дошла"}${bad ? ` — ошибок ${bad}` : ""}`);
  await page.close();
}
const PAR = Number(process.env.PAR ?? 4);
let next = 0;
await Promise.all(Array.from({ length: PAR }, async () => {
  while (next < jobs.length) await runJob(jobs[next++]);
}));
await browser.close();
server.close();
fs.writeFileSync(out, JSON.stringify(reports, null, 1));
console.log("отчёт:", out);
