/**
 * Канал пульта с локальной программой «JoyRest Кнопки». Токен и события идут только на
 * 127.0.0.1; игровой сервер JoyRest их не получает. Окончательный ответ по-прежнему пишет сервер.
 */
import type { HardwareSource } from "../core/hardware";

export const LOCAL_HARDWARE_URL = "http://127.0.0.1:43127";

export interface LocalHardwareDevice {
  source: HardwareSource;
  hardwareId: string;
  alias: string;
  connected: boolean;
  battery: number | null;
  features: string[];
}

export interface LocalPressEvent {
  type: "press";
  source: HardwareSource;
  hardwareId: string;
  eventId: string;
  localPressedAt: number;
}

export class LocalHardwareError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "LocalHardwareError";
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${LOCAL_HARDWARE_URL}${path}`, { cache: "no-store", ...init });
  } catch {
    throw new LocalHardwareError(0, "Нет связи с программой JoyRest Кнопки");
  }
  if (!response.ok) throw new LocalHardwareError(response.status, `Локальный канал: HTTP ${response.status}`);
  return response;
}

export async function localHardwareHealth(): Promise<{ ok: boolean; version: number; adapter: string }> {
  return (await request("/health")).json() as Promise<{ ok: boolean; version: number; adapter: string }>;
}

export async function pairLocalHardware(code: string): Promise<{ token: string; expiresAt: number }> {
  return (await request("/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  })).json() as Promise<{ token: string; expiresAt: number }>;
}

export async function listLocalHardwareDevices(token: string): Promise<LocalHardwareDevice[]> {
  const data = (await request("/api/devices", { headers: { Authorization: `Bearer ${token}` } })).json() as Promise<{ devices: LocalHardwareDevice[] }>;
  const result = await data;
  return Array.isArray(result.devices) ? result.devices : [];
}

export async function pressLocalVirtual(token: string, source: HardwareSource, hardwareId: string): Promise<LocalPressEvent> {
  return (await request("/api/virtual/press", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-JoyRest-Hardware": "1" },
    body: JSON.stringify({ source, hardwareId }),
  })).json() as Promise<LocalPressEvent>;
}

/** Разбирает один SSE-блок; возвращает null для ping/комментария или неполного события. */
export function parseHardwareSseBlock(block: string): LocalPressEvent | null {
  let event = "";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (event !== "press" || data.length === 0) return null;
  try {
    const value = JSON.parse(data.join("\n")) as Partial<LocalPressEvent>;
    if (value.type !== "press" || (value.source !== "bluetooth" && value.source !== "usb") || typeof value.hardwareId !== "string" || typeof value.eventId !== "string") return null;
    return {
      type: "press",
      source: value.source,
      hardwareId: value.hardwareId,
      eventId: value.eventId,
      localPressedAt: typeof value.localPressedAt === "number" ? value.localPressedAt : 0,
    };
  } catch {
    return null;
  }
}

/** Читает SSE до закрытия/AbortSignal. Переподключение и показ статуса выполняет вызывающий код. */
export async function streamLocalHardwareEvents(token: string, signal: AbortSignal, onPress: (event: LocalPressEvent) => void): Promise<void> {
  const response = await request("/api/events", { headers: { Authorization: `Bearer ${token}` }, signal });
  if (!response.body) throw new LocalHardwareError(0, "Локальный SSE не поддерживается браузером");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let end = buffer.indexOf("\n\n");
      while (end >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = parseHardwareSseBlock(block);
        if (event) onPress(event);
        end = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}
