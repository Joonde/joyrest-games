import type { DocumentSnapshot } from "firebase/firestore";
import { asString } from "./convert";
import type { ParticipantsRepository } from "./contracts";
import { lazySubscribe, loadFirestore } from "./firebase";
import type { Participant } from "./types";

async function participantsCol(sessionId: string) {
  const { db, sdk } = await loadFirestore();
  return { col: sdk.collection(db, "sessions", sessionId, "participants"), sdk };
}

function toParticipant(snap: DocumentSnapshot): Participant | null {
  const data = snap.data();
  if (!data) return null;
  return {
    id: snap.id,
    name: asString(data.name),
    kind: data.kind === "team" ? "team" : "player",
    teamId: typeof data.teamId === "string" ? data.teamId : null,
    captainUid: asString(data.captainUid),
  };
}

export const participantsRepository: ParticipantsRepository = {
  /** Телефон гостя. id документа совпадает с uid, поэтому повторный вход не создаёт дубль. */
  async getMine(sessionId, uid) {
    const { col, sdk } = await participantsCol(sessionId);
    return toParticipant(await sdk.getDoc(sdk.doc(col, uid)));
  },

  async joinAsPlayer(sessionId, uid, name, teamId) {
    const { col, sdk } = await participantsCol(sessionId);
    const ref = sdk.doc(col, uid);
    const existing = await sdk.getDoc(ref);
    if (existing.exists()) {
      await sdk.updateDoc(ref, { name, teamId });
      return;
    }
    await sdk.setDoc(ref, {
      name,
      kind: "player",
      teamId,
      captainUid: uid,
      joinedAt: sdk.serverTimestamp(),
    });
  },

  async createTeam(sessionId, captainUid, name) {
    const { col, sdk } = await participantsCol(sessionId);
    const ref = await sdk.addDoc(col, {
      name,
      kind: "team",
      teamId: null,
      captainUid,
      joinedAt: sdk.serverTimestamp(),
    });
    return ref.id;
  },

  async listTeams(sessionId) {
    const { col, sdk } = await participantsCol(sessionId);
    const snap = await sdk.getDocs(sdk.query(col, sdk.where("kind", "==", "team")));
    return snap.docs
      .map(toParticipant)
      .filter((p): p is Participant => p !== null)
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  },

  watch(sessionId, onChange, onError) {
    return lazySubscribe(async () => {
      const { col, sdk } = await participantsCol(sessionId);
      return sdk.onSnapshot(
        col,
        (snap) => onChange(snap.docs.map(toParticipant).filter((p): p is Participant => p !== null)),
        onError,
      );
    }, onError);
  },
};
