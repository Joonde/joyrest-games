/** Колокольчик уведомлений студии на своём сервере: `/api/notices` (CLAUDE.md, раздел 3, «Уведомления в студии»). */
import type { NoticesRepository } from "../contracts";
import type { Notice } from "../types";
import { api, asRecord, asText } from "./api";

function parseNotice(value: unknown): Notice {
  const d = asRecord(value);
  return {
    id: asText(d.id),
    clientId: asText(d.clientId),
    kind: d.kind === "waiting" ? "waiting" : "new",
    title: asText(d.title),
    name: asText(d.name),
    line: asText(d.line),
    at: typeof d.at === "number" ? d.at : 0,
    unread: d.unread === true,
  };
}

export const serverNoticesRepository: NoticesRepository = {
  async load() {
    const d = asRecord(await api("GET", "/api/notices"));
    const items = (Array.isArray(d.items) ? d.items : []).map(parseNotice).filter((n) => n.id && n.clientId);
    return { unread: typeof d.unread === "number" ? d.unread : items.filter((n) => n.unread).length, items };
  },
  async markSeen() {
    await api("POST", "/api/notices/seen", {});
  },
};
