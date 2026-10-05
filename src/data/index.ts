// Единственная точка входа к данным для экранов, компонентов и механик.
// Наружу — только интерфейсы (contracts.ts) и их экземпляры; Firebase не торчит.
// При переезде на свой сервер здесь подменяются реализации.
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
import { clockService as firestoreClock } from "./clock";
import { gamesRepository } from "./games";
import { mediaRepository } from "./media";
import { participantsRepository } from "./participants";
import { resultsRepository } from "./results";
import { sessionsRepository } from "./sessions";
import { usersRepository } from "./users";

export * from "./types";
export type * from "./contracts";
export * as permissions from "./permissions";
export type { Actor } from "./permissions";

export const authService: AuthService = firebaseAuthService;
export const usersRepo: UsersRepository = usersRepository;
export const gamesRepo: GamesRepository = gamesRepository;
export const mediaRepo: MediaRepository = mediaRepository;
export const sessionsRepo: SessionsRepository = sessionsRepository;
export const participantsRepo: ParticipantsRepository = participantsRepository;
export const answersRepo: AnswersRepository = answersRepository;
export const resultsRepo: ResultsRepository = resultsRepository;
export const clock: ClockService = firestoreClock;

export { answerId } from "./answers";
export {
  useAuth,
  useGuestSignIn,
  useLoad,
  useSessionByCode,
  type AuthState,
  type GuestSignInState,
  type LoadState,
  type SessionByCodeOptions,
  type SessionLoadState,
} from "./hooks";
export { preloadData } from "./firebase";
export { connection } from "./connection";
export { Cancelled, isPermanentError, retryDelay, withRetry } from "./retry";
