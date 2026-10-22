import { describe, expect, it } from "vitest";
import type { Deck, SlideMedia } from "../data/types";
import { needsDeckReload } from "./decks";

const page = { sha: "a".repeat(64), w: 1920, h: 1080, size: 1000 };
const deck: Deck = { id: "d1", title: "Меню", pages: [page, page], updatedAt: 0 };
const media = (deckId: string, count: number): SlideMedia => ({ deck: deckId, page: 0, count, sha: page.sha, next: null, w: 1920, h: 1080 });

describe("второй пульт и показ с первого", () => {
  it("показ есть в списке — перечитывать не нужно", () => {
    expect(needsDeckReload([deck], media("d1", 2))).toBe(false);
  });
  it("показа нет в списке — перечитать", () => {
    expect(needsDeckReload([deck], media("d2", 3))).toBe(true);
    expect(needsDeckReload([], media("d2", 3))).toBe(true);
  });
  it("на экране больше страниц, чем в списке, — перечитать", () => {
    expect(needsDeckReload([deck], media("d1", 5))).toBe(true);
  });
  it("список ещё грузится или на экране не показ — ничего", () => {
    expect(needsDeckReload(null, media("d1", 2))).toBe(false);
    expect(needsDeckReload([deck], null)).toBe(false);
  });
});
