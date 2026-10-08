import { lazy } from "react";
import type { Mechanic } from "../types";
import { dragonPreview } from "./preview";
import { createDragon, parseDragon, type DragonContent } from "./content";
import { DragonHostControls } from "./HostControls";
import { dragonSteps, score } from "./logic";
import { validateDragon } from "./validate";
import { DragonPlayerView, DragonScreenView, type DragonAnswerValue } from "./views";

const DragonEditor = lazy(() => import("./Editor").then((m) => ({ default: m.DragonEditor })));

/** «Бой с драконом»: герои со своими силами и свойствами, бои с драконами, жизни, урон по свойству задания. */
export const dragon: Mechanic<DragonContent, DragonAnswerValue> = {
  id: "dragon",
  title: "Бой с драконом",
  supports: { solo: true, teams: true, noScreen: true },
  create: createDragon,
  parse: parseDragon,
  mediaIds: () => [],
  Editor: DragonEditor,
  ScreenView: DragonScreenView,
  PlayerView: DragonPlayerView,
  HostControls: DragonHostControls,
  steps: dragonSteps,
  score,
  validate: validateDragon,
  preview: { driver: dragonPreview, teams: 3, limit: 70 },
};
