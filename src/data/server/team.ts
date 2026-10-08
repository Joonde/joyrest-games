/** «Команда JoyRest» на своём сервере: `/api/team/...` (CLAUDE.md, раздел 3). */
import type { TeamRepository } from "../contracts";
import type { TeamMember } from "../types";
import { api, asRecord, asText, putImage } from "./api";

export function parseMember(value: unknown): TeamMember {
  const d = asRecord(value);
  return {
    uid: asText(d.uid),
    name: asText(d.name),
    bio: asText(d.bio),
    avatar: typeof d.avatar === "string" && d.avatar ? d.avatar : null,
    cover: typeof d.cover === "string" && d.cover ? d.cover : null,
    owner: d.owner === true,
    since: typeof d.since === "number" ? d.since : null,
    profession: typeof d.profession === "string" ? d.profession : "host",
  };
}

export const serverTeamRepository: TeamRepository = {
  async list() {
    const data = await api("GET", "/api/team");
    return (Array.isArray(data) ? data : []).map(parseMember).filter((m) => m.uid !== "");
  },
  async setBio(bio) {
    await api("POST", "/api/team/me", { bio });
  },
  async upload(kind, image, width, height) {
    await putImage(`/api/team/me/${kind}`, image, width, height);
  },
  async remove(kind) {
    await api("DELETE", `/api/team/me/${kind}`);
  },
  imageUrl(uid, kind, sha) {
    return `/api/team/${encodeURIComponent(uid)}/${kind}?v=${encodeURIComponent(sha)}`;
  },
};
