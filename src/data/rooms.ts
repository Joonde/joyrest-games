/**
 * Быстрый канал у Firebase-версии: комнат нет (только свой сервер, CLAUDE.md, «Быстрый канал (комнаты)»).
 * Всё отвечает настоящей ошибкой `unimplemented` — без повторов.
 */
import type { RoomsRepository } from "./contracts";

function unimplemented(): Error {
  return Object.assign(new Error("unimplemented"), { code: "unimplemented" });
}

export const firebaseRoomsRepository: RoomsRepository = {
  sender(_sessionId, options) {
    queueMicrotask(() => options?.onError?.(unimplemented()));
    return { push: () => undefined, flush: () => undefined, stop: () => undefined };
  },
  command: () => Promise.reject(unimplemented()),
  subscribe(_sessionId, _kind, _onEvent, onError) {
    let stopped = false;
    queueMicrotask(() => {
      if (!stopped) onError(unimplemented());
    });
    return () => {
      stopped = true;
    };
  },
};
