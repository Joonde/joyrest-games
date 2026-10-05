import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type DocumentSnapshot,
} from "firebase/firestore";
import { generateSessionCode } from "../core/code";
import { asNumber, asRecord, asString, toMillis } from "./convert";
import { db } from "./firebase";
import type {
  Leaderboard,
  LeaderboardEntry,
  NewSessionOptions,
  PlayMode,
  ScreenMode,
  Session,
  SessionPhase,
  SessionState,
  Unsubscribe,
} from "./types";

const sessionsCol = collection(db, "sessions");

/** Сколько документов можно запросить по коду. Это же число ограничено в firestore.rules. */
const CODE_QUERY_LIMIT = 5;

function parsePhase(value: unknown): SessionPhase {
  return value === "playing" || value === "finished" ? value : "lobby";
}

function parsePlayMode(value: unknown): PlayMode {
  return value === "teams" ? "teams" : "solo";
}

function parseScreenMode(value: unknown): ScreenMode {
  return value === "remote" || value === "none" ? value : "laptop";
}

function parseLeaderboard(value: unknown): Leaderboard {
  const board: Leaderboard = {};
  for (const [id, raw] of Object.entries(asRecord(value))) {
    const entry = asRecord(raw);
    board[id] = {
      name: asString(entry.name),
      kind: entry.kind === "team" ? "team" : "player",
      score: asNumber(entry.score),
    };
    if (typeof entry.colorIndex === "number") board[id].colorIndex = entry.colorIndex;
  }
  return board;
}

function toSession(snap: DocumentSnapshot): Session | null {
  const data = snap.data();
  if (!data) return null;
  const state = asRecord(data.state);
  return {
    id: snap.id,
    code: asString(data.code),
    hostId: asString(data.hostId),
    mechanic: typeof data.mechanic === "string" ? data.mechanic : null,
    gameSnapshot: data.gameSnapshot ?? null,
    themeId: asString(data.themeId, "joyrest"),
    playMode: parsePlayMode(data.playMode),
    screenMode: parseScreenMode(data.screenMode),
    state: {
      phase: parsePhase(state.phase),
      step: asNumber(state.step),
      startedAt: toMillis(state.startedAt),
      revealed: state.revealed === true,
    },
    leaderboard: parseLeaderboard(data.leaderboard),
    createdAt: toMillis(data.createdAt),
  };
}

async function sessionsByCode(code: string): Promise<Session[]> {
  const snap = await getDocs(query(sessionsCol, where("code", "==", code), limit(CODE_QUERY_LIMIT)));
  return snap.docs.map(toSession).filter((s): s is Session => s !== null);
}

/** Создаёт сессию с уникальным среди незавершённых сессий кодом. */
export async function createSession(
  hostId: string,
  options: NewSessionOptions,
): Promise<{ id: string; code: string }> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateSessionCode();
    const existing = await sessionsByCode(code);
    if (existing.some((s) => s.state.phase !== "finished")) continue;
    const initialState = { phase: "lobby", step: 0, startedAt: null, revealed: false };
    const ref = await addDoc(sessionsCol, {
      code,
      hostId,
      mechanic: options.mechanic,
      gameSnapshot: options.gameSnapshot,
      themeId: options.themeId,
      playMode: options.playMode,
      screenMode: options.screenMode,
      state: initialState,
      leaderboard: {},
      createdAt: serverTimestamp(),
    });
    return { id: ref.id, code };
  }
  throw new Error("Не удалось подобрать свободный код сессии");
}

/** Актуальная сессия по коду: незавершённая, а если таких нет — самая свежая. */
export async function findSessionByCode(code: string): Promise<Session | null> {
  const sessions = await sessionsByCode(code);
  const newestFirst = [...sessions].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return newestFirst.find((s) => s.state.phase !== "finished") ?? newestFirst[0] ?? null;
}

/** Подписка на документ сессии — единственное, что слушают гости и экран зала. */
export function watchSession(
  sessionId: string,
  onChange: (session: Session | null) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(doc(db, "sessions", sessionId), (snap) => onChange(toSession(snap)), onError);
}

/** Сессии ведущего, новые сверху. */
export async function listHostSessions(hostId: string): Promise<Session[]> {
  const snap = await getDocs(query(sessionsCol, where("hostId", "==", hostId), limit(50)));
  return snap.docs
    .map(toSession)
    .filter((s): s is Session => s !== null)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/** Смена фазы с пульта. Время начала шага ставит сервер. */
export async function setSessionPhase(sessionId: string, phase: SessionPhase): Promise<void> {
  const patch: Partial<Record<`state.${keyof SessionState}`, unknown>> = { "state.phase": phase };
  if (phase === "playing") {
    patch["state.step"] = 0;
    patch["state.startedAt"] = serverTimestamp();
    patch["state.revealed"] = false;
  }
  await updateDoc(doc(db, "sessions", sessionId), patch);
}

/** Точечно добавляет записи таблицы лидеров, не перезаписывая чужие. */
export async function upsertLeaderboardEntries(
  sessionId: string,
  entries: Record<string, LeaderboardEntry>,
): Promise<void> {
  const patch: Record<string, LeaderboardEntry> = {};
  for (const [id, entry] of Object.entries(entries)) {
    patch[`leaderboard.${id}`] = entry;
  }
  if (Object.keys(patch).length === 0) return;
  await updateDoc(doc(db, "sessions", sessionId), patch);
}
