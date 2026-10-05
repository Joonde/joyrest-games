/**
 * Типы данных платформы. Не зависят от Firebase: при переезде на свой сервер
 * меняется только реализация в src/data/, а эти типы остаются.
 * Время везде — миллисекунды с эпохи по часам сервера.
 */

export type Role = "admin" | "host";

export interface UserProfile {
  uid: string;
  role: Role;
  name: string;
  /** Отключённый ведущий не может войти в студию и запускать сессии. */
  active: boolean;
  email: string;
}

/** Ведущий в списке администратора. */
export interface HostAccount extends UserProfile {
  createdAt: number | null;
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
  /** Содержимое игры; формат знает только механика. */
  content: unknown;
  createdAt: number | null;
  updatedAt: number | null;
}

export type NewGame = Omit<Game, "id" | "createdAt" | "updatedAt">;

/** Что можно менять в игре после создания. Область и владелец не меняются. */
export type GamePatch = Partial<Pick<Game, "title" | "themeId" | "ageRating" | "content">>;

export type PlayMode = "solo" | "teams";

/** Режимы проведения из раздела 4 CLAUDE.md. */
export type ScreenMode = "laptop" | "remote" | "none";

export type SessionPhase = "lobby" | "playing" | "finished";

export interface SessionState {
  phase: SessionPhase;
  step: number;
  /** Момент начала текущего шага (serverTimestamp), null — шаг ещё не начат. */
  startedAt: number | null;
  revealed: boolean;
}

export type ParticipantKind = "player" | "team";

export interface LeaderboardEntry {
  name: string;
  kind: ParticipantKind;
  score: number;
  /** Только у команд: порядковый номер цвета команды из темы. */
  colorIndex?: number;
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
