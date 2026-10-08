import { useSearchParams } from "react-router-dom";
import { permissions, teamRepo, useLoad, type TeamMember, type UserProfile } from "../../data";
import { Tabs } from "../../components/Tabs";
import { HostsManager } from "../Admin";
import { HostGate } from "../../components/HostGate";
import { ListSkeleton, StudioSkeleton } from "../../components/Skeleton";
import { LoadFailedInline } from "../../components/Status";
import { TeamCard } from "../../components/team/TeamCard";
import { TopBar } from "../../components/TopBar";
import { studioActions } from "./Studio";

const NONE: TeamMember[] = [];

/**
 * «Команда JoyRest» (CLAUDE.md, раздел 3): вкладка «Команда» — карточки всех ведущих; у владельца
 * вторая вкладка «Управление ведущими» (добавить, отключить, баллы). `/admin` открывает её сразу.
 */
export function Team({ manage = false }: { manage?: boolean }) {
  return (
    <HostGate skeleton={<StudioSkeleton />}>
      {(_user, profile) => <TeamPage profile={profile} manage={manage} />}
    </HostGate>
  );
}

type TeamTab = "team" | "manage";

function TeamPage({ profile, manage }: { profile: UserProfile; manage: boolean }) {
  const [params, setParams] = useSearchParams();
  const canManage = permissions.canManageHosts(profile);
  // Firebase-версия без «Команды»: у владельца сразу управление.
  const raw = params.get("tab");
  const tab: TeamTab = canManage && (raw === "manage" || (raw !== "team" && manage) || !teamRepo) ? "manage" : "team";
  const actions = [{ label: "В студию", to: "/studio" }, ...studioActions(profile)];
  return (
    <main className={tab === "manage" ? "page" : "page page--wide"}>
      <TopBar title="Команда JoyRest" actions={actions} />
      {canManage && teamRepo && (
        <Tabs
          idPrefix="team"
          label="Команда и управление"
          value={tab}
          onChange={(next) => setParams({ tab: next }, { replace: true })}
          items={[
            { id: "team", label: "Команда" },
            { id: "manage", label: "Управление ведущими" },
          ]}
        />
      )}
      <div id={`team-panel-${tab}`} role={canManage && teamRepo ? "tabpanel" : undefined} className="stack">
        {tab === "manage" ? <HostsManager profile={profile} /> : <TeamList />}
      </div>
    </main>
  );
}

function TeamList() {
  const [state, retry] = useLoad(() => (teamRepo ? teamRepo.list() : Promise.resolve(NONE)), []);
  if (!teamRepo) return <p className="muted">Команда доступна на своём сервере JoyRest.</p>;
  if (state.status === "loading") return <ListSkeleton />;
  if (state.status === "error") return <LoadFailedInline onRetry={retry} />;
  return (
    <>
      <p className="muted">Ведущие JoyRest. Свою карточку можно изменить в «Моём профиле».</p>
      <ul className="team-grid">
        {state.data.map((member) => (
          <li key={member.uid}>
            <TeamCard member={member} />
          </li>
        ))}
      </ul>
    </>
  );
}
