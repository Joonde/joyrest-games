import type { Fig } from "./who";

export interface MotionDance {
  key: string;
  title: string;
  dancers: number;
  figs: Fig[];
}

/** Шесть хореографий из автономного приложения v2 (`public/dance/tanec_app.html`). */
export const MOTION_DANCES: MotionDance[] = [
  { key: "bailar", title: "Bailar", dancers: 1, figs: ["a"] },
  { key: "despacito", title: "Despacito", dancers: 4, figs: ["m", "w", "m", "w"] },
  { key: "scream", title: "Scream & Shout", dancers: 4, figs: ["m", "w", "a", "w"] },
  { key: "pound", title: "Pound the Alarm", dancers: 4, figs: ["w", "m", "w", "m"] },
  { key: "uptown", title: "Uptown Funk", dancers: 3, figs: ["m", "a", "w"] },
  { key: "animals", title: "Animals", dancers: 2, figs: ["m", "w"] },
];

export function motionDance(key: unknown): MotionDance | null {
  return typeof key === "string" ? (MOTION_DANCES.find((dance) => dance.key === key) ?? null) : null;
}

export type { DanceAttemptSummary } from "../../data/types";
