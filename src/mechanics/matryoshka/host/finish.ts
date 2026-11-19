import type { HostView } from "../rules/types";

/** Подготовка комнаты к общему завершению платформы; повтор после сбоя не должен оставаться заблокированным. */
export async function prepareMatryoshkaFinish(p: {
  before: HostView | null;
  current: () => HostView | null;
  command: (moment: string) => Promise<unknown>;
  waitForFinished: () => Promise<void>;
  sync: () => Promise<void>;
  setFinishing: (value: boolean) => void;
}): Promise<void> {
  p.setFinishing(true);
  try {
    const before = p.before;
    if (!before) throw new Error("Нет сводки игры — дождитесь подключения.");
    if (before.phase !== "finished") {
      await p.command(before.moment);
      if (p.current()?.phase !== "finished") await p.waitForFinished();
    }
    if (p.current()?.phase !== "finished") throw new Error("Комната ещё не завершена — повторите сохранение.");
    await p.sync();
  } finally {
    p.setFinishing(false);
  }
}
