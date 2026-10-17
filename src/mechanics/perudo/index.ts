import { lazy } from "react";
import type { Mechanic } from "../types";
import { createPerudo, parsePerudo, type PerudoContent } from "./content";
import { PerudoHostControls } from "./HostControls";
import { perudoPreview } from "./preview";
import { perudoSteps, score, type PerudoAnswerValue } from "./logic";
import { validatePerudo } from "./validate";
import { PerudoPlayerView, PerudoScreenView } from "./views";

const PerudoEditor = lazy(() => import("./Editor").then((m) => ({ default: m.PerudoEditor })));

/** «Перудо» — кости лжеца: тайные кости на телефонах, ставки по кругу, «Не верю!» и вскрытие на экране. */
export const perudo: Mechanic<PerudoContent, PerudoAnswerValue> = {
  id: "perudo",
  title: "Перудо — кости лжеца",
  supports: { solo: true, teams: true, noScreen: true },
  // Своё награждение на пульте (партии, «Закончить и наградить»): общая «Наградить сейчас» не нужна.
  ownAward: true,
  create: createPerudo,
  parse: parsePerudo,
  mediaIds: () => [],
  Editor: PerudoEditor,
  ScreenView: PerudoScreenView,
  PlayerView: PerudoPlayerView,
  HostControls: PerudoHostControls,
  steps: perudoSteps,
  score,
  validate: validatePerudo,
  preview: { driver: perudoPreview, teams: 3, limit: 60 },
};
