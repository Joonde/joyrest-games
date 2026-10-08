import { lazy } from "react";
import type { Mechanic } from "../types";
import { createSurvival, parseSurvival, type SurvivalContent } from "./content";
import { SurvivalHostControls } from "./HostControls";
import { score, survivalSteps } from "./logic";
import { validateSurvival } from "./validate";
import { SurvivalPlayerView, SurvivalScreenView, type SurvivalAnswerValue } from "./views";

const SurvivalEditor = lazy(() => import("./Editor").then((m) => ({ default: m.SurvivalEditor })));

/** «Гонка на выживание»: до 30 раундов, войнушки со ставками, аукцион билета освобождения. */
export const survival: Mechanic<SurvivalContent, SurvivalAnswerValue> = {
  id: "survival",
  title: "Гонка на выживание",
  supports: { solo: true, teams: true, noScreen: true },
  create: createSurvival,
  parse: parseSurvival,
  mediaIds: () => [],
  Editor: SurvivalEditor,
  ScreenView: SurvivalScreenView,
  PlayerView: SurvivalPlayerView,
  HostControls: SurvivalHostControls,
  steps: survivalSteps,
  score,
  validate: validateSurvival,
};
