import { lazy } from "react";
import type { Mechanic } from "../types";
import { createOlymp, parseOlymp, validateOlymp, type OlympContent } from "./content";
import { OlympHostControls } from "./HostControls";
import { olympSteps, score } from "./logic";
import { OlympPlayerView, OlympScreenView, type OlympAnswerValue } from "./views";

const OlympEditor = lazy(() => import("./Editor").then((m) => ({ default: m.OlympEditor })));

/** «Олимп»: ролевая история про греческих богов — сцены, проверки d100, голосования, бои, концовки. */
export const olymp: Mechanic<OlympContent, OlympAnswerValue> = {
  id: "olymp",
  title: "Олимп",
  supports: { solo: true, teams: true, noScreen: false },
  create: createOlymp,
  parse: parseOlymp,
  mediaIds: () => [],
  Editor: OlympEditor,
  ScreenView: OlympScreenView,
  PlayerView: OlympPlayerView,
  HostControls: OlympHostControls,
  steps: olympSteps,
  score,
  validate: validateOlymp,
};
