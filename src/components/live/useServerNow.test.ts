import { describe, expect, it } from "vitest";
import { serverNowForRender } from "./useServerNow";

describe("часы на первом кадре таймера", () => {
  it("при включении не использует время, сохранённое при открытии страницы", () => {
    const openedAt = 1_000;
    const drumStartedAt = 95_000;
    expect(serverNowForRender(true, openedAt, drumStartedAt)).toBe(drumStartedAt);
  });

  it("на неактивном таймере сохраняет прежнее поведение", () => {
    expect(serverNowForRender(false, 1_000, 95_000)).toBe(1_000);
  });
});
