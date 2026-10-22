/**
 * Выбор реализации слоя данных по метке сервера (backend.ts): свой сервер или Firebase.
 * index.ts и hooks.ts берут экземпляры только отсюда. Firebase SDK грузится лениво, поэтому
 * на своём сервере он не скачивается, хотя модули Firebase-реализации подключены.
 */
import type {
  AnswersRepository,
  AuthService,
  ClockService,
  GamesRepository,
  MediaRepository,
  ParticipantsRepository,
  ProposalsRepository,
  ScreenStatusRepository,
  AudienceRepository,
  CalendarRepository,
  EventsRepository,
  ClientsRepository,
  NoticesRepository,
  TelegramRepository,
  TeamRepository,
  TracksRepository,
  VideosRepository,
  FinaleRepository,
  EventPhotosRepository,
  BrandingsRepository,
  DecksRepository,
  DrawingsRepository,
  PollsRepository,
  StaffRepository,
  ResultsRepository,
  SessionsRepository,
  UsersRepository,
  VenuesRepository,
} from "./contracts";
import { answersRepository } from "./answers";
import { authService as firebaseAuthService } from "./auth";
import { dataBackend } from "./backend";
import { edition } from "./edition";
import { clockService as firestoreClock } from "./clock";
import { gamesRepository } from "./games";
import { mediaRepository } from "./media";
import { participantsRepository } from "./participants";
import { resultsRepository } from "./results";
import { serverAuthService } from "./server/auth";
import { serverCalendarRepository } from "./server/calendar";
import { serverEventsRepository } from "./server/events";
import { serverClientsRepository } from "./server/clients";
import { serverNoticesRepository } from "./server/notices";
import { serverTelegramRepository } from "./server/telegram";
import { serverGameFolders, serverGamesRepository } from "./server/games";
import { serverMediaRepository } from "./server/media";
import { serverAnswersRepository } from "./server/answers";
import { serverClock } from "./server/clock";
import { serverParticipantsRepository } from "./server/participants";
import { serverProposalsRepository } from "./server/proposals";
import { serverStaffRepository } from "./server/staff";
import { serverScreenStatusRepository } from "./server/screen";
import { serverAudienceRepository } from "./server/audience";
import { serverTeamRepository } from "./server/team";
import { serverTracksRepository } from "./server/tracks";
import { serverVideosRepository } from "./server/videos";
import { serverFinaleRepository } from "./server/finale";
import { serverEventPhotosRepository } from "./server/photos";
import { serverBrandingsRepository } from "./server/brandings";
import { serverDecksRepository } from "./server/decks";
import { serverDrawingsRepository } from "./server/drawings";
import { serverPollsRepository } from "./server/polls";
import { serverResultsRepository } from "./server/results";
import { serverSessionsRepository } from "./server/sessions";
import { serverUsersRepository } from "./server/users";
import { serverVenuesRepository } from "./server/venues";
import { sessionsRepository } from "./sessions";
import { usersRepository } from "./users";

const server = dataBackend() === "server";
/**
 * Разделы агентства (CRM, команда, баллы, площадки, Telegram, предложения в библиотеку) — только на
 * своём сервере в платформе агентства. В Лайте их хранилища null: экраны и меню прячут их так же,
 * как в Firebase-версии, а сервер Лайта их адресов не регистрирует (server/src/app.ts).
 */
const agency = server && edition() !== "lite";

export const authService: AuthService = server ? serverAuthService : firebaseAuthService;
export const usersRepo: UsersRepository = server ? serverUsersRepository : usersRepository;
export const gamesRepo: GamesRepository = server ? serverGamesRepository : gamesRepository;
export const mediaRepo: MediaRepository = server ? serverMediaRepository : mediaRepository;
export const sessionsRepo: SessionsRepository = server ? serverSessionsRepository : sessionsRepository;
export const participantsRepo: ParticipantsRepository = server ? serverParticipantsRepository : participantsRepository;
export const answersRepo: AnswersRepository = server ? serverAnswersRepository : answersRepository;
export const resultsRepo: ResultsRepository = server ? serverResultsRepository : resultsRepository;
export const clock: ClockService = server ? serverClock : firestoreClock;

/** Предложения в библиотеку — только на своём сервере. */
export const proposalsRepo: ProposalsRepository | null = agency ? serverProposalsRepository : null;

/** Квалификация, стаж и баллы ведущих — только на своём сервере. */
export const staffRepo: StaffRepository | null = agency ? serverStaffRepository : null;
/** Папки «Моих игр» — только свой сервер. */
export const gameFoldersRepo: typeof serverGameFolders | null = server ? serverGameFolders : null;
/** Музыка — только свой сервер. */
export const tracksRepo: TracksRepository | null = server ? serverTracksRepository : null;
/** Фотоотчёт мероприятия — только свой сервер. */
export const photosRepo: EventPhotosRepository | null = agency ? serverEventPhotosRepository : null;
export const brandingsRepo: BrandingsRepository | null = agency ? serverBrandingsRepository : null;
export const decksRepo: DecksRepository | null = server ? serverDecksRepository : null;
/** Рисунки гостей «Аквариума и Ёлки» — только свой сервер. */
export const drawingsRepo: DrawingsRepository | null = server ? serverDrawingsRepository : null;
/** «Опрос гостей заранее» для «Что скажет большинство» — только свой сервер. */
export const pollsRepo: PollsRepository | null = server ? serverPollsRepository : null;
/** Конец игры: чаевые и отзывы — только свой сервер. */
export const finaleRepo: FinaleRepository | null = agency ? serverFinaleRepository : null;
/** Видео JoyRest — только свой сервер. */
export const videosRepo: VideosRepository | null = server ? serverVideosRepository : null;
/** «Команда JoyRest» — только свой сервер. */
export const teamRepo: TeamRepository | null = agency ? serverTeamRepository : null;
/** Экран зала сообщает пульту, что он на связи и звук разрешён, — только свой сервер. */
export const screenRepo: ScreenStatusRepository | null = server ? serverScreenStatusRepository : null;
/** «Помощь зала» по QR — только свой сервер. */
export const audienceRepo: AudienceRepository | null = server ? serverAudienceRepository : null;
/** База площадок, анкеты и предложения клиентам — только свой сервер. */
export const venuesRepo: VenuesRepository | null = agency ? serverVenuesRepository : null;
/** Календарь команды — только свой сервер. */
export const calendarRepo: CalendarRepository | null = agency ? serverCalendarRepository : null;
/** Планировщик мероприятий — только свой сервер. */
export const eventsRepo: EventsRepository | null = agency ? serverEventsRepository : null;
/** База клиентов — только свой сервер. */
export const clientsRepo: ClientsRepository | null = agency ? serverClientsRepository : null;
export const noticesRepo: NoticesRepository | null = agency ? serverNoticesRepository : null;
/** Свой Telegram для уведомлений — только свой сервер. */
export const telegramRepo: TelegramRepository | null = agency ? serverTelegramRepository : null;
