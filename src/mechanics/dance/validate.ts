import type { ValidationError } from "../types";
import { embedUrl, KIND_TITLES, REMIX_COUNT, REMIX_LIMITS, type DanceContent } from "./content";

export function validateDance(content: DanceContent): ValidationError[] {
  const errors: ValidationError[] = [];
  if (content.cards.length === 0) errors.push({ path: "cards", message: "Добавьте хотя бы одну карточку: батл, танец, караоке или «Танцуй иначе»." });
  content.cards.forEach((c, i) => {
    const where = `Карточка ${i + 1} (${KIND_TITLES[c.kind]})`;
    if (c.kind === "special") {
      if (c.remix.length !== REMIX_COUNT || c.remix.some((clip) => !clip.trackId)) errors.push({ path: `cards/${c.id}/remix`, message: `${where}: выберите все 3 трека ремикса.` });
      if (c.remix.some((clip) => clip.length < REMIX_LIMITS.minLength || clip.length > REMIX_LIMITS.maxLength)) errors.push({ path: `cards/${c.id}/remix`, message: `${where}: длина каждого фрагмента должна быть ${REMIX_LIMITS.minLength}–${REMIX_LIMITS.maxLength} секунд.` });
      return;
    }
    // Без видео и трека можно, если есть название: музыку ведущий включает сам (колонка, телефон).
    if (c.video.source === "none" && !c.trackId && !c.title.trim()) errors.push({ path: `cards/${c.id}/title`, message: `${where}: добавьте название, видео или трек.` });
    if (c.video.source === "server" && !c.video.url) errors.push({ path: `cards/${c.id}/video`, message: `${where}: выберите видео JoyRest или «Без видео».` });
    if (c.video.source === "link" && !embedUrl(c.video.url)) errors.push({ path: `cards/${c.id}/video`, message: `${where}: ссылка должна вести на ролик YouTube, VK Видео или Rutube.` });
  });
  return errors;
}
