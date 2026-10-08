import type { Participant, PlayMode } from "../../data";

/** Сколько тестовых участников нужно на репетиции: игры по очереди команд без них не начать. */
const NEED: Record<string, number> = { checkers: 2, dance: 3, quest: 3, millionaire: 3, survival: 3, dragon: 3 };

const TEAMS = ["🦊 Лисы", "🐻 Медведи", "🦉 Совы"];
const PLAYERS = ["🦊 Аня", "🐻 Боря", "🦉 Вика"];

/** Тестовые команды (или игроки) репетиции — только в памяти, без телефонов. */
export function rehearsalParticipants(mechanic: string, playMode: PlayMode): Participant[] {
  const n = NEED[mechanic] ?? 0;
  const names = playMode === "teams" ? TEAMS : PLAYERS;
  return names.slice(0, n).map((name, i) => ({
    id: `rehearsal-${i + 1}`,
    name,
    kind: playMode === "teams" ? "team" : "player",
    teamId: null,
    captainUid: `rehearsal-${i + 1}`,
    joinedAt: i + 1,
  }));
}
