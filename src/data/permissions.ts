/**
 * Кто что может — обычные функции без Firebase. Смысл тот же, что в firestore.rules:
 * правила защищают базу, а эти функции решают, что показывать в интерфейсе, и
 * переезжают на свой сервер как есть. Меняете права — меняйте оба места и оба теста
 * (permissions.test.ts и tests/rules/firestore.test.ts).
 */
import { ADMIN_UID } from "./config";
import type { Answer, Game, GameScope, Participant, Session, SessionState, UserProfile } from "./types";

/** Кто действует: профиль ведущего или null (гость, не вошёл). */
export type Actor = Pick<UserProfile, "uid" | "role" | "active"> | null;

/** Владелец агентства (UID зашит в config.ts и firestore.rules) или активный admin. */
export function isAdmin(actor: Actor): boolean {
  if (!actor) return false;
  return actor.uid === ADMIN_UID || (actor.role === "admin" && actor.active);
}

/** Активный ведущий: host или admin. Отключённый ведущий не может ничего. */
export function isActiveHost(actor: Actor): boolean {
  if (!actor) return false;
  return isAdmin(actor) || (actor.role === "host" && actor.active);
}

/** Раздел /admin: список, добавление и отключение ведущих. */
export function canManageHosts(actor: Actor): boolean {
  return isAdmin(actor);
}

/** Владельца агентства отключить нельзя, себя — тоже. */
export function canSetHostActive(actor: Actor, target: Pick<UserProfile, "uid">): boolean {
  return isAdmin(actor) && target.uid !== ADMIN_UID && target.uid !== actor?.uid;
}

/**
 * «Новый временный пароль» ведущему — только на своём сервере (у Firebase без Cloud Functions
 * этого нет, поэтому в firestore.rules правила нет). Те же ограничения, что у отключения:
 * свой пароль меняют в студии, пароль владельца — `sudo joyrest admin-password`.
 */
export function canResetHostPassword(actor: Actor, target: Pick<UserProfile, "uid">): boolean {
  return canSetHostActive(actor, target);
}

type GameRef = Pick<Game, "scope" | "ownerId">;

export function canReadGame(actor: Actor, game: GameRef): boolean {
  if (!isActiveHost(actor)) return false;
  return game.scope === "agency" || game.ownerId === actor?.uid || isAdmin(actor);
}

/** Создать игру в нужной библиотеке: общую — только admin, личную — себе. */
export function canCreateGame(actor: Actor, scope: GameScope, ownerId: string): boolean {
  if (scope === "agency") return isAdmin(actor);
  return isActiveHost(actor) && ownerId === actor?.uid;
}

/** Общую библиотеку редактирует только admin, личную игру — только её владелец. */
export function canEditGame(actor: Actor, game: GameRef): boolean {
  return canCreateGame(actor, game.scope, game.ownerId);
}

export function canDeleteGame(actor: Actor, game: GameRef): boolean {
  return canEditGame(actor, game);
}

/**
 * Картинки игры (games/{id}/media) открывает любой вошедший, кто знает id картинки:
 * экран зала и телефоны гостей входят анонимно, а id есть только в снимке сессии.
 */
export function canViewMedia(uid: string | null): boolean {
  return uid !== null;
}

/** Добавлять и удалять картинки может тот, кто правит игру. */
export function canChangeMedia(actor: Actor, game: GameRef): boolean {
  return canEditGame(actor, game);
}

/** Копия в «Мои игры» доступна для любой игры, которую ведущий видит. */
export function canCopyToPersonal(actor: Actor, game: GameRef): boolean {
  return canReadGame(actor, game) && canCreateGame(actor, "personal", actor?.uid ?? "");
}

/** Отключённый ведущий не создаёт сессии. */
export function canCreateSession(actor: Actor): boolean {
  return isActiveHost(actor);
}

export function canLaunchGame(actor: Actor, game: GameRef): boolean {
  return canCreateSession(actor) && canReadGame(actor, game);
}

/** Менять state и leaderboard может только владелец сессии. */
export function canControlSession(uid: string | null, session: Pick<Session, "hostId">): boolean {
  return uid !== null && uid === session.hostId;
}

/** Удалять сессию может её владелец, а старые сессии чистит admin. */
export function canDeleteSession(actor: Actor, session: Pick<Session, "hostId">): boolean {
  return canControlSession(actor?.uid ?? null, session) || isAdmin(actor);
}

/** История игр: ведущий видит свои итоги, admin — все. По ссылке итоги открываются без входа. */
export function canListResults(actor: Actor, hostId: string): boolean {
  return actor !== null && (actor.uid === hostId || isAdmin(actor));
}

export function canCleanupSessions(actor: Actor): boolean {
  return isAdmin(actor);
}

/** Запас на задержку сети после конца таймера; тот же запас — в firestore.rules. */
export const ANSWER_GRACE_MS = 3000;

/**
 * Ответ принимается только на текущий открытый вопрос и пока не вышло время
 * (по часам сервера, с запасом 3 секунды на сеть).
 */
export function canSubmitAnswer(state: SessionState, step: number, serverNow: number): boolean {
  if (state.phase !== "playing" || state.step !== step || state.revealed || state.stage !== "question") return false;
  if (state.timeLimit === null) return true;
  return state.startedAt !== null && serverNow <= state.startedAt + state.timeLimit * 1000 + ANSWER_GRACE_MS;
}

/**
 * Ответы списком видит только ведущий сессии. По id телефон открывает свой ответ
 * или ответ своей команды.
 */
export function canReadAnswer(
  uid: string | null,
  session: Pick<Session, "hostId">,
  answer: Pick<Answer, "uid" | "pid">,
  myPhone: Pick<Participant, "teamId"> | null,
): boolean {
  if (uid === null) return false;
  if (canControlSession(uid, session)) return true;
  return answer.uid === uid || (myPhone?.teamId !== null && myPhone?.teamId === answer.pid);
}
