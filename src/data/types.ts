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
  active: boolean;
}

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
  playMode: PlayMode;
  screenMode: ScreenMode;
  themeId: string;
  mechanic: string | null;
  gameSnapshot: unknown;
}

export type Unsubscribe = () => void;
