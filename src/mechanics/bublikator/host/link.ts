/**
 * Связь пульта с игровой комнатой: поток `host` (сводка раз в секунду всегда) и команды. Настоящая — `roomsRepo`
 * (`HostControls.tsx`), в предпросмотре, репетиции и на стенде — комната в памяти (`sim/room.ts`).
 */
import type { RoomStreamEvent } from "../../../data/types";

export interface HostLink {
  /** `take` — «Открыть здесь» (вытеснить свою же другую вкладку пульта). */
  subscribe(onEvent: (event: RoomStreamEvent) => void, onError: (error: Error) => void, take: boolean): () => void;
  /** Команда комнате; `expect` — этап, который видел ведущий (`moment`): игра ушла дальше — отказ `failed-precondition`/`moved`. */
  command(cmd: string, args?: unknown, expect?: string): Promise<unknown>;
}

/** Код и причина отказа (у `ApiError` слоя данных — `code` и `reason`). */
export function errorParts(error: unknown): { code: string; reason: string } {
  if (typeof error !== "object" || error === null) return { code: "", reason: "" };
  const e = error as { code?: unknown; reason?: unknown };
  return { code: typeof e.code === "string" ? e.code : "", reason: typeof e.reason === "string" ? e.reason : "" };
}
