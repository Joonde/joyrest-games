// «Ревизор» (CLAUDE.md, раздел 9): робот-ведущий проводит каждую игру, а на каждом новом виде смотрит глазами людей —
// настоящий экран зала на размере телевизора, ноутбука и проектора, пульт и телефоны гостей в обёртке настоящих страниц.
// Находки (inspect.ts) склеиваются по месту и виду проблемы, у каждой — снимок с красной рамкой вокруг виноватого
// элемента. Плюс то, что видно только снаружи страницы: файлы, которых нет на сервере (404), и ошибки страницы.
//
// Сборка: node scripts/robot/build.mjs <папка>. Запуск: node scripts/robot/inspect.mjs <папка сборки> <папка отчёта> [игры]
// PROFILES — размеры (по умолчанию tv,projector,laptop), BUDGET — ходов на игру, PAR — сколько игр сразу.
// Итог: <отчёт>/README.md (по-русски, со снимками — открывается в GitHub с телефона), findings.json, summary.md.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";
import { MECHANICS } from "./games.mjs";

const site = path.resolve(process.argv[2] ?? "build/robot");
const out = path.resolve(process.argv[3] ?? "build/inspect");
const only = process.argv[4] ? process.argv[4].split(",").filter(Boolean) : null;
const root = path.resolve(import.meta.dirname, "../..");
const pub = path.join(root, "public");
fs.mkdirSync(path.join(out, "shots"), { recursive: true });
// Галерея — снимок экрана зала на каждом новом виде (только `tv`), отдельной папкой: в ветку e2e-shots не идёт.
const GALLERY = process.env.GALLERY ? path.resolve(process.env.GALLERY) : null;
if (GALLERY) fs.mkdirSync(GALLERY, { recursive: true });

/** Размеры. Экран зала — окно браузера целиком (vw, vh, cqw как на настоящем экране). */
const PROFILES = {
  tv: { title: "Телевизор Full HD", hall: "1920x1080", host: 390, phone: 360, names: "short", crowd: false },
  projector: { title: "Проектор 4:3, маленький телефон, длинные имена", hall: "1024x768", host: 360, phone: 320, names: "long", crowd: false },
  laptop: { title: "Ноутбук 16:10, большой зал, длинные имена", hall: "1280x800", host: 390, phone: 375, names: "long", crowd: true },
};
const wanted = (process.env.PROFILES ?? "tv,projector,laptop").split(",").filter((p) => PROFILES[p]);

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".mp3": "audio/mpeg", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const file = [path.join(site, url === "/" ? "index.html" : url), path.join(pub, url)].find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
  if (!file) return void res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const jobs = [];
for (const [m, cfg] of Object.entries(MECHANICS)) {
  if (only && !only.includes(m)) continue;
  for (let demo = 0; demo < cfg.demos; demo++)
    for (const mode of cfg.modes)
      for (const profile of wanted) {
        const p = PROFILES[profile];
        const max = cfg.players ? Math.max(...cfg.players) : null;
        const n = max ?? (p.crowd ? (mode === "teams" ? 8 : 16) : 4);
        jobs.push({ m, demo, mode, n, profile });
      }
}

const browser = await chromium.launch({ ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
const merged = new Map(); // ключ находки → сводка
const shotKeys = new Set();
const runs = [];

function addFinding(key, data, where) {
  const old = merged.get(key);
  if (old) {
    old.count += data.count ?? 1;
    if (old.where.length < 12 && !old.where.includes(where)) old.where.push(where);
    old.games.add(where.split(" ")[0]);
    if (!old.shot && data.shot) old.shot = data.shot;
    return;
  }
  merged.set(key, { ...data, count: data.count ?? 1, where: [where], games: new Set([where.split(" ")[0]]) });
}

async function runJob(job) {
  const { m, demo, mode, n, profile } = job;
  const p = PROFILES[profile];
  const name = `${m}-${demo}-${mode}-${profile}`;
  const where = `${m} ${demo + 1}-й шаблон, ${mode === "teams" ? "команды" : "каждый сам"} ×${n}, ${p.title.toLowerCase()}`;
  // Две страницы с тем же ходом игры (тот же seed): экран зала в окне размера экрана и телефоны с пультом в окне
  // ширины телефона — у каждой свои vw/vh, как на настоящем устройстве.
  const [hall, phones] = await Promise.all([runPage(job, name, where, "hall"), runPage(job, name, where, "phones")]);
  const views = (hall.views ?? 0) + (phones.views ?? 0);
  const count = (hall.findings?.length ?? 0) + (phones.findings?.length ?? 0);
  runs.push({ name, views, findings: count, finished: !!hall.finished && !!phones.finished });
  console.log(`${count ? "•" : "✓"} ${name}: видов ${views}, находок ${count}${hall.finished && phones.finished ? "" : " (до финала не дошла)"}`);
}

async function runPage(job, name, where, areas) {
  const { m, demo, mode, n, profile } = job;
  const p = PROFILES[profile];
  const [w, h] = areas === "hall" ? p.hall.split("x").map(Number) : [p.phone, 780];
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: "reduce", locale: "ru-RU" });
  const missing = new Set();
  const pageErrors = [];
  page.on("response", (r) => {
    if (r.status() >= 400 && !/favicon/.test(r.url())) missing.add(new URL(r.url()).pathname);
  });
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 300)));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/Failed to load resource|favicon/.test(msg.text())) pageErrors.push(msg.text().slice(0, 300));
  });
  await page.exposeFunction("robotSnap", async (id, key) => {
    if (shotKeys.has(key)) return null;
    shotKeys.add(key);
    const gallery = key.startsWith("галерея|");
    if (gallery && !GALLERY) return null;
    const file = gallery ? `${name}-${id}.jpg` : `shots/${name}-${areas}-${id}.jpg`;
    const ok = await page
      .locator("[data-snap]")
      .first()
      .screenshot({ path: path.join(gallery ? GALLERY : out, file), type: "jpeg", quality: gallery ? 55 : 70, timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    return ok ? file : null;
  });
  // Пульт — тоже телефон ведущего: на странице телефонов он той же ширины.
  const host = areas === "hall" ? p.host : p.phone;
  const url = `http://localhost:${port}/?m=${m}&mode=${mode}&n=${n}&seed=1&demo=${demo}&budget=${process.env.BUDGET ?? 350}&inspect=1&areas=${areas}&hall=${p.hall}&host=${host}&phone=${p.phone}&names=${p.names}${GALLERY && profile === "tv" && areas === "hall" ? "&gallery=1" : ""}`;
  let report;
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.robotDone === true, null, { timeout: Number(process.env.TIMEOUT ?? 600_000), polling: 1000 });
    report = await page.evaluate(() => window.robotReport);
  } catch (e) {
    report = await page.evaluate(() => window.robotReport).catch(() => null);
    report = { ...(report ?? { mechanic: m, findings: [], errors: [] }), timeout: String(e).slice(0, 200) };
  }
  for (const f of report.findings ?? []) addFinding(f.key, f, where);
  for (const e of report.errors ?? []) addFinding(`робот|ошибка|${e.where}|${e.message.slice(0, 60)}`, { area: "страница", kind: "ошибка страницы", message: e.message, path: e.where, text: "", at: e.at }, where);
  for (const e of [...new Set(pageErrors)].slice(0, 10)) addFinding(`страница|ошибка|${e.slice(0, 80)}`, { area: "страница", kind: "ошибка страницы", message: e, path: "", text: "", at: "" }, where);
  for (const file of missing) addFinding(`сеть|404|${file}`, { area: "сеть", kind: "файл не найден", message: `нет файла ${file}`, path: file, text: "", at: "" }, where);
  if (report.stuck) addFinding(`робот|тупик|${m}`, { area: "пульт", kind: "тупик", message: report.stuck, path: "", text: "", at: "" }, where);
  if (report.timeout) addFinding(`робот|время|${m}|${areas}`, { area: "страница", kind: "не успел", message: report.timeout, path: "", text: "", at: "" }, where);
  await page.close();
  return report;
}

let next = 0;
await Promise.all(Array.from({ length: Number(process.env.PAR ?? 4) }, async () => {
  while (next < jobs.length) await runJob(jobs[next++]);
}));
await browser.close();
server.close();

// ---------------------------------------------------------------- отчёт

const ORDER = [
  ["Мешает игре", ["ошибка страницы", "тупик", "не успел", "пустой экран", "мусор в тексте", "мусор в подписи", "за краем экрана", "за краем", "закрыт другим элементом", "надписи наезжают", "прокрутка вбок", "битая картинка", "файл не найден"]],
  ["Заметно", ["обрезан текст", "прячется за прокруткой", "бледный текст", "мелко для зала"]],
  ["Мелочи", ["мелкий текст", "мелкая кнопка"]],
];
const all = [...merged.values()].map((f) => ({ ...f, games: [...f.games] }));
const known = new Set(ORDER.flatMap(([, kinds]) => kinds));
const sections = ORDER.map(([title, kinds]) => [title, all.filter((f) => kinds.includes(f.kind))]);
const other = all.filter((f) => !known.has(f.kind));
if (other.length) sections.push(["Другое", other]);
const rank = (f) => ORDER.flatMap(([, k]) => k).indexOf(f.kind);
for (const [, list] of sections) list.sort((a, b) => rank(a) - rank(b) || b.games.length - a.games.length || b.count - a.count);

fs.writeFileSync(path.join(out, "findings.json"), JSON.stringify({ runs, findings: all }, null, 1));
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
let md = `# Ревизор — что видят ведущий и гости\n\nПрогонов: ${runs.length} · видов игры проверено: ${runs.reduce((a, r) => a + r.views, 0)} · разных находок: ${all.length}\n\n`;
md += `Размеры: ${wanted.map((p) => `${PROFILES[p].title} (${PROFILES[p].hall})`).join("; ")}.\n\n`;
for (const [title, list] of sections) {
  md += `## ${title} — ${list.length}\n\n`;
  for (const f of list) {
    md += `### ${f.kind} · ${f.area}\n\n${esc(f.message)}${f.text ? ` — «${esc(f.text)}»` : ""}\n\n`;
    md += `- где: \`${esc(f.path) || "—"}\`${f.at ? `, этап \`${esc(f.at)}\`` : ""}\n- игры (${f.games.length}): ${f.where.slice(0, 6).map(esc).join("; ")}${f.where.length > 6 ? " …" : ""}\n- раз: ${f.count}\n\n`;
    if (f.shot) md += `![${esc(f.kind)}](${f.shot})\n\n`;
  }
}
fs.writeFileSync(path.join(out, "README.md"), md);
let summary = `### Ревизор: ${all.length} находок, ${runs.length} прогонов\n\n| Раздел | Находок |\n|---|---|\n`;
for (const [title, list] of sections) summary += `| ${title} | ${list.length} |\n`;
for (const [title, list] of sections.slice(0, 2)) for (const f of list.slice(0, 15)) summary += `\n- **${title}** · ${esc(f.kind)} · ${esc(f.area)}: ${esc(f.message).slice(0, 160)} (${f.games.join(", ").slice(0, 80)})`;
fs.writeFileSync(path.join(out, "summary.md"), summary + "\n");
console.log(`Ревизор: ${all.length} находок → ${path.join(out, "README.md")}`);
