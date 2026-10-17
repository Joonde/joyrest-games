import { describe, expect, it } from "vitest";
import { BOARD_PAGE_ROWS, boardPages } from "./BoardView";

describe("страницы длинной таблицы экрана зала", () => {
  it("до восьми строк — одна страница", () => {
    expect(boardPages([1, 2, 3])).toEqual([[1, 2, 3]]);
    expect(boardPages(Array.from({ length: BOARD_PAGE_ROWS }, (_, i) => i))).toHaveLength(1);
  });
  it("12 игроков — две страницы, никто не потерялся", () => {
    const rows = Array.from({ length: 12 }, (_, i) => i);
    const pages = boardPages(rows);
    expect(pages.map((p) => p.length)).toEqual([8, 4]);
    expect(pages.flat()).toEqual(rows);
  });
  it("30 команд — четыре страницы", () => {
    expect(boardPages(Array.from({ length: 30 }, (_, i) => i)).map((p) => p.length)).toEqual([8, 8, 8, 6]);
  });
});
