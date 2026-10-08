import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Participant, Session, SessionChange } from "../../data/types";
import { newQuestCell, parseQuest, parseQuestList, resizeQuest } from "./content";
import { DEMO_QUEST, DEMO_QUEST_ADULT } from "./demo";
import { validateQuest } from "./validate";
import { applyRoll, dieOf, judge, nextTurn, parseQuestResult, questBack, questPrimary, rollChange, startQuest } from "./logic";

const teams: Participant[] = ["A", "B"].map((id, i) => ({ id, name: `Команда ${id}`, kind: "team", teamId: null, captainUid: `u${id}`, joinedAt: i }));
const session = (): Session => ({ id: "s", code: "1", hostId: "h", gameId: "g", gameTitle: "", mechanic: "quest", gameSnapshot: null, themeId: "joyrest", playMode: "teams", screenMode: "laptop", state: startState(), leaderboard: {}, createdAt: 0 });
let t = 0;
const apply = (s: Session, c: SessionChange) => applyChange(s, c, (t += 1000));

function board() {
  const content = resizeQuest(parseQuest({ cells: [] }), 40);
  content.cells = content.cells.map((c, i) => ({ ...c, kind: "task" as const, text: `Задание ${i + 1}`, points: 10 }));
  content.cells[2] = { ...newQuestCell("bonus"), move: 3 };
  content.cells[4] = newQuestCell("skip");
  return content;
}

describe("Активная настолка", () => {
  it("поле 40–100 клеток; список: вопрос, танец, бонус, ловушка, пропуск, очки", () => {
    expect(resizeQuest(parseQuest({}), 10).cells).toHaveLength(40);
    expect(resizeQuest(parseQuest({}), 500).cells).toHaveLength(100);
    const list = parseQuestList("Вопрос: Столица Франции? = Париж (30)\nТанец: Макарена\n+3\nЛовушка −2\nПропуск хода\nПусто\nСпойте припев");
    expect(list.map((c) => c.kind)).toEqual(["question", "dance", "bonus", "trap", "skip", "empty", "task"]);
    expect(list[0]).toMatchObject({ text: "Столица Франции?", answer: "Париж", points: 30 });
    expect(list[2]?.move).toBe(3);
    expect(list[3]?.move).toBe(-2);
  });

  it("кубик — из ответа сервера (1–6), не выбирается телефоном", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(dieOf({ id: `${i}_A`, submittedAt: 1000 + i * 37 }));
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("ход: бросок → клетка → «Выполнено» +очки → следующая; бонус двигает; пропуск хода; «Назад»", () => {
    const content = board();
    let s = session();
    expect(questPrimary(s)).toBe("start");
    s = apply(s, startQuest(s, teams));
    expect(parseQuestResult(s.state.result).mover).toBe("A");
    // Бросок не той команды не принимается.
    expect(rollChange(s, content, [{ id: "0_B", step: 0, pid: "B", uid: "uB", value: { roll: true }, submittedAt: 5 }], teams)).toBeNull();
    s = apply(s, applyRoll(s, content, 2, teams));
    let r = parseQuestResult(s.state.result);
    expect(r.at).toBe(2);
    expect(questPrimary(s)).toBe("judge");
    s = apply(s, judge(s, content, true));
    expect(s.leaderboard.A?.score).toBe(10);
    // «Назад» — фишка на старт, очки сняты.
    const back = questBack(s);
    s = apply(s, back?.change ?? {});
    expect(parseQuestResult(s.state.result).pos.A).toBe(0);
    expect(s.leaderboard.A?.score).toBe(0);
    // Бонус на 3-й клетке: +3 → клетка 6.
    s = apply(s, applyRoll(s, content, 3, teams));
    r = parseQuestResult(s.state.result);
    expect(r.at).toBe(6);
    s = apply(s, judge(s, content, false));
    s = apply(s, nextTurn(s));
    expect(parseQuestResult(s.state.result).mover).toBe("B");
    // B встаёт на «пропуск хода» (клетка 5).
    s = apply(s, applyRoll(s, content, 5, teams));
    expect(parseQuestResult(s.state.result).mode).toBe("done");
    s = apply(s, nextTurn(s));
    expect(parseQuestResult(s.state.result).mover).toBe("A");
    s = apply(s, applyRoll(s, content, 1, teams));
    s = apply(s, judge(s, content, true));
    s = apply(s, nextTurn(s));
    // B пропускает — снова A.
    expect(parseQuestResult(s.state.result).mover).toBe("A");
  });

  it("финиш: бонус финиша и награждение", () => {
    const content = board();
    let s = session();
    s = apply(s, startQuest(s, teams));
    const r = parseQuestResult(s.state.result);
    s = { ...s, state: { ...s.state, result: { ...r, pos: { A: 39, B: 0 } } } };
    s = apply(s, applyRoll(s, content, 6, teams));
    const done = parseQuestResult(s.state.result);
    expect(done.mode).toBe("finish");
    expect(done.winner).toBe("A");
    expect(s.leaderboard.A?.score).toBe(content.finishPoints);
    expect(questPrimary(s)).toBe("podium");
  });
});

describe("шаблоны настолки", () => {
  it("«Классика» и «18+» — по 40 клеток, готовы к запуску", () => {
    for (const demo of [DEMO_QUEST, DEMO_QUEST_ADULT]) {
      expect(demo.content.cells).toHaveLength(40);
      expect(validateQuest(demo.content)).toEqual([]);
    }
  });
});
