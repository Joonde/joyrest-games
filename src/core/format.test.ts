import { describe, expect, it } from "vitest";
import { formatDate } from "./format";

describe("formatDate", () => {
  it("по-русски, без «г.»", () => {
    expect(formatDate(new Date(2026, 9, 5, 12).getTime())).toBe("5 октября 2026");
  });
});
