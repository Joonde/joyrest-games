/**
 * Игры на своём сервере: `/api/games`. id новой игры и копии создаёт браузер — повтор записи
 * после обрыва связи не создаёт дубль (сервер узнаёт свою же игру).
 */
import { sortGames } from "../../core/games";
import type { GamesRepository } from "../contracts";
import { errorCodeOf } from "../retry";
import type { AgeRating, Game, PlayMode } from "../types";
import { api, asRecord, asText, newId } from "./api";

/** Версия каждой открытой игры, с которой правит этот человек: сервер сверяет её при сохранении (совместная работа). */
const versions = new Map<string, number>();

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
    folder: asText(data.folder),
    editedBy: asText(data.editedBy),
    editedByName: asText(data.editedByName),
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
      const game = parseGame(await api("GET", path(gameId)));
      // Версия, с которой этот человек начал править (для сверки при автосохранении).
      if (game?.updatedAt) versions.set(game.id, game.updatedAt);
      return game;
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
    const base = versions.get(gameId);
    const result = asRecord(await api("PATCH", path(gameId), base !== undefined ? { ...patch, base } : patch));
    if (typeof result.updatedAt === "number") versions.set(gameId, result.updatedAt);
  },

  overwriteNext(gameId) {
    versions.delete(gameId);
  },

  async remove(gameId) {
    await api("DELETE", path(gameId));
  },
};

/** Папки «Моих игр» (решение владельца 15 октября 2026) — только свой сервер. */
export const serverGameFolders = {
  async list(): Promise<string[]> {
    return names(await api("GET", "/api/game-folders"));
  },
  async create(name: string): Promise<string[]> {
    return names(await api("POST", "/api/game-folders", { name }));
  },
  async rename(from: string, to: string): Promise<string[]> {
    return names(await api("POST", "/api/game-folders/rename", { from, to }));
  },
  async remove(name: string): Promise<string[]> {
    return names(await api("POST", "/api/game-folders/delete", { name }));
  },
};

function names(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
}
