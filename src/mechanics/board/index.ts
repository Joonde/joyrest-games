import { lazy } from "react";
import type { Mechanic } from "../types";
import { boardPreview } from "./preview";
import { boardMediaIds, createBoard, findCell, parseBoard, type BoardContent } from "./content";
import { BoardHostControls } from "./HostControls";
import { boardFirstTurn, boardSteps, parseBoardResult, score, type BoardStep } from "./logic";
import { validateBoard } from "./validate";
import { BoardPlayerView, BoardScreenView, type BoardAnswerValue } from "./views";

const BoardEditor = lazy(() => import("./Editor").then((m) => ({ default: m.BoardEditor })));

/** «Ставка на знания»: поле категорий и стоимостей, кнопка «кто первый», «Кот в мешке» со ставками. */
export const board: Mechanic<BoardContent, BoardAnswerValue, BoardStep> = {
  id: "board",
  title: "Ставка на знания",
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
  firstTurn: (session, _content, pid) => boardFirstTurn(session, pid),
  // Отсчёт пошёл (и у «Кота в мешке», пока отвечают) — музыка напряжения; у клетки с треком звучит её трек.
  music: (session, content) => {
    const r = parseBoardResult(session.state.result);
    if (session.state.phase !== "playing" || session.state.stage !== "question" || !r.armed) return null;
    return findCell(content, r.cell)?.cell.trackId ? null : "thinkLow";
  },
};
