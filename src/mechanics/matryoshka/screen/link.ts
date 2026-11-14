/**
 * Связь экрана зала «Игр Матрёшки» с игровой комнатой: только поток `screen` (без тайн, ≤ 5 раз в секунду). Настоящая — `roomsRepo`
 * (`ScreenView.tsx`), на стенде — комната в памяти.
 */
import type { RoomStreamEvent } from "../../../data/types";

export interface ScreenLink {
  /** `take` — «Открыть здесь» (вытеснить свою же другую вкладку экрана). */
  subscribe(onEvent: (event: RoomStreamEvent) => void, onError: (error: Error) => void, take: boolean): () => void;
}
