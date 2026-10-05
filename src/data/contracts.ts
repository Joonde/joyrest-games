/**
 * Интерфейсы слоя данных. Экраны, компоненты и механики работают только с ними
 * (экземпляры — в src/data/index.ts). Сейчас их реализует Firebase; при переезде
 * на свой сервер (Node.js + WebSocket) пишется новая реализация тех же интерфейсов,
 * а остальной код не меняется. Firebase-типы сюда не попадают.
 */
import type {
  Answer,
  CleanupReport,
  CreatedHost,
  Game,
  GamePatch,
  GameResult,
  HostAccount,
  LeaderboardEntry,
  NewGame,
  NewSessionOptions,
  Participant,
  Session,
  SessionPhase,
  Unsubscribe,
  UserProfile,
} from "./types";

export interface AuthUser {
  uid: string;
  anonymous: boolean;
  email: string | null;
}

export interface AuthService {
  /** Колбэк вызывается сразу после восстановления входа и при каждом изменении. */
  watch(callback: (user: AuthUser | null) => void, onError: (error: Error) => void): Unsubscribe;
  signInHost(email: string, password: string): Promise<void>;
  /** Анонимный вход гостя или экрана зала; существующий вход сохраняется. */
  ensureSignedIn(): Promise<AuthUser>;
  signOut(): Promise<void>;
  /** Смена пароля вошедшего ведущего: нужен текущий пароль. */
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  /** Понятный текст ошибки входа или смены пароля. */
  describeError(error: unknown): string;
}

export interface UsersRepository {
  /** Профиль ведущего; для гостя и неизвестного аккаунта — null. */
  loadProfile(user: AuthUser): Promise<UserProfile | null>;
  /** Только admin: все ведущие. */
  listHosts(): Promise<HostAccount[]>;
  /**
   * Только admin: создаёт аккаунт ведущего с временным паролем. Вход администратора
   * при этом не меняется.
   */
  createHost(email: string, name: string): Promise<CreatedHost>;
  /** Только admin: отключение (active = false) блокирует вход и создание сессий. */
  setHostActive(uid: string, active: boolean): Promise<void>;
}

export interface GamesRepository {
  /** Общая библиотека агентства. */
  listAgency(): Promise<Game[]>;
  /** Личные игры ведущего. */
  listPersonal(ownerId: string): Promise<Game[]>;
  get(gameId: string): Promise<Game | null>;
  create(game: NewGame): Promise<string>;
  update(gameId: string, patch: GamePatch): Promise<void>;
  remove(gameId: string): Promise<void>;
}

export interface SessionsRepository {
  create(hostId: string, options: NewSessionOptions): Promise<{ id: string; code: string }>;
  /** Поиск по коду находит только незавершённые сессии (лобби и идущая игра). */
  findByCode(code: string): Promise<Session | null>;
  /** Для пульта: своя сессия по коду, в том числе завершённая. */
  findHostSessionByCode(code: string, hostId: string): Promise<Session | null>;
  /** По id: так гость, который уже в игре, видит сессию и после завершения. */
  get(sessionId: string): Promise<Session | null>;
  /** Подписка на документ сессии — единственное, что слушают гости и экран зала. */
  watch(sessionId: string, onChange: (session: Session | null) => void, onError: (error: Error) => void): Unsubscribe;
  /** Сессии ведущего, новые сверху. */
  listByHost(hostId: string): Promise<Session[]>;
  setPhase(sessionId: string, phase: SessionPhase): Promise<void>;
  upsertLeaderboard(sessionId: string, entries: Record<string, LeaderboardEntry>): Promise<void>;
  /** Завершает игру и одной записью сохраняет компактные итоги для истории. */
  finish(session: Session, participantsCount: number): Promise<void>;
  /**
   * Только admin: удаляет сессии старше `cutoff` вместе с участниками и ответами.
   * Итоги, которых ещё нет в истории, сохраняются перед удалением.
   */
  removeExpired(cutoff: number): Promise<CleanupReport>;
}

export interface ParticipantsRepository {
  getMine(sessionId: string, uid: string): Promise<Participant | null>;
  joinAsPlayer(sessionId: string, uid: string, name: string, teamId: string | null): Promise<void>;
  /** Создаёт команду; создатель становится капитаном. Возвращает id команды. */
  createTeam(sessionId: string, captainUid: string, name: string): Promise<string>;
  listTeams(sessionId: string): Promise<Participant[]>;
  /** Только для пульта ведущего. */
  watch(sessionId: string, onChange: (participants: Participant[]) => void, onError: (error: Error) => void): Unsubscribe;
}

export type SubmitResult = "sent" | "rejected";

export interface AnswersRepository {
  submit(sessionId: string, step: number, pid: string, uid: string, value: unknown): Promise<SubmitResult>;
  /** Только для пульта ведущего: ответы на текущий шаг. */
  watch(sessionId: string, step: number, onChange: (answers: Answer[]) => void, onError: (error: Error) => void): Unsubscribe;
}

export interface ResultsRepository {
  /** Итоги по ссылке: открываются без входа. */
  get(resultId: string): Promise<GameResult | null>;
  /** История ведущего, новые сверху. */
  listByHost(hostId: string): Promise<GameResult[]>;
}
