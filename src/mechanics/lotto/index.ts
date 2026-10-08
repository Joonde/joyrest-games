import { lazy } from "react";
import type { Mechanic } from "../types";
import { lottoPreview } from "./preview";
import { createLotto, parseLotto, type LottoContent } from "./content";
import { LottoHostControls } from "./HostControls";
import { lottoSteps, score, type LottoStep } from "./logic";
import { validateLotto } from "./validate";
import { LottoPlayerView, LottoScreenView } from "./views";

const LottoEditor = lazy(() => import("./Editor").then((m) => ({ default: m.LottoEditor })));

/** Музыкальное лото: карточки песен у гостей, музыка на экране зала, «Лото!» и победители. */
export const lotto: Mechanic<LottoContent, { marks: string[] }, LottoStep> = {
  id: "lotto",
  title: "Музыкальное лото",
  supports: { solo: true, teams: true, noScreen: true },
  create: createLotto,
  parse: parseLotto,
  mediaIds: () => [],
  Editor: LottoEditor,
  ScreenView: LottoScreenView,
  PlayerView: LottoPlayerView,
  HostControls: LottoHostControls,
  steps: lottoSteps,
  score,
  validate: validateLotto,
  preview: { driver: lottoPreview, teams: 3, limit: 70 },
};
