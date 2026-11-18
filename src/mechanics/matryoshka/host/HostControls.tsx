/** Пульт «Игр Матрёшки» на платформе: настоящий поток host, итоги solo и подготовка комнаты перед закрытием сессии. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { roomsRepo } from "../../../data";
import type { HostControlsProps } from "../../types";
import type { HostView, MatContent } from "../rules/types";
import { MatryoshkaHost } from "./Host";
import { prepareMatryoshkaFinish } from "./finish";
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
  const writing = useRef<Promise<void> | null>(null);
  const finishedWaiter = useRef<{ resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null>(null);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => () => {
    if (finishedWaiter.current) clearTimeout(finishedWaiter.current.timer);
  }, []);

  /** Записи сериализуются; после ожидания берём самую свежую сводку, а не устаревший снимок на входе. */
  const sync = useCallback(async (): Promise<void> => {
    if (rehearsal) return;
    if (writing.current) {
      try { await writing.current; } catch { /* следующая попытка ниже всё равно перечитает вид */ }
    }
    const v = view.current;
    if (!v) return;
    const change = leaderboardChange(v, board.current);
    if (Object.keys(change).length === 0) return;
    const request = control.apply({ leaderboard: change, expect: { phase: "playing" } });
    writing.current = request;
    try {
      await request;
      // До обновления props не даём фоновой сводке записать те же строки повторно.
      const next = { ...board.current };
      for (const [pid, entry] of Object.entries(change)) {
        if (entry === null) delete next[pid];
        else next[pid] = entry;
      }
      board.current = next;
    } finally {
      if (writing.current === request) writing.current = null;
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

  const prepareFinish = useCallback(() => prepareMatryoshkaFinish({
    before: view.current,
    current: () => view.current,
    command: (moment) => link.command("finish", undefined, moment),
    waitForFinished: () => new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        finishedWaiter.current = null;
        reject(new Error("Комната не подтвердила завершение. Проверьте связь и повторите."));
      }, 5000);
      finishedWaiter.current = { resolve, reject, timer };
    }),
    sync,
    setFinishing,
  }), [link, sync]);

  return <MatryoshkaHost link={link} sessionFinished={session.state.phase === "finished"} onView={onView} onFinish={() => control.requestFinish(prepareFinish)} finishing={finishing} />;
}
