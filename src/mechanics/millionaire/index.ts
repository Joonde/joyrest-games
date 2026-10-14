import { lazy } from "react";
import type { Mechanic } from "../types";
import { millionairePreview } from "./preview";
import { createMillionaire, levelsOf, parseMillionaire, type MillionaireContent } from "./content";
import { MillionaireHostControls } from "./HostControls";
import { levelToPlay, millionaireSteps, parseMillionaireResult, score } from "./logic";
import { validateMillionaire } from "./validate";
import { MillionairePlayerView, MillionaireScreenView, type MillionaireAnswerValue } from "./views";

const MillionaireEditor = lazy(() => import("./Editor").then((m) => ({ default: m.MillionaireEditor })));

/** «Кто хочет стать миллионером»: лестница из 12 вопросов, полоска у каждой команды, 6 подсказок. */
export const millionaire: Mechanic<MillionaireContent, MillionaireAnswerValue> = {
  id: "millionaire",
  title: "Кто хочет стать миллионером",
  supports: { solo: true, teams: true, noScreen: true },
  create: createMillionaire,
  parse: parseMillionaire,
  mediaIds: () => [],
  Editor: MillionaireEditor,
  ScreenView: MillionaireScreenView,
  PlayerView: MillionairePlayerView,
  HostControls: MillionaireHostControls,
  steps: millionaireSteps,
  score,
  validate: validateMillionaire,
  preview: { driver: millionairePreview, teams: 3, limit: 45 },
  // Пока вопрос открыт (и зал голосует) — музыка напряжения; на старших ступенях — быстрее.
  music: (session, content) => {
    const r = parseMillionaireResult(session.state.result);
    if (session.state.phase !== "playing" || session.state.stage !== "question" || (r.mode !== "question" && r.mode !== "audience")) return null;
    // «Звонок другу»: музыка уходит, чтобы команде было слышно разговор (решение владельца 14 октября 2026).
    if (r.callEndsAt !== null && Date.now() < r.callEndsAt) return null;
    return levelToPlay(r, r.turn) > Math.floor(levelsOf(content) / 2) ? "thinkHigh" : "thinkLow";
  },
};
