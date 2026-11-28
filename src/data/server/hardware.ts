/** Физические кнопки пульта на своём сервере. Привязки и права проверяются сервером. */
import type { HardwareBinding } from "../../core/hardware";
import type { HardwareRepository } from "../contracts";
import { api, asRecord, asText } from "./api";

function parseBinding(value: unknown): HardwareBinding | null {
  const d = asRecord(value);
  const id = asText(d.id);
  const sessionId = asText(d.sessionId);
  const participantId = asText(d.participantId);
  const hardwareId = asText(d.hardwareId);
  if (!id || !sessionId || !participantId || !hardwareId) return null;
  return {
    id,
    sessionId,
    participantId,
    hardwareId,
    source: d.source === "usb" ? "usb" : "bluetooth",
    alias: asText(d.alias) || "Кнопка",
  };
}

const base = (sessionId: string) => `/api/sessions/${encodeURIComponent(sessionId)}`;

export const serverHardwareRepository: HardwareRepository = {
  async list(sessionId) {
    const data = await api("GET", `${base(sessionId)}/hardware-bindings`);
    return (Array.isArray(data) ? data : []).map(parseBinding).filter((binding): binding is HardwareBinding => binding !== null);
  },

  async save(sessionId, binding) {
    const data = await api("PUT", `${base(sessionId)}/hardware-bindings/${encodeURIComponent(binding.id)}`, {
      participantId: binding.participantId,
      source: binding.source,
      hardwareId: binding.hardwareId,
      alias: binding.alias,
    });
    const saved = parseBinding(data);
    if (!saved) throw new Error("Некорректный ответ сервера при сохранении кнопки");
    return saved;
  },

  async remove(sessionId, bindingId) {
    await api("DELETE", `${base(sessionId)}/hardware-bindings/${encodeURIComponent(bindingId)}`);
  },

  async buzz(sessionId, bindingId, eventId) {
    const data = asRecord(await api("POST", `${base(sessionId)}/hardware-buzz`, { bindingId, eventId }, { timeoutMs: 5000 }));
    return data.result === "sent" ? "sent" : data.result === "duplicate" ? "duplicate" : "rejected";
  },
};
