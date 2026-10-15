import { lazy } from "react";
import type { Mechanic } from "../types";
import { wagerPreview } from "./preview";
import { createWager, parseWager, type WagerContent } from "./content";
import { WagerHostControls } from "./HostControls";
import { score, wagerSteps } from "./logic";
import { validateWager } from "./validate";
import { WagerPlayerView, WagerScreenView, type WagerAnswerValue } from "./views";

const WagerEditor = lazy(() => import("./Editor").then((m) => ({ default: m.WagerEditor })));

/** «Держи пари»: догадки числом, поле с коэффициентами, фишки на самую точную догадку. */
export const wager: Mechanic<WagerContent, WagerAnswerValue> = {
  id: "wager",
  title: "Держи пари",
  supports: { solo: true, teams: true, noScreen: false },
  create: createWager,
  parse: parseWager,
  mediaIds: () => [],
  Editor: WagerEditor,
  ScreenView: WagerScreenView,
  PlayerView: WagerPlayerView,
  HostControls: WagerHostControls,
  steps: wagerSteps,
  score,
  validate: validateWager,
  preview: { driver: wagerPreview, teams: 3, limit: 50 },
};
