import { describe, expect, it } from "vitest";
import { parseFormation, parseLobby } from "./teamLobby";

describe("командное лобби: разбор ответов сервера", () => {
  it("настройки: неизвестный режим — прежнее лобби; исключённые — только у пульта", () => {
    expect(parseFormation(null)).toBeNull();
    expect(parseFormation({ mode: "legacy", revision: 3 })).toBeNull();
    expect(parseFormation({ mode: "self", teamCount: 6, maxMembers: 10, revision: 2, distributed: false })).toEqual({
      mode: "self",
      teamCount: 6,
      maxMembers: 10,
      revision: 2,
      distributed: false,
    });
    expect(parseFormation({ mode: "randomTeams", teamCount: 3, maxMembers: 4, revision: 1, distributed: true, excluded: ["a", 1] })?.excluded).toEqual(["a"]);
  });

  it("лобби: карточки команд без лишних полей; без настроек — null", () => {
    const lobby = parseLobby({
      formation: { mode: "self", teamCount: 2, maxMembers: 5, revision: 1, distributed: false },
      teams: [{ id: "t1", name: "Лисы", memberCount: 2, captainName: "Аня", captainUid: "секрет" }, { name: "без id" }],
      joinedCount: 3,
      onlineCount: 2,
      waitingCount: 1,
    });
    expect(lobby?.teams).toEqual([{ id: "t1", name: "Лисы", memberCount: 2, captainName: "Аня" }]);
    expect(lobby?.waitingCount).toBe(1);
    expect(parseLobby({ teams: [] })).toBeNull();
  });
});
