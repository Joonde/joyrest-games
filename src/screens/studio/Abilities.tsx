/**
 * «Мои возможности» (`/studio/abilities`, решение владельца 15 октября 2026): что человек может и чего не может в платформе —
 * по его профессии, роли и доступу (`src/core/abilities.ts`, те же проверки прав, что на сервере) — и «Скачать PDF»
 * (печать страницы: на iPhone — «Поделиться» → «Сохранить в Файлы»). Владелец открывает её для любого человека
 * (`?uid=`, из «⋯» на карточке): скачать и отправить сотруднику.
 */
import { Link, useSearchParams } from "react-router-dom";
import { abilitiesOf } from "../../core/abilities";
import { professionTitle } from "../../core/professions";
import { permissions, useLoad, usersRepo, type HostAccount, type UserProfile } from "../../data";
import { HostGate } from "../../components/HostGate";
import { ListSkeleton, StudioSkeleton } from "../../components/Skeleton";
import { LoadFailedInline } from "../../components/Status";
import { TopBar } from "../../components/TopBar";
import { studioActions } from "./Studio";

const NONE: HostAccount[] = [];

export function Abilities() {
  return (
    <HostGate skeleton={<StudioSkeleton />}>
      {(_user, profile) => (
        <main className="page abilities">
          <TopBar title="Возможности" actions={[{ label: "В студию", to: "/studio" }, ...studioActions(profile)]} />
          <AbilitiesFor profile={profile} />
        </main>
      )}
    </HostGate>
  );
}

function AbilitiesFor({ profile }: { profile: UserProfile }) {
  const [params] = useSearchParams();
  const asked = params.get("uid");
  const owner = permissions.canManageHosts(profile);
  const other = owner && asked && asked !== profile.uid ? asked : null;
  const [people, retry] = useLoad(() => (other ? usersRepo.listHosts() : Promise.resolve(NONE)), [other]);
  if (other && people.status === "loading") return <ListSkeleton />;
  if (other && people.status === "error") return <LoadFailedInline onRetry={retry} />;
  const target = other ? (people.status === "ready" ? people.data.find((h) => h.uid === other) : undefined) : undefined;
  if (other && !target) return <p className="muted">Человек не найден.</p>;
  const name = target ? target.name : profile.name;
  const actor: UserProfile = target ?? profile;
  const a = abilitiesOf(actor, permissions);
  const today = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" });

  return (
    <article className="stack abilities__sheet">
      <header className="stack stack--tight">
        <p className="eyebrow">JoyRest · возможности в платформе</p>
        <h1 className="abilities__name">{name || "Без имени"}</h1>
        <ul className="meta">
          <li>{a.who}</li>
          {a.role && <li>Роль: {a.role}</li>}
          {target && !target.active && <li className="error">доступ отключён</li>}
          <li>на {today}</li>
        </ul>
        <p>{a.summary}</p>
      </header>

      <div className="actions abilities__tools">
        <button type="button" className="btn btn--block" onClick={() => window.print()}>
          Скачать PDF
        </button>
        {!target && a.guides.map((g) => (
          <Link key={g.to} className="btn btn--secondary btn--block" to={g.to}>
            {g.title}
          </Link>
        ))}
      </div>
      <p className="muted small abilities__tools">
        На iPhone: «Скачать PDF» → «Поделиться» → «Сохранить в Файлы» или отправьте в мессенджер. Список собран из настоящих прав —
        поменяется профессия или роль, поменяется и он.
      </p>

      {a.can.length === 0 ? (
        <p className="muted">Доступ отключён: сейчас ничего не доступно. Включить может только владелец агентства.</p>
      ) : (
        a.can.map((g) => (
          <section key={g.title} className="card stack stack--tight abilities__group">
            <h2>{g.title}</h2>
            <ul className="abilities__list">
              {g.items.map((i) => (
                <li key={i.text}>
                  <span>{i.text}</span>
                  {i.where && <span className="muted small abilities__where">Где: {i.where}</span>}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {a.cannot.length > 0 && (
        <section className="card stack stack--tight abilities__group">
          <h2>Чего нельзя</h2>
          <ul className="abilities__list abilities__list--no">
            {a.cannot.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </section>
      )}
      <p className="muted small">
        {target ? `Профессия: ${professionTitle(target.profession ?? "host")}.` : ""} Нужен ещё доступ — напишите владельцу агентства: роль
        доступа даёт только он.
      </p>
    </article>
  );
}
