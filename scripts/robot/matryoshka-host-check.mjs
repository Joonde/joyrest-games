import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const site = path.resolve(process.argv[2] ?? "build/matryoshka-host");
const out = path.resolve(process.argv[3] ?? "build/matryoshka-host-shots");
const pub = path.resolve("public");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(site, "index.html"), `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/robot.css"></head><body><div id="root"></div><script type="module" src="/robot.js"></script></body></html>`);
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webp": "image/webp", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const file = [path.join(site, url === "/" ? "index.html" : url), path.join(pub, url)].find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
  if (!file) return void res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
page.on("response", (r) => { if (r.status() === 404) errors.push(`404: ${r.url()}`); });

async function ready() {
  await page.waitForFunction(() => window.standReady === true);
  await page.evaluate(() => document.fonts.ready);
}
async function shot(name) {
  await page.waitForTimeout(220);
  const layout = await page.evaluate(() => {
    const vw = innerWidth;
    const small = [...document.querySelectorAll("button, input:not([type=radio]):not([type=checkbox])")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44);
    }).map((el) => `${el.textContent || el.getAttribute("aria-label")}: ${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`);
    return { scroll: document.documentElement.scrollWidth, vw, small };
  });
  if (layout.scroll > layout.vw + 1) errors.push(`${name}: прокрутка вбок ${layout.scroll}>${layout.vw}`);
  if (layout.small.length) errors.push(`${name}: мелкие цели ${layout.small.join(", ")}`);
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
}
async function step(ms) { await page.evaluate((n) => window.standStep(n), ms); }
async function phase(value) { await page.waitForFunction((p) => window.stand.w.s.phase === p, value); }

await page.goto(`http://127.0.0.1:${port}/?fresh=1`, { waitUntil: "networkidle" });
await ready();
await shot("01-lobby-1280");
await page.getByRole("button", { name: "Начать игру", exact: true }).click();
await step(6000);
await shot("02-rules-1280");
await page.getByRole("button", { name: "Пропустить правило", exact: true }).click();
await step(3000);
await phase("trial");
await shot("03-freeze-1280");
await page.getByRole("button", { name: /\+10 секунд/ }).click();
await page.waitForTimeout(100);
const extra = await page.evaluate(() => window.stand.w.s.trial?.play?.extra);
if (extra !== 10_000) errors.push(`+10 секунд: extra=${extra}`);
await page.getByRole("button", { name: "⏸ Пауза", exact: true }).click();
const pausedEnds = await page.evaluate(() => window.stand.w.host().endsAt);
await step(5000);
const pausedEndsAfter = await page.evaluate(() => window.stand.w.host().endsAt);
if (pausedEnds !== pausedEndsAfter) errors.push("таймер на паузе сдвинулся");
await shot("04-pause-1280");
await page.getByRole("button", { name: "▶ Продолжить игру", exact: true }).click();
await step(1000);
await page.evaluate(() => { window.stand.w.offline.add("p1"); window.stand.flushHost(); });
await page.getByRole("button", { name: /Игроки ·/ }).click();
await page.getByRole("button", { name: "Без связи", exact: true }).click();
await shot("05-players-offline-1280");
await page.getByRole("button", { name: "К текущему этапу", exact: true }).click();
await page.getByRole("button", { name: "Закончить сейчас", exact: true }).click();
await page.getByRole("button", { name: "Закончить сейчас", exact: true }).last().click();
await step(15_000);
await shot("06-results-1280");

const finalPhase = await page.evaluate(() => window.standDriveTo("final"));
if (finalPhase !== "final") errors.push(`не дошли до финала: ${finalPhase}`);
await shot("07-final-1280");
await page.getByRole("button", { name: /Начать/ }).click();
await shot("08-duel-1280");
const podiumPhase = await page.evaluate(() => window.standDriveTo("podium"));
if (podiumPhase !== "podium") errors.push(`не дошли до пьедестала: ${podiumPhase}`);
await shot("09-podium-1280");
await page.getByRole("button", { name: "Сохранить итоги и завершить", exact: true }).click();
if ((await page.evaluate(() => window.standFinished())) !== 1) errors.push("завершение не вызвано");

await page.setViewportSize({ width: 360, height: 780 });
await page.goto(`http://127.0.0.1:${port}/?fresh=1&long=1`, { waitUntil: "networkidle" });
await ready();
await shot("10-lobby-360");
await page.getByRole("button", { name: "Начать игру", exact: true }).click();
await step(6000);
await shot("11-rules-360");
await page.setViewportSize({ width: 768, height: 1024 });
await shot("12-rules-768");

await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`http://127.0.0.1:${port}/?s=editor`, { waitUntil: "networkidle" });
await ready();
await shot("13-editor-1280");
await page.getByRole("radio", { name: /Ночной двор · хохлома/ }).check();
const night = await page.evaluate(() => ({ style: window.content.style, lives: window.content.lives }));
if (night.style !== "night" || night.lives !== 1) errors.push(`конструктор: ночной двор не применился ${JSON.stringify(night)}`);
await page.goto(`http://127.0.0.1:${port}/?s=editor&bad=1`, { waitUntil: "networkidle" });
await ready();
if ((await page.evaluate(() => window.errors.length)) === 0) errors.push("конструктор: неполный вопрос не отмечен");
await shot("14-editor-invalid-1280");
await page.setViewportSize({ width: 360, height: 780 });
await shot("15-editor-invalid-360");

await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`http://127.0.0.1:${port}/?s=preview`, { waitUntil: "networkidle" });
await ready();
await page.waitForSelector(".matpv");
await page.waitForTimeout(1000);
await shot("16-preview-screen-1280");
await page.getByRole("tab", { name: "Телефон", exact: true }).click();
await page.waitForSelector(".mtp");
await shot("17-preview-phone-1280");
await page.getByRole("tab", { name: "Пульт", exact: true }).click();
await page.waitForSelector(".math-head");
await shot("18-preview-host-1280");

await browser.close();
server.close();
console.log(`снимки: ${out}`);
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("браузерный стенд: ошибок 0, 404: 0");
