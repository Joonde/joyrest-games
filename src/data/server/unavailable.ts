/**
 * То, что ещё не перенесено на свой сервер: игры и картинки — PR 3.2, сессии, гости и ответы —
 * PR 4.1, история — PR 4.2. До тех пор на тестовом адресе эти экраны показывают ошибку
 * `unimplemented` (настоящая ошибка, без бесконечных повторов). Основная версия на Firebase
 * и эти заглушки не использует.
 */
import type {
  AnswersRepository,
  ClockService,
  GamesRepository,
  MediaRepository,
  ParticipantsRepository,
  ResultsRepository,
  SessionsRepository,
} from "../contracts";
import type { Unsubscribe } from "../types";
import { ApiError, notYet } from "./api";

function watchNotYet(onError: (error: Error) => void): Unsubscribe {
  const timer = setTimeout(() => onError(new ApiError("unimplemented", 501)), 0);
  return () => clearTimeout(timer);
}

export const gamesNotYet: GamesRepository = {
  listAgency: notYet,
  listPersonal: notYet,
  get: notYet,
  create: notYet,
  copy: notYet,
  update: notYet,
  remove: notYet,
};

export const mediaNotYet: MediaRepository = {
  upload() {
    throw new ApiError("unimplemented", 501);
  },
  load: notYet,
  remove: notYet,
};

export const sessionsNotYet: SessionsRepository = {
  create: notYet,
  findByCode: notYet,
  findHostSessionByCode: notYet,
  get: notYet,
  watch: (_id, _onChange, onError) => watchNotYet(onError),
  listByHost: notYet,
  setPhase: notYet,
  upsertLeaderboard: notYet,
  apply: notYet,
  finish: notYet,
  removeExpired: notYet,
};

export const participantsNotYet: ParticipantsRepository = {
  getMine: notYet,
  joinAsPlayer: notYet,
  createTeam: notYet,
  listTeams: notYet,
  rename: notYet,
  remove: notYet,
  setCaptain: notYet,
  touch: notYet,
  watch: (_id, _onChange, onError) => watchNotYet(onError),
};

export const answersNotYet: AnswersRepository = {
  submit: notYet,
  watch: (_id, _step, _onChange, onError) => watchNotYet(onError),
  getOwn: notYet,
  clearStep: notYet,
};

export const resultsNotYet: ResultsRepository = {
  get: notYet,
  listByHost: notYet,
};

/** Часы пока свои: смещение 0 (таймер по часам устройства) — до PR 4.1 (`GET /api/time`). */
export const clockNotYet: ClockService = {
  offset: () => 0,
  sync: async () => 0,
};
