/** Конец игры на своём сервере: `/api/finale`, `/api/reviews`, `/api/me/tips`. */
import type { FinaleRepository } from "../contracts";
import type { Finale, GuestReview, ReviewStatus } from "../types";
import { api, asRecord, asText } from "./api";

const STATUSES: ReviewStatus[] = ["new", "published", "hidden"];

function parseFinale(value: unknown, sessionId: string): Finale {
  const d = asRecord(value);
  const mine = d.myReview === null || d.myReview === undefined ? null : asRecord(d.myReview);
  return {
    sessionId,
    hostName: asText(d.hostName),
    gameTitle: asText(d.gameTitle),
    tipsUrl: asText(d.tipsUrl),
    myReview: mine ? { rating: typeof mine.rating === "number" ? mine.rating : 5, text: asText(mine.text), name: asText(mine.name) } : null,
  };
}

function parseReview(value: unknown): GuestReview {
  const d = asRecord(value);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    id: asText(d.id),
    sessionId: asText(d.sessionId),
    hostId: asText(d.hostId),
    hostName: asText(d.hostName),
    gameTitle: asText(d.gameTitle),
    playedAt: num(d.playedAt),
    rating: num(d.rating) ?? 5,
    text: asText(d.text),
    name: asText(d.name),
    status: STATUSES.includes(d.status as ReviewStatus) ? (d.status as ReviewStatus) : "new",
    createdAt: num(d.createdAt) ?? 0,
  };
}

export const serverFinaleRepository: FinaleRepository = {
  async get(sessionId) {
    return parseFinale(await api("GET", `/api/finale/${encodeURIComponent(sessionId)}`), sessionId);
  },
  async review(input) {
    await api("POST", "/api/reviews", input);
  },
  async listReviews() {
    const data = await api("GET", "/api/reviews");
    return (Array.isArray(data) ? data : []).map(parseReview).filter((r) => r.id !== "");
  },
  async setReviewStatus(id, status) {
    await api("POST", `/api/reviews/${encodeURIComponent(id)}/status`, { status });
  },
  async getTips() {
    return asText(asRecord(await api("GET", "/api/me/tips")).url);
  },
  async setTips(url) {
    return asText(asRecord(await api("POST", "/api/me/tips", { url })).url);
  },
};
