/**
 * Видео на устройстве экрана зала (танцы, караоке): файл хранится только в этом браузере (IndexedDB),
 * на сервер не уходит (CLAUDE.md, раздел 7). Ключ — id карточки игры: копия игры и запущенная
 * сессия находят то же видео.
 */
const DB = "joyrest-local";
const STORE = "videos";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no-idb"));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb"));
  });
}

async function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = body(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("idb"));
    });
  } finally {
    db.close();
  }
}

export interface LocalVideo {
  blob: Blob;
  name: string;
}

export async function saveLocalVideo(key: string, file: File): Promise<void> {
  await run("readwrite", (s) => s.put({ blob: file, name: file.name }, key));
}

export async function loadLocalVideo(key: string): Promise<LocalVideo | null> {
  try {
    const value = (await run("readonly", (s) => s.get(key))) as LocalVideo | undefined;
    return value && value.blob instanceof Blob ? value : null;
  } catch {
    return null;
  }
}

export async function removeLocalVideo(key: string): Promise<void> {
  await run("readwrite", (s) => s.delete(key)).catch(() => undefined);
}
