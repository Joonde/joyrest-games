/**
 * Связь телефона с игровой комнатой: личный поток (`me`) и отправитель пачек. Телефон на поток экрана не подписывается.
 * Настоящая связь — `roomsRepo` (`roomLink.ts`); стенд телефона подставляет комнату в памяти.
 */
import type { RoomInputEvent, RoomInputReply, RoomStreamEvent } from "../../../data/types";

export interface PhoneSender {
  /** Событие в пачку; `now` — сразу отдельным запросом (движения приборов, «Тяга», SOS, голос). */
  push(event: RoomInputEvent, now?: boolean): void;
  stop(): void;
}

export interface PhoneLink {
  /** Личный поток: снимок, дальше события. `take` — «Открыть здесь» (вытеснить свою же другую вкладку). */
  subscribe(onEvent: (event: RoomStreamEvent) => void, onError: (error: Error) => void, take: boolean): () => void;
  sender(onReply: (reply: RoomInputReply) => void, onError: (error: Error) => void): PhoneSender;
}
