import type { DocumentSnapshot } from "firebase/firestore";
import type { MediaRepository } from "./contracts";
import { asString } from "./convert";
import { loadFirestore, type FirestoreSdk } from "./firebase";
import type { MediaUpload, MediaVariant } from "./types";

// Картинка — два документа в games/{gameId}/media: `{mediaId}` (для экрана зала) и
// `{mediaId}-small` (для телефонов в режиме «без экрана»). Документ игры и снимок сессии
// хранят только mediaId, поэтому гости и пульт не качают картинки вместе с игрой.

const SMALL_SUFFIX = "-small";

export function mediaDocId(mediaId: string, variant: MediaVariant): string {
  return variant === "small" ? mediaId + SMALL_SUFFIX : mediaId;
}

/** Готовые картинки в памяти вкладки: экран зала не качает одну картинку дважды. */
const cache = new Map<string, Promise<Blob | null>>();

function cacheKey(gameId: string, mediaId: string, variant: MediaVariant): string {
  return `${gameId}/${mediaDocId(mediaId, variant)}`;
}

interface BytesLike {
  toUint8Array(): Uint8Array;
}

function isBytes(value: unknown): value is BytesLike {
  return typeof value === "object" && value !== null && typeof (value as BytesLike).toUint8Array === "function";
}

function toBlob(snap: DocumentSnapshot): Blob | null {
  const data = snap.data();
  if (!data || !isBytes(data.bytes)) return null;
  // Копия в обычный ArrayBuffer: Blob не принимает представления общих буферов.
  const bytes = new Uint8Array(data.bytes.toUint8Array());
  return new Blob([bytes], { type: asString(data.mime, "image/webp") });
}

/** Поля документа картинки; тот же набор проверяет firestore.rules. */
export async function mediaData(sdk: FirestoreSdk, blob: Blob, variant: MediaVariant, width: number, height: number) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    bytes: sdk.Bytes.fromUint8Array(bytes),
    mime: blob.type === "image/jpeg" ? "image/jpeg" : "image/webp",
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    variant,
    createdAt: sdk.serverTimestamp(),
  };
}

/** Уменьшенная копия вписывается в 480 px: пропорции те же, что у полной. */
export const SMALL_MAX_SIDE = 480;

function smallSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, SMALL_MAX_SIDE / Math.max(width, height));
  return { width: width * scale, height: height * scale };
}

export const mediaRepository: MediaRepository = {
  upload(gameId, image: MediaUpload) {
    // id выдаётся сразу, без сети: вопрос ссылается на картинку ещё до отправки.
    const mediaId = randomId();
    cache.set(cacheKey(gameId, mediaId, "full"), Promise.resolve(image.full));
    cache.set(cacheKey(gameId, mediaId, "small"), Promise.resolve(image.small));
    const saved = (async () => {
      const { db, sdk } = await loadFirestore();
      const col = sdk.collection(db, "games", gameId, "media");
      const small = smallSize(image.width, image.height);
      const batch = sdk.writeBatch(db);
      batch.set(sdk.doc(col, mediaDocId(mediaId, "full")), await mediaData(sdk, image.full, "full", image.width, image.height));
      batch.set(sdk.doc(col, mediaDocId(mediaId, "small")), await mediaData(sdk, image.small, "small", small.width, small.height));
      await batch.commit();
    })();
    return { mediaId, saved };
  },

  load(gameId, mediaId, variant) {
    const key = cacheKey(gameId, mediaId, variant);
    let promise = cache.get(key);
    if (!promise) {
      promise = (async () => {
        const { db, sdk } = await loadFirestore();
        return toBlob(await sdk.getDoc(sdk.doc(db, "games", gameId, "media", mediaDocId(mediaId, variant))));
      })();
      // Ошибку сети не запоминаем: следующий показ попробует снова.
      promise.catch(() => cache.delete(key));
      cache.set(key, promise);
    }
    return promise;
  },

  async remove(gameId, mediaId) {
    cache.delete(cacheKey(gameId, mediaId, "full"));
    cache.delete(cacheKey(gameId, mediaId, "small"));
    const { db, sdk } = await loadFirestore();
    const batch = sdk.writeBatch(db);
    batch.delete(sdk.doc(db, "games", gameId, "media", mediaDocId(mediaId, "full")));
    batch.delete(sdk.doc(db, "games", gameId, "media", mediaDocId(mediaId, "small")));
    await batch.commit();
  },
};

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** 20 случайных символов, как у автоматических id Firestore: id картинки не угадать. */
function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
}
