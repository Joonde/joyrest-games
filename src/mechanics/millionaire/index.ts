import { lazy } from "react";
import type { Mechanic } from "../types";
import { millionairePreview } from "./preview";
import { createMillionaire, parseMillionaire, type MillionaireContent } from "./content";
import { MillionaireHostControls } from "./HostControls";
import { millionaireSteps, score } from "./logic";
import { validateMillionaire } from "./validate";
import { MillionairePlayerView, MillionaireScreenView, type MillionaireAnswerValue } from "./views";

const MillionaireEditor = lazy(() => import("./Editor").then((m) => ({ default: m.MillionaireEditor })));

/** «Кто хочет стать миллионером»: лестница из 12 вопросов, полоска у каждой команды, 6 подсказок. */
export const millionaire: Mechanic<MillionaireContent, MillionaireAnswerValue> = {
  id: "millionaire",
  title: "Кто хочет стать миллионером",
  supports: { solo: true, teams: true, noScreen: true },
  create: createMillionaire,
  parse: parseMillionaire,
  mediaIds: () => [],
  Editor: MillionaireEditor,
  ScreenView: MillionaireScreenView,
  PlayerView: MillionairePlayerView,
  HostControls: MillionaireHostControls,
  steps: millionaireSteps,
  score,
  validate: validateMillionaire,
  preview: { driver: millionairePreview, teams: 3, limit: 45 },
};
