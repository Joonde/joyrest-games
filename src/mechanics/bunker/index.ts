import { lazy } from "react";
import type { Mechanic } from "../types";
import { createBunker, parseBunker, type BunkerContent } from "./content";
import { BunkerHostControls } from "./HostControls";
import { bunkerPreview } from "./preview";
import { bunkerSteps, score } from "./logic";
import { validateBunker } from "./validate";
import { BunkerPlayerView, BunkerScreenView, type BunkerAnswerValue } from "./views";

const BunkerEditor = lazy(() => import("./Editor").then((m) => ({ default: m.BunkerEditor })));

/** «Бункер»: катастрофа, мест — на половину игроков; карты персонажей тайно на телефонах, изгнание голосованием. */
export const bunker: Mechanic<BunkerContent, BunkerAnswerValue> = {
  id: "bunker",
  title: "Бункер",
  supports: { solo: true, teams: false, noScreen: true },
  // Своё награждение на пульте (партии, «Закончить и наградить»): общая «Наградить сейчас» не нужна.
  ownAward: true,
  // Счётчик «Ответили» пульт механики пишет сам.
  ownAnswered: true,
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
  // Бункер — от 4 игроков; 5 раундов круга открытия — длинный предпросмотр.
  preview: { driver: bunkerPreview, teams: 4, limit: 64 },
  ownPeek: true,
};
