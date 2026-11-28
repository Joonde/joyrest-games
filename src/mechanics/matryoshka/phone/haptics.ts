/**
 * Вибрация телефона «Игр Матрёшки» (решение владельца: на телефоне звука нет — вибрация, где есть; на iPhone её нет — молча
 * ничего). Шаблоны — коротко и по делу: начал бежать, Матрёшка обернулась, поймали, трещина, сел, не хватило стула, принято.
 */
export const BUZZ = {
  /** Начал бежать (палец на зоне). */
  run: [25],
  /** «ЗАМРИ!» — по сверенным часам телефона, в назначенный момент поворота. */
  gaze: [90, 50, 90],
  caught: [220],
  crack: [60, 40, 140],
  seated: [40],
  missed: [40, 80, 40],
  /** Своё действие принято (стул, «Прыгаю первым!», ответ, жест). */
  ok: [20],
  /** Пряник обведён целиком, победа в дуэли. */
  win: [40, 60, 40, 60, 120],
} as const satisfies Record<string, readonly number[]>;

export type BuzzKind = keyof typeof BUZZ;

export function canVibrate(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

/** Вибрировать, если телефон умеет; ошибки браузера (вкладка в фоне, нет разрешения) игре не мешают. */
export function buzz(kind: BuzzKind): void {
  if (!canVibrate()) return;
  // До первого касания страницы браузер вибрацию не даёт (и пишет ошибку в консоль) — молча пропускаем.
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (activation && !activation.hasBeenActive) return;
  try {
    navigator.vibrate([...BUZZ[kind]]);
  } catch {
    // Нет вибрации — ничего.
  }
}
