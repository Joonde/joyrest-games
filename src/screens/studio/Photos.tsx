/**
 * «Фотоотчёты» (решение владельца 15 октября 2026): общие фото мероприятий, которые ведущие сделали с пульта (до 3 на
 * игру). Ведущий видит свои, владелец — все: для отчётности, Telegram-канала и сайта. Касание — фото целиком (сохранить —
 * долгим нажатием).
 */
import { HostGate } from "../../components/HostGate";
import { ListSkeleton, StudioSkeleton } from "../../components/Skeleton";
import { LoadFailedInline } from "../../components/Status";
import { TopBar } from "../../components/TopBar";
import { permissions, photosRepo, useLoad, type EventPhoto, type UserProfile } from "../../data";
import { studioActions } from "./Studio";

const dateLabel = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" }) : "");

export function Photos() {
  return (
    <HostGate skeleton={<StudioSkeleton />}>
      {(_user, profile) => (
        <main className="page">
          <TopBar title="Фотоотчёты" actions={[{ label: "В студию", to: "/studio" }, ...studioActions(profile)]} />
          {photosRepo ? <PhotoList profile={profile} /> : <p className="muted">Фотоотчёты доступны на своём сервере JoyRest.</p>}
        </main>
      )}
    </HostGate>
  );
}

function PhotoList({ profile }: { profile: UserProfile }) {
  const repo = photosRepo;
  const [state, retry] = useLoad(() => (repo ? repo.all() : Promise.resolve([] as EventPhoto[])), [repo]);
  if (state.status === "loading") return <ListSkeleton />;
  if (state.status === "error") return <LoadFailedInline onRetry={retry} />;
  const groups = new Map<string, EventPhoto[]>();
  for (const p of state.data) groups.set(p.sessionId, [...(groups.get(p.sessionId) ?? []), p]);
  const owner = permissions.isAdmin(profile);
  return (
    <div className="stack">
      <p className="muted">
        Общие фото с мероприятий — ведущий делает их на пульте («📷 Общее фото для фотоотчёта», до 3 на игру).
        {owner ? " Здесь — все мероприятия; для канала и сайта откройте фото и сохраните его." : " Здесь — ваши мероприятия."}
      </p>
      {groups.size === 0 && <p className="muted">Фото пока нет.</p>}
      {[...groups.values()].map((list) => {
        const first = list[0] as EventPhoto;
        return (
          <section key={first.sessionId} className="card stack stack--tight">
            <h2>{first.gameTitle || "Игра"}</h2>
            <ul className="meta" aria-label="О мероприятии">
              {first.playedAt && <li>{dateLabel(first.playedAt)}</li>}
              {owner && first.hostName && <li>Ведущий: {first.hostName}</li>}
              <li>{list.length} фото</li>
            </ul>
            <div className="photo-report">
              {list.map((p) => (
                <a key={p.slot} href={p.url} target="_blank" rel="noopener noreferrer" aria-label={`Фото ${p.slot} целиком`}>
                  <img src={p.url} alt={`Фото ${p.slot}: ${first.gameTitle}`} loading="lazy" />
                </a>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
