import { lazy } from "react";
import type { Mechanic } from "../types";
import { createMafia, parseMafia, type MafiaContent } from "./content";
import { MafiaHostControls } from "./HostControls";
import { mafiaSteps, parseMafiaResult, score } from "./logic";
import { validateMafia } from "./validate";
import { MafiaPlayerView, MafiaScreenView, type MafiaAnswerValue } from "./views";

const MafiaEditor = lazy(() => import("./Editor").then((m) => ({ default: m.MafiaEditor })));

/** «Мафия» (клубная классика): тайные роли на телефонах, ночные ходы всех игроков, тайное голосование. */
export const mafia: Mechanic<MafiaContent, MafiaAnswerValue> = {
  id: "mafia",
  title: "Мафия",
  supports: { solo: true, teams: false, noScreen: true },
  create: createMafia,
  parse: parseMafia,
  mediaIds: () => [],
  Editor: MafiaEditor,
  ScreenView: MafiaScreenView,
  PlayerView: MafiaPlayerView,
  HostControls: MafiaHostControls,
  steps: mafiaSteps,
  score,
  validate: validateMafia,
  // Таблица очков посреди партии не нужна: очки — только в конце.
  ownPeek: true,
  // Ночь (и раздача ролей): тихая таинственная музыка на экране зала.
  music: (session) => {
    if (session.state.phase !== "playing" || session.state.result === null || session.state.result === undefined) return null;
    const mode = parseMafiaResult(session.state.result).mode;
    return mode === "night" || mode === "deal" || mode === "roles" ? "mafiaNight" : null;
  },
};
