// Проверка конструктора квиза на test.games.joy-rest.ru (CLAUDE.md, раздел 6, «Раунды и табло» — раунды отдельными
// блоками): настоящий браузер (Playwright, телефон 390 px) под входом ведущего load@joy-rest.ru. Создаётся личная
// игра-квиз из 8 вопросов без раундов, дальше — всё, что делает ведущий: «+ Разбить на раунды», переименовать раунд,
// открыть вопрос, «+ Добавить вопрос ниже», «Добавить вопрос» сверху (под открытым), «+ Новый раунд с этого вопроса»,
// «⋯ → Перенести в «…»», стрелки через блок раунда, ✕ у раунда и «Вернуть», свернуть раунд (и после перезагрузки),
// карта сеткой (касание квадратика открывает вопрос), «↑ К карте раундов», удалить последний вопрос раунда,
// предпросмотр вопроса и «Предпросмотр игры» (заставка раунда). После каждого шага — что сохранилось на сервере
// (раунды в content), что все кнопки отвечают; в конце — размеры шрифтов и кнопок, прокрутка вбок, ошибки страницы.
// Игра в конце удаляется. Снимки — в E2E_SHOTS (workflow кладёт их в ветку e2e-shots, папка quiz-editor/).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = (process.env.E2E_BASE ?? "https://test.games.joy-rest.ru").replace(/\/$/, "");
const EMAIL = process.env.LOAD_HOST_EMAIL ?? "";
const PASSWORD = process.env.LOAD_HOST_PASSWORD ?? "";
const SHOTS = process.env.E2E_SHOTS ?? "quiz-shots";
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
const check = (cond, good, fail) => (cond ? ok(good) : bad(fail ?? good));

function finish(code) {
  if (process.env.GITHUB_ACTIONS === "true") {
    const head = problems.length > 0 ? [`Замечаний: ${problems.length}`, ...problems.map((p) => `❌ ${p}`), "", "— Подробно —"] : [];
    const text = [...head, ...report].join("\n").replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, "%0A");
    console.log(`::${code === 0 ? "notice" : "error"} title=Конструктор квиза::${text}`);
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

async function api(method, path, cookie, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), "X-JoyRest": "1", Origin: BASE, Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
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

const TEXTS = [
  "Кто снял «Иронию судьбы»?",
  "В каком году вышел «Титаник»?",
  "Кто сыграл Шурика?",
  "Хатико — какая порода?",
  "Кто поёт «Миллион алых роз»?",
  "Солист группы «Кино»?",
  "Сколько лет Москве?",
  "Кто основал Москву?",
];
const rid = () => Math.random().toString(36).slice(2, 10);
const question = (text, i) => ({
  id: `qe${rid()}`,
  kind: "choice",
  text,
  options: [`Ответ ${i + 1}А`, `Ответ ${i + 1}Б`, `Ответ ${i + 1}В`],
  correct: 0,
  alsoCorrect: [],
  answers: [],
  steps: 1,
  pictures: [],
  timeLimit: 30,
  points: 100,
  imageId: null,
  trackId: null,
  trackStart: 0,
  trackLength: 15,
  round: null,
});

/** Раунды из сохранённой на сервере игры: [[название, с какого вопроса (1…)]]. */
async function savedRounds(cookie, id) {
  const { data } = await api("GET", `/api/games/${id}`, cookie);
  const qs = data?.game?.content?.questions ?? data?.content?.questions ?? [];
  return { count: qs.length, rounds: qs.flatMap((q, i) => (q.round ? [[q.round, i + 1]] : [])), texts: qs.map((q) => q.text) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const host = await login();
  ok("Ведущий вошёл");
  const gameId = `e2e${rid()}${rid()}`;
  const created = await api("POST", "/api/games", host.cookie, {
    id: gameId,
    scope: "personal",
    ownerId: host.uid,
    title: "Проверка раундов (робот)",
    mechanic: "quiz",
    themeId: "joyrest",
    ageRating: "0+",
    playMode: "teams",
    content: { questions: TEXTS.map(question) },
  });
  if (created.status !== 200 && created.status !== 201) throw new Error(`игра не создалась: ${created.status} ${JSON.stringify(created.data)}`);
  ok("Игра-квиз из 8 вопросов создана");

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU" });
  await context.addCookies([{ name: "__Host-jr_s", value: host.token, url: BASE }]);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message ?? e)));
  page.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && pageErrors.push(m.text()));
  let shot = 0;
  const snap = async (name) => {
    shot += 1;
    await page.screenshot({ path: join(SHOTS, `${String(shot).padStart(2, "0")}-${name}.png`), fullPage: false });
  };
  const settle = async () => {
    // Автосохранение: пачка правок уходит через 0,7 с; ждём «сохранены».
    await page.waitForTimeout(900);
    await page.getByText("Все изменения сохранены автоматически").first().waitFor({ timeout: WAIT }).catch(() => bad("Статус «сохранены» не появился за 15 с"));
  };
  const headers = () => page.locator(".q-round .q-round__name").allInnerTexts();
  const cards = () => page.locator(".q-list > .q-card");
  const openCard = () => page.locator(".q-list > .q-card.is-open");
  const cardByNumber = (n) => page.locator(".q-list > .q-card").filter({ has: page.locator(".q-card__number", { hasText: new RegExp(`^${n}$`) }) });

  try {
    await page.goto(`${BASE}/studio/games/${gameId}`);
    await page.locator(".round-map").waitFor({ timeout: WAIT });
    check((await cards().count()) === 8, "Конструктор открылся: 8 вопросов", `Вопросов на экране ${await cards().count()}, а не 8`);
    check(await page.getByText("Раундов нет — игра одним списком.").isVisible(), "Без раундов карта пишет «Раундов нет»");
    await snap("bez-raundov");

    // 1. Разбить на раунды.
    await page.getByRole("button", { name: "+ Разбить на раунды" }).first().click();
    await settle();
    let h = await headers();
    check(h.length === 2, `«+ Разбить на раунды»: два блока (${h.join(", ")})`, `После «Разбить» блоков ${h.length}: ${h.join(", ")}`);
    let s = await savedRounds(host.cookie, gameId);
    check(JSON.stringify(s.rounds) === JSON.stringify([["Раунд 2", 5]]), "На сервере: «Раунд 2» с 5-го вопроса", `На сервере раунды: ${JSON.stringify(s.rounds)}`);
    await snap("razbit");

    // 2. Назвать первый раунд (без названия) и переименовать второй.
    await page.locator(".q-round").nth(0).getByRole("button", { name: "Назвать раунд" }).click();
    await page.locator(".q-round__input").fill("Кино");
    await page.getByRole("button", { name: "Сохранить название" }).click();
    await page.locator(".q-round").nth(1).getByRole("button", { name: /Переименовать раунд/ }).click();
    const input = page.locator(".q-round__input");
    check((await input.inputValue()) === "Раунд 2", "✎ открывает поле с прежним названием");
    await input.fill("Музыка");
    await input.press("Enter");
    await settle();
    h = await headers();
    check(h.join("|") === "Кино|Музыка", "Раунды названы: Кино, Музыка", `Названия раундов: ${h.join(", ")}`);
    s = await savedRounds(host.cookie, gameId);
    check(JSON.stringify(s.rounds) === JSON.stringify([["Кино", 1], ["Музыка", 5]]), "На сервере: Кино с 1-го, Музыка с 5-го", `На сервере: ${JSON.stringify(s.rounds)}`);
    // Пустое название не стирает раунд.
    await page.locator(".q-round").nth(1).getByRole("button", { name: /Переименовать раунд/ }).click();
    await input.fill("   ");
    await input.press("Enter");
    await settle();
    check((await headers()).join("|") === "Кино|Музыка", "Пустое название — раунд остаётся «Музыкой»");
    // Escape — отмена.
    await page.locator(".q-round").nth(1).getByRole("button", { name: /Переименовать раунд/ }).click();
    await input.fill("Не то");
    await input.press("Escape");
    check((await headers()).join("|") === "Кино|Музыка", "Escape отменяет переименование");
    await snap("nazvany");

    // 3. Открыть вопрос 2: наверху — раунд и «+ Новый раунд с этого вопроса».
    await cardByNumber(2).locator(".q-card__summary").click();
    await openCard().waitFor({ timeout: WAIT });
    const tag = (await openCard().locator(".q-card__round-tag").innerText()).trim();
    check(/Кино · вопрос 2 из 4/.test(tag), `Наверху открытого вопроса: «${tag}»`, `Ярлык раунда: «${tag}»`);
    const bar = await openCard().locator(".q-card__round-bar").boundingBox();
    const text = await openCard().locator("textarea").first().boundingBox();
    check(bar && text && bar.y < text.y, "Раунд и «+ Новый раунд» — выше поля вопроса", "Строка раунда ниже поля вопроса");
    check(await openCard().getByRole("button", { name: "+ Новый раунд с этого вопроса" }).isVisible(), "Кнопка «+ Новый раунд с этого вопроса» видна сразу");
    await snap("otkryt-vopros-2");

    // 4. «+ Добавить вопрос ниже» — под вторым, в «Кино».
    await openCard().getByRole("button", { name: "+ Добавить вопрос ниже" }).click();
    await settle();
    check((await cards().count()) === 9, "«+ Добавить вопрос ниже»: стало 9 вопросов");
    const opened = (await openCard().locator(".q-card__number").innerText()).trim();
    check(opened === "3", "Новый вопрос — № 3 и сразу открыт", `Открыт вопрос № ${opened}`);
    check(await page.locator(":focus").evaluate((el) => el.tagName === "TEXTAREA").catch(() => false), "Курсор — в поле нового вопроса");
    await openCard().locator("textarea").first().fill("Новый вопрос под вторым");
    const opts = openCard().locator(".q-row__input");
    if ((await opts.count()) >= 2) {
      await opts.nth(0).fill("Да");
      await opts.nth(1).fill("Нет");
    }
    await settle();
    s = await savedRounds(host.cookie, gameId);
    check(s.texts[2] === "Новый вопрос под вторым" && JSON.stringify(s.rounds) === JSON.stringify([["Кино", 1], ["Музыка", 6]]), "На сервере: новый вопрос 3-й, в «Кино», «Музыка» с 6-го", `На сервере: ${JSON.stringify(s.rounds)}, 3-й: ${s.texts[2]}`);
    await snap("dobavit-nizhe");

    // 5. «Добавить вопрос» сверху — под открытым (№ 3).
    await page.getByRole("button", { name: "Добавить вопрос", exact: true }).first().click();
    await page.locator(".add-question").waitFor({ timeout: WAIT });
    await page.locator(".add-question").getByRole("button", { name: "Открытый ответ" }).click();
    await settle();
    const opened2 = (await openCard().locator(".q-card__number").innerText()).trim();
    check(opened2 === "4" && (await cards().count()) === 10, "«Добавить вопрос» сверху ставит вопрос под открытым (№ 4)", `Открыт № ${opened2}, вопросов ${await cards().count()}`);
    await openCard().locator("textarea").first().fill("Открытый вопрос");
    await settle();
    await snap("dobavit-sverhu");

    // 6. «+ Новый раунд с этого вопроса» на № 4.
    await openCard().getByRole("button", { name: "+ Новый раунд с этого вопроса" }).click();
    await settle();
    h = await headers();
    check(h.length === 3, `Новый раунд с вопроса 4: блоки ${h.join(", ")}`, `Блоков ${h.length}: ${h.join(", ")}`);
    check(!(await openCard().getByRole("button", { name: "+ Новый раунд с этого вопроса" }).isVisible().catch(() => false)), "У первого вопроса раунда кнопки «Новый раунд» нет");
    s = await savedRounds(host.cookie, gameId);
    check(JSON.stringify(s.rounds) === JSON.stringify([["Кино", 1], ["Раунд 2", 4], ["Музыка", 7]]), "На сервере: Кино 1, Раунд 2 с 4-го, Музыка с 7-го", `На сервере: ${JSON.stringify(s.rounds)}`);
    await snap("novyi-raund");

    // 7. Свернуть открытый вопрос, «⋯ → Перенести в «Музыка»» у вопроса 1.
    await openCard().getByRole("button", { name: /Готово — свернуть вопрос/ }).click();
    await cardByNumber(1).getByRole("button", { name: "Действия с вопросом 1" }).click();
    const moveItem = page.getByRole("menuitem", { name: "Перенести в «Музыка»" });
    check(await moveItem.isVisible(), "В меню «⋯» есть «Перенести в «Музыка»»");
    await snap("menu-perenesti");
    await moveItem.click();
    await settle();
    s = await savedRounds(host.cookie, gameId);
    check(s.texts[9] === TEXTS[0] && JSON.stringify(s.rounds) === JSON.stringify([["Кино", 1], ["Раунд 2", 3], ["Музыка", 6]]), "Вопрос 1 переехал в конец «Музыки», блоки на местах", `На сервере: ${JSON.stringify(s.rounds)}, 10-й: ${s.texts[9]}`);

    // 8. Стрелка ↑ у первого вопроса «Музыки» — уходит в раунд выше.
    const firstMusic = cardByNumber(6);
    await firstMusic.getByRole("button", { name: "Поднять вопрос 6 выше" }).click();
    await settle();
    s = await savedRounds(host.cookie, gameId);
    check(JSON.stringify(s.rounds) === JSON.stringify([["Кино", 1], ["Раунд 2", 3], ["Музыка", 6]]), "Стрелка через блок: блоки на местах, вопрос ушёл в раунд выше", `На сервере: ${JSON.stringify(s.rounds)}`);
    await snap("strelka");

    // 9. ✕ у «Раунда 2» → «Вернуть».
    await page.locator(".q-round").nth(1).getByRole("button", { name: /Убрать раунд/ }).click();
    await page.locator(".toast--undo").waitFor({ timeout: WAIT });
    check((await headers()).length === 2, "✕ убрал блок «Раунд 2», вопросы остались");
    check((await cards().count()) === 10, "Вопросов по-прежнему 10");
    await snap("vernut");
    await page.locator(".toast--undo").getByRole("button", { name: "Вернуть" }).click();
    await settle();
    check((await headers()).join("|") === "Кино|Раунд 2|Музыка", "«Вернуть» вернул раунд");
    s = await savedRounds(host.cookie, gameId);
    check(s.rounds.length === 3, "На сервере снова три раунда", `На сервере: ${JSON.stringify(s.rounds)}`);

    // 10. Свернуть «Кино», перезагрузить — остаётся свёрнутым.
    await page.locator(".q-round").nth(0).getByRole("button", { name: "Свернуть раунд" }).click();
    check((await cards().count()) === 8, "«Кино» свёрнут — его 2 вопроса скрыты", `Видно вопросов: ${await cards().count()}`);
    await page.reload();
    await page.locator(".round-map").waitFor({ timeout: WAIT });
    await page.waitForTimeout(500);
    check((await cards().count()) === 8, "После перезагрузки «Кино» всё ещё свёрнут");
    await snap("svernut");

    // 11. Карта сеткой: квадратик вопроса 2 разворачивает «Кино» и открывает вопрос.
    await page.getByRole("button", { name: "Сеткой" }).click();
    const cells = await page.locator(".round-map__cell").count();
    check(cells === 10, `Сетка: ${cells} квадратиков`, `Квадратиков ${cells}, а не 10`);
    const labels = await page.locator(".round-map__label").allInnerTexts();
    check(labels.length === 3, `Подписи раундов в сетке: ${labels.map((l) => l.replace(/\s+/g, " ")).join(" / ")}`);
    await snap("setka");
    await page.locator(".round-map__cell", { hasText: /^2$/ }).click();
    await openCard().waitFor({ timeout: WAIT });
    check((await openCard().locator(".q-card__number").innerText()).trim() === "2" && (await cards().count()) === 10, "Касание квадратика 2 развернуло «Кино» и открыло вопрос 2");

    // 12. «↑ К карте раундов».
    await cardByNumber(10).scrollIntoViewIfNeeded();
    await cardByNumber(10).locator(".q-card__summary").click();
    await openCard().waitFor({ timeout: WAIT });
    await openCard().getByRole("button", { name: "↑ К карте раундов" }).click();
    await page.waitForTimeout(900);
    const mapBox = await page.locator(".round-map").boundingBox();
    check(mapBox && mapBox.y >= -5 && mapBox.y < 400, "«↑ К карте раундов» прокрутил к карте", `Карта на ${mapBox?.y}`);

    // 13. Удалить единственный вопрос раунда — сообщение, что раунд убран.
    await openCard().getByRole("button", { name: /Готово — свернуть вопрос/ }).click();
    // Сделать раунд из одного вопроса: новый раунд с вопроса 10 (последнего).
    await cardByNumber(10).locator(".q-card__summary").click();
    await openCard().getByRole("button", { name: "+ Новый раунд с этого вопроса" }).click();
    await settle();
    check((await headers()).length === 4, "Раунд из одного вопроса (№ 10) создан");
    await cardByNumber(10).getByRole("button", { name: "Действия с вопросом 10" }).click();
    await page.getByRole("menuitem", { name: "Удалить" }).click();
    await page.getByRole("button", { name: "Удалить вопрос", exact: true }).click();
    const toastText = await page.locator(".toast").first().innerText({ timeout: WAIT }).catch(() => "");
    check(/Раунд «Раунд 4» убран/.test(toastText), `Сообщение: «${toastText}»`, `Сообщения про раунд нет: «${toastText}»`);
    await settle();
    check((await headers()).length === 3, "Пустой раунд исчез");

    // 14. Предпросмотр вопроса.
    await cardByNumber(1).getByRole("button", { name: "Действия с вопросом 1" }).click();
    await page.getByRole("menuitem", { name: "Предпросмотр" }).click();
    const dlg = page.locator("dialog[open]");
    await dlg.waitFor({ timeout: WAIT });
    check(/Предпросмотр: вопрос 1/.test(await dlg.innerText()), "Предпросмотр вопроса открылся");
    await snap("predprosmotr-voprosa");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // 15. «Предпросмотр игры»: заставки раундов.
    await page.getByRole("button", { name: "Предпросмотр игры" }).click();
    const gp = page.locator("dialog[open]");
    await gp.waitFor({ timeout: WAIT });
    const seen = new Set();
    for (let i = 0; i < 80; i++) {
      const t = await gp.innerText();
      for (const name of ["Кино", "Раунд 2", "Музыка"]) if (t.includes(name)) seen.add(name);
      if (i === 2) await snap("predprosmotr-igry");
      const next = gp.getByRole("button", { name: "Дальше" });
      if (!(await next.isEnabled().catch(() => false))) break;
      await next.click();
      await page.waitForTimeout(120);
    }
    check(seen.size === 3, `Предпросмотр игры показывает раунды: ${[...seen].join(", ")}`, `В предпросмотре видны только: ${[...seen].join(", ") || "ничего"}`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // 15б. Анкета вопроса: Enter в последнем варианте — новая строка, время и очки одним касанием, «Дальше — вопрос N».
    await cardByNumber(1).locator(".q-card__summary").click();
    await openCard().waitFor({ timeout: WAIT });
    const rows = openCard().locator(".q-row__input");
    const before = await rows.count();
    await rows.nth(before - 1).click();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    check((await rows.count()) === before + 1, `Enter в последнем варианте добавил строку (${before} → ${await rows.count()})`);
    check(await page.locator(":focus").evaluate((el) => el.classList.contains("q-row__input")).catch(() => false), "Курсор — в новой строке");
    await page.keyboard.type("Ответ по Enter");
    await openCard().getByRole("button", { name: "20 с", exact: true }).click();
    await openCard().getByRole("button", { name: "200", exact: true }).click();
    await settle();
    const g = await api("GET", `/api/games/${gameId}`, host.cookie);
    const q1 = g.data?.content?.questions?.[0];
    check(q1?.timeLimit === 20 && q1?.points === 200 && q1?.options?.includes("Ответ по Enter"), "На сервере: 20 с, 200 очков, новый вариант", `На сервере: ${q1?.timeLimit} с, ${q1?.points} очк., варианты ${JSON.stringify(q1?.options)}`);
    // Порядок анкеты: варианты, время и очки, заметка — выше свёрнутых «Картинки» и «Трека».
    const order = await openCard().evaluate((card) => {
      const y = (el) => (el ? el.getBoundingClientRect().top : null);
      const folds = [...card.querySelectorAll("details.fold")];
      const fold = (t) => folds.find((d) => d.querySelector(".fold__title")?.textContent?.includes(t)) ?? null;
      const legend = [...card.querySelectorAll("legend")].find((l) => l.textContent.includes("Варианты ответа"));
      const note = [...card.querySelectorAll("label")].find((l) => l.textContent.includes("Заметка ведущему"));
      const image = fold("Картинка к вопросу");
      const track = fold("Трек к вопросу");
      return { options: y(legend), note: y(note), image: y(image), imageOpen: image?.open ?? null, track: y(track), trackOpen: track?.open ?? null };
    });
    check(order.options !== null && order.image !== null && order.options < order.image, "Варианты — сразу под вопросом, выше «Картинки»", `Порядок: ${JSON.stringify(order)}`);
    check(order.note !== null && order.note < order.image, "«Заметка ведущему» — выше «Картинки» и «Трека»", `Порядок: ${JSON.stringify(order)}`);
    check(order.imageOpen === false, "«Картинка к вопросу» свёрнута, пока картинки нет");
    check(order.track === null || order.trackOpen === false, "«Трек к вопросу» свёрнут, пока трека нет");
    // Удалить вариант — «Вернуть».
    const countNow = await rows.count();
    const removedText = await rows.nth(1).inputValue();
    await openCard().getByRole("button", { name: /^Удалить вариант B/ }).click();
    check((await rows.count()) === countNow - 1, "Вариант B удалён");
    const restoreBar = openCard().locator(".q-restore");
    check(await restoreBar.isVisible(), `Появилось «${(await restoreBar.innerText().catch(() => "")).replace(/\s+/g, " ")}»`);
    await snap("udalen-variant");
    await restoreBar.getByRole("button", { name: "Вернуть" }).click();
    check((await rows.count()) === countNow && (await rows.nth(1).inputValue()) === removedText, "«Вернуть» вернул вариант B на место");
    await settle();
    await snap("anketa");
    await openCard().getByRole("button", { name: /Дальше — вопрос 2/ }).click();
    await page.waitForTimeout(500);
    check((await openCard().locator(".q-card__number").innerText()).trim() === "2", "«Дальше — вопрос 2» открыл следующий вопрос");
    // Новый вопрос — без заранее отмеченного правильного варианта.
    await openCard().getByRole("button", { name: "+ Добавить вопрос ниже" }).click();
    await page.waitForTimeout(400);
    check((await openCard().locator(".q-row--correct").count()) === 0, "В новом вопросе правильный вариант не отмечен заранее");
    await openCard().getByRole("button", { name: /Готово — свернуть/ }).click();

    // 16. Размеры: шрифт, кнопки, прокрутка вбок.
    const sizes = await page.evaluate(() => {
      const small = [];
      const tiny = [];
      for (const el of document.querySelectorAll(".round-map *, .q-round *, .q-round-add *, .q-card__round-bar *")) {
        const st = getComputedStyle(el);
        if (st.display === "none" || !el.childNodes.length) continue;
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (own && parseFloat(st.fontSize) < 13) small.push(`${el.className || el.tagName}: ${st.fontSize}`);
        if (el.tagName === "BUTTON") {
          const r = el.getBoundingClientRect();
          if (r.width && r.height < 40) tiny.push(`${el.textContent.trim().slice(0, 30)}: ${Math.round(r.height)} px`);
        }
      }
      return { small, tiny, wide: document.documentElement.scrollWidth > window.innerWidth + 1 };
    });
    check(sizes.small.length === 0, "Шрифт раундов не мельче 13 px", `Мелкий шрифт: ${sizes.small.slice(0, 5).join("; ")}`);
    check(sizes.tiny.length === 0, "Кнопки раундов не ниже 40 px", `Низкие кнопки: ${sizes.tiny.slice(0, 5).join("; ")}`);
    check(!sizes.wide, "Нет прокрутки вбок");
    await page.evaluate(() => window.scrollTo(0, 0));
    await snap("itog");
    check(pageErrors.length === 0, "Ошибок страницы нет", `Ошибки страницы: ${pageErrors.slice(0, 3).join(" | ")}`);
  } catch (error) {
    bad(`Сценарий прервался: ${String(error?.message ?? error).split("\n")[0]}`);
    await snap("oshibka").catch(() => {});
  } finally {
    await browser.close();
    const del = await api("DELETE", `/api/games/${gameId}`, host.cookie);
    say(del.status < 300 ? "Игра проверки удалена" : `Игру проверки удалить не вышло: ${del.status}`);
  }
}

main()
  .then(() => finish(problems.length === 0 ? 0 : 1))
  .catch((error) => {
    bad(String(error?.message ?? error));
    finish(1);
  });
