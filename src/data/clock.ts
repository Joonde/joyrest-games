import type { ClockService } from "./contracts";
import { loadAuth, loadFirestore } from "./firebase";
import { toMillis } from "./convert";

// Смещение часов устройства относительно сервера: одна запись clock/{uid} с serverTimestamp
// и одно чтение с сервера. Время сервера ≈ середина между отправкой и ответом.

let measured = 0;
let pending: Promise<number> | null = null;

async function measure(): Promise<number> {
  const [{ auth }, { db, sdk }] = await Promise.all([loadAuth(), loadFirestore()]);
  const uid = auth.currentUser?.uid;
  if (!uid) return 0;
  const ref = sdk.doc(db, "clock", uid);
  const sent = Date.now();
  await sdk.setDoc(ref, { t: sdk.serverTimestamp() });
  const acked = Date.now();
  const server = toMillis((await sdk.getDocFromServer(ref)).data()?.t);
  if (server === null) return 0;
  return server - (sent + acked) / 2;
}

export const clockService: ClockService = {
  offset: () => measured,
  sync() {
    pending ??= measure()
      .then((value) => {
        measured = value;
        return value;
      })
      .catch(() => {
        // Нет связи: таймер идёт по часам устройства, повторим при следующем вызове.
        pending = null;
        return measured;
      });
    return pending;
  },
};
