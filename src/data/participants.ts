import type { DocumentSnapshot } from "firebase/firestore";
import { asString } from "./convert";
import { lazySubscribe, loadFirestore } from "./firebase";
import type { Participant, Unsubscribe } from "./types";

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

/** Телефон гостя. id документа совпадает с uid, поэтому повторный вход не создаёт дубль. */
export async function getMyParticipant(sessionId: string, uid: string): Promise<Participant | null> {
  const { col, sdk } = await participantsCol(sessionId);
  return toParticipant(await sdk.getDoc(sdk.doc(col, uid)));
}

export async function joinAsPlayer(
  sessionId: string,
  uid: string,
  name: string,
  teamId: string | null,
): Promise<void> {
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
}

/** Создаёт команду; создатель становится капитаном. Возвращает id команды. */
export async function createTeam(sessionId: string, captainUid: string, name: string): Promise<string> {
  const { col, sdk } = await participantsCol(sessionId);
  const ref = await sdk.addDoc(col, {
    name,
    kind: "team",
    teamId: null,
    captainUid,
    joinedAt: sdk.serverTimestamp(),
  });
  return ref.id;
}

export async function listTeams(sessionId: string): Promise<Participant[]> {
  const { col, sdk } = await participantsCol(sessionId);
  const snap = await sdk.getDocs(sdk.query(col, sdk.where("kind", "==", "team")));
  return snap.docs
    .map(toParticipant)
    .filter((p): p is Participant => p !== null)
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

/** Только для пульта ведущего. */
export function watchParticipants(
  sessionId: string,
  onChange: (participants: Participant[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return lazySubscribe(async () => {
    const { col, sdk } = await participantsCol(sessionId);
    return sdk.onSnapshot(
      col,
      (snap) => onChange(snap.docs.map(toParticipant).filter((p): p is Participant => p !== null)),
      onError,
    );
  }, onError);
}
