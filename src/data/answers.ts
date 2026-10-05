import type { DocumentSnapshot } from "firebase/firestore";
import { asNumber, asString, toMillis } from "./convert";
import { lazySubscribe, loadFirestore } from "./firebase";
import type { Answer, Unsubscribe } from "./types";

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
  const { db, sdk } = await loadFirestore();
  try {
    await sdk.setDoc(sdk.doc(db, "sessions", sessionId, "answers", answerId(step, pid)), {
      step,
      pid,
      uid,
      value,
      submittedAt: sdk.serverTimestamp(),
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
  return lazySubscribe(async () => {
    const { db, sdk } = await loadFirestore();
    return sdk.onSnapshot(
      sdk.query(sdk.collection(db, "sessions", sessionId, "answers"), sdk.where("step", "==", step)),
      (snap) => onChange(snap.docs.map(toAnswer).filter((a): a is Answer => a !== null)),
      onError,
    );
  }, onError);
}
