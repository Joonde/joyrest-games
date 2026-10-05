import type { FirebaseApp } from "firebase/app";
import type { Auth } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import { firebaseConfig } from "./config";
import type { Unsubscribe } from "./types";

// Модуль внутренний для src/data/: компоненты его не импортируют.
// Firebase грузится динамически отдельными чанками: страница успевает показать
// каркас экрана, пока на медленном мобильном интернете качается SDK.

export type AuthSdk = typeof import("./sdk/auth");
export type FirestoreSdk = typeof import("./sdk/firestore");

// Локальная разработка против эмуляторов: VITE_USE_EMULATORS=true npm run dev
const useEmulators = import.meta.env.VITE_USE_EMULATORS === "true";

/** Запоминает удачную загрузку; после ошибки (оборвалась сеть) следующий вызов пробует снова. */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null;
  return () => {
    promise ??= load().catch((error: unknown) => {
      promise = null;
      throw error;
    });
    return promise;
  };
}

const loadApp = once(async (): Promise<FirebaseApp> => {
  const { initializeApp } = await import("firebase/app");
  return initializeApp(useEmulators ? { ...firebaseConfig, projectId: "demo-joyrest" } : firebaseConfig);
});

export const loadAuth = once(async (): Promise<{ auth: Auth; sdk: AuthSdk }> => {
  const [app, sdk] = await Promise.all([loadApp(), import("./sdk/auth")]);
  // initializeAuth без обработчика всплывающих окон: вход только по почте и анонимный,
  // так чанк авторизации заметно легче, чем с getAuth.
  const auth = sdk.initializeAuth(app, {
    persistence: [sdk.indexedDBLocalPersistence, sdk.browserLocalPersistence],
  });
  if (useEmulators) sdk.connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  return { auth, sdk };
});

export const loadFirestore = once(async (): Promise<{ db: Firestore; sdk: FirestoreSdk }> => {
  const [app, sdk] = await Promise.all([loadApp(), import("./sdk/firestore")]);
  const db = sdk.initializeFirestore(app, {
    // Медленные мобильные сети и прокси операторов рвут WebSocket-подобный канал:
    // SDK сам переключится на long polling, если потоковое соединение не работает.
    experimentalAutoDetectLongPolling: true,
    // Локальный кэш: после потери связи экран сразу показывает последнее состояние,
    // а затем догоняет сервер.
    localCache: useEmulators
      ? sdk.memoryLocalCache()
      : sdk.persistentLocalCache({ tabManager: sdk.persistentMultipleTabManager() }),
  });
  if (useEmulators) sdk.connectFirestoreEmulator(db, "127.0.0.1", 8080);
  return { db, sdk };
});

/** Начинает качать SDK заранее, параллельно с кодом экрана. */
export function preloadData(): void {
  void loadAuth().catch(() => undefined);
  void loadFirestore().catch(() => undefined);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Синхронная отписка для подписки, которая начнётся после загрузки SDK.
 * Если компонент ушёл раньше, подписка отменяется сразу после старта.
 */
export function lazySubscribe(start: () => Promise<Unsubscribe>, onError: (error: Error) => void): Unsubscribe {
  let unsubscribe: Unsubscribe | null = null;
  let cancelled = false;
  start()
    .then((stop) => {
      if (cancelled) stop();
      else unsubscribe = stop;
    })
    .catch((error: unknown) => {
      if (!cancelled) onError(asError(error));
    });
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}
