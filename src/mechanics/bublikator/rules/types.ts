/**
 * Типы «Бубликатора» — общие для сервера (игровая комната, `server/src/rooms/bublikator.ts`) и будущих экранов, телефона и
 * пульта. Логика и числа — docs/bublikator.md. Время в состоянии — «время игры» (часы сервера минус все паузы, `offset`):
 * пауза ведущего и простой сервера не съедают таймеры. Наружу (сводки) время уходит по часам сервера.
 */

export type Theme = "space" | "pirates" | "newyear" | "submarine" | "wedding";
export type Difficulty = "kids" | "normal" | "crazy";
export type EventKind = "meteor" | "pull" | "sos" | "captain";
export type ControlType = "button" | "toggle" | "slider" | "lever" | "dial";
export type Phase = "lobby" | "crews" | "drill" | "leg" | "podium" | "finished";
export type Stage = "launch" | "fly" | "dock" | "vote" | "voted";
export type Role = "lobby" | "player" | "double" | "out";

/** Содержимое игры из конструктора (`content`). */
export interface BubContent {
  theme: Theme;
  difficulty: Difficulty;
  legs: 2 | 3;
  legMinutes: 3 | 4 | 5;
  events: Record<EventKind, boolean>;
  captainTasks: string[];
  saboteur: boolean;
  crewSize: { min: number; max: number };
  /** Свои названия приборов (по желанию); пусто — генератор темы. */
  names: string[];
}

/** Прибор. `state`: тумблер 0/1, ползунок 0–5, рычаг 0 вверх · 1 середина · 2 вниз, крутилка 0–3 (цвет), кнопка — число нажатий. */
export interface Control {
  id: string;
  crew: number;
  owner: string;
  name: string;
  /** Детский режим: винительный падеж («лягушку») и картинка. */
  acc?: string;
  icon?: string;
  /** Детский предмет с цветом («Красная лягушка»): номер цвета `KIDS_TINTS` — картинка того же цвета. */
  tint?: number;
  type: ControlType;
  state: number;
  /** Когда прибор последний раз двигали (время игры, от прихода; для удержания 0,7 с); -1 — не двигали. */
  movedAt: number;
  /** Заявленное время последнего движения (по нему старое движение не затирает свежее); -1 — не двигали. */
  claim: number;
  /** Кто двигал последним. */
  by: string | null;
  /** Когда о нём был последний приказ (часы экипажа); -1 — не было. */
  lastOrder: number;
}

/** Приказ. Цель кнопки — -1 («нажать»). `due` — срок по часам экипажа (стоят во время событий и ремонта). */
export interface Order {
  id: string;
  control: string;
  target: number;
  text: string;
  /** Выдан (время игры). */
  issuedAt: number;
  /** Выдан (часы экипажа) и срок (часы экипажа). */
  issuedClock: number;
  due: number;
  /** Ложный приказ диверсанта: видят только сервер и сам диверсант. */
  fake: boolean;
  /** За какую остановку прибора в неверном положении уже сгорели 2 секунды (время движения). */
  penalizedAt: number | null;
}

export interface Member {
  pid: string;
  name: string;
  /** Команда платформы (командная сессия): смена команды — пересадка в её экипаж. */
  team?: string | null;
  /** Порядок входа в игру. */
  join: number;
  /** Экипаж (в лобби — выбор гостя, null — ждёт распределения). */
  crew: number | null;
  role: Role;
  /** Дублёр: чей пульт он делит. */
  doubleOf: string | null;
  /** Станет полноценным игроком при следующей раздаче приборов (опоздал, вернулся после «Убрать»). */
  pending: boolean;
  /** Ушёл из сессии (участника убрали на платформе). */
  gone: boolean;
  /** С какого момента без связи (время игры); null — на связи. */
  offlineSince: number | null;
  /** Приборы игрока в порядке плиток на телефоне («Глюк» меняет порядок). */
  panel: string[];
  order: Order | null;
  /** Новый приказ — не раньше (часы экипажа). */
  nextAt: number;
  /** Прибор прошлого приказа: только что использованный не повторяется. */
  lastControl: string | null;
  /** Свои выполненные приказы (за игру и за перелёт), сколько приказов выполнено его движением. */
  done: number;
  legDone: number;
  moved: number;
  /** Сколько раз был нераскрытым диверсантом — лента «Мастер обмана». */
  ribbons: number;
  /** Окно роли закрыто («Понятно, скрыть»). */
  roleSeen: boolean;
  /** Голос «Кто диверсант?»: pid товарища или null. */
  vote: string | null;
}

/** Итог перелёта экипажа (столбцы «Привала»). `total` = `orders` + `finish` + `events`. */
export interface LegResult {
  leg: number;
  orders: number;
  finish: number;
  events: number;
  total: number;
  place: number;
  streak: number;
  best: { pid: string; name: string; done: number } | null;
  first: boolean;
  shield: number;
  /** Сколько приказов экипажа выполнено за перелёт. */
  done: number;
}

export interface PullCrew {
  /** С какого момента держат все (время игры); null — не все. */
  holdStart: number | null;
  escaped: boolean;
  failed: boolean;
}

export interface SosCrew {
  progress: number;
  blockedUntil: number;
  done: boolean;
  /** Сколько раз набор сбрасывался ошибкой: телефон шлёт его с набором — нажатия до сброса не засчитываются. */
  attempt?: number;
}

export interface Crew {
  id: number;
  name: string;
  /** Цвет платформы 0–4 и значок 0–8 (значок — при 6 экипажах и больше). */
  color: number;
  icon: number | null;
  /** Экипаж объединили с другим — его больше нет. */
  gone: boolean;
  hull: number;
  /** Ремонт: начало, нажатия «Чиним!» всего и каждого. */
  repair: { startedAt: number; taps: number; target: number; by: Record<string, number> } | null;
  /** Часы экипажа: идут, пока нет события и ремонта (сроки приказов). */
  clock: number;
  /** Дальность от приказов за перелёт, 0–1 000 (без бонусов). */
  dist: number;
  /** Финиш: момент полёта (мс), null — не долетел. */
  finishedAt: number | null;
  bonus: { meteor: number; sos: number; captain: Record<string, number>; finish: number };
  streak: number;
  bestStreak: number;
  done: number;
  failed: number;
  fakeDone: number;
  /** Импульсы за последние 10 секунд: [время, Δ, время, Δ…]. */
  impulses: number[];
  /** Счётчики для вспышки «✓» и рывка на экране. */
  okSeq: number;
  failSeq: number;
  salutes: number;
  /** Диверсант этого перелёта (только в комнате). */
  saboteur: string | null;
  /** Щит идущего метеоритного дождя и лучший за перелёт. */
  shield: number | null;
  legShield: number;
  pull: PullCrew | null;
  sos: SosCrew | null;
  legs: LegResult[];
  voteBonus: number;
  guessed: number;
  /** Очки влитых в этот экипаж («Объединить экипажи», решение владельца 6 ноября 2026). */
  merged: number;
  /** Счётчики итоговой карточки влитых экипажей (приказы, первые финиши, перелёты, лучший щит) — вместе с их очками. */
  mergedStats?: CardStats;
  /** Командная сессия: команда платформы этого экипажа (по ней и название). */
  team?: string;
}

/** Счётчики итоговой карточки экипажа. */
export interface CardStats {
  orders: number;
  firsts: number;
  legs: number;
  shield: number;
}

export interface EventState {
  id: string;
  kind: EventKind;
  /** Предупреждение (3 с), начало и самый поздний конец (время игры). */
  warnAt: number;
  startAt: number;
  endAt: number;
  started: boolean;
  manual: boolean;
  /** Экипажи-участники (не долетевшие и не на ремонте в момент начала). */
  crews: number[];
  task?: string;
  /** «Сигнал SOS»: цвета 0–3. */
  seq?: number[];
  /** «Метеоритный дождь»: сила тряски и нажатия каждого. */
  power?: Record<string, { shake: number; taps: number }>;
  /** «Притяжение»: держит ли каждый «Тягу» и с какого момента. */
  holds?: Record<string, { on: boolean; at: number }>;
}

export interface LegState {
  index: number;
  attempt: number;
  stage: Stage;
  launchEnds: number;
  /** Время полёта (мс; стоит во время событий) и длительность перелёта. */
  flight: number;
  duration: number;
  /** «Медленнее / Быстрее»: секунды к времени приказа. */
  shift: number;
  /** Расписание событий: момент полёта и вид. */
  schedule: Array<{ at: number; kind: EventKind }>;
  event: EventState | null;
  /** Когда (момент полёта) кончилось прошлое событие. */
  lastEventEnd: number | null;
  /** Прошедшие события перелёта (для пульта и «Все на палубу!»). */
  history: Array<{ id: string; kind: EventKind; task?: string }>;
  glitch: { at: number; startedAt: number | null } | null;
  flip: { at: number; startedAt: number | null } | null;
  /** Кто в каком экипаже был игроком на старте перелёта (кандидаты и голоса «Кто диверсант?»). */
  roster: Record<string, number>;
  dockAt: number | null;
  voteEnds: number | null;
  vote: VoteResult[] | null;
  /** «Все на палубу!»: оценки ведущего по событию → экипаж → звёзды. */
  ratings: Record<string, Record<string, number>>;
  /** Был ли в перелёте режим «Диверсант» хотя бы у одного экипажа. */
  saboteurs: boolean;
}

export interface VoteResult {
  crew: number;
  saboteur: string;
  name: string;
  guessed: boolean;
  /** Голоса за каждого (без голоса диверсанта). */
  votes: Record<string, number>;
  fakes: number;
}

export interface BubState {
  v: 1;
  content: BubContent;
  teamsMode: boolean;
  /**
   * Командная сессия: команда платформы = экипаж (решение владельца 6 ноября 2026). Номер экипажа команды — по порядку
   * появления команд, до 20; запомнен навсегда (команда, появившаяся после сбора, своего экипажа не получает — её люди
   * садятся в самый маленький).
   */
  teamCrew?: Record<string, number>;
  /** Названия команд платформы (как назвали при входе, со смайликом) — это и названия их экипажей (решение владельца 6 ноября 2026). */
  teamNames?: Record<string, string>;
  phase: Phase;
  legIndex: number;
  members: Record<string, Member>;
  joinSeq: number;
  crews: Crew[];
  controls: Record<string, Control>;
  ctlSeq: number;
  orderSeq: number;
  eventSeq: number;
  leg: LegState | null;
  drill: { endsAt: number; over: boolean } | null;
  phaseAt: number;
  /** Состояние до перелёта (JSON) — для «Назад — переиграть перелёт». */
  base: string | null;
  /** Сколько стояли на паузе (мс): время игры = часы сервера − offset. */
  offset: number;
  /** Время игры, раньше которого событий быть не может (момент продолжения после паузы). */
  floor: number;
  /** На паузе: время игры, на котором она встала; null — не на паузе. */
  pausedGame: number | null;
  /** Номер следующего случайного числа (не откатывается «Назад»: новая попытка — новая случайность). */
  rng: number;
  /** Сколько раз начинали каждый перелёт. */
  attempts: number[];
  lastTick: number | null;
  /** Время игры, когда показали пьедестал. */
  podiumAt: number | null;
  /** Не уходит в снимок: лимиты, что уже отправлено телефонам. */
  rt: Runtime;
}

/** Составы, посчитанные один раз на изменение (`crews.ts`, `roster`). Массивы общие — не менять. */
export interface Roster {
  ver: number;
  active: Member[];
  byCrew: Map<number, Member[]>;
  players: Map<number, Member[]>;
  doublesOf: Map<string, number>;
  highestChoice: number;
}

export interface Runtime {
  moves: Map<string, { tokens: number; at: number }>;
  taps: Map<string, { tokens: number; at: number }>;
  /** Что ушло каждому телефону: ключ каждого поля личного. */
  sent: Map<string, Record<string, string>>;
  dirty: Set<string>;
  lastSweep: number;
  /** Составы (`crews.ts`, `roster`): номер изменения и посчитанное по нему. */
  rosterVer: number;
  roster: Roster | null;
  /** Что уже ушло каждому телефону составом экипажа (`{ t: "crew" }`). */
  sentCrew: Map<string, string>;
}

// ------------------------------------------------------------------ сводки

export interface ScreenCrewView {
  id: number;
  name: string;
  color: number;
  icon: number | null;
  place: number;
  members: number;
  online: number;
  names: string[];
  dist: number;
  score: number;
  total: number;
  hull: number;
  speed: number;
  ratio: number;
  repair: { until: number; taps: number; target: number } | null;
  finished: boolean;
  streak: number;
  fire: boolean;
  shield: number | null;
  pull: { held: number; escaped: boolean; failed: boolean; notHolding: string[]; drifting: boolean } | null;
  sos: { progress: number; done: boolean; captain: string | null } | null;
  okSeq: number;
  failSeq: number;
  salutes: number;
}

export interface ScreenView {
  phase: Phase;
  stage: Stage | null;
  leg: number;
  legs: number;
  theme: Theme;
  difficulty: Difficulty;
  /** Конец текущего отсчёта по часам сервера (взлёт, тренировка, голосование) или null. */
  endsAt: number | null;
  flight: { elapsed: number; duration: number; stopped: boolean } | null;
  crews: ScreenCrewView[];
  lobby: { crews: Array<{ id: number; name: string; color: number; icon: number | null; count: number; names: string[] }>; waiting: string[]; max: number } | null;
  event: { id: string; kind: EventKind; warn: boolean; startsAt: number; endsAt: number; seq: number[] | null; task: string | null; crews: number[] } | null;
  glitchUntil: number | null;
  best: { crew: number; streak: number } | null;
  ordersDone: number;
  dock: { rows: Array<LegResult & { crew: number; name: string }>; bestStreak: { crew: number; streak: number } | null; bestShield: { crew: number; shield: number } | null } | null;
  vote: { endsAt: number; voted: Record<string, number>; voters: Record<string, number> } | null;
  reveal: VoteResult[] | null;
  podium: Array<{ crew: number; name: string; place: number; total: number }> | null;
}

export interface PanelControlView {
  id: string;
  name: string;
  type: ControlType;
  state: number;
  icon: string | null;
  tint: number | null;
}

export interface CrewSummary {
  id: number;
  name: string;
  color: number;
  icon: number | null;
  members: Array<{ name: string; online: boolean; role: Role }>;
  offline: string[];
}

export interface PersonalView {
  phase: Phase;
  stage: Stage | null;
  leg: number;
  legs: number;
  theme: Theme;
  difficulty: Difficulty;
  me: { pid: string; name: string; role: Role; crew: number | null; captain: boolean; doubleOf: string | null; pending: boolean; done: number; legDone: number; moved: number };
  /** Сводка экипажа: в снимке при подписке и в опросе; в рассылке — отдельным `{ t: "crew" }` при переменах. */
  crew?: CrewSummary | null;
  /** Место и корпус своего корабля (меняются часто — отдельным малым полем). */
  ship: { place: number; hull: number } | null;
  lobby: { crews: Array<{ id: number; name: string; count: number; full: boolean }>; choice: number | null; max: number } | null;
  endsAt: number | null;
  panel: PanelControlView[];
  flipUntil: number | null;
  glitchAt: number | null;
  order: { id: string; text: string; control: string; mine: boolean; dueAt: number | null; left: number; total: number; frozen: boolean; mark?: true; icon?: string } | null;
  event: {
    id: string;
    kind: EventKind;
    warn: boolean;
    startsAt: number;
    endsAt: number;
    joined: boolean;
    task?: string;
    meteor?: { power: number; shield: number };
    pull?: { holding: boolean; held: number; escaped: boolean; failed: boolean; members: Array<{ name: string; holding: boolean }> };
    sos?: { captain: boolean; captainName: string | null; progress: number; length: number; blockedUntil: number | null; done: boolean; attempt: number };
  } | null;
  repair: { until: number; mine: number; taps: number; target: number } | null;
  finished: boolean;
  /** Когда закончится перелёт (часы сервера) — только финишировавшему экипажу; во время события — null (время стоит). */
  flightEndsAt: number | null;
  role: { saboteur: boolean; seen: boolean } | null;
  vote: { endsAt: number; candidates: Array<{ pid: string; name: string }>; mine: string | null; none: boolean } | null;
  voted: { guessed: boolean; saboteur: string; me: boolean; none: boolean } | null;
  dock: { place: number; score: number; total: number } | null;
  card: { place: number; total: number; crewOrders: number; myOrders: number; firstFinishes: number; legs: number; guessed: number; bestShield: number; ribbon: boolean } | null;
}

export interface HostView {
  phase: Phase;
  stage: Stage | null;
  leg: number;
  legs: number;
  attempt: number;
  endsAt: number | null;
  flight: { elapsed: number; duration: number; stopped: boolean } | null;
  orderSeconds: number;
  crews: Array<{
    id: number;
    name: string;
    place: number;
    hull: number;
    rate: number;
    dist: number;
    score: number;
    total: number;
    finished: boolean;
    repair: boolean;
    players: number;
    doubles: number;
    online: number;
    small: boolean;
    members: Array<{ pid: string; name: string; role: Role; online: boolean; offlineMs: number; removable: boolean; pending: boolean }>;
  }>;
  waiting: Array<{ pid: string; name: string }>;
  lobbyCrews: Array<{ id: number; name: string; count: number }>;
  event: { id: string; kind: EventKind; warn: boolean; startsAt: number; endsAt: number; task: string | null } | null;
  next: { kind: EventKind; inMs: number } | null;
  enabled: EventKind[];
  tasks: string[];
  captain: Array<{ id: string; task: string; stars: Record<string, number> }>;
  dock: ScreenView["dock"];
  vote: { endsAt: number; voted: number; voters: number } | null;
  reveal: VoteResult[] | null;
  podium: ScreenView["podium"];
  canBack: boolean;
  removable: Array<{ pid: string; name: string; crew: number | null; offlineMs: number }>;
}
