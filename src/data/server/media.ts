/**
 * Картинки игр на своём сервере: `/api/media/:game/:id/:variant`. Сжимает устройство ведущего
 * (оба варианта сразу), сервер хранит файлы как есть. id картинки выдаётся сразу, без сети:
 * вопрос ссылается на картинку ещё до отправки, а отправка повторяется, пока не дойдёт.
 */
import { fitSize } from "../../core/image";
import type { MediaRepository } from "../contracts";
import { withRetry } from "../retry";
import type { MediaVariant } from "../types";
import { api, getImage, newId, putImage } from "./api";

/** Уменьшенная копия вписывается в 480 px (как у Firebase-версии). */
const SMALL_MAX_SIDE = 480;

const url = (gameId: string, mediaId: string, variant: MediaVariant) =>
  `/api/media/${encodeURIComponent(gameId)}/${encodeURIComponent(mediaId)}/${variant}`;

/** Готовые картинки в памяти вкладки: экран не качает одну картинку дважды. */
const cache = new Map<string, Promise<Blob | null>>();

export const serverMediaRepository: MediaRepository = {
  upload(gameId, image) {
    const mediaId = newId();
    cache.set(url(gameId, mediaId, "full"), Promise.resolve(image.full));
    cache.set(url(gameId, mediaId, "small"), Promise.resolve(image.small));
    const small = fitSize(image.width, image.height, SMALL_MAX_SIDE);
    // Повтор безопасен: та же картинка под тем же id сервер принимает ещё раз как успех.
    const saved = withRetry(async () => {
      await putImage(url(gameId, mediaId, "full"), image.full, image.width, image.height);
      await putImage(url(gameId, mediaId, "small"), image.small, small.width, small.height);
    });
    return { mediaId, saved };
  },

  load(gameId, mediaId, variant) {
    const key = url(gameId, mediaId, variant);
    let promise = cache.get(key);
    if (!promise) {
      promise = getImage(key);
      // Ошибку сети не запоминаем: следующий показ попробует снова.
      promise.catch(() => cache.delete(key));
      cache.set(key, promise);
    }
    return promise;
  },

  async remove(gameId, mediaId) {
    cache.delete(url(gameId, mediaId, "full"));
    cache.delete(url(gameId, mediaId, "small"));
    await api("DELETE", `/api/media/${encodeURIComponent(gameId)}/${encodeURIComponent(mediaId)}`);
  },
};
