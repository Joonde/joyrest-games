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
  ResultsRepository,
  SessionsRepository,
  UsersRepository,
} from "./contracts";
import { answersRepository } from "./answers";
import { authService as firebaseAuthService } from "./auth";
import { dataBackend } from "./backend";
import { clockService as firestoreClock } from "./clock";
import { gamesRepository } from "./games";
import { mediaRepository } from "./media";
import { participantsRepository } from "./participants";
import { resultsRepository } from "./results";
import { serverAuthService } from "./server/auth";
import { serverGamesRepository } from "./server/games";
import { serverMediaRepository } from "./server/media";
import { serverAnswersRepository } from "./server/answers";
import { serverClock } from "./server/clock";
import { serverParticipantsRepository } from "./server/participants";
import { serverResultsRepository } from "./server/results";
import { serverSessionsRepository } from "./server/sessions";
import { serverUsersRepository } from "./server/users";
import { sessionsRepository } from "./sessions";
import { usersRepository } from "./users";

const server = dataBackend() === "server";

export const authService: AuthService = server ? serverAuthService : firebaseAuthService;
export const usersRepo: UsersRepository = server ? serverUsersRepository : usersRepository;
export const gamesRepo: GamesRepository = server ? serverGamesRepository : gamesRepository;
export const mediaRepo: MediaRepository = server ? serverMediaRepository : mediaRepository;
export const sessionsRepo: SessionsRepository = server ? serverSessionsRepository : sessionsRepository;
export const participantsRepo: ParticipantsRepository = server ? serverParticipantsRepository : participantsRepository;
export const answersRepo: AnswersRepository = server ? serverAnswersRepository : answersRepository;
export const resultsRepo: ResultsRepository = server ? serverResultsRepository : resultsRepository;
export const clock: ClockService = server ? serverClock : firestoreClock;
