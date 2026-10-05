import type { DocumentSnapshot } from "firebase/firestore";
import type { ResultsRepository } from "./contracts";
import { asNumber, asRecord, asString, toMillis } from "./convert";
import { loadFirestore } from "./firebase";
import { parsePlayMode } from "./sessions";
import type { GameResult, ResultRow } from "./types";

function parseBoard(value: unknown): ResultRow[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const entry = asRecord(raw);
    const row: ResultRow = { name: asString(entry.name), score: asNumber(entry.score) };
    if (typeof entry.colorIndex === "number") row.colorIndex = entry.colorIndex;
    return row;
  });
}

function toResult(snap: DocumentSnapshot): GameResult | null {
  const data = snap.data();
  if (!data) return null;
  return {
    id: snap.id,
    hostId: asString(data.hostId),
    code: asString(data.code),
    gameTitle: asString(data.gameTitle),
    mechanic: typeof data.mechanic === "string" ? data.mechanic : null,
    themeId: asString(data.themeId, "joyrest"),
    playMode: parsePlayMode(data.playMode),
    playedAt: toMillis(data.playedAt),
    participantsCount: asNumber(data.participantsCount),
    board: parseBoard(data.board),
  };
}

/** Сколько прошедших игр показывает история. */
const HISTORY_LIMIT = 200;

export const resultsRepository: ResultsRepository = {
  async get(resultId) {
    const { db, sdk } = await loadFirestore();
    return toResult(await sdk.getDoc(sdk.doc(db, "results", resultId)));
  },

  async listByHost(hostId) {
    const { db, sdk } = await loadFirestore();
    const snap = await sdk.getDocs(
      sdk.query(sdk.collection(db, "results"), sdk.where("hostId", "==", hostId), sdk.limit(HISTORY_LIMIT)),
    );
    return snap.docs
      .map(toResult)
      .filter((r): r is GameResult => r !== null)
      .sort((a, b) => (b.playedAt ?? 0) - (a.playedAt ?? 0));
  },
};
