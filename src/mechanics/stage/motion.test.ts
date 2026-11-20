import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Participant, Session, SessionChange } from "../../data/types";
import { parseStage } from "./content";
import type { DanceAttemptSummary } from "./dances";
import { finishMotion, parseStageResult, pickTile, startGame } from "./logic";

const content = parseStage({
  variant: "dance",
  categories: [{ id: "c1", title: "Шесть танцев" }],
  tiles: [{ id: "dance1", cat: "c1", points: 300, kind: "perform", who: "m2", motionSong: "bailar" }],
});
const participants: Participant[] = [
  { id: "A", name: "Команда А", kind: "team", teamId: null, captainUid: "a1", joinedAt: 0 },
  { id: "B", name: "Команда Б", kind: "team", teamId: null, captainUid: "b1", joinedAt: 1 },
  { id: "a1", name: "Аня", kind: "player", teamId: "A", captainUid: "a1", joinedAt: 2 },
  { id: "b1", name: "Борис", kind: "player", teamId: "B", captainUid: "b1", joinedAt: 3 },
];
const attempt = (patch: Partial<DanceAttemptSummary> = {}): DanceAttemptSummary => ({ id: "attempt1", sessionId: "s", tileId: "dance1", songKey: "bailar", dancer: 1, pid: "a1", teamId: "A", playerName: "Аня", percent: 87, points: 870, maxPoints: 1000, createdAt: 1, ...patch });
let clock = 0;
const apply = (session: Session, change: SessionChange) => applyChange(session, change, (clock += 1000));

function playing(): Session {
  let session: Session = { id: "s", code: "123456", hostId: "h", gameId: "g", gameTitle: "Танцы", mechanic: "stage", gameSnapshot: null, themeId: "joyrest", playMode: "teams", screenMode: "laptop", state: startState(), leaderboard: {}, createdAt: 0 };
  session = apply(session, startGame(session, participants));
  return apply(session, pickTile(session, content, "dance1", participants));
}

describe("проверка движений", () => {
  it("шесть танцев разбираются в плитке, старые игры остаются обычными", () => {
    expect(content.tiles[0]?.motionSong).toBe("bailar");
    expect(parseStage({ categories: [{ id: "c", title: "Старая" }], tiles: [{ id: "t", cat: "c", kind: "perform" }] }).tiles[0]?.motionSong).toBeNull();
  });

  it("результат своей команды даёт процент очков плитки и попадает на экран", () => {
    const session = playing();
    const changed = apply(session, finishMotion(session, content, attempt()));
    expect(changed.leaderboard.A?.score).toBe(261);
    expect(parseStageResult(changed.state.result)).toMatchObject({ mode: "result", outcome: "done", motion: { id: "attempt1", pid: "a1", percent: 87, points: 261 } });
  });

  it("чужую команду, другую плитку и другой танец зачесть нельзя", () => {
    const session = playing();
    expect(finishMotion(session, content, attempt({ teamId: "B", pid: "b1" }))).toEqual({});
    expect(finishMotion(session, content, attempt({ tileId: "other" }))).toEqual({});
    expect(finishMotion(session, content, attempt({ songKey: "animals" }))).toEqual({});
    expect(session.leaderboard.A?.score ?? 0).toBe(0);
  });
});
