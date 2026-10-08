/**
 * Кто что может — обычные функции без Firebase. Смысл тот же, что в firestore.rules:
 * правила защищают базу, а эти функции решают, что показывать в интерфейсе, и
 * переезжают на свой сервер как есть. Меняете права — меняйте оба места и оба теста
 * (permissions.test.ts и tests/rules/firestore.test.ts).
 */
import { ADMIN_UID } from "./config";
import type { Answer, Game, GameScope, Participant, Session, SessionState, UserProfile } from "./types";

/** Кто действует: профиль ведущего или null (гость, не вошёл). */
export type Actor = (Pick<UserProfile, "uid" | "role" | "active"> & { venueAccess?: boolean; profession?: string | null; accessRole?: string | null }) | null;

/** Роль доступа помощника (`src/core/accessRoles.ts`) у активного аккаунта. */
function hasAccess(actor: Actor, role: string): boolean {
  return isActiveHost(actor) && actor?.accessRole === role;
}

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

/**
 * Проводит игры: активный ведущий (профессия «ведущий» или не указана — Firebase-версия её не знает)
 * или admin. Диджеи, музыканты, фокусники и другие профессии команды входят в платформу, видят
 * команду и свой профиль, но игр и сессий у них нет (только свой сервер).
 */
export function hostsGames(actor: Actor): boolean {
  if (!isActiveHost(actor)) return false;
  return isAdmin(actor) || !actor?.profession || actor.profession === "host";
}

/** Игры в студии: ведущие, создатели игр и тестировщики (тестировщик только смотрит и репетирует). */
export function canUseGames(actor: Actor): boolean {
  return hostsGames(actor) || hasAccess(actor, "creator") || hasAccess(actor, "tester");
}

/** Создавать и править свои игры: ведущие и создатели игр. */
function writesGames(actor: Actor): boolean {
  return hostsGames(actor) || hasAccess(actor, "creator");
}

/** Музыка в студии: ведущие, музыкальные редакторы; слушать — ещё создатели игр и тестировщики. */
export function canUseTracks(actor: Actor): boolean {
  return hostsGames(actor) || hasAccess(actor, "music") || hasAccess(actor, "creator") || hasAccess(actor, "tester");
}

function writesTracks(actor: Actor): boolean {
  return hostsGames(actor) || hasAccess(actor, "music");
}

/** «Игры сейчас» всех ведущих и завершение чужой брошенной игры: владелец и помощник владельца. */
export function canSeeAllSessions(actor: Actor): boolean {
  return isAdmin(actor) || hasAccess(actor, "assistant");
}

/** Дать или снять роль — только владелец, не себе и не владельцу. */
export function canSetAccessRole(actor: Actor, target: Pick<UserProfile, "uid">): boolean {
  return canSetHostActive(actor, target);
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
  if (!canUseGames(actor)) return false;
  return game.scope === "agency" || game.ownerId === actor?.uid || isAdmin(actor);
}

/** Создать игру в нужной библиотеке: общую — только admin, личную — себе. */
export function canCreateGame(actor: Actor, scope: GameScope, ownerId: string): boolean {
  if (scope === "agency") return isAdmin(actor);
  return writesGames(actor) && ownerId === actor?.uid;
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

/**
 * Предложить игру в общую библиотеку — только свой сервер (в firestore.rules этого нет):
 * активный ведущий, только свою личную игру. Владельцу агентства предлагать незачем — он
 * сам делает «Копию в библиотеку JoyRest».
 */
export function canProposeGame(actor: Actor, game: GameRef): boolean {
  return writesGames(actor) && !isAdmin(actor) && game.scope === "personal" && game.ownerId === actor?.uid;
}

/** Принять или отклонить предложение — тот, кто правит библиотеку (admin). Роли этого не дают. */
export function canReviewProposals(actor: Actor): boolean {
  return isAdmin(actor);
}

/** Трек музыки: личный — у владельца, общий (agency) — правит admin. Только свой сервер. */
export interface TrackRef {
  scope: "personal" | "agency";
  ownerId: string;
}

/** Загружать музыку себе может любой активный ведущий; в общую библиотеку сразу — только admin. */
export function canUploadTrack(actor: Actor, scope: TrackRef["scope"]): boolean {
  return scope === "agency" ? isAdmin(actor) : writesTracks(actor);
}

/** Слушать и ставить на экран: свои треки и всю общую библиотеку; admin — любые (проверка). */
export function canUseTrack(actor: Actor, track: TrackRef): boolean {
  if (!canUseTracks(actor)) return false;
  return track.scope === "agency" || track.ownerId === actor?.uid || isAdmin(actor);
}

/** Переименовать, удалить: личный — владелец, общий — admin. */
export function canEditTrack(actor: Actor, track: TrackRef): boolean {
  if (!writesTracks(actor)) return false;
  return track.scope === "agency" ? isAdmin(actor) : track.ownerId === actor?.uid;
}

/** Предложить трек в общую — ведущий, свой личный (admin загружает в общую сам). */
export function canShareTrack(actor: Actor, track: TrackRef): boolean {
  return writesTracks(actor) && !isAdmin(actor) && track.scope === "personal" && track.ownerId === actor?.uid;
}

/** Принять или отклонить трек — admin. Роли этого не дают. */
export function canReviewTracks(actor: Actor): boolean {
  return isAdmin(actor);
}

/** «Команда JoyRest»: карточки видят и правят свою все активные ведущие. Только свой сервер. */
export function canViewTeam(actor: Actor): boolean {
  return isActiveHost(actor);
}

/**
 * База площадок и заявки клиентов (CLAUDE.md, «База площадок»; только свой сервер): владелец и
 * ведущие, которым он открыл доступ в /admin. QR-коды анкет показывает любой активный ведущий.
 */
export function canManageVenues(actor: Actor): boolean {
  return isAdmin(actor) || (isActiveHost(actor) && actor?.venueAccess === true) || hasAccess(actor, "venues");
}

/** Убрать площадку или заявку в архив: владелец и ведущие с доступом к базе (модератор — нет). */
export function canArchiveVenues(actor: Actor): boolean {
  return isAdmin(actor) || (isActiveHost(actor) && actor?.venueAccess === true);
}

export function canShowVenueQr(actor: Actor): boolean {
  return isActiveHost(actor);
}

/** Открыть или закрыть ведущему базу площадок — admin; владельцу и себе менять незачем. */
export function canGrantVenueAccess(actor: Actor, target: Pick<UserProfile, "uid">): boolean {
  return canSetHostActive(actor, target);
}

/** Отключённый ведущий не создаёт сессии. */
export function canCreateSession(actor: Actor): boolean {
  return hostsGames(actor);
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
