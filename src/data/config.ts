/**
 * Конфигурация веб-приложения Firebase не является секретом: она попадает в браузер
 * каждого гостя. Доступ к данным защищают правила firestore.rules.
 */
export const firebaseConfig = {
  apiKey: "AIzaSyBo_o6wlzKwLpZDsk5CXrWRpa5au-gSEEU",
  authDomain: "joyrest-games.firebaseapp.com",
  projectId: "joyrest-games",
  storageBucket: "joyrest-games.firebasestorage.app",
  messagingSenderId: "1030164162943",
  appId: "1:1030164162943:web:be9deae1cb442b09b6124a",
};

/** Владелец агентства. Тот же UID зашит в firestore.rules. */
export const ADMIN_UID = "bmBFBi7VmqVl7oIVyntw0QYRTYJ2";
