import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { firebaseConfig } from "./config";

// Локальная разработка против эмуляторов: VITE_USE_EMULATORS=true npm run dev
const useEmulators = import.meta.env.VITE_USE_EMULATORS === "true";

// Модуль внутренний для src/data/: компоненты его не импортируют.
export const app = initializeApp(
  useEmulators ? { ...firebaseConfig, projectId: "demo-joyrest" } : firebaseConfig,
);
export const auth = getAuth(app);

// Локальный кэш: после потери связи экран сразу показывает последнее состояние,
// а затем догоняет сервер.
export const db = initializeFirestore(app, {
  localCache: useEmulators
    ? memoryLocalCache()
    : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

if (useEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}
