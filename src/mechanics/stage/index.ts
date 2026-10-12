import { lazy } from "react";
import type { Mechanic } from "../types";
import { createStage, parseStage, type StageContent } from "./content";
import { StageHostControls } from "./HostControls";
import { score, stageFirstTurn, stageSteps } from "./logic";
import { validateStage } from "./validate";
import { StagePlayerView, StageScreenView, type StageAnswerValue } from "./views";

const StageEditor = lazy(() => import("./Editor").then((m) => ({ default: m.StageEditor })));

/** «Just Dance и Караоке на поле»: плитки с очками, кто выходит, видео с пульта, симпатия зала и батлы. */
export const stage: Mechanic<StageContent, StageAnswerValue> = {
  id: "stage",
  title: "Just Dance и Караоке на поле",
  supports: { solo: true, teams: true, noScreen: false },
  create: () => createStage("dance"),
  parse: parseStage,
  mediaIds: () => [],
  Editor: StageEditor,
  ScreenView: StageScreenView,
  PlayerView: StagePlayerView,
  HostControls: StageHostControls,
  steps: stageSteps,
  score,
  validate: validateStage,
  firstTurn: (session, _content, pid) => stageFirstTurn(session, pid),
};
