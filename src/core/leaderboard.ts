import type { Leaderboard, LeaderboardEntry, Participant, PlayMode } from "../data/types";
import { NAME_MAX_LENGTH } from "./names";

/**
 * Кто должен быть в таблице лидеров: в режиме solo — игроки, в режиме teams — команды.
 * Телефоны участников команды в таблицу не попадают.
 */
export function scoringParticipants(participants: Participant[], playMode: PlayMode): Participant[] {
  const kind = playMode === "teams" ? "team" : "player";
  return participants.filter((p) => p.kind === kind);
}

function nameKey(name: string): string {
  return name.toLocaleLowerCase("ru").replace(/ё/g, "е").trim();
}

/** Одинаковые имена различаются номером: «Аня», «Аня 2», «Аня 3». */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(nameKey));
  if (!used.has(nameKey(name))) return name;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = name.slice(0, NAME_MAX_LENGTH - suffix.length) + suffix;
    if (!used.has(nameKey(candidate))) return candidate;
  }
}

/** Имя в таблице получено из имени участника (само имя или имя с номером). */
function derivedFrom(boardName: string, name: string): boolean {
  if (boardName === name) return true;
  const base = /^(.*) \d+$/.exec(boardName)?.[1];
  if (base === undefined) return false;
  // Длинное имя обрезается, чтобы поместился номер.
  return base === name || (boardName.length === NAME_MAX_LENGTH && name.startsWith(base));
}

/**
 * Возвращает только новые или переименованные записи таблицы лидеров.
 * Очки существующих записей не трогаем: их меняет только подсчёт очков.
 * Новая команда получает следующий по порядку цвет, и он больше не меняется.
 * Одинаковые имена получают номер, капитан команды переносится в таблицу.
 */
export function leaderboardAdditions(
  leaderboard: Leaderboard,
  participants: Participant[],
  playMode: PlayMode,
): Record<string, LeaderboardEntry> {
  const additions: Record<string, LeaderboardEntry> = {};
  // Следующий цвет — после самого большого выданного (команду могли убрать или добавить вручную).
  let nextColor = Math.max(-1, ...Object.values(leaderboard).map((e) => (e.kind === "team" ? (e.colorIndex ?? -1) : -1))) + 1;
  const names = new Map(Object.entries(leaderboard).map(([id, e]) => [id, e.name]));
  const others = (id: string) => [...names.entries()].filter(([other]) => other !== id).map(([, n]) => n);
  // Первыми имя получают те, кто вошёл раньше.
  const scoring = [...scoringParticipants(participants, playMode)].sort(
    (a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0) || a.id.localeCompare(b.id),
  );
  for (const p of scoring) {
    const existing = leaderboard[p.id];
    if (!existing) {
      const name = uniqueName(p.name, others(p.id));
      names.set(p.id, name);
      additions[p.id] =
        p.kind === "team"
          ? { name, kind: p.kind, score: 0, colorIndex: nextColor++, captainUid: p.captainUid }
          : { name, kind: p.kind, score: 0 };
      continue;
    }
    let entry = existing;
    if (!derivedFrom(existing.name, p.name)) {
      const name = uniqueName(p.name, others(p.id));
      names.set(p.id, name);
      entry = { ...entry, name };
    }
    if (p.kind === "team" && existing.captainUid !== p.captainUid) entry = { ...entry, captainUid: p.captainUid };
    if (entry !== existing) additions[p.id] = entry;
  }
  return additions;
}

/** Записи таблицы лидеров по убыванию очков, при равенстве — по имени. */
export function sortedLeaderboard(leaderboard: Leaderboard): Array<LeaderboardEntry & { id: string }> {
  return Object.entries(leaderboard)
    .map(([id, entry]) => ({ id, ...entry }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ru"));
}

/** Таблица с местами: при равных очках — общее место (10, 10, 7 → 1, 1, 3). */
export function rankedLeaderboard(leaderboard: Leaderboard): Array<LeaderboardEntry & { id: string; place: number }> {
  const sorted = sortedLeaderboard(leaderboard);
  let place = 1;
  return sorted.map((entry, i) => {
    if (i > 0 && sorted[i - 1]?.score !== entry.score) place = i + 1;
    return { ...entry, place };
  });
}

/** Место участника и сколько всего мест; null — участника нет в таблице. */
export function placeOf(leaderboard: Leaderboard, pid: string): { place: number; total: number } | null {
  const ranked = rankedLeaderboard(leaderboard);
  const mine = ranked.find((e) => e.id === pid);
  return mine ? { place: mine.place, total: ranked.length } : null;
}

/** Капитан, от которого так долго нет сигнала, считается вышедшим. */
export const CAPTAIN_TIMEOUT_MS = 90_000;

/**
 * Если капитан команды вышел (нет его телефона или нет сигнала «на связи» дольше 90 с),
 * капитаном становится следующий по времени входа участник команды.
 * Возвращает команды, которым нужен новый капитан: teamId → uid.
 */
export function captainChanges(participants: Participant[], now: number): Record<string, string> {
  const changes: Record<string, string> = {};
  const phones = participants.filter((p) => p.kind === "player");
  for (const team of participants.filter((p) => p.kind === "team")) {
    const members = phones
      .filter((p) => p.teamId === team.id)
      .sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0) || a.id.localeCompare(b.id));
    if (members.length === 0) continue;
    const captain = members.find((m) => m.id === team.captainUid);
    const lastSeen = captain ? (captain.seenAt ?? captain.joinedAt ?? null) : null;
    // Время входа ещё не подтвердил сервер — ждём.
    if (captain && lastSeen === null) continue;
    if (captain && lastSeen !== null && now - lastSeen < CAPTAIN_TIMEOUT_MS) continue;
    const start = captain ? members.indexOf(captain) : -1;
    // Следующий по кругу, кроме ушедшего капитана.
    const next = [...members.slice(start + 1), ...members.slice(0, Math.max(0, start))][0];
    if (next && next.id !== team.captainUid) changes[team.id] = next.id;
  }
  return changes;
}
