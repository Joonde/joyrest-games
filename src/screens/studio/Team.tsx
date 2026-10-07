import { teamRepo, useLoad, type TeamMember } from "../../data";
import { HostGate } from "../../components/HostGate";
import { ListSkeleton, StudioSkeleton } from "../../components/Skeleton";
import { LoadFailedInline } from "../../components/Status";
import { TeamCard } from "../../components/team/TeamCard";
import { TopBar } from "../../components/TopBar";
import { studioActions } from "./Studio";

const NONE: TeamMember[] = [];

/** «Команда JoyRest»: карточки всех ведущих (CLAUDE.md, раздел 3). */
export function Team() {
  return (
    <HostGate skeleton={<StudioSkeleton />}>
      {(_user, profile) => (
        <main className="page page--wide">
          <TopBar title="Команда JoyRest" actions={[{ label: "В студию", to: "/studio" }, ...studioActions(profile)]} />
          <TeamList />
        </main>
      )}
    </HostGate>
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
