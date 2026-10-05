// Единственная точка входа к данным для компонентов. Firebase наружу не торчит.
export * from "./types";
export {
  describeAuthError,
  ensureSignedIn,
  signInHost,
  signOutUser,
  type AuthUser,
} from "./auth";
export {
  createSession,
  findSessionByCode,
  listHostSessions,
  setSessionPhase,
  upsertLeaderboardEntries,
  watchSession,
} from "./sessions";
export { createTeam, getMyParticipant, joinAsPlayer, listTeams, watchParticipants } from "./participants";
export { answerId, submitAnswer, watchAnswers, type SubmitResult } from "./answers";
export { useAuth, useSessionByCode, type AuthState, type SessionLoadState } from "./hooks";
