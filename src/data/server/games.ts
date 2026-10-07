/**
 * Игры на своём сервере: `/api/games`. id новой игры и копии создаёт браузер — повтор записи
 * после обрыва связи не создаёт дубль (сервер узнаёт свою же игру).
 */
import { sortGames } from "../../core/games";
import type { GamesRepository } from "../contracts";
import { errorCodeOf } from "../retry";
import type { AgeRating, Game, PlayMode } from "../types";
import { api, asRecord, asText, newId } from "./api";

function parseAge(value: unknown): AgeRating {
  return value === "12+" || value === "18+" ? value : "0+";
}

function parsePlay(value: unknown): PlayMode {
  return value === "teams" ? "teams" : "solo";
}

function millis(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

export function parseGame(value: unknown): Game | null {
  const data = asRecord(value);
  const id = asText(data.id);
  if (!id) return null;
  return {
    id,
    scope: data.scope === "agency" ? "agency" : "personal",
    ownerId: asText(data.ownerId),
    title: asText(data.title),
    mechanic: asText(data.mechanic) || "quiz",
    themeId: asText(data.themeId) || "joyrest",
    ageRating: parseAge(data.ageRating),
    playMode: parsePlay(data.playMode),
    content: data.content ?? null,
    createdAt: millis(data.createdAt),
    updatedAt: millis(data.updatedAt),
  };
}

function parseGames(value: unknown): Game[] {
  return sortGames((Array.isArray(value) ? value : []).map(parseGame).filter((g): g is Game => g !== null));
}

const path = (id: string) => `/api/games/${encodeURIComponent(id)}`;

export const serverGamesRepository: GamesRepository = {
  async listAgency() {
    return parseGames(await api("GET", "/api/games?scope=agency"));
  },

  async listPersonal(ownerId) {
    return parseGames(await api("GET", `/api/games?scope=personal&owner=${encodeURIComponent(ownerId)}`));
  },

  async get(gameId) {
    try {
      return parseGame(await api("GET", path(gameId)));
    } catch (error) {
      if (errorCodeOf(error) === "not-found") return null;
      throw error;
    }
  },

  async create(game) {
    const id = newId();
    await api("POST", "/api/games", { ...game, id });
    return id;
  },

  async copy(sourceGameId, mediaIds, draft) {
    const id = newId();
    await api("POST", `${path(id)}/copy`, { sourceId: sourceGameId, mediaIds: [...new Set(mediaIds)], game: draft });
    return id;
  },

  async update(gameId, patch) {
    await api("PATCH", path(gameId), patch);
  },

  async remove(gameId) {
    await api("DELETE", path(gameId));
  },
};
