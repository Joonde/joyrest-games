import type { AgeRating, Game, GameScope, NewGame } from "../data/types";

export const GAME_TITLE_MAX_LENGTH = 80;

export const AGE_RATINGS: AgeRating[] = ["0+", "12+", "18+"];

export function cleanGameTitle(input: string): string {
  return input.replace(/\s+/g, " ").trim().slice(0, GAME_TITLE_MAX_LENGTH);
}

export function isValidGameTitle(title: string): boolean {
  return title.length > 0 && title.length <= GAME_TITLE_MAX_LENGTH;
}

const COPY_SUFFIX = " (копия)";

/** Копия игры в нужную библиотеку. В своей библиотеке к названию добавляется «(копия)». */
export function copyOfGame(game: Game, scope: GameScope, ownerId: string): NewGame {
  const sameLibrary = game.scope === scope && game.ownerId === ownerId;
  const base = sameLibrary ? game.title.slice(0, GAME_TITLE_MAX_LENGTH - COPY_SUFFIX.length) + COPY_SUFFIX : game.title;
  return {
    scope,
    ownerId,
    title: base,
    mechanic: game.mechanic,
    themeId: game.themeId,
    ageRating: game.ageRating,
    playMode: game.playMode,
    content: game.content,
  };
}

/** Новые сверху; игры без даты — в конце. */
export function sortGames(games: Game[]): Game[] {
  return [...games].sort(
    (a, b) =>
      (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0) || a.title.localeCompare(b.title, "ru"),
  );
}

/** Снимок игры для сессии: правка игры в конструкторе не ломает идущую сессию. */
export function gameSnapshot(game: Game): { title: string; mechanic: string; themeId: string; content: unknown } {
  return { title: game.title, mechanic: game.mechanic, themeId: game.themeId, content: game.content };
}
