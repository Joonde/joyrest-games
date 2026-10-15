import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import { createStage, parseStage } from "./content";
import { DEMO_STAGE_DANCE, DEMO_STAGE_KARAOKE } from "./demo";
import { battlesLocked, battleWaiting, countVotes, hypeText, openBattles, HYPE, finishPerform, giftGivers, liveVotes, nextTurn, parseStageResult, pickTile, setBattleWinner, stageBack, stagePrimary, startGame, startVote, toggleFull, turnPid, videoCommand } from "./logic";
import { validateStage } from "./validate";
import { videoTarget } from "./video";
import { VERSUS, WHO, whoOf } from "./who";

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
const ans = (pid: string, step: number, value: unknown): Answer => ({ id: `${step}_${pid}`, step, pid, uid: pid, value, submittedAt: 1e13 });

describe("кто выходит", () => {
  it("все составы до пяти человек и батлы", () => {
    for (let n = 1; n <= 5; n++) for (const g of ["m", "w", "a"]) expect(whoOf(`${g}${n}`).figs).toHaveLength(n);
    expect(WHO.filter((w) => w.group === "mixed").every((w) => w.figs.length <= 5 && w.figs.includes("m") && w.figs.includes("w"))).toBe(true);
    expect(whoOf("m2").label).toBe("2 мужчины");
    expect(whoOf("w5").label).toBe("5 женщин");
    expect(whoOf("m1w1").label).toBe("Мужчина и женщина");
    expect(new Set(WHO.map((w) => w.id)).size).toBe(WHO.length);
    expect(VERSUS.length).toBeGreaterThanOrEqual(8);
  });
});

describe("Just Dance и Караоке на поле", () => {
  it("выступление: очки плитки, симпатия зала — дарят свои очки, команда один раз, без очков — не дарит", () => {
    let s = session();
    expect(stagePrimary(s, content)).toBe("start");
    s = apply(s, startGame(s, everyone));
    expect(turnPid(parseStageResult(s.state.result))).toBe("A");
    expect(stagePrimary(s, content)).toBe("pickTile");
    // У B уже есть очки, у C — нет.
    s = apply(s, { addScore: { B: 120 } });
    s = apply(s, pickTile(s, content, "t1", everyone));
    expect(parseStageResult(s.state.result).mode).toBe("perform");
    expect(s.state.stage).toBe("question");
    const step = s.state.step;
    const answers = [ans("B1", step, { gift: true }), ans("B2", step, { gift: true }), ans("C1", step, { gift: true }), ans("A1", step, { gift: true })];
    // Выступающие себе не дарят, команда — один раз.
    expect(giftGivers(s, answers, everyone)).toEqual(["B", "C"]);
    s = apply(s, finishPerform(s, content, answers, everyone, true));
    // C ещё без очков — дарит, но в минус не уходит; выступающим — оба подарка целиком.
    expect(s.leaderboard.A?.score).toBe(400);
    expect(s.leaderboard.B?.score).toBe(70);
    expect(s.leaderboard.C?.score ?? 0).toBe(0);
    expect(parseStageResult(s.state.result).gifts).toEqual(["B", "C"]);
    // «Назад» с итога — очки и подарки возвращаются.
    const back = stageBack(s, content);
    s = apply(s, back?.change ?? {});
    expect(s.leaderboard.A?.score).toBe(0);
    expect(s.leaderboard.B?.score).toBe(120);
    expect(parseStageResult(s.state.result).mode).toBe("perform");
    // «Не вышли» — ничего.
    s = apply(s, finishPerform(s, content, answers, everyone, false));
    expect(s.leaderboard.A?.score).toBe(0);
    expect(stagePrimary(s, content)).toBe("next");
    s = apply(s, nextTurn(s, everyone));
    expect(turnPid(parseStageResult(s.state.result))).toBe("B");
    expect(parseStageResult(s.state.result).played).toEqual(["t1"]);
  });

  it("батлы закрыты, пока каждая команда не выступила; «Не вышли» не считается; ведущий может открыть раньше", () => {
    const locked = parseStage({
      variant: "dance",
      categories: [{ id: "c1", title: "Активные" }],
      tiles: [
        { id: "p1", cat: "c1", points: 100, kind: "perform" },
        { id: "p2", cat: "c1", points: 200, kind: "perform" },
        { id: "p3", cat: "c1", points: 300, kind: "perform" },
        { id: "p4", cat: "c1", points: 400, kind: "perform" },
        { id: "b1", cat: "c1", points: 500, kind: "battle" },
      ],
    });
    expect(locked.battleLock).toBe(true);
    let s = session();
    s = apply(s, startGame(s, everyone));
    const r0 = () => parseStageResult(s.state.result);
    expect(battleWaiting(locked, r0())).toEqual(["A", "B", "C"]);
    expect(pickTile(s, locked, "b1", everyone)).toEqual({});
    const play = (tile: string, ok: boolean) => {
      s = apply(s, pickTile(s, locked, tile, everyone));
      s = apply(s, finishPerform(s, locked, [], everyone, ok));
      s = apply(s, nextTurn(s, everyone));
    };
    play("p1", true); // A выступила
    play("p2", false); // B не вышла
    expect(battleWaiting(locked, r0())).toEqual(["B", "C"]);
    play("p3", true); // C выступила
    expect(battleWaiting(locked, r0())).toEqual(["B"]);
    // «Назад» на итог C — C снова не отмечена.
    const back = apply(s, stageBack(s, locked)?.change ?? {});
    expect(parseStageResult(back.state.result).done).toEqual(["A"]);
    // Ведущий открывает батлы раньше.
    const opened = apply(s, openBattles(s));
    expect(battlesLocked(locked, parseStageResult(opened.state.result))).toBe(false);
    expect(parseStageResult(apply(opened, pickTile(opened, locked, "b1", everyone)).state.result).mode).toBe("perform");
    // Обычные плитки кончились — батлы открываются сами.
    play("p4", false);
    expect(battlesLocked(locked, r0())).toBe(false);
    expect(parseStageResult(apply(s, pickTile(s, locked, "b1", everyone)).state.result).mode).toBe("perform");
  });

  it("«Другая плитка» и «Назад» с выбора возвращают прошлый итог", () => {
    let s = session();
    s = apply(s, startGame(s, everyone));
    s = apply(s, pickTile(s, content, "t1", everyone));
    const other = stageBack(s, content);
    expect(other?.clear).toEqual([s.state.step]);
    s = apply(s, other?.change ?? {});
    expect(parseStageResult(s.state.result).mode).toBe("pick");
    expect(parseStageResult(s.state.result).played).toEqual([]);
    s = apply(s, pickTile(s, content, "t1", everyone));
    s = apply(s, finishPerform(s, content, [], everyone, true));
    s = apply(s, nextTurn(s, everyone));
    s = apply(s, stageBack(s, content)?.change ?? {});
    const r = parseStageResult(s.state.result);
    expect(r.mode).toBe("result");
    expect(r.tile).toBe("t1");
    expect(r.played).toEqual([]);
    expect(s.leaderboard.A?.score).toBe(300);
  });

  it("батл: голосуют телефоны зала, можно передумать, поровну — пополам, ведущий поправляет", () => {
    let s = session();
    s = apply(s, startGame(s, everyone));
    s = apply(s, pickTile(s, content, "t2", everyone, "C"));
    let r = parseStageResult(s.state.result);
    expect([r.performer, r.opponent]).toEqual(["A", "C"]);
    expect(stagePrimary(s, content)).toBe("vote");
    s = apply(s, startVote(s, content, 12));
    r = parseStageResult(s.state.result);
    expect(r.changeable).toBe(true);
    // Сначала фраза на экране (3 с), потом голосование — таймер с запасом на фразу.
    expect(s.state.timeLimit).toBe(23);
    expect(hypeText("dance", r.hype)).toBe(HYPE.dance[12 % HYPE.dance.length]);
    expect(hypeText("karaoke", -1)).toBe(HYPE.karaoke[HYPE.karaoke.length - 1]);
    const step = s.state.step;
    // Голоса сторон батла не считаются, голос «за команду» (капитан) тоже.
    const votes = [ans("B1", step, { vote: "A" }), ans("B2", step, { vote: "C" }), ans("A1", step, { vote: "A" }), ans("B", step, { vote: "A" })];
    expect(liveVotes(s, votes, everyone)?.state?.answered).toBe(2);
    s = apply(s, countVotes(s, content, votes, everyone));
    r = parseStageResult(s.state.result);
    expect(r.outcome).toBe("tie");
    expect(s.leaderboard.A?.score).toBe(200);
    expect(s.leaderboard.C?.score).toBe(200);
    s = apply(s, setBattleWinner(s, content, "C"));
    expect(s.leaderboard.A?.score).toBe(0);
    expect(s.leaderboard.C?.score).toBe(400);
    // «Назад» с итога батла — снова голосование, очки сняты.
    s = apply(s, stageBack(s, content)?.change ?? {});
    expect(parseStageResult(s.state.result).mode).toBe("vote");
    expect(s.leaderboard.C?.score).toBe(0);
    s = apply(s, countVotes(s, content, [ans("B1", step, { vote: "C" })], everyone));
    expect(s.leaderboard.C?.score).toBe(400);
    expect(stagePrimary(s, content)).toBe("next");
  });

  it("плеер и полный экран: каждая команда — новый номер", () => {
    let s = session();
    s = apply(s, startGame(s, everyone));
    s = apply(s, pickTile(s, content, "t1", everyone));
    s = apply(s, videoCommand(s, "pause"));
    let r = parseStageResult(s.state.result);
    expect(r.video).toEqual({ n: 1, cmd: "pause", paused: true });
    s = apply(s, videoCommand(s, "fwd"));
    r = parseStageResult(s.state.result);
    expect(r.video).toEqual({ n: 2, cmd: "fwd", paused: true });
    s = apply(s, videoCommand(s, "stop"));
    s = apply(s, toggleFull(s));
    r = parseStageResult(s.state.result);
    expect(r.video.cmd).toBe("stop");
    expect(r.full).toBe(true);
  });

  it("ссылки: YouTube и Rutube с управлением, VK без", () => {
    expect(videoTarget("https://youtu.be/dQw4w9WgXcQ", "https://games.joy-rest.ru")?.src).toContain("enablejsapi=1");
    expect(videoTarget("https://rutube.ru/video/0123456789abcdef0123456789abcdef/")?.host).toBe("rutube");
    expect(videoTarget("https://vk.com/video-12345_6789")?.host).toBe("vk");
    expect(videoTarget("https://example.com/x.mp4")).toBeNull();
  });

  it("шаблоны и новая игра проходят проверку, битые данные не ломают разбор", () => {
    expect(validateStage(DEMO_STAGE_DANCE.content)).toEqual([]);
    expect(validateStage(DEMO_STAGE_KARAOKE.content)).toEqual([]);
    expect(DEMO_STAGE_KARAOKE.content.variant).toBe("karaoke");
    expect(DEMO_STAGE_DANCE.content.tiles).toHaveLength(20);
    expect(validateStage(createStage())).toEqual([]);
    const parsed = parseStage({ categories: [{ id: "x", title: "А" }], tiles: [{ cat: "nope" }, { cat: "x", who: "zzz", points: 999999 }], gift: -5 });
    expect(parsed.tiles).toHaveLength(1);
    expect(parsed.tiles[0]?.who).toBe("a2");
    expect(parsed.tiles[0]?.points).toBe(5000);
    expect(parsed.gift).toBe(0);
    expect(validateStage(parseStage({ categories: [{ id: "x", title: "А" }], tiles: [{ cat: "x", video: { source: "link", url: "https://example.com" } }] }))).toHaveLength(1);
  });

  it("репетиция без команд: кнопки ведут игру дальше без очков", () => {
    let s = session();
    s = apply(s, startGame(s, []));
    s = apply(s, pickTile(s, content, "t1", []));
    expect(parseStageResult(s.state.result).performer).toBeNull();
    s = apply(s, finishPerform(s, content, [], [], true));
    expect(parseStageResult(s.state.result).mode).toBe("result");
    s = apply(s, nextTurn(s, []));
    s = apply(s, pickTile(s, content, "t2", []));
    s = apply(s, startVote(s, content));
    s = apply(s, countVotes(s, content, [], []));
    expect(parseStageResult(s.state.result).mode).toBe("result");
    expect(stagePrimary(s, content)).toBe("finish");
  });
});
