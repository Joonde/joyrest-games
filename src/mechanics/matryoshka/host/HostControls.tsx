/** Пульт «Игр Матрёшки» на платформе: настоящий поток host, итоги solo и подготовка комнаты перед закрытием сессии. */
import { useCallback, useMemo, useRef, useState } from "react";
import { roomsRepo } from "../../../data";
import type { HostControlsProps } from "../../types";
import type { HostView, MatContent } from "../rules/types";
import { MatryoshkaHost } from "./Host";
import type { HostLink } from "./link";
import { leaderboardChange, syncsLeaderboard } from "./model";

export function MatryoshkaHostView({ session, control, rehearsal }: HostControlsProps<MatContent>) {
  const link = useMemo<HostLink>(() => ({
    subscribe: (onEvent, onError, take) => roomsRepo.subscribe(session.id, "host", onEvent, onError, take ? { take: true } : undefined),
    command: (cmd, args, expect) => roomsRepo.command(session.id, cmd, args, expect ? { expect } : undefined),
  }), [session.id]);
  const board = useRef(session.leaderboard);
  board.current = session.leaderboard;
  const view = useRef<HostView | null>(null);
  const writing = useRef(false);
  const finishedWaiter = useRef<{ resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null>(null);
  const [finishing, setFinishing] = useState(false);

  const sync = useCallback(async (): Promise<void> => {
    const v = view.current;
    if (rehearsal || !v || writing.current) return;
    const change = leaderboardChange(v, board.current);
    if (Object.keys(change).length === 0) return;
    writing.current = true;
    try {
      await control.apply({ leaderboard: change, expect: { phase: "playing" } });
    } finally {
      writing.current = false;
    }
  }, [control, rehearsal]);

  const onView = useCallback((v: HostView) => {
    view.current = v;
    if (v.phase === "finished" && finishedWaiter.current) {
      clearTimeout(finishedWaiter.current.timer);
      finishedWaiter.current.resolve();
      finishedWaiter.current = null;
    }
    if (!finishing && syncsLeaderboard(v)) void sync().catch(() => undefined);
  }, [finishing, sync]);

  const prepareFinish = useCallback(async () => {
    setFinishing(true);
    try {
      let current = view.current;
      if (!current) throw new Error("Нет сводки игры — дождитесь подключения.");
      if (current.phase !== "finished") {
        const wait = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            finishedWaiter.current = null;
            reject(new Error("Комната не подтвердила завершение. Проверьте связь и повторите."));
          }, 5000);
          finishedWaiter.current = { resolve, reject, timer };
        });
        await link.command("finish", undefined, current.moment);
        await wait;
        current = view.current;
      }
      if (current?.phase !== "finished") throw new Error("Комната ещё не завершена — повторите сохранение.");
      await sync();
    } catch (error) {
      setFinishing(false);
      throw error;
    }
  }, [link, sync]);

  return <MatryoshkaHost link={link} sessionFinished={session.state.phase === "finished"} onView={onView} onFinish={() => control.requestFinish(prepareFinish)} finishing={finishing} />;
}
