/** Раскладка пульта телефона без React: какие приборы ставить по два в ряд. */
import type { PanelControlView } from "../rules/types";

/** Короткие приборы (кнопка, тумблер) помещаются в полширины. */
const SHORT: ReadonlySet<PanelControlView["type"]> = new Set(["button", "toggle"]);

/**
 * Приборы в полширины (как в макете ph-flip): короткие — парами по порядку; непарный короткий — во всю ширину, чтобы рядом
 * не было пустого места. Так 4 прибора третьего перелёта помещаются в первый экран 360×640 и 320×568 (аудит 2b, №9).
 */
export function halfControls(panel: readonly Pick<PanelControlView, "id" | "type">[]): Set<string> {
  const short = panel.filter((c) => SHORT.has(c.type));
  const pairs = short.length - (short.length % 2);
  return new Set(short.slice(0, pairs).map((c) => c.id));
}

/** Имя кандидата не длиннее — «короткое». */
export const VOTE_SHORT_NAME = 14;

/** Голосование в два столбца — только если кандидатов больше пяти и все имена короткие; длинные — в один столбец, целиком. */
export function twoColumns(candidates: ReadonlyArray<{ name: string }>): boolean {
  return candidates.length > 5 && candidates.every((c) => [...c.name].length <= VOTE_SHORT_NAME);
}
