/**
 * Интерфейсы слоя данных. Экраны, компоненты и механики работают только с ними
 * (экземпляры — в src/data/index.ts). Сейчас их реализует Firebase; при переезде
 * на свой сервер (Node.js + WebSocket) пишется новая реализация тех же интерфейсов,
 * а остальной код не меняется. Firebase-типы сюда не попадают.
 */
import type {
  SessionSummary,
  OfflinePlayer,
  OfferSummary,
  PublicOffer,
  RequestData,
  RequestStatus,
  VenueData,
  VenueRecord,
  VenueRequestRecord,
  VenueStatus,
  VenueUpload,
  Answer,
  CleanupReport,
  CreatedHost,
  Game,
  GamePatch,
  GameResult,
  HostAccount,
  HostLevel,
  LeaderboardEntry,
  LibraryProposal,
  MediaUpload,
  MediaVariant,
  NewGame,
  NewSessionOptions,
  Participant,
  PointsEntry,
  ScreenReport,
  ScreenStatus,
  Session,
  SessionChange,
  SessionPhase,
  TeamMember,
  Track,
  TrackCategory,
  TrackInput,
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
  /**
   * Только admin, только свой сервер: новый временный пароль ведущему (показывается один раз,
   * при входе ведущий задаёт свой). У Firebase без Cloud Functions этого нет — метода нет.
   */
  resetHostPassword?(uid: string): Promise<CreatedHost>;
}

export interface GamesRepository {
  /** Общая библиотека агентства. */
  listAgency(): Promise<Game[]>;
  /** Личные игры ведущего. */
  listPersonal(ownerId: string): Promise<Game[]>;
  get(gameId: string): Promise<Game | null>;
  create(game: NewGame): Promise<string>;
  /**
   * Копия или дубль игры вместе с картинками: `mediaIds` — картинки, на которые ссылается
   * содержимое (их знает механика). В копии у картинок те же id.
   */
  copy(sourceGameId: string, mediaIds: string[], draft: NewGame): Promise<string>;
  update(gameId: string, patch: GamePatch): Promise<void>;
  /** Удаляет игру вместе со всеми её картинками. */
  remove(gameId: string): Promise<void>;
}

/**
 * Картинки игр. Хранятся отдельными документами, а не в документе игры и не в снимке
 * сессии: экран зала загружает их сам и заранее, телефоны гостей — только уменьшенную
 * версию и только в режиме «без экрана».
 */
export interface MediaRepository {
  /**
   * Сохраняет картинку и сразу возвращает её id: запись ставится в очередь и уходит на
   * сервер, когда есть связь (`saved` завершится после подтверждения сервера).
   */
  upload(gameId: string, image: MediaUpload): { mediaId: string; saved: Promise<void> };
  /** Картинка по id (с кэшем в памяти); null — картинки нет. */
  load(gameId: string, mediaId: string, variant: MediaVariant): Promise<Blob | null>;
  /** Удаляет оба варианта картинки. */
  remove(gameId: string, mediaId: string): Promise<void>;
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
  /**
   * «Игры сейчас»: идущие и ждущие гостей плюс две последние завершённые у каждого ведущего,
   * без снимка игры. Ведущему — свои, владельцу — все. Только свой сервер.
   */
  overview?(): Promise<SessionSummary[]>;
  setPhase(sessionId: string, phase: SessionPhase): Promise<void>;
  upsertLeaderboard(sessionId: string, entries: Record<string, LeaderboardEntry>): Promise<void>;
  /** Только пульт: шаг игры и правки таблицы лидеров одной записью. */
  apply(sessionId: string, change: SessionChange): Promise<void>;
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
  /** Только пульт: переименовать игрока или команду. */
  rename(sessionId: string, pid: string, name: string): Promise<void>;
  /** Только пульт: убрать игрока или команду из игры. */
  remove(sessionId: string, pid: string): Promise<void>;
  /** Только пульт: новый капитан команды. */
  setCaptain(sessionId: string, teamId: string, uid: string): Promise<void>;
  /** Телефон капитана: «я на связи» (раз в 30 секунд). */
  touch(sessionId: string, uid: string): Promise<void>;
  /** Только свой сервер: игроки не на связи — новый телефон может войти за себя прежнего. */
  listOffline?(sessionId: string): Promise<OfflinePlayer[]>;
  /** Только свой сервер: войти за отключившегося игрока (этот телефон станет им). */
  claim?(sessionId: string, pid: string): Promise<void>;
  /** Только для пульта ведущего. */
  watch(sessionId: string, onChange: (participants: Participant[]) => void, onError: (error: Error) => void): Unsubscribe;
}

export type SubmitResult = "sent" | "rejected";

export interface AnswersRepository {
  submit(sessionId: string, step: number, pid: string, uid: string, value: unknown): Promise<SubmitResult>;
  /** Только для пульта ведущего: ответы на текущий шаг. */
  watch(sessionId: string, step: number, onChange: (answers: Answer[]) => void, onError: (error: Error) => void): Unsubscribe;
  /** Свой ответ (или ответ своей команды) — телефон после перезагрузки или для участника команды. */
  getOwn(sessionId: string, step: number, pid: string): Promise<Answer | null>;
  /** Только пульт: убрать ответы шага («Назад» с открытого вопроса). */
  clearStep(sessionId: string, step: number): Promise<void>;
  /** Только пульт: свежий список ответов шага с сервера (перед подсчётом очков). */
  list(sessionId: string, step: number): Promise<Answer[]>;
}

/** Часы сервера: синхронный таймер на экране зала, пульте и телефонах. */
export interface ClockService {
  /** На сколько миллисекунд часы сервера впереди часов устройства (0, пока не измерено). */
  offset(): number;
  /** Измеряет смещение один раз за загрузку страницы (одна запись и одно чтение). */
  sync(): Promise<number>;
}

/**
 * Предложения в библиотеку (CLAUDE.md, раздел 3). Есть только на своём сервере; у Firebase —
 * null, кнопки не показываются.
 */
/**
 * Экран зала ↔ пульт: «на связи, звук разрешён» — только свой сервер. У Firebase — null, пульт
 * строку про экран не показывает.
 */
export interface ScreenStatusRepository {
  report(sessionId: string, report: ScreenReport): Promise<void>;
  /** Только ведущий сессии; null — экран давно не сообщал о себе. */
  get(sessionId: string): Promise<ScreenStatus | null>;
}

/** «Команда JoyRest»: карточки ведущих — только свой сервер (CLAUDE.md, раздел 3). */
export interface TeamRepository {
  list(): Promise<TeamMember[]>;
  setBio(bio: string): Promise<void>;
  upload(kind: "avatar" | "cover", image: Blob, width: number, height: number): Promise<void>;
  remove(kind: "avatar" | "cover"): Promise<void>;
  /** Адрес картинки карточки (с отпечатком — кэш браузера на год). */
  imageUrl(uid: string, kind: "avatar" | "cover", sha: string): string;
}

/** Музыка ведущих и общая музыкальная библиотека — только свой сервер (CLAUDE.md, раздел 7). */
export interface TracksRepository {
  /** Свои треки и общая библиотека (только загруженные). */
  list(): Promise<{ mine: Track[]; library: Track[] }>;
  /** Предложенные в общую, ждут проверки (admin). */
  listPending(): Promise<Track[]>;
  /** Описание трека; файл — следующим шагом (`upload`). id создаёт браузер. */
  create(input: TrackInput): Promise<Track>;
  upload(id: string, file: Blob, durationMs: number | null): Promise<Track>;
  update(id: string, patch: { title?: string; category?: TrackCategory }): Promise<Track>;
  remove(id: string): Promise<void>;
  share(id: string): Promise<Track>;
  accept(id: string): Promise<Track>;
  reject(id: string, reason: string): Promise<Track>;
  /** Файл трека (экран зала, прослушивание); нет — null. */
  file(id: string): Promise<Blob | null>;
  /**
   * Адрес файла для `<audio src>`: прослушивание в студии начинается сразу по касанию (iPhone
   * не даёт включить звук, если между касанием и play() было ожидание загрузки).
   */
  fileUrl(id: string): string;
}

export interface ProposalsRepository {
  /** Ведущий предлагает свою личную игру; пока предложение ждёт — возвращается оно же. */
  propose(gameId: string): Promise<LibraryProposal>;
  /** Свои предложения, новые сверху. */
  listMine(): Promise<LibraryProposal[]>;
  /** Только admin: ждут решения, старые сверху. */
  listPending(): Promise<LibraryProposal[]>;
  accept(proposalId: string): Promise<LibraryProposal>;
  reject(proposalId: string, reason: string): Promise<LibraryProposal>;
}

/**
 * Квалификация, стаж и баллы ведущих (только admin, только свой сервер; у Firebase — null).
 * Сумма баллов приходит в listHosts (HostAccount.points).
 */
export interface StaffRepository {
  /** experienceSince — «ГГГГ-ММ-ДД» или null (с даты добавления). */
  setLevel(uid: string, level: HostLevel | null, experienceSince: string | null): Promise<void>;
  listPoints(uid: string): Promise<{ total: number; items: PointsEntry[] }>;
  /** Шаг 0,5, от −100 до 100, комментарий обязателен. */
  addPoints(uid: string, points: number, reason: string): Promise<void>;
}

export interface ResultsRepository {
  /** Итоги по ссылке: открываются без входа. */
  get(resultId: string): Promise<GameResult | null>;
  /** История ведущего, новые сверху. */
  listByHost(hostId: string): Promise<GameResult[]>;
}

/**
 * База площадок (CLAUDE.md, «База площадок») — только свой сервер. Анкеты площадки и клиента
 * открываются без входа (если владелец их включил), кабинет — владельцу и ведущим с доступом,
 * предложение клиенту — по ссылке без входа.
 */
export interface VenuesRepository {
  /** Принимаются ли анкеты без входа (`sudo joyrest venues on`). */
  formsOpen(): Promise<boolean>;
  /**
   * Анкета площадки и её файлы. id создаёт браузер: повтор после обрыва — та же анкета.
   * Возвращает, сколько файлов не загрузилось (анкета при этом уже у нас).
   */
  submitVenue(
    input: { id: string; from: string | null; data: VenueData; files: VenueUpload[]; website: string },
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ failedFiles: number }>;
  /** Заявка клиента; ответ — её номер. */
  submitRequest(input: { id: string; from: string | null; data: RequestData; website: string }): Promise<number>;

  list(): Promise<VenueRecord[]>;
  get(id: string): Promise<VenueRecord>;
  /** Владелец заводит площадку сам: нужно только название. */
  create(data: VenueData): Promise<VenueRecord>;
  update(id: string, patch: { data?: VenueData; status?: VenueStatus; rating?: number | null; notes?: string }): Promise<VenueRecord>;
  /** «Удалить» — в архив (не навсегда); `restore` возвращает из архива. */
  remove(id: string): Promise<void>;
  restore(id: string): Promise<VenueRecord>;
  uploadFile(id: string, file: VenueUpload): Promise<void>;
  removeFile(id: string, sha: string): Promise<void>;
  fileUrl(id: string, sha: string): string;

  listRequests(): Promise<VenueRequestRecord[]>;
  getRequest(id: string): Promise<VenueRequestRecord>;
  updateRequest(id: string, patch: { status?: RequestStatus; notes?: string; data?: RequestData }): Promise<VenueRequestRecord>;
  /** В архив (не навсегда). */
  removeRequest(id: string): Promise<void>;
  restoreRequest(id: string): Promise<VenueRequestRecord>;

  /** Предложение клиенту: сервер собирает снимок без адресов и контактов. */
  createOffer(input: { requestId: string | null; venueIds: string[]; comment: string }): Promise<PublicOffer>;
  listOffers(requestId: string): Promise<OfferSummary[]>;
  getOffer(id: string): Promise<PublicOffer>;
  offerPhotoUrl(offerId: string, sha: string): string;

  /** admin: открыть или закрыть ведущему базу площадок. */
  setAccess(uid: string, access: boolean): Promise<void>;
}
