import { useEffect } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { experienceLabel, levelTitle } from "../../core/levels";
import { authService, calendarRepo, clientsRepo, permissions, sessionsRepo, teamRepo, tracksRepo, venuesRepo, videosRepo, finaleRepo, photosRepo, decksRepo, type AuthUser, type UserProfile } from "../../data";
import { HostGate } from "../../components/HostGate";
import { StudioSkeleton } from "../../components/Skeleton";
import { Tabs, type TabItem } from "../../components/Tabs";
import { Toast, useToast } from "../../components/Toast";
import { TopBar, type TopBarAction } from "../../components/TopBar";
import { GameList } from "./GameList";
import { History } from "./History";
import { ActiveGames, LiveOverview } from "./ActiveGames";
import { professionTitle } from "../../core/professions";
import { accessRoleTitle } from "../../core/accessRoles";
import { SwipePages } from "../../components/SwipePages";
import { MusicTab } from "./MusicTab";
import { VideoTab } from "./VideoTab";
import { SalesDesk } from "./SalesDesk";
import { HeldPrompt } from "./HeldPrompt";

type TabId = "agency" | "mine" | "music" | "video" | "history";

const TABS: Array<TabItem<TabId>> = [
  { id: "agency", label: "Библиотека JoyRest" },
  { id: "mine", label: "Мои игры" },
  // Музыка — только на своём сервере.
  ...(tracksRepo ? [{ id: "music" as const, label: "Музыка" }] : []),
  // Видео JoyRest — только на своём сервере (решение владельца 15 октября 2026).
  ...(videosRepo ? [{ id: "video" as const, label: "Видео" }] : []),
  { id: "history", label: "История игр" },
];

function parseTab(value: string | null): TabId {
  if (value === "music" && tracksRepo) return "music";
  if (value === "video" && videosRepo) return "video";
  return value === "agency" || value === "history" ? value : "mine";
}

/**
 * Вкладки по правам: ведущий — все; роли без профессии ведущего — только своё (создатель игр —
 * библиотека, свои игры и музыка; тестировщик — библиотека и музыка; музыкальный редактор — музыка).
 */
function tabsFor(profile: UserProfile): Array<TabItem<TabId>> {
  return TABS.filter((t) => {
    if (t.id === "music") return permissions.canUseTracks(profile);
    if (t.id === "video") return permissions.canUseVideos(profile);
    if (t.id === "agency") return permissions.canUseGames(profile);
    if (t.id === "mine") return permissions.canCreateGame(profile, "personal", profile.uid);
    return permissions.hostsGames(profile);
  });
}

export function Studio() {
  return (
    <HostGate skeleton={<StudioSkeleton />}>
      {(user, profile) => <StudioContent user={user} profile={profile} />}
    </HostGate>
  );
}

/** Общие пункты шапки студии и её подэкранов. */
export function studioActions(profile: UserProfile): TopBarAction[] {
  return [
    // «Команда JoyRest» — первой кнопкой в шапке (решение владельца 15 октября 2026), «Как проводить игры» — в меню.
    ...(teamRepo ? [{ label: "Команда JoyRest", to: "/studio/team" }] : []),
    // Календарь — только свой сервер: владелец видит, кто может в дату мероприятия; остальные отмечают свободные дни.
    ...(calendarRepo && permissions.canEditOwnCalendar(profile)
      ? [{ label: permissions.canViewTeamCalendar(profile) ? "Календарь и мероприятия" : "Мой календарь", to: "/studio/calendar" }]
      : []),
    // База клиентов — только свой сервер, владелец и менеджер по продажам: все, кто оставлял заявки.
    ...(clientsRepo && permissions.canManageClients(profile) ? [{ label: "Клиенты", to: "/studio/clients" }] : []),
    // Отзывы гостей — только свой сервер: ведущему о своих мероприятиях, владельцу — все.
    ...(finaleRepo && permissions.canReadReviews(profile, profile.uid) ? [{ label: "Отзывы", to: "/studio/reviews" }] : []),
    ...(photosRepo && permissions.canViewEventPhotos(profile, profile.uid) ? [{ label: "Фотоотчёты", to: "/studio/photos" }] : []),
    // Показы — фото и PDF на весь экран зала (только свой сервер, тем, кто проводит игры).
    ...(decksRepo && permissions.canCreateSession(profile) ? [{ label: "Показы", to: "/studio/decks" }] : []),
    ...(clientsRepo && permissions.canReadSalesGuide(profile) ? [{ label: "Инструкция менеджера", to: "/studio/sales-guide" }] : []),
    // Владелец: «Команда JoyRest» со второй вкладкой «Управление ведущими»; без «Команды» (Firebase) — сразу управление.
    ...(permissions.canManageHosts(profile) && !teamRepo ? [{ label: "Ведущие", to: "/admin" }] : []),
    // База площадок — только свой сервер: QR-анкеты у всех ведущих, база — у владельца и тех, кому он открыл.
    ...(venuesRepo && permissions.canManageVenues(profile) ? [{ label: "База площадок", to: "/venues" }] : []),
    ...(venuesRepo && permissions.canShowVenueQr(profile) ? [{ label: "QR-анкеты", to: "/studio/qr" }] : []),
    ...(teamRepo ? [{ label: "Мой профиль", to: "/studio/profile" }] : []),
    // Что я могу в платформе — по профессии и роли, со «Скачать PDF» (решение владельца 15 октября 2026).
    { label: "Мои возможности", to: "/studio/abilities" },
    { label: "Как проводить игры", to: "/studio/guide" },
    { label: "Пароль", to: "/studio/password" },
    { label: "Выйти", onClick: () => void authService.signOut() },
  ];
}

function StudioContent({ user, profile }: { user: AuthUser; profile: UserProfile }) {
  const [params, setParams] = useSearchParams();
  const tabs = tabsFor(profile);
  const wanted = parseTab(params.get("tab"));
  const tab: TabId = tabs.some((t) => t.id === wanted) ? wanted : (tabs[0]?.id ?? "mine");
  const [toast, showToast] = useToast();
  // Сообщение с прошлого экрана («Игра сохранена») — один раз.
  const location = useLocation();
  const navigate = useNavigate();
  const passed = (location.state as { toast?: unknown } | null)?.toast;
  useEffect(() => {
    if (typeof passed !== "string") return;
    showToast(passed);
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при новом сообщении
  }, [passed]);

  const gamesOpen = permissions.canUseGames(profile);
  const musicOpen = permissions.canUseTracks(profile) && Boolean(tracksRepo);
  const overviewOpen = permissions.canSeeAllSessions(profile) && Boolean(sessionsRepo.overview);
  if (!gamesOpen && !musicOpen && !overviewOpen) {
    // Диджеи, музыканты, фокусники и другие профессии: игр нет, своя страница (пока простая).
    return (
      <main className="page">
        <TopBar title="Моя страница" actions={studioActions(profile)} />
        <section className="card stack">
          <p className="eyebrow">{professionTitle(profile.profession)} · JoyRest</p>
          <h2>Здравствуйте, {profile.name}!</h2>
          <p className="muted">
            {permissions.isSalesManager(profile)
              ? "Ниже — ваше рабочее место: новые анкеты, клиенты, свободные ведущие и мероприятия. Заполните и свою карточку — её видит вся команда."
              : "Здесь скоро появятся ваши мероприятия и задачи от агентства. Пока заполните свою карточку — её видит вся команда."}
          </p>
          <div className="actions">
            <Link className="btn btn--block" to="/studio/profile">
              Мой профиль
            </Link>
            <Link className="btn btn--secondary btn--block" to="/studio/team?tab=pros">
              Команда JoyRest
            </Link>
          </div>
        </section>
        {clientsRepo && permissions.isSalesManager(profile) && <SalesDesk />}
        {permissions.isSalesManager(profile) && <HeldPrompt owner onToast={showToast} />}
        <Toast text={toast} />
      </main>
    );
  }

  // Владелец листает два экрана: «Игры сейчас» (все ведущие) и саму студию.
  const body = (
    <div className="stack">
      {permissions.hostsGames(profile) && <ActiveGames hostId={profile.uid} />}
      {(permissions.hostsGames(profile) || permissions.isSalesManager(profile)) && (
        <HeldPrompt owner={permissions.isAdmin(profile) || permissions.isSalesManager(profile)} onToast={showToast} />
      )}
      {clientsRepo && permissions.isSalesManager(profile) && <SalesDesk />}
      {!permissions.hostsGames(profile) && (
        <p className="muted small">Роль: {accessRoleTitle(profile.accessRole) ?? professionTitle(profile.profession)}. Проводить игры для гостей могут только ведущие.</p>
      )}
      {tabs.length > 0 && <Tabs
        items={tabs}
        value={tab}
        onChange={(next) => setParams(next === "mine" ? {} : { tab: next }, { replace: true })}
        label="Разделы студии"
        idPrefix="studio"
        scroll
      />}
      {tabs.length > 0 && <div className="stack" role="tabpanel" id={`studio-panel-${tab}`} aria-labelledby={`studio-tab-${tab}`}>
        {tab === "agency" && <GameList key="agency" scope="agency" profile={profile} onToast={showToast} />}
        {tab === "mine" && <GameList key="mine" scope="personal" profile={profile} onToast={showToast} />}
        {tab === "music" && <MusicTab profile={profile} onToast={showToast} />}
        {tab === "video" && <VideoTab profile={profile} onToast={showToast} />}
        {tab === "history" && <History profile={profile} onToast={showToast} />}
      </div>}
    </div>
  );

  return (
    <main className="page">
      <TopBar title="Студия" actions={studioActions(profile)} />
      <p className="muted small line-clamp">
        {profile.name} · {user.email}
      </p>
      {profile.role !== "admin" && (profile.level || profile.experienceSince) && (
        <p className="small line-clamp">
          {levelTitle(profile.level) ?? "Квалификация пока не задана"}
          {profile.experienceSince ? ` · стаж ${experienceLabel(profile.experienceSince, Date.now())}` : ""}
        </p>
      )}

      {overviewOpen && tabs.length === 0 ? (
        <LiveOverview adminId={profile.uid} owner={permissions.isAdmin(profile)} />
      ) : overviewOpen ? (
        <SwipePages
          storageKey="studio-page"
          // Ссылка на вкладку студии (?tab=…, «В студию» из отзывов, музыки, видео) — сразу экран «Студия».
          start={params.get("tab") ? "studio" : undefined}
          pages={[
            { id: "live", label: "Игры сейчас", node: <LiveOverview adminId={profile.uid} owner={permissions.isAdmin(profile)} /> },
            { id: "studio", label: "Студия", node: body },
          ]}
        />
      ) : (
        body
      )}

      <Toast text={toast} />
    </main>
  );
}
