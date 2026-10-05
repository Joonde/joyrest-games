// Только используемые функции Firestore. Модуль грузится динамически (src/data/firebase.ts):
// именованный реэкспорт сохраняет tree-shaking, а `import("firebase/firestore")` целиком — нет.
// Новую функцию Firestore сначала добавьте сюда.
export {
  addDoc,
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  initializeFirestore,
  limit,
  memoryLocalCache,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
