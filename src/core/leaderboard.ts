import type { Leaderboard, LeaderboardEntry, Participant, PlayMode } from "../data/types";

/**
 * Кто должен быть в таблице лидеров: в режиме solo — игроки, в режиме teams — команды.
 * Телефоны участников команды в таблицу не попадают.
 */
export function scoringParticipants(participants: Participant[], playMode: PlayMode): Participant[] {
  const kind = playMode === "teams" ? "team" : "player";
  return participants.filter((p) => p.kind === kind);
}

/**
 * Возвращает только новые или переименованные записи таблицы лидеров.
 * Очки существующих записей не трогаем: их меняет только подсчёт очков.
 */
export function leaderboardAdditions(
  leaderboard: Leaderboard,
  participants: Participant[],
  playMode: PlayMode,
): Record<string, LeaderboardEntry> {
  const additions: Record<string, LeaderboardEntry> = {};
  for (const p of scoringParticipants(participants, playMode)) {
    const existing = leaderboard[p.id];
    if (!existing) {
      additions[p.id] = { name: p.name, kind: p.kind, score: 0 };
    } else if (existing.name !== p.name) {
      additions[p.id] = { ...existing, name: p.name };
    }
  }
  return additions;
}

/** Записи таблицы лидеров по убыванию очков, при равенстве — по имени. */
export function sortedLeaderboard(leaderboard: Leaderboard): Array<LeaderboardEntry & { id: string }> {
  return Object.entries(leaderboard)
    .map(([id, entry]) => ({ id, ...entry }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ru"));
}
