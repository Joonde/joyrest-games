// Ход игры «Игр Матрёшки» (docs/matryoshka.md): номера по входу, каждая команда пульта вперёд и назад, отказ не в свой шаг,
// «Второй шанс», «Добивка», финал, «Назад», «Вернуть» и «Убрать», пауза, снимок → восстановление, виды без тайн, баллы.
import { describe, expect, it } from "vitest";
import { BOARD_PAGE_MS, BOARD_PAGE_ROWS, MIN_PLAYERS, PLAYED_TRIALS_MIN, SCREEN_BYTES_MAX, UNIT_FINAL } from "./constants";
import { questionsOf, TRIAL_KINDS } from "./content";
import { input, moment, playedToEnd, playUnit, restore, snapshot } from "./game";
import { inGame, standings } from "./members";
import type { MatState } from "./types";
import { fitScreen, screenBytes } from "./views";
import { World } from "./world.test-kit";

/** Провести испытание ботами до итогов. */
function toResults(w: World): void {
  w.until(() => w.s.trial?.stage === "results" && w.s.phase === "trial", 400_000, true);
}

/** Провести игру ботами до пьедестала (пульт жмёт главную кнопку). */
function playToPodium(w: World, opts: { chance?: boolean } = {}): void {
  for (let i = 0; i < 40 * 60 * 10 && w.s.phase !== "podium"; i += 1) {
    w.step(100, true);
    const c = w.host().can;
    if (c.chance && opts.chance !== false) w.cmd("chance");
    else if (c.next) w.cmd("next");
    else if (c.duel) w.cmd("duel");
    else if (c.podium) w.cmd("podium");
  }
}

describe("лобби и «Начать»", () => {
  it("номера «№ 001…» — по порядку входа; «Начать» — от 6 игроков; опоздавший — болельщик", () => {
    const w = new World(5, {}, "lobby");
    expect(Object.values(w.s.members).map((m) => m.num)).toEqual([1, 2, 3, 4, 5]);
    expect(w.s.members.p3?.num).toBe(4);
    expect(w.host().can.start).toBe(false);
    expect(w.cmd("start")).toEqual({ ok: false, error: "no-players" });
    w.addPlayer("x", "Шестой");
    expect(w.s.members.x?.num).toBe(6);
    expect(w.host().can.start).toBe(true);
    expect(MIN_PLAYERS).toBe(6);
    expect(w.cmd("start")).toEqual({ ok: true, result: { finalists: 3 } });
    expect(inGame(w.s).length).toBe(6);
    expect(w.s.members.p0?.hearts).toBe(2);
    w.addPlayer("late", "Опоздавший");
    expect(w.s.members.late?.role).toBe("fan");
    expect(w.s.members.late?.late).toBe(true);
    expect(w.s.members.late?.num).toBe(7);
    // Повтор «Начать» (двойное касание) — не в свой шаг.
    expect(w.cmd("start")).toEqual({ ok: false, error: "wrong-phase" });
  });

  it("взрослые — 1 сердечко; больше 100 — первые 100 играют, остальные болеют", () => {
    const w = new World(103, { style: "night" }, "big");
    w.cmd("start");
    expect(inGame(w.s).length).toBe(100);
    expect(w.s.members.p0?.hearts).toBe(1);
    expect(w.s.members.p102?.role).toBe("fan");
    expect(w.s.startCount).toBe(100);
  });
});

describe("команды пульта: вперёд, назад, не в свой шаг", () => {
  it("«Пропустить правило», «+10 секунд» и «Закончить сейчас» — только в свой шаг; у «Стульев» их нет (L34, L35)", () => {
    const w = new World(10, { style: "night", trials: [{ kind: "chairs", on: true }] }, "cmds");
    w.cmd("start");
    expect(w.cmd("more-time")).toEqual({ ok: false, error: "wrong-phase" });
    w.until(() => w.s.trial?.stage === "rules");
    expect(w.cmd("skip-rules").ok).toBe(true);
    expect(w.s.trial?.stage).toBe("countdown");
    expect(w.cmd("skip-rules")).toEqual({ ok: false, error: "wrong-phase" });
    toResults(w);
    w.cmd("next");
    expect(w.s.trial?.kind).toBe("chairs");
    w.until(() => w.s.trial?.stage === "play");
    expect(w.cmd("more-time")).toEqual({ ok: false, error: "wrong-phase" });
    expect(w.cmd("end-now")).toEqual({ ok: false, error: "wrong-phase" });
    expect(w.cmd("next")).toEqual({ ok: false, error: "wrong-phase" });
    expect(w.cmd("nonsense")).toEqual({ ok: false, error: "unknown-command" });
  });

  it("«Пропустить испытание» — на раскрытии и правиле: никто не выбывает, цель — на оставшиеся", () => {
    const w = new World(12, { style: "night" }, "skip");
    w.cmd("start");
    expect(w.host().can["skip-trial"]).toBe(true);
    expect(w.cmd("skip-trial").ok).toBe(true);
    expect(w.s.trial?.index).toBe(1);
    expect(w.s.playedTrials[0]).toBe(false);
    expect(inGame(w.s).length).toBe(12);
    w.until(() => w.s.trial?.stage === "play");
    expect(w.s.trial?.k).toBe(4);
    expect(w.cmd("skip-trial")).toEqual({ ok: false, error: "wrong-phase" });
  });

  it("«Назад» с итогов: вылет снят, сердечки, очки болельщиков, монеты и Копилка — как до испытания; вошедшие и убранные остаются (L32)", () => {
    const w = new World(20, { style: "night" }, "back");
    w.cmd("start");
    toResults(w);
    w.cmd("next");
    toResults(w);
    const before = JSON.stringify({ piggy: w.s.piggy, ...Object.fromEntries(Object.values(w.s.members).map((m) => [m.pid, [m.role, m.hearts, m.coins, m.fanScore]])) });
    w.cmd("next");
    w.addPlayer("late", "Опоздал");
    w.until(() => w.s.trial?.stage === "rules");
    w.cmd("remove", { pid: inGame(w.s)[0]?.pid });
    const removed = Object.values(w.s.members).find((m) => m.removed)?.pid;
    toResults(w);
    const attempt = w.s.attempt;
    const m1 = moment(w.s);
    expect(w.s.piggy).toBeGreaterThan(JSON.parse(before).piggy);
    expect(w.cmd("back").ok).toBe(true);
    expect(w.s.attempt).toBe(attempt + 1);
    expect(moment(w.s)).not.toBe(m1);
    expect(w.s.trial?.stage).toBe("open");
    expect(w.s.trial?.index).toBe(2);
    // Как до испытания — кроме убранного (остался убранным) и опоздавшего (остался болельщиком).
    const after = JSON.parse(JSON.stringify({ piggy: w.s.piggy, ...Object.fromEntries(Object.values(w.s.members).filter((m) => m.pid !== "late").map((m) => [m.pid, [m.role, m.hearts, m.coins, m.fanScore]])) }));
    const was = JSON.parse(before);
    if (removed) {
      expect(after[removed]).toEqual(["fan", 0, 0, 0]);
      delete after[removed];
      delete was[removed];
    }
    expect(after).toEqual(was);
    expect(w.s.members.late?.role).toBe("fan");
    // «Назад» со старым этапом (второй пульт) — ничего.
    expect(w.cmd("back")).toEqual({ ok: false, error: "wrong-phase" });
  });

  it("«Вернуть игрока» — на итогах (впереди есть испытание) и на правиле: с 1 сердечком; «Убрать» — болельщик без монеты", () => {
    const w = new World(12, { style: "night" }, "return");
    w.cmd("start");
    toResults(w);
    const out = w.s.trial?.outcome?.out[0];
    expect(out).toBeDefined();
    expect(w.host().can.return).toBe(true);
    const piggy = w.s.piggy;
    expect(w.cmd("return", { pid: out }).ok).toBe(true);
    expect(w.s.members[out ?? ""]?.role).toBe("player");
    expect(w.s.members[out ?? ""]?.hearts).toBe(1);
    expect(w.s.piggy).toBe(piggy);
    expect(w.cmd("return", { pid: out })).toEqual({ ok: false, error: "not-out" });
    expect(w.cmd("return", { pid: "nobody" })).toEqual({ ok: false, error: "no-player" });
    expect(w.cmd("remove", { pid: out }).ok).toBe(true);
    expect(w.s.members[out ?? ""]?.removed).toBe(true);
    expect(w.s.piggy).toBe(piggy);
    expect(w.cmd("remove", { pid: out })).toEqual({ ok: false, error: "not-player" });
    // Убранного можно вернуть.
    expect(w.cmd("return", { pid: out }).ok).toBe(true);
    // Посреди игры «Вернуть» нельзя.
    w.cmd("next");
    w.until(() => w.s.trial?.stage === "play");
    w.cmd("remove", { pid: out });
    expect(w.cmd("return", { pid: out })).toEqual({ ok: false, error: "wrong-phase" });
  });

  it("«Табло на экран» — включить и убрать; на экране только номера и сердечки", () => {
    const w = new World(8, {}, "board");
    w.cmd("start");
    expect(w.cmd("board").ok).toBe(true);
    expect(w.screen().scoreboard?.rows.length).toBe(8);
    expect(w.screen().scoreboard?.rows.every(([num, hearts]) => num >= 1 && hearts >= 1)).toBe(true);
    expect(w.cmd("board").ok).toBe(true);
    expect(w.screen().scoreboard).toBeUndefined();
  });

  it("«Табло» на 100 игроках — страницами по 25, страница сменяется сама, за круг видны все (второе ревью 3a)", () => {
    const w = new World(100, {}, "board-100");
    w.cmd("start");
    expect(w.cmd("board").ok).toBe(true);
    const seen = new Set<number>();
    const pages = new Set<number>();
    for (let i = 0; i < (BOARD_PAGE_MS / 100) * 5; i += 1) {
      const b = w.screen().scoreboard;
      expect(b?.total).toBe(100);
      expect(b?.pages).toBe(Math.ceil(100 / BOARD_PAGE_ROWS));
      expect(b?.rows.length).toBe(BOARD_PAGE_ROWS);
      pages.add(b?.page ?? -1);
      for (const [num] of b?.rows ?? []) seen.add(num);
      w.now += 100;
    }
    expect(pages.size).toBe(4);
    expect(seen.size).toBe(100);
  });
});

describe("«Второй шанс»", () => {
  it("после 3-го испытания: вернуть ⌈10% × всех выбывших⌉ первых верных; верных меньше — все верные; «Назад» — к итогам 3-го (решение 9, L23, L32)", () => {
    const w = new World(50, { style: "night", secondChance: 10 }, "chance");
    w.cmd("start");
    for (let i = 0; i < 3; i += 1) {
      toResults(w);
      if (i < 2) {
        expect(w.host().can.chance).toBe(false);
        w.cmd("next");
      }
    }
    expect(w.host().can.chance).toBe(true);
    const knocked = Object.values(w.s.members).filter((m) => m.role === "fan" && m.everOut).length;
    expect(knocked).toBeGreaterThan(30);
    const resultsMoment = moment(w.s);
    w.cmd("chance");
    const c = w.s.chance;
    if (!c) throw new Error("нет второго шанса");
    expect(c.count).toBe(Math.ceil(0.1 * knocked));
    expect(c.eligible.length).toBe(knocked);
    // Игрок ответить не может; вопрос открыт только выбывшим.
    w.until(() => w.s.chance?.stage === "question");
    const q = questionsOf(w.s.content)[c.question];
    expect(w.in(inGame(w.s)[0]?.pid ?? "", [{ t: "ans", i: 0, rt: 900 }])).toBe(false);
    expect((w.me(inGame(w.s)[0]?.pid ?? "")?.chance as { q: unknown }).q).toBeNull();
    // Двое отвечают верно (медленный и быстрый), остальные — неверно. Реакция — от показа вопроса, по времени ответа.
    const [slow, fast, ...rest] = c.eligible;
    const shown = c.stageAt + w.s.offset;
    const at = (ms: number) => {
      w.now = shown + ms;
    };
    at(500);
    for (const pid of rest.slice(0, 10)) w.in(pid, [{ t: "ans", i: ((q?.correct ?? 0) + 1) % 4, rt: 500 }]);
    at(900);
    w.in(fast ?? "", [{ t: "ans", i: q?.correct ?? 0, rt: 900 }]);
    // Реакция < 300 мс — не принимается; второй ответ — тоже.
    expect(w.in(rest[11] ?? "", [{ t: "ans", i: 0, rt: 200 }])).toBe(false);
    expect(w.in(fast ?? "", [{ t: "ans", i: 0, rt: 900 }])).toBe(false);
    at(3000);
    w.in(slow ?? "", [{ t: "ans", i: q?.correct ?? 0, rt: 3000 }]);
    // Реакция не сходится с часами сервера (ответ на 3 с с заявленными 300 мс) — не принят (аудит 3a).
    expect(w.in(rest[12] ?? "", [{ t: "ans", i: q?.correct ?? 0, rt: 300 }])).toBe(false);
    // Экран: верный ответ — только после возвращения.
    expect((w.screen().chance as { correct: unknown }).correct).toBeNull();
    w.until(() => w.s.chance?.stage === "done");
    expect(c.returned).toEqual(c.count >= 2 ? [fast, slow] : [fast]);
    expect(w.s.members[fast ?? ""]?.role).toBe("player");
    expect(w.s.members[fast ?? ""]?.hearts).toBe(1);
    expect((w.screen().chance as { correct: unknown }).correct).toBe(q?.correct);
    const piggy = w.s.piggy;
    // «Назад» — к итогам 3-го, вернувшиеся снова болеют, «Второй шанс» снова доступен (следующий вопрос).
    expect(w.cmd("back").ok).toBe(true);
    expect(w.s.phase).toBe("trial");
    expect(w.s.trial?.stage).toBe("results");
    expect(w.s.members[fast ?? ""]?.role).toBe("fan");
    expect(w.s.piggy).toBe(piggy);
    expect(w.host().can.chance).toBe(true);
    expect(moment(w.s)).not.toBe(resultsMoment);
    w.cmd("chance");
    expect(w.s.chance?.question).toBe((c.question + 1) % questionsOf(w.s.content).length);
  });

  it("выключен или после 3-го испытания нет испытаний — «Второго шанса» нет", () => {
    const off = new World(30, { style: "night", secondChance: 0 }, "off");
    off.cmd("start");
    for (let i = 0; i < 3; i += 1) {
      toResults(off);
      if (i < 2) off.cmd("next");
    }
    expect(off.host().can.chance).toBe(false);
    const three = new World(30, { style: "night", trials: TRIAL_KINDS.map((kind, i) => ({ kind, on: i < 3 })) }, "three");
    three.cmd("start");
    for (let i = 0; i < 3; i += 1) {
      toResults(three);
      if (i < 2) three.cmd("next");
    }
    expect(three.host().can.chance).toBe(false);
  });
});

describe("«Добивка», финал, пьедестал", () => {
  it("лишние перед финалом — «Добивка», «Назад» с её итогов — к итогам последнего испытания", () => {
    const w = new World(40, { style: "sunny", secondChance: 0 }, "dob");
    w.cmd("start");
    for (let i = 0; i < 5; i += 1) {
      toResults(w);
      if (i < 4) w.cmd("next");
    }
    const alive = inGame(w.s).length;
    const heartsBefore = new Map(inGame(w.s).map((m) => [m.pid, m.hearts]));
    w.cmd("next");
    if (alive > w.s.F) {
      expect(w.s.phase).toBe("dobivka");
      // Падение в «Добивке» сердечком не прощается; упало больше, чем нужно, — среди упавших решают сердечки (решение 14 ноября).
      w.until(() => w.s.dobivka?.stage === "results", 200_000, true);
      expect(inGame(w.s).length).toBe(w.s.F);
      // Сердечко падение не отнимает: у оставшихся (и упавших, но оставшихся) — сколько было.
      for (const m of inGame(w.s)) expect(m.hearts).toBe(heartsBefore.get(m.pid));
      expect(w.host().can.back).toBe(true);
      w.cmd("back");
      expect(w.s.phase).toBe("trial");
      expect(inGame(w.s).length).toBe(alive);
      w.cmd("next");
      expect(w.s.phase).toBe("dobivka");
    } else expect(w.s.phase).toBe("final");
  });

  it("финал: «Начать дуэль», ставки болельщиков +1, «Переиграть раунд», «Засчитать победу сопернику», чемпион, «Лучший болельщик», пьедестал", () => {
    const w = new World(30, { style: "night" }, "final");
    w.cmd("start");
    // Болельщик — опоздавший (убранные — тоже болельщики, но «Лучшим болельщиком» не становятся).
    w.addPlayer("fanx", "Болельщик");
    w.until(() => w.s.trial?.stage === "rules");
    // Быстро к финалу: убираем лишних, пока в игре не F.
    while (inGame(w.s).length > 4) w.cmd("remove", { pid: inGame(w.s).at(-1)?.pid });
    expect(w.host().can["to-final"]).toBe(true);
    w.cmd("to-final");
    expect(w.s.phase).toBe("final");
    expect(w.s.final?.seeds.length).toBe(4);
    expect(w.host().can.back).toBe(true);
    expect(w.cmd("duel").ok).toBe(true);
    const d = w.s.final?.duel;
    if (!d) throw new Error("нет дуэли");
    expect(d.stage).toBe("bets");
    const fan = "fanx";
    expect(w.in(fan, [{ t: "bet", side: 0 }])).toBe(true);
    expect(w.in(d.a, [{ t: "bet", side: 0 }])).toBe(false);
    w.until(() => d.stage === "pick");
    expect(w.in(d.a, [{ t: "rps", g: "r" }])).toBe(true);
    expect(w.in(fan, [{ t: "rps", g: "r" }])).toBe(false);
    // Жесты на экране — только на показе.
    expect((w.screen().final as { duel: { gestures: unknown } }).duel.gestures).toBeNull();
    w.until(() => d.stage === "show");
    expect((w.screen().final as { duel: { gestures: unknown } }).duel.gestures).not.toBeNull();
    expect(w.cmd("rerun").ok).toBe(true);
    expect(d.stage).toBe("pick");
    expect(d.history.length).toBe(0);
    expect(w.cmd("forfeit", { pid: d.b }).ok).toBe(true);
    expect(d.winner).toBe(d.a);
    expect(w.s.members[fan]?.fanScore).toBe(1);
    expect(w.cmd("forfeit", { pid: d.b })).toEqual({ ok: false, error: "wrong-phase" });
    for (let i = 0; i < 2000 && w.s.final?.stage !== "champion"; i += 1) {
      if (w.host().can.duel) w.cmd("duel");
      w.step(100, true);
    }
    expect(w.s.final?.champion).not.toBeNull();
    expect(w.s.bestFan).toBe("fanx");
    expect(playedToEnd(w.s)).toBe(false);
    w.cmd("podium");
    expect(w.s.phase).toBe("podium");
    // Сыграно меньше 3 испытаний — «до конца» нет (решение владельца 8).
    expect(playedToEnd(w.s)).toBe(false);
    expect(w.cmd("finish").ok).toBe(true);
    expect(w.s.phase).toBe("finished");
  });

  it("«Переиграть раунд» после третьей ничьей подряд (решила скорость) — снова две ничьи в запасе, победа снята", () => {
    const w = new World(8, { style: "night", fanBets: false }, "rerun");
    w.cmd("start");
    w.until(() => w.s.trial?.stage === "rules");
    while (inGame(w.s).length > 2) w.cmd("remove", { pid: inGame(w.s).at(-1)?.pid });
    w.cmd("to-final");
    w.cmd("duel");
    const d = w.s.final?.duel;
    if (!d) throw new Error("нет дуэли");
    for (let round = 0; round < 3; round += 1) {
      w.until(() => d.stage === "pick");
      w.in(d.a, [{ t: "rps", g: "r" }]);
      w.in(d.b, [{ t: "rps", g: "r" }]);
      w.until(() => d.stage === "show");
    }
    expect(d.history.at(-1)?.bySpeed).toBe(true);
    expect(d.wins[0] + d.wins[1]).toBe(1);
    expect(w.cmd("rerun").ok).toBe(true);
    expect(d.ties).toBe(2);
    expect(d.wins).toEqual([0, 0]);
  });

  it("сквозная игра 50 ботов: «сыграна до конца», места — 1, 2, 3, 3 и дальше по вылету, очки (N − место + 1) × 10 (L28)", () => {
    const w = new World(50, {}, "full50");
    w.cmd("start");
    playToPodium(w);
    expect(w.s.phase).toBe("podium");
    expect(w.s.playedTrials.filter(Boolean).length).toBeGreaterThanOrEqual(PLAYED_TRIALS_MIN);
    expect(playedToEnd(w.s)).toBe(true);
    const st = standings(w.s);
    expect(st.length).toBe(50);
    expect(st.map((x) => x.place).slice(0, 4)).toEqual([1, 2, 3, 3]);
    expect(st[0]?.points).toBe(500);
    expect(st[2]?.points).toBe(st[3]?.points);
    for (let i = 1; i < st.length; i += 1) expect((st[i]?.points ?? 0) <= (st[i - 1]?.points ?? 0)).toBe(true);
    expect(st.at(-1)?.points).toBe(10);
    // Выбыл позже — выше.
    const outSeq = (pid: string) => w.s.members[pid]?.outSeq ?? 0;
    const rest = st.slice(4);
    for (let i = 1; i < rest.length; i += 1) expect(outSeq(rest[i - 1]?.pid ?? "") > outSeq(rest[i]?.pid ?? "")).toBe(true);
    // Копилка — за каждый вылет.
    expect(w.s.piggy).toBeGreaterThanOrEqual(46);
  }, 60_000);

  it("в игре осталось ≤ F — «К финалу»; убрали всех, кроме одного, — сразу чемпион; никого — без чемпиона", () => {
    const one = new World(8, { style: "night" }, "one");
    one.cmd("start");
    while (inGame(one.s).length > 1) one.cmd("remove", { pid: inGame(one.s).at(-1)?.pid });
    one.until(() => one.s.trial?.stage === "results" || one.host().can["to-final"] === true);
    one.cmd("to-final");
    expect(one.s.final?.stage).toBe("champion");
    expect(one.s.final?.champion).toBe("p0");
    const none = new World(8, { style: "night" }, "none");
    none.cmd("start");
    while (inGame(none.s).length > 0) none.cmd("remove", { pid: inGame(none.s).at(-1)?.pid });
    expect(none.cmd("to-final")).toEqual({ ok: false, error: "wrong-phase" });
    none.until(() => none.s.trial?.stage === "rules");
    expect(none.cmd("to-final").ok).toBe(true);
    expect(none.s.final?.stage).toBe("champion");
    expect(none.s.final?.champion).toBeNull();
  });
});

describe("баллы ведущему", () => {
  it("раунд для room_play: испытание — его номер, финал — свой; итоги и лобби — нет", () => {
    const w = new World(10, {}, "unit");
    expect(playUnit(w.s)).toBeNull();
    w.cmd("start");
    expect(playUnit(w.s)).toBe(0);
    toResults(w);
    expect(playUnit(w.s)).toBeNull();
    w.cmd("next");
    expect(playUnit(w.s)).toBe(1);
    w.s.phase = "final";
    w.s.final = { stage: "duel" } as MatState["final"];
    expect(playUnit(w.s)).toBe(UNIT_FINAL);
  });

  it("мусор, ввод не в свой шаг и чужие команды — не игра", () => {
    const w = new World(10, {}, "junk");
    w.cmd("start");
    expect(w.in("p0", [{ t: "zzz" }])).toBe(false);
    expect(w.in("p0", [{ t: "h", on: true }])).toBe(false);
    expect(w.in("nobody", [{ t: "h", on: true }])).toBe(false);
    w.until(() => w.s.trial?.stage === "play");
    expect(w.in("p0", [{ t: "h", on: true }])).toBe(true);
    expect(w.in("p0", [{ t: "box", n: 1 }])).toBe(false);
  });
});

describe("пауза и восстановление", () => {
  it("снимок посреди «Замри!» → восстановление: испытание снова с отсчёта, сердечки как до него, прогнозы остаются", () => {
    const w = new World(12, { style: "night" }, "restore");
    w.cmd("start");
    w.addPlayer("fan1", "Болельщик");
    w.in("fan1", [{ t: "guess", n: 4 }]);
    w.until(() => w.s.trial?.stage === "play");
    w.step(20_000, true);
    const data = JSON.parse(JSON.stringify(snapshot(w.s)));
    const s = restore(data);
    if (!s) throw new Error("не восстановилось");
    expect(s.trial?.stage).toBe("countdown");
    expect(s.trial?.guesses.fan1).toBe(4);
    expect(s.attempt).toBe(w.s.attempt + 1);
    expect(s.members.p0?.hearts).toBe(1);
    expect(s.members.fan1?.role).toBe("fan");
    // Не тот формат — null (комната начнётся заново).
    expect(restore({ v: 2 })).toBeNull();
    expect(restore(null)).toBeNull();
    expect(restore({ ...data, members: null })).toBeNull();
  });

  it("снимок на итогах — как был; вопрос «Второго шанса» — снова дверца; раунд дуэли — снова выбор", () => {
    const w = new World(12, { style: "night" }, "restore2");
    w.cmd("start");
    toResults(w);
    const s = restore(JSON.parse(JSON.stringify(snapshot(w.s))));
    expect(s?.trial?.stage).toBe("results");
    expect(s?.trial?.outcome?.out).toEqual(w.s.trial?.outcome?.out);
    const c = JSON.parse(JSON.stringify(snapshot(w.s)));
    c.phase = "chance";
    c.chance = { stage: "question", stageAt: 0, stageEnds: 10_000, question: 0, eligible: [], count: 0, answers: { p1: { i: 0, rt: 500 } }, returned: [] };
    const sc = restore(c);
    expect(sc?.chance?.stage).toBe("offer");
    expect(sc?.chance?.answers).toEqual({});
  });
});

describe("виды: экран без тайн, телефон только своё", () => {
  for (const board of [false, true])
  it(`на экране нет крепкого льда, фигур до раскрытия, жестов до показа; телефон не видит чужих pid; ≤ 3 900 байт UTF-8 на 100 игроков с длинными русскими именами и эмодзи, табло ${board ? "включено на всех испытаниях" : "выключено"}`, () => {
    const w = new World(100, { style: "night", secondChance: 20 }, `views-${board}`);
    // 30 букв кириллицы — по 2 байта, и эмодзи-семья (25 байт): сводка считается в байтах, а не в знаках (аудит 3a, второе ревью).
    for (const p of w.players) p.name = `👨‍👩‍👧‍👦 ${`Щ${p.pid}`.padEnd(30, "Ж")}`;
    for (const p of w.players) {
      const m = w.s.members[p.pid];
      if (m) m.name = p.name;
    }
    w.cmd("start");
    let maxScreen = 0;
    let screens = 0;
    const boardOn = new Set<string>();
    for (let i = 0; i < 40 * 60 * 10 && w.s.phase !== "podium"; i += 1) {
      if (board && !w.s.board) expect(w.cmd("board").ok).toBe(true);
      w.step(100, true);
      const view = w.screen();
      maxScreen = Math.max(maxScreen, screenBytes(view));
      if (view.scoreboard) boardOn.add(w.s.phase === "trial" ? (w.s.trial?.kind ?? "trial") : w.s.phase);
      if (i % 5 === 0) {
        const scr = JSON.stringify(view);
        screens += 1;
        const tr = w.s.trial;
        if (tr?.play?.kind === "hopscotch") {
          const r = tr.play.rows[tr.play.row];
          if (r && r.fell === null) expect(scr.includes('"solid"') && !scr.includes('"solid":null')).toBe(false);
        }
        if (tr?.play?.kind === "ginger" && (w.s.lastTick ?? 0) < tr.play.pickEnds) for (const b of tr.play.boxes) expect(scr.includes(`"${b}"`)).toBe(false);
        // Телефон: только своё (чужих pid нет).
        const me = JSON.stringify(w.me("p3"));
        expect(/"p(?!3")\d+"/.test(me)).toBe(false);
      }
      const c = w.host().can;
      if (c.chance) w.cmd("chance");
      else if (c.next) w.cmd("next");
      else if (c.duel) w.cmd("duel");
      else if (c.podium) w.cmd("podium");
    }
    expect(screens).toBeGreaterThan(100);
    expect(maxScreen).toBeLessThanOrEqual(4096);
    expect(maxScreen).toBeLessThanOrEqual(SCREEN_BYTES_MAX);
    if (board) for (const kind of ["freeze", "ginger", "chairs", "rope", "hopscotch", "final"]) expect(boardOn.has(kind), kind).toBe(true);
  }, 120_000);

  it("сводка экрана не выходит за предел и в худшем случае: имена укорачиваются, потом номера без имён", () => {
    const w = new World(100, { style: "night" }, "views-worst");
    w.cmd("start");
    const v = w.screen();
    // 100 имён по 24 буквы кириллицы (~5,5 КБ) — больше предела.
    for (let i = 1; i <= 100; i += 1) v.names[i] = "Ж".repeat(24);
    expect(screenBytes(v)).toBeGreaterThan(SCREEN_BYTES_MAX);
    const fit = fitScreen(v);
    expect(screenBytes(fit)).toBeLessThanOrEqual(SCREEN_BYTES_MAX);
    for (const name of Object.values(fit.names)) expect([...name].length).toBeLessThan(24);
    expect(fit.inGame).toBe(100);
  });
});

describe("правки по аудиту 3a (14 ноября 2026)", () => {
  it("«Вернуть» на правиле переживает перезапуск сервера; «Назад» к раскрытию этого испытания его снимает", () => {
    const w = new World(12, { style: "night" }, "a3-return");
    w.cmd("start");
    toResults(w);
    const out = w.s.trial?.outcome?.out[0] ?? "";
    expect(out).not.toBe("");
    w.cmd("next");
    w.until(() => w.s.trial?.stage === "rules");
    expect(w.cmd("return", { pid: out }).ok).toBe(true);
    expect(w.s.trialReturns).toEqual([out]);
    w.until(() => w.s.trial?.stage === "play");
    expect(w.s.trial?.participants).toContain(out);
    // Перезапуск посреди испытания: откат к началу испытания, но вернувшийся — снова в игре (1 сердечко).
    const s2 = restore(JSON.parse(JSON.stringify(snapshot(w.s))));
    expect(s2?.trial?.stage).toBe("countdown");
    expect(s2?.members[out]?.role).toBe("player");
    expect(s2?.members[out]?.hearts).toBe(1);
    expect(s2?.trialReturns).toEqual([out]);
    // «Назад» с итогов — к раскрытию, до «Вернуть»: он снова болельщик.
    toResults(w);
    expect(w.cmd("back").ok).toBe(true);
    expect(w.s.trial?.stage).toBe("open");
    expect(w.s.members[out]?.role).toBe("fan");
    expect(w.s.trialReturns).toEqual([]);
    // Вернули, потом убрали — перезапуск его не возвращает.
    w.until(() => w.s.trial?.stage === "rules");
    w.cmd("return", { pid: out });
    w.cmd("remove", { pid: out });
    w.until(() => w.s.trial?.stage === "play");
    const s3 = restore(JSON.parse(JSON.stringify(snapshot(w.s))));
    expect(s3?.members[out]?.role).toBe("fan");
    expect(s3?.members[out]?.removed).toBe(true);
  });

  it("«К финалу» с правила, через 30 с «Назад» с сетки — правило с полным отсчётом, испытание идёт с отсчёта, а не по жребию", () => {
    const w = new World(12, { style: "night", finalists: 4 }, "a3-tofinal");
    w.cmd("start");
    w.until(() => w.s.trial?.stage === "rules");
    while (inGame(w.s).length > 4) w.cmd("remove", { pid: inGame(w.s).at(-1)?.pid });
    expect(w.cmd("to-final").ok).toBe(true);
    expect(w.s.phase).toBe("final");
    w.step(30_000);
    expect(w.cmd("back").ok).toBe(true);
    expect(w.s.phase).toBe("trial");
    expect(w.s.trial?.stage).toBe("rules");
    const left = (w.s.trial?.stageEnds ?? 0) - (w.now - w.s.offset);
    expect(left).toBe(10_000);
    w.step(200);
    expect(w.s.trial?.stage).toBe("rules");
    w.until(() => w.s.trial?.stage === "countdown");
    w.step(200);
    expect(w.s.trial?.stage).toBe("countdown");
  });

  it("каждая команда, после которой этап не сменился, меняет `moment`: второе касание «+10 секунд» и «Табло» со старым этапом — не то же", () => {
    const w = new World(8, { style: "night" }, "a3-rev");
    w.cmd("start");
    w.until(() => w.s.trial?.stage === "play");
    const m0 = moment(w.s);
    expect(w.cmd("more-time").ok).toBe(true);
    const m1 = moment(w.s);
    expect(m1).not.toBe(m0);
    expect(m1.endsWith("#1")).toBe(true);
    expect(w.cmd("board").ok).toBe(true);
    expect(moment(w.s)).not.toBe(m1);
    // Отказ этап не трогает.
    const m2 = moment(w.s);
    expect(w.cmd("duel").ok).toBe(false);
    expect(moment(w.s)).toBe(m2);
  });

  it("ушёл из лобби до «Начать» и вернулся после — болельщик (прогнозы), а не «лобби»", () => {
    const w = new World(8, { style: "night" }, "a3-lobby");
    const gone = w.players.pop();
    if (!gone) throw new Error("нет игрока");
    w.step(100);
    expect(w.s.members[gone.pid]?.gone).toBe(true);
    expect(w.cmd("start").ok).toBe(true);
    expect(w.s.members[gone.pid]?.role).toBe("lobby");
    w.addPlayer(gone.pid, gone.name);
    const m = w.s.members[gone.pid];
    expect(m?.role).toBe("fan");
    expect(m?.late).toBe(true);
    expect(m?.gone).toBe(false);
    w.until(() => w.s.trial?.stage === "rules");
    expect(w.in(gone.pid, [{ t: "guess", n: 2 }])).toBe(true);
    expect(w.me(gone.pid)?.role).toBe("fan");
    // «Назад» его болельщиком и оставляет.
    toResults(w);
    w.cmd("back");
    expect(w.s.members[gone.pid]?.role).toBe("fan");
  });

  it("перезапуск во время ставок перед дуэлью — снова ставки с полным временем, сделанные ставки на месте", () => {
    const w = new World(30, { style: "night" }, "a3-bets");
    w.cmd("start");
    w.until(() => w.s.trial?.stage === "rules");
    while (inGame(w.s).length > 4) w.cmd("remove", { pid: inGame(w.s).at(-1)?.pid });
    w.cmd("to-final");
    expect(w.cmd("duel").ok).toBe(true);
    const fan = Object.values(w.s.members).find((m) => m.role === "fan")?.pid ?? "";
    expect(w.in(fan, [{ t: "bet", side: 1 }])).toBe(true);
    w.step(2000);
    const data = JSON.parse(JSON.stringify(snapshot(w.s)));
    const s2 = restore(data);
    const d = s2?.final?.duel;
    expect(d?.stage).toBe("bets");
    expect(d?.bets[fan]).toBe(w.s.final?.duel?.b);
    expect((d?.stageEnds ?? 0) - (d?.stageAt ?? 0)).toBe(5000);
    expect(s2?.attempt).toBe(w.s.attempt + 1);
  });

  it("пульт: список «Вернуть» — те же, кого принимает команда (выбывшие игрой и убранные)", () => {
    const w = new World(12, { style: "night" }, "a3-returnable");
    w.cmd("start");
    w.until(() => w.s.trial?.stage === "rules");
    const victim = inGame(w.s).at(-1)?.pid ?? "";
    w.cmd("remove", { pid: victim });
    toResults(w);
    const list = w.host().returnable as string[];
    expect(list).toContain(victim);
    for (const pid of w.s.trial?.outcome?.out ?? []) expect(list).toContain(pid);
    for (const pid of list) {
      const copy = restore(JSON.parse(JSON.stringify(snapshot(w.s))));
      if (!copy) throw new Error("не восстановилось");
      expect(Object.values(copy.members).find((m) => m.pid === pid)?.role).toBe("fan");
    }
    for (const pid of list) expect(w.cmd("return", { pid }).ok).toBe(true);
    expect(w.host().returnable).toEqual([]);
  });

  it("реакция телефона сходится с часами сервера: «Стулья» за 0,25 с до появления с 150 мс — нет; честное касание и на медленной сети — да", () => {
    const w = new World(12, { style: "night", trials: [{ kind: "freeze" }, { kind: "chairs" }, { kind: "ginger", on: false }, { kind: "rope", on: false }, { kind: "hopscotch", on: false }] }, "a3-sit");
    w.cmd("start");
    toResults(w);
    w.cmd("next");
    w.until(() => w.s.trial?.kind === "chairs" && w.s.trial.stage === "play");
    const p = w.s.trial?.play;
    if (p?.kind !== "chairs") throw new Error("не стулья");
    const r = p.rounds[0];
    if (!r) throw new Error("нет захода");
    const appear = r.appearAt + w.s.offset;
    const [early, honest, slow, stampedSlow] = r.players;
    w.until(() => w.now >= appear - 250);
    w.now = appear - 250;
    expect(w.in(early ?? "", [{ t: "sit", rt: 150 }])).toBe(false);
    // Честный: коснулся через 0,6 с, запрос сразу дошёл.
    w.now = appear + 600;
    expect(w.in(honest ?? "", [{ t: "sit", rt: 600 }])).toBe(true);
    // Честный без отметки: коснулся через 0,5 с, запрос шёл 0,9 с — время события включает дорогу, всё равно принят.
    w.now = appear + 1400;
    expect(w.in(slow ?? "", [{ t: "sit", rt: 500 }])).toBe(true);
    // С отметкой времени: коснулся через 0,7 с (st), пришло через 1,5 с — принят; та же отметка с 150 мс — нет.
    w.now = appear + 1500;
    const st = (ms: number, rt: number) => input(w.s, stampedSlow ?? "", [{ t: "sit", rt, at: appear + ms, late: false, delayed: false, stamped: true }], w);
    expect(st(700, 150)).toBe(false);
    expect(st(700, 700)).toBe(true);
  });

  it("«Второй шанс»: ответ на 9,5 с с реакцией 300 мс и ответ через 1,4 с после конца — не приняты; честный медленный — принят", () => {
    const w = new World(40, { style: "night", secondChance: 20 }, "a3-chance");
    w.cmd("start");
    for (let i = 0; i < 3; i += 1) {
      toResults(w);
      if (i < 2) w.cmd("next");
    }
    w.cmd("chance");
    w.until(() => w.s.chance?.stage === "question");
    const c = w.s.chance;
    if (!c) throw new Error("нет второго шанса");
    const q = questionsOf(w.s.content)[c.question];
    const shown = c.stageAt + w.s.offset;
    const ends = (c.stageEnds ?? 0) + w.s.offset;
    const [cheat, honest, late, tooLate] = c.eligible;
    w.now = shown + 9500;
    expect(w.in(cheat ?? "", [{ t: "ans", i: q?.correct ?? 0, rt: 300 }])).toBe(false);
    expect(w.in(honest ?? "", [{ t: "ans", i: q?.correct ?? 0, rt: 9500 }])).toBe(true);
    // Пришёл через 1,4 с после конца, «заявлено» на конце (ago 1400) — поздно.
    w.now = ends + 1400;
    expect(w.in(late ?? "", [{ t: "ans", i: q?.correct ?? 0, rt: 300 }], { ago: 1400 })).toBe(false);
    expect(w.in(late ?? "", [{ t: "ans", i: q?.correct ?? 0, rt: 9950 }], { ago: 1400 })).toBe(false);
    // Пришёл через 0,8 с после конца, ответ — за 0,1 с до конца с честной реакцией: принят (запас 1 с).
    w.now = ends + 800;
    expect(w.in(tooLate ?? "", [{ t: "ans", i: q?.correct ?? 0, rt: 9900 }], { ago: 900 })).toBe(true);
  });

  it("«Прыгаю первым!»: реакция должна сходиться со временем нажатия", () => {
    const w = new World(12, { style: "night", trials: [{ kind: "freeze" }, { kind: "hopscotch" }, { kind: "ginger", on: false }, { kind: "chairs", on: false }, { kind: "rope", on: false }] }, "a3-brave");
    w.cmd("start");
    toResults(w);
    w.cmd("next");
    w.until(() => w.s.trial?.kind === "hopscotch" && w.s.trial.stage === "play");
    const p = w.s.trial?.play;
    if (p?.kind !== "hopscotch") throw new Error("не классики");
    const r = p.rows[0];
    if (!r) throw new Error("нет ряда");
    const at = r.braveAt + w.s.offset;
    const [a, b] = r.jumpers;
    w.now = at + 2000;
    expect(w.in(a ?? "", [{ t: "brave", rt: 160 }])).toBe(false);
    expect(w.in(b ?? "", [{ t: "brave", rt: 2000 }])).toBe(true);
  });

  it("экран: новая фраза «Замри!» — с её первого мгновения (не через 0,5 с); конец рассадки «Стульев» — не раньше остановки", () => {
    const w = new World(8, { style: "night", trials: [{ kind: "freeze" }, { kind: "chairs" }, { kind: "ginger", on: false }, { kind: "rope", on: false }, { kind: "hopscotch", on: false }] }, "a3-screen");
    w.cmd("start");
    w.until(() => w.s.trial?.stage === "play");
    const p = w.s.trial?.play;
    if (p?.kind !== "freeze") throw new Error("не «Замри!»");
    const g = p.gazes[2];
    if (!g) throw new Error("нет фраз");
    w.until(() => w.now - w.s.offset >= g.ph);
    const phrase = ((w.screen().trial as { play: { phrase: { start: number } | null } }).play.phrase);
    expect(phrase?.start).toBe(g.ph + w.s.offset);
    // Будущей фразы на экране нет: за 0,1 с до конца взгляда — всё ещё эта фраза.
    w.until(() => w.now - w.s.offset >= g.e - 100);
    expect(((w.screen().trial as { play: { phrase: { start: number } | null } }).play.phrase)?.start).toBe(g.ph + w.s.offset);
    toResults(w);
    w.cmd("next");
    w.until(() => w.s.trial?.kind === "chairs" && w.s.trial.stage === "play");
    const c = w.s.trial?.play;
    if (c?.kind !== "chairs") throw new Error("не стулья");
    const r = c.rounds[0];
    if (!r) throw new Error("нет захода");
    const seatEnds = () => (w.screen().trial as { play: { seatEnds: number | null } }).play.seatEnds;
    expect(seatEnds()).toBeNull();
    w.until(() => w.now - w.s.offset >= r.stopAt - 100);
    expect(seatEnds()).toBeNull();
    w.until(() => w.now - w.s.offset >= r.stopAt);
    expect(seatEnds()).toBe(r.seatEnds + w.s.offset);
  });

  it("«Второй шанс» — после 3-го **сыгранного** испытания: пропущенное не в счёт", () => {
    const w = new World(40, { style: "night", secondChance: 10 }, "a3-chance3");
    w.cmd("start");
    toResults(w);
    w.cmd("next");
    w.until(() => w.s.trial?.stage === "rules");
    expect(w.cmd("skip-trial").ok).toBe(true);
    toResults(w);
    // Сыграно 2 (третье по плану) — рано.
    expect(w.s.trial?.index).toBe(2);
    expect(w.host().can.chance).toBe(false);
    w.cmd("next");
    toResults(w);
    expect(w.s.trial?.index).toBe(3);
    expect(w.s.playedTrials.filter(Boolean).length).toBe(3);
    expect(w.host().can.chance).toBe(true);
  });
});
