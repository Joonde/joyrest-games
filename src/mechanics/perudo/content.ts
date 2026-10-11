// «Перудо» (кости лжеца, как в «Пиратах Карибского моря»): у каждого стакан с костями, свои кости видит
// только он. Ставки по кругу: «на столе не меньше N костей с гранью F», единицы — джокеры. Следующий
// поднимает ставку, говорит «Не верю!» (Dudo) или «Ровно!» (Calza). Кто ошибся — теряет кость.
// Последний с костями побеждает. Игроки или команды (стакан у капитана).

export interface PerudoContent {
  /** Костей у каждого в начале (классика — 5). */
  startDice: number;
  /** Можно говорить «Ровно!» (Calza): угадал точно — кость назад, нет — минус кость. */
  calza: boolean;
  /** Раунд «Палифико»: у кого осталась одна кость — единицы не джокеры, грань не меняется. */
  palifico: boolean;
  /** Очки за каждого, кто выбыл раньше тебя. */
  placePoints: number;
  /** Очки победителю сверху. */
  winPoints: number;
  /** Партий за игру (очки копятся). */
  parties: number;
}

export const PERUDO_LIMITS = { minDice: 1, maxDice: 6, maxCups: 10, maxPoints: 2000, maxParties: 5 } as const;

export function createPerudo(): PerudoContent {
  return { startDice: 5, calza: true, palifico: true, placePoints: 50, winPoints: 200, parties: 1 };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

export function parsePerudo(raw: unknown): PerudoContent {
  const d = record(raw);
  const base = createPerudo();
  return {
    startDice: int(d.startDice, base.startDice, PERUDO_LIMITS.minDice, PERUDO_LIMITS.maxDice),
    calza: d.calza !== false,
    palifico: d.palifico !== false,
    placePoints: int(d.placePoints, base.placePoints, 0, PERUDO_LIMITS.maxPoints),
    winPoints: int(d.winPoints, base.winPoints, 0, PERUDO_LIMITS.maxPoints),
    parties: int(d.parties, base.parties, 1, PERUDO_LIMITS.maxParties),
  };
}
