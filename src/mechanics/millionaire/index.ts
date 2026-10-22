import { lazy } from "react";
import { clock } from "../../data";
import type { Mechanic } from "../types";
import { millionairePreview } from "./preview";
import { createMillionaire, parseMillionaire, type MillionaireContent } from "./content";
import { MillionaireHostControls } from "./HostControls";
import { millionaireSteps, parseMillionaireResult, score } from "./logic";
import { validateMillionaire } from "./validate";
import { MillionairePlayerView, MillionaireScreenView, type MillionaireAnswerValue } from "./views";

const MillionaireEditor = lazy(() => import("./Editor").then((m) => ({ default: m.MillionaireEditor })));

/** «Миллион на кону»: лестница из 12 вопросов, полоска у каждой команды, 6 подсказок. */
export const millionaire: Mechanic<MillionaireContent, MillionaireAnswerValue> = {
  id: "millionaire",
  title: "Миллион на кону",
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
  // Музыка владельца (14 октября 2026): гости входят и появляются поля — «milStart» (до первого вопроса); вопрос открыт —
  // «milBed» до последних 10 секунд таймера (дальше тикает таймер); зал голосует — «milVote».
  music: (session) => {
    const r = parseMillionaireResult(session.state.result);
    if (session.state.phase === "lobby") return "milStart";
    if (session.state.phase !== "playing") return null;
    if (session.state.stage === "ready" && r.seen.length === 0) return "milStart";
    if (session.state.stage !== "question") return null;
    if (r.mode === "audience") return "milVote";
    if (r.mode !== "question") return null;
    // «Звонок другу»: музыка уходит, чтобы команде было слышно разговор (решение владельца 14 октября 2026).
    if (r.callEndsAt !== null && Date.now() < r.callEndsAt) return null;
    const { startedAt, timeLimit } = session.state;
    if (typeof startedAt === "number" && timeLimit !== null && Date.now() + clock.offset() > startedAt + (timeLimit - 10) * 1000) return null;
    return "milBed";
  },
};
