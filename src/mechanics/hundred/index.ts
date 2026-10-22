import { lazy } from "react";
import type { Mechanic } from "../types";
import { createHundred, parseHundred, type HundredContent } from "./content";
import { HundredHostControls } from "./HostControls";
import { hundredSteps, parseHundredResult, score, type HundredStep } from "./logic";
import { hundredPreview } from "./preview";
import { validateHundred } from "./validate";
import { HundredPlayerView, HundredScreenView, type HundredAnswerValue } from "./views";

const HundredEditor = lazy(() => import("./Editor").then((m) => ({ default: m.HundredEditor })));

/** «Что скажет большинство»: табло популярных ответов, розыгрыш «Жми первым!», три ошибки и шанс соперника, «Большая игра», «Весь зал». */
export const hundred: Mechanic<HundredContent, HundredAnswerValue, HundredStep> = {
  id: "hundred",
  title: "Что скажет большинство",
  supports: { solo: true, teams: true, noScreen: true },
  create: createHundred,
  parse: parseHundred,
  mediaIds: () => [],
  Editor: HundredEditor,
  ScreenView: HundredScreenView,
  PlayerView: HundredPlayerView,
  HostControls: HundredHostControls,
  steps: hundredSteps,
  score,
  validate: validateHundred,
  ownPeek: true,
  preview: { driver: hundredPreview, teams: 3, limit: 140 },
  // Пока жмут кнопку, пишут ответы зала или идёт таймер «Большой игры» — музыка напряжения.
  music: (session) => {
    if (session.state.phase !== "playing" || session.state.stage !== "question") return null;
    const r = parseHundredResult(session.state.result);
    if (r.mode === "face") return r.armed && !r.buzz.current ? "thinkLow" : null;
    return r.mode === "hall" || r.mode === "big" ? "thinkLow" : null;
  },
};
