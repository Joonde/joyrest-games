// «Олимп» на платформе: содержимое игры. История и правила живут в коде (`winter.ts`, `rules.ts`),
// в игре хранится только выбор истории и настройки проведения.
import type { ValidationError } from "../types";
import { validateStory, type Story } from "./story";
import { WINTER } from "./winter";

export const STORIES: Story[] = [WINTER];

export type Difficulty = "easy" | "normal" | "hard";

export const DIFFICULTIES: Array<{ id: Difficulty; title: string; hint: string; hp: number; power: number }> = [
  { id: "easy", title: "Лёгкая", hint: "для первой игры: противники слабее", hp: 0.9, power: 1.6 },
  { id: "normal", title: "Обычная", hint: "бои напряжённые, но отряд обычно побеждает", hp: 1.1, power: 2.6 },
  { id: "hard", title: "Трудная", hint: "для опытных: босс может победить", hp: 1.25, power: 3.4 },
];

export interface OlympContent {
  /** id истории (`STORIES`). */
  story: string;
  difficulty: Difficulty;
  /** Секунд на голосование (0 — без таймера, закрывает ведущий). */
  voteSeconds: number;
}

export function createOlymp(): OlympContent {
  return { story: WINTER.id, difficulty: "normal", voteSeconds: 60 };
}

const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function parseOlymp(raw: unknown): OlympContent {
  const d = rec(raw);
  const story = STORIES.some((s) => s.id === d.story) ? (d.story as string) : WINTER.id;
  const difficulty = DIFFICULTIES.some((x) => x.id === d.difficulty) ? (d.difficulty as Difficulty) : "normal";
  const vs = typeof d.voteSeconds === "number" && Number.isFinite(d.voteSeconds) ? Math.round(d.voteSeconds) : 60;
  return { story, difficulty, voteSeconds: Math.max(0, Math.min(300, vs)) };
}

export function storyOf(content: OlympContent): Story {
  return STORIES.find((s) => s.id === content.story) ?? WINTER;
}

export function difficultyOf(content: OlympContent): (typeof DIFFICULTIES)[number] {
  return DIFFICULTIES.find((d) => d.id === content.difficulty) ?? (DIFFICULTIES[1] as (typeof DIFFICULTIES)[number]);
}

export function validateOlymp(content: OlympContent): ValidationError[] {
  return validateStory(storyOf(content)).map((message) => ({ path: "questions", message }));
}
