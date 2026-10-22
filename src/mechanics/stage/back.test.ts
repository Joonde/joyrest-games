// «Назад» через несколько ходов (QA 22 октября 2026): без react, запускается и в bun.
import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Participant, Session, SessionChange } from "../../data/types";
import { parseStage } from "./content";
import { finishPerform, nextTurn, parseStageResult, pickTile, stageBack, startGame, turnPid } from "./logic";

const content = parseStage({
  variant: "dance",
  categories: [{ id: "c1", title: "Активные" }],
  tiles: [
    { id: "t1", cat: "c1", points: 300, kind: "perform", who: "m2" },
    { id: "t2", cat: "c1", points: 400, kind: "battle", vs: "m-w" },
  ],
  gift: 50,
  voteTime: 20,
  battleLock: false,
});
const teams: Participant[] = ["A", "B", "C"].map((id, i) => ({ id, name: `Команда ${id}`, kind: "team", teamId: null, captainUid: `u${id}`, joinedAt: i }));
// Телефоны команд: каждый дарит и голосует своим игроком.
const phones: Participant[] = ["A", "B", "C"].flatMap((team, i) => [1, 2].map((n) => ({ id: `${team}${n}`, name: `${team}${n}`, kind: "player" as const, teamId: team, captainUid: `u${team}${n}`, joinedAt: 10 + i * 2 + n })));
const everyone = [...teams, ...phones];
const session = (): Session => ({ id: "s", code: "1", hostId: "h", gameId: "g", gameTitle: "", mechanic: "stage", gameSnapshot: null, themeId: "joyrest", playMode: "teams", screenMode: "laptop", state: startState(), leaderboard: {}, createdAt: 0 });
let t = 0;
const apply = (s: Session, c: SessionChange) => applyChange(s, c, (t += 1000));

describe("«Назад» в «Танцуй как звезда»", () => {
  it("«Назад» через несколько ходов подряд возвращает каждый итог и снимает очки, к заставке — только с чистого поля", () => {
    const three = parseStage({ ...content, tiles: [{ id: "t1", cat: "c1", points: 300, kind: "perform", who: "m2" }, { id: "t2", cat: "c1", points: 400, kind: "perform", who: "w2" }, { id: "t3", cat: "c1", points: 500, kind: "perform", who: "w1" }] });
    let s = session();
    s = apply(s, startGame(s, everyone));
    s = apply(s, pickTile(s, three, "t1", everyone));
    s = apply(s, finishPerform(s, three, [], everyone, true));
    s = apply(s, nextTurn(s, everyone));
    s = apply(s, pickTile(s, three, "t2", everyone));
    s = apply(s, finishPerform(s, three, [], everyone, true));
    s = apply(s, nextTurn(s, everyone));
    expect(parseStageResult(s.state.result).played).toEqual(["t1", "t2"]);
    expect(s.leaderboard.A?.score).toBe(300);
    expect(s.leaderboard.B?.score).toBe(400);
    const back = () => {
      const plan = stageBack(s, three);
      expect(plan).not.toBeNull();
      s = apply(s, plan?.change ?? {});
      return parseStageResult(s.state.result);
    };
    // Выбор → итог t2 → выступление t2 → выбор → итог t1.
    expect(back()).toMatchObject({ mode: "result", tile: "t2", played: ["t1"] });
    expect(back()).toMatchObject({ mode: "perform", tile: "t2" });
    expect(s.leaderboard.B?.score).toBe(0);
    let r = back();
    expect(r).toMatchObject({ mode: "pick", played: ["t1"] });
    expect(turnPid(r)).toBe("B");
    r = back();
    expect(r).toMatchObject({ mode: "result", tile: "t1", played: [] });
    expect(s.state.stage).toBe("reveal");
    expect(back()).toMatchObject({ mode: "perform", tile: "t1" });
    expect(s.leaderboard.A?.score).toBe(0);
    expect(back()).toMatchObject({ mode: "pick", played: [] });
    // Ничего не сыграно — можно к заставке.
    back();
    expect(s.state.stage).toBe("ready");
    // Сыгранная плитка без снимка (стопка потерялась) — «Назад» гаснет, а не стирает поле.
    const lost: Session = { ...s, state: { ...s.state, stage: "reveal", result: { ...parseStageResult({ played: ["t1"], order: ["A", "B"], mode: "pick" }) } } };
    expect(stageBack(lost, three)).toBeNull();
    // Старая сессия только с `prev` — стопка из одного хода.
    expect(parseStageResult({ prev: { tile: "t1", performer: "A", turn: 0, scores: { A: 300 } } }).history).toHaveLength(1);
  });

});
