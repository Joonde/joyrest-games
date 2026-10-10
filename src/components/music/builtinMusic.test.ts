import { describe, expect, it } from "vitest";
import { startState } from "../../core/session";
import type { Session, SessionState } from "../../data/types";
import { dragon } from "../../mechanics/dragon";
import { quiz } from "../../mechanics/quiz";
import { newQuestion, type QuizContent } from "../../mechanics/quiz/content";
import { builtinMusicOf } from "./builtinMusic";

function session(state: Partial<SessionState>): Session {
  return {
    id: "s",
    code: "1",
    hostId: "h",
    gameId: "g",
    gameTitle: "",
    mechanic: "quiz",
    gameSnapshot: null,
    themeId: "joyrest",
    playMode: "teams",
    screenMode: "laptop",
    state: { ...startState(), ...state },
    leaderboard: {},
    createdAt: 0,
  } as Session;
}

const content: QuizContent = { questions: [{ ...newQuestion("choice"), text: "?", options: ["a", "b"], correct: 0 }, newQuestion("super")] };
const moment = (s: Session) => quiz.music?.(s, content) ?? null;
const of = (s: Session) => builtinMusicOf(s, moment(s));

describe("встроенная музыка экрана зала", () => {
  it("лобби — музыка ожидания, «Представить команды» — своя", () => {
    expect(of(session({ phase: "lobby" }))).toEqual({ key: "lobby", urls: ["/sounds/lobby-1.mp3"] });
    expect(of(session({ phase: "lobby", teams: { hidden: true, shown: 0 } }))?.urls).toEqual(["/sounds/teams-intro-1.mp3"]);
  });

  it("перерыв — два трека по кругу, поверх любой фазы", () => {
    const slide = { id: "b1", kind: "break" as const, title: "Перерыв", text: "", lines: [], endsAt: null };
    for (const phase of ["lobby", "playing", "finished"] as const) {
      expect(of(session({ phase, slide }))).toEqual({ key: "break:b1", urls: ["/sounds/break-golden-hour-1.mp3", "/sounds/break-event-1.mp3"] });
    }
  });

  it("заставка вопроса — на каждом шаге заново, вопрос открыт — тишина", () => {
    const ready = of(session({ phase: "playing", stage: "ready", step: 0 }));
    expect(ready?.urls).toEqual(["/sounds/question-intro-1.mp3"]);
    expect(of(session({ phase: "playing", stage: "question", step: 0, startedAt: 5 }))).toBeNull();
    expect(of(session({ phase: "playing", stage: "reveal", step: 0 }))).toBeNull();
  });

  it("суперигра: заставка без музыки вопроса, выбор уровня — своя музыка", () => {
    expect(of(session({ phase: "playing", stage: "ready", step: 1 }))).toBeNull();
    expect(of(session({ phase: "playing", stage: "question", step: 1, startedAt: 9 }))?.urls).toEqual(["/sounds/super-pick-1.mp3"]);
  });

  it("бой с драконом: громко в лобби, тихим фоном весь бой без перезапуска, на награждении — тишина", () => {
    const d = (state: Partial<SessionState>) => {
      const s = { ...session(state), mechanic: "dragon" } as Session;
      return builtinMusicOf(s, dragon.music?.(s, null as never) ?? null);
    };
    const lobby = d({ phase: "lobby" });
    expect(lobby).toEqual({ key: "dragonLobby", urls: ["/sounds/dragon-battle-1.mp3", "/sounds/dragon-battle-1.mp3"], volume: 1 });
    const a = d({ phase: "playing", stage: "ready", step: 0 });
    const b = d({ phase: "playing", stage: "question", step: 3, startedAt: 7 });
    expect(a?.key).toBe("dragonBattle");
    expect(b?.key).toBe("dragonBattle"); // тот же ключ на всех шагах — трек не начинается заново
    expect(a?.volume).toBeLessThan(0.5);
    expect(a?.urls).toEqual(lobby?.urls);
    expect(d({ phase: "playing", stage: "podium" })).toBeNull();
    // Перерыв и «Представить команды» главнее музыки дракона.
    expect(d({ phase: "lobby", teams: { hidden: true, shown: 0 } })?.key).toBe("teams");
  });

  it("файлы на месте: у каждого встроенного трека есть файл", async () => {
    const { existsSync } = await import("node:fs");
    const { SAMPLES } = await import("../live/sound");
    for (const url of Object.values(SAMPLES)) expect(existsSync(`public${url}`), url).toBe(true);
  });
});
