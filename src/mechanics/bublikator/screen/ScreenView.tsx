/** Экран зала «Бубликатора» на платформе (отдельный чанк, грузится из `views.tsx` через `lazy`). */
import { useMemo } from "react";
import { crewBoard } from "../../../core/leaderboard";
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
  // Итог после завершения (комната закрыта) — по таблице лидеров платформы: один экипаж — одна строка (влитые команды с общим
  // счётом экипажа — в его группе), место — по экипажам (решение владельца 13 ноября 2026).
  const board = useMemo(() => crewBoard(session.leaderboard ?? {}), [session.leaderboard]);
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
