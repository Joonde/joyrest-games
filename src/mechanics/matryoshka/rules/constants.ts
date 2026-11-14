/**
 * Числа «Игр Матрёшки» (docs/matryoshka.md, раздел «Числа»). Все времена — в мс при темпе «обычно», если не сказано иначе.
 * Меняются числа — правится docs/matryoshka.md в том же коммите.
 */

export const MATRYOSHKA = "matryoshka";
/** Режимы платформы: только «каждый сам» (решение владельца 14 ноября 2026), экран зала обязателен. */
export const MATRYOSHKA_SUPPORTS = { solo: true, teams: false, noScreen: false } as const;

// ------------------------------------------------------------ зал, сердечки, финал
export const MIN_PLAYERS = 6;
/** Расчётный максимум: на «Начать» играют первые 100 по порядку входа, остальные болеют. */
export const MAX_PLAYERS = 100;
export const FINALISTS_MIN = 2;
export const FINALISTS_MAX = 8;
export const FINALISTS_DEFAULT = 4;
/** Сердечки: дети («Солнечный двор») — 2, взрослые («Ночной двор») — 1 (решение владельца 1). */
export const LIVES_KIDS = 2;
export const LIVES_ADULTS = 1;
/** Вернувшийся («Второй шанс», «Вернуть игрока») — с одним сердечком. */
export const LIVES_RETURN = 1;
export const SECOND_CHANCE_OPTIONS = [0, 5, 10, 20] as const;
export const SECOND_CHANCE_DEFAULT = 10;
/** «Второй шанс» — после стольких сыгранных испытаний (третьего). */
export const SECOND_CHANCE_AFTER = 3;
export const TEMPO = { short: 0.75, normal: 1, long: 1.25 } as const;

// ------------------------------------------------------------ общие шаги испытания
export const OPEN_MS = 6000;
export const RULES_MS = 10_000;
export const COUNTDOWN_MS = 3000;
export const JUDGING_MS = 1500;
export const REVEAL_BASE_MS = 4000;
export const REVEAL_PER_OUT_MS = 150;
export const REVEAL_MAX_MS = 8000;
/** «Только что в сугробе» на экране — не больше. */
export const JUST_OUT_MAX = 10;

// ------------------------------------------------------------ «Замри!»
export const FREEZE_MS = 80_000;
export const TRACK = 1000;
/** Доля длительности, которую нужно держать, чтобы добежать (решение владельца 2: ~36 с из 80). */
export const HOLD_SHARE = 0.45;
/** Откат пойманного — 30% дорожки. */
export const ROLLBACK = 300;
export const PHRASE_MIN_MS = 4000;
export const PHRASE_MAX_MS = 9000;
export const GAZE_MIN_MS = 2000;
export const GAZE_MAX_MS = 4000;
export const DECOY_SHARE = 0.25;
/** Обманка — не позже чем за столько до поворота. */
export const DECOY_BEFORE_MS = 1000;
export const DECOY_LEN_MS = 300;
/** Первая фраза начинается через столько после старта бега. */
export const FIRST_PHRASE_MS = 500;
/** Окно поимки начинается через столько после поворота (время реакции). */
export const REACTION_MS = 300;
/** Голова на экране начинает поворачиваться за столько до T (только вид). */
export const HEAD_TURN_MS = 400;
/** Телефону момент поворота (и стулья) — за столько. */
export const PHONE_LEAD_MS = 1000;
/** Взгляд «устоялся» через столько после конца: свежие события к этому моменту уже пришли. */
export const FREEZE_SETTLE_MS = 1500;
/** Удержание без пачек считается ещё столько после последней пачки телефона. */
export const HOLD_GRACE_MS = 2000;
/** «+10 секунд» — шаг и предел за испытание. */
export const MORE_TIME_MS = 10_000;
export const MORE_TIME_MAX_MS = 60_000;

// ------------------------------------------------------------ «Пряник»
export const BOXES = 4;
export const PICK_MS = 10_000;
export const UNBOX_MS = 5000;
export const TRACE_MS = 45_000;
export const PIECES = 200;
/** Полоса допуска — доля ширины поля: взрослые («Ночной двор») и дети («Солнечный двор»). */
export const BAND_ADULTS = 0.03;
export const BAND_KIDS = 0.06;
/** Вне полосы дольше столько подряд — трещина (честное дрожание у линии прощается). */
export const CRACK_OUT_MS = 200;
/**
 * Против «зигзага поперёк контура» (аудит 3a, 14 ноября 2026): палец дальше стольких полос от контура — трещина сразу; вне
 * полосы в сумме дольше `CRACK_WINDOW_OUT_MS` за последние `CRACK_WINDOW_MS` — тоже трещина (короткие выходы складываются).
 */
export const CRACK_FAR = 3;
export const CRACK_WINDOW_MS = 1000;
export const CRACK_WINDOW_OUT_MS = 300;
/** Длина контура каждой фигуры, в ширинах поля (±2% — тест). */
export const SHAPE_LENGTH = 2.2;
export const SHAPE_LENGTH_TOLERANCE = 0.02;
/** Отступ фигуры от края поля. */
export const SHAPE_MARGIN = 0.05;

// ------------------------------------------------------------ «Стулья»
export const CHAIR_ROUNDS = 3;
export const MUSIC_MIN_MS = 12_000;
export const MUSIC_MAX_MS = 30_000;
export const CHAIRS_DECOY_SHARE = 0.3;
export const CHAIRS_DECOY_MS = 600;
/** Обманка — не в первые и не в последние столько мс музыки. */
export const CHAIRS_DECOY_EDGE_MS = 3000;
export const APPEAR_MIN_MS = 300;
export const APPEAR_MAX_MS = 1500;
export const SIT_WINDOW_MS = 3000;
export const SIT_MIN_RT = 150;
/** Касание раньше появления на столько ещё принимается (запас часов телефона). */
export const SIT_EARLY_MS = 300;
export const SIT_SETTLE_MS = 1500;
export const SEAT_SHOW_MS = 3000;
/** Экрану момент остановки — за столько. */
export const SCREEN_LEAD_MS = 3000;
/** «Прозевал» (для прогноза): в 1-м заходе сел позже стольких мс или не сел. */
export const CHAIRS_LATE_RT = 1000;

// ------------------------------------------------------------ «Канат»
export const SPLIT_MS = 4000;
export const ROPE_ATTEMPT_MS = 15_000;
export const ROPE_REST_MS = 5000;
export const ROPE_ATTEMPTS = 3;
export const ROPE_WINS = 2;
export const ROPE_TICK_MS = 200;
/** Сдвиг узла за тик = ROPE_K × (A − B) ÷ ((A + B) ÷ 2). */
export const ROPE_K = 4;
export const ROPE_END = 100;
/** Нажатия считаются за последние столько мс. */
export const ROPE_WINDOW_MS = 2000;
export const FAN_WEIGHT = 0.5;
/** Болельщик «тянет», если тапал за последние столько мс. */
export const FAN_ACTIVE_MS = 3000;
export const TAPS_PER_SECOND = 15;
export const TAPS_BURST = 30;

// ------------------------------------------------------------ «Классики» и «Добивка»
export const HOP_ROWS = 6;
export const BRAVE_MS = 3000;
export const BRAVES = 3;
export const BRAVE_MIN_RT = 150;
/** Смельчаки подводятся через столько после конца кнопки (последние касания доходят). */
export const BRAVE_SETTLE_MS = 500;
export const JUMP_MS = 5000;
export const CHOOSE_MS = 10_000;
export const CRACK_MS = 3000;
export const BRAVE_COINS = 3;
export const DOBIVKA_ROWS = 3;
export const DOBIVKA_INTRO_MS = 4000;

// ------------------------------------------------------------ «Второй шанс»
export const CHANCE_OFFER_MS = 4000;
export const CHANCE_QUESTION_MS = 10_000;
export const CHANCE_BACK_MS = 4000;
export const CHANCE_MIN_RT = 300;
export const QUESTIONS_MIN = 3;
export const QUESTIONS_MAX = 10;
export const QUESTION_MAX_LEN = 140;
export const OPTION_MAX_LEN = 60;

// ------------------------------------------------------------ финал
export const BETS_MS = 5000;
export const RPS_PICK_MS = 5000;
export const RPS_SHOW_MS = 3000;
export const DUEL_WINS = 2;
/** На такой по счёту ничьей подряд побеждает быстрее выбравший. */
export const TIES_RULE = 3;

// ------------------------------------------------------------ болельщики и очки
export const GUESS_BEST = 3;
export const GUESS_NEAR = 1;
/** «В пределах 10% от ответа» (не меньше ±1). */
export const GUESS_NEAR_SHARE = 0.1;
export const BET_WIN = 1;
export const POINTS_STEP = 10;
/** Баллы ведущему: «сыграна до конца» — пьедестал и не меньше стольких сыгранных испытаний (решение владельца 8). */
export const PLAYED_TRIALS_MIN = 3;
/** Раунды для `room_play`: испытания — 0–4, «Второй шанс», «Добивка», финал. */
export const UNIT_CHANCE = 10;
export const UNIT_DOBIVKA = 11;
export const UNIT_FINAL = 20;

// ------------------------------------------------------------ связь
export const OFFLINE_MS = 3000;
export const BATCH_MS = 1000;
/** Событий в секунду с телефона (лишние срезает комната). */
export const EVENTS_PER_SECOND = 10;
/** Личное телефону без срочных перемен — не чаще. */
export const PERSONAL_EVERY_MS = 500;
/** Имя в сводке экрана — до стольких знаков. */
export const SCREEN_NAME_MAX = 24;
