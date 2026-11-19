import type { Session } from "../../src/data/types";

type PrivacySession = Pick<Session, "mechanic" | "gameSnapshot" | "playMode" | "state" | "leaderboard">;

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function wordsOf(round: Record<string, unknown>): string[] {
  return typeof round.answer === "string" ? round.answer.split("|").map((word) => word.trim()).filter(Boolean) : [];
}

/**
 * Персональный снимок «Гонки на выживание». Полный список остаётся только у пульта;
 * капитан получает своё слово текущего задания, остальные — лишь признак его наличия.
 */
export function survivalSessionFor<T extends PrivacySession>(session: T, uid: string | null, full = false): T {
  if (full || session.mechanic !== "survival") return session;
  const snapshot = record(session.gameSnapshot);
  const content = record(snapshot.content);
  if (!Array.isArray(content.rounds)) return session;

  const result = record(session.state.result);
  const roundIndex = typeof result.round === "number" && Number.isFinite(result.round) && result.round >= 0 ? Math.floor(result.round) : -1;
  const order = Array.isArray(result.order) ? result.order.filter((pid): pid is string => typeof pid === "string") : [];
  let ownPid: string | null = null;
  if (session.playMode === "solo" && uid && order.includes(uid)) ownPid = uid;
  if (session.playMode === "teams" && uid) {
    ownPid = Object.entries(session.leaderboard).find(([pid, entry]) => order.includes(pid) && entry.captainUid === uid)?.[0] ?? null;
  }
  const canReceiveWord = session.state.stage === "question" && result.phase === "play" && ownPid !== null;

  let changed = false;
  const rounds = content.rounds.map((raw, index) => {
    const round = record(raw);
    if (round.kind !== "task") return raw;
    const words = wordsOf(round);
    const hasWords = words.length > 0 || round.hasWords === true;
    let answer = "";
    if (canReceiveWord && index === roundIndex && ownPid && words.length > 0) {
      answer = words[order.indexOf(ownPid) % words.length] ?? "";
    }
    if (round.answer === answer && round.hasWords === hasWords) return raw;
    changed = true;
    return { ...round, answer, hasWords };
  });
  if (!changed) return session;
  return { ...session, gameSnapshot: { ...snapshot, content: { ...content, rounds } } };
}

/** Персонализация полного снимка внутри события SSE; обычные patch-события не изменяются. */
export function survivalEventFor(event: object, uid: string | null, full = false): object {
  const data = record(event);
  if (data.session === null) return { ...data, session: null };
  if (!isPrivacySession(data.session)) return event;
  return { ...data, session: survivalSessionFor(data.session, uid, full) };
}

function isPrivacySession(value: unknown): value is PrivacySession {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const session = value as Partial<PrivacySession>;
  return "mechanic" in session && "gameSnapshot" in session && "playMode" in session && "state" in session && "leaderboard" in session;
}
