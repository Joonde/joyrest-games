/** Оформления заказчиков на своём сервере: `/api/brandings`, логотипы — `/api/brandings/logo` (`src/core/branding.ts`). */
import { brandLogoUrl, parseBranding } from "../../core/branding";
import type { BrandingsRepository } from "../contracts";
import type { SavedBranding } from "../types";
import { api, asRecord, asText, putFile } from "./api";

function parseSaved(value: unknown): SavedBranding | null {
  const d = asRecord(value);
  const id = asText(d.id);
  const branding = parseBranding(d);
  if (!id || !branding) return null;
  return { id, ...branding, updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : 0 };
}

export const serverBrandingsRepository: BrandingsRepository = {
  async list() {
    const raw = asRecord(await api("GET", "/api/brandings")).brandings;
    return (Array.isArray(raw) ? raw : []).map(parseSaved).filter((b): b is SavedBranding => b !== null);
  },
  async save(branding) {
    const saved = parseSaved(await api("POST", "/api/brandings", branding));
    if (!saved) throw new Error("invalid-argument");
    return saved;
  },
  async remove(id) {
    await api("DELETE", `/api/brandings/${encodeURIComponent(id)}`);
  },
  async uploadLogo(image) {
    const type = image.type === "image/png" ? "image/png" : image.type === "image/jpeg" ? "image/jpeg" : "image/webp";
    return asText(asRecord(await putFile("/api/brandings/logo", image, type)).logo);
  },
  logoUrl(sha) {
    return brandLogoUrl(sha);
  },
};
