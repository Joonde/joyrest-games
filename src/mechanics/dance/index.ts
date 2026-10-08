import { lazy } from "react";
import type { Mechanic } from "../types";
import { dancePreview } from "./preview";
import { createDance, parseDance, type DanceContent } from "./content";
import { DanceHostControls } from "./HostControls";
import { danceSteps, score } from "./logic";
import { validateDance } from "./validate";
import { DancePlayerView, DanceScreenView, type DanceAnswerValue } from "./views";

const DanceEditor = lazy(() => import("./Editor").then((m) => ({ default: m.DanceEditor })));

/** «Танцевальный батл»: карточки Батл / Танец / Караоке, оценки других команд и голос за победителя. */
export const dance: Mechanic<DanceContent, DanceAnswerValue> = {
  id: "dance",
  title: "Танцевальный батл",
  supports: { solo: true, teams: true, noScreen: false },
  create: createDance,
  parse: parseDance,
  mediaIds: () => [],
  Editor: DanceEditor,
  ScreenView: DanceScreenView,
  PlayerView: DancePlayerView,
  HostControls: DanceHostControls,
  steps: danceSteps,
  score,
  validate: validateDance,
  preview: { driver: dancePreview, teams: 3, limit: 50 },
};
