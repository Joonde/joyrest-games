import { lazy } from "react";
import { EVENING_MECHANIC } from "../../core/program";
import type { Mechanic } from "../types";
import { createEvening, parseEvening, type EveningContent } from "./content";
import { EveningHostControls } from "./HostControls";
import { validateEvening } from "./validate";
import { EveningPlayerView, EveningScreenView } from "./views";

const EveningEditor = lazy(() => import("./Editor").then((m) => ({ default: m.EveningEditor })));

/**
 * «Мероприятие из блоков»: в студии — программа вечера, на сессии — перерыв между блоками и итоги вечера
 * (сами игры вечера идут своими механиками, `src/core/program.ts`).
 */
export const evening: Mechanic<EveningContent, never> = {
  id: EVENING_MECHANIC,
  title: "Мероприятие из блоков",
  supports: { solo: true, teams: true, noScreen: true },
  create: createEvening,
  parse: parseEvening,
  mediaIds: () => [],
  Editor: EveningEditor,
  ScreenView: EveningScreenView,
  PlayerView: EveningPlayerView,
  HostControls: EveningHostControls,
  steps: () => [{ id: "evening", answerable: false }],
  score: () => [],
  validate: validateEvening,
  ownPeek: true,
};
