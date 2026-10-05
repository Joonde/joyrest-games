// Только используемые функции Firestore. Модуль грузится динамически (src/data/firebase.ts):
// именованный реэкспорт сохраняет tree-shaking, а `import("firebase/firestore")` целиком — нет.
// Новую функцию Firestore сначала добавьте сюда.
export {
  addDoc,
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getCountFromServer,
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
  writeBatch,
} from "firebase/firestore";
