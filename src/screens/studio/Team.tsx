import { useSearchParams } from "react-router-dom";
import { permissions, teamRepo, useLoad, type TeamMember, type UserProfile } from "../../data";
import { Tabs } from "../../components/Tabs";
import { PROFESSIONS, professionOf } from "../../core/professions";
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

type TeamTab = "team" | "pros" | "manage";

function TeamPage({ profile, manage }: { profile: UserProfile; manage: boolean }) {
  const [params, setParams] = useSearchParams();
  const canManage = permissions.canManageHosts(profile);
  // Firebase-версия без «Команды»: у владельца сразу управление.
  const raw = params.get("tab");
  const tab: TeamTab = canManage && (raw === "manage" || (raw !== "team" && raw !== "pros" && manage) || !teamRepo) ? "manage" : raw === "pros" ? "pros" : "team";
  const actions = [{ label: "В студию", to: "/studio" }, ...studioActions(profile)];
  return (
    <main className={tab === "manage" ? "page" : "page page--wide"}>
      <TopBar title="Команда JoyRest" actions={actions} />
      {teamRepo && (
        <Tabs
          idPrefix="team"
          label="Команда и управление"
          value={tab}
          scroll
          onChange={(next) => setParams({ tab: next }, { replace: true })}
          items={[
            { id: "team", label: "Ведущие" },
            { id: "pros", label: "Профессии JoyRest" },
            ...(canManage ? [{ id: "manage" as const, label: "Управление" }] : []),
          ]}
        />
      )}
      <div id={`team-panel-${tab}`} role={teamRepo ? "tabpanel" : undefined} className="stack">
        {tab === "manage" ? <HostsManager profile={profile} /> : <TeamList pros={tab === "pros"} />}
      </div>
    </main>
  );
}

function TeamList({ pros }: { pros: boolean }) {
  const [state, retry] = useLoad(() => (teamRepo ? teamRepo.list() : Promise.resolve(NONE)), []);
  if (!teamRepo) return <p className="muted">Команда доступна на своём сервере JoyRest.</p>;
  if (state.status === "loading") return <ListSkeleton />;
  if (state.status === "error") return <LoadFailedInline onRetry={retry} />;
  const isHost = (m: TeamMember) => m.owner || professionOf(m.profession) === "host";
  // Профессии — по группам: сначала диджеи, потом музыканты и т.д. (порядок списка профессий).
  const order = (m: TeamMember) => PROFESSIONS.findIndex((p) => p.id === professionOf(m.profession));
  const members = state.data.filter((m) => (pros ? !isHost(m) : isHost(m))).sort((a, b) => (pros ? order(a) - order(b) : 0));
  return (
    <>
      <p className="muted">
        {pros ? "Диджеи, музыканты, фокусники, повара и другие профессии JoyRest." : "Ведущие JoyRest. Свою карточку можно изменить в «Моём профиле»."}
      </p>
      {pros && members.length === 0 && <p className="muted">Пока никого — владелец добавит их в «Управлении».</p>}
      <ul className="team-grid">
        {members.map((member) => (
          <li key={member.uid}>
            <TeamCard member={member} />
          </li>
        ))}
      </ul>
    </>
  );
}
