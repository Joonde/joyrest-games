import { lazy } from "react";
import type { Mechanic } from "../types";
import { createWine, parseWine, type WineContent } from "./content";
import { WineHostControls } from "./HostControls";
import { score, wineSteps } from "./logic";
import { validateWine } from "./validate";
import { WinePlayerView, WineScreenView, type WineAnswerValue } from "./views";

const WineEditor = lazy(() => import("./Editor").then((m) => ({ default: m.WineEditor })));

/** «Винное казино» (18+): паспорта вин, фишки гостей на поле рулетки, «Открыть бутылку» — выплаты по коэффициентам. */
export const wine: Mechanic<WineContent, WineAnswerValue> = {
  id: "wine",
  title: "Винное казино",
  supports: { solo: true, teams: true, noScreen: false },
  create: createWine,
  parse: parseWine,
  mediaIds: () => [],
  Editor: WineEditor,
  ScreenView: WineScreenView,
  PlayerView: WinePlayerView,
  HostControls: WineHostControls,
  steps: wineSteps,
  score,
  validate: validateWine,
};
