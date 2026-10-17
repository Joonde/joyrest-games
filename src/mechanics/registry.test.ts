import { describe, expect, it } from "vitest";
import { getMechanic, supportedPlayMode, supportedPlayModes } from "./registry";

describe("режимы участников", () => {
  it("игры только для команд и только для каждого сам за себя", () => {
    for (const id of ["stage", "dance", "checkers"]) {
      expect(getMechanic(id)?.supports.solo).toBe(false);
      expect(supportedPlayModes(id)).toEqual(["teams"]);
      expect(supportedPlayMode(id, "solo")).toBe("teams");
    }
    for (const id of ["mafia", "bunker", "spy"]) {
      expect(supportedPlayMode(id, "teams")).toBe("solo");
    }
    expect(supportedPlayMode("quiz", "solo")).toBe("solo");
    expect(supportedPlayMode("quiz", "teams")).toBe("teams");
    expect(supportedPlayMode("нет-такой", "teams")).toBe("teams");
  });
});
