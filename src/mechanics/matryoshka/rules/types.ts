/** Типы «Игр Матрёшки»: содержимое, состояние комнаты, виды экрана, телефона и пульта (docs/matryoshka.md). */

export type Style = "sunny" | "night";
export type TrialKind = "freeze" | "ginger" | "chairs" | "rope" | "hopscotch";
export type ShapeId = "circle" | "star" | "tree" | "matryoshka" | "umbrella" | "heart" | "house";
export type Tempo = "short" | "normal" | "long";
export type Side = "L" | "R";
export type Gesture = "r" | "p" | "s";

export interface Question {
  q: string;
  options: string[];
  correct: number;
}

export interface MatContent {
  style: Style;
  trials: Array<{ kind: TrialKind; on: boolean }>;
  finalists: number;
  lives: 1 | 2;
  secondChance: 0 | 5 | 10 | 20;
  /** Свои вопросы «Второго шанса» (3–10); пусто — встроенные. */
  questions: Question[];
  tempo: Tempo;
  fanBets: boolean;
  /** 4 фигуры «Пряника». */
  shapes: ShapeId[];
}

export type Role = "lobby" | "player" | "fan";

export interface Member {
  pid: string;
  name: string;
  /** Номер «№ 001» — по порядку входа. */
  num: number;
  role: Role;
  /** Вошёл после «Начать» (или сверх 100): болельщик, не игрок, в таблице не играет. */
  late: boolean;
  /** Ушёл из сессии (участника убрали на платформе). */
  gone: boolean;
  /** «Убрать игрока» пульта. */
  removed: boolean;
  hearts: number;
  /** Порядковый номер вылета (больше — выбыл позже) и где: номер испытания, `chance`/`dobivka`/`removed`. */
  outSeq: number | null;
  outAt: string | null;
  /** Выбыл игрой хотя бы раз (для «Второго шанса» и «Вернуть»). */
  everOut: boolean;
  returned: boolean;
  /** Монеты смельчака «Классиков». */
  coins: number;
  /** Место в каждом испытании плана (null — не играл). */
  places: Array<number | null>;
  fanScore: number;
  /** Когда стал болельщиком (номер вылета; опоздавший — −1: «болел дольше всех»). */
  fanSince: number | null;
}

// ------------------------------------------------------------ испытания

export interface Gaze {
  /** Начало фразы, поворот T и конец взгляда (время игры). */
  ph: number;
  a: number;
  e: number;
  /** Обманка внутри фразы (время), если есть. */
  d: number | null;
}

export interface Runner {
  path: number;
  holding: boolean;
  /** Учтено до этого момента (время игры). */
  acc: number;
  /** Последняя пачка с «держу» (время прихода). */
  heard: number;
  /** Последнее событие этого телефона (монотонность). */
  last: number;
  /**
   * Удержание подтверждено телефоном до этого момента (время события «держу» или «отпустил», пока держал; второе ревью 3a): путь
   * растёт и поимка считается только до него. Дальше, пока нет пачек, — «держит без пачки» для вида, но для игры стоит.
   */
  seen: number;
  finishedAt: number | null;
  /** Номер взгляда, в окне которого держал (откат — на конце взгляда). */
  pending: number | null;
  caught: number;
  /** Номера взглядов, на которых пойман. */
  caughtAt: number[];
  everHeld: boolean;
}

export interface FreezeState {
  kind: "freeze";
  /** Длительность бега без продлений (скорость считается от неё) и продление. */
  base: number;
  extra: number;
  runEnds: number;
  gazes: Gaze[];
  /** Сколько взглядов объявлено «пойманы» (устоялось). */
  judged: number;
  runners: Record<string, Runner>;
  /** Последний объявленный улов: номер взгляда и кто. */
  lastCatch: { gaze: number; pids: string[] } | null;
}

export interface GingerRunner {
  box: number | null;
  auto: boolean;
  c: number;
  cracked: boolean;
  crackedAt: number | null;
  doneAt: number | null;
}

export interface GingerState {
  kind: "ginger";
  /** Фигура в каждой коробке — тайна до `unbox`. */
  boxes: ShapeId[];
  pickEnds: number;
  unboxEnds: number;
  traceEnds: number;
  extra: number;
  runners: Record<string, GingerRunner>;
}

export interface ChairRound {
  players: string[];
  chairs: number;
  musicAt: number;
  stopAt: number;
  appearAt: number;
  decoyAt: number | null;
  closeAt: number;
  settleAt: number;
  seatEnds: number;
  /** Касания: реакция телефона, мс. */
  sits: Record<string, number>;
  seated: string[] | null;
}

export interface ChairsState {
  kind: "chairs";
  round: number;
  rounds: ChairRound[];
  stats: Record<string, { rounds: number; rtSum: number; first: number | null }>;
  over: boolean;
}

export interface Taps {
  total: number;
  attempts: number[];
  recent: Array<[number, number]>;
  last: number;
  bucket: { tokens: number; at: number };
}

export interface RopeState {
  kind: "rope";
  sides: Record<string, 0 | 1>;
  fanSides: Record<string, 0 | 1>;
  splitEnds: number;
  attempt: number;
  attemptAt: number;
  attemptEnds: number;
  restEnds: number | null;
  knot: number;
  wins: [number, number];
  results: Array<{ winner: 0 | 1; knot: number; early: boolean }>;
  taps: Record<string, Taps>;
  lastStep: number;
  over: boolean;
  /** Сила сторон на последнем тике (для экрана). */
  power: [number, number];
}

export interface HopRow {
  /** Крепкая клетка — тайна до `crack`. */
  solid: Side;
  braveAt: number;
  braveEnds: number;
  /** Реакция «Прыгаю первым!». */
  braveTaps: Record<string, number>;
  braves: string[] | null;
  jumpEnds: number | null;
  chooseAt: number | null;
  chooseEnds: number | null;
  crackEnds: number | null;
  picks: Record<string, Side>;
  auto: string[];
  fell: string[] | null;
  /** Кто прыгал в этом ряду. */
  jumpers: string[];
}

export interface HopState {
  kind: "hopscotch";
  row: number;
  rows: HopRow[];
  fallen: Record<string, number>;
  /** Монеты этого испытания (для «Назад» — в точке base). */
  stop: boolean;
  over: boolean;
}

export type TrialPlay = FreezeState | GingerState | ChairsState | RopeState | HopState;

export type TrialStage = "open" | "rules" | "countdown" | "play" | "judging" | "reveal" | "results";

export interface TrialOutcome {
  /** Участники, лучший → худший. */
  order: string[];
  /** Кто потерял сердечко и кто выбыл. */
  lost: string[];
  out: string[];
  /** Сколько «ошиблись» (для прогноза). */
  fails: number | null;
  /** Ответ на прогноз и угадавшие (+3 и +1). */
  best: string[];
  near: string[];
}

export interface TrialState {
  index: number;
  kind: TrialKind;
  stage: TrialStage;
  stageAt: number;
  stageEnds: number | null;
  /** Цель: игроков на старте, сколько останется, сколько испытаний впереди, на посев. */
  A: number;
  T: number;
  k: number;
  seeding: boolean;
  participants: string[];
  guesses: Record<string, number>;
  play: TrialPlay | null;
  outcome: TrialOutcome | null;
  /** Игроков меньше 2 — пропущено само. */
  auto: boolean;
}

export interface ChanceState {
  stage: "offer" | "question" | "back" | "done";
  stageAt: number;
  stageEnds: number | null;
  question: number;
  eligible: string[];
  count: number;
  answers: Record<string, { i: number; rt: number }>;
  returned: string[];
}

export interface DobRow {
  solid: Side;
  chooseAt: number;
  chooseEnds: number;
  crackEnds: number;
  picks: Record<string, Side>;
  auto: string[];
  fell: string[] | null;
}

export interface DobivkaState {
  stage: "intro" | "rows" | "results";
  stageAt: number;
  stageEnds: number | null;
  need: number;
  rows: DobRow[];
  fallen: Record<string, number>;
  out: string[];
}

export interface Duel {
  a: string;
  b: string;
  wins: [number, number];
  ties: number;
  roundNo: number;
  stage: "bets" | "pick" | "show" | "over";
  stageAt: number;
  stageEnds: number | null;
  picks: Record<string, { g: Gesture; at: number }>;
  auto: Record<string, Gesture>;
  bets: Record<string, string>;
  /** Раунды: жесты, победитель (null — ничья), решила ли скорость, ничьих подряд до раунда («Переиграть раунд» возвращает). */
  history: Array<{ ga: Gesture; gb: Gesture; winner: string | null; bySpeed: boolean; ties: number }>;
  winner: string | null;
  forfeit: boolean;
}

export interface FinalState {
  stage: "bracket" | "duel" | "champion";
  stageAt: number;
  /** Посев: финалисты лучший → худший. */
  seeds: string[];
  size: number;
  /** Матчи по кругам: [первый, второй] (null — без соперника). */
  rounds: Array<Array<[string | null, string | null]>>;
  /** Победители матчей по кругам (null — не сыгран). */
  winners: Array<Array<string | null>>;
  /** Где дуэль: круг и матч. */
  at: { round: number; match: number } | null;
  duel: Duel | null;
  /** Проигравшие (для мест): pid → круг, в котором проиграли. */
  lostIn: Record<string, number>;
  champion: string | null;
  duels: number;
}

export type Phase = "lobby" | "trial" | "chance" | "dobivka" | "final" | "podium" | "finished";

export interface RuntimeState {
  /** Последний отправленный каждому телефону вид (ключ JSON) и когда. */
  sent: Map<string, { key: string; at: number }>;
  /** Телефоны, которым вид нужен сразу (моменты, поимка). */
  urgent: Set<string>;
  /** Объявленные моменты: экран и телефоны (чтобы пометить изменение один раз). */
  marks: Set<string>;
  lastPersonal: number;
}

export interface MatState {
  v: 1;
  content: MatContent;
  phase: Phase;
  members: Record<string, Member>;
  joinSeq: number;
  /** Включённые испытания по порядку (на «Начать»). */
  plan: TrialKind[];
  /** Сыграно (не пропущено) по индексу плана. */
  playedTrials: boolean[];
  /** Участников в каждом испытании плана (худшее место не игравшего — это + 1). */
  trialSizes: number[];
  trialIndex: number;
  trial: TrialState | null;
  /** Финалистов в этой игре и игроков на «Начать». */
  F: number;
  startCount: number;
  piggy: number;
  outSeq: number;
  justOut: string[];
  chance: ChanceState | null;
  chanceUsed: boolean;
  chanceAsked: number;
  dobivka: DobivkaState | null;
  final: FinalState | null;
  bestFan: string | null;
  podiumAt: number | null;
  board: boolean;
  /** Точки «Назад»: начало испытания, итоги перед «Вторым шансом», перед «Добивкой», перед финалом. */
  base: string | null;
  chanceBase: string | null;
  dobBase: string | null;
  finalBase: string | null;
  /** Номер попытки (растёт на «Назад» и восстановление): входит в `moment`. */
  attempt: number;
  /**
   * Счётчик команд пульта, после которых этап не сменился («+10 секунд», «Табло», «Вернуть», «Убрать»…): входит в `moment`
   * (`#N`), поэтому второе касание со старым этапом — `moved` (аудит 3a).
   */
  rev: number;
  /** «Вернуть игрока» на `open`/`rules` текущего испытания (после точки `base`): переживают перезапуск сервера (аудит 3a). */
  trialReturns: string[];
  offset: number;
  floor: number;
  pausedGame: number | null;
  lastTick: number | null;
  rng: number;
  rt: RuntimeState;
}

// ------------------------------------------------------------ виды

/** Игрок на экране: [номер, значение (путь, кусочки…), флаги]; флаги — биты `F_*`. */
export type ScreenPlayer = [number, number, number];

export interface ScreenView {
  phase: Phase;
  style: Style;
  board: boolean;
  /** Время сервера сейчас и паузы нет — у экрана свои часы. */
  inGame: number;
  out: number;
  fans: number;
  piggy: number;
  /** «Только что в сугробе» — номера (имена — в `names`). */
  justOut: number[];
  /** Имена тех, кого видно подписью (лидеры, пойманные, финалисты): номер → имя. */
  names: Record<number, string>;
  lobby?: { count: number; marks: string[] };
  trial?: Record<string, unknown>;
  chance?: Record<string, unknown>;
  dobivka?: Record<string, unknown>;
  final?: Record<string, unknown>;
  podium?: Record<string, unknown>;
  scoreboard?: Array<{ num: number; name: string; hearts: number; role: Role }>;
}

export interface PersonalView {
  num: number;
  name: string;
  role: Role;
  late: boolean;
  hearts: number;
  phase: Phase;
  style: Style;
  [field: string]: unknown;
}

export interface HostView {
  moment: string;
  phase: Phase;
  stage: string;
  can: Record<string, boolean>;
  F: number;
  inGame: number;
  out: number;
  fans: number;
  piggy: number;
  target: { A: number; T: number; need: number; seeding: boolean } | null;
  players: Array<{ pid: string; num: number; name: string; role: Role; hearts: number; online: boolean; outAt: string | null; late: boolean }>;
  [field: string]: unknown;
}
