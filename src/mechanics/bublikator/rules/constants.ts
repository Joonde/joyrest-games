/**
 * Числа «Бубликатора» (docs/bublikator.md, ТЗ «Три игры», вкладка «Бубликатор»). Все времена — в мс, если не сказано иначе.
 * Меняются числа — правится docs/bublikator.md в том же коммите.
 */

export const BUBLIKATOR = "bublikator";

// ------------------------------------------------------------ приказы
/** Приказ засчитан, когда прибор простоял в нужном положении столько (прохождение «через» цель не считается). */
export const HOLD_MS = 700;
/** Прибор с активным приказом остановился (простоял HOLD_MS) в неверном положении — у приказа сгорает столько. */
export const WRONG_STOP_MS = 2000;
/** Новый приказ — через столько после выполнения… */
export const NEXT_AFTER_DONE_MS = 500;
/** …после просрочки и отмены. */
export const NEXT_AFTER_FAIL_MS = 1000;
/** Доля приказов про чужой прибор. */
export const FOREIGN_SHARE = 0.8;
/** Доля ложных приказов диверсанта («примерно каждый третий»). */
export const FAKE_SHARE = 1 / 3;
/** Время на приказ, секунды: сложность × перелёт. */
export const ORDER_SECONDS: Record<"kids" | "normal" | "crazy", readonly [number, number, number]> = {
  kids: [16, 14, 12],
  normal: [12, 10, 8],
  crazy: [10, 8, 6],
};
/** Шаг кнопок пульта «Медленнее / Быстрее» и пределы времени приказа, секунды. */
export const ORDER_SHIFT_STEP_S = 2;
export const ORDER_MIN_S = 4;
export const ORDER_MAX_S = 30;
/** С одного телефона — не больше столько движений приборов в секунду (лишние не принимаются). */
export const MOVES_PER_SECOND = 5;

// ------------------------------------------------------------ корпус, ремонт, дальность
export const HULL_MAX = 5;
export const HULL_AFTER_REPAIR = 3;
export const REPAIR_MS = 10_000;
export const REPAIR_MIN_MS = 5000;
/** «Чиним вместе»: цель — столько нажатий на человека на связи (n, не меньше 3). */
export const REPAIR_TAPS_PER_PERSON = 30;
/** Урон за просрочку и выполненный ложный приказ: 4 ÷ n. */
export const ORDER_DAMAGE = 4;
/** n в формулах — не меньше 3. */
export const MIN_N = 3;
/** Дальность от приказов за перелёт — до 1 000; дошли — финиш. */
export const DISTANCE_MAX = 1000;
/** c = 7,5 × длительность перелёта в минутах. */
export const C_PER_MINUTE = 7.5;
/** Финиш раньше времени: +2 за каждую оставшуюся целую секунду перелёта. */
export const FINISH_BONUS_PER_S = 2;
/** Скорость на экране — импульсы за последние 10 секунд. */
export const SPEED_WINDOW_MS = 10_000;
/** Серия от 5 приказов — огненный шлейф на экране. */
export const FIRE_STREAK = 5;

// ------------------------------------------------------------ этапы
export const LAUNCH_MS = 5000;
export const DRILL_MS = 30_000;
export const CREWS_MS = 15_000;
export const DOCK_MS = 10_000;
export const VOTE_MS = 20_000;
/** Сколько человек в экипаже, если делить зал (ceil(N / 7)); экипажей — до 20. */
export const CREW_SPLIT = 7;
export const CREWS_MAX = 20;
export const CREW_SIZE_DEFAULT = { min: 3, max: 10 } as const;

// ------------------------------------------------------------ события
export const WARN_MS = 3000;
export const EVENT_MS = { meteor: 10_000, pull: 20_000, sos: 15_000, captain: 60_000 } as const;
/** Не в первые 30 и не в последние 20 секунд полёта, между событиями — не меньше 30 секунд полёта. */
export const EVENT_EDGE_START_MS = 30_000;
export const EVENT_EDGE_END_MS = 20_000;
export const EVENT_GAP_MS = 30_000;
/** «Метеоритный дождь»: эталон силы — 100; без датчика 6 нажатий в секунду за 10 с = 100. */
export const METEOR_REF = 100;
export const METEOR_TAPS_REF_PER_S = 6;
export const METEOR_WEAK = 50;
export const METEOR_BAD = 25;
export const METEOR_BONUS = 20;
/** «Притяжение»: держать всем 3 с; сносит назад на 3 деления дальности в секунду. */
export const PULL_HOLD_MS = 3000;
export const PULL_DRIFT_PER_S = 3;
/** «Сигнал SOS»: длина по перелётам, 4 цвета, блок после ошибки. */
export const SOS_LENGTH = [4, 5, 6] as const;
export const SOS_COLORS = 4;
export const SOS_BLOCK_MS = 1500;
export const SOS_BONUS = 30;
/** «Все на палубу!»: звезда = +10. */
export const CAPTAIN_STAR = 10;
export const CAPTAIN_STARS_MAX = 5;
/** Диверсант угадан — экипажу +50 к общей дальности. */
export const VOTE_BONUS = 50;
export const SABOTEUR_MIN_CREW = 5;

// ------------------------------------------------------------ особые эффекты перелётов
export const FLIP_MS = 10_000;
/** «Глюк»: первые 0,7 с после перестановки нажатия не считаются; плашка на экране — 3 с. */
export const GLITCH_GUARD_MS = 700;
export const GLITCH_SHOW_MS = 3000;
/** «Глюк» и «Переворот» — не в первые и не в последние 30 секунд полёта. */
export const EFFECT_EDGE_MS = 30_000;

// ------------------------------------------------------------ связь и лимиты
/** «Без связи» — 4 с (у комнаты `offlineMs`). */
export const OFFLINE_MS = 4000;
/** «Убрать игрока» — после минуты без связи. */
export const KICK_AFTER_MS = 60_000;
/** Нажатий («Чиним!», тапы дождя, «Салют») — 15 в секунду, запас 30. */
export const TAPS_PER_SECOND = 15;
export const TAPS_BURST = 30;
/** Пустая пачка «я на связи» — раз в 2 с (у комнаты `batchMs`). */
export const BATCH_MS = 2000;
/** Своё задание «Все на палубу!» — до стольких знаков. */
export const TASK_MAX = 120;
