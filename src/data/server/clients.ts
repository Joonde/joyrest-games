/** База клиентов на своём сервере: `/api/clients...` (CLAUDE.md, раздел 3, «База клиентов»). */
import type { ClientsRepository } from "../contracts";
import type { ClientContact, ClientDetails, ClientRecord, ClientResponse, ContactMatches } from "../types";
import { api, asRecord, asText } from "./api";

const num = (v: unknown) => (typeof v === "number" ? v : 0);

function parseClient(value: unknown): ClientRecord {
  const d = asRecord(value);
  const status = d.status === "work" || d.status === "client" || d.status === "held" || d.status === "lost" ? d.status : "new";
  const marketing = d.marketing === "yes" || d.marketing === "no" ? d.marketing : "unknown";
  return {
    id: asText(d.id),
    name: asText(d.name),
    phone: asText(d.phone),
    links: Array.isArray(d.links) ? d.links.filter((l): l is string => typeof l === "string") : [],
    status,
    marketing,
    marketingAt: typeof d.marketingAt === "number" ? d.marketingAt : null,
    marketingSource: asText(d.marketingSource),
    notes: asText(d.notes),
    createdAt: num(d.createdAt),
    lastContactAt: num(d.lastContactAt),
    contacts: num(d.contacts),
    lastSource: asText(d.lastSource),
    archived: d.archived === true,
    updatedAt: num(d.updatedAt),
    statusLine: asText(d.statusLine),
    statusAt: typeof d.statusAt === "number" ? d.statusAt : null,
    tgWaitingSince: typeof d.tgWaitingSince === "number" ? d.tgWaitingSince : null,
    origin: asText(d.origin),
    newSince: typeof d.newSince === "number" ? d.newSince : null,
    takenAt: typeof d.takenAt === "number" ? d.takenAt : null,
    takenMs: typeof d.takenMs === "number" ? d.takenMs : null,
    takenBy: asText(d.takenBy),
    contact: asText(d.contact),
  };
}

function parseDetails(value: unknown): ClientDetails {
  const d = asRecord(value);
  const history = Array.isArray(d.history)
    ? d.history.map((h): ClientContact => {
        const r = asRecord(h);
        return { id: asText(r.id), source: asText(r.source), summary: asText(r.summary), at: num(r.at), ref: typeof r.ref === "string" ? r.ref : null };
      })
    : [];
  return { ...parseClient(value), history };
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function parseMatches(value: unknown): ContactMatches {
  const d = asRecord(value);
  return {
    label: asText(d.label),
    clients: list(d.clients).map((r) => ({ id: asText(r.id), name: asText(r.name), phone: asText(r.phone), contacts: num(r.contacts), archived: r.archived === true })),
    requests: list(d.requests).map((r) => ({ id: asText(r.id), number: num(r.number), name: asText(r.name), title: asText(r.title), archived: r.archived === true })),
    events: list(d.events).map((r) => ({ id: asText(r.id), title: asText(r.title), day: asText(r.day), clientName: asText(r.clientName), cancelled: r.cancelled === true })),
    venues: list(d.venues).map((r) => ({ id: asText(r.id), name: asText(r.name), person: asText(r.person) })),
  };
}

export const serverClientsRepository: ClientsRepository = {
  async list(archived) {
    const data = asRecord(await api("GET", `/api/clients${archived ? "?archived=1" : ""}`));
    return (Array.isArray(data.clients) ? data.clients : []).map(parseClient);
  },
  async get(id) {
    return parseDetails(await api("GET", `/api/clients/${encodeURIComponent(id)}`));
  },
  async save(client) {
    return parseDetails(await api("POST", "/api/clients", client));
  },
  async setStatus(id, status) {
    return parseDetails(await api("POST", `/api/clients/${encodeURIComponent(id)}/status`, { status }));
  },
  async saveNotes(id, notes, base) {
    return parseDetails(await api("POST", `/api/clients/${encodeURIComponent(id)}/notes`, { notes, base }));
  },
  async archive(id) {
    await api("POST", `/api/clients/${encodeURIComponent(id)}/archive`, {});
  },
  async restore(id) {
    await api("POST", `/api/clients/${encodeURIComponent(id)}/restore`, {});
  },
  exportUrl(all) {
    return `/api/clients/export${all ? "?all=1" : ""}`;
  },
  async responses(from, to) {
    const data = asRecord(await api("GET", `/api/clients/responses?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`));
    return list(data.responses).map((r): ClientResponse => ({ userName: asText(r.userName), waitedMs: num(r.waitedMs), takenAt: num(r.takenAt) }));
  },
  async findContact(query) {
    return parseMatches(await api("GET", `/api/privacy?q=${encodeURIComponent(query)}`));
  },
  async eraseContact(query) {
    const d = asRecord(await api("POST", "/api/privacy/erase", { q: query }));
    return { clients: num(d.clients), requests: num(d.requests), events: num(d.events), venues: num(d.venues) };
  },
};
