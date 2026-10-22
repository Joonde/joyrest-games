import { describe, expect, it } from "vitest";
import type { Deck, SlideMedia } from "../data/types";
import { deckReloadKey, needsDeckReload, shouldReloadDecks } from "./decks";

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

describe("показ удалили, а его страница на экране", () => {
  it("перечитали один раз и не нашли — больше не перечитываем, пока не сменится показ или страница", () => {
    const shown = media("d2", 3);
    const tried = new Set<string>();
    expect(shouldReloadDecks([deck], shown, tried)).toBe(true);
    tried.add(deckReloadKey(shown));
    expect(shouldReloadDecks([deck], shown, tried)).toBe(false);
    // Другая страница того же показа или другой показ — снова один раз.
    expect(shouldReloadDecks([deck], { ...shown, page: 1 }, tried)).toBe(true);
    expect(shouldReloadDecks([deck], media("d3", 3), tried)).toBe(true);
    // Показ в списке есть — перечитывать не нужно в любом случае.
    expect(shouldReloadDecks([deck], media("d1", 2), new Set())).toBe(false);
    expect(deckReloadKey(shown)).toBe("d2:0:3");
  });
});
