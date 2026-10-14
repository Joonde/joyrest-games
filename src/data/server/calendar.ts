/** Календарь команды на своём сервере: `/api/calendar...` (CLAUDE.md, раздел 3, «Календарь»). */
import type { CalendarRepository } from "../contracts";
import type { AvailabilityEntry, CalendarMember } from "../types";
import { api, asRecord, asText } from "./api";

function parseEntry(value: unknown): AvailabilityEntry {
  const d = asRecord(value);
  const kind = d.kind === "free" || d.kind === "booked" ? d.kind : "busy";
  return {
    id: asText(d.id),
    uid: asText(d.uid),
    day: asText(d.day),
    start: typeof d.start === "number" ? d.start : 0,
    end: typeof d.end === "number" ? d.end : 0,
    kind,
    note: asText(d.note),
  };
}

function parseMember(value: unknown): CalendarMember {
  const d = asRecord(value);
  return { uid: asText(d.uid), name: asText(d.name), profession: typeof d.profession === "string" ? d.profession : "host", owner: d.owner === true };
}

const list = (value: unknown) => (Array.isArray(value) ? value : []);
const range = (from: string, to: string) => `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

export const serverCalendarRepository: CalendarRepository = {
  async mine(from, to) {
    return list(asRecord(await api("GET", `/api/calendar?${range(from, to)}`)).entries).map(parseEntry);
  },
  async team(from, to) {
    const data = asRecord(await api("GET", `/api/calendar/team?${range(from, to)}`));
    return { members: list(data.members).map(parseMember), entries: list(data.entries).map(parseEntry) };
  },
  async save(entry) {
    return parseEntry(await api("POST", "/api/calendar", entry));
  },
  async book(entry) {
    return parseEntry(await api("POST", "/api/calendar/book", entry));
  },
  async remove(id) {
    await api("DELETE", `/api/calendar/${encodeURIComponent(id)}`);
  },
};
