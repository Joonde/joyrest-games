/** Отзывы по оценке (решение владельца 15 октября 2026): отличные, хорошие, средние, плохие. */
export type RatingGroup = "all" | "excellent" | "good" | "average" | "bad";

export const RATING_GROUPS: Array<{ id: RatingGroup; label: string }> = [
  { id: "all", label: "Любая оценка" },
  { id: "excellent", label: "Отличные ★5" },
  { id: "good", label: "Хорошие ★4" },
  { id: "average", label: "Средние ★3" },
  { id: "bad", label: "Плохие ★1–2" },
];

export function ratingGroupOf(rating: number): Exclude<RatingGroup, "all"> {
  if (rating >= 5) return "excellent";
  if (rating === 4) return "good";
  if (rating === 3) return "average";
  return "bad";
}

export function inRatingGroup(rating: number, group: RatingGroup): boolean {
  return group === "all" || ratingGroupOf(rating) === group;
}
