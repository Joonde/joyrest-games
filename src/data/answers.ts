import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  type DocumentSnapshot,
} from "firebase/firestore";
import { asNumber, asString, toMillis } from "./convert";
import { db } from "./firebase";
import type { Answer, Unsubscribe } from "./types";

function answersCol(sessionId: string) {
  return collection(db, "sessions", sessionId, "answers");
}

export function answerId(step: number, pid: string): string {
  return `${step}_${pid}`;
}

function toAnswer(snap: DocumentSnapshot): Answer | null {
  const data = snap.data();
  if (!data) return null;
  return {
    id: snap.id,
    step: asNumber(data.step),
    pid: asString(data.pid),
    uid: asString(data.uid),
    value: data.value ?? null,
    submittedAt: toMillis(data.submittedAt),
  };
}

export type SubmitResult = "sent" | "rejected";

/**
 * Ответ участника. Id детерминирован (`step_pid`), а правила запрещают перезапись,
 * поэтому повторное нажатие ничего не меняет и возвращает "rejected".
 */
export async function submitAnswer(
  sessionId: string,
  step: number,
  pid: string,
  uid: string,
  value: unknown,
): Promise<SubmitResult> {
  try {
    await setDoc(doc(answersCol(sessionId), answerId(step, pid)), {
      step,
      pid,
      uid,
      value,
      submittedAt: serverTimestamp(),
    });
    return "sent";
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "permission-denied") {
      return "rejected";
    }
    throw error;
  }
}

/** Только для пульта ведущего: ответы на текущий шаг. */
export function watchAnswers(
  sessionId: string,
  step: number,
  onChange: (answers: Answer[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(answersCol(sessionId), where("step", "==", step)),
    (snap) => onChange(snap.docs.map(toAnswer).filter((a): a is Answer => a !== null)),
    onError,
  );
}
