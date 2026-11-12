/**
 * Пульт «Бубликатора» на платформе (отдельный чанк, грузится из `views.tsx` через `lazy`): поток `host` и команды комнаты через
 * `roomsRepo`. Таблицу лидеров платформы («История игр», «Игры сейчас», итоги по ссылке) пульт пишет по общему счёту экипажей —
 * на «Привале» и на пьедестале; «Завершить игру» сначала пишет итоги, потом закрывает сессию (обычное «Завершить игру?»).
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { roomsRepo } from "../../../data";
import type { HostControlsProps } from "../../types";
import type { BubContent, HostView } from "../rules/types";
import { BublikatorHost } from "./Host";
import type { HostLink } from "./link";
import { leaderboardChange, syncsLeaderboard } from "./model";

export function BublikatorHostView({ session, control, rehearsal }: HostControlsProps<BubContent>) {
  const link = useMemo<HostLink>(
    () => ({
      subscribe: (onEvent, onError, take) => roomsRepo.subscribe(session.id, "host", onEvent, onError, take ? { take: true } : undefined),
      command: (cmd, args, expect) => roomsRepo.command(session.id, cmd, args, expect ? { expect } : undefined),
    }),
    [session.id],
  );
  const board = useRef(session.leaderboard);
  board.current = session.leaderboard;
  const view = useRef<HostView | null>(null);
  const writing = useRef(false);

  const sync = useCallback(async (): Promise<void> => {
    const v = view.current;
    if (rehearsal || !v || writing.current) return;
    const change = leaderboardChange(v, board.current);
    if (!change) return;
    writing.current = true;
    try {
      await control.apply({ leaderboard: change, expect: { phase: "playing" } });
    } catch {
      // Не вышло (сеть, игра уже завершена) — попробуем со следующей сводкой.
    } finally {
      writing.current = false;
    }
  }, [control, rehearsal]);

  const onView = useCallback(
    (v: HostView) => {
      view.current = v;
      if (syncsLeaderboard(v)) void sync();
    },
    [sync],
  );
  // Таблица лидеров пришла свежая (новая команда, чужая правка) — сверить ещё раз.
  useEffect(() => {
    if (view.current && syncsLeaderboard(view.current)) void sync();
  }, [session.leaderboard, sync]);

  const onFinish = useCallback(async () => {
    await sync();
    control.requestFinish();
  }, [control, sync]);

  return <BublikatorHost link={link} sessionFinished={session.state.phase === "finished"} onView={onView} onFinish={() => void onFinish()} />;
}
