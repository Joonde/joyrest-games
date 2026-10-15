/** Фотоотчёт мероприятия на своём сервере: `/api/sessions/:id/photos`, `/api/photos`. */
import type { EventPhotosRepository } from "../contracts";
import type { EventPhoto } from "../types";
import { api, asRecord, asText, putFile } from "./api";

function parsePhoto(value: unknown): EventPhoto {
  const d = asRecord(value);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    sessionId: asText(d.sessionId),
    slot: num(d.slot) ?? 1,
    hostId: asText(d.hostId),
    hostName: asText(d.hostName),
    gameTitle: asText(d.gameTitle),
    playedAt: num(d.playedAt),
    width: num(d.width),
    height: num(d.height),
    createdAt: num(d.createdAt) ?? 0,
    url: asText(d.url),
  };
}

const list = (data: unknown) => (Array.isArray(data) ? data : []).map(parsePhoto).filter((p) => p.sessionId !== "" && p.url !== "");
const path = (sessionId: string) => `/api/sessions/${encodeURIComponent(sessionId)}/photos`;

export const serverEventPhotosRepository: EventPhotosRepository = {
  async list(sessionId) {
    return list(await api("GET", path(sessionId)));
  },
  async save(sessionId, slot, image, width, height) {
    const type = image.type === "image/jpeg" ? "image/jpeg" : "image/webp";
    return parsePhoto(
      await putFile(`${path(sessionId)}/${slot}`, image, type, { "X-Width": String(Math.round(width)), "X-Height": String(Math.round(height)) }),
    );
  },
  async remove(sessionId, slot) {
    await api("DELETE", `${path(sessionId)}/${slot}`);
  },
  async all() {
    return list(await api("GET", "/api/photos"));
  },
};
