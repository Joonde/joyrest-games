import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentSnapshot,
} from "firebase/firestore";
import { asString } from "./convert";
import { db } from "./firebase";
import type { Participant, Unsubscribe } from "./types";

function participantsCol(sessionId: string) {
  return collection(db, "sessions", sessionId, "participants");
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
  return toParticipant(await getDoc(doc(participantsCol(sessionId), uid)));
}

export async function joinAsPlayer(
  sessionId: string,
  uid: string,
  name: string,
  teamId: string | null,
): Promise<void> {
  const ref = doc(participantsCol(sessionId), uid);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    await updateDoc(ref, { name, teamId });
    return;
  }
  await setDoc(ref, {
    name,
    kind: "player",
    teamId,
    captainUid: uid,
    joinedAt: serverTimestamp(),
  });
}

/** Создаёт команду; создатель становится капитаном. Возвращает id команды. */
export async function createTeam(sessionId: string, captainUid: string, name: string): Promise<string> {
  const ref = await addDoc(participantsCol(sessionId), {
    name,
    kind: "team",
    teamId: null,
    captainUid,
    joinedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function listTeams(sessionId: string): Promise<Participant[]> {
  const snap = await getDocs(query(participantsCol(sessionId), where("kind", "==", "team")));
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
  return onSnapshot(
    participantsCol(sessionId),
    (snap) => onChange(snap.docs.map(toParticipant).filter((p): p is Participant => p !== null)),
    onError,
  );
}
