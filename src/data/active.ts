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
import {
  answersNotYet,
  clockNotYet,
  gamesNotYet,
  mediaNotYet,
  participantsNotYet,
  resultsNotYet,
  sessionsNotYet,
} from "./server/unavailable";
import { serverUsersRepository } from "./server/users";
import { sessionsRepository } from "./sessions";
import { usersRepository } from "./users";

const server = dataBackend() === "server";

export const authService: AuthService = server ? serverAuthService : firebaseAuthService;
export const usersRepo: UsersRepository = server ? serverUsersRepository : usersRepository;
export const gamesRepo: GamesRepository = server ? gamesNotYet : gamesRepository;
export const mediaRepo: MediaRepository = server ? mediaNotYet : mediaRepository;
export const sessionsRepo: SessionsRepository = server ? sessionsNotYet : sessionsRepository;
export const participantsRepo: ParticipantsRepository = server ? participantsNotYet : participantsRepository;
export const answersRepo: AnswersRepository = server ? answersNotYet : answersRepository;
export const resultsRepo: ResultsRepository = server ? resultsNotYet : resultsRepository;
export const clock: ClockService = server ? clockNotYet : firestoreClock;
