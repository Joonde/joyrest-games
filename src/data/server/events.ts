/** Планировщик мероприятий на своём сервере: `/api/events...` (CLAUDE.md, раздел 3, «Календарь»). */
import type { EventsRepository } from "../contracts";
import type { AgencyEvent } from "../types";
import { api, asRecord, asText } from "./api";

export function parseEvent(value: unknown): AgencyEvent {
  const d = asRecord(value);
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  return {
    id: asText(d.id),
    hostId: asText(d.hostId),
    hostName: asText(d.hostName),
    day: asText(d.day),
    start: num(d.start),
    end: num(d.end),
    clientName: asText(d.clientName),
    clientPhone: asText(d.clientPhone),
    title: asText(d.title),
    place: asText(d.place),
    guests: typeof d.guests === "number" ? d.guests : null,
    note: asText(d.note),
    cancelled: d.cancelled === true,
    held: d.held === true ? true : d.held === false ? false : null,
    updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : 0,
    ...(d.clientNotSaved === true ? { clientNotSaved: true } : {}),
  };
}

const list = (value: unknown) => (Array.isArray(asRecord(value).events) ? (asRecord(value).events as unknown[]) : []).map(parseEvent);

export const serverEventsRepository: EventsRepository = {
  async range(from, to) {
    return list(await api("GET", `/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`));
  },
  async list(scope) {
    return list(await api("GET", `/api/events?scope=${scope}`));
  },
  async save(event) {
    return parseEvent(await api("POST", "/api/events", event));
  },
  async cancel(id) {
    return parseEvent(await api("POST", `/api/events/${encodeURIComponent(id)}/cancel`, {}));
  },
  async restore(id) {
    return parseEvent(await api("POST", `/api/events/${encodeURIComponent(id)}/restore`, {}));
  },
  async period(from, to) {
    return list(await api("GET", `/api/events?stats=1&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`));
  },
  async setHeld(id, held) {
    return parseEvent(await api("POST", `/api/events/${encodeURIComponent(id)}/held`, { held }));
  },
  async remove(id) {
    await api("DELETE", `/api/events/${encodeURIComponent(id)}`);
  },
  icsUrl(id) {
    return `/api/events/${encodeURIComponent(id)}/ics`;
  },
  async feed() {
    return asText(asRecord(await api("GET", "/api/calendar/feed")).url);
  },
  async resetFeed() {
    return asText(asRecord(await api("POST", "/api/calendar/feed/reset", {})).url);
  },
};
