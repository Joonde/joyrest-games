import type { ValidationError } from "../types";
import { cardCells, type LottoContent } from "./content";

export function validateLotto(content: LottoContent): ValidationError[] {
  const errors: ValidationError[] = [];
  const need = cardCells(content);
  if (content.songs.length < need) {
    errors.push({ path: "songs", message: `Для карточки ${content.size}×${content.size} нужно хотя бы ${need} песен (сейчас ${content.songs.length}). Лучше на 5–10 больше: карточки будут разнее.` });
  }
  const seen = new Set<string>();
  for (const song of content.songs) {
    const key = song.title.trim().toLowerCase().replace(/ё/g, "е");
    if (!key) errors.push({ path: `songs/${song.id}/title`, message: "Напишите название песни." });
    else if (seen.has(`${key}|${song.artist.trim().toLowerCase()}`)) errors.push({ path: `songs/${song.id}/title`, message: "Такая песня уже есть — на карточке будут две одинаковые клетки." });
    seen.add(`${key}|${song.artist.trim().toLowerCase()}`);
  }
  if ((content.prizes[0] ?? 0) <= 0) errors.push({ path: "prizes", message: "Первому победителю нужны очки." });
  return errors;
}
