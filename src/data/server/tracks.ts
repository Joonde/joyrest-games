/** Музыка на своём сервере: `/api/tracks/...` (CLAUDE.md, раздел 7, «Музыка»). */
import type { TracksRepository } from "../contracts";
import type { Track, TrackCategory, TrackLicense, TrackShareStatus } from "../types";
import { api, asRecord, asText, getImage, putAudio } from "./api";

const CATEGORIES: TrackCategory[] = ["lobby", "background", "contest", "board", "break", "award", "holiday"];
const LICENSES: TrackLicense[] = ["pixabay", "bought", "own", "other"];
const SHARE: TrackShareStatus[] = ["none", "pending", "accepted", "rejected"];

function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : fallback;
}

export function parseTrack(value: unknown): Track {
  const d = asRecord(value);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    id: asText(d.id),
    ownerId: asText(d.ownerId),
    ownerName: asText(d.ownerName),
    scope: d.scope === "agency" ? "agency" : "personal",
    title: asText(d.title),
    category: pick(d.category, CATEGORIES, "background"),
    license: pick(d.license, LICENSES, "other"),
    licenseNote: asText(d.licenseNote),
    ready: d.ready === true,
    size: num(d.size) ?? 0,
    durationMs: num(d.durationMs),
    shareStatus: pick(d.shareStatus, SHARE, "none"),
    shareReason: typeof d.shareReason === "string" ? d.shareReason : null,
    createdAt: num(d.createdAt) ?? 0,
  };
}

const list = (value: unknown) => (Array.isArray(value) ? value : []).map(parseTrack).filter((t) => t.id !== "");
const path = (id: string) => `/api/tracks/${encodeURIComponent(id)}`;

export const serverTracksRepository: TracksRepository = {
  async list() {
    const data = asRecord(await api("GET", "/api/tracks"));
    return { mine: list(data.mine), library: list(data.library) };
  },
  async listPending() {
    return list(await api("GET", "/api/tracks?status=pending"));
  },
  async create(input) {
    return parseTrack(await api("POST", "/api/tracks", input));
  },
  async upload(id, file, durationMs) {
    return parseTrack(await putAudio(`${path(id)}/file`, file, durationMs));
  },
  async update(id, patch) {
    return parseTrack(await api("PATCH", path(id), patch));
  },
  async remove(id) {
    await api("DELETE", path(id));
  },
  async share(id) {
    return parseTrack(await api("POST", `${path(id)}/share`));
  },
  async accept(id) {
    return parseTrack(await api("POST", `${path(id)}/accept`));
  },
  async reject(id, reason) {
    return parseTrack(await api("POST", `${path(id)}/reject`, { reason }));
  },
  async file(id) {
    return getImage(`${path(id)}/file`);
  },
  fileUrl(id) {
    return `${path(id)}/file`;
  },
};
