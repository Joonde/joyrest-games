// Только используемые функции Firebase Auth. Модуль грузится динамически (src/data/firebase.ts):
// именованный реэкспорт сохраняет tree-shaking, а `import("firebase/auth")` целиком — нет.
export {
  browserLocalPersistence,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
