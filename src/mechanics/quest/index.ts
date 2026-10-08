import { lazy } from "react";
import type { Mechanic } from "../types";
import { questPreview } from "./preview";
import { createQuest, parseQuest, type QuestContent } from "./content";
import { QuestHostControls } from "./HostControls";
import { questSteps, score } from "./logic";
import { validateQuest } from "./validate";
import { QuestPlayerView, QuestScreenView, type QuestAnswerValue } from "./views";

const QuestEditor = lazy(() => import("./Editor").then((m) => ({ default: m.QuestEditor })));

/** «Активная настолка»: поле 40–100 клеток, кубик, задания, бонусы и ловушки. */
export const quest: Mechanic<QuestContent, QuestAnswerValue> = {
  id: "quest",
  title: "Активная настолка",
  supports: { solo: true, teams: true, noScreen: true },
  create: createQuest,
  parse: parseQuest,
  mediaIds: () => [],
  Editor: QuestEditor,
  ScreenView: QuestScreenView,
  PlayerView: QuestPlayerView,
  HostControls: QuestHostControls,
  steps: questSteps,
  score,
  validate: validateQuest,
  preview: { driver: questPreview, teams: 3, limit: 45 },
};
