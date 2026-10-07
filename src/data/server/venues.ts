/** База площадок на своём сервере: `/api/venue-forms`, `/api/venues`, `/api/venue-requests`, `/api/offers`. */
import { isRequestStatus, isVenueStatus, parseRequest, parseVenue, type OfferItem } from "../../core/venues";
import type { VenuesRepository } from "../contracts";
import type { OfferSummary, PublicOffer, VenueFileInfo, VenueRecord, VenueRequestRecord, VenueUpload } from "../types";
import { api, ApiError, asRecord, asText, newId, putFile } from "./api";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function parseFiles(value: unknown): VenueFileInfo[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const d = asRecord(item);
    const kind = d.kind === "photo" || d.kind === "menu" ? d.kind : null;
    const sha = asText(d.sha);
    return kind && sha ? [{ sha, kind, mime: asText(d.mime), size: num(d.size), name: asText(d.name) }] : [];
  });
}

export function parseVenueRecord(value: unknown): VenueRecord {
  const d = asRecord(value);
  return {
    id: asText(d.id),
    data: parseVenue(d.data),
    status: isVenueStatus(d.status) ? d.status : "new",
    rating: typeof d.rating === "number" ? d.rating : null,
    notes: asText(d.notes),
    source: d.source === "manual" ? "manual" : "form",
    hostId: typeof d.hostId === "string" ? d.hostId : null,
    hostName: typeof d.hostName === "string" ? d.hostName : null,
    files: parseFiles(d.files),
    createdAt: num(d.createdAt),
    updatedAt: num(d.updatedAt),
  };
}

export function parseRequestRecord(value: unknown): VenueRequestRecord {
  const d = asRecord(value);
  return {
    id: asText(d.id),
    number: num(d.number),
    data: parseRequest(d.data),
    status: isRequestStatus(d.status) ? d.status : "new",
    notes: asText(d.notes),
    hostId: typeof d.hostId === "string" ? d.hostId : null,
    hostName: typeof d.hostName === "string" ? d.hostName : null,
    offers: num(d.offers),
    createdAt: num(d.createdAt),
    updatedAt: num(d.updatedAt),
  };
}

function parseOfferItem(value: unknown): OfferItem {
  const d = asRecord(value);
  return {
    venueId: asText(d.venueId),
    name: asText(d.name),
    type: asText(d.type),
    where: asText(d.where),
    capacity: asText(d.capacity),
    price: asText(d.price),
    cuisine: strings(d.cuisine),
    features: strings(d.features),
    about: asText(d.about),
    ok: strings(d.ok),
    ask: strings(d.ask),
    no: strings(d.no),
    photos: strings(d.photos).filter((s) => /^[0-9a-f]{64}$/.test(s)),
  };
}

export function parseOffer(value: unknown): PublicOffer {
  const d = asRecord(value);
  return {
    id: asText(d.id),
    title: asText(d.title),
    comment: asText(d.comment),
    items: Array.isArray(d.items) ? d.items.map(parseOfferItem) : [],
    createdAt: num(d.createdAt),
  };
}

function parseSummary(value: unknown): OfferSummary {
  const d = asRecord(value);
  return { id: asText(d.id), title: asText(d.title), venues: strings(d.venues), createdAt: num(d.createdAt) };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Повтор на обрыве связи и перегрузке (503): анкету заполняют на площадке со слабым интернетом. */
async function retrying<T>(run: () => Promise<T>, attempts = 5): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const retriable = error instanceof ApiError && error.code === "unavailable";
      if (!retriable || attempt >= attempts - 1) throw error;
      await pause(1000 * 2 ** attempt);
    }
  }
}

function contentType(file: VenueUpload): string {
  if (file.blob.type === "application/pdf") return "application/pdf";
  return file.blob.type === "image/jpeg" ? "image/jpeg" : "image/webp";
}

function fileHeaders(file: VenueUpload): Record<string, string> {
  if (!file.name) return {};
  // По символам, а не по половинкам смайлика; одиночные половинки убираем — иначе
  // encodeURIComponent бросает ошибку и файл не уходит.
  const name = Array.from(file.name)
    .filter((ch) => !/^[\uD800-\uDFFF]$/.test(ch))
    .slice(0, 120)
    .join("");
  return name ? { "X-File-Name": encodeURIComponent(name) } : {};
}

const enc = encodeURIComponent;

export const serverVenuesRepository: VenuesRepository = {
  async formsOpen() {
    return asRecord(await api("GET", "/api/venue-forms/status")).open === true;
  },

  async submitVenue(input, onProgress) {
    const photoFiles = input.files.filter((f) => f.kind === "photo").length;
    const menuFiles = input.files.filter((f) => f.kind === "menu").length;
    const answer = asRecord(
      await retrying(() =>
        api("POST", "/api/venue-forms/venue", {
          id: input.id,
          from: input.from,
          data: input.data,
          consent: true,
          photoFiles,
          menuFiles,
          website: input.website,
        }),
      ),
    );
    const token = asText(answer.uploadToken);
    // Анкета уже была сохранена давно — файлы сервер больше не принимает.
    if (token === "") return { failedFiles: input.files.length };
    let failed = 0;
    onProgress?.(0, input.files.length);
    for (const [index, file] of input.files.entries()) {
      try {
        await retrying(() => putFile(`/api/venue-forms/venue/${enc(input.id)}/files/${file.kind}`, file.blob, contentType(file), { "X-Upload-Token": token, ...fileHeaders(file) }));
      } catch {
        failed += 1;
      }
      onProgress?.(index + 1, input.files.length);
    }
    return { failedFiles: failed };
  },

  async submitRequest(input) {
    const answer = asRecord(
      await retrying(() => api("POST", "/api/venue-forms/request", { id: input.id, from: input.from, data: input.data, consent: true, ack: true, website: input.website })),
    );
    return num(answer.number);
  },

  async list() {
    const data = await api("GET", "/api/venues");
    return (Array.isArray(data) ? data : []).map(parseVenueRecord).filter((v) => v.id !== "");
  },
  async get(id) {
    return parseVenueRecord(await api("GET", `/api/venues/${enc(id)}`));
  },
  async create(data) {
    return parseVenueRecord(await api("POST", "/api/venues", { id: newId(), data }));
  },
  async update(id, patch) {
    return parseVenueRecord(await api("PATCH", `/api/venues/${enc(id)}`, patch));
  },
  async remove(id) {
    await api("DELETE", `/api/venues/${enc(id)}`);
  },
  async uploadFile(id, file) {
    await retrying(() => putFile(`/api/venues/${enc(id)}/files/${file.kind}`, file.blob, contentType(file), fileHeaders(file)), 3);
  },
  async removeFile(id, sha) {
    await api("DELETE", `/api/venues/${enc(id)}/files/${enc(sha)}`);
  },
  fileUrl(id, sha) {
    return `/api/venues/${enc(id)}/files/${enc(sha)}`;
  },

  async listRequests() {
    const data = await api("GET", "/api/venue-requests");
    return (Array.isArray(data) ? data : []).map(parseRequestRecord).filter((r) => r.id !== "");
  },
  async getRequest(id) {
    return parseRequestRecord(await api("GET", `/api/venue-requests/${enc(id)}`));
  },
  async updateRequest(id, patch) {
    return parseRequestRecord(await api("PATCH", `/api/venue-requests/${enc(id)}`, patch));
  },
  async removeRequest(id) {
    await api("DELETE", `/api/venue-requests/${enc(id)}`);
  },

  async createOffer(input) {
    return parseOffer(await api("POST", "/api/venue-offers", input));
  },
  async listOffers(requestId) {
    const data = await api("GET", `/api/venue-offers?request=${enc(requestId)}`);
    return (Array.isArray(data) ? data : []).map(parseSummary);
  },
  async getOffer(id) {
    return parseOffer(await api("GET", `/api/offers/${enc(id)}`));
  },
  offerPhotoUrl(offerId, sha) {
    return `/api/offers/${enc(offerId)}/photos/${enc(sha)}`;
  },

  async setAccess(uid, access) {
    await api("POST", `/api/users/${enc(uid)}/venue-access`, { access });
  },
};
