/**
 * «Мои возможности» (решение владельца 15 октября 2026): у каждого человека команды — страница с тем, что он может и
 * чего не может в платформе, с кнопкой «Скачать PDF» (`/studio/abilities`, владелец — ещё для любого человека).
 * Каждая строка привязана к настоящей проверке прав из `src/data/permissions.ts`: сменились права — сменился и текст,
 * расхождений с сервером нет. Сверяет `src/data/abilities.test.ts`.
 */
import type { Actor, permissions } from "../data";
import { ACCESS_ROLES, accessRoleTitle, isAccessRole } from "./accessRoles";
import { professionOf, professionTitle } from "./professions";

export interface AbilityItem {
  /** Что можно сделать — простыми словами. */
  text: string;
  /** Где это в студии. */
  where?: string;
}

export interface AbilityGroup {
  title: string;
  items: AbilityItem[];
}

export interface Abilities {
  /** «Ведущий», «Менеджер по продажам», «Владелец агентства». */
  who: string;
  /** Роль доступа, если есть. */
  role: string | null;
  /** Одна строка: в чём работа человека. */
  summary: string;
  can: AbilityGroup[];
  cannot: string[];
  /** Инструкции, которые стоит скачать вместе с этой страницей. */
  guides: { title: string; to: string }[];
}

const GAME: { scope: "personal"; ownerId: string } = { scope: "personal", ownerId: "" };
const AGENCY = { scope: "agency" as const, ownerId: "agency" };

/** Функции прав (`permissions` из src/data) — передаются параметром, чтобы ядро не тянуло слой данных. */
export type Permissions = typeof permissions;

/** Что может этот человек: по его профессии, роли и доступу — те же функции прав, что на сервере. */
export function abilitiesOf(actor: Actor, p: Permissions): Abilities {
  const uid = actor?.uid ?? "";
  const own = { ...GAME, ownerId: uid };
  const admin = p.isAdmin(actor);
  const role = isAccessRole(actor?.accessRole) ? actor?.accessRole ?? null : null;
  const roleInfo = ACCESS_ROLES.find((r) => r.id === role) ?? null;
  const who = admin ? "Владелец агентства" : professionTitle(professionOf(actor?.profession ?? null));
  const groups: AbilityGroup[] = [];
  const add = (title: string, items: (AbilityItem | false | null | undefined)[]) => {
    const list = items.filter((i): i is AbilityItem => Boolean(i));
    if (list.length) groups.push({ title, items: list });
  };

  add("Профиль и команда", [
    p.canViewTeam(actor) && { text: "Свой профиль: фото, обложка, «о себе», смена пароля.", where: "меню → «Мой профиль»" },
    p.canViewTeam(actor) && { text: "Карточки всей команды JoyRest.", where: "меню → «Команда JoyRest»" },
    p.canLinkTelegram(actor) && { text: "Уведомления в Telegram: назначения, изменения, напоминания (без данных клиентов).", where: "«Мой профиль» → «Подключить Telegram»" },
    p.canShowVenueQr(actor) && { text: "QR-анкеты: заведение заполняет анкету площадки, клиент — запрос на подбор.", where: "меню → «QR-анкеты»" },
  ]);

  add("Календарь и мероприятия", [
    p.canEditOwnCalendar(actor) && { text: "Свой календарь: когда свободен и когда занят, повтор по неделям.", where: "«Календарь» → «Мой календарь»" },
    p.canEditOwnCalendar(actor) && { text: "Мероприятия, на которые вас поставили, и «Добавить в календарь телефона».", where: "«Календарь» → «Мероприятия»" },
    p.canViewTeamCalendar(actor) && { text: "«Кто может» в дату: кто из команды свободен, закрепить время за человеком.", where: "«Календарь» → «Кто может»" },
    p.canManageEvents(actor) && { text: "Записать, изменить, отменить и вернуть мероприятие; «Заполнить из заявки».", where: "«Календарь» → «Мероприятия»" },
    p.canMarkEventHeld(actor, { hostId: "someone-else" }) && { text: "Отметить «Проведено» / «Не состоялось» у любого мероприятия." },
    p.canViewEventStats(actor) && { text: "Итоги: сколько мероприятий, гостей, по ведущим и видам.", where: "«Мероприятия» → «Итоги»" },
    p.canDeleteEvent(actor) && { text: "Удалить отменённое мероприятие навсегда." },
  ]);

  add("Клиенты и продажи", [
    p.canManageClients(actor) && { text: "База клиентов: заявки с сайта целиком, статус одним касанием, заметки, связь в один тап.", where: "меню → «Клиенты»" },
    p.canReadSalesGuide(actor) && { text: "Инструкция менеджера: от анкеты до отзыва, шаблоны сообщений, цены.", where: "«Команда JoyRest» → «Инструкции»" },
    p.canExportClients(actor) && { text: "Выгрузка клиентов для рассылки (только согласившихся) и всех." },
    p.canSetMarketingConsent(actor) && { text: "Отметить согласие клиента на рассылку." },
    p.canErasePersonalData(actor) && { text: "«Данные по номеру»: всё о человеке в базе и удаление навсегда.", where: "«Клиенты» → «Данные по номеру»" },
  ]);

  add("База площадок", [
    p.canManageVenues(actor) && { text: "Площадки, анкеты заведений, заявки клиентов и подбор, предложение клиенту без контактов заведений.", where: "меню → «База площадок»" },
    p.canArchiveVenues(actor) && { text: "Убрать площадку, анкету или заявку в архив и вернуть." },
  ]);

  add("Игры", [
    p.canCreateSession(actor) && { text: "Проводить игры: запуск, пульт, экран зала, гости по QR, музыка и звуки, слайды.", where: "«Студия» → игра → «▶ Запустить игру»" },
    p.canCreateGame(actor, "personal", uid) && { text: "Создавать и править свои игры в конструкторе: картинки, импорт списком, предпросмотр.", where: "«Студия» → «Мои игры»" },
    p.canUseGames(actor) && { text: "Смотреть библиотеку JoyRest и репетировать игры.", where: "«Студия» → «Библиотека JoyRest»" },
    p.canCopyToPersonal(actor, AGENCY) && { text: "Копировать игру библиотеки себе и править копию." },
    p.canProposeGame(actor, own) && { text: "Предложить свою игру в библиотеку JoyRest (принимает владелец).", where: "игра → «⋯ → Предложить в библиотеку»" },
    p.canEditGame(actor, AGENCY) && { text: "Создавать и править игры библиотеки JoyRest — их видят все ведущие." },
    p.canDeleteGame(actor, AGENCY) && { text: "Удалять игры библиотеки." },
    p.canReviewProposals(actor) && { text: "Принимать и отклонять игры, предложенные ведущими." },
    p.canCreateSession(actor) && { text: "Показы: фото и PDF на весь экран зала; оформление под заказчика.", where: "пульт → «Слайды» → «Фото и PDF»" },
    p.canTakeEventPhotos(actor, { hostId: uid }) && { text: "Фотоотчёт своей игры (до 3 фото) и отзывы гостей о своих мероприятиях.", where: "меню → «Фотоотчёты», «Отзывы»" },
    p.canModerateReviews(actor) && { text: "Все отзывы: показать на сайте, скрыть, удалить." },
  ]);

  add("Музыка и видео", [
    p.canUploadTrack(actor, "personal") && { text: "Загружать свою музыку (и прямо в конструкторе игры), отрезок, громкость, папки.", where: "«Студия» → «Музыка»" },
    !p.canUploadTrack(actor, "personal") && p.canUseTracks(actor) && { text: "Слушать общую музыку JoyRest.", where: "«Студия» → «Музыка»" },
    p.canShareTrack(actor, { scope: "personal", ownerId: uid }) && { text: "Предложить трек или папку в общую музыку (принимает владелец)." },
    p.canReviewTracks(actor) && { text: "Принимать треки в общую музыку и загружать сразу в общую." },
    p.canUploadVideo(actor) && { text: "Загружать видео JoyRest (видят все ведущие), папки; убирать — своё видео.", where: "«Студия» → «Видео»" },
    !p.canUploadVideo(actor) && p.canUseVideos(actor) && { text: "Ставить видео JoyRest в свои игры.", where: "«Студия» → «Видео»" },
  ]);

  add("Команда и сервис", [
    p.canSeeAllSessions(actor) && { text: "«Игры сейчас» всех ведущих; завершить брошенную игру.", where: "«Студия», первый экран" },
    p.canManageHosts(actor) && { text: "Добавлять и отключать людей, профессии, роли доступа, квалификация, баллы, временные пароли.", where: "«Команда JoyRest» → «Управление» или «⋯» на карточке" },
    p.canCleanupSessions(actor) && { text: "Автоочистка старых игр (30 дней), итоги сохраняются." },
  ]);

  const cannot: string[] = [];
  if (!admin) {
    if (!p.canCreateSession(actor)) cannot.push("Проводить игры для гостей.");
    if (!p.canUseGames(actor)) cannot.push("Видеть игры и библиотеку JoyRest.");
    if (p.canUseGames(actor) && !p.canEditGame(actor, AGENCY)) cannot.push("Править игры библиотеки JoyRest и чужие игры.");
    if (!p.canManageClients(actor)) cannot.push("Видеть базу клиентов.");
    if (p.canManageClients(actor) && !p.canExportClients(actor)) cannot.push("Выгружать клиентов, удалять их данные, ставить согласие на рассылку.");
    if (!p.canManageEvents(actor)) cannot.push("Записывать мероприятия другим людям.");
    if (p.canManageEvents(actor) && !p.canDeleteEvent(actor)) cannot.push("Удалять мероприятия навсегда и смотреть «Итоги».");
    if (!p.canUploadVideo(actor)) cannot.push("Загружать видео JoyRest.");
    if (!p.canManageHosts(actor)) cannot.push("Добавлять и отключать людей, давать роли, менять баллы и пароли — это только владелец.");
  }

  const guides: { title: string; to: string }[] = [];
  if (p.canReadSalesGuide(actor)) guides.push({ title: "Инструкция менеджера", to: "/studio/sales-guide" });
  if (p.canUseGames(actor)) guides.push({ title: "Как создавать игры", to: "/studio/editor-guide" });
  if (p.canUseGames(actor)) guides.push({ title: "Как проводить игры", to: "/studio/guide" });

  const summary = admin
    ? "Всё в платформе: игры, люди, клиенты, площадки, сервер."
    : roleInfo
      ? `${who} с ролью «${roleInfo.title}». ${roleInfo.can}`
      : p.hostsGames(actor)
        ? "Проводит игры на мероприятиях JoyRest: свои игры, библиотека, музыка, пульт и экран зала."
        : "Член команды JoyRest: свой профиль, команда, календарь и мероприятия, на которые вас поставили. Своего раздела в студии пока нет — он появится.";

  return { who, role: admin ? null : accessRoleTitle(role), summary, can: groups, cannot, guides };
}
