// Только используемые функции Firebase Auth. Модуль грузится динамически (src/data/firebase.ts):
// именованный реэкспорт сохраняет tree-shaking, а `import("firebase/auth")` целиком — нет.
export {
  browserLocalPersistence,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  inMemoryPersistence,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from "firebase/auth";
