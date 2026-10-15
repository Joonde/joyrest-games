/** Видео JoyRest на своём сервере: `/api/videos/...` (CLAUDE.md, раздел 7, «Видео JoyRest»). */
import type { VideosRepository } from "../contracts";
import type { LibraryVideo } from "../types";
import { api, ApiError, asRecord, asText, putFile } from "./api";

/**
 * Часть файла за один запрос. Меньше 2 МБ — столько Caddy пускает в любой запрос, поэтому загрузка видео работает
 * без особых правил прокси; обрыв связи стоит не больше одной части.
 */
export const VIDEO_CHUNK = 1536 * 1024;

export function parseVideo(value: unknown): LibraryVideo {
  const d = asRecord(value);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    id: asText(d.id),
    title: asText(d.title),
    folder: asText(d.folder),
    ownerId: asText(d.ownerId),
    ownerName: asText(d.ownerName),
    size: num(d.size) ?? 0,
    received: num(d.received) ?? 0,
    ready: d.ready === true,
    durationMs: num(d.durationMs),
    mime: typeof d.mime === "string" ? d.mime : null,
    createdAt: num(d.createdAt) ?? 0,
  };
}

function folderList(d: Record<string, unknown>): string[] {
  return (Array.isArray(d.folders) ? d.folders : []).filter((f): f is string => typeof f === "string" && f.trim() !== "");
}

const path = (id: string) => `/api/videos/${encodeURIComponent(id)}`;
const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    });
  });

/** Повторяемая ошибка (сеть, сервер перегружен) — пробуем ещё; остальные (нет прав, мало места) — сразу наверх. */
function retryable(error: unknown): boolean {
  return error instanceof ApiError && (error.code === "unavailable" || error.status === 0 || error.status >= 500) && error.status !== 507;
}

export const serverVideosRepository: VideosRepository = {
  async list() {
    const d = asRecord(await api("GET", "/api/videos"));
    const videos = (Array.isArray(d.videos) ? d.videos : []).map(parseVideo).filter((v) => v.id !== "");
    return { videos, usedBytes: typeof d.usedBytes === "number" ? d.usedBytes : 0, folders: folderList(d) };
  },
  async upload({ id, title, folder, file, durationMs }, onProgress, signal) {
    let video = parseVideo(await api("POST", "/api/videos", { id, title, folder, size: file.size, durationMs }));
    let failures = 0;
    while (!video.ready) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      onProgress?.(video.received, video.size);
      const from = video.received;
      try {
        // Сервер отвечает, сколько у него уже есть: часть не на своём месте он не пишет, просто называет, откуда слать.
        video = parseVideo(await putFile(`${path(id)}/chunk?offset=${from}`, file.slice(from, from + VIDEO_CHUNK), "application/octet-stream", {}, signal));
        failures = 0;
      } catch (error) {
        if (signal?.aborted) throw error;
        if (!retryable(error) || failures >= 30) throw error;
        failures += 1;
        await wait(Math.min(10_000, 1000 * 2 ** Math.min(failures, 4)), signal);
      }
    }
    onProgress?.(video.size, video.size);
    return video;
  },
  async update(id, patch) {
    return parseVideo(await api("PATCH", path(id), patch));
  },
  async remove(id) {
    await api("DELETE", path(id));
  },
  async createFolder(name) {
    return folderList(asRecord(await api("POST", "/api/video-folders", { name })));
  },
  async renameFolder(from, to) {
    return folderList(asRecord(await api("POST", "/api/video-folders/rename", { from, to })));
  },
  async deleteFolder(name) {
    return folderList(asRecord(await api("POST", "/api/video-folders/delete", { name })));
  },
  fileUrl(id) {
    return `${path(id)}/file`;
  },
};
