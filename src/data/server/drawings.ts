/** Рисунки гостей «Аквариума и Ёлки» на своём сервере: `PUT /api/sessions/:id/drawings`, файл — `/api/drawings/:sha`. */
import type { DrawingsRepository } from "../contracts";
import { asRecord, asText, putFile } from "./api";

export const serverDrawingsRepository: DrawingsRepository = {
  async upload(sessionId, image) {
    const type = image.type === "image/jpeg" ? "image/jpeg" : "image/webp";
    const sha = asText(asRecord(await putFile(`/api/sessions/${encodeURIComponent(sessionId)}/drawings`, image, type)).sha);
    if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error("invalid-argument");
    return sha;
  },
  url(sha) {
    return `/api/drawings/${sha}`;
  },
};
