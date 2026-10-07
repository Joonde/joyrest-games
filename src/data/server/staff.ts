/** Квалификация, стаж и баллы ведущих на своём сервере (только admin). */
import type { StaffRepository } from "../contracts";
import type { PointsEntry } from "../types";
import { api, asRecord, asText, newId } from "./api";

function parseEntry(value: unknown): PointsEntry {
  const d = asRecord(value);
  return {
    id: asText(d.id),
    points: typeof d.points === "number" ? d.points : 0,
    kind: d.kind === "game" ? "game" : "manual",
    reason: asText(d.reason),
    createdAt: typeof d.createdAt === "number" ? d.createdAt : 0,
  };
}

const base = (uid: string) => `/api/users/${encodeURIComponent(uid)}`;

export const serverStaffRepository: StaffRepository = {
  async setLevel(uid, level, experienceSince) {
    await api("POST", `${base(uid)}/level`, { level, experienceSince });
  },
  async listPoints(uid) {
    const data = asRecord(await api("GET", `${base(uid)}/points`));
    return {
      total: typeof data.total === "number" ? data.total : 0,
      items: (Array.isArray(data.items) ? data.items : []).map(parseEntry),
    };
  },
  async addPoints(uid, points, reason) {
    await api("POST", `${base(uid)}/points`, { id: newId(), points, reason });
  },
};
