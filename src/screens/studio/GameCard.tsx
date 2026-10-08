import { Link } from "react-router-dom";
import { formatDate } from "../../core/format";
import { permissions, type Game, type GameScope, type LibraryProposal, type UserProfile } from "../../data";
import { ActionMenu, type MenuAction } from "../../components/Menu";
import { mechanicTitle, stepsLabel, validateGame } from "../../mechanics/registry";
import { getTheme } from "../../themes/registry";

interface Props {
  game: Game;
  profile: UserProfile;
  onDuplicate: (target: GameScope) => void;
  onDelete: () => void;
  /** Последнее предложение этой игры в библиотеку (только свой сервер). */
  proposal?: LibraryProposal | null;
  /** Есть — можно предложить игру в библиотеку. */
  onPropose?: () => void;
}

const PROPOSAL_LABEL: Record<LibraryProposal["status"], string> = {
  pending: "На проверке у JoyRest",
  accepted: "В библиотеке JoyRest",
  rejected: "Не принята в библиотеку",
};

/** Карточка игры: название, механика, тема, число вопросов, дата и действия. */
export function GameCard({ game, profile, onDuplicate, onDelete, proposal, onPropose }: Props) {
  const editable = permissions.canEditGame(profile, game);
  const date = game.updatedAt ?? game.createdAt;
  const ready = validateGame(game.mechanic, game.content).length === 0;

  const menu: MenuAction[] = [{ label: editable ? "Открыть" : "Посмотреть", to: `/studio/games/${game.id}` }];
  if (ready) menu.push({ label: "Репетиция без гостей", to: `/studio/rehearsal/${game.id}` });
  if (game.scope === "agency" && permissions.canCreateGame(profile, "agency", profile.uid)) {
    menu.push({ label: "Дублировать в библиотеке", onClick: () => onDuplicate("agency") });
  }
  if (permissions.canCopyToPersonal(profile, game)) {
    menu.push({
      label: game.scope === "personal" ? "Дублировать" : "Скопировать в мои игры",
      onClick: () => onDuplicate("personal"),
    });
  }
  if (game.scope === "personal" && permissions.canCreateGame(profile, "agency", profile.uid)) {
    menu.push({ label: "Копия в библиотеку JoyRest", onClick: () => onDuplicate("agency") });
  }
  if (onPropose && permissions.canProposeGame(profile, game) && proposal?.status !== "pending") {
    menu.push({ label: proposal?.status === "accepted" ? "Предложить обновление в библиотеку" : "Предложить в библиотеку", onClick: onPropose });
  }
  if (permissions.canDeleteGame(profile, game)) menu.push({ label: "Удалить", onClick: onDelete });

  return (
    <article className="card game-card">
      <div className="game-card__head">
        <h3 className="game-card__title">
          <Link to={`/studio/games/${game.id}`}>{game.title || "Без названия"}</Link>
        </h3>
        <ActionMenu icon="dots" label={`Действия с игрой «${game.title}»`} actions={menu} />
      </div>
      <ul className="meta" aria-label="Об игре">
        <li>{mechanicTitle(game.mechanic)}</li>
        <li>{getTheme(game.themeId).title}</li>
        <li>{stepsLabel(game.mechanic, game.content)}</li>
        {game.ageRating !== "0+" && <li>{game.ageRating}</li>}
        {date !== null && <li>{formatDate(date)}</li>}
        {!ready && <li className="meta__warn">Не готова к запуску</li>}
        {proposal && <li className={proposal.status === "rejected" ? "meta__warn" : undefined}>{PROPOSAL_LABEL[proposal.status]}</li>}
      </ul>
      {proposal?.status === "rejected" && proposal.reason && <p className="muted small">Причина: {proposal.reason}</p>}
      <div className="actions">
        {permissions.canLaunchGame(profile, game) ? (
          <Link className="btn btn--block" to={`/studio/launch/${game.id}`}>
            Запустить
          </Link>
        ) : (
          ready && (
            <Link className="btn btn--block" to={`/studio/rehearsal/${game.id}`}>
              Репетиция без гостей
            </Link>
          )
        )}
        <Link className="btn btn--secondary btn--block" to={`/studio/games/${game.id}`}>
          {editable ? "Открыть" : "Посмотреть"}
        </Link>
      </div>
    </article>
  );
}
