import { lazy } from "react";
import type { Mechanic } from "../types";
import { createContent, mediaIds, parseContent, type QuizContent } from "./content";
import { score, steps, type QuizStep } from "./logic";
import { validateContent } from "./validate";
import { QuizHostControls } from "./HostControls";
import { QuizPlayerView, QuizScreenView, type QuizAnswerValue } from "./views";

// Конструктор нужен только в студии: отдельный чанк, телефон гостя его не качает.
const QuizEditor = lazy(() => import("./Editor").then((m) => ({ default: m.QuizEditor })));

/** Квиз: варианты, открытый ответ, на скорость, музыка, гонка с кнопкой, несколько картинок. */
export const quiz: Mechanic<QuizContent, QuizAnswerValue, QuizStep> = {
  id: "quiz",
  title: "Квиз",
  supports: { solo: true, teams: true, noScreen: true },
  create: createContent,
  parse: parseContent,
  mediaIds,
  Editor: QuizEditor,
  ScreenView: QuizScreenView,
  PlayerView: QuizPlayerView,
  HostControls: QuizHostControls,
  steps,
  score,
  validate: validateContent,
};
