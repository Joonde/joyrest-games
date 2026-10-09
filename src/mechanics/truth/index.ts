import { lazy } from "react";
import type { Mechanic } from "../types";
import { createTruth, parseTruth, type TruthContent } from "./content";
import { TruthHostControls } from "./HostControls";
import { score, truthSteps } from "./logic";
import { validateTruth } from "./validate";
import { TruthPlayerView, TruthScreenView, type TruthAnswerValue } from "./views";

const TruthEditor = lazy(() => import("./Editor").then((m) => ({ default: m.TruthEditor })));

/** «Правда или действие»: ходы по очереди, дизайнерские карты, задания от гостей. */
export const truth: Mechanic<TruthContent, TruthAnswerValue> = {
  id: "truth",
  title: "Правда или действие",
  supports: { solo: true, teams: true, noScreen: true },
  create: createTruth,
  parse: parseTruth,
  mediaIds: () => [],
  Editor: TruthEditor,
  ScreenView: TruthScreenView,
  PlayerView: TruthPlayerView,
  HostControls: TruthHostControls,
  steps: truthSteps,
  score,
  validate: validateTruth,
};
