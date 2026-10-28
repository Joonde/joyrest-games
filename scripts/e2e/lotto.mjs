// Проверка музыкального лото на test.games.joy-rest.ru (CLAUDE.md, раздел 6, «Барабан, табло, видео-зона и караоке»,
// решения владельца 27 октября 2026): настоящий браузер (Playwright) под входом ведущего load@joy-rest.ru.
//  1. Конструктор (телефон 390 px): «Послушать трек», «⤓ Начинать отсюда», «Сколько звучит» («До конца»), «🎤 Текст песни» —
//     вставить текст, разметить строки касанием «Следующая строка», «↶ Строка назад», ±0,2 с, «▶ Проверить, как на экране»,
//     загрузить .lrc, «Когда показывать», «Барабан перед песней», «Песня играет и после правильного ответа». После каждого
//     шага — что сохранилось на сервере. Раскладка: прокрутка вбок, мелкие кнопки.
//  2. Игра на 24 песни (быстрый барабан): экран зала 1280×720 и 1920×1080, пульт и телефон гостя — барабан, табло, номер,
//     страница песни, «Показать название», текст на экране и кнопки пульта, «Остановить песню», «Следующая», «Назад»,
//     карточка гостя: догадки «карандашом», автоснятие неверных, номер бочонка после ответа, заявка после названия,
//     «Последний шанс «Лото!»»,
//     перезагрузка экрана посреди барабана, телефон «Крутим барабан…» и «Бочонок №».
//  3. Табло на 60 и 100 песен: все номера в табло, клетки не наезжают и не выходят за табло.
//  4. Видео-зона: «Прятать картинку до названия», маленькая пластинка, плашка ответа. Без «играет после ответа» — кнопки
//     «Остановить песню» нет.
// Всё созданное убирается. Снимки — E2E_SHOTS (workflow кладёт их в ветку e2e-shots, папка lotto/).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = (process.env.E2E_BASE ?? "https://test.games.joy-rest.ru").replace(/\/$/, "");
const EMAIL = process.env.LOAD_HOST_EMAIL ?? "";
const PASSWORD = process.env.LOAD_HOST_PASSWORD ?? "";
const SHOTS = process.env.E2E_SHOTS ?? "lotto-shots";
const WAIT = 15_000;

const report = [];
const problems = [];
const say = (line) => {
  report.push(line);
  console.log(line);
};
const ok = (text) => say(`✅ ${text}`);
const bad = (text) => {
  problems.push(text);
  say(`❌ ${text}`);
};
const note = (text) => say(`ℹ️ ${text}`);
const check = (cond, good, fail) => (cond ? ok(good) : bad(fail ?? good));

function finish(code) {
  if (process.env.GITHUB_ACTIONS === "true") {
    const head = problems.length > 0 ? [`Замечаний: ${problems.length}`, ...problems.map((p) => `❌ ${p}`), "", "— Подробно —"] : [];
    const text = [...head, ...report].join("\n").replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, "%0A");
    console.log(`::${code === 0 ? "notice" : "error"} title=Музыкальное лото::${text}`);
  }
  process.exit(code);
}

if (!/^https:\/\/test\./.test(BASE)) {
  say(`Отказ: только тестовый адрес (сейчас ${BASE}).`);
  finish(2);
}
if (!EMAIL || !PASSWORD) {
  say("Нужны LOAD_HOST_EMAIL и LOAD_HOST_PASSWORD.");
  finish(2);
}

async function api(method, path, cookie, body, headers = {}) {
  const raw = body instanceof Uint8Array;
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body === undefined || raw ? {} : { "Content-Type": "application/json" }), "X-JoyRest": "1", Origin: BASE, Cookie: cookie, ...headers },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, res };
}

async function login() {
  const { status, res } = await api("POST", "/api/auth/login", "", { email: EMAIL, password: PASSWORD });
  if (status !== 200) throw new Error(`вход: ${status}`);
  let token = "";
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    if (pair.startsWith("__Host-jr_s=")) token = pair.slice("__Host-jr_s=".length);
  }
  const cookie = `__Host-jr_s=${token}`;
  const me = await api("GET", "/api/auth/me", cookie);
  if (me.data?.profile?.mustChangePassword) await api("POST", "/api/auth/password", cookie, { currentPassword: PASSWORD, newPassword: PASSWORD });
  return { token, cookie, uid: me.data?.user?.uid };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rid = () => Math.random().toString(36).slice(2, 9);
const MARK = Date.now().toString(36);

async function until(fn, ms = WAIT, label = "условие") {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(300);
  }
  throw new Error(`не дождались: ${label}${last ? ` (${String(last.message ?? last).slice(0, 120)})` : ""}`);
}
const soft = async (fn, ms, label) => until(fn, ms, label).then(() => true, () => false);

let shotN = 0;
async function shot(page, name) {
  shotN += 1;
  await page.screenshot({ path: join(SHOTS, `${String(shotN).padStart(2, "0")}-${name}.png`) }).catch(() => undefined);
}

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU" };
const TV = { viewport: { width: 1280, height: 720 }, locale: "ru-RU" };
const TV_HD = { viewport: { width: 1920, height: 1080 }, locale: "ru-RU" };

const openPages = [];

async function open(browser, who, options = PHONE, token = "") {
  const context = await browser.newContext(options);
  if (token) await context.addCookies([{ name: "__Host-jr_s", value: token, url: BASE, secure: true, httpOnly: true, sameSite: "Lax" }]);
  const page = await context.newPage();
  openPages.push([who, page]);
  page.on("pageerror", (error) => bad(`${who}: ошибка на странице — ${String(error.message).slice(0, 160)}`));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/favicon|ERR_ABORTED|net::|status of 40[134]|status of 409|rutube|Failed to load resource/.test(msg.text())) bad(`${who}: ошибка в консоли — ${msg.text().slice(0, 160)}`);
  });
  return page;
}

/** Телефон: нет прокрутки вбок и нет кнопок меньше 44 px (в блоке `scope`). */
async function phoneLayout(page, where, scope = "main") {
  const r = await page.evaluate((sel) => {
    const root = document.querySelector(sel) ?? document.body;
    const wide = document.documentElement.scrollWidth > window.innerWidth + 1;
    const small = [...root.querySelectorAll("button, .btn, input[type=checkbox], input[type=radio]")]
      .filter((el) => {
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) return false;
        if (el.matches("input[type=checkbox], input[type=radio]")) return false;
        return b.height < 43.5;
      })
      .map((el) => (el.textContent ?? "").trim().slice(0, 30) || el.getAttribute("aria-label") || el.className);
    return { wide, small: [...new Set(small)].slice(0, 8) };
  }, scope);
  check(!r.wide, `${where}: нет прокрутки вбок`, `${where}: страница шире экрана`);
  check(r.small.length === 0, `${where}: кнопки не меньше 44 px`, `${where}: мелкие кнопки — ${r.small.join(", ")}`);
}

/** Экран зала: всё с текстом — внутри кадра 16:9, ничего не обрезано по краю кадра. */
async function hallLayout(page, where) {
  const r = await page.evaluate(() => {
    const frame = document.querySelector(".lh-frame");
    if (!frame) return { none: true };
    const f = frame.getBoundingClientRect();
    const out = [];
    for (const el of frame.querySelectorAll("p, h2, b, li, .lh-board, .lh-vinyl, .lh-video__zone, .lh-board__grid i")) {
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      if (getComputedStyle(el).visibility === "hidden" || Number(getComputedStyle(el).opacity) === 0) continue;
      if (b.left < f.left - 1 || b.right > f.right + 1 || b.top < f.top - 1 || b.bottom > f.bottom + 1) out.push(`${el.className || el.tagName}: «${(el.textContent ?? "").trim().slice(0, 24)}»`);
    }
    const clipped = [...frame.querySelectorAll("p, h2")].filter((el) => el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== "visible").map((el) => (el.textContent ?? "").slice(0, 24));
    return { none: false, out: out.slice(0, 6), clipped: clipped.slice(0, 6) };
  });
  if (r.none) return bad(`${where}: нет кадра экрана зала`);
  check(r.out.length === 0, `${where}: всё внутри кадра`, `${where}: за краем кадра — ${r.out.join("; ")}`);
  check(r.clipped.length === 0, `${where}: текст не обрезан`, `${where}: обрезан текст — ${r.clipped.join("; ")}`);
}

/** Табло: все номера на месте, клетки не наезжают друг на друга и не выходят за табло. */
async function boardLayout(page, total, where) {
  const r = await page.evaluate(() => {
    const board = document.querySelector(".lh-board");
    if (!board) return null;
    const bb = board.getBoundingClientRect();
    const cells = [...board.querySelectorAll(".lh-board__grid i")].map((el) => ({ n: el.textContent, b: el.getBoundingClientRect() }));
    let overlap = 0;
    let outside = 0;
    const pairs = [];
    for (let i = 0; i < cells.length; i++) {
      const a = cells[i].b;
      if (a.left < bb.left || a.right > bb.right || a.top < bb.top || a.bottom > bb.bottom) outside += 1;
      for (let j = i + 1; j < Math.min(cells.length, i + 12); j++) {
        const c = cells[j].b;
        if (a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1) {
          overlap += 1;
          pairs.push(`${cells[i].n}/${cells[j].n} ${Math.round(a.width)}×${Math.round(a.height)} @${Math.round(a.left)},${Math.round(a.top)} и @${Math.round(c.left)},${Math.round(c.top)}`);
        }
      }
    }
    const font = cells[0] ? parseFloat(getComputedStyle(board.querySelector(".lh-board__grid i")).fontSize) : 0;
    return { count: cells.length, overlap, outside, font, last: cells[cells.length - 1]?.n, pairs: pairs.slice(0, 3).join("; ") };
  });
  if (!r) return bad(`${where}: табло не видно`);
  check(r.count === total && r.last === String(total), `${where}: в табло все ${total} номеров`, `${where}: в табло ${r.count} номеров (последний ${r.last})`);
  check(r.overlap === 0 && r.outside === 0, `${where}: клетки табло не наезжают и не выходят за край`, `${where}: наезжают ${r.overlap} (${r.pairs}), за краем ${r.outside}`);
  check(r.font >= 9, `${where}: номер в клетке читается (${r.font.toFixed(1)} px)`, `${where}: номер в клетке мелкий — ${r.font.toFixed(1)} px`);
}

// ---------------------------------------------------------------- данные

const LYRICS = ["Первая строчка нашей песни", "Вторая строчка нашей песни", "А это третья строчка", "Четвёртая — и припев"];
const NONE = { source: "none", url: "", name: "" };
const songsOf = (n, track, extra = {}) =>
  Array.from({ length: n }, (_, i) => ({
    id: `l${i + 1}`,
    title: `Песня номер ${i + 1}`,
    artist: `Исполнитель ${i + 1}`,
    trackId: track,
    trackStart: 0,
    video: NONE,
    videoStart: 0,
    length: 25,
    lyrics: LYRICS,
    times: [0.5, 2, 3.5, 5],
    lyricsShow: "reveal",
    lyricsAt: 0,
    ...extra,
  }));
const contentOf = (songs, extra = {}) => ({ songs, size: 3, rule: "line", fragment: 25, prizes: [300, 200, 100], cardStyle: "evening", videoHide: false, hint: true, drum: "quick", playAfter: true, ...extra });

const created = { games: [], sessions: [], tracks: [] };

async function createGame(host, title, content) {
  const id = `e2l${MARK}${rid()}`;
  const r = await api("POST", "/api/games", host.cookie, { id, scope: "personal", ownerId: host.uid, title, mechanic: "lotto", themeId: "joyrest", ageRating: "0+", playMode: "solo", content });
  if (r.status !== 200 && r.status !== 201) throw new Error(`игра не создалась: ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  created.games.push(id);
  return id;
}

async function createSession(host, title, content) {
  const id = `e2l${Date.now().toString(36)}${rid()}`;
  const { status, data } = await api("POST", "/api/sessions", host.cookie, {
    id,
    gameTitle: title,
    mechanic: "lotto",
    gameSnapshot: { title, mechanic: "lotto", themeId: "joyrest", content },
    themeId: "joyrest",
    playMode: "solo",
    screenMode: "laptop",
  });
  if (status !== 200) throw new Error(`сессия: ${status}`);
  created.sessions.push(id);
  return { id, code: data.code };
}

async function savedSong(host, gameId, songId) {
  const { data } = await api("GET", `/api/games/${gameId}`, host.cookie);
  const content = data?.game?.content ?? data?.content ?? {};
  return { song: (content.songs ?? []).find((s) => s.id === songId) ?? null, content };
}

const click = (page, name) => page.getByRole("button", { name, exact: true }).first().click({ timeout: WAIT });

// ---------------------------------------------------------------- 1. конструктор

async function editor(browser, host, track) {
  say("— 1. Конструктор —");
  const plain = songsOf(20, track, { lyrics: [], times: [], length: null });
  const gameId = await createGame(host, `Проверка лото (робот) ${MARK}`, contentOf(plain, { drum: "full", playAfter: false }));
  const page = await open(browser, "Конструктор", PHONE, host.token);
  await page.goto(`${BASE}/studio/games/${gameId}`);
  await page.getByText("Песня номер 1", { exact: false }).first().waitFor({ timeout: WAIT });
  ok("Игра открылась в конструкторе");

  // Настройки игры: барабан и «играет после ответа».
  await page.getByText("Быстрый барабан", { exact: true }).click();
  await page.getByText("Песня играет и после правильного ответа", { exact: true }).click();
  await until(async () => {
    const { content } = await savedSong(host, gameId, "l1");
    return content.drum === "quick" && content.playAfter === true;
  }, WAIT, "барабан и «играет после ответа» сохранились").then(
    () => ok("«Быстрый барабан» и «Песня играет и после правильного ответа» сохранились"),
    (e) => bad(String(e.message)),
  );
  check((await page.getByText("номер бочонка — номер песни в этом списке", { exact: false }).count()) > 0, "Под песнями — «номер бочонка — номер песни в этом списке»");

  await page.getByRole("button", { name: /Песня номер 1\b/ }).first().click();
  await page.getByText("Послушать трек", { exact: true }).waitFor({ timeout: WAIT });
  ok("У песни с треком — «Послушать трек»");
  await shot(page, "конструктор-песня");

  await click(page, "▶ Слушать");
  const plays = await soft(async () => (await page.getByRole("button", { name: "■ Стоп", exact: true }).count()) > 0, 8000, "трек заиграл");
  check(plays, "«▶ Слушать» — трек играет («■ Стоп»)", "«▶ Слушать» — трек не заиграл за 8 с");
  if (plays) {
    await sleep(2500);
    await page.getByRole("button", { name: /^⤓ Начинать отсюда/ }).click();
    await until(async () => ((await savedSong(host, gameId, "l1")).song?.trackStart ?? 0) >= 1, WAIT, "начало трека").then(
      () => ok("«⤓ Начинать отсюда» — начало песни сохранилось"),
      (e) => bad(String(e.message)),
    );
    await click(page, "■ Стоп");
  }
  await page.getByRole("button", { name: "До конца", exact: true }).click();
  await until(async () => (await savedSong(host, gameId, "l1")).song?.length === 0, WAIT, "«До конца»").then(
    () => ok("«Сколько звучит» → «До конца» сохранилось"),
    (e) => bad(String(e.message)),
  );

  // Текст песни.
  await page.locator("summary", { hasText: "Текст песни (караоке)" }).click();
  await page.getByLabel("Вставить текст песни (по строкам) или содержимое .lrc").fill(LYRICS.join("\n\n"));
  await click(page, "Добавить текст");
  await until(async () => (await savedSong(host, gameId, "l1")).song?.lyrics?.length === 4, WAIT, "текст").then(
    () => ok("«Добавить текст» — 4 строки, пустые убраны"),
    (e) => bad(String(e.message)),
  );

  await page.getByRole("button", { name: /^▶ Разметить строки/ }).click();
  const marking = await soft(async () => (await page.getByRole("button", { name: /^Следующая строка/ }).count()) > 0, 8000, "разметка");
  check(marking, "«▶ Разметить строки» — крупная кнопка «Следующая строка»", "«▶ Разметить строки» не открыла разметку");
  if (marking) {
    await soft(async () => (await page.getByRole("button", { name: "■ Остановить", exact: true }).count()) > 0, 3000, "");
    await sleep(1200);
    for (let i = 0; i < 4; i++) {
      await page.getByRole("button", { name: /^Следующая строка/ }).click();
      await sleep(700);
    }
    const s1 = await until(async () => {
      const s = (await savedSong(host, gameId, "l1")).song;
      return s?.times?.length === 4 ? s : null;
    }, WAIT, "4 строки размечены").catch((e) => (bad(String(e.message)), null));
    if (s1) {
      const ordered = s1.times.every((t, i) => i === 0 || t >= s1.times[i - 1]);
      check(ordered && s1.times[3] > s1.times[0], `Разметка: время строк растёт (${s1.times.join(", ")})`, `Разметка: время строк не растёт — ${s1.times.join(", ")}`);
    }
    check((await page.getByRole("button", { name: "Все строки размечены ✓" }).count()) > 0, "Все строки размечены — кнопка «Все строки размечены ✓»");
    await click(page, "↶ Строка назад");
    await until(async () => (await savedSong(host, gameId, "l1")).song?.times?.length === 3, WAIT, "строка назад").then(
      () => ok("«↶ Строка назад» — время последней строки убрано"),
      (e) => bad(String(e.message)),
    );
    await sleep(800);
    await page.getByRole("button", { name: /^Следующая строка/ }).click();
    await until(async () => (await savedSong(host, gameId, "l1")).song?.times?.length === 4, WAIT, "строка снова").catch((e) => bad(String(e.message)));
    await click(page, "■ Остановить");
  }
  const before = (await savedSong(host, gameId, "l1")).song;
  if (before?.times?.length >= 3) {
    await page.getByRole("button", { name: "Строка 2: позже на 0,2 с" }).click();
    await until(async () => {
      const s = (await savedSong(host, gameId, "l1")).song;
      return Math.abs((s?.times?.[1] ?? 0) - Math.min(before.times[2], before.times[1] + 0.2)) < 0.051;
    }, WAIT, "+0,2").then(
      () => ok("«+0,2» у строки 2 — время сдвинулось (не дальше следующей строки)"),
      (e) => bad(String(e.message)),
    );
    await click(page, "▶ Проверить, как на экране");
    const preview = await soft(async () => (await page.locator(".lotto-karaoke-preview .karaoke__now").count()) > 0, 6000, "проверка");
    check(preview, "«▶ Проверить, как на экране» — текст идёт строками, как на экране зала", "«▶ Проверить» — текста не видно");
    await sleep(2500);
    await shot(page, "конструктор-караоке-проверка");
    if ((await page.getByRole("button", { name: "■ Стоп", exact: true }).count()) > 0) await click(page, "■ Стоп");
  }

  // .lrc из файла: текст и время сразу.
  const lrc = "[ti:Проверка]\n[00:01.00]Строка из файла раз\n[00:02.50]Строка из файла два\n[00:04.00]Строка из файла три\n";
  await page.locator('input[type=file][accept=".lrc,.txt,text/plain"]').setInputFiles({ name: "песня.lrc", mimeType: "text/plain", buffer: Buffer.from(lrc) });
  await until(async () => {
    const s = (await savedSong(host, gameId, "l1")).song;
    return s?.lyrics?.[0] === "Строка из файла раз" && s.times?.join(",") === "1,2.5,4";
  }, WAIT, ".lrc").then(
    () => ok("Загрузка .lrc — текст и время строк взяты из файла"),
    (e) => bad(String(e.message)),
  );
  await page.getByText(/^С секунды трека/).click();
  await until(async () => (await savedSong(host, gameId, "l1")).song?.lyricsShow === "at", WAIT, "«С секунды трека»").then(
    () => ok("«Когда показывать текст» → «С секунды трека» сохранилось"),
    (e) => bad(String(e.message)),
  );
  check((await page.getByRole("button", { name: "Скачать .lrc" }).count()) > 0, "Есть «Скачать .lrc»");
  await phoneLayout(page, "Конструктор (песня, трек и текст)", ".lotto-tools");
  await shot(page, "конструктор-текст");
  check((await page.getByText("🎤", { exact: false }).count()) > 0, "В списке у песни с текстом — 🎤");
  await page.context().close();
}

// ---------------------------------------------------------------- 2. игра на 24 песни

async function game24(browser, host, track) {
  say("— 2. Игра на 24 песни, полный барабан —");
  const content = contentOf(songsOf(24, track), { drum: "full" });
  const game = await createSession(host, `Лото 24 ${MARK}`, content);
  const pult = await open(browser, "Пульт", PHONE, host.token);
  await pult.goto(`${BASE}/host/${game.code}`);
  await pult.getByRole("button", { name: "Начать игру" }).waitFor({ timeout: WAIT });
  const screen = await open(browser, "Экран зала", TV);
  await screen.goto(`${BASE}/screen/${game.code}`);
  await screen.getByText("Присоединяйтесь к игре").waitFor({ timeout: WAIT });
  const anna = await open(browser, "Гость Аня");
  await anna.goto(`${BASE}/play/${game.code}`);
  await anna.getByLabel("Имя", { exact: true }).fill("Аня");
  await click(anna, "Играть");
  await until(async () => (await pult.locator("main").textContent())?.includes("Аня"), WAIT, "Аня на пульте");
  await click(pult, "Начать игру");
  await screen.getByText("Откройте карточки").waitFor({ timeout: WAIT });
  await screen.mouse.click(640, 360);
  ok("Заставка «Откройте карточки», звук на экране разрешён касанием");

  // Экран запоминает всё, что показал (номер крупно, свежая клетка табло): проверки ниже не зависят от того,
  // успел ли медленный браузер CI сделать снимок в нужную секунду.
  await screen.evaluate(() => {
    window.__seen = { big: [], fresh: [] };
    new MutationObserver(() => {
      const big = document.querySelector(".lh-drum__num")?.textContent?.trim();
      const fresh = document.querySelector(".lh-board__grid i.is-now")?.textContent?.trim();
      if (big && !window.__seen.big.includes(big)) window.__seen.big.push(big);
      if (fresh && !window.__seen.fresh.includes(fresh)) window.__seen.fresh.push(fresh);
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  await click(pult, "🎰 Крутить барабан — первая песня");
  await screen.locator(".lh-drum").waitFor({ timeout: WAIT });
  ok("Экран зала: барабан");
  const gl = await soft(async () => (await screen.locator(".lh-drum__canvas").count()) === 2, 4000, "3D");
  note(gl ? "Барабан в 3D (WebGL)" : "Барабан без 3D (нет WebGL в этом браузере) — показан номер");
  await boardLayout(screen, 24, "Табло 24 (1280×720)");
  check((await screen.locator(".lh-board__grid i.is-on").count()) === 0, "Табло: до первой песни сыгранных нет");
  check((await pult.getByText("Барабан крутится на экране зала", { exact: false }).count()) > 0, "Пульт: «Барабан крутится на экране зала — песня зазвучит через N с»");
  check(((await anna.locator(".lotto-phone .eyebrow").first().textContent()) ?? "").includes("Крутим барабан"), "Телефон: «Крутим барабан…», подсказка не выдаёт песню");
  check((await anna.locator(".lotto-card__cell.is-now").count()) === 0, "Телефон: пока крутится барабан, клетка не светится");
  // Номер знает пульт сразу («№ N · название»); экран покажет его крупно, когда бочонок откроется.
  const number = await until(async () => /№ (\d+) ·/.exec((await pult.locator("main").textContent()) ?? "")?.[1] ?? null, WAIT, "номер на пульте").catch((e) => (bad(String(e.message)), null));
  await shot(screen, "экран-барабан");
  await screen.locator(".lh-song").waitFor({ timeout: 25_000 });
  const seen = await screen.evaluate(() => window.__seen);
  check(seen.big.includes(number), `Экран зала: выпал бочонок ${number} — номер крупно с отсчётом`, `Экран зала: крупный номер — ${seen.big.join(", ") || "не показан"}, ждали ${number}`);
  check(seen.fresh.includes(number), "Табло: выпавший номер загорелся", `Табло: загорелся ${seen.fresh.join(", ") || "ничего"}, ждали ${number}`);
  ok("После барабана — страница песни");
  check(((await screen.locator(".lh-vinyl__n").first().textContent()) ?? "").trim() === number, "Пластинка с тем же номером, что выпал");
  check(((await screen.locator(".lh-track__title").textContent()) ?? "").includes(`№ ${number}`), `«Звучит песня № ${number}»`);
  check(((await pult.locator("main").textContent()) ?? "").includes(`бочонок № ${number}`), "Пульт: номер бочонка и название песни");
  check(((await anna.locator(".lotto-phone .eyebrow").first().textContent()) ?? "").includes(`Бочонок № ${number}`), "Телефон: «Бочонок № N»");
  await hallLayout(screen, "Экран: звучит песня");
  await shot(screen, "экран-песня");

  await click(pult, "Показать название");
  await screen.locator(".lh-track__answer, .lh-karaoke").first().waitFor({ timeout: WAIT });
  const karaoke = await soft(async () => (await screen.locator(".lh-karaoke .karaoke__now").count()) > 0, 5000, "караоке");
  note(karaoke ? "После названия песня играет дальше — на экране текст строками" : "Текст не показан (в этом браузере трек не играет — звук без устройства вывода)");
  if (!karaoke) check(((await screen.locator(".lh-track__answer").textContent()) ?? "").includes(`Это была песня № ${number}`), "Экран: «Это была песня № N», название и исполнитель");
  check((await pult.getByRole("button", { name: "⏹ Остановить песню (играет на 60%)" }).count()) === 1, "Пульт: «⏹ Остановить песню (играет на 60%)»");
  check((await pult.getByText("Текст песни на экране", { exact: false }).count()) === 1, "Пульт: «🎤 Текст песни на экране» с кнопками");
  await shot(screen, "экран-ответ");
  await click(pult, "Убрать текст");
  await until(async () => (await screen.locator(".lh-karaoke").count()) === 0, WAIT, "текст убран").then(() => ok("«Убрать текст» — текста на экране нет"), (e) => bad(String(e.message)));
  check(await soft(async () => (await pult.getByRole("button", { name: "Как в настройке песни" }).count()) === 1, WAIT, ""), "Пульт: после «Убрать текст» — «Как в настройке песни» и «Показать текст сейчас»");
  await click(pult, "⏹ Остановить песню (играет на 60%)");
  await until(async () => (await pult.getByRole("button", { name: "⏹ Остановить песню (играет на 60%)" }).count()) === 0, WAIT, "стоп").then(() => ok("«Остановить песню» — кнопка ушла, песня остановлена"), (e) => bad(String(e.message)));
  await hallLayout(screen, "Экран: правильный ответ");

  await click(pult, "🎰 Крутить барабан — следующая песня");
  await screen.locator(".lh-drum").waitFor({ timeout: WAIT });
  check(
    await soft(async () => (await screen.locator(".lh-board__grid i.is-on").count()) === 1, 3000, ""),
    "Второй барабан: на табло горит первый номер",
    "Второй барабан: на табло нет сыгранного номера",
  );
  // Экран перезагрузили посреди барабана — догоняет.
  await sleep(1500);
  await screen.reload();
  await until(async () => (await screen.locator(".lh-drum, .lh-song").count()) > 0, WAIT, "экран после перезагрузки").then(
    () => ok("Экран перезагрузили посреди барабана — он догнал (барабан или песня)"),
    (e) => bad(String(e.message)),
  );
  await screen.mouse.click(640, 360);
  await screen.locator(".lh-song").waitFor({ timeout: WAIT });
  const last = await screen.locator(".lh-last b").allTextContents();
  check(last.length === 2, `«Последние» внизу — 2 номера (${last.join(", ")})`, `«Последние» — ${last.length} номеров`);
  await click(pult, "Назад");
  await until(async () => (await screen.locator(".lh-track__answer").count()) === 1, WAIT, "назад").then(
    () => ok("«Назад» с новой песни — название прошлой, её музыка не включается"),
    (e) => bad(String(e.message)),
  );

  // Тот же экран на телевизоре 1920×1080.
  const hd = await open(browser, "Экран 1920", TV_HD);
  await hd.goto(`${BASE}/screen/${game.code}`);
  await hd.locator(".lh-frame").waitFor({ timeout: WAIT });
  await hallLayout(hd, "Экран 1920×1080: ответ");
  await shot(hd, "экран-1920-ответ");
  await click(pult, "🎰 Крутить барабан — следующая песня");
  await hd.locator(".lh-drum").waitFor({ timeout: WAIT });
  await sleep(4500);
  await hallLayout(hd, "Экран 1920×1080: номер");
  await shot(hd, "экран-1920-номер");
  await phoneLayout(pult, "Пульт лото");
  await shot(pult, "пульт");
  await shot(anna, "телефон");
  for (const p of [pult, screen, anna, hd]) await p.context().close();
}

// ---------------------------------------------------------------- 3. табло на 60 и 100

async function bigBoards(browser, host, track) {
  for (const n of [60, 100]) {
    say(`— 3. Табло на ${n} песен —`);
    const game = await createSession(host, `Лото ${n} ${MARK}`, contentOf(songsOf(n, track), { drum: "full", size: 5 }));
    const pult = await open(browser, `Пульт ${n}`, PHONE, host.token);
    await pult.goto(`${BASE}/host/${game.code}`);
    // «Уменьшить движение»: барабан без 3D (в CI 3D рисует процессор — два экрана не успевают за 13 с), табло то же.
    const screen = await open(browser, `Экран ${n}`, { ...TV_HD, reducedMotion: "reduce" });
    await screen.goto(`${BASE}/screen/${game.code}`);
    const small = await open(browser, `Экран ${n} 1280`, { ...TV, reducedMotion: "reduce" });
    await small.goto(`${BASE}/screen/${game.code}`);
    await click(pult, "Начать игру");
    await screen.getByText("Откройте карточки").waitFor({ timeout: WAIT });
    await click(pult, "🎰 Крутить барабан — первая песня");
    await screen.locator(".lh-board").waitFor({ timeout: WAIT });
    await small.locator(".lh-board").waitFor({ timeout: WAIT });
    await boardLayout(screen, n, `Табло ${n} (1920×1080)`);
    await boardLayout(small, n, `Табло ${n} (1280×720)`);
    await hallLayout(screen, `Экран ${n}: барабан`);
    check((await screen.locator(".lh-drum__plain").count()) === 1, `Экран ${n}: «уменьшить движение» — барабан без 3D, «Крутим барабан…»`);
    await shot(screen, `экран-табло-${n}`);
    await shot(small, `экран-табло-${n}-1280`);
    await small.context().close();
    await pult.context().close();
    await screen.context().close();
  }
}

// ---------------------------------------------------------------- 4. видео-зона и без «играет после ответа»

async function videoZone(browser, host, track) {
  say("— 4. Видео-зона, без барабана, без «играет после ответа» —");
  const songs = songsOf(12, track, { video: { source: "link", url: "https://rutube.ru/video/0123456789abcdef0123456789abcdef/", name: "" }, lyrics: [], times: [] });
  const game = await createSession(host, `Лото видео ${MARK}`, contentOf(songs, { drum: "off", playAfter: false, videoHide: true }));
  const pult = await open(browser, "Пульт видео", PHONE, host.token);
  await pult.goto(`${BASE}/host/${game.code}`);
  const screen = await open(browser, "Экран видео", TV);
  await screen.goto(`${BASE}/screen/${game.code}`);
  await click(pult, "Начать игру");
  await screen.getByText("Откройте карточки").waitFor({ timeout: WAIT });
  await click(pult, "Включить первую песню");
  await screen.locator(".lh-video__zone").waitFor({ timeout: WAIT });
  ok("Без барабана — сразу страница песни, видео в зоне 16:9");
  check(((await screen.locator(".lh-video__cover").textContent()) ?? "").includes("Слушаем песню № 1"), "«Прятать картинку до названия» — «Слушаем песню № 1»");
  check((await screen.locator(".lh-vinyl--small").count()) === 1, "Маленькая пластинка с номером над видео");
  check((await screen.locator(".lh-video__wm").count()) === 1, "Знак JR в углу видео");
  await hallLayout(screen, "Экран: видео");
  await shot(screen, "экран-видео");
  await click(pult, "Показать название");
  await screen.locator(".lh-answer").waitFor({ timeout: WAIT });
  check(((await screen.locator(".lh-answer").textContent()) ?? "").includes("Песня номер 1"), "Плашка ответа на видео — название песни");
  check((await pult.getByRole("button", { name: /Остановить песню/ }).count()) === 0, "Без «играет после ответа» — кнопки «Остановить песню» нет");
  await hallLayout(screen, "Экран: ответ на видео");
  await shot(screen, "экран-видео-ответ");
  await pult.context().close();
  await screen.context().close();
}

// ---------------------------------------------------------------- 5. карточка гостя: догадки и «Последний шанс»

async function cardFlow(browser, host) {
  say("— 5. Карточка гостя: догадки, проверка после ответа, заявка после названия, «Последний шанс» —");
  // 9 песен, карточка 3×3 — у каждого все 9 песен (в своём порядке), победа — ряд.
  const content = contentOf(songsOf(9, null, { lyrics: [], times: [] }), { drum: "quick", rule: "row", cardStyle: "classic", playAfter: false });
  const game = await createSession(host, `Лото карточка ${MARK}`, content);
  const pult = await open(browser, "Пульт", PHONE, host.token);
  await pult.goto(`${BASE}/host/${game.code}`);
  await pult.getByRole("button", { name: "Начать игру" }).waitFor({ timeout: WAIT });
  const screen = await open(browser, "Экран зала", TV);
  await screen.goto(`${BASE}/screen/${game.code}`);
  await screen.getByText("Присоединяйтесь к игре").waitFor({ timeout: WAIT });
  const guests = [];
  for (const name of ["Аня", "Боря"]) {
    const g = await open(browser, `Гость ${name}`);
    await g.goto(`${BASE}/play/${game.code}`);
    await g.getByLabel("Имя", { exact: true }).fill(name);
    await click(g, "Играть");
    await until(async () => (await pult.locator("main").textContent())?.includes(name), WAIT, `${name} на пульте`);
    guests.push(g);
  }
  const [anna, borya] = guests;
  await click(pult, "Начать игру");
  await screen.getByText("Откройте карточки").waitFor({ timeout: WAIT });
  await screen.mouse.click(640, 360);
  const cell = (p, n) => p.locator(".lotto-card__cell").filter({ hasText: new RegExp(`Песня номер ${n}(?!\\d)`) });
  const has = async (loc, cls) => ((await loc.getAttribute("class")) ?? "").split(/\s+/).includes(cls);
  const status = async (p) => (await p.locator(".quiz-phone__status").textContent()) ?? "";
  const lotto = (p) => p.getByRole("button", { name: "Лото!", exact: true });
  let annaQueued = 0;
  let annaWon = false;

  for (let k = 1; k <= 9; k++) {
    await click(pult, k === 1 ? "🎰 Крутить барабан — первая песня" : "🎰 Крутить барабан — следующая песня");
    await screen.locator(".lh-drum").waitFor({ timeout: WAIT });
    const number = await until(async () => /№ (\d+) ·/.exec((await pult.locator("main").textContent()) ?? "")?.[1] ?? null, WAIT, "номер на пульте");
    await screen.locator(".lh-song").waitFor({ timeout: 25_000 });
    // Отложенная заявка Ани ушла с этим барабаном — на пульте видна сразу.
    if (annaQueued && k === annaQueued + 1)
      check(await soft(async () => ((await pult.locator(".open-answers").textContent()) ?? "").includes("Аня"), WAIT, ""), "Заявка Ани, собранная после названия, ушла ведущему с новой песней", "Заявка Ани после названия не пришла на пульт");
    if (k === 1) {
      check(((await screen.locator(".lh-track__sub").textContent()) ?? "").includes("Угадайте песню! Как только ведущий откроет ответ"), "Экран: «Угадайте песню! Как только ведущий откроет ответ, правильное название появится на экране»", "Экран: нет подписи про угадывание");
      await hallLayout(screen, "Экран: угадайте песню");
      check(((await anna.locator(".lotto-hint").textContent()) ?? "").includes("Угадайте песню на слух"), "Телефон: «Угадайте песню на слух…»", "Телефон: нет подсказки про угадывание");
      check((await anna.locator(".lotto-card__cell.is-now").count()) === 0, "Телефон: пока песня звучит, ничего не светится", "Телефон: клетка светится до ответа — выдаёт песню");
      check((await anna.locator(".lotto-card__num").count()) === 0, "Телефон: до ответа номеров на карточке нет", "Телефон: номер на карточке до ответа");
      // Аня угадывает: одна догадка неверная, одна — верная.
      const wrong = number === "1" ? "2" : "1";
      await cell(anna, wrong).click();
      await cell(anna, number).click();
      check((await anna.locator(".lotto-card__cell.is-pencil").count()) === 2, "Отметки до ответа — «карандашом» (пунктир и «?»)", "Отметки до ответа не «карандашом»");
      check((await anna.getByText("«?» — ваша догадка", { exact: false }).count()) === 1, "Под карточкой — ««?» — ваша догадка…»", "Нет пояснения про «?»");
      await shot(anna, "карточка-догадки");
      await click(pult, "Показать название");
      await screen.locator(".lh-track__answer").waitFor({ timeout: WAIT });
      check(
        await soft(async () => ((await anna.locator(".lotto-hint.is-fixed").textContent()) ?? "").includes(`«Песня номер ${wrong}» ещё не звучала`), WAIT, ""),
        "После названия неверная догадка снята сама: «… ещё не звучала — отметку сняли»",
        "Неверная догадка не снята или нет сообщения",
      );
      check(!(await has(cell(anna, wrong), "is-pencil")) && !(await has(cell(anna, wrong), "is-marked")), "Неверная клетка снова пустая", "Неверная клетка осталась отмеченной");
      check((await has(cell(anna, number), "is-marked")) && ((await cell(anna, number).textContent()) ?? "").includes(`№ ${number}`), `Верная догадка стала отметкой, в углу «№ ${number}»`, "Верная догадка не стала отметкой или нет номера");
      check((await has(cell(borya, number), "is-now")) && ((await cell(borya, number).textContent()) ?? "").includes(`№ ${number}`), "У Бори песня подсветилась с номером бочонка", "У Бори нет подсветки или номера после названия");
      check(((await borya.locator(".lotto-hint").first().textContent()) ?? "").includes("Эта песня у вас есть"), "Телефон: «Эта песня у вас есть! Нажмите на светящуюся клетку»", "Нет «Эта песня у вас есть!»");
      await shot(anna, "карточка-после-ответа");
      await phoneLayout(anna, "Телефон: карточка после ответа");
    } else {
      if (!(await lotto(borya).isDisabled())) bad(`Песня ${k}: у Бори без отметок «Лото!» загорелся`);
      await click(pult, "Показать название");
      await screen.locator(".lh-track__answer").waitFor({ timeout: WAIT });
      // Аня отмечает подсветившуюся песню.
      await until(async () => (await anna.locator(".lotto-card__cell.is-now").count()) === 1, WAIT, `песня ${k} светится у Ани`);
      // Светящаяся клетка пульсирует (scale) — Playwright ждал бы, пока она «замрёт»; человеку это не мешает.
      if (!annaWon) await anna.locator(".lotto-card__cell.is-now").click({ force: true });
    }
    if (annaQueued && k === annaQueued + 1) {
      annaWon = await soft(async () => /Вы выиграли|ЛОТО! Верно!/.test(await status(anna)), WAIT, "");
      check(annaWon, "Заявка Ани после названия засчитана на следующей песне", `Заявка Ани не засчитана — «${await status(anna)}»`);
    }
    // Ряд у Ани собрался на названии — «Лото!» загорается, заявка ждёт следующей песни.
    if (!annaQueued && k < 9 && (await soft(async () => !(await lotto(anna).isDisabled()), 1500, ""))) {
      await lotto(anna).click();
      annaQueued = k;
      check(await soft(async () => (await status(anna)).includes("Заявка принята — уйдёт ведущему"), WAIT, ""), "Собрали на названии — «Заявка принята — уйдёт ведущему, как только закрутится следующий барабан»", `Нет статуса отложенной заявки — «${await status(anna)}»`);
    }
  }
  if (!annaQueued) note("Ряд у Ани собрался только на последней песне — отложенная заявка проверена «Последним шансом»");

  // Последняя песня: Боря отмечает всё после названия.
  check((await borya.locator(".lotto-card__cell.is-missed").count()) === 8, "Сыгранные неотмеченные клетки — в пунктире (8 + светящаяся)", `Пунктир у ${await borya.locator(".lotto-card__cell.is-missed").count()} клеток, ждали 8`);
  check((await borya.locator(".lotto-card__num").count()) === 9, "На всех сыгранных клетках — номер бочонка", "Не на всех сыгранных клетках номер");
  for (let n = 1; n <= 9; n++) await cell(borya, String(n)).click({ force: true });
  await until(async () => !(await lotto(borya).isDisabled()), WAIT, "«Лото!» у Бори");
  await lotto(borya).click();
  check(await soft(async () => (await status(borya)).includes("Последний шанс"), WAIT, ""), "Последняя песня: «Заявка ждёт — скажите ведущему «Лото!»: он откроет «Последний шанс»»", `Нет статуса — «${await status(borya)}»`);
  await click(pult, "🙋 Последний шанс «Лото!»");
  check(await soft(async () => ((await screen.locator(".lh-head__title").textContent()) ?? "").includes("Последний шанс"), WAIT, ""), "Экран: «Последний шанс «Лото!»», название песни остаётся", "Экран: нет «Последний шанс»");
  check((await screen.locator(".lh-track__answer").count()) === 1, "Экран: в «Последний шанс» название на месте", "Экран: название пропало в «Последний шанс»");
  await hallLayout(screen, "Экран: последний шанс");
  await shot(screen, "экран-последний-шанс");
  check(await soft(async () => ((await pult.locator(".open-answers").textContent()) ?? "").includes("Боря"), WAIT, ""), "Заявка Бори ушла сама, как только открылся «Последний шанс»", "Заявка Бори не пришла на пульт");
  await click(pult, "Проверить «Лото!» и закрыть приём");
  check(await soft(async () => /Вы выиграли|ЛОТО! Верно!/.test(await status(borya)), WAIT, ""), "«Проверить» — Боря выиграл", `Боря не выиграл — «${await status(borya)}»`);
  check((await pult.getByRole("button", { name: "🙋 Последний шанс «Лото!»" }).count()) === 0, "Второго «Последнего шанса» нет", "«Последний шанс» можно открыть ещё раз");
  await phoneLayout(pult, "Пульт: после последнего шанса");
  await shot(pult, "пульт-последний-шанс");
  for (const p of [pult, screen, anna, borya]) await p.context().close();
}

// ---------------------------------------------------------------- запуск

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const host = await login();
  ok("Ведущий вошёл");
  // Трек: 40 секунд тона, mp3 (ffmpeg в workflow).
  const file = join(SHOTS, "..", "track.mp3");
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:beep_factor=4:duration=40", "-ac", "2", "-b:a", "96k", file]);
  const trackId = `e2t${MARK}${rid()}`;
  const made = await api("POST", "/api/tracks", host.cookie, { id: trackId, title: `Проверка лото ${MARK}`, category: "music" });
  if (made.status !== 200) throw new Error(`трек: ${made.status}`);
  created.tracks.push(trackId);
  const up = await api("PUT", `/api/tracks/${trackId}/file`, host.cookie, new Uint8Array(readFileSync(file)), { "Content-Type": "audio/mpeg", "X-Duration": "40000" });
  if (up.status !== 200) throw new Error(`файл трека: ${up.status}`);
  ok("Трек для проверки загружен");

  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
  const parts = [
    ["конструктор", () => editor(browser, host, trackId)],
    ["игра на 24 песни", () => game24(browser, host, trackId)],
    ["табло 60 и 100", () => bigBoards(browser, host, trackId)],
    ["видео-зона", () => videoZone(browser, host, trackId)],
    ["карточка гостя", () => cardFlow(browser, host)],
  ];
  for (const [name, run] of parts) {
    try {
      await run();
    } catch (e) {
      bad(`${name}: ${String(e.message ?? e).replace(/\s+/g, " ").slice(0, 900)}`);
      // Что было на экранах в момент сбоя.
      for (const [who, page] of openPages) if (!page.isClosed()) await shot(page, `сбой-${name}-${who}`);
    }
    openPages.length = 0;
  }
  await browser.close();
}

async function cleanup() {
  try {
    const host = await login();
    for (const id of created.sessions) await api("POST", `/api/sessions/${id}/finish`, host.cookie).catch(() => undefined);
    for (const id of created.games) await api("DELETE", `/api/games/${id}`, host.cookie).catch(() => undefined);
    for (const id of created.tracks) await api("DELETE", `/api/tracks/${id}`, host.cookie).catch(() => undefined);
    note(`Убрано: игр ${created.games.length}, сессий ${created.sessions.length}, треков ${created.tracks.length}`);
  } catch (e) {
    bad(`уборка: ${String(e.message ?? e)}`);
  }
}

main()
  .catch((e) => bad(`проверка остановилась: ${String(e.message ?? e).slice(0, 300)}`))
  .finally(async () => {
    await cleanup();
    finish(problems.length > 0 ? 1 : 0);
  });
