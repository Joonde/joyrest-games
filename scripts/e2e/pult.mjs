// Стресс-тест пульта ведущего (CLAUDE.md, раздел 9): настоящий пульт на test.games.joy-rest.ru (телефон ведущего),
// настоящий экран зала и 3–5 телефонов гостей, которые сами жмут что попало. Пульт проходит игру от лобби до финала,
// нажимая всё подряд, и на каждом шаге проверяет:
// - отклик: кнопка что-то сделала (окно, изменение на пульте, запрос); сколько ждали изменения на пульте и ответа сервера;
// - ложные срабатывания: вкладки «Звуки», «Музыка», «Слайды», «Гости», звуки, слайды, жеребьёвка, QR, перерыв, таблица,
//   «+10 секунд» не меняют ход игры (этап, шаг, очки); «Отмена» в окне подтверждения ничего не делает; двойное касание
//   не проводит одно действие дважды;
// - возврат: с каждой вкладки, из каждого слайда и после перезагрузки пульт показывает то же, что до этого;
// - ошибки страницы, ответы 5xx, конфликты 409 от одиночного касания, тупики (25 действий без движения игры).
// Итог — аннотацией в Actions и отчётом pult/report.json в ветке e2e-shots (с картинками проблем).
//
// Игры: популярные из библиотеки test (как «Популярные» в студии) и новые форматы. Нет игры в библиотеке test —
// берётся шаблон из кода (страница робота-ведущего, ROBOT_DIR). Список — PULT_GAMES (ключи через запятую).
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { extname, join } from "node:path";
import { chromium } from "playwright";

const BASE = (process.env.E2E_BASE ?? "https://test.games.joy-rest.ru").replace(/\/$/, "");
const EMAIL = process.env.LOAD_HOST_EMAIL ?? "";
const PASSWORD = process.env.LOAD_HOST_PASSWORD ?? "";
const OUT = process.env.PULT_OUT ?? "pult-out";
const BUDGET = Number(process.env.PULT_BUDGET ?? 90);
const MINUTES = Number(process.env.PULT_MINUTES ?? 7);
const PARALLEL = Number(process.env.PULT_PARALLEL ?? 3);
const ROBOT_DIR = process.env.ROBOT_DIR ?? "";
const REPO_DIR = process.env.REPO_DIR ?? "";
const SEED = Number(process.env.PULT_SEED ?? 7);
const WAIT = 20_000;

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Игры ----------

const notKaraoke = (c) => c?.variant !== "karaoke";
const GAMES = [
  { key: "quiz", name: "Квиз", mech: "quiz", players: 12, pick: (g) => !/мелод|формат|число|порядк/i.test(g.title) },
  { key: "lotto", name: "Музыкальное лото", mech: "lotto" },
  { key: "dragon", name: "Бой с драконом", mech: "dragon", pick: (g) => !/дет/i.test(g.title) },
  { key: "justdance", name: "Just Dance на поле", mech: "stage", pick: (g) => notKaraoke(g.content) },
  { key: "millionaire", name: "Кто хочет стать миллионером", mech: "millionaire" },
  { key: "board", name: "Своя игра", mech: "board" },
  { key: "hundred", name: "100 к 1", mech: "hundred", pick: (g) => g.content?.mode !== "hall" },
  { key: "quest", name: "Активная настолка", mech: "quest", pick: (g) => !/18|алког/i.test(g.title) },
  { key: "truth", name: "Правда или действие", mech: "truth", pick: (g) => !/18/.test(g.title) },
  { key: "karaoke", name: "Караоке на поле", mech: "stage", pick: (g) => g.content?.variant === "karaoke" },
  { key: "melody", name: "Угадай мелодию", mech: "quiz", pick: (g) => /мелод/i.test(g.title) },
  { key: "spy", name: "Шпион", mech: "spy", mode: "solo", players: 5 },
  { key: "wager", name: "Держи пари", mech: "wager" },
  { key: "wine", name: "Винное казино", mech: "wine", mode: "solo", players: 3 },
  { key: "perudo", name: "Перудо", mech: "perudo", mode: "solo", players: 3 },
  { key: "dance", name: "Танцевальный батл", mech: "dance" },
];
const ONLY = (process.env.PULT_GAMES ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// ---------- Отчёт ----------

const results = [];
const all = [];
function annotate(code) {
  if (process.env.GITHUB_ACTIONS !== "true") return;
  const lines = [];
  for (const r of results) {
    const p = r.problems.filter((x) => x.level === "bug");
    const dv = Object.values(r.delivery ?? {}).map((d) => d.p95);
    lines.push(`${p.length ? "❌" : "✅"} ${r.name}: действий ${r.actions}, телефонов ${r.phones ?? "—"}, ${r.finished ? "дошла до финала" : "НЕ дошла до финала"}, отклик пульта медиана ${r.lag.median} мс / 95% ${r.lag.p95} мс, сервер 95% ${r.server.p95} мс, доставка на телефоны 95% до ${dv.length ? Math.max(...dv) : "—"} мс`);
    for (const x of p.slice(0, 12)) lines.push(`   • ${x.text}`);
  }
  const text = lines.join("\n").replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, "%0A");
  console.log(`::${code === 0 ? "notice" : "error"} title=Стресс-тест пульта::${text}`);
}

if (!/^https:\/\/test\./.test(BASE)) {
  console.log(`Отказ: только тестовый адрес (сейчас ${BASE}).`);
  process.exit(2);
}
if (!EMAIL || !PASSWORD) {
  console.log("Нужны LOAD_HOST_EMAIL и LOAD_HOST_PASSWORD.");
  process.exit(2);
}

// ---------- API ----------

async function api(method, path, cookie, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", "X-JoyRest": "1", Origin: BASE, Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${data?.error ?? ""}`);
  return { res, data };
}

async function login() {
  const { res } = await api("POST", "/api/auth/login", "", { email: EMAIL, password: PASSWORD });
  let token = "";
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    if (pair.startsWith("__Host-jr_s=")) token = pair.slice("__Host-jr_s=".length);
  }
  if (!token) throw new Error("вход ведущего: нет cookie");
  const me = await api("GET", "/api/auth/me", `__Host-jr_s=${token}`);
  if (me.data?.profile?.mustChangePassword) await api("POST", "/api/auth/password", `__Host-jr_s=${token}`, { currentPassword: PASSWORD, newPassword: PASSWORD });
  return token;
}

/** Шаблоны из кода: страница робота-ведущего выкладывает их в window.robotDemos. */
async function codeDemos(browser) {
  if (!ROBOT_DIR || !existsSync(ROBOT_DIR)) return [];
  const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webp": "image/webp", ".png": "image/png" };
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const files = [join(ROBOT_DIR, url === "/" ? "index.html" : url), REPO_DIR ? join(REPO_DIR, "public", url) : ""];
    const file = files.find((f) => f && existsSync(f) && statSync(f).isFile());
    if (!file) return void res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, r));
  const page = await browser.newPage();
  try {
    await page.goto(`http://localhost:${server.address().port}/?m=none&budget=0`);
    await page.waitForFunction(() => Array.isArray(window.robotDemos), null, { timeout: 15_000 });
    return await page.evaluate(() => JSON.parse(JSON.stringify(window.robotDemos)));
  } catch (e) {
    console.log(`Шаблоны из кода не получены: ${String(e).slice(0, 160)}`);
    return [];
  } finally {
    await page.close();
    server.close();
  }
}

// ---------- Браузер ----------

/** Какую версию сессии устройство получило по потоку событий и когда (доставка на телефоны и экран). */
const TRACK_SSE = () => {
  const ES = window.EventSource;
  window.__sse = { v: 0, t: 0 };
  window.EventSource = class extends ES {
    constructor(url, opts) {
      super(url, opts);
      if (String(url).includes("/stream/session/"))
        this.addEventListener("message", (e) => {
          try {
            const d = JSON.parse(e.data);
            const v = typeof d.version === "number" ? d.version : d.session?.version;
            if (typeof v === "number" && v > window.__sse.v) window.__sse = { v, t: Date.now() };
          } catch {}
        });
    }
  };
};

/** Раскладка экрана: прокрутка вбок, мелкие кнопки, кнопки друг на друге, кнопки под чем-то. */
const LAYOUT = () => {
  const doc = document.documentElement;
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.opacity !== "0";
  };
  const name = (el) => ((el.getAttribute("aria-label") || el.textContent || el.tagName).replace(/\s+/g, " ").trim().slice(0, 30));
  const out = { overflow: doc.scrollWidth - doc.clientWidth, small: [], overlap: [], covered: [], errors: [] };
  const btns = [...document.querySelectorAll("button, a.btn, input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not(.visually-hidden), select, textarea")].filter(vis);
  for (const b of btns) {
    const r = b.getBoundingClientRect();
    if (r.height < 40 && b.tagName !== "TEXTAREA" && !b.closest(".deck-grid")) out.small.push(name(b));
    // Под чем-то: центр кнопки в видимой части экрана, а сверху другой элемент.
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cy > 0 && cy < innerHeight && cx > 0 && cx < innerWidth) {
      const top = document.elementFromPoint(cx, cy);
      if (top && top !== b && !b.contains(top) && !top.contains(b) && !top.closest("dialog[open]") && !(top.closest("label") && top.closest("label").contains(b))) out.covered.push(`${name(b)} ← ${name(top)}`);
    }
  }
  for (let i = 0; i < btns.length; i++)
    for (let j = i + 1; j < btns.length; j++) {
      const a = btns[i].getBoundingClientRect();
      const c = btns[j].getBoundingClientRect();
      if (btns[i].contains(btns[j]) || btns[j].contains(btns[i])) continue;
      const w = Math.min(a.right, c.right) - Math.max(a.left, c.left);
      const h = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
      if (w > 2 && h > 2 && w * h > 0.15 * Math.min(a.width * a.height, c.width * c.height)) out.overlap.push(`${name(btns[i])} × ${name(btns[j])}`);
    }
  for (const e of document.querySelectorAll(".error, [role=alert]")) if (vis(e) && e.textContent.trim()) out.errors.push(e.textContent.trim().slice(0, 80));
  return out;
};

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU" };
const TV = { viewport: { width: 1280, height: 720 }, locale: "ru-RU" };

/** Запросы страницы: время, статус, тело (для двойных касаний). */
function watchNet(page, who, run) {
  const started = new Map();
  page.on("request", (req) => {
    if (req.method() !== "GET" && req.url().includes("/api/")) started.set(req, Date.now());
  });
  page.on("response", (res) => {
    const req = res.request();
    const t0 = started.get(req);
    if (t0 === undefined) {
      if (res.status() >= 500) run.bug(`${who}: ответ ${res.status()} на ${req.method()} ${new URL(req.url()).pathname}`);
      return;
    }
    started.delete(req);
    const entry = { t0, t1: Date.now(), path: new URL(req.url()).pathname, status: res.status(), body: req.postData() ?? "" };
    if (who === "Пульт") run.net.push(entry);
    if (res.status() >= 500) run.bug(`${who}: сервер ответил ${res.status()} на ${entry.path}`);
  });
  page.on("requestfailed", (req) => {
    if (req.url().includes("/api/") && !/stream/.test(req.url()) && !/ERR_ABORTED/.test(req.failure()?.errorText ?? "")) {
      run.note(`${who}: запрос не прошёл ${new URL(req.url()).pathname} (${req.failure()?.errorText})`);
    }
  });
  page.on("pageerror", (e) => run.bug(`${who}: ошибка на странице — ${String(e.message).slice(0, 160)}`));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/favicon|ERR_ABORTED|net::|status of (404|409)/.test(msg.text())) run.bug(`${who}: ошибка в консоли — ${msg.text().slice(0, 160)}`);
  });
}

async function guestJoin(browser, run, code, teams, i, joinTeam = null) {
  const context = await browser.newContext(PHONE);
  await context.addInitScript(TRACK_SSE);
  const page = await context.newPage();
  watchNet(page, `Телефон ${i + 1}`, run);
  await page.goto(`${BASE}/play/${code}`);
  await page.getByRole("heading", { name: "Как вас зовут?" }).waitFor({ timeout: WAIT });
  await page.getByLabel("Имя", { exact: true }).fill(["Аня", "Борис", "Вика", "Гоша", "Даша", "Егор", "Женя", "Зоя", "Игорь", "Катя", "Лёва", "Маша"][i] ?? `Гость ${i + 1}`);
  if (joinTeam) {
    // Участник команды (не капитан): находит свою команду в списке.
    for (let k = 0; k < 10; k++) {
      await page.getByRole("button", { name: "Обновить список команд" }).click().catch(() => undefined);
      if ((await page.getByLabel(joinTeam, { exact: false }).count()) > 0) break;
      await sleep(1000);
    }
    await page.getByLabel(joinTeam, { exact: false }).first().check({ timeout: WAIT });
  } else if (teams) {
    await page.getByLabel("Новая команда (вы станете капитаном)").check({ timeout: WAIT });
    await page.getByLabel("Название команды").fill(["Совы", "Лисы", "Ежи", "Волки"][i] ?? `Команда ${i + 1}`);
  }
  await page.getByRole("button", { name: "Играть" }).click();
  await page.locator(".play-head__name").waitFor({ timeout: WAIT });
  return { context, page };
}

/** Телефон гостя: заполнить пустые поля и нажать случайную доступную кнопку (как живой гость). */
async function phoneTick(page, seed) {
  await page
    .evaluate((seed) => {
      let x = seed;
      const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
      const visible = (el) => el.getClientRects().length > 0;
      const dialog = document.querySelector("dialog[open]");
      if (dialog) {
        const b = [...dialog.querySelectorAll("button")].filter((b) => !b.disabled);
        (rnd() < 0.6 ? b[0] : b[1] ?? b[0])?.click();
        return;
      }
      const root = document.querySelector("main") ?? document.body;
      for (const f of root.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]), textarea")) {
        if (f.disabled || f.value || !visible(f)) continue;
        const proto = f instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(f, f.type === "number" ? String(1 + Math.floor(rnd() * 9)) : `ответ ${Math.floor(rnd() * 90) + 10}`);
        f.dispatchEvent(new Event("input", { bubbles: true }));
        f.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const SKIP = /Обновить|Выйти|Сменить|отзыв|Отзыв|Telegram|чаевые|На главную|итоги|Итоги|Назад к|Поделиться|Скопировать/;
      const list = [...root.querySelectorAll("button")].filter((b) => !b.disabled && visible(b) && !SKIP.test(b.textContent ?? ""));
      if (list.length && rnd() < 0.8) list[Math.floor(rnd() * list.length)].click();
    }, seed)
    .catch(() => undefined);
}

// ---------- Один прогон ----------

const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);
const p95 = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * 0.95))] : 0);

async function runGame(browser, token, spec, game) {
  const run = {
    key: spec.key,
    name: spec.name,
    source: game.source,
    title: game.title,
    problems: [],
    log: [],
    net: [],
    uiLag: [],
    actions: 0,
    counts: {},
    finished: false,
    shots: [],
    bug(text, extra) {
      if (this.problems.some((p) => p.text === text)) return;
      this.problems.push({ level: "bug", text, at: this.actions, ...(extra ?? {}) });
      console.log(`❌ [${spec.name}] ${text}`);
    },
    note(text) {
      if (this.problems.some((p) => p.text === text)) return;
      this.problems.push({ level: "note", text, at: this.actions });
      console.log(`ℹ️ [${spec.name}] ${text}`);
    },
    count(name) {
      this.counts[name] = (this.counts[name] ?? 0) + 1;
    },
    say(line) {
      if (this.log.length < 600) this.log.push(`${this.actions}: ${line}`);
    },
  };
  const cookie = `__Host-jr_s=${token}`;
  let x = SEED * 7919 + spec.key.length * 104729;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (a) => (a.length ? a[Math.floor(rnd() * a.length)] : undefined);
  const playMode = spec.mode ?? (game.playMode === "solo" ? "solo" : "teams");
  // Команды: 3 капитана + по участнику в каждой (участник видит вопрос, отвечает капитан). Каждый сам — 6 телефонов.
  const teamsCount = 3;
  const players = spec.players ?? 6;

  // Сессия — как «Создать сессию» в студии: снимок игры, экран зала.
  const id = `pult${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const { data } = await api("POST", "/api/sessions", cookie, {
    id,
    ...(game.id ? { gameId: game.id } : {}),
    gameTitle: `Стресс пульта: ${spec.name}`,
    mechanic: spec.mech,
    gameSnapshot: { title: game.title, mechanic: spec.mech, themeId: game.themeId ?? "joyrest", content: game.content },
    themeId: game.themeId ?? "joyrest",
    playMode,
    screenMode: "laptop",
  });
  const code = data.code;
  run.session = id;
  const state = async () => (await api("GET", `/api/sessions/${id}`, cookie)).data;
  const sig = (s) => JSON.stringify({ ph: s.state.phase, st: s.state.step, sg: s.state.stage, sc: Object.fromEntries(Object.entries(s.leaderboard ?? {}).map(([k, v]) => [k, v.score])) });
  const fullSig = (s) => JSON.stringify({ a: sig(s), r: s.state.result ?? null });
  const where = (s) => `${s.state.phase}/${s.state.stage ?? "-"}/шаг ${s.state.step}`;

  const contexts = [];
  try {
    const hostContext = await browser.newContext(PHONE);
    contexts.push(hostContext);
    await hostContext.addCookies([{ name: "__Host-jr_s", value: token, url: BASE, secure: true, httpOnly: true, sameSite: "Lax" }]);
    const host = await hostContext.newPage();
    watchNet(host, "Пульт", run);
    await host.goto(`${BASE}/host/${code}`);
    await host.getByRole("button", { name: "Начать игру" }).waitFor({ timeout: WAIT });

    const screenContext = await browser.newContext(TV);
    contexts.push(screenContext);
    await screenContext.addInitScript(TRACK_SSE);
    const screen = await screenContext.newPage();
    watchNet(screen, "Экран зала", run);
    await screen.goto(`${BASE}/screen/${code}`);

    const phones = [];
    const TEAM_NAMES = ["Совы", "Лисы", "Ежи"];
    for (let i = 0; i < players; i++) {
      const teams = playMode === "teams";
      const member = teams && i >= teamsCount;
      const p = await guestJoin(browser, run, code, teams && !member, i, member ? TEAM_NAMES[i % teamsCount] : null);
      contexts.push(p.context);
      phones.push(p.page);
    }
    // Пульт видит всех (лобби: «игроков/телефонов: N»).
    await host.locator(".pult-status").filter({ hasText: new RegExp(`: ${players}\\b`) }).waitFor({ timeout: WAIT }).catch(() => run.bug(`Лобби: пульт не показал ${players} подключившихся за 20 с`));

    // ---------- помощники пульта ----------
    const shot = async (name) => {
      if (run.shots.length >= 6) return;
      const file = `${spec.key}-${String(run.shots.length + 1).padStart(2, "0")}-${name}.png`;
      await host.screenshot({ path: join(OUT, file) }).catch(() => undefined);
      await screen.screenshot({ path: join(OUT, file.replace(".png", "-экран.png")) }).catch(() => undefined);
      run.shots.push(file);
    };
    const tab = async (label) => {
      const t0 = Date.now();
      await host.locator(".pult-tabs__btn", { hasText: label }).click({ timeout: 5000 });
      await host.locator(".pult-tabs__btn[aria-current=page]", { hasText: label }).waitFor({ timeout: 3000 });
      return Date.now() - t0;
    };
    const controls = () => host.locator(".pult-panel > section.card").first();
    /** Видимые доступные кнопки пульта игры (без вкладок и плашек). */
    const controlButtons = async () =>
      controls()
        .evaluate((root) =>
          [...root.querySelectorAll("button")]
            .filter((b) => !b.disabled && b.getClientRects().length > 0)
            .map((b, i) => ({ i, text: (b.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60), primary: b.classList.contains("host-quiz__primary") || (b.classList.contains("btn") && !b.classList.contains("btn--secondary") && !b.classList.contains("btn--quiet")) })),
        )
        .catch(() => []);
    const panelText = () => host.locator(".pult-panel").innerText({ timeout: 2000 }).catch(() => "");
    const dialogOpen = () => host.locator("dialog[open]").count().then((n) => n > 0).catch(() => false);
    const buttonsKey = async () => (await controlButtons()).map((b) => b.text).join(" | ");

    /** Нажать и измерить: что произошло, сколько ждали. */
    async function press(locator, label, { double = false } = {}) {
      const before = await panelText();
      const from = run.net.length;
      const t0 = Date.now();
      try {
        if (double) await locator.dblclick({ timeout: 4000 });
        else await locator.click({ timeout: 4000 });
      } catch (e) {
        run.note(`«${label}»: не нажать (${String(e.message).split("\n")[0].slice(0, 80)})`);
        return { kind: "fail" };
      }
      let kind = "none";
      while (Date.now() - t0 < 6000) {
        await sleep(80);
        if (await dialogOpen()) {
          kind = "dialog";
          break;
        }
        if ((await panelText()) !== before) {
          kind = "changed";
          break;
        }
      }
      const ms = Date.now() - t0;
      await sleep(250);
      const reqs = run.net.slice(from).filter((r) => r.t0 >= t0 - 50);
      if (kind === "changed" || kind === "dialog") run.uiLag.push(ms);
      if (kind === "none") {
        if (reqs.length === 0) run.bug(`«${label}» не откликнулась: ни изменения на пульте, ни окна, ни запроса за 6 с`, { where: label });
        else if (reqs.every((r) => r.status < 300)) run.bug(`«${label}»: сервер принял (${reqs.map((r) => r.path.split("/").pop()).join(", ")}), а пульт не изменился за 6 с`);
      } else if (ms > 2500 && kind === "changed") run.note(`«${label}»: пульт обновился только через ${(ms / 1000).toFixed(1)} с`);
      const single409 = reqs.filter((r) => r.status === 409);
      if (!double && single409.length) run.bug(`«${label}»: одиночное касание получило отказ 409 (${single409.map((r) => r.path.split("/").pop()).join(", ")}) — пульт думал, что игра в другом месте`);
      return { kind, ms, reqs };
    }

    /** Окно подтверждения: иногда «Отмена» (и проверка, что ничего не случилось), иначе — согласие. */
    async function handleDialog(label) {
      if (!(await dialogOpen())) return;
      const dialog = host.locator("dialog[open]");
      if (rnd() < 0.35) {
        const s0 = await state();
        await dialog.locator(".actions .btn--secondary").first().click({ timeout: 4000 }).catch(() => undefined);
        await sleep(1200);
        if (await dialogOpen()) run.bug(`«${label}»: окно не закрылось по «Отмена»`);
        const s1 = await state();
        if (sig(s0) !== sig(s1)) run.bug(`«${label}» → «Отмена»: игра всё равно изменилась (${where(s0)} → ${where(s1)})`);
        run.count("окно: отмена");
        return "cancel";
      }
      await press(dialog.locator(".actions .btn").first(), `${label} → подтвердить`);
      run.count("окно: да");
      await sleep(400);
      if (await dialogOpen()) {
        // Второе окно (бывает: «Точно?») — тоже соглашаемся.
        await host.locator("dialog[open] .actions .btn").first().click({ timeout: 4000 }).catch(() => undefined);
      }
      return "yes";
    }

    /** Проверка «ничего лишнего»: ход игры не изменился, пульт показывает те же кнопки. */
    async function sameGame(label, s0, keys0) {
      const s1 = await state();
      if (sig(s0) !== sig(s1)) run.bug(`${label}: изменился ход игры (${where(s0)} → ${where(s1)}) — ложное срабатывание`);
      if (keys0 !== undefined) {
        await host.locator(".pult-tabs__btn[aria-current=page]", { hasText: "Игра" }).waitFor({ timeout: 3000 }).catch(() => undefined);
        let keys1 = await buttonsKey();
        for (let i = 0; i < 10 && keys1 !== keys0; i++) {
          await sleep(300);
          keys1 = await buttonsKey();
        }
        if (keys1 !== keys0 && sig(s0) === sig(s1)) run.bug(`${label}: после возврата пульт показал другие кнопки — было «${keys0.slice(0, 120)}», стало «${keys1.slice(0, 120)}»`);
      }
      return s1;
    }

    /** Подождать, пока телефоны и пульт успокоятся (ответы дошли, счётчики записаны). */
    const settle = async () => {
      await sleep(900);
    };

    // ---------- телефоны гостей и экран зала ----------
    const devices = [...phones.map((page, i) => ({ page, who: `Телефон ${i + 1}${playMode === "teams" && i >= teamsCount ? " (участник команды)" : playMode === "teams" ? " (капитан)" : ""}` })), { page: screen, who: "Экран зала" }];
    run.delivery = {};
    run.misses = 0;
    /** Изменение пульта дошло до каждого телефона и экрана: через сколько после ответа сервера. */
    async function delivery(label, since) {
      const applied = run.net.filter((r) => r.t0 >= since && /\/(apply|phase|leaderboard|finish)$/.test(r.path) && r.status < 300);
      if (applied.length === 0) return;
      const t1 = applied[applied.length - 1].t1;
      const V = (await state()).version;
      await Promise.all(
        devices.map(async (d) => {
          let got = null;
          const deadline = Date.now() + 6000;
          while (Date.now() < deadline) {
            const x = await d.page.evaluate(() => window.__sse).catch(() => null);
            if (x && x.v >= V) {
              got = Math.max(0, x.t - t1);
              break;
            }
            await sleep(100);
          }
          (run.delivery[d.who] ??= []).push(got ?? 6000);
          if (got === null) {
            run.misses++;
            run.bug(`${d.who}: изменение пульта не дошло по потоку событий за 6 с (первый раз — после «${label}»)`);
          } else if (got > 2000) run.note(`${d.who}: изменение пришло через ${(got / 1000).toFixed(1)} с (первый раз — после «${label}»)`);
        }),
      );
    }
    const seenStage = new Set();
    run.stageShots = [];
    /** Раскладка телефонов и экрана; на каждом новом этапе — снимки экрана зала, капитана и участника. */
    async function looks(s, label) {
      const r = s.state.result ?? {};
      const key = `${s.state.phase}|${s.state.stage}|${r.mode ?? r.phase ?? r.board ?? ""}|${s.state.slide?.kind ?? ""}`;
      const fresh = !seenStage.has(key);
      seenStage.add(key);
      if (!fresh && rnd() > 0.2) return;
      for (const d of devices) {
        if (d.page === screen) {
          const o = await screen.evaluate(() => {
            const el = document.scrollingElement ?? document.documentElement;
            return { x: el.scrollWidth - el.clientWidth, y: el.scrollHeight - el.clientHeight };
          }).catch(() => null);
          if (o && o.y > 4) run.bug(`Экран зала: не помещается по высоте на ${o.y} px — часть игры за краем`, { where: where(s) });
          if (o && o.x > 4) run.bug(`Экран зала: шире экрана на ${o.x} px`, { where: where(s) });
          continue;
        }
        const L = await d.page.evaluate(LAYOUT).catch(() => null);
        if (!L) continue;
        if (L.overflow > 1) run.bug(`${d.who}: экран шире телефона на ${L.overflow} px — листается вбок`, { where: where(s) });
        if (L.small.length) run.note(`${d.who}: мелкие кнопки (< 40 px): ${[...new Set(L.small)].slice(0, 5).join(", ")} [${where(s)}]`);
        if (L.overlap.length) run.bug(`${d.who}: кнопки наезжают друг на друга: ${[...new Set(L.overlap)].slice(0, 3).join("; ")} [${where(s)}]`);
        if (L.covered.length) run.bug(`${d.who}: кнопку закрывает другой элемент: ${[...new Set(L.covered)].slice(0, 3).join("; ")} [${where(s)}]`);
        if (L.errors.length) run.note(`${d.who}: на экране ошибка «${L.errors[0]}» [${where(s)}]`);
      }
      if (fresh && run.stageShots.length < 16) {
        const n = String(run.stageShots.length + 1).padStart(2, "0");
        const base = `${spec.key}-этап-${n}`;
        await screen.screenshot({ path: join(OUT, `${base}-экран.jpg`), type: "jpeg", quality: 70 }).catch(() => undefined);
        await phones[0].screenshot({ path: join(OUT, `${base}-телефон1.jpg`), type: "jpeg", quality: 70 }).catch(() => undefined);
        if (playMode === "teams" && phones[teamsCount]) await phones[teamsCount].screenshot({ path: join(OUT, `${base}-участник.jpg`), type: "jpeg", quality: 70 }).catch(() => undefined);
        await host.screenshot({ path: join(OUT, `${base}-пульт.jpg`), type: "jpeg", quality: 70 }).catch(() => undefined);
        run.stageShots.push({ base, where: where(s), after: label });
      }
    }

    // ---------- проверки пульта поверх игры ----------
    const checks = {
      async tabs() {
        await settle();
        const s0 = await state();
        const keys0 = await buttonsKey();
        for (const label of ["Звуки", "Музыка", "Слайды", "Гости"]) {
          const ms = await tab(label).catch(() => -1);
          if (ms < 0) run.bug(`Вкладка «${label}» не открылась`);
          else if (ms > 1500) run.note(`Вкладка «${label}» открывалась ${(ms / 1000).toFixed(1)} с`);
          await sleep(300);
        }
        const back = await tab("Игра").catch(() => -1);
        if (back < 0) run.bug("С вкладки «Гости» не вернуться на «Игра»");
        await sameGame("Обход вкладок", s0, keys0);
        run.count("вкладки по кругу");
      },
      async sound() {
        await settle();
        const s0 = await state();
        const keys0 = await buttonsKey();
        await tab("Звуки");
        const name = pick(["Гонг", "Дробь", "Фанфары", "Аплодисменты", "Ошибка", "Стоп"]);
        const cue0 = JSON.stringify(s0.state.cue ?? null);
        await press(host.locator(".pult-panel button", { hasText: name }).first(), `Звук «${name}»`);
        await sleep(600);
        const s1 = await state();
        if (name !== "Стоп" && JSON.stringify(s1.state.cue ?? null) === cue0) run.bug(`Звук «${name}»: на экран ничего не ушло (state.cue не изменился)`);
        await tab("Игра");
        await sameGame(`Звук «${name}»`, s0, keys0);
        run.count("звук");
      },
      async slide() {
        await settle();
        const s0 = await state();
        if (s0.state.slide) return;
        const keys0 = await buttonsKey();
        await tab("Слайды");
        const tiles = host.locator(".pult-panel .tile");
        const n = await tiles.count();
        if (n === 0) return void run.bug("Вкладка «Слайды»: нет шаблонов");
        const i = Math.floor(rnd() * n);
        const label = (await tiles.nth(i).innerText()).trim();
        await tiles.nth(i).click();
        await press(host.getByRole("button", { name: /^Показать (на экране|этот слайд)/ }), `Слайд «${label}»`);
        await host.locator(".pult-banner").filter({ hasText: "На экране" }).waitFor({ timeout: 5000 }).catch(() => run.bug(`Слайд «${label}»: на пульте нет плашки «На экране слайд»`));
        const s1 = await state();
        if (!s1.state.slide) run.bug(`Слайд «${label}»: слайд не ушёл на экран`);
        // Вернуться к игре — то с вкладки, то плашкой сверху.
        await tab("Игра");
        if (rnd() < 0.5) await press(host.locator(".pult-banner .btn", { hasText: "Убрать" }).first(), "Плашка «Убрать» (слайд)");
        else {
          await tab("Слайды");
          await press(host.getByRole("button", { name: "Убрать слайд — вернуть игру" }), "«Убрать слайд — вернуть игру»");
          await tab("Игра");
        }
        await sleep(600);
        const s2 = await state();
        if (s2.state.slide) run.bug(`Слайд «${label}»: после «Убрать» он остался на экране`);
        if ((await host.locator(".pult-banner").filter({ hasText: "слайд" }).count()) > 0) run.bug(`Слайд «${label}»: плашка «На экране слайд» осталась на пульте`);
        await sameGame(`Слайд «${label}» и обратно`, s0, keys0);
        run.count("слайд");
      },
      async overlay() {
        // Кнопки на вкладке «Игра»: жеребьёвка, QR опоздавшим, тех. перерыв — показать и убрать той же кнопкой или плашкой.
        await settle();
        const s0 = await state();
        if (s0.state.slide || s0.state.phase !== "playing") return;
        const keys0 = await buttonsKey();
        const pairs = [
          ["Жеребьёвка — кто ходит первым", "▶ Убрать монетку — вернуться к игре", "draw"],
          ["QR для опоздавших на экран", "▶ Убрать QR — вернуться к игре", "join"],
          ["Технический перерыв", "▶ Закончить перерыв — вернуться к игре", "tech"],
        ];
        const [on, off, kind] = pick(pairs);
        const btn = host.getByRole("button", { name: on, exact: true });
        if ((await btn.count()) === 0) return;
        await press(btn, on);
        await sleep(500);
        const s1 = await state();
        if (s1.state.slide?.kind !== kind) run.bug(`«${on}»: на экран ничего не ушло`);
        if (kind === "draw") await sleep(4500); // монетка крутится
        if (rnd() < 0.5) await press(host.getByRole("button", { name: off, exact: true }), off);
        else await press(host.locator(".pult-banner .btn", { hasText: "Убрать" }).first(), `Плашка «Убрать» (${kind})`);
        await sleep(600);
        const s2 = await state();
        if (s2.state.slide) run.bug(`«${on}» → убрать: на экране осталось (${s2.state.slide.kind})`);
        // Жеребьёвка вправе передать право хода («Своя игра») — сравниваем только этап, шаг и очки.
        const a = { ...s0, state: { ...s0.state } };
        await sameGame(`«${on}» и обратно`, a, kind === "draw" ? undefined : keys0);
        run.count(`поверх игры: ${kind}`);
      },
      async peek() {
        await settle();
        const s0 = await state();
        const b = host.getByRole("button", { name: /^(Таблица на экран|Счёт раунда)$/ }).first();
        if ((await b.count()) === 0) return;
        const keys0 = await buttonsKey();
        await press(b, "Таблица на экран");
        await sleep(500);
        const s1 = await state();
        if (!s1.state.peek) run.bug("«Таблица на экран»: таблица не ушла на экран");
        if (rnd() < 0.5) await press(host.getByRole("button", { name: /^Убрать (таблицу|счёт раунда)$/ }).first(), "«Убрать таблицу»");
        else await press(host.locator(".pult-banner .btn", { hasText: "Убрать" }).first(), "Плашка «Убрать» (таблица)");
        await sleep(600);
        const s2 = await state();
        if (s2.state.peek) run.bug("Таблица: после «Убрать» осталась на экране");
        await sameGame("Таблица на экран и обратно", s0, keys0);
        run.count("таблица на экран");
      },
      async addTime() {
        const b = host.getByRole("button", { name: "+10 секунд" });
        if ((await b.count()) === 0 || (await b.isDisabled())) return;
        const s0 = await state();
        await press(b, "+10 секунд");
        await sleep(500);
        const s1 = await state();
        if (!(Number(s1.state.timeLimit) > Number(s0.state.timeLimit)) && s1.state.startedAt === s0.state.startedAt) run.bug(`«+10 секунд»: время не прибавилось (${s0.state.timeLimit} → ${s1.state.timeLimit})`);
        if (sig(s0) !== sig(s1)) run.bug(`«+10 секунд»: изменился ход игры (${where(s0)} → ${where(s1)})`);
        run.count("+10 секунд");
      },
      async award() {
        const b = host.getByRole("button", { name: "Наградить сейчас" });
        if ((await b.count()) === 0 || (await b.isDisabled())) return;
        await settle();
        const s0 = await state();
        await press(b, "Наградить сейчас");
        if ((await handleDialog("Наградить сейчас")) !== "yes") return;
        await sleep(800);
        const s1 = await state();
        if (s1.state.stage !== "podium") return void run.bug(`«Наградить сейчас»: пьедестал не открылся (${where(s1)})`);
        const back = (await controlButtons()).find((x) => /^(←\s*)?Назад/.test(x.text));
        if (!back) return void run.bug("«Наградить сейчас»: на пульте нет «Назад» с заставки награждения");
        await press(controls().locator("button").nth(back.i), "Назад с награждения");
        await sleep(800);
        const s2 = await state();
        if (s2.state.stage !== s0.state.stage || s2.state.step !== s0.state.step) run.bug(`«Наградить сейчас» → «Назад»: вернулись не туда (${where(s0)} → ${where(s2)})`);
        run.count("наградить сейчас и назад");
      },
      async reload() {
        await settle();
        const s0 = await state();
        const keys0 = await buttonsKey();
        const t0 = Date.now();
        await host.reload();
        await host.locator(".pult-panel").waitFor({ timeout: WAIT });
        let keys1 = "";
        while (Date.now() - t0 < 15_000) {
          keys1 = await buttonsKey();
          if (keys1 === keys0) break;
          await sleep(300);
        }
        const ms = Date.now() - t0;
        const s1 = await state();
        if (sig(s0) !== sig(s1)) run.bug(`Перезагрузка пульта: изменился ход игры (${where(s0)} → ${where(s1)})`);
        else if (keys1 !== keys0) run.bug(`Перезагрузка пульта: открылся не там — было «${keys0.slice(0, 120)}», стало «${keys1.slice(0, 120)}»`);
        else if (ms > 6000) run.note(`Перезагрузка пульта: пульт вернулся за ${(ms / 1000).toFixed(1)} с`);
        run.count("перезагрузка пульта");
      },
    };

    // ---------- старт ----------
    await looks(await state(), "лобби");
    const tStartClick = Date.now();
    await press(host.getByRole("button", { name: "Начать игру" }), "Начать игру");
    await handleDialog("Начать игру");
    await host.locator(".pult-panel > section.card").first().waitFor({ timeout: WAIT }).catch(() => run.bug("После «Начать игру» пульт игры не появился"));
    await delivery("Начать игру", tStartClick);

    const tStart = Date.now();
    const RISKY = /досрочно|Закончить|Завершить|Без голосования|Выбывает|Отклонить|Не брать|Убрать из|Удалить/i;
    let lastFull = "";
    let still = 0;
    let s = await state();
    for (run.actions = 1; run.actions <= BUDGET; run.actions++) {
      if (Date.now() - tStart > MINUTES * 60_000) {
        run.note(`За ${MINUTES} мин игра не дошла до финала (действий: ${run.actions}) — завершаем досрочно`);
        break;
      }
      for (const [i, p] of phones.entries()) if (rnd() < 0.75) await phoneTick(p, Math.floor(rnd() * 1e9) + i);
      s = await state();
      if (s.state.phase === "finished") break;
      const r = rnd();
      const special =
        r < 0.05 ? "tabs" : r < 0.09 ? "sound" : r < 0.13 ? "slide" : r < 0.17 ? "overlay" : r < 0.2 ? "peek" : r < 0.23 ? "addTime" : r < 0.25 ? "award" : r < 0.27 ? "reload" : null;
      if (special && s.state.phase === "playing") {
        run.say(`проверка: ${special} [${where(s)}]`);
        try {
          await checks[special]();
        } catch (e) {
          run.note(`Проверка «${special}» прервалась: ${String(e.message).split("\n")[0].slice(0, 120)}`);
          await tab("Игра").catch(() => undefined);
        }
        continue;
      }
      // Обычный ход ведущего: главная кнопка, другая кнопка, «Назад», двойное касание.
      if (await dialogOpen()) {
        await handleDialog("окно");
        continue;
      }
      if ((await host.locator(".pult-tabs__btn[aria-current=page]", { hasText: "Игра" }).count()) === 0) await tab("Игра").catch(() => undefined);
      const list = await controlButtons();
      if (list.length === 0) {
        still++;
        await sleep(800);
        if (still > 25) break;
        continue;
      }
      const late = run.actions > BUDGET * 0.75;
      const primary = list.find((b) => b.primary && !RISKY.test(b.text)) ?? list.find((b) => b.primary);
      const back = list.find((b) => /^(←\s*)?Назад/.test(b.text));
      const others = list.filter((b) => b !== primary && b !== back && (late || !RISKY.test(b.text)));
      const q = rnd();
      let chosen;
      let double = false;
      if (back && q < 0.1) chosen = back;
      else if (primary && q < 0.15) {
        chosen = primary;
        double = true;
      } else if (q < 0.4) chosen = pick(others) ?? primary;
      else chosen = primary ?? pick(others);
      if (!chosen) continue;
      const label = chosen === back ? "Назад" : chosen.text || "(кнопка без текста)";
      const s0 = s;
      run.say(`${double ? "двойное касание" : "касание"} «${label}» [${where(s0)}]`);
      run.count(double ? "двойное касание" : chosen === back ? "Назад" : chosen === primary ? "главная кнопка" : "другая кнопка");
      const tClick = Date.now();
      const res = await press(controls().locator("button").nth(chosen.i), label, { double });
      if (res.kind === "dialog") await handleDialog(label);
      if (double) {
        await sleep(1500);
        const applies = res.reqs?.filter((q) => /\/apply$/.test(q.path) && q.status < 300 && /"expect"/.test(q.body)) ?? [];
        const same = applies.length >= 2 && applies.every((q) => q.body === applies[0].body);
        if (same) run.bug(`Двойное касание «${label}»: одно действие прошло дважды (${applies.length} записи с тем же expect) [${where(s0)}]`);
        else if (applies.length >= 2) run.note(`Двойное касание «${label}»: две разные записи подряд [${where(s0)}] — проверить`);
      }
      if (chosen === back) {
        await sleep(600);
        const s1 = await state();
        if (sig(s1) === sig(s0) && fullSig(s1) === fullSig(s0)) run.note(`«Назад» ничего не изменил [${where(s0)}]`);
      }
      await delivery(label, tClick);
      const now = await state();
      await looks(now, label);
      const f = fullSig(now);
      if (f === lastFull) still++;
      else {
        still = 0;
        lastFull = f;
      }
      if (still >= 25) {
        run.bug(`Тупик: 25 действий без движения игры [${where(now)}], кнопки: ${(await buttonsKey()).slice(0, 200)}`);
        await shot("тупик");
        break;
      }
    }

    // ---------- конец ----------
    s = await state();
    if (s.state.phase !== "finished") {
      await tab("Игра").catch(() => undefined);
      const end = host.getByRole("button", { name: /Завершить (игру|блок|вечер) досрочно/ });
      if ((await end.count()) > 0) {
        await press(end.first(), "Завершить игру досрочно");
        if (await dialogOpen()) await host.locator("dialog[open] .actions .btn").first().click({ timeout: 5000 }).catch(() => undefined);
      } else {
        // Пьедестал: «Завершить игру» — главной кнопкой пульта.
        const fin = controls().getByRole("button", { name: "Завершить игру" });
        if ((await fin.count()) > 0) {
          await fin.first().click().catch(() => undefined);
          if (await dialogOpen()) await host.locator("dialog[open] .actions .btn").first().click({ timeout: 5000 }).catch(() => undefined);
        }
      }
      await sleep(1500);
      s = await state();
    } else run.finished = true;
    if (s.state.phase === "finished") {
      // После финала: «Открыть итоги», «В студию», «Спасибо» на экран и обратно.
      await host.getByRole("heading", { name: /Игра завершена|Сессия закрыта/ }).waitFor({ timeout: WAIT }).catch(() => run.bug("После завершения пульт не показал «Игра завершена»"));
      if ((await host.getByRole("link", { name: "Открыть итоги" }).count()) === 0 && Object.keys(s.leaderboard ?? {}).length > 0) run.bug("После завершения на пульте нет «Открыть итоги»");
      if ((await host.getByRole("link", { name: "В студию" }).count()) === 0) run.bug("После завершения на пульте нет «В студию»");
      const thanks = host.getByRole("button", { name: /«Спасибо»/ });
      if ((await thanks.count()) > 0) {
        for (let i = 0; i < 2; i++) {
          const before = (await state()).state.slide?.kind ?? null;
          await press(thanks.first(), i === 0 ? "«Спасибо» (убрать/показать)" : "«Спасибо» ещё раз");
          await sleep(500);
          const after = (await state()).state.slide?.kind ?? null;
          if (before === after) run.bug(`Кнопка «Спасибо» после игры не переключила экран (${before} → ${after})`);
        }
      }
      // После завершения вкладки «Звуки» и «Музыка» живут (музыку можно включить после игры).
      for (const label of ["Звуки", "Гости", "Игра"]) await tab(label).catch(() => run.bug(`После завершения вкладка «${label}» не открылась`));
    } else run.bug(`Игру не удалось завершить с пульта (${where(s)})`);
    await shot("финал");
  } catch (e) {
    run.bug(`Прогон прервался: ${String(e.message).split("\n")[0].slice(0, 200)}`);
  } finally {
    await api("POST", `/api/sessions/${id}/finish`, cookie, {}).catch(() => undefined);
    await Promise.all(contexts.map((c) => c.close().catch(() => undefined)));
  }
  const applies = run.net.filter((r) => /\/apply$/.test(r.path)).map((r) => r.t1 - r.t0);
  const summary = {
    key: run.key,
    name: run.name,
    source: run.source,
    title: run.title,
    session: run.session,
    actions: run.actions,
    finished: run.finished,
    counts: run.counts,
    lag: { median: median(run.uiLag), p95: p95(run.uiLag), max: Math.max(0, ...run.uiLag), n: run.uiLag.length },
    server: { median: median(applies), p95: p95(applies), max: Math.max(0, ...applies), n: applies.length, status: run.net.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {}) },
    phones: players,
    playMode,
    delivery: Object.fromEntries(Object.entries(run.delivery ?? {}).map(([k, v]) => [k, { median: median(v), p95: p95(v), max: Math.max(0, ...v), n: v.length }])),
    misses: run.misses ?? 0,
    stageShots: run.stageShots ?? [],
    problems: run.problems,
    shots: run.shots,
    log: run.log,
  };
  console.log(`— ${spec.name}: действий ${summary.actions}, финал ${summary.finished}, отклик пульта ${summary.lag.median}/${summary.lag.p95} мс, сервер ${summary.server.median}/${summary.server.p95} мс, замечаний ${run.problems.length}`);
  return summary;
}

// ---------- Показ презентации («Слайды» → «Фото и PDF») ----------

const DECK_PDF = process.env.PULT_PDF ?? join(import.meta.dirname, "fixtures", "test-presentation.pdf");

/** Ведущий загружает с телефона PDF компании, листает на экране зала с разных вкладок, перезагружает пульт, убирает. */
async function runDeck(browser, token, quiz) {
  const run = {
    key: "deck",
    name: "Слайды: презентация компании (PDF)",
    problems: [],
    steps: [],
    shots: [],
    bug(text) {
      if (!this.problems.some((p) => p.text === text)) this.problems.push({ level: "bug", text });
      console.log(`❌ [показ] ${text}`);
    },
    note(text) {
      if (!this.problems.some((p) => p.text === text)) this.problems.push({ level: "note", text });
      console.log(`ℹ️ [показ] ${text}`);
    },
    step(text) {
      this.steps.push(text);
      console.log(`• [показ] ${text}`);
    },
    net: [],
  };
  const cookie = `__Host-jr_s=${token}`;
  const id = `deck${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const { data } = await api("POST", "/api/sessions", cookie, {
    id,
    ...(quiz.id ? { gameId: quiz.id } : {}),
    gameTitle: "Стресс пульта: показ презентации",
    mechanic: "quiz",
    gameSnapshot: { title: quiz.title, mechanic: "quiz", themeId: quiz.themeId ?? "joyrest", content: quiz.content },
    themeId: quiz.themeId ?? "joyrest",
    playMode: "solo",
    screenMode: "laptop",
  });
  const code = data.code;
  const state = async () => (await api("GET", `/api/sessions/${id}`, cookie)).data;
  const contexts = [];
  let deckId = null;
  const shot = async (page, name) => {
    const file = `deck-${String(run.shots.length + 1).padStart(2, "0")}-${name}.png`;
    await page.screenshot({ path: join(OUT, file) }).catch(() => undefined);
    run.shots.push(file);
  };
  try {
    const hostContext = await browser.newContext(PHONE);
    contexts.push(hostContext);
    await hostContext.addCookies([{ name: "__Host-jr_s", value: token, url: BASE, secure: true, httpOnly: true, sameSite: "Lax" }]);
    const host = await hostContext.newPage();
    watchNet(host, "Пульт", run);
    await host.goto(`${BASE}/host/${code}`);
    await host.getByRole("button", { name: "Начать игру" }).waitFor({ timeout: WAIT });
    const screenContext = await browser.newContext({ ...TV, viewport: { width: 1920, height: 1080 } });
    contexts.push(screenContext);
    const screen = await screenContext.newPage();
    watchNet(screen, "Экран зала", run);
    await screen.goto(`${BASE}/screen/${code}`);
    const phone = await guestJoin(browser, run, code, false, 0);
    contexts.push(phone.context);
    await host.getByRole("button", { name: "Начать игру" }).click();
    await host.locator(".pult-panel > section.card").first().waitFor({ timeout: WAIT });
    const g0 = await state();
    const gameSig = (s) => JSON.stringify({ ph: s.state.phase, st: s.state.step, sg: s.state.stage });

    // 1. Загрузка PDF с телефона ведущего.
    await host.locator(".pult-tabs__btn", { hasText: "Слайды" }).click();
    await host.getByRole("heading", { name: "Фото и PDF на весь экран" }).waitFor({ timeout: WAIT }).catch(() => run.bug("Вкладка «Слайды»: нет блока «Фото и PDF на весь экран»"));
    await shot(host, "пульт-слайды-до-загрузки");
    const t0 = Date.now();
    await host.locator('input[type=file][accept*="pdf"]').setInputFiles(DECK_PDF);
    const progress = new Set();
    let s = null;
    while (Date.now() - t0 < 180_000) {
      const label = await host.locator("label.btn.is-busy").innerText({ timeout: 500 }).catch(() => "");
      if (label) progress.add(label.trim());
      s = await state();
      if (s.state.slide?.kind === "image") break;
      const err = await host.locator(".pult-panel .error").innerText({ timeout: 300 }).catch(() => "");
      if (err) {
        run.bug(`Загрузка PDF: ошибка «${err.trim()}»`);
        break;
      }
      await sleep(400);
    }
    const upMs = Date.now() - t0;
    if (s?.state.slide?.kind !== "image") throw new Error(`PDF не дошёл до экрана за ${(upMs / 1000).toFixed(0)} с`);
    const media = s.state.slide.media;
    deckId = media.deck;
    run.step(`PDF (7 страниц, 0,6 МБ) загружен и первая страница на экране через ${(upMs / 1000).toFixed(1)} с; подписи на кнопке во время загрузки: ${[...progress].join(" → ") || "—"}`);
    if (media.count !== 7) run.bug(`Загрузка PDF: страниц ${media.count}, а в файле 7`);
    if (media.page !== 0) run.bug(`Загрузка PDF: на экран ушла страница ${media.page + 1}, а не первая`);

    // 2. Экран зала: страница целиком, без обрезки.
    const img = screen.locator(".slide--image img.slide__image");
    const imageInfo = async () =>
      img.evaluate((el) => ({ src: el.currentSrc || el.src, ok: el.complete && el.naturalWidth > 0, fit: getComputedStyle(el).objectFit, w: el.naturalWidth, h: el.naturalHeight, box: [el.clientWidth, el.clientHeight] })).catch(() => null);
    await img.waitFor({ timeout: WAIT }).catch(() => run.bug("Экран зала: страница презентации не появилась"));
    await screen.waitForFunction(() => {
      const el = document.querySelector(".slide--image img.slide__image");
      return el && el.complete && el.naturalWidth > 0;
    }, null, { timeout: WAIT }).catch(() => run.bug("Экран зала: картинка страницы не загрузилась за 20 с"));
    const first = await imageInfo();
    if (first && first.fit !== "contain") run.bug(`Экран зала: страница показана с object-fit «${first.fit}» — края могут обрезаться`);
    if (first) run.step(`Экран зала: страница ${first.w}×${first.h} px, вписана целиком (object-fit: ${first.fit})`);
    await shot(screen, "экран-стр1");
    await shot(host, "пульт-после-загрузки");
    const banner = host.locator(".pult-banner").filter({ hasText: "показ" });
    if ((await banner.count()) === 0) run.bug("Пульт: нет плашки «На экране показ» с ‹ ›");

    // 3. Листать ›, считая, когда сменилась страница на экране зала.
    const next = host.getByRole("button", { name: "Следующая страница" });
    const prev = host.getByRole("button", { name: "Предыдущая страница" });
    const counter = host.locator(".deck-stepper__count");
    const flip = async (button, expectPage, label) => {
      const before = (await imageInfo())?.src;
      const t = Date.now();
      await button.click({ timeout: 5000 });
      let hostMs = null;
      let screenMs = null;
      while (Date.now() - t < 10_000 && (hostMs === null || screenMs === null)) {
        if (hostMs === null && (await counter.innerText().catch(() => "")).startsWith(`${expectPage} /`)) hostMs = Date.now() - t;
        if (screenMs === null) {
          const info = await imageInfo();
          if (info && info.ok && info.src !== before) screenMs = Date.now() - t;
        }
        await sleep(60);
      }
      if (hostMs === null) run.bug(`${label}: на пульте не стало «${expectPage} / 7» за 10 с`);
      if (screenMs === null) run.bug(`${label}: страница на экране зала не сменилась за 10 с`);
      else if (screenMs > 2500) run.note(`${label}: экран зала сменил страницу только через ${(screenMs / 1000).toFixed(1)} с`);
      return { hostMs, screenMs };
    };
    const times = [];
    for (let p = 2; p <= 7; p++) {
      times.push(await flip(next, p, `› на страницу ${p}`));
      if (p === 6) await shot(screen, "экран-стр6-вертикальная");
      if (p === 3) await shot(screen, "экран-стр3");
    }
    if (!(await next.isDisabled())) run.bug("На последней странице кнопка › активна");
    else run.step("На последней странице › погашена");
    times.push(await flip(prev, 6, "‹ на страницу 6"));
    const sm = times.map((t) => t.screenMs).filter((x) => x !== null);
    const hm = times.map((t) => t.hostMs).filter((x) => x !== null);
    run.step(`Листание ‹ ›: пульт обновлял номер за ${median(hm)} мс (худшее ${Math.max(0, ...hm)}), экран зала менял страницу за ${median(sm)} мс (худшее ${Math.max(0, ...sm)})`);

    // 4. Касание миниатюры — та страница сразу на экране.
    const thumb = host.getByRole("button", { name: "Показать страницу 3" });
    if ((await thumb.count()) === 0) run.bug("Вкладка «Слайды»: нет миниатюр страниц загруженного показа");
    else {
      await thumb.click();
      await sleep(1200);
      const s3 = await state();
      if (s3.state.slide?.media?.page !== 2) run.bug(`Миниатюра «страница 3»: на экране страница ${(s3.state.slide?.media?.page ?? -1) + 1}`);
      else run.step("Касание миниатюры страницы 3 — она на экране");
      await shot(host, "пульт-миниатюры");
    }

    // 5. Листать с других вкладок: плашка сверху на «Игре», «Звуках», «Гостях».
    for (const tabName of ["Игра", "Звуки", "Гости"]) {
      await host.locator(".pult-tabs__btn", { hasText: tabName }).click();
      await sleep(300);
      if ((await next.count()) === 0) run.bug(`Вкладка «${tabName}»: нет ‹ › для показа`);
      else {
        const cur = Number((await counter.innerText()).split("/")[0]);
        await flip(next, cur + 1, `› с вкладки «${tabName}»`);
      }
    }
    await host.locator(".pult-tabs__btn", { hasText: "Игра" }).click();
    await shot(host, "пульт-игра-с-показом");

    // 6. Перезагрузка пульта посреди показа.
    const before = (await state()).state.slide?.media?.page;
    await host.reload();
    await host.locator(".pult-panel").waitFor({ timeout: WAIT });
    await counter.waitFor({ timeout: WAIT }).catch(() => run.bug("После перезагрузки пульта нет ‹ › показа"));
    await sleep(1500);
    if ((await counter.innerText().catch(() => "")).startsWith(`${(before ?? 0) + 1} /`)) run.step("После перезагрузки пульта показ на той же странице, ‹ › на месте");
    else run.bug(`После перезагрузки пульта номер страницы «${await counter.innerText().catch(() => "")}», а на экране ${(before ?? 0) + 1}`);
    if (await prev.isDisabled().catch(() => true)) run.bug("После перезагрузки пульта ‹ погашена (показы ещё не загрузились или потерялись)");

    // 7. Телефон гостя во время показа.
    await shot(phone.page, "телефон-гостя-во-время-показа");

    // 8. Ход игры не тронут, «Убрать» возвращает игру.
    const g1 = await state();
    if (gameSig(g0) !== gameSig(g1)) run.bug(`Показ презентации изменил ход игры (${g0.state.stage} → ${g1.state.stage})`);
    await host.locator(".pult-banner .btn", { hasText: "Убрать" }).first().click();
    await img.waitFor({ state: "detached", timeout: 8000 }).then(() => run.step("«Убрать» на плашке — экран зала вернулся к игре")).catch(() => run.bug("После «Убрать» страница показа осталась на экране зала"));
    await shot(screen, "экран-игра-после-показа");

    // 9. Студия → «Показы»: показ сохранён для следующих мероприятий.
    const studio = await hostContext.newPage();
    await studio.goto(`${BASE}/studio/decks`);
    await studio.getByText("test-presentation", { exact: false }).first().waitFor({ timeout: WAIT }).then(() => run.step("Студия → «Показы»: презентация сохранена (её можно переименовать, переставить, убрать страницы)")).catch(() => run.note("Студия → «Показы»: не нашли показ по имени файла"));
    await shot(studio, "студия-показы");
    await studio.close();
  } catch (e) {
    run.bug(`Прогон прервался: ${String(e.message).split("\n")[0].slice(0, 200)}`);
  } finally {
    if (deckId) await api("DELETE", `/api/decks/${deckId}`, cookie).catch(() => run.note("Показ не удалился после проверки"));
    await api("POST", `/api/sessions/${id}/finish`, cookie, {}).catch(() => undefined);
    await Promise.all(contexts.map((c) => c.close().catch(() => undefined)));
  }
  return { key: run.key, name: run.name, actions: run.steps.length, finished: true, lag: { median: 0, p95: 0 }, server: { median: 0, p95: 0 }, problems: run.problems, steps: run.steps, shots: run.shots };
}

// ---------- main ----------

const browser = await chromium.launch({ args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
let code = 0;
try {
  const token = await login();
  const library = (await api("GET", "/api/games?scope=agency", `__Host-jr_s=${token}`)).data ?? [];
  const demos = await codeDemos(browser);
  const plan = [];
  for (const spec of GAMES) {
    if (ONLY.length && !ONLY.includes(spec.key)) continue;
    const ok = (g) => g.mechanic === spec.mech && (!spec.pick || spec.pick(g));
    const lib = library.find(ok);
    const demo = demos.find(ok);
    if (lib) plan.push({ spec, game: { ...lib, source: "библиотека test" } });
    else if (demo) plan.push({ spec, game: { ...demo, id: null, source: "шаблон из кода" } });
    else results.push({ key: spec.key, name: spec.name, actions: 0, finished: false, lag: { median: 0, p95: 0 }, server: { median: 0, p95: 0 }, problems: [{ level: "bug", text: "Нет игры ни в библиотеке test, ни в шаблонах" }] });
  }
  console.log(`Игр: ${plan.length} (${plan.map((p) => `${p.spec.name} — ${p.game.source}`).join("; ")})`);
  if (!ONLY.length || ONLY.includes("deck")) {
    const quiz = plan.find((p) => p.spec.key === "quiz")?.game ?? library.find((g) => g.mechanic === "quiz") ?? demos.find((d) => d.mechanic === "quiz");
    if (quiz) {
      try {
        results.push(await runDeck(browser, token, quiz));
      } catch (e) {
        results.push({ key: "deck", name: "Слайды: презентация", actions: 0, finished: false, lag: { median: 0, p95: 0 }, server: { median: 0, p95: 0 }, problems: [{ level: "bug", text: `Не начался: ${String(e.message).slice(0, 200)}` }] });
      }
    }
  }
  const queue = [...plan];
  await Promise.all(
    Array.from({ length: PARALLEL }, async (_, w) => {
      await sleep(w * 4000);
      while (queue.length) {
        const { spec, game } = queue.shift();
        try {
          results.push(await runGame(browser, token, spec, game));
        } catch (e) {
          results.push({ key: spec.key, name: spec.name, actions: 0, finished: false, lag: { median: 0, p95: 0 }, server: { median: 0, p95: 0 }, problems: [{ level: "bug", text: `Прогон не начался: ${String(e.message).slice(0, 200)}` }] });
        }
      }
    }),
  );
  results.sort((a, b) => GAMES.findIndex((g) => g.key === a.key) - GAMES.findIndex((g) => g.key === b.key));
  if (results.some((r) => r.problems.some((p) => p.level === "bug"))) code = 1;
} catch (e) {
  console.log(`Остановка: ${String(e.message).slice(0, 300)}`);
  code = 2;
} finally {
  writeFileSync(join(OUT, "report.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), budget: BUDGET, results }, null, 2));
  await browser.close();
}
annotate(code);
process.exit(0);
