import type { DocumentSnapshot } from "firebase/firestore";
import { asNumber, asString, toMillis } from "./convert";
import type { AnswersRepository } from "./contracts";
import { lazySubscribe, loadFirestore } from "./firebase";
import type { Answer } from "./types";

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

export const answersRepository: AnswersRepository = {
  /**
   * Ответ участника. Id детерминирован (`step_pid`), а правила запрещают перезапись,
   * поэтому повторное нажатие ничего не меняет и возвращает "rejected".
   */
  async submit(sessionId, step, pid, uid, value) {
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
  },

  async getOwn(sessionId, step, pid) {
    const { db, sdk } = await loadFirestore();
    try {
      return toAnswer(await sdk.getDoc(sdk.doc(db, "sessions", sessionId, "answers", answerId(step, pid))));
    } catch (error) {
      // Ответа нет: правила не пускают читать несуществующий документ чужой команды.
      if (typeof error === "object" && error !== null && "code" in error && error.code === "permission-denied") {
        return null;
      }
      throw error;
    }
  },

  async clearStep(sessionId, step) {
    const { db, sdk } = await loadFirestore();
    const col = sdk.collection(db, "sessions", sessionId, "answers");
    const snap = await sdk.getDocs(sdk.query(col, sdk.where("step", "==", step)));
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = sdk.writeBatch(db);
      snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  },

  watch(sessionId, step, onChange, onError) {
    return lazySubscribe(async () => {
      const { db, sdk } = await loadFirestore();
      return sdk.onSnapshot(
        sdk.query(sdk.collection(db, "sessions", sessionId, "answers"), sdk.where("step", "==", step)),
        (snap) => onChange(snap.docs.map(toAnswer).filter((a): a is Answer => a !== null)),
        onError,
      );
    }, onError);
  },
};
