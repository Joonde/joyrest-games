import { lazy } from "react";
import type { Mechanic } from "../types";
import { createAquarium, parseAquarium, validateAquarium, type AquariumContent } from "./content";
import { AquariumHostControls } from "./HostControls";
import { aquariumSteps, parseAquaResult, score } from "./logic";
import { aquariumPreview } from "./preview";
import { AquariumPlayerView, AquariumScreenView, type AquariumAnswer } from "./views";

const AquariumEditor = lazy(() => import("./Editor").then((m) => ({ default: m.AquariumEditor })));

/**
 * «Аквариум и Ёлка» (решение владельца 18 октября 2026, по согласованному прототипу): перерыв с раскраской — гости
 * раскрашивают на телефонах рыбок или ёлочные игрушки, рисунки оживают в 3D на экране зала. Движок раскрасок — по
 * мотивам Paper Aquarium (автор MrMoT9I, MIT).
 */
export const aquarium: Mechanic<AquariumContent, AquariumAnswer> = {
  id: "aquarium",
  title: "Аквариум и Ёлка",
  supports: { solo: true, teams: true, noScreen: false },
  create: createAquarium,
  parse: parseAquarium,
  mediaIds: () => [],
  Editor: AquariumEditor,
  ScreenView: AquariumScreenView,
  PlayerView: AquariumPlayerView,
  HostControls: AquariumHostControls,
  steps: aquariumSteps,
  score,
  validate: validateAquarium,
  ownAward: true,
  preview: { driver: aquariumPreview, teams: 3, limit: 40 },
  music: (session, content) => (session.state.phase === "playing" ? (parseAquaResult(session.state.result, content).scene === "tree" ? "treeMusic" : "aquaMusic") : null),
};
