import { lazy } from "react";
import type { Mechanic } from "../types";
import { createBunker, parseBunker, type BunkerContent } from "./content";
import { BunkerHostControls } from "./HostControls";
import { bunkerSteps, score } from "./logic";
import { validateBunker } from "./validate";
import { BunkerPlayerView, BunkerScreenView, type BunkerAnswerValue } from "./views";

const BunkerEditor = lazy(() => import("./Editor").then((m) => ({ default: m.BunkerEditor })));

/** «Бункер»: катастрофа, мест — на половину игроков; карты персонажей тайно на телефонах, изгнание голосованием. */
export const bunker: Mechanic<BunkerContent, BunkerAnswerValue> = {
  id: "bunker",
  title: "Бункер",
  supports: { solo: true, teams: false, noScreen: true },
  create: createBunker,
  parse: parseBunker,
  mediaIds: () => [],
  Editor: BunkerEditor,
  ScreenView: BunkerScreenView,
  PlayerView: BunkerPlayerView,
  HostControls: BunkerHostControls,
  steps: bunkerSteps,
  score,
  validate: validateBunker,
  ownPeek: true,
};
