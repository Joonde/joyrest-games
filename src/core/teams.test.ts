import { describe, expect, it } from "vitest";
import { nameParts } from "../components/NameText";
import { parsePeek, parseTeams } from "../data/cues";
import type { LeaderboardEntry, SessionState } from "../data/types";
import { formatDuration } from "./format";
import { isOnline, PRESENCE_TIMEOUT_MS } from "./presence";
import { presentationDone, publicTeamName, teamNameVisible, teamOrder } from "./teams";

const board: Record<string, LeaderboardEntry> = {
  z: { name: "🦊 Лисы", kind: "team", score: 0, colorIndex: 1 },
  a: { name: "🐻 Медведи", kind: "team", score: 0, colorIndex: 0 },
  c: { name: "🚀 Ракеты", kind: "team", score: 0, colorIndex: 2 },
};
const lobby = (teams: SessionState["teams"]): Pick<SessionState, "teams" | "phase"> => ({ phase: "lobby", teams });

describe("скрытые названия и представление команд", () => {
  it("порядок — как подключались (по цвету)", () => {
    expect(teamOrder(board).map((t) => [t.id, t.number])).toEqual([
      ["a", 1],
      ["z", 2],
      ["c", 3],
    ]);
  });

  it("скрыто — «Команда N»; на представлении открываются по одной; в игре — все видны", () => {
    const [first, second] = teamOrder(board);
    if (!first || !second) throw new Error("нет команд");
    expect(publicTeamName(lobby({ hidden: true, shown: null }), first)).toBe("Команда 1");
    expect(publicTeamName(lobby({ hidden: true, shown: 0 }), first)).toBe("🐻 Медведи");
    expect(publicTeamName(lobby({ hidden: true, shown: 0 }), second)).toBe("Команда 2");
    expect(teamNameVisible({ phase: "playing", teams: { hidden: true, shown: null } }, 2)).toBe(true);
    expect(publicTeamName(lobby(null), second)).toBe("🦊 Лисы");
    expect(presentationDone({ teams: { hidden: true, shown: 3 } }, 3)).toBe(true);
    expect(presentationDone({ teams: { hidden: true, shown: 2 } }, 3)).toBe(false);
  });

  it("данные с сервера проверяются", () => {
    expect(parseTeams({ hidden: true, shown: 2, sizes: { a: 3, "плохой id": 2, c: -1, z: 4.5 } })).toEqual({ hidden: true, shown: 2, sizes: { a: 3 } });
    expect(parseTeams({ hidden: "да", shown: -1 })).toEqual({ hidden: false, shown: null });
    expect(parseTeams("x")).toBeNull();
    expect(parsePeek("round")).toBe("round");
    expect(parsePeek("всё")).toBeNull();
  });
});

describe("на связи ли телефон", () => {
  it("молчит дольше 75 секунд — не на связи; только вошёл — на связи", () => {
    expect(isOnline({ seenAt: 1000, joinedAt: 0 }, 1000 + PRESENCE_TIMEOUT_MS - 1)).toBe(true);
    expect(isOnline({ seenAt: 1000, joinedAt: 0 }, 1000 + PRESENCE_TIMEOUT_MS)).toBe(false);
    expect(isOnline({ seenAt: null, joinedAt: 5000 }, 5000 + PRESENCE_TIMEOUT_MS + 1)).toBe(false);
    expect(isOnline({ seenAt: null, joinedAt: null }, 1e12)).toBe(true);
  });
});

describe("имя со смайликами", () => {
  it("каждый смайлик — отдельно, где бы он ни стоял", () => {
    expect(nameParts("🐻😳 Мишуня")).toEqual([
      { text: "🐻", emoji: true },
      { text: "😳", emoji: true },
      { text: " Мишуня", emoji: false },
    ]);
    expect(nameParts("Команда 1")).toEqual([{ text: "Команда 1", emoji: false }]);
    expect(nameParts("Семья 👨‍👩‍👧")).toEqual([
      { text: "Семья ", emoji: false },
      { text: "👨‍👩‍👧", emoji: true },
    ]);
  });
});

describe("сколько шла игра", () => {
  it("минуты и часы", () => {
    expect(formatDuration(20_000)).toBe("меньше минуты");
    expect(formatDuration(47 * 60_000)).toBe("47 мин");
    expect(formatDuration(72 * 60_000)).toBe("1 ч 12 мин");
    expect(formatDuration(120 * 60_000)).toBe("2 ч");
  });
});
