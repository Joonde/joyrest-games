import { lazy } from "react";
import type { Mechanic, ValidationError } from "../types";
import { createDurak, parseDurak, type DurakContent } from "./content";
import { DurakHostControls } from "./HostControls";
import { durakSteps, score, type DurakAnswerValue } from "./logic";
import { DurakPlayerView, DurakScreenView } from "./views";

const DurakEditor = lazy(() => import("./Editor").then((m) => ({ default: m.DurakEditor })));

function validateDurak(content: DurakContent): ValidationError[] {
  const errors: ValidationError[] = [];
  if (content.turnSeconds !== 0 && content.turnSeconds < 10) errors.push({ path: "settings/turnSeconds", message: "Время на ход — от 10 секунд или 0 (без таймера)." });
  return errors;
}

/** «Дурак» (подкидной и переводной): стол с крупье на экране зала, свои карты на телефоне веером. */
export const durak: Mechanic<DurakContent, DurakAnswerValue> = {
  id: "durak",
  title: "Дурак",
  supports: { solo: true, teams: true, noScreen: true },
  create: createDurak,
  parse: parseDurak,
  mediaIds: () => [],
  Editor: DurakEditor,
  ScreenView: DurakScreenView,
  PlayerView: DurakPlayerView,
  HostControls: DurakHostControls,
  steps: durakSteps,
  score,
  validate: validateDurak,
  // Таблица очков посреди партии не нужна: очки — по итогу каждой партии.
  ownPeek: true,
  // Тихий фон за столом всю игру (на экране зала), кроме награждения.
  music: (session) => (session.state.phase === "playing" && session.state.stage !== "podium" ? "durakTable" : null),
};
