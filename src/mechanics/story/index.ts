import { lazy } from "react";
import type { Mechanic } from "../types";
import { createStory, parseStory, type StoryContent } from "./content";
import { StoryHostControls } from "./HostControls";
import { score, storySteps } from "./logic";
import { validateStory } from "./validate";
import { StoryPlayerView, StoryScreenView, type StoryAnswerValue } from "./views";

const StoryEditor = lazy(() => import("./Editor").then((m) => ({ default: m.StoryEditor })));

/** «Давайте знакомиться»: пять разделов-знакомств — чья история, сочиняем историю, что было дальше, две правды и ложь, кто это сказал. */
export const story: Mechanic<StoryContent, StoryAnswerValue> = {
  id: "story",
  title: "Давайте знакомиться",
  supports: { solo: true, teams: true, noScreen: true },
  create: createStory,
  parse: parseStory,
  mediaIds: () => [],
  Editor: StoryEditor,
  ScreenView: StoryScreenView,
  PlayerView: StoryPlayerView,
  HostControls: StoryHostControls,
  steps: storySteps,
  score,
  validate: validateStory,
};
