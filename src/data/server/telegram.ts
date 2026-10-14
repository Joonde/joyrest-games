/** Свой Telegram для уведомлений о мероприятиях: `/api/telegram/...`. */
import type { TelegramRepository } from "../contracts";
import { api, asRecord, asText } from "./api";

export const serverTelegramRepository: TelegramRepository = {
  async status() {
    const d = asRecord(await api("GET", "/api/telegram/me"));
    return { available: d.available === true, linked: d.linked === true, username: asText(d.username) };
  },
  async link() {
    return { url: asText(asRecord(await api("POST", "/api/telegram/link", {})).url) };
  },
  async unlink() {
    await api("DELETE", "/api/telegram/me");
  },
};
