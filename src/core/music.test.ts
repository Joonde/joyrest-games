import { describe, expect, it } from "vitest";
import { durationLabel, nextInCategory, titleFromFile } from "./music";

describe("музыка: подписи", () => {
  it("длительность и название из файла", () => {
    expect(durationLabel(61000)).toBe("1:01");
    expect(durationLabel(null)).toBe("");
    expect(titleFromFile("Party_Time  mix.mp3")).toBe("Party Time mix");
  });

  it("следующий трек той же категории по кругу", () => {
    const tracks = [
      { id: "a", category: "lobby" as const },
      { id: "b", category: "contest" as const },
      { id: "c", category: "lobby" as const },
    ];
    expect(nextInCategory(tracks, "a")?.id).toBe("c");
    expect(nextInCategory(tracks, "c")?.id).toBe("a");
    expect(nextInCategory(tracks, "b")).toBeNull();
  });
});
