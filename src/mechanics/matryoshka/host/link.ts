/** Связь пульта с комнатой: настоящая — roomsRepo, в репетиции и на стенде — комната в памяти. */
import type { RoomStreamEvent } from "../../../data/types";

export interface HostLink {
  subscribe(onEvent: (event: RoomStreamEvent) => void, onError: (error: Error) => void, take: boolean): () => void;
  command(cmd: string, args?: unknown, expect?: string): Promise<unknown>;
}

export function errorParts(error: unknown): { code: string; reason: string } {
  if (typeof error !== "object" || error === null) return { code: "", reason: "" };
  const e = error as { code?: unknown; reason?: unknown };
  return { code: typeof e.code === "string" ? e.code : "", reason: typeof e.reason === "string" ? e.reason : "" };
}
