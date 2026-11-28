import { lazy } from "react";
import type { Mechanic } from "../types";
import { createRoulette, mediaIds, parseRoulette, type RouletteContent } from "./content";
import { RouletteHostControls } from "./HostControls";
import { rouletteSteps, score } from "./logic";
import { roulettePreview } from "./preview";
import { validateRoulette } from "./validate";
import { RoulettePlayerView, RouletteScreenView, type RouletteAnswerValue } from "./views";

const RouletteEditor = lazy(() => import("./Editor").then((m) => ({ default: m.RouletteEditor })));

/**
 * «Рулетка судьбы» (паспорт LOGIC.md): капитаны выбирают темы, из них собирается общее колесо, команды по очереди крутят
 * его и выполняют задания разной редкости. Обычная механика основного канала (не игровая комната), только команды.
 * Пока скрыта от ведущих (hidden.ts) — до готовности колеса, заданий и конструктора.
 */
export const roulette: Mechanic<RouletteContent, RouletteAnswerValue> = {
  id: "roulette",
  title: "Рулетка судьбы",
  supports: { solo: false, teams: true, noScreen: false },
  create: createRoulette,
  parse: parseRoulette,
  mediaIds,
  Editor: RouletteEditor,
  ScreenView: RouletteScreenView,
  PlayerView: RoulettePlayerView,
  HostControls: RouletteHostControls,
  steps: rouletteSteps,
  score,
  validate: validateRoulette,
  // Счётчик «Ответили» пишет сама игра: только те, кто отвечает на текущем этапе (п. 1).
  ownAnswered: true,
  preview: { driver: roulettePreview, teams: 3, limit: 20 },
};
