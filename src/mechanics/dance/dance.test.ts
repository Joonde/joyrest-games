import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import { embedUrl, newCard, parseDance } from "./content";
import { DEMO_DANCE } from "./demo";
import { validateDance } from "./validate";
import { danceBack, dancePrimary, resolveTie, nextTurn, parseDanceResult, pickCard, pickFromAnswers, showResult, startPick, startVote, turnPid } from "./logic";

const content = parseDance({
  cards: [
    { ...newCard("dance"), id: "c1", title: "Танец" },
    { ...newCard("battle"), id: "c2", title: "Батл" },
  ],
});
const teams: Participant[] = ["A", "B", "C"].map((id, i) => ({ id, name: `Команда ${id}`, kind: "team", teamId: null, captainUid: `u${id}`, joinedAt: i }));
const session = (): Session => ({ id: "s", code: "1", hostId: "h", gameId: "g", gameTitle: "", mechanic: "dance", gameSnapshot: null, themeId: "joyrest", playMode: "teams", screenMode: "laptop", state: startState(), leaderboard: {}, createdAt: 0 });
let t = 0;
const apply = (s: Session, c: SessionChange) => applyChange(s, c, (t += 1000));
const ans = (pid: string, step: number, value: unknown): Answer => ({ id: `${step}_${pid}`, step, pid, uid: pid, value, submittedAt: 1e12 });

describe("Танцевальный батл", () => {
  it("очередь, выбор капитаном, оценки других команд — среднее; свой голос не считается", () => {
    let s = session();
    expect(dancePrimary(s, content)).toBe("start");
    s = apply(s, startPick(s, teams));
    const r = parseDanceResult(s.state.result);
    expect(r.order).toEqual(["A", "B", "C"]);
    expect(turnPid(r)).toBe("A");
    // Выбирает не та команда — не принимается.
    expect(pickFromAnswers(s, content, [ans("B", 0, { card: "c1" })], teams)).toBeNull();
    s = apply(s, pickFromAnswers(s, content, [ans("A", 0, { card: "c1" })], teams) ?? {});
    expect(parseDanceResult(s.state.result).mode).toBe("perform");
    s = apply(s, startVote(s, content));
    s = apply(s, showResult(s, content, [ans("A", 1, { rate: 100 }), ans("B", 1, { rate: 60 }), ans("C", 1, { rate: 500 })]));
    // A за себя не голосует; 500 → 100 (максимум).
    expect(s.leaderboard.A?.score).toBe(80);
    expect(dancePrimary(s, content)).toBe("next");
    s = apply(s, nextTurn(s));
    expect(turnPid(parseDanceResult(s.state.result))).toBe("B");

    // Назад с выбора — к итогу прошлого выступления, ещё раз назад — очки сняты.
    s = apply(s, danceBack(s)?.change ?? {});
    expect(parseDanceResult(s.state.result).mode).toBe("result");
    s = apply(s, danceBack(s)?.change ?? {});
    expect(s.leaderboard.A?.score).toBe(0);
    // Время голосования не вернуть: голосование закрыто, итог пересчитывается по поданным голосам.
    expect(s.state.stage).toBe("reveal");
    expect(dancePrimary(s, content)).toBe("result");
  });

  it("батл: голос за другую команду; ничья — победителя называет ведущий", () => {
    let s = session();
    s = apply(s, startPick(s, teams));
    s = apply(s, pickCard(s, content, "c2", teams));
    s = apply(s, startVote(s, content));
    s = apply(s, showResult(s, content, [ans("A", 1, { team: "B" }), ans("B", 1, { team: "A" }), ans("C", 1, { team: "C" })]));
    // Ничья A–B: очков пока нет, решает ведущий.
    expect(parseDanceResult(s.state.result).tie).toEqual(["B", "A"]);
    expect(s.leaderboard.A?.score).toBe(0);
    s = apply(s, resolveTie(s, content, "A"));
    expect(s.leaderboard.A?.score).toBe(100);
    expect(resolveTie(s, content, "B")).toEqual({});
  });

  it("ссылки на видео: YouTube, VK, Rutube; остальное — нет", () => {
    expect(embedUrl("https://youtu.be/dQw4w9WgXcQ")).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(embedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1")).toContain("/embed/dQw4w9WgXcQ");
    expect(embedUrl("https://vk.com/video-12345_6789")).toBe("https://vk.com/video_ext.php?oid=-12345&id=6789&autoplay=1");
    expect(embedUrl("https://rutube.ru/video/0123456789abcdef0123456789abcdef/")).toContain("/play/embed/0123456789abcdef0123456789abcdef");
    expect(embedUrl("http://youtu.be/dQw4w9WgXcQ")).toBeNull();
    expect(embedUrl("javascript:alert(1)")).toBeNull();
    expect(embedUrl("https://example.com/v.mp4")).toBeNull();
  });
});

describe("шаблон батла", () => {
  it("готов к запуску", () => {
    expect(DEMO_DANCE.content.cards).toHaveLength(9);
    expect(validateDance(DEMO_DANCE.content)).toEqual([]);
  });
});
