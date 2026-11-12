/** Планировщик мероприятий на своём сервере: `/api/events...` (CLAUDE.md, раздел 3, «Календарь»). */
import type { EventsRepository } from "../contracts";
import type { AgencyEvent } from "../types";
import { api, asRecord, asText } from "./api";
import type { EventLogLine } from "../types";
import { cleanProgram } from "../../core/eventProgram";

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
    clientContact: asText(d.clientContact),
    title: asText(d.title),
    place: asText(d.place),
    guests: typeof d.guests === "number" ? d.guests : null,
    note: asText(d.note),
    cancelled: d.cancelled === true,
    held: d.held === true ? true : d.held === false ? false : null,
    updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : 0,
    program: cleanProgram(d.program),
    acceptedAt: typeof d.acceptedAt === "number" ? d.acceptedAt : null,
    acceptRev: typeof d.acceptRev === "number" ? d.acceptRev : 0,
    live: d.live === true,
    ...(d.hostOff === true ? { hostOff: true } : {}),
    ...(typeof d.price === "number" ? { price: d.price } : {}),
    ...(typeof d.prepaidAt === "number" ? { prepaidAt: d.prepaidAt, ...(asText(d.prepaidBy) ? { prepaidBy: asText(d.prepaidBy) } : {}) } : {}),
    ...(typeof d.refundAt === "number" ? { refundAt: d.refundAt, ...(asText(d.refundBy) ? { refundBy: asText(d.refundBy) } : {}) } : {}),
    ...(typeof d.refundDoneAt === "number" ? { refundDoneAt: d.refundDoneAt } : {}),
    ...(asText(d.ownerId) ? { ownerId: asText(d.ownerId), ownerName: asText(d.ownerName) } : {}),
    ...(typeof d.declinedAt === "number" ? { declinedAt: d.declinedAt, declinedReason: asText(d.declinedReason) } : {}),
    ...(d.restPaid === "yes" || d.restPaid === "no" || d.restPaid === "part" ? { restPaid: d.restPaid } : {}),
    ...(typeof d.restAmount === "number" ? { restAmount: d.restAmount } : {}),
    ...(typeof d.calledAt === "number" ? { calledAt: d.calledAt, calledBy: asText(d.calledBy) } : {}),
    ...(d.review === "asked" || d.review === "got" ? { review: d.review } : {}),
    ...(typeof d.overtimePaid === "number" ? { overtimePaid: d.overtimePaid } : {}),
    ...(d.clientNotSaved === true ? { clientNotSaved: true } : {}),
    ...(d.clientIncomplete === true ? { clientIncomplete: true } : {}),
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
  async cancel(id, client) {
    return parseEvent(await api("POST", `/api/events/${encodeURIComponent(id)}/cancel`, client ? { client } : {}));
  },
  async called(id, called) {
    return parseEvent(await api("POST", `/api/events/${encodeURIComponent(id)}/called`, { called }));
  },
  async review(id, review) {
    return parseEvent(await api("POST", `/api/events/${encodeURIComponent(id)}/review`, { review }));
  },
  async overtime(id, amount) {
    return parseEvent(await api("POST", `/api/events/${encodeURIComponent(id)}/overtime`, { amount }));
  },
  async log(id) {
    const d = asRecord(await api("GET", `/api/events/${encodeURIComponent(id)}/log`));
    return (Array.isArray(d.log) ? d.log : []).map((r): EventLogLine => {
      const x = asRecord(r);
      return { at: typeof x.at === "number" ? x.at : 0, by: asText(x.by), text: asText(x.text) };
    });
  },
  async take(id) {
    return parseEvent(await api("POST", `/api/events/${encodeURIComponent(id)}/take`, {}));
  },
  async decline(id, reason) {
    return parseEvent(await api("POST", `/api/events/${encodeURIComponent(id)}/decline`, { reason }));
  },
  async rest(id, rest, amount) {
    return parseEvent(await api("POST", `/api/events/${encodeURIComponent(id)}/rest`, { rest, amount: amount ?? null }));
  },
  async restore(id) {
    return parseEvent(await api("POST", `/api/events/${encodeURIComponent(id)}/restore`, {}));
  },
  async refund(id) {
    return parseEvent(await api("POST", `/api/events/${encodeURIComponent(id)}/refund`, {}));
  },
  async refundDone(id) {
    return parseEvent(await api("POST", `/api/events/${encodeURIComponent(id)}/refund-done`, {}));
  },
  async period(from, to) {
    return list(await api("GET", `/api/events?stats=1&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`));
  },
  async accept(id, rev) {
    return parseEvent(await api("POST", `/api/events/${encodeURIComponent(id)}/accept`, { rev }));
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
