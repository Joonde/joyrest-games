// «Не моя история»: каждый гость тайно пишет на телефоне случай из жизни. На экране — история без
// имени, все голосуют, чья она. Угадал — очки; никто не угадал — очки автору.

export interface StoryContent {
  /** Подсказка гостям: о чём писать. */
  prompt: string;
  /** Примеры под полем ввода (по одному в строке). */
  examples: string[];
  /** Секунд на голосование. */
  guessSeconds: number;
  /** Очки за верную догадку. */
  guessPoints: number;
  /** Очки автору, если никто не угадал. */
  authorBonus: number;
  /** Сколько историй играть (0 — все). */
  maxStories: number;
}

export const STORY_LIMITS = { prompt: 160, example: 120, examples: 6, story: 280, minSeconds: 10, maxSeconds: 120, maxPoints: 1000, maxStories: 50 } as const;

export function createStory(): StoryContent {
  return {
    prompt: "Напишите случай из своей жизни, о котором здесь почти никто не знает",
    examples: ["В детстве я три года подряд ходил в кружок балета", "Я однажды опоздала на самолёт, потому что уснула в аэропорту", "Я пел в метро и заработал 300 рублей"],
    guessSeconds: 30,
    guessPoints: 100,
    authorBonus: 150,
    maxStories: 15,
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

export function parseStory(raw: unknown): StoryContent {
  const d = record(raw);
  const base = createStory();
  const examples = Array.isArray(d.examples) ? d.examples.map((e) => cleanText(e, STORY_LIMITS.example)).filter(Boolean).slice(0, STORY_LIMITS.examples) : base.examples;
  return {
    prompt: cleanText(d.prompt, STORY_LIMITS.prompt) || base.prompt,
    examples,
    guessSeconds: int(d.guessSeconds, base.guessSeconds, STORY_LIMITS.minSeconds, STORY_LIMITS.maxSeconds),
    guessPoints: int(d.guessPoints, base.guessPoints, 0, STORY_LIMITS.maxPoints),
    authorBonus: int(d.authorBonus, base.authorBonus, 0, STORY_LIMITS.maxPoints),
    maxStories: int(d.maxStories, base.maxStories, 0, STORY_LIMITS.maxStories),
  };
}
