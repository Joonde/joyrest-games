import { describe, expect, it } from "vitest";
import { bedControlVisible } from "./bedControl";

describe("ползунок фоновой музыки экрана", () => {
  it("показывается для собственной музыки игры после разрешения звука", () => {
    expect(bedControlVisible(true, false, true)).toBe(true);
    expect(bedControlVisible(true, false, false)).toBe(false);
  });
  it("сохраняет прежнее поведение платформенной музыки и обычных игр", () => {
    expect(bedControlVisible(false, true, true)).toBe(true);
    expect(bedControlVisible(undefined, false, true)).toBe(false);
  });
});
