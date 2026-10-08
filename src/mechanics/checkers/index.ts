import { lazy } from "react";
import type { Mechanic } from "../types";
import { checkersMediaIds, createCheckers, parseCheckers, type CheckersContent } from "./content";
import { CheckersHostControls } from "./HostControls";
import { checkersSteps, score } from "./logic";
import { validateCheckers } from "./validate";
import { CheckersPlayerView, CheckersScreenView, type CheckersAnswerValue } from "./views";

const CheckersEditor = lazy(() => import("./Editor").then((m) => ({ default: m.CheckersEditor })));

/** «Шашки»: две команды, ход — за верный и быстрый ответ, очки — за взятые шашки и победу. */
export const checkers: Mechanic<CheckersContent, CheckersAnswerValue> = {
  id: "checkers",
  title: "Шашки",
  supports: { solo: true, teams: true, noScreen: true },
  create: createCheckers,
  parse: parseCheckers,
  mediaIds: checkersMediaIds,
  Editor: CheckersEditor,
  ScreenView: CheckersScreenView,
  PlayerView: CheckersPlayerView,
  HostControls: CheckersHostControls,
  steps: checkersSteps,
  score,
  validate: validateCheckers,
};
