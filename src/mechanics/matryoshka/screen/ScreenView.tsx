/** Экран зала «Игр Матрёшки» на платформе (отдельный чанк, грузится из `views.tsx` через `lazy`). */
import { useEffect, useMemo, useState } from "react";
import { rankedLeaderboard } from "../../../core/leaderboard";
import { clock, roomsRepo } from "../../../data";
import type { ViewProps } from "../../types";
import type { MatContent } from "../rules/types";
import type { ScreenLink } from "./link";
import { MatryoshkaScreen } from "./Screen";

export function MatryoshkaHallView({ session, content }: ViewProps<MatContent>) {
  const link = useMemo<ScreenLink>(
    () => ({ subscribe: (onEvent, onError, take) => roomsRepo.subscribe(session.id, "screen", onEvent, onError, take ? { take: true } : undefined) }),
    [session.id],
  );
  // Сверенные часы экрана (`GET /api/time`): голова Матрёшки начинает поворот за 0,4 с до T по ним.
  const [synced, setSynced] = useState(false);
  useEffect(() => {
    let alive = true;
    void clock.sync().then(() => {
      if (alive) setSynced(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  const offset = useMemo(() => (synced ? () => clock.offset() + (Date.now() - (performance.timeOrigin + performance.now())) : () => null), [synced]);
  // Итог после завершения (комната закрыта) — по таблице лидеров платформы.
  const board = useMemo(() => rankedLeaderboard(session.leaderboard ?? {}).map((r) => ({ id: r.id, name: r.name, score: r.score, place: r.place })), [session.leaderboard]);
  return <MatryoshkaScreen link={link} code={session.code} sessionFinished={session.state.phase === "finished"} fallbackBoard={board} fallbackStyle={content.style} synced={offset} />;
}
