import { Link, useSearchParams } from "react-router-dom";
import { experienceLabel, levelTitle } from "../../core/levels";
import { authService, permissions, teamRepo, tracksRepo, venuesRepo, type AuthUser, type UserProfile } from "../../data";
import { HostGate } from "../../components/HostGate";
import { StudioSkeleton } from "../../components/Skeleton";
import { Tabs, type TabItem } from "../../components/Tabs";
import { Toast, useToast } from "../../components/Toast";
import { TopBar, type TopBarAction } from "../../components/TopBar";
import { GameList } from "./GameList";
import { History } from "./History";
import { ActiveGames, LiveOverview } from "./ActiveGames";
import { professionTitle } from "../../core/professions";
import { SwipePages } from "../../components/SwipePages";
import { MusicTab } from "./MusicTab";

type TabId = "agency" | "mine" | "music" | "history";

const TABS: Array<TabItem<TabId>> = [
  { id: "agency", label: "Библиотека JoyRest" },
  { id: "mine", label: "Мои игры" },
  // Музыка — только на своём сервере.
  ...(tracksRepo ? [{ id: "music" as const, label: "Музыка" }] : []),
  { id: "history", label: "История игр" },
];

function parseTab(value: string | null): TabId {
  if (value === "music" && tracksRepo) return "music";
  return value === "agency" || value === "history" ? value : "mine";
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
    // Владелец: «Команда JoyRest» со второй вкладкой «Управление ведущими»; без «Команды» (Firebase) — сразу управление.
    ...(permissions.canManageHosts(profile) && !teamRepo ? [{ label: "Ведущие", to: "/admin" }] : []),
    // База площадок — только свой сервер: QR-анкеты у всех ведущих, база — у владельца и тех, кому он открыл.
    ...(venuesRepo && permissions.canManageVenues(profile) ? [{ label: "База площадок", to: "/venues" }] : []),
    ...(venuesRepo && permissions.canShowVenueQr(profile) ? [{ label: "QR-анкеты", to: "/studio/qr" }] : []),
    ...(teamRepo
      ? [
          { label: "Команда JoyRest", to: "/studio/team" },
          { label: "Мой профиль", to: "/studio/profile" },
        ]
      : []),
    { label: "Пароль", to: "/studio/password" },
    { label: "Выйти", onClick: () => void authService.signOut() },
  ];
}

function StudioContent({ user, profile }: { user: AuthUser; profile: UserProfile }) {
  const [params, setParams] = useSearchParams();
  const tab = parseTab(params.get("tab"));
  const [toast, showToast] = useToast();

  if (!permissions.hostsGames(profile)) {
    // Диджеи, музыканты, фокусники и другие профессии: игр нет, своя страница (пока простая).
    return (
      <main className="page">
        <TopBar title="Моя страница" actions={studioActions(profile)} />
        <section className="card stack">
          <p className="eyebrow">{professionTitle(profile.profession)} · JoyRest</p>
          <h2>Здравствуйте, {profile.name}!</h2>
          <p className="muted">Здесь скоро появятся ваши мероприятия и задачи от агентства. Пока заполните свою карточку — её видит вся команда.</p>
          <div className="actions">
            <Link className="btn btn--block" to="/studio/profile">
              Мой профиль
            </Link>
            <Link className="btn btn--secondary btn--block" to="/studio/team?tab=pros">
              Команда JoyRest
            </Link>
          </div>
        </section>
        <Toast text={toast} />
      </main>
    );
  }

  // Владелец листает два экрана: «Игры сейчас» (все ведущие) и саму студию.
  const body = (
    <div className="stack">
      <ActiveGames hostId={profile.uid} />
      <Tabs
        items={TABS}
        value={tab}
        onChange={(next) => setParams(next === "mine" ? {} : { tab: next }, { replace: true })}
        label="Разделы студии"
        idPrefix="studio"
        scroll
      />
      <div className="stack" role="tabpanel" id={`studio-panel-${tab}`} aria-labelledby={`studio-tab-${tab}`}>
        {tab === "agency" && <GameList key="agency" scope="agency" profile={profile} onToast={showToast} />}
        {tab === "mine" && <GameList key="mine" scope="personal" profile={profile} onToast={showToast} />}
        {tab === "music" && <MusicTab profile={profile} onToast={showToast} />}
        {tab === "history" && <History profile={profile} onToast={showToast} />}
      </div>
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

      {permissions.isAdmin(profile) ? (
        <SwipePages
          storageKey="studio-page"
          pages={[
            { id: "live", label: "Игры сейчас", node: <LiveOverview adminId={profile.uid} /> },
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
