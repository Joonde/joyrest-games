import { formatDate } from "../../core/format";
import { teamRepo, type TeamMember } from "../../data";

/** Первые буквы имени — вместо аватарки, пока её нет. */
function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "J"
  );
}

/** Карточка ведущего: обложка, аватарка, имя, «о себе» (CLAUDE.md, раздел 3, «Команда JoyRest»). */
export function TeamCard({ member }: { member: TeamMember }) {
  const repo = teamRepo;
  return (
    <article className="team-card">
      <div className="team-card__cover">
        {member.cover && repo && <img src={repo.imageUrl(member.uid, "cover", member.cover)} alt="" loading="lazy" decoding="async" />}
      </div>
      <div className="team-card__body">
        <div className="team-card__avatar" aria-hidden={member.avatar ? undefined : true}>
          {member.avatar && repo ? (
            <img src={repo.imageUrl(member.uid, "avatar", member.avatar)} alt={`Фото: ${member.name}`} loading="lazy" decoding="async" />
          ) : (
            <span>{initials(member.name)}</span>
          )}
        </div>
        <h3 className="team-card__name">{member.name || "Ведущий"}</h3>
        <ul className="meta" aria-label="О ведущем">
          {member.owner && <li>Основатель JoyRest</li>}
          {member.since && <li>В JoyRest с {formatDate(member.since)}</li>}
        </ul>
        {member.bio ? <p className="team-card__bio">{member.bio}</p> : <p className="muted small">Пока ничего не рассказал о себе.</p>}
      </div>
    </article>
  );
}
