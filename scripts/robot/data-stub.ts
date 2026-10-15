// Слой данных для робота-ведущего: всё в памяти страницы, без сервера. Механики и экраны берут отсюда то
// же, что из `src/data` (права, ошибки, разборщики), а хранилища — заглушки.
export * as permissions from "../../src/data/permissions";
export { Cancelled, errorCodeOf, isPermanentError, retryDelay, withRetry } from "../../src/data/retry";
export * from "../../src/data/cues";
export * from "../../src/data/trackClip";

export const clock = { offset: () => 0, sync: async () => 0 };
export const connection = { subscribe: () => () => undefined, online: () => true };
export const dataBackend = () => "server";
export const tracksRepo = null;
export const videosRepo = null;
export const finaleRepo = null;
export const photosRepo = null;
export const brandingsRepo = null;
export const decksRepo = null;
export const screenRepo = null;
export const venuesRepo = null;
export const teamRepo = null;
export const telegramRepo = null;
export const eventsRepo = null;
export const clientsRepo = null;
export const calendarRepo = null;
export const audienceRepo = null;
export const proposalsRepo = null;
export const mediaRepo = {
  upload: () => ({ mediaId: "m", saved: Promise.resolve() }),
  load: async () => null,
  remove: async () => undefined,
};
export const gamesRepo = { listAgency: async () => [], listPersonal: async () => [], get: async () => null };
export const authService = { watch: () => () => undefined, signOut: async () => undefined };
export const sessionsRepo = { program: undefined };
export function useAuth(): [{ status: "signedOut" }, () => void] {
  return [{ status: "signedOut" }, () => undefined];
}
export function useLoad(): [{ status: "loading" }, () => void] {
  return [{ status: "loading" }, () => undefined];
}
export const gameFoldersRepo = null;
