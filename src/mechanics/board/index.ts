import { lazy } from "react";
import type { Mechanic } from "../types";
import { boardPreview } from "./preview";
import { boardMediaIds, createBoard, parseBoard, type BoardContent } from "./content";
import { BoardHostControls } from "./HostControls";
import { boardSteps, score, type BoardStep } from "./logic";
import { validateBoard } from "./validate";
import { BoardPlayerView, BoardScreenView, type BoardAnswerValue } from "./views";

const BoardEditor = lazy(() => import("./Editor").then((m) => ({ default: m.BoardEditor })));

/** «Своя игра»: поле категорий и стоимостей, кнопка «кто первый», «Кот в мешке» со ставками. */
export const board: Mechanic<BoardContent, BoardAnswerValue, BoardStep> = {
  id: "board",
  title: "Своя игра",
  supports: { solo: true, teams: true, noScreen: true },
  create: createBoard,
  parse: parseBoard,
  mediaIds: boardMediaIds,
  Editor: BoardEditor,
  ScreenView: BoardScreenView,
  PlayerView: BoardPlayerView,
  HostControls: BoardHostControls,
  steps: boardSteps,
  score,
  validate: validateBoard,
  ownPeek: true,
  preview: { driver: boardPreview, teams: 3, limit: 60 },
};
