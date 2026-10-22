/**
 * Типы данных платформы. Не зависят от Firebase: при переезде на свой сервер
 * меняется только реализация в src/data/, а эти типы остаются.
 * Время везде — миллисекунды с эпохи по часам сервера.
 */
import type { SavedBranding, SessionBranding } from "../core/branding";
import type { SessionProgram } from "../core/program";
import type { OfferData, RequestData, RequestStatus, VenueData, VenueFileKind, VenueStatus } from "../core/venues";

export type { SavedBranding, SessionBranding };

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
  /** Свой сервер: владелец открыл ведущему базу площадок и заявки клиентов. */
  venueAccess?: boolean;
  /** Свой сервер: профессия в команде (`src/core/professions.ts`); нет — ведущий. */
  profession?: string;
  /** Свой сервер: роль доступа помощника (`src/core/accessRoles.ts`); нет — без роли. */
  accessRole?: string | null;
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
  /** Папка в «Моих играх» ('' или нет — без папки; только свой сервер). */
  folder?: string;
  /** Свой сервер: кто последним менял игру (uid) и его имя — «Эту игру сейчас правит …» в редакторе. */
  editedBy?: string;
  editedByName?: string;
}

export type NewGame = Omit<Game, "id" | "createdAt" | "updatedAt" | "editedBy" | "editedByName">;

/** Что можно менять в игре после создания. Область и владелец не меняются. */
export type GamePatch = Partial<Pick<Game, "title" | "themeId" | "ageRating" | "playMode" | "content" | "folder">>;

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
  /** Чёткая для большого экрана (до 1920 px) — только свой сервер и только если исходник больше полной. */
  hd?: { blob: Blob; width: number; height: number };
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
  /** Звук по кнопке ведущего: экран зала играет его, когда меняется id. */
  cue?: SoundCue | null;
  /** Фоновая музыка на экране зала: какой трек и играет ли. */
  music?: MusicState | null;
  /** Микшер: громкость музыки и эффектов (0–100), «без звука». */
  mix?: MixState | null;
  /** Слайд поверх экрана зала (заставка, правила, перерыв…); null — слайда нет. */
  slide?: SlideState | null;
  /** Команды: скрыть названия до представления и само представление по одной. */
  teams?: TeamsReveal | null;
  /** Таблица поверх игры по кнопке ведущего: общий счёт или счёт текущего раунда. */
  peek?: PeekView | null;
}

export type PeekView = "total" | "round";

export interface TeamsReveal {
  /** Названия команд скрыты: на экране и у других — «Команда 1» и звёздочки телефонов. */
  hidden: boolean;
  /** Представление команд: сколько уже показано (0 — первая); null — представления нет. */
  shown: number | null;
  /** Сколько телефонов в каждой команде (пишет пульт, пока названия скрыты). */
  sizes?: Record<string, number>;
}

export type SlideKind = "intro" | "rules" | "round" | "break" | "tech" | "join" | "award" | "thanks" | "custom" | "draw" | "image";

/** «Опрос гостей заранее» для «Что скажет большинство» (только свой сервер, `server/src/polls.ts`, логика — `src/core/polls.ts`). */
export interface PollQuestionRef {
  id: string;
  text: string;
}

/** Анкета опроса для гостя (без входа). */
export interface PollForm {
  id: string;
  title: string;
  questions: PollQuestionRef[];
  /** Приём ответов открыт. */
  open: boolean;
}

/** Опрос у ведущего: вопросы, его решения по группам и ответы гостей. */
export interface PollSummary extends PollForm {
  gameId: string;
  /** Сколько человек ответили (хотя бы на один вопрос). */
  respondents: number;
  /** Ответы гостей по вопросам (без имён: имя не спрашиваем). */
  responses: Record<string, string[]>;
  /** Объединения и подписи групп по вопросам. */
  edits: Record<string, { merges: Record<string, string>; labels: Record<string, string> }>;
}

/** Показ ведущего: фото и страницы PDF по порядку (только свой сервер, `server/src/decks.ts`). */
export interface DeckPage {
  sha: string;
  w: number;
  h: number;
  size: number;
}

export interface Deck {
  id: string;
  title: string;
  pages: DeckPage[];
  updatedAt: number;
}

/** Страница показа (фото или страница PDF) на весь экран зала: файл, следующий (экран грузит заранее), номер. */
export interface SlideMedia {
  deck: string;
  /** С нуля. */
  page: number;
  count: number;
  sha: string;
  next: string | null;
  w: number;
  h: number;
}

export interface SlideState {
  /** Новый id — новый показ (звук заставки играет один раз). */
  id: string;
  kind: SlideKind;
  title: string;
  text: string;
  /** Пункты (правила). */
  lines: string[];
  /** Конец перерыва по часам сервера; null — без обратного отсчёта. */
  endsAt: number | null;
  /** Слайд «image»: страница показа (фото, страница PDF). */
  media?: SlideMedia | null;
}

export interface MusicState {
  trackId: string;
  playing: boolean;
  /** Меняется при каждом новом запуске трека (с начала); пауза и продолжение его не меняют. */
  rev: string;
  /** Отрезок, громкость и затухание трека (из его настроек). */
  clip?: TrackClip;
}

/** Отрезок трека: секунды начала и конца (null — до конца), затухания в секундах, громкость 0–100. */
export interface TrackClip {
  start: number;
  end: number | null;
  fadeIn: number;
  fadeOut: number;
  volume: number;
}

export interface MixState {
  music: number;
  effects: number;
  muted: boolean;
}

// ---------- Музыка (только свой сервер, CLAUDE.md, раздел 7) ----------

export type TrackCategory = "music" | "lobby" | "background" | "contest" | "board" | "break" | "award" | "holiday";
export type TrackLicense = "pixabay" | "bought" | "own" | "other";
export type TrackShareStatus = "none" | "pending" | "accepted" | "rejected";

/** Конец игры: куда вести гостей — чаевые ведущему, отзыв, канал (решение владельца 15 октября 2026). */
export interface Finale {
  sessionId: string;
  hostName: string;
  gameTitle: string;
  /** Ссылка ведущего для чаевых (или владельца агентства); пусто — чаевых нет. */
  tipsUrl: string;
  /** Отзыв этого телефона, если уже оставлен. */
  myReview: { rating: number; text: string; name: string } | null;
}

/** Фото фотоотчёта мероприятия: до 3 на игру, `slot` 1–3. */
export interface EventPhoto {
  sessionId: string;
  slot: number;
  hostId: string;
  hostName: string;
  gameTitle: string;
  playedAt: number | null;
  width: number | null;
  height: number | null;
  createdAt: number;
  /** Адрес файла (с отпечатком — кэш на год). */
  url: string;
}

export type ReviewStatus = "new" | "published" | "hidden";

export interface GuestReview {
  id: string;
  sessionId: string;
  hostId: string;
  hostName: string;
  gameTitle: string;
  playedAt: number | null;
  rating: number;
  text: string;
  name: string;
  status: ReviewStatus;
  createdAt: number;
}

/**
 * Видео JoyRest на сервере (решение владельца 15 октября 2026): загружают владелец и заместитель, видят все,
 * ставят в игры с видео («Танцуй как звезда и Караоке на поле», «Танцевальный батл», музыкальное лото). Файл грузится
 * частями (`received` из `size`), `ready` — файл целиком на сервере.
 */
export interface LibraryVideo {
  id: string;
  title: string;
  folder: string;
  ownerId: string;
  ownerName: string;
  size: number;
  received: number;
  ready: boolean;
  durationMs: number | null;
  mime: string | null;
  createdAt: number;
}

export interface Track {
  id: string;
  ownerId: string;
  /** Имя владельца — в списке проверки у admin. */
  ownerName: string;
  scope: "personal" | "agency";
  title: string;
  category: TrackCategory;
  license: TrackLicense;
  licenseNote: string;
  /** Файл загружен — трек можно слушать и ставить. */
  ready: boolean;
  size: number;
  durationMs: number | null;
  shareStatus: TrackShareStatus;
  shareReason: string | null;
  createdAt: number;
  /** Отрезок, громкость и затухание на экране зала. */
  clip: TrackClip;
  /** Папка в «Музыке» ('' — без папки). */
  folder: string;
}

export interface TrackInput {
  id: string;
  scope: "personal" | "agency";
  title: string;
  category: TrackCategory;
  license: TrackLicense;
  licenseNote: string;
  /** Папка, в которую сразу кладём трек. */
  folder?: string;
}

/** Звуки кнопок пульта; "stop" — заглушить всё, что звучит. */
export type CueSound = "gong" | "drumroll" | "fanfare" | "applause" | "wrong" | "stop";

export interface SoundCue {
  id: string;
  sound: CueSound;
}

/**
 * Одна запись пульта: состояние шага и таблица лидеров меняются вместе.
 * `startedAt: "server"` — время ставит сервер.
 */
export interface SessionChange {
  state?: Partial<Omit<SessionState, "startedAt">> & { startedAt?: "server" | null };
  /** Запись участника целиком; null — убрать из таблицы. */
  leaderboard?: Record<string, LeaderboardEntry | null>;
  /**
   * Изменение — только если игра всё ещё там, где её видел пульт (иначе отказ `failed-precondition`):
   * отставший второй пульт или двойное касание не перескочат шаг и не перезапустят таймер.
   */
  expect?: ChangeExpect;
  /** Прибавить очки (±) к уже записанным — не затирает чужие одновременные правки. */
  addScore?: Record<string, number>;
  /** Новое имя в таблице, остальное в записи не трогается. */
  rename?: Record<string, string>;
}

export interface ChangeExpect {
  phase?: SessionPhase;
  step?: number;
  stage?: StepStage;
  /**
   * Отпечаток `state.result`, который видел пульт (`resultKey`). Действия, которые меняют очки без
   * смены шага и этапа («Выполнено», «Неверно», переигровка ничьей), со второго пульта не повторятся.
   */
  result?: string;
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
  /** Очки на старте текущего раунда: очки раунда = score − roundBase. */
  roundBase?: number;
  /** На сколько мест поднялся после последнего показанного ответа (−1 — опустился). */
  move?: number;
  /** Гонка «Кто быстрее»: сколько делений пройдено к финишу (угаданные треки, супер-трек — больше). */
  race?: number;
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
  /** Свой сервер: начало вечера — первый гость или «Начать игру» (по часам сервера). */
  eventStartedAt?: number | null;
  /** Свой сервер: мероприятие из блоков — один код на весь вечер (`src/core/program.ts`). */
  program?: SessionProgram | null;
  /** Свой сервер: оформление под заказчика — логотип и цвета (`src/core/branding.ts`). */
  branding?: SessionBranding | null;
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
  /** Мероприятие из блоков: игры вечера по порядку (сессия начинается с первой). Только свой сервер. */
  program?: { title: string; blocks: Array<{ title: string; mechanic: string; gameId: string; snapshot: unknown }> };
  /** Оформление под заказчика (только свой сервер). */
  branding?: SessionBranding | null;
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
  /** Свой сервер: «Начать игру» и «Завершить игру» (сколько шла игра). */
  startedAt?: number | null;
  finishedAt?: number | null;
  /** Свой сервер: перерывы вечера (слайд «Перерыв»): сколько длились и сколько их было. */
  breaksMs?: number;
  breaksCount?: number;
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

/**
 * Календарь команды (CLAUDE.md, раздел 3, «Календарь»): «свободен», «занят» — отмечает сам человек;
 * «мероприятие» — время, закреплённое за ним владельцем. Время — минуты от полуночи дня `day`
 * (конец до 06:00 следующего дня — до 1800).
 */
export type AvailabilityKind = "free" | "busy" | "booked";

export interface AvailabilityEntry {
  id: string;
  uid: string;
  /** «ГГГГ-ММ-ДД». */
  day: string;
  start: number;
  end: number;
  kind: AvailabilityKind;
  /** Заметка: «своё мероприятие», у закреплённого — что за мероприятие. */
  note: string;
}

/**
 * Мероприятие агентства (планировщик в календаре; только свой сервер). Имя и телефон клиента видят
 * владелец и ведущий этого мероприятия; в Telegram они не уходят.
 */
export interface AgencyEvent {
  id: string;
  hostId: string;
  hostName: string;
  /** «ГГГГ-ММ-ДД», время — минуты от полуночи (конец до 06:00 следующего дня). */
  day: string;
  start: number;
  end: number;
  clientName: string;
  clientPhone: string;
  /** Что за мероприятие: «Свадьба», «Корпоратив»… */
  title: string;
  place: string;
  guests: number | null;
  note: string;
  cancelled: boolean;
  /** После начала: true — проведено, false — не состоялось, null — не отмечено. */
  held: boolean | null;
  /** Версия записи (время последнего изменения): форма правки шлёт её как `expect` — чужую правку не затереть. */
  updatedAt?: number;
  /** Только в ответе на сохранение: мероприятие записано, а клиент в базу клиентов — нет (добавить вручную). */
  clientNotSaved?: boolean;
}

/** Клиент агентства (база клиентов владельца; только свой сервер). Данные — только на сервере в России. */
export interface ClientRecord {
  id: string;
  name: string;
  phone: string;
  /** Ссылки на соцсети: https://t.me/…, https://vk.com/…, https://instagram.com/…, https://wa.me/… */
  links: string[];
  status: "new" | "work" | "client" | "held" | "lost";
  /** Согласие на рассылку: yes — сам отметил или подтвердил; no — отказался. */
  marketing: "yes" | "no" | "unknown";
  marketingAt: number | null;
  /** Откуда согласие: «сайт», «вручную: …». */
  marketingSource: string;
  notes: string;
  createdAt: number;
  lastContactAt: number;
  /** Сколько обращений (заявки, мероприятия). */
  contacts: number;
  /** Откуда последнее обращение: site, question, venue, event, telegram, manual. */
  lastSource: string;
  archived: boolean;
  /** Версия карточки (время последнего изменения): форма шлёт её как `expect`, чтобы не затереть чужую правку. */
  updatedAt: number;
  /** Последняя смена статуса — «В работе · Мария» (кто взял клиента); пусто — статус не меняли. */
  statusLine: string;
  statusAt: number | null;
  /** С какого времени клиент ждёт ответа в Telegram (бот в Telegram для бизнеса); null — не ждёт. */
  tgWaitingSince?: number | null;
  /** Откуда пришёл: site, avito, qr, card, telegram… (`ORIGIN_TITLES`); пусто — не указан. */
  origin?: string;
  /** С какого времени ждёт в «Новом» (таймер идёт); null — не ждёт или карточка заведена до таймера. */
  newSince?: number | null;
  /** Ушёл из «Нового»: когда, сколько ждал и кто взял (таймер стоит). */
  takenAt?: number | null;
  takenMs?: number | null;
  takenBy?: string;
}

/** Один ответ на новую заявку: сколько ждала, кто взял, когда (среднее время ответа). */
export interface ClientResponse {
  userName: string;
  waitedMs: number;
  takenAt: number;
}

export interface ClientContact {
  id: string;
  source: string;
  summary: string;
  at: number;
  /** id заявки по QR или мероприятия — ссылка из истории. */
  ref: string | null;
}

export interface ClientDetails extends ClientRecord {
  history: ClientContact[];
}

/** «Данные по номеру»: всё, что есть в базе по телефону, нику или почте человека (только владелец). */
/** Уведомление колокольчика студии: новое обращение клиента или клиент ждёт ответа в Telegram. */
export interface Notice {
  id: string;
  clientId: string;
  kind: "new" | "waiting";
  /** «Заявка с сайта», «Из Telegram», «Ждёт ответа в Telegram». */
  title: string;
  /** Имя клиента (или телефон). */
  name: string;
  /** Первая строка обращения. */
  line: string;
  at: number;
  unread: boolean;
}

export interface NoticesState {
  unread: number;
  items: Notice[];
}

export interface ContactMatches {
  /** Как понят запрос: «+7 915 241-59-99», «@nick», почта. */
  label: string;
  clients: Array<{ id: string; name: string; phone: string; contacts: number; archived: boolean }>;
  /** Заявки на подбор площадки (QR-анкета клиента). */
  requests: Array<{ id: string; number: number; name: string; title: string; archived: boolean }>;
  /** Мероприятия планировщика, где это клиент. */
  events: Array<{ id: string; title: string; day: string; clientName: string; cancelled: boolean }>;
  /** Площадки, где это контактное лицо. */
  venues: Array<{ id: string; name: string; person: string }>;
}

/** Что удалено по запросу человека. */
export interface EraseReport {
  clients: number;
  requests: number;
  events: number;
  venues: number;
}

/** Бот уведомлений глазами владельца: настроен ли, читает ли сообщения, сколько людей подключено. */
export interface TelegramHealth {
  configured: boolean;
  polling: boolean;
  username: string | null;
  lastPollAt: number | null;
  state: "ok" | "conflict" | "error" | "starting" | "off";
  linkedPeople: number;
}

/** Telegram человека команды: подключён ли бот уведомлений. */
export interface TelegramStatus {
  /** Подключение работает на этой версии платформы (бот настроен и слушает сообщения). */
  available: boolean;
  linked: boolean;
  username: string;
}

/** Человек в календаре владельца: имя и профессия, без почты. */
export interface CalendarMember {
  uid: string;
  name: string;
  profession?: string;
  owner: boolean;
}

/** Карточка ведущего в «Команде JoyRest» — без почты, квалификации и баллов. */
export interface TeamMember {
  uid: string;
  name: string;
  bio: string;
  /** Отпечаток аватарки (адрес картинки меняется вместе с ним); null — нет. */
  avatar: string | null;
  cover: string | null;
  /** Владелец агентства. */
  owner: boolean;
  /** С какого дня в JoyRest (дата добавления). */
  since: number | null;
  /** Профессия в команде; нет — ведущий. */
  profession?: string;
}

/** Что экран зала сообщает пульту о себе (не в базе, только в памяти сервера). */
export interface ScreenReport {
  /** Браузер разрешил звук (было касание). */
  soundReady: boolean;
  /** Звук выключен кнопкой на самом экране. */
  muted: boolean;
  /** Музыка не включилась — нужно коснуться экрана. */
  musicBlocked: boolean;
}

export interface ScreenStatus extends ScreenReport {
  /** Когда экран сообщал о себе в последний раз (мс, часы сервера). */
  seenAt: number;
}

// ------------------------------------------------------------------ база площадок (свой сервер)

export type { OfferData, RequestData, RequestStatus, VenueData, VenueFileKind, VenueStatus };

export interface VenueFileInfo {
  sha: string;
  kind: VenueFileKind;
  mime: string;
  size: number;
  name: string;
}

/** Площадка в базе: анкета и наше служебное (статус, оценка, заметки, кто привёл). */
export interface VenueRecord {
  id: string;
  data: VenueData;
  status: VenueStatus;
  rating: number | null;
  notes: string;
  source: "form" | "manual";
  hostId: string | null;
  hostName: string | null;
  files: VenueFileInfo[];
  /** В архиве с этого времени (удалили), null — в базе. */
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** Заявка клиента с номером. */
export interface VenueRequestRecord {
  id: string;
  number: number;
  data: RequestData;
  status: RequestStatus;
  notes: string;
  hostId: string | null;
  hostName: string | null;
  /** Сколько предложений уже отправлено по заявке. */
  offers: number;
  /** В архиве с этого времени, null — в работе. */
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface OfferSummary {
  id: string;
  title: string;
  venues: string[];
  createdAt: number;
}

/** Предложение клиенту, как его видит клиент по ссылке. */
export interface PublicOffer extends OfferData {
  id: string;
  createdAt: number;
}

/** Файл анкеты: фото (сжатое на устройстве) или PDF меню как есть. */
export interface VenueUpload {
  kind: VenueFileKind;
  blob: Blob;
  name: string;
}

/** Игрок не на связи: за него можно войти с другого телефона. */
export interface OfflinePlayer {
  pid: string;
  name: string;
  /** Название команды (режим команд). */
  team: string | null;
}

/** Строка «Игры сейчас» (лёгкая, без снимка игры). */
export interface SessionSummary {
  id: string;
  code: string;
  hostId: string;
  hostName: string;
  gameTitle: string;
  mechanic: string | null;
  phase: SessionPhase;
  screenMode: ScreenMode;
  /** Телефоны гостей. */
  players: number;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  /** «Ждёт гостей» или «идёт», но 12 часов без действий — скорее всего, брошена. */
  stale: boolean;
}
