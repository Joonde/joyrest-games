import { lazy } from "react";
import type { Mechanic } from "../types";
import { createSpy, parseSpy, type SpyContent } from "./content";
import { SpyHostControls } from "./HostControls";
import { score, spySteps, type SpyAnswerValue } from "./logic";
import { spyPreview } from "./preview";
import { validateSpy } from "./validate";
import { SpyPlayerView, SpyScreenView } from "./views";

const SpyEditor = lazy(() => import("./Editor").then((m) => ({ default: m.SpyEditor })));

/** «Шпион» (по мотивам Spyfall): все знают локацию, кроме шпиона; вопросы по кругу, тайное голосование. */
export const spy: Mechanic<SpyContent, SpyAnswerValue> = {
  id: "spy",
  title: "Шпион",
  supports: { solo: true, teams: false, noScreen: true },
  // Своё награждение на пульте (партии, «Закончить и наградить»): общая «Наградить сейчас» не нужна.
  ownAward: true,
  create: createSpy,
  parse: parseSpy,
  mediaIds: () => [],
  Editor: SpyEditor,
  ScreenView: SpyScreenView,
  PlayerView: SpyPlayerView,
  HostControls: SpyHostControls,
  steps: spySteps,
  score,
  validate: validateSpy,
  preview: { driver: spyPreview, teams: 6, limit: 40 },
  // Таблица очков посреди партии не нужна: очки — только в итоге партии.
  ownPeek: true,
};
