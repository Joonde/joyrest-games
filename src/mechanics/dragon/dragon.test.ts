import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import { createDragon, parseDragonList, parseStats, type DragonContent } from "./content";
import { DEMO_DRAGON, DEMO_DRAGON_KIDS } from "./demo";
import { closeHeroes, damageOf, dragonBack, dragonPrimary, nextBattle, nextTask, parseDragonResult, revealTask, showTask, startDragon, toggleMark } from "./logic";
import { validateDragon } from "./validate";

const teams: Participant[] = ["A", "B"].map((id, i) => ({ id, name: `Команда ${id}`, kind: "team", teamId: null, captainUid: `u${id}`, joinedAt: i }));
const session = (): Session => ({ id: "s", code: "1", hostId: "h", gameId: "g", gameTitle: "", mechanic: "dragon", gameSnapshot: null, themeId: "joyrest", playMode: "teams", screenMode: "laptop", state: { ...startState(), stage: "ready" }, leaderboard: {}, createdAt: 0 });
let t = 1_000_000;
const apply = (s: Session, c: SessionChange | null) => applyChange(s, c ?? {}, (t += 1000));
const ans = (s: Session, pid: string, value: unknown, late = 10): Answer => ({ id: `${s.state.step}_${pid}`, step: s.state.step, pid, uid: `u${pid}`, value, submittedAt: (s.state.startedAt ?? 0) + late });

function content(): DragonContent {
  const c = createDragon();
  c.battles = parseDragonList("# Бой: Дракон 500\nУм: 2+2?\n- 3\n* 4\n- 5\n- 6\nСила: Присесть 10 раз (100)\nУм: 3+3?\n- 5\n* 6\n- 7\n- 8\n# Бой: Второй 300\nУм: 1+1?\n- 1\n* 2\n- 3\n- 4");
  return c;
}

function heroes(c = content(), a: unknown = { hero: "sorceress", stats: { mind: 3, str: 2 } }, b: unknown = { hero: "dwarf", stats: { str: 3, luck: 2 } }) {
  let s = session();
  expect(dragonPrimary(s, c)).toBe("start");
  s = apply(s, startDragon(s, teams));
  expect(dragonPrimary(s, c)).toBe("heroesDone");
  s = apply(s, closeHeroes(s, c, [ans(s, "A", a), ans(s, "B", b)], teams));
  return { s, c };
}

describe("Бой с драконом: содержимое и герои", () => {
  it("свойства: всего не больше 5, каждое до 3; иначе — по 1", () => {
    expect(parseStats({ mind: 3, str: 2 })).toMatchObject({ mind: 3, str: 2, agi: 0 });
    expect(parseStats({ mind: 3, str: 3 })).toEqual({ str: 1, mind: 1, agi: 1, luck: 1, cha: 1 });
    expect(parseStats({ mind: 9 }).mind).toBe(3);
  });

  it("список: бои со здоровьем, свойство задания задаёт вид", () => {
    const b = content().battles;
    expect(b.map((x) => [x.name, x.hp])).toEqual([["Дракон", 500], ["Второй", 300]]);
    expect(b[0]?.tasks.map((x) => [x.kind, x.stat])).toEqual([["choice", "mind"], ["task", "str"], ["choice", "mind"]]);
  });

  it("шаблоны «Классика» и «Для детей» проходят проверку", () => {
    expect(validateDragon(DEMO_DRAGON)).toEqual([]);
    expect(validateDragon(DEMO_DRAGON_KIDS)).toEqual([]);
    expect(DEMO_DRAGON.battles).toHaveLength(2);
  });

  it("урон: база × (1 + свойство), силы героев", () => {
    const task = { id: "t", kind: "choice" as const, stat: "mind" as const, text: "", options: [], correct: 0, power: 100, seconds: 0 };
    const stats = { str: 0, mind: 2, agi: 0, luck: 0, cha: 0 };
    expect(damageOf(task, { hero: "knight", stats }, true, null, false)).toBe(300);
    expect(damageOf(task, { hero: "sorceress", stats }, true, null, false)).toBe(450);
    expect(damageOf(task, { hero: "archer", stats }, true, null, false)).toBe(320);
    expect(damageOf(task, { hero: "knight", stats }, false, null, false)).toBe(0);
    expect(damageOf({ ...task, stat: "agi" }, { hero: "elfess", stats }, true, null, true)).toBe(200);
  });

  it("не выбрал героя — герой по порядку, свойства по 1; гном — +2 жизни", () => {
    const { s } = heroes(content(), null, { hero: "dwarf" });
    const r = parseDragonResult(s.state.result);
    expect(r.heroes.A?.hero).toBe("elfess");
    expect(r.heroes.A?.stats.mind).toBe(1);
    expect(r.lives).toEqual({ A: 3, B: 5 });
    expect(r.hp).toBe(500);
  });
});

describe("Бой с драконом: бой", () => {
  it("верно — урон дракону и очки; неверно — минус жизнь; «Назад» возвращает всё", () => {
    let { s, c } = heroes();
    s = apply(s, showTask(s, c, teams));
    s = apply(s, revealTask(s, c, [ans(s, "A", { choice: 1 }), ans(s, "B", { choice: 0 })], teams));
    let r = parseDragonResult(s.state.result);
    // Волшебница, Ум 3: 100 × 4 × 1,5 = 600 — дракон повержен (500).
    expect(r.last.A?.damage).toBe(600);
    expect(r.phase).toBe("victory");
    expect(r.killer).toBe("A");
    expect(s.leaderboard.A?.score).toBe(600 + c.killBonus + c.winBonus);
    expect(r.lives.B).toBe(4);
    expect(s.leaderboard.B?.score).toBe(c.winBonus);
    s = apply(s, dragonBack(s, teams)?.change ?? null);
    r = parseDragonResult(s.state.result);
    expect(r.hp).toBe(500);
    expect(r.lives.B).toBe(5);
    expect(s.leaderboard.A?.score).toBe(0);
  });

  it("жизни кончились — очки боя сгорают; дракон дожил — все теряют очки боя; новый бой — все живы", () => {
    const c = content();
    c.battles[0]!.hp = 100_000;
    c.lives = 1;
    let { s } = heroes(c, { hero: "knight", stats: { mind: 1 } }, { hero: "bard", stats: { mind: 1 } });
    s = apply(s, showTask(s, c, teams));
    s = apply(s, revealTask(s, c, [ans(s, "A", { choice: 1 }), ans(s, "B", { choice: 1 })], teams));
    expect(s.leaderboard.A?.score).toBe(200);
    s = apply(s, nextTask(s, c, teams));
    // Задание: ведущий засчитал только A. B — бард, ударили, жизнь одна — погиб, очки боя (200) сгорают.
    s = apply(s, showTask(s, c, teams));
    s = apply(s, toggleMark(s, "A"));
    s = apply(s, revealTask(s, c, [], teams));
    let r = parseDragonResult(s.state.result);
    expect(r.dead).toEqual(["B"]);
    expect(s.leaderboard.B?.score).toBe(0);
    s = apply(s, nextTask(s, c, teams));
    s = apply(s, showTask(s, c, teams));
    // Рыцарь A ошибается — щит спасает первый удар.
    s = apply(s, revealTask(s, c, [ans(s, "A", { choice: 0 }), ans(s, "B", { choice: 1 })], teams));
    r = parseDragonResult(s.state.result);
    expect(r.last.A?.saved).toBe("shield");
    expect(r.last.B).toBeUndefined();
    // Задания кончились — дракон побеждает, A теряет очки боя.
    s = apply(s, nextTask(s, c, teams));
    r = parseDragonResult(s.state.result);
    expect(r.phase).toBe("defeat");
    expect(s.leaderboard.A?.score).toBe(0);
    expect(dragonPrimary(s, c)).toBe("nextBattle");
    s = apply(s, nextBattle(s, c, teams));
    r = parseDragonResult(s.state.result);
    expect(r.battle).toBe(1);
    expect(r.dead).toEqual([]);
    expect(r.lives).toEqual({ A: 1, B: 1 });
    expect(r.hp).toBe(300);
  });

  it("кубик: число из ответа сервера, вор +1; без броска — бросает ведущий", () => {
    const c = content();
    c.battles[0]!.tasks = [{ id: "d", kind: "dice", stat: "luck", text: "", options: ["", "", "", ""], correct: 0, power: 70, seconds: 0 }];
    c.battles[0]!.hp = 100_000;
    let { s } = heroes(c, { hero: "thief", stats: { luck: 1 } }, { hero: "knight", stats: { luck: 1 } });
    s = apply(s, showTask(s, c, teams));
    s = apply(s, revealTask(s, c, [ans(s, "A", { roll: true })], teams, { A: 1, B: 6 }));
    const r = parseDragonResult(s.state.result);
    expect(r.last.A?.roll).toBeGreaterThanOrEqual(2);
    expect(r.last.B?.roll).toBe(6);
    // 70 × 6/3,5 × 2 = 240.
    expect(r.last.B?.damage).toBe(240);
  });

  it("последний бой — конец игры и награждение", () => {
    let { s, c } = heroes();
    s = apply(s, showTask(s, c, teams));
    s = apply(s, revealTask(s, c, [ans(s, "A", { choice: 1 })], teams));
    s = apply(s, nextBattle(s, c, teams));
    s = apply(s, showTask(s, c, teams));
    s = apply(s, revealTask(s, c, [ans(s, "A", { choice: 1 })], teams));
    s = apply(s, nextBattle(s, c, teams));
    expect(parseDragonResult(s.state.result).phase).toBe("over");
    expect(dragonPrimary(s)).toBe("podium");
    expect(dragonPrimary(s, c)).toBe("podium");
  });
});

describe("Бой с драконом: «Назад» после поражения и бросок за команду", () => {
  it("с поражения — к удару, и ещё раз назад — удар отменён; бросок без телефона один и тот же", () => {
    const c = content();
    c.battles[0]!.hp = 100_000;
    c.battles[0]!.tasks = [{ id: "d", kind: "dice", stat: "luck", text: "", options: ["", "", "", ""], correct: 0, power: 100, seconds: 0 }];
    let { s } = heroes(c, { hero: "knight", stats: { luck: 1 } }, { hero: "knight", stats: { luck: 1 } });
    s = apply(s, showTask(s, c, teams));
    const first = revealTask(s, c, [], teams);
    const again = revealTask(s, c, [], teams);
    expect(first?.state?.result).toEqual(again?.state?.result);
    s = apply(s, first);
    const scored = s.leaderboard.A?.score ?? 0;
    expect(scored).toBeGreaterThan(0);
    s = apply(s, nextTask(s, c, teams));
    expect(parseDragonResult(s.state.result).phase).toBe("defeat");
    expect(s.leaderboard.A?.score).toBe(0);
    s = apply(s, dragonBack(s, teams)?.change ?? null);
    expect(parseDragonResult(s.state.result).phase).toBe("reveal");
    expect(s.leaderboard.A?.score).toBe(scored);
    s = apply(s, dragonBack(s, teams)?.change ?? null);
    expect(parseDragonResult(s.state.result).phase).toBe("task");
    expect(s.leaderboard.A?.score).toBe(0);
    expect(parseDragonResult(s.state.result).hp).toBe(100_000);
  });
});
