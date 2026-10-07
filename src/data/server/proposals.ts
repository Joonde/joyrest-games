/** Предложения ведущих в библиотеку на своём сервере: `/api/proposals/...`. */
import type { ProposalsRepository } from "../contracts";
import type { LibraryProposal } from "../types";
import { api, asRecord, asText, newId } from "./api";

export function parseProposal(value: unknown): LibraryProposal {
  const d = asRecord(value);
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  return {
    id: asText(d.id),
    gameId: asText(d.gameId),
    hostId: asText(d.hostId),
    hostName: asText(d.hostName),
    title: asText(d.title),
    status: d.status === "accepted" || d.status === "rejected" ? d.status : "pending",
    reason: typeof d.reason === "string" ? d.reason : null,
    libraryGameId: typeof d.libraryGameId === "string" ? d.libraryGameId : null,
    createdAt: num(d.createdAt) ?? 0,
    decidedAt: num(d.decidedAt),
  };
}

async function list(path: string): Promise<LibraryProposal[]> {
  const data = await api("GET", path);
  return (Array.isArray(data) ? data : []).map(parseProposal).filter((p) => p.id !== "");
}

export const serverProposalsRepository: ProposalsRepository = {
  async propose(gameId) {
    return parseProposal(await api("POST", "/api/proposals", { id: newId(), gameId }));
  },
  listMine: () => list("/api/proposals?mine=1"),
  listPending: () => list("/api/proposals?status=pending"),
  async accept(proposalId) {
    return parseProposal(await api("POST", `/api/proposals/${encodeURIComponent(proposalId)}/accept`));
  },
  async reject(proposalId, reason) {
    return parseProposal(await api("POST", `/api/proposals/${encodeURIComponent(proposalId)}/reject`, { reason }));
  },
};
