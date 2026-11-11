// Проверка lazy-чанка телефона «Бубликатора» (аудит 2b, круг 2, №2). Сборка:
//   ROBOT_SPLIT=1 ROBOT_ENTRY=scripts/robot/bublikator-lazy.tsx node scripts/robot/build.mjs <папка>
//   node scripts/robot/bublikator-lazy.mjs <папка> [снимки]
// Случаи: чанк скачался; первый раз оборвался — повтор сам; не скачивается — «Не загрузилось — Повторить», шапка на месте,
// сеть вернулась — «Повторить» открывает игру.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const site = path.resolve(process.argv[2] ?? "build/bublikator-lazy");
const out = path.resolve(process.argv[3] ?? path.join(site, "shots"));
const pub = path.resolve(import.meta.dirname, "../../public");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(site, "index.html"),
  `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/robot.css"></head><body><div id="root"></div><script type="module" src="/robot.js"></script></body></html>`,
);
const chunk = fs.readdirSync(site).find((f) => f.startsWith("chunk-PlayerView") && f.endsWith(".js"));
if (!chunk) throw new Error("нет чанка телефона — собрано без ROBOT_SPLIT=1?");
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const file = [path.join(site, url === "/" ? "index.html" : url), path.join(pub, url)].find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
  if (!file) return void res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const problems = [];
async function run(name, failFirst, after) {
  const page = await browser.newPage({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let fails = 0;
  await page.route(`**/${chunk}*`, (r) => {
    if (fails < failFirst) {
      fails += 1;
      return r.abort("connectionreset");
    }
    return r.continue();
  });
  await page.goto(`http://localhost:${server.address().port}/`);
  const result = await after(page, () => (failFirst = 0));
  await page.screenshot({ path: path.join(out, `lazy-${name}.png`) });
  if (!(await page.locator("#app-alive").isVisible())) result.push("пропала шапка платформы");
  for (const e of errors) if (!/Failed to fetch|dynamically imported|Importing a module/.test(e)) result.push(`ошибка страницы: ${e}`);
  console.log(`${result.length ? "✗" : "✓"} ${name}${result.length ? "\n    " + result.join("\n    ") : ""}`);
  problems.push(...result.map((x) => `${name}: ${x}`));
  await page.close();
}
const phone = (p) => p.locator(".bkp-root").waitFor({ timeout: 8000 }).then(() => true, () => false);
await run("ok", 0, async (p) => ((await phone(p)) ? [] : ["телефон не открылся"]));
await run("retry", 1, async (p) => {
  const bad = (await phone(p)) ? [] : ["после обрыва не повторил сам"];
  if (await p.getByText("Не загрузилось").count()) bad.push("показал «Не загрузилось», хотя повтор удался");
  return bad;
});
await run("fail", 99, async (p, unblock) => {
  const bad = [];
  try {
    await p.getByText("Не загрузилось").waitFor({ timeout: 15000 });
  } catch {
    bad.push("нет «Не загрузилось» — пустая страница");
    return bad;
  }
  const btn = p.getByRole("button", { name: "Повторить" });
  const box = await btn.boundingBox();
  if (!box || box.height < 52) bad.push(`кнопка «Повторить» ${box ? Math.round(box.height) : "нет"} px`);
  await p.screenshot({ path: path.join(out, "lazy-fail-error.png") });
  unblock();
  await btn.tap();
  if (!(await phone(p))) bad.push("«Повторить» не открыло игру после возврата сети");
  return bad;
});
console.log(`\nСлучаев: 3, с замечаниями: ${problems.length ? new Set(problems.map((x) => x.split(":")[0])).size : 0}`);
await browser.close();
server.close();
process.exit(problems.length ? 1 : 0);
