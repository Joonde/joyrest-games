/**
 * Связь телефона с игровой комнатой: личный поток (`me`), отправитель пачек и часы сервера. Телефон на поток экрана не
 * подписывается. Настоящая связь — `roomsRepo` и `clock` слоя данных (`roomLink.ts`); стенд подставляет комнату в памяти.
 */
import type { RoomInputEvent, RoomInputReply, RoomStreamEvent } from "../../../data/types";

export interface PhoneSender {
  /** Событие в пачку; `now` — сразу отдельным запросом («держу» / «отпустил», стул, «Прыгаю первым!», ответ, жест). */
  push(event: RoomInputEvent, now?: boolean): void;
  stop(): void;
}

/** Часы сервера по `GET /api/time` (лучший из трёх замеров): null — ещё не измерено. */
export interface PhoneClock {
  offset(): number | null;
  /** Замерить, если прошлый замер старше `maxAgeMs` (раз в 2 минуты). */
  sync(maxAgeMs: number): void;
}

export interface PhoneLink {
  /** Личный поток: снимок, дальше события. `take` — «Открыть здесь» (вытеснить свою же другую вкладку). */
  subscribe(onEvent: (event: RoomStreamEvent) => void, onError: (error: Error) => void, take: boolean): () => void;
  sender(onReply: (reply: RoomInputReply) => void, onError: (error: Error) => void): PhoneSender;
  clock: PhoneClock;
  /** Ключ для `sessionStorage` (обводка «Пряника» переживает перезагрузку). */
  key: string;
}
