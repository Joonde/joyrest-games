/** Строка участника в базе и её вид для браузера — общие для `live.ts` и командного лобби (`teamLobby.ts`). */
import type { Participant } from "../../src/data/types";

export interface ParticipantRow {
  id: string;
  name: string;
  kind: string;
  team_id: string | null;
  captain_uid: string;
  joined_at: Date | null;
  seen_at: Date | null;
  /** «Не хочу быть капитаном» (миграция 0050, командное лобби). */
  no_captain: boolean;
}

export const PARTICIPANT_COLUMNS = ["id", "name", "kind", "team_id", "captain_uid", "joined_at", "seen_at", "no_captain"];

export function participantOf(row: ParticipantRow): Participant {
  const participant: Participant = {
    id: row.id,
    name: row.name,
    kind: row.kind === "team" ? "team" : "player",
    teamId: row.team_id,
    captainUid: row.captain_uid,
    joinedAt: row.joined_at ? row.joined_at.getTime() : null,
    seenAt: row.seen_at ? row.seen_at.getTime() : null,
  };
  // Только отметившим: прежний вид участника для всех остальных не меняется.
  if (row.no_captain) participant.noCaptain = true;
  return participant;
}
