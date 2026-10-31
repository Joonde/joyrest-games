/** Музыка на своём сервере: `/api/tracks/...` (CLAUDE.md, раздел 7, «Музыка»). */
import type { TracksRepository } from "../contracts";
import type { Track, TrackCategory, TrackLicense, TrackShareStatus } from "../types";
import { api, asRecord, asText, getImage, putAudio } from "./api";
import { parseTrackClip } from "../trackClip";

const CATEGORIES: TrackCategory[] = ["music", "lobby", "background", "contest", "board", "break", "award", "holiday"];
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
    clip: parseTrackClip(d.clip),
    folder: asText(d.folder),
  };
}

function folderLists(value: unknown): { mine: string[]; library: string[] } {
  const d = asRecord(value);
  const names = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);
  return { mine: names(d.mine), library: names(d.library) };
}

const list = (value: unknown) => (Array.isArray(value) ? value : []).map(parseTrack).filter((t) => t.id !== "");
const path = (id: string) => `/api/tracks/${encodeURIComponent(id)}`;

export const serverTracksRepository: TracksRepository = {
  async list() {
    const data = asRecord(await api("GET", "/api/tracks"));
    const u = asRecord(data.usage);
    const usage =
      typeof u.usedBytes === "number" && typeof u.limitBytes === "number" && u.limitBytes > 0
        ? { usedBytes: Math.max(0, u.usedBytes), limitBytes: u.limitBytes }
        : undefined;
    return { mine: list(data.mine), library: list(data.library), folders: folderLists(data.folders), usage };
  },
  async createFolder(scope, name) {
    return folderLists(await api("POST", "/api/track-folders", { scope, name }));
  },
  async renameFolder(scope, from, to) {
    return folderLists(await api("POST", "/api/track-folders/rename", { scope, from, to }));
  },
  async shareFolder(name) {
    const d = asRecord(await api("POST", "/api/track-folders/share", { name }));
    return typeof d.shared === "number" ? d.shared : 0;
  },
  async takeFolder(name) {
    return folderLists(await api("POST", "/api/track-folders/take", { name }));
  },
  async deleteFolder(scope, name) {
    return folderLists(await api("POST", "/api/track-folders/delete", { scope, name }));
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
