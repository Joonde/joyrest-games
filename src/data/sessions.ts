import type { CollectionReference, DocumentSnapshot } from "firebase/firestore";
import { generateSessionCode } from "../core/code";
import { compactBoard } from "../core/results";
import type { SessionsRepository } from "./contracts";
import { asNumber, asRecord, asString, toMillis } from "./convert";
import { reportFromCache } from "./connection";
import { parseCue } from "./cues";
import { lazySubscribe, loadFirestore, type FirestoreSdk } from "./firebase";
import type {
  Leaderboard,
  LeaderboardEntry,
  PlayMode,
  ScreenMode,
  Session,
  SessionPhase,
  SessionState,
  StepStage,
} from "./types";

async function sessionsCol() {
  const { db, sdk } = await loadFirestore();
  return { col: sdk.collection(db, "sessions"), sdk };
}

/** Сколько документов можно запросить по коду. Это же число ограничено в firestore.rules. */
const CODE_QUERY_LIMIT = 5;

function parseStage(value: unknown, revealed: boolean): StepStage {
  if (value === "ready" || value === "question" || value === "reveal" || value === "board" || value === "podium") return value;
  return revealed ? "reveal" : "ready";
}

function parsePhase(value: unknown): SessionPhase {
  return value === "playing" || value === "finished" ? value : "lobby";
}

export function parsePlayMode(value: unknown): PlayMode {
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
    if (typeof entry.last === "number") board[id].last = entry.last;
    if (typeof entry.captainUid === "string") board[id].captainUid = entry.captainUid;
    if (typeof entry.roundBase === "number") board[id].roundBase = entry.roundBase;
    if (typeof entry.move === "number") board[id].move = entry.move;
  }
  return board;
}

function toSession(snap: DocumentSnapshot, timestamps: "estimate" | "none" = "none"): Session | null {
  const data = snap.data({ serverTimestamps: timestamps });
  if (!data) return null;
  const state = asRecord(data.state);
  return {
    id: snap.id,
    code: asString(data.code),
    hostId: asString(data.hostId),
    gameId: typeof data.gameId === "string" ? data.gameId : null,
    gameTitle: asString(data.gameTitle),
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
      stage: parseStage(state.stage, state.revealed === true),
      timeLimit: typeof state.timeLimit === "number" ? state.timeLimit : null,
      answered: asNumber(state.answered),
      result: state.result ?? null,
      cue: parseCue(state.cue),
    },
    leaderboard: parseLeaderboard(data.leaderboard),
    createdAt: toMillis(data.createdAt),
  };
}

/**
 * Фазы, в которых сессию можно найти по коду. Завершённую игру по коду не найти:
 * её видят только ведущий (по своим сессиям) и admin. Тот же список — в firestore.rules.
 */
export const ACTIVE_PHASES: SessionPhase[] = ["lobby", "playing"];

/** Незавершённые сессии с этим кодом (правила пропускают только такой запрос). */
async function activeSessionsByCode(code: string): Promise<Session[]> {
  const { col, sdk } = await sessionsCol();
  const snap = await sdk.getDocs(
    sdk.query(
      col,
      sdk.where("code", "==", code),
      sdk.where("state.phase", "in", ACTIVE_PHASES),
      sdk.limit(CODE_QUERY_LIMIT),
    ),
  );
  return snap.docs.map((d) => toSession(d)).filter((s): s is Session => s !== null);
}

function newestFirst(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/** Компактные итоги сессии для results/{sessionId}. */
function resultData(sdk: FirestoreSdk, session: Session, participantsCount: number) {
  return {
    hostId: session.hostId,
    code: session.code,
    gameTitle: session.gameTitle,
    mechanic: session.mechanic,
    themeId: session.themeId,
    playMode: session.playMode,
    playedAt: session.createdAt !== null ? new Date(session.createdAt) : sdk.serverTimestamp(),
    participantsCount,
    board: compactBoard(session.leaderboard),
    savedAt: sdk.serverTimestamp(),
  };
}

/** Сколько старых сессий удаляется за один заход и сколько заходов за один вход admin. */
const CLEANUP_PAGE = 20;
const CLEANUP_ROUNDS = 5;
/** Пакет записи Firestore — не больше 500 операций. */
const BATCH_LIMIT = 400;

/** Удаляет все документы подколлекции пакетами. */
async function deleteAll(sdk: FirestoreSdk, col: CollectionReference): Promise<void> {
  for (;;) {
    const snap = await sdk.getDocs(sdk.query(col, sdk.limit(BATCH_LIMIT)));
    if (snap.empty) return;
    const batch = sdk.writeBatch(col.firestore);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < BATCH_LIMIT) return;
  }
}

export const sessionsRepository: SessionsRepository = {
  /** Код уникален среди незавершённых сессий. */
  async create(hostId, options) {
    const { col, sdk } = await sessionsCol();
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = generateSessionCode();
      if ((await activeSessionsByCode(code)).length > 0) continue;
      const initialState = { phase: "lobby", step: 0, startedAt: null, revealed: false };
      const ref = await sdk.addDoc(col, {
        code,
        hostId,
        gameId: options.gameId,
        gameTitle: options.gameTitle,
        mechanic: options.mechanic,
        gameSnapshot: options.gameSnapshot,
        themeId: options.themeId,
        playMode: options.playMode,
        screenMode: options.screenMode,
        state: initialState,
        leaderboard: {},
        createdAt: sdk.serverTimestamp(),
      });
      return { id: ref.id, code };
    }
    throw new Error("Не удалось подобрать свободный код сессии");
  },

  /** Незавершённая сессия по коду (самая свежая, если их вдруг несколько). */
  async findByCode(code) {
    return newestFirst(await activeSessionsByCode(code))[0] ?? null;
  },

  /** Для пульта: своя сессия с этим кодом, в том числе завершённая. */
  async findHostSessionByCode(code, hostId) {
    const { col, sdk } = await sessionsCol();
    const snap = await sdk.getDocs(
      sdk.query(col, sdk.where("code", "==", code), sdk.where("hostId", "==", hostId), sdk.limit(CODE_QUERY_LIMIT)),
    );
    const sessions = newestFirst(snap.docs.map((d) => toSession(d)).filter((s): s is Session => s !== null));
    return sessions.find((s) => s.state.phase !== "finished") ?? sessions[0] ?? null;
  },

  async get(sessionId) {
    const { col, sdk } = await sessionsCol();
    return toSession(await sdk.getDoc(sdk.doc(col, sessionId)));
  },

  watch(sessionId, onChange, onError) {
    return lazySubscribe(async () => {
      const { col, sdk } = await sessionsCol();
      // serverTimestamps: "estimate" — пульт сразу видит своё время старта, не дожидаясь сервера.
      // Метаданные нужны, чтобы заметить обрыв связи (данные из кэша) и восстановление.
      let lastJson = "";
      return sdk.onSnapshot(
        sdk.doc(col, sessionId),
        { includeMetadataChanges: true },
        (snap) => {
          reportFromCache(snap.metadata.fromCache);
          const session = toSession(snap, "estimate");
          const json = JSON.stringify(session);
          if (json === lastJson) return;
          lastJson = json;
          onChange(session);
        },
        onError,
      );
    }, onError);
  },

  async listByHost(hostId) {
    const { col, sdk } = await sessionsCol();
    const snap = await sdk.getDocs(sdk.query(col, sdk.where("hostId", "==", hostId), sdk.limit(50)));
    return snap.docs
      .map((d) => toSession(d))
      .filter((s): s is Session => s !== null)
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  },

  /** Смена фазы с пульта. Время начала шага ставит сервер. */
  async setPhase(sessionId, phase) {
    const { col, sdk } = await sessionsCol();
    const patch: Partial<Record<`state.${keyof SessionState}`, unknown>> = { "state.phase": phase };
    if (phase === "playing") {
      patch["state.step"] = 0;
      patch["state.startedAt"] = null;
      patch["state.revealed"] = false;
      patch["state.stage"] = "ready";
      patch["state.timeLimit"] = null;
      patch["state.answered"] = 0;
      patch["state.result"] = null;
    }
    await sdk.updateDoc(sdk.doc(col, sessionId), patch);
  },

  /** Точечно добавляет записи таблицы лидеров, не перезаписывая чужие. */
  async upsertLeaderboard(sessionId, entries) {
    const patch: Record<string, LeaderboardEntry> = {};
    for (const [id, entry] of Object.entries(entries)) {
      patch[`leaderboard.${id}`] = entry;
    }
    if (Object.keys(patch).length === 0) return;
    const { col, sdk } = await sessionsCol();
    await sdk.updateDoc(sdk.doc(col, sessionId), patch);
  },

  async apply(sessionId, change) {
    const { col, sdk } = await sessionsCol();
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(change.state ?? {})) {
      patch[`state.${key}`] = key === "startedAt" && value === "server" ? sdk.serverTimestamp() : value;
    }
    for (const [pid, entry] of Object.entries(change.leaderboard ?? {})) {
      patch[`leaderboard.${pid}`] = entry === null ? sdk.deleteField() : entry;
    }
    if (Object.keys(patch).length === 0) return;
    await sdk.updateDoc(sdk.doc(col, sessionId), patch);
  },

  async finish(session, participantsCount) {
    const { db, sdk } = await loadFirestore();
    const batch = sdk.writeBatch(db);
    batch.update(sdk.doc(db, "sessions", session.id), { "state.phase": "finished" });
    batch.set(sdk.doc(db, "results", session.id), resultData(sdk, session, participantsCount));
    await batch.commit();
  },

  async removeExpired(cutoff) {
    const { db, sdk } = await loadFirestore();
    const col = sdk.collection(db, "sessions");
    let deleted = 0;
    for (let round = 0; round < CLEANUP_ROUNDS; round++) {
      const snap = await sdk.getDocs(
        sdk.query(col, sdk.where("createdAt", "<", new Date(cutoff)), sdk.limit(CLEANUP_PAGE)),
      );
      for (const docSnap of snap.docs) {
        const session = toSession(docSnap);
        if (!session) continue;
        const participants = sdk.collection(docSnap.ref, "participants");
        const resultRef = sdk.doc(db, "results", session.id);
        // Итоги завершённых игр уже в истории; незавершённую игру с участниками сохраняем как есть.
        if (Object.keys(session.leaderboard).length > 0 && !(await sdk.getDoc(resultRef)).exists()) {
          const count = await sdk.getCountFromServer(sdk.query(participants, sdk.where("kind", "==", "player")));
          await sdk.setDoc(resultRef, resultData(sdk, session, count.data().count));
        }
        await deleteAll(sdk, sdk.collection(docSnap.ref, "answers"));
        await deleteAll(sdk, participants);
        await sdk.deleteDoc(docSnap.ref);
        deleted++;
      }
      if (snap.size < CLEANUP_PAGE) return { deleted, more: false };
    }
    return { deleted, more: true };
  },
};
