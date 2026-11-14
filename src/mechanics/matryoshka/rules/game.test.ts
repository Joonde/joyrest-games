// Ход игры «Игр Матрёшки» (docs/matryoshka.md): номера по входу, каждая команда пульта вперёд и назад, отказ не в свой шаг,
// «Второй шанс», «Добивка», финал, «Назад», «Вернуть» и «Убрать», пауза, снимок → восстановление, виды без тайн, баллы.
import { describe, expect, it } from "vitest";
import { MIN_PLAYERS, PLAYED_TRIALS_MIN, UNIT_FINAL } from "./constants";
import { questionsOf, TRIAL_KINDS } from "./content";
import { moment, playedToEnd, playUnit, restore, snapshot } from "./game";
import { inGame, standings } from "./members";
import type { MatState } from "./types";
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
    expect(w.screen().scoreboard?.length).toBe(8);
    expect(w.cmd("board").ok).toBe(true);
    expect(w.screen().scoreboard).toBeUndefined();
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
    // Двое отвечают верно (медленный и быстрый), остальные — неверно.
    const [slow, fast, ...rest] = c.eligible;
    w.in(slow ?? "", [{ t: "ans", i: q?.correct ?? 0, rt: 3000 }]);
    w.in(fast ?? "", [{ t: "ans", i: q?.correct ?? 0, rt: 900 }]);
    for (const pid of rest.slice(0, 10)) w.in(pid, [{ t: "ans", i: ((q?.correct ?? 0) + 1) % 4, rt: 500 }]);
    // Реакция < 300 мс — не принимается; второй ответ — тоже.
    expect(w.in(rest[11] ?? "", [{ t: "ans", i: 0, rt: 200 }])).toBe(false);
    expect(w.in(fast ?? "", [{ t: "ans", i: 0, rt: 900 }])).toBe(false);
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
    w.cmd("next");
    if (alive > w.s.F) {
      expect(w.s.phase).toBe("dobivka");
      // Сердечки в «Добивке» не спасают: выбор — только у неупавших.
      w.until(() => w.s.dobivka?.stage === "results", 200_000, true);
      expect(inGame(w.s).length).toBe(w.s.F);
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
    const fan = Object.values(w.s.members).find((m) => m.role === "fan")?.pid ?? "";
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
    expect(w.s.bestFan).not.toBeNull();
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
  it("на экране нет крепкого льда, фигур до раскрытия, жестов до показа; телефон не видит чужих pid; ≤ 4 КБ на 100 игроков", () => {
    const w = new World(100, { style: "night" }, "views");
    for (const p of w.players) p.name = `Очень-очень длинное имя гостя ${p.pid}`;
    for (const p of w.players) {
      const m = w.s.members[p.pid];
      if (m) m.name = p.name;
    }
    w.cmd("start");
    let maxScreen = 0;
    let screens = 0;
    for (let i = 0; i < 40 * 60 * 10 && w.s.phase !== "podium"; i += 1) {
      w.step(100, true);
      if (i % 5 === 0) {
        const scr = JSON.stringify(w.screen());
        maxScreen = Math.max(maxScreen, new TextEncoder().encode(scr).length);
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
  }, 120_000);
});
