/** Экран зала «Бубликатора» на платформе (отдельный чанк, грузится из `views.tsx` через `lazy`). */
import { useMemo } from "react";
import { roomsRepo } from "../../../data";
import type { ViewProps } from "../../types";
import type { BubContent } from "../rules/types";
import type { ScreenLink } from "./link";
import { BublikatorScreen } from "./Screen";

export function BublikatorHallView({ session, content }: ViewProps<BubContent>) {
  const link = useMemo<ScreenLink>(
    () => ({ subscribe: (onEvent, onError, take) => roomsRepo.subscribe(session.id, "screen", onEvent, onError, take ? { take: true } : undefined) }),
    [session.id],
  );
  const board = useMemo(
    () =>
      Object.entries(session.leaderboard ?? {})
        .map(([id, e]) => ({ id, name: e.name, score: e.score }))
        .sort((a, b) => b.score - a.score),
    [session.leaderboard],
  );
  return (
    <BublikatorScreen
      link={link}
      code={session.code}
      sessionFinished={session.state.phase === "finished"}
      fallbackBoard={board}
      fallbackTheme={content.theme}
    />
  );
}
