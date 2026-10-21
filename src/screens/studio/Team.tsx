import { useSearchParams } from "react-router-dom";
import { permissions, staffRepo, teamRepo, useLoad, usersRepo, type HostAccount, type TeamMember, type UserProfile } from "../../data";
import { Tabs } from "../../components/Tabs";
import { PROFESSIONS, professionOf } from "../../core/professions";
import { HostsManager, useHostAdmin } from "../Admin";
import { ActionMenu } from "../../components/Menu";
import { accessRoleTitle } from "../../core/accessRoles";
import { levelTitle } from "../../core/levels";
import { pointsLabel } from "../../core/points";
import { HostGate } from "../../components/HostGate";
import { ListSkeleton, StudioSkeleton } from "../../components/Skeleton";
import { LoadFailedInline } from "../../components/Status";
import { TeamCard } from "../../components/team/TeamCard";
import { TopBar } from "../../components/TopBar";
import { studioActions } from "./Studio";
import { StaffGuides } from "./StaffGuides";

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

type TeamTab = "team" | "pros" | "guides" | "manage";

function TeamPage({ profile, manage }: { profile: UserProfile; manage: boolean }) {
  const [params, setParams] = useSearchParams();
  const canManage = permissions.canManageHosts(profile);
  // Firebase-версия без «Команды»: у владельца сразу управление.
  const raw = params.get("tab");
  const tab: TeamTab = canManage && (raw === "manage" || (raw !== "team" && raw !== "pros" && raw !== "guides" && manage) || !teamRepo) ? "manage" : raw === "pros" ? "pros" : raw === "guides" ? "guides" : "team";
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
            { id: "guides", label: "Инструкции" },
            ...(canManage ? [{ id: "manage" as const, label: "Управление" }] : []),
          ]}
        />
      )}
      <div id={`team-panel-${tab}`} role={teamRepo ? "tabpanel" : undefined} className="stack">
        {tab === "manage" ? <HostsManager profile={profile} /> : tab === "guides" ? <StaffGuides profile={profile} /> : <TeamList pros={tab === "pros"} profile={profile} canManage={canManage} />}
      </div>
    </main>
  );
}

const NO_HOSTS: HostAccount[] = [];

function TeamList({ pros, profile, canManage }: { pros: boolean; profile: UserProfile; canManage: boolean }) {
  const [state, retry] = useLoad(() => (teamRepo ? teamRepo.list() : Promise.resolve(NONE)), []);
  // Владельцу — те же действия, что в «Управлении», прямо на карточках (решение владельца 15 октября 2026).
  const [accounts, , updateAccounts] = useLoad(() => (canManage ? usersRepo.listHosts() : Promise.resolve(NO_HOSTS)), [canManage]);
  const admin = useHostAdmin(profile, updateAccounts);
  const byUid = new Map((accounts.status === "ready" ? accounts.data : NO_HOSTS).map((h) => [h.uid, h]));
  const adminOf = (uid: string) => {
    const host = canManage ? byUid.get(uid) : undefined;
    if (!host || host.role === "admin") return undefined;
    const actions = admin.actionsFor(host, true);
    if (actions.length === 0) return undefined;
    return (
      <>
        <ul className="meta" aria-label={`Статус: ${host.name}`}>
          <li className={host.active ? undefined : "error"}>{host.active ? "активен" : "отключён"}</li>
          {accessRoleTitle(host.accessRole) && <li>Роль: {accessRoleTitle(host.accessRole)}</li>}
          {staffRepo && professionOf(host.profession) === "host" && <li>{levelTitle(host.level) ?? "Без квалификации"}</li>}
          {staffRepo && professionOf(host.profession) === "host" && <li>{pointsLabel(host.points ?? 0)}</li>}
        </ul>
        <ActionMenu icon="dots" label={`Действия: ${host.name}`} actions={actions} />
      </>
    );
  };
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
            <TeamCard member={member} admin={adminOf(member.uid)} />
          </li>
        ))}
      </ul>
      {canManage && admin.created && (
        <p className="card" role="status">
          Новый временный пароль для {admin.created.account.name}: <b className="cal-feed-url">{admin.created.temporaryPassword}</b> — покажется один раз, передайте лично.
        </p>
      )}
      {canManage && (
        <p className="muted small">Добавить человека — во вкладке «Управление».</p>
      )}
      {admin.elements}
    </>
  );
}
