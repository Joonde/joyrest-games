/**
 * Типы данных платформы. Не зависят от Firebase: при переезде на свой сервер
 * меняется только реализация в src/data/, а эти типы остаются.
 * Время везде — миллисекунды с эпохи по часам сервера.
 */

export type Role = "admin" | "host";

/** Квалификация ведущего (ставит владелец): Стажёр, Новичок, Ведущий, Топ-ведущий. */
export type HostLevel = "intern" | "novice" | "host" | "top";

/** Запись о баллах ведущего: за игру (начисляет сервер) или вручную владельцем. */
export interface PointsEntry {
  id: string;
  points: number;
  kind: "game" | "manual";
  reason: string;
  createdAt: number;
}

export interface UserProfile {
  uid: string;
  role: Role;
  name: string;
  /** Отключённый ведущий не может войти в студию и запускать сессии. */
  active: boolean;
  email: string;
  /**
   * Вошёл по временному паролю от администратора: сначала задаёт свой (/studio/password).
   * Есть только на своём сервере; у Firebase смена пароля добровольная.
   */
  mustChangePassword?: boolean;
  /** Свой сервер: квалификация (ставит владелец) и дата «опыт с» для стажа (мс). */
  level?: HostLevel | null;
  experienceSince?: number | null;
}

/** Ведущий в списке администратора. */
export interface HostAccount extends UserProfile {
  createdAt: number | null;
  /** Свой сервер, только admin: сумма баллов ведущего. */
  points?: number;
}

/** Новый ведущий и его временный пароль: показывается администратору один раз. */
export interface CreatedHost {
  account: HostAccount;
  temporaryPassword: string;
}

/** Общая библиотека агентства или личные игры ведущего. */
export type GameScope = "agency" | "personal";

export type AgeRating = "0+" | "12+" | "18+";

export interface Game {
  id: string;
  scope: GameScope;
  ownerId: string;
  title: string;
  /** id механики из src/mechanics/registry.ts. */
  mechanic: string;
  themeId: string;
  ageRating: AgeRating;
  /** Режим участников по умолчанию: предлагается при запуске сессии. */
  playMode: PlayMode;
  /**
   * Содержимое игры; формат знает только механика. Картинок в нём нет — только их id
   * (документы games/{id}/media/{mediaId}, см. MediaRepository).
   */
  content: unknown;
  createdAt: number | null;
  updatedAt: number | null;
}

export type NewGame = Omit<Game, "id" | "createdAt" | "updatedAt">;

/** Что можно менять в игре после создания. Область и владелец не меняются. */
export type GamePatch = Partial<Pick<Game, "title" | "themeId" | "ageRating" | "playMode" | "content">>;

export type PlayMode = "solo" | "teams";

/**
 * Вариант картинки: `full` — для экрана зала (WebP до 1280 px, ~150 КБ),
 * `small` — уменьшенная для телефонов гостей в режиме «без экрана».
 */
export type MediaVariant = "full" | "small";

/** Картинка, уже сжатая на устройстве ведущего: оба варианта сразу. */
export interface MediaUpload {
  full: Blob;
  small: Blob;
  width: number;
  height: number;
}

/** Режимы проведения из раздела 4 CLAUDE.md. */
export type ScreenMode = "laptop" | "remote" | "none";

export type SessionPhase = "lobby" | "playing" | "finished";

/**
 * Этап шага: ready — ведущий ещё не показал вопрос; question — вопрос открыт и идёт
 * таймер, принимаются ответы; reveal — показан правильный ответ; board — таблица.
 */
/** Этап шага; "podium" — награждение после последнего шага (общий для всех механик). */
export type StepStage = "ready" | "question" | "reveal" | "board" | "podium";

export interface SessionState {
  phase: SessionPhase;
  step: number;
  /** Момент начала текущего шага (serverTimestamp), null — шаг ещё не начат. */
  startedAt: number | null;
  revealed: boolean;
  stage: StepStage;
  /** Сколько секунд после startedAt принимаются ответы; null — без ограничения. */
  timeLimit: number | null;
  /** Сколько ответов пришло на шаг: пульт обновляет счётчик не чаще раза в 2 секунды. */
  answered: number;
  /** Итоги шага для экрана и телефонов (распределение ответов и т. п.): формат знает механика. */
  result: unknown;
}

/**
 * Одна запись пульта: состояние шага и таблица лидеров меняются вместе.
 * `startedAt: "server"` — время ставит сервер.
 */
export interface SessionChange {
  state?: Partial<Omit<SessionState, "startedAt">> & { startedAt?: "server" | null };
  /** Запись участника целиком; null — убрать из таблицы. */
  leaderboard?: Record<string, LeaderboardEntry | null>;
}

export type ParticipantKind = "player" | "team";

export interface LeaderboardEntry {
  name: string;
  kind: ParticipantKind;
  score: number;
  /** Только у команд: порядковый номер цвета команды из темы. */
  colorIndex?: number;
  /** Очки за последний показанный ответ (для «+100» на экране и телефоне). */
  last?: number;
  /** Только у команд: кто сейчас капитан (телефоны узнают это из документа сессии). */
  captainUid?: string;
}

/** Ключ — id участника (игрока или команды). */
export type Leaderboard = Record<string, LeaderboardEntry>;

export interface Session {
  id: string;
  code: string;
  hostId: string;
  /** Из какой игры запущена сессия (для истории); null — пустая сессия. */
  gameId: string | null;
  gameTitle: string;
  /** id механики из src/mechanics/registry.ts; null — пустая сессия без игры. */
  mechanic: string | null;
  gameSnapshot: unknown;
  themeId: string;
  playMode: PlayMode;
  screenMode: ScreenMode;
  state: SessionState;
  leaderboard: Leaderboard;
  createdAt: number | null;
}

export interface Participant {
  id: string;
  name: string;
  kind: ParticipantKind;
  /** Для телефона в режиме teams — команда, к которой он подключён. */
  teamId: string | null;
  /** Кто отвечает за участника: сам игрок или капитан команды. */
  captainUid: string;
  joinedAt?: number | null;
  /** Последний сигнал «я на связи» от телефона капитана. */
  seenAt?: number | null;
}

export interface Answer {
  id: string;
  step: number;
  pid: string;
  uid: string;
  value: unknown;
  submittedAt: number | null;
}

export interface NewSessionOptions {
  gameId: string | null;
  gameTitle: string;
  playMode: PlayMode;
  screenMode: ScreenMode;
  themeId: string;
  mechanic: string | null;
  gameSnapshot: unknown;
}

/** Строка итоговой таблицы: игрок (solo) или команда (teams). */
export interface ResultRow {
  name: string;
  score: number;
  colorIndex?: number;
}

/**
 * Компактные итоги прошедшей сессии для «Истории игр». Хранятся отдельно от сессии
 * (results/{sessionId}) и переживают автоочистку старых сессий.
 */
export interface GameResult {
  /** Совпадает с id сессии. */
  id: string;
  hostId: string;
  code: string;
  gameTitle: string;
  mechanic: string | null;
  themeId: string;
  playMode: PlayMode;
  /** Когда проходила игра (создание сессии). */
  playedAt: number | null;
  /** Сколько телефонов гостей подключилось. */
  participantsCount: number;
  /** По убыванию очков. */
  board: ResultRow[];
}

/** Итог автоочистки старых сессий. */
export interface CleanupReport {
  deleted: number;
  /** Остались ещё старые сессии: очистка продолжится при следующем входе. */
  more: boolean;
}

export type Unsubscribe = () => void;

/** Предложение ведущего в общую библиотеку (только свой сервер). */
export type ProposalStatus = "pending" | "accepted" | "rejected";

export interface LibraryProposal {
  id: string;
  /** Личная игра ведущего. */
  gameId: string;
  hostId: string;
  hostName: string;
  /** Название на момент предложения. */
  title: string;
  status: ProposalStatus;
  /** Причина отказа (может не быть). */
  reason: string | null;
  /** Игра библиотеки после принятия. */
  libraryGameId: string | null;
  createdAt: number;
  decidedAt: number | null;
}
