/** Показы ведущего на своём сервере: `/api/decks`, страницы — `/api/decks/page` (`src/core/decks.ts`). */
import { parseDeckPages } from "../../core/decks";
import type { DecksRepository } from "../contracts";
import type { Deck, DeckPage } from "../types";
import { api, asRecord, asText, putFile } from "./api";

function parseDeck(value: unknown): Deck | null {
  const d = asRecord(value);
  const id = asText(d.id);
  if (!id) return null;
  return { id, title: asText(d.title), pages: parseDeckPages(d.pages), updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : 0 };
}

export const serverDecksRepository: DecksRepository = {
  async list() {
    const raw = asRecord(await api("GET", "/api/decks")).decks;
    return (Array.isArray(raw) ? raw : []).map(parseDeck).filter((d): d is Deck => d !== null);
  },
  async save(deck) {
    const saved = parseDeck(await api("POST", "/api/decks", deck));
    if (!saved) throw new Error("invalid-argument");
    return saved;
  },
  async remove(id) {
    await api("DELETE", `/api/decks/${encodeURIComponent(id)}`);
  },
  async uploadPage(image, width, height) {
    const type = image.type === "image/jpeg" ? "image/jpeg" : "image/webp";
    const page = parseDeckPages([await putFile("/api/decks/page", image, type, { "X-Width": String(Math.round(width)), "X-Height": String(Math.round(height)) })])[0];
    if (!page) throw new Error("invalid-argument");
    return page as DeckPage;
  },
  pageUrl(sha) {
    return `/api/decks/page/${sha}`;
  },
};
