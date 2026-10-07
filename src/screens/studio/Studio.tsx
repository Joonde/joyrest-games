import { useSearchParams } from "react-router-dom";
import { experienceLabel, levelTitle } from "../../core/levels";
import { authService, permissions, type AuthUser, type UserProfile } from "../../data";
import { HostGate } from "../../components/HostGate";
import { StudioSkeleton } from "../../components/Skeleton";
import { Tabs, type TabItem } from "../../components/Tabs";
import { Toast, useToast } from "../../components/Toast";
import { TopBar, type TopBarAction } from "../../components/TopBar";
import { GameList } from "./GameList";
import { History } from "./History";

type TabId = "agency" | "mine" | "history";

const TABS: Array<TabItem<TabId>> = [
  { id: "agency", label: "Библиотека JoyRest" },
  { id: "mine", label: "Мои игры" },
  { id: "history", label: "История игр" },
];

function parseTab(value: string | null): TabId {
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
    ...(permissions.canManageHosts(profile) ? [{ label: "Ведущие", to: "/admin" }] : []),
    { label: "Пароль", to: "/studio/password" },
    { label: "Выйти", onClick: () => void authService.signOut() },
  ];
}

function StudioContent({ user, profile }: { user: AuthUser; profile: UserProfile }) {
  const [params, setParams] = useSearchParams();
  const tab = parseTab(params.get("tab"));
  const [toast, showToast] = useToast();

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

      <Tabs
        items={TABS}
        value={tab}
        onChange={(next) => setParams(next === "mine" ? {} : { tab: next }, { replace: true })}
        label="Разделы студии"
        idPrefix="studio"
      />

      <div className="stack" role="tabpanel" id={`studio-panel-${tab}`} aria-labelledby={`studio-tab-${tab}`}>
        {tab === "agency" && <GameList key="agency" scope="agency" profile={profile} onToast={showToast} />}
        {tab === "mine" && <GameList key="mine" scope="personal" profile={profile} onToast={showToast} />}
        {tab === "history" && <History profile={profile} onToast={showToast} />}
      </div>

      <Toast text={toast} />
    </main>
  );
}
