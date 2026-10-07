// Единственная точка входа к данным для экранов, компонентов и механик.
// Наружу — только интерфейсы (contracts.ts) и их экземпляры; Firebase не торчит.
// Реализацию (свой сервер или Firebase) выбирает active.ts по метке сервера.
export * from "./types";
export type * from "./contracts";
export * as permissions from "./permissions";
export type { Actor } from "./permissions";

export {
  answersRepo,
  authService,
  clock,
  gamesRepo,
  mediaRepo,
  participantsRepo,
  resultsRepo,
  sessionsRepo,
  usersRepo,
} from "./active";

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
export { firebaseImport } from "./active";
export type { FirebaseImport, ImportCount, ImportProgress, ImportReport, ImportStage, MediaIdsOf } from "./importer";
export { NotOwnerError } from "./importer";
export { connection } from "./connection";
export { Cancelled, isPermanentError, retryDelay, withRetry } from "./retry";
