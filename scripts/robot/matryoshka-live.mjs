// Живая игра на 50 для стенда телефона «Игр Матрёшки» (Блок 3b; запускает `matryoshka-phone.mjs live`): настоящий движок комнаты
// в этом процессе (`matryoshka-live-room.ts`, собирается esbuild), 47 ботов и три настоящих телефона в браузере (360, 390,
// 412 px). Playwright играет телефонами по экрану: держит и отпускает зону «Замри!» (один — с подстроенными сбоями), выбирает
// коробку и обводит пряник, садится на стул, жмёт узел, прыгает, отвечает, ставит, показывает жест. Пульт жмёт главную кнопку.
// Время комнаты и телефонов — общее, ускоренное в SPEED раз (по умолчанию 2).
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const SPEED = Number(process.env.SPEED ?? 2);
const PLAYERS = Number(process.env.PLAYERS ?? 50);
const NAMES = ["Аня", "Сева", "Ира", "Лёша", "Маша", "Дима", "Катя", "Олег", "Лена", "Паша"];
const EMOJI = ["🦊", "🐻", "🐼", "🐯", "🦁", "🐸", "🐙", "🦄", "🐝", "🦋"];

export async function live({ browser, port, out, note, traceShape }) {
  const dir = path.join(out, "live");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "room.mjs");
  await build({ entryPoints: [path.join(import.meta.dirname, "matryoshka-live-room.ts")], bundle: true, platform: "node", format: "esm", outfile: file, logLevel: "error" });
  const { createLive } = await import(`${file}?${Date.now()}`);

  const t0 = Date.now();
  const start = 2_000_000_000_000;
  const vnow = () => start + (Date.now() - t0) * SPEED;
  const players = Array.from({ length: PLAYERS }, (_, i) => ({ pid: `b${i}`, name: `${EMOJI[i % 10]} ${NAMES[i % 10]}${i >= 10 ? ` ${Math.floor(i / 10) + 1}` : ""}` }));
  const phones = [
    { pid: "b3", width: 360, style: "glitchy" },
    { pid: "b17", width: 390, style: "good" },
    { pid: "b41", width: 412, style: "late" },
  ];
  const game = createLive({ players, phones: phones.map((p) => p.pid), content: { style: process.env.LIVE_STYLE ?? "sunny" }, now: vnow(), seed: "live", lazy: Number(process.env.LAZY ?? 30) });

  // Телефоны: страницы, связь с комнатой через функции страницы.
  const pages = [];
  for (const ph of phones) {
    const page = await browser.newPage({ viewport: { width: ph.width, height: 800 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.exposeFunction("liveSubscribe", (pid) => game.subscribe(pid, vnow()));
    await page.exposeFunction("liveInput", (pid, body) => game.input(pid, body, vnow()));
    const name = players.find((p) => p.pid === ph.pid)?.name ?? ph.pid;
    await page.goto(`http://127.0.0.1:${port}/?live=1&pid=${ph.pid}&name=${encodeURIComponent(name)}`);
    await page.evaluate(([b, s]) => window.__liveClock(b, s), [vnow(), SPEED]);
    pages.push({ ...ph, page, errors, seen: new Set(), held: false, acted: new Set(), screens: [], releases: 0, glitches: 0, taps: 0 });
  }

  const checks = [];
  let pauseState = "none";
  let pauseAt = 0;
  let lastTick = vnow();
  let done = false;
  let podiumAt = null;
  const stepGame = () => {
    const now = vnow();
    while (lastTick + 100 <= now) {
      lastTick += 100;
      game.tick(lastTick);
    }
    // Пульт: главная кнопка шага.
    const h = game.host(lastTick);
    const c = h?.can ?? {};
    if (h?.phase === "lobby" && c.start) game.command("start", lastTick);
    else if (c.chance) game.command("chance", lastTick);
    else if (c.next) game.command("next", lastTick);
    else if (c.duel) game.command("duel", lastTick);
    else if (c.podium) game.command("podium", lastTick);
    // Пауза посреди «Каната»: телефоны — «Пауза», после «Продолжить» — снова тянут.
    const ropePull = h?.trial?.rope?.sub === "pull";
    if (pauseState === "none" && ropePull) {
      game.room.command("pause", null, "p1", lastTick);
      pauseState = "paused";
      pauseAt = Date.now();
    } else if (pauseState === "paused" && Date.now() - pauseAt > 2500) {
      game.room.command("resume", null, "r1", lastTick);
      pauseState = "resumed";
      pauseAt = Date.now();
    }
    if (h?.phase === "podium" && podiumAt === null) podiumAt = Date.now();
    if (podiumAt !== null && Date.now() - podiumAt > 4000) done = true;
  };

  /** Перезагрузка страницы телефона: вид должен вернуться из снимка личного потока. */
  async function reload(p) {
    if (p.held) await p.page.mouse.up();
    p.held = false;
    await p.page.reload();
    await p.page.waitForFunction(() => window.standReady === true);
    // Пока ждём снимок — комната идёт и поток доходит (основной цикл стоит на этом телефоне).
    for (let i = 0; i < 50; i += 1) {
      stepGame();
      const events = game.drain(p.pid);
      await p.page.evaluate(([ev, b, s]) => {
        window.__liveClock(b, s);
        if (ev.length > 0) window.__liveDeliver(ev);
      }, [events, lastTick, SPEED]);
      const screen = await p.page.evaluate(() => document.querySelector(".mtp")?.dataset.screen ?? null);
      if (screen && screen !== "connecting") return screen;
      await p.page.waitForTimeout(100);
    }
    return p.page.evaluate(() => document.querySelector(".mtp")?.dataset.screen ?? null);
  }
  const traced = async (page) => Number(((await page.locator(".mtp-field").getAttribute("aria-label").catch(() => "")) ?? "").match(/(\d+)%/)?.[1] ?? -1);

  /** Один шаг телефона: что на экране — то и делаем. */
  async function act(p) {
    const page = p.page;
    const st = await page.evaluate(() => {
      const root = document.querySelector(".mtp");
      const z = document.querySelector(".mtp-zone");
      return { screen: root?.dataset.screen ?? null, zone: z?.getAttribute("data-state") ?? null };
    });
    const screen = st.screen;
    if (!screen) return;
    if (!p.seen.has(screen)) {
      p.seen.add(screen);
      p.screens.push(screen);
      await page.screenshot({ path: path.join(dir, `${p.pid}-${String(p.screens.length).padStart(2, "0")}-${screen}.png`) });
    }
    const once = (key) => {
      if (p.acted.has(key)) return false;
      p.acted.add(key);
      return true;
    };
    const click = async (sel) => {
      const el = page.locator(sel).first();
      if ((await el.count()) > 0 && (await el.isEnabled().catch(() => false))) await el.click({ timeout: 500 }).catch(() => undefined);
    };
    switch (screen) {
      case "freeze": {
        // Перезагрузка посреди бега: снова «Замри!», зона «стою» (палец поднят), путь — с сервера.
        if (p.style === "good" && once("reload-freeze")) {
          await page.waitForTimeout(1500);
          const again = await reload(p);
          const zone = await page.locator(".mtp-zone").getAttribute("data-state").catch(() => null);
          if (again !== "freeze" || zone === "run") note("перезагрузка в «Замри!»", `экран ${again}, зона ${zone}`);
          else checks.push(`перезагрузка в «Замри!» → ${again}, зона «${zone}»`);
          return;
        }
        const box = await page.locator(".mtp-zone").boundingBox();
        if (!box) return;
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        if (st.zone === "stand") {
          // Стоит: палец не на зоне — или телефон сам отпустил после сбоя (тот же палец не бежит — поднять и коснуться снова).
          if (p.held) await page.mouse.up();
          await page.mouse.move(cx, cy);
          await page.mouse.down();
          p.held = true;
        } else if ((st.zone === "look" || st.zone === "caught-risk") && p.held) {
          // Хороший — сразу; «поздний» — иногда опаздывает и попадается.
          if (p.style === "late" && Math.random() < 0.5) await page.waitForTimeout(700 / SPEED);
          await page.mouse.up();
          p.held = false;
          p.releases += 1;
        } else if (p.held && st.zone === "run" && p.style === "glitchy" && Math.random() < 0.04) {
          // Сбой посреди бега: уведомление, прокрутка или pointercancel — должно уйти «отпустил».
          const kind = p.glitches % 3;
          if (kind === 0) await page.evaluate(() => window.dispatchEvent(new Event("blur")));
          else if (kind === 1) await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
          else await page.dispatchEvent(".mtp-zone", "pointercancel", { pointerId: 1, bubbles: true });
          await page.mouse.up();
          p.held = false;
          p.glitches += 1;
        } else if (p.held && (st.zone === "off" || st.zone === "done")) {
          await page.mouse.up();
          p.held = false;
        }
        return;
      }
      case "guess":
        if (once(`guess:${p.screens.length}`)) await click(".mtp .btn--block");
        return;
      case "ginger-pick":
        if (once("box")) await click(`.mtp-box >> nth=${Math.floor(Math.random() * 4)}`);
        return;
      case "ginger-trace":
        if (p.style === "good" && once("trace-reload")) {
          // Обвёл половину — перезагрузка: обводка из sessionStorage, не меньше, чем была; потом доводит до конца.
          await traceShape(page, 0.5, { steps: 1 });
          const before = await traced(page);
          const again = await reload(p);
          const after = await traced(page);
          if (again !== "ginger-trace" || after < before || before <= 0) note("перезагрузка в «Прянике»", `экран ${again}, обведено ${before}% → ${after}%`);
          else checks.push(`перезагрузка в «Прянике» → обведено ${before}% → ${after}%`);
          await traceShape(page, 1.04, { steps: 1 });
          return;
        }
        if (once(`trace:${p.screens.length}`)) await traceShape(page, p.style === "glitchy" ? 0.6 : 1.04, { steps: 1 });
        return;
      case "chairs-tap":
        await page.waitForTimeout(150 + Math.random() * 300);
        await click(".mtp-chair");
        return;
      case "rope":
        for (let i = 0; i < 4; i += 1) await click(".mtp-knot");
        p.taps += 4;
        return;
      case "hop-brave":
        if (p.style !== "late" && once(`brave:${Date.now() >> 12}`)) await click(".mtp-brave");
        return;
      case "hop-jump":
      case "hop-choose":
      case "dob-choose":
        if (once(`${screen}:${await page.locator(".mtp-eyebrow").first().textContent().catch(() => "")}`)) await click(`.mtp-cell >> nth=${Math.random() < 0.5 ? 0 : 1}`);
        return;
      case "chance-question":
        if (once("chance")) await click(".mtp-option");
        return;
      case "duel":
        await click(`.mtp-gesture >> nth=${Math.floor(Math.random() * 3)}`);
        return;
      case "bet":
        if (once(`bet:${Date.now() >> 13}`)) await click(".mtp-option");
        return;
      default:
        if (p.held) {
          await page.mouse.up();
          p.held = false;
        }
    }
  }

  const deadline = Date.now() + 25 * 60 * 1000;
  while (!done && Date.now() < deadline) {
    stepGame();
    for (const p of pages) {
      const events = game.drain(p.pid);
      await p.page.evaluate(([ev, b, s]) => {
        window.__liveClock(b, s);
        if (ev.length > 0) window.__liveDeliver(ev);
      }, [events, lastTick, SPEED]);
    }
    await Promise.all(pages.map((p) => act(p).catch((e) => note(`живая игра ${p.pid}`, String(e)))));
    if ((pauseState === "paused" && Date.now() - pauseAt > 1500 && !checks.some((c) => c.startsWith("пауза"))) || (pauseState === "resumed" && Date.now() - pauseAt > 1500 && !checks.some((c) => c.startsWith("продолжить")))) {
      const screens = await Promise.all(pages.map((p) => p.page.evaluate(() => document.querySelector(".mtp")?.dataset.screen ?? null)));
      const word = pauseState === "paused" ? "пауза" : "продолжить";
      const ok = pauseState === "paused" ? screens.every((x) => x === "pause") : screens.every((x) => x !== "pause");
      if (!ok) note(`живая игра: ${word}`, `экраны телефонов ${screens.join(", ")}`);
      checks.push(`${word} → ${screens.join(", ")}`);
    }
  }
  for (const c of checks) console.log(`✓ ${c}`);
  if (!checks.some((c) => c.startsWith("пауза"))) note("живая игра", "пауза не проверена");
  const s = game.state();
  const phase = s.phase;
  if (phase !== "podium" && phase !== "finished") note("живая игра", `не дошла до пьедестала: фаза ${phase}`);
  const finalists = s.final?.seeds.length ?? 0;
  if (finalists !== s.F) note("живая игра", `в финале ${finalists}, а должно быть F = ${s.F}`);
  if (game.stamps.events === 0 || game.stamps.stamped !== game.stamps.events) note("живая игра", `события телефонов без отметки st: ${game.stamps.events - game.stamps.stamped} из ${game.stamps.events}`);
  for (const p of pages) {
    for (const e of p.errors) note(`живая игра ${p.pid}`, `ошибка страницы: ${e}`);
    const pushes = await p.page.evaluate(() => window.pushes.map((x) => ({ t: x.event.t, on: x.event.on, now: x.now })));
    const hs = pushes.filter((x) => x.t === "h" && x.now);
    // «Держу» и «отпустил» чередуются (сбой — всегда «отпустил»).
    let bad = 0;
    for (let i = 1; i < hs.length; i += 1) if (hs[i].on === hs[i - 1].on) bad += 1;
    if (bad > 0) note(`живая игра ${p.pid}`, `«держу»/«отпустил» не чередуются: ${bad}`);
    const m = s.members[p.pid];
    console.log(
      `✓ телефон ${p.pid} (${p.width} px, ${p.style}): экранов ${p.screens.length} — ${p.screens.join(", ")}; держал/отпускал ${hs.length}, сбоев ${p.glitches}; итог: ${m?.role}, сердечек ${m?.hearts}, мест ${JSON.stringify(m?.places)}`,
    );
    await p.page.close();
  }
  console.log(`живая игра: фаза ${phase}, игроков ${PLAYERS}, финалистов ${finalists} (F = ${s.F}), чемпион ${s.final?.champion ?? "—"}, событий телефонов ${game.stamps.events} (все с отметкой st: ${game.stamps.stamped === game.stamps.events}), шла ${Math.round((Date.now() - t0) / 1000)} с`);
}
