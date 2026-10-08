import { useState } from "react";
import { Link } from "react-router-dom";
import { copyOfGame } from "../../core/games";
import { gamesRepo, permissions, proposalsRepo, useLoad, type Game, type GameScope, type LibraryProposal, type UserProfile } from "../../data";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ListSkeleton } from "../../components/Skeleton";
import { LoadFailedInline, NOT_YET_TEXT } from "../../components/Status";
import { demoGames, gameMediaIds } from "../../mechanics/registry";
import { groupByCategory, type CategoryId } from "../../mechanics/categories";
import { DEFAULT_THEME_ID } from "../../themes/registry";
import { GameCard } from "./GameCard";
import { ProposalsBlock } from "./Proposals";

const NO_PROPOSALS: LibraryProposal[] = [];

/** Разделы показываем в библиотеке всегда, в «Моих играх» — когда игр много. */
const GROUP_FROM = 7;

function openKey(scope: GameScope): string {
  return `joyrest.library.open.${scope}`;
}

/** Открытый раздел запоминается на этом устройстве (удобство, не обязательно). */
function readOpen(scope: GameScope): CategoryId | null {
  try {
    return (localStorage.getItem(openKey(scope)) as CategoryId | null) ?? null;
  } catch {
    return null;
  }
}

function saveOpen(scope: GameScope, id: CategoryId | null): void {
  try {
    if (id) localStorage.setItem(openKey(scope), id);
    else localStorage.removeItem(openKey(scope));
  } catch {
    // Хранилище недоступно — просто не запоминаем.
  }
}

interface Props {
  scope: GameScope;
  profile: UserProfile;
  onToast: (text: string) => void;
}

const INTRO: Record<GameScope, { title: string; text: string; empty: string }> = {
  agency: {
    title: "Библиотека JoyRest",
    text: "Готовые игры агентства. Запускайте как есть или скопируйте в «Мои игры», чтобы изменить под себя.",
    empty: "В библиотеке пока нет игр.",
  },
  personal: {
    title: "Мои игры",
    text: "Ваши игры видите только вы. Изменения сохраняются автоматически.",
    empty: "Игр пока нет. Создайте свою или скопируйте из библиотеки JoyRest.",
  },
};

export function GameList({ scope, profile, onToast }: Props) {
  const [state, retry, update] = useLoad(
    () => (scope === "agency" ? gamesRepo.listAgency() : gamesRepo.listPersonal(profile.uid)),
    [scope, profile.uid],
  );
  const [toDelete, setToDelete] = useState<Game | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const intro = INTRO[scope];
  const canCreate = permissions.canCreateGame(profile, scope, profile.uid);

  // Предложения в библиотеку: ведущему — статусы своих игр, владельцу — блок на вкладке библиотеки.
  const proposing = proposalsRepo !== null && scope === "personal" && !permissions.canReviewProposals(profile);
  const [mine, , updateMine] = useLoad(
    () => (proposing && proposalsRepo ? proposalsRepo.listMine() : Promise.resolve(NO_PROPOSALS)),
    [proposing, profile.uid],
  );
  const latest = new Map<string, LibraryProposal>();
  if (mine.status === "ready") for (const p of mine.data) if (!latest.has(p.gameId)) latest.set(p.gameId, p);

  async function propose(game: Game) {
    if (!proposalsRepo) return;
    try {
      const proposal = await proposalsRepo.propose(game.id);
      updateMine((list) => [proposal, ...list.filter((p) => p.id !== proposal.id)]);
      onToast("Игра отправлена владельцу JoyRest на проверку");
    } catch {
      onToast("Не удалось отправить. Проверьте интернет.");
    }
  }

  async function duplicate(game: Game, target: GameScope) {
    try {
      const draft = copyOfGame(game, target, profile.uid);
      const id = await gamesRepo.copy(game.id, gameMediaIds(game.mechanic, game.content), draft);
      const copy: Game = { ...draft, id, createdAt: Date.now(), updatedAt: Date.now() };
      if (target === scope) update((games) => [copy, ...games]);
      onToast(target === "personal" && scope !== "personal" ? "Копия добавлена в «Мои игры»" : "Копия создана");
    } catch {
      onToast("Не удалось скопировать. Проверьте интернет.");
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await gamesRepo.remove(toDelete.id);
      const removedId = toDelete.id;
      update((games) => games.filter((g) => g.id !== removedId));
      setToDelete(null);
      onToast("Игра удалена");
    } catch {
      setDeleteError("Не удалось удалить. Проверьте интернет и попробуйте снова.");
    } finally {
      setDeleting(false);
    }
  }

  // Демо-игры, которых ещё нет в библиотеке (по названию).
  const missingDemos =
    scope === "agency" && canCreate && state.status === "ready"
      ? demoGames.filter((d) => !state.data.some((g) => g.title === d.title))
      : [];
  const [addingDemo, setAddingDemo] = useState(false);
  const [demosOpen, setDemosOpen] = useState(false);
  const [open, setOpen] = useState<CategoryId | null>(() => readOpen(scope));
  function toggle(id: CategoryId) {
    const next = open === id ? null : id;
    setOpen(next);
    saveOpen(scope, next);
  }

  async function addDemo(demo: (typeof demoGames)[number]) {
    setAddingDemo(true);
    try {
      const draft = {
        scope: "agency" as const,
        ownerId: profile.uid,
        title: demo.title,
        mechanic: demo.mechanic,
        themeId: demo.themeId ?? DEFAULT_THEME_ID,
        ageRating: demo.ageRating ?? ("0+" as const),
        playMode: demo.playMode ?? ("solo" as const),
        content: demo.content,
      };
      const id = await gamesRepo.create(draft);
      update((games) => [{ ...draft, id, createdAt: Date.now(), updatedAt: Date.now() }, ...games]);
      onToast("Игра добавлена в библиотеку");
    } catch {
      onToast("Не удалось добавить. Проверьте интернет.");
    } finally {
      setAddingDemo(false);
    }
  }

  const card = (game: Game) => (
    <GameCard
      game={game}
      profile={profile}
      onDuplicate={(target) => void duplicate(game, target)}
      onDelete={() => {
        setDeleteError(null);
        setToDelete(game);
      }}
      proposal={latest.get(game.id) ?? null}
      onPropose={proposing ? () => void propose(game) : undefined}
    />
  );

  return (
    <>
      <section className="card">
        <h2>{intro.title}</h2>
        <p className="muted">{intro.text}</p>
        {canCreate && (
          <div className="actions">
            <Link className="btn btn--block" to={scope === "agency" ? "/studio/new?scope=agency" : "/studio/new"}>
              Создать игру
            </Link>
          </div>
        )}
      </section>

      {scope === "agency" && proposalsRepo && permissions.canReviewProposals(profile) && (
        <ProposalsBlock onAccepted={retry} onToast={onToast} />
      )}

      {missingDemos.length > 0 && (
        <section className="card stack stack--tight">
          <button type="button" className="category-row" aria-expanded={demosOpen} onClick={() => setDemosOpen((v) => !v)}>
            <span className="category-row__icon" aria-hidden="true">
              📦
            </span>
            <span className="category-row__text">
              <span className="category-row__title">Готовые игры, которых нет в библиотеке</span>
              <span className="category-row__hint">Добавьте — увидят все ведущие</span>
            </span>
            <span className="category-row__count">{missingDemos.length}</span>
            <span className="category-row__chevron" aria-hidden="true" />
          </button>
          {demosOpen && (
            <ul className="demo-list">
              {missingDemos.map((demo) => (
                <li key={demo.title} className="demo-list__item">
                  <span className="stack stack--tight">
                    <strong>{demo.title}</strong>
                    <span className="muted small">{demo.hint}</span>
                  </span>
                  <button type="button" className="btn btn--secondary" disabled={addingDemo} onClick={() => void addDemo(demo)}>
                    {addingDemo ? "Добавляем…" : "Добавить"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {state.status === "loading" && <ListSkeleton />}
      {state.status === "error" && <LoadFailedInline onRetry={retry} text={state.notYet ? NOT_YET_TEXT : undefined} />}
      {state.status === "ready" && state.data.length === 0 && <p className="muted empty">{intro.empty}</p>}
      {state.status === "ready" && state.data.length > 0 && (scope === "agency" || state.data.length >= GROUP_FROM) && (
        <div className="categories" aria-label={`${intro.title}: разделы`}>
          {groupByCategory(state.data).map(({ category, games }) => {
            const expanded = open === category.id;
            return (
              <section key={category.id} className={expanded ? "card category is-open" : "card category"}>
                <button type="button" className="category-row" aria-expanded={expanded} aria-controls={`cat-${scope}-${category.id}`} onClick={() => toggle(category.id)}>
                  <span className="category-row__icon" aria-hidden="true">
                    {category.icon}
                  </span>
                  <span className="category-row__text">
                    <span className="category-row__title">{category.title}</span>
                    <span className="category-row__hint">{category.hint}</span>
                  </span>
                  <span className="category-row__count" aria-label={`игр: ${games.length}`}>
                    {games.length}
                  </span>
                  <span className="category-row__chevron" aria-hidden="true" />
                </button>
                {expanded && (
                  <ul className="cards category__games" id={`cat-${scope}-${category.id}`}>
                    {games.map((game) => (
                      <li key={game.id}>{card(game)}</li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
      {state.status === "ready" && state.data.length > 0 && scope !== "agency" && state.data.length < GROUP_FROM && (
        <ul className="cards" aria-label={intro.title}>
          {state.data.map((game) => (
            <li key={game.id}>{card(game)}</li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        title="Удалить игру?"
        confirmLabel="Удалить игру"
        busy={deleting}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setToDelete(null)}
      >
        <p>
          «{toDelete?.title}» пропадёт из {toDelete?.scope === "agency" ? "библиотеки JoyRest у всех ведущих" : "ваших игр"}.
          Вместе с игрой удалятся её картинки — в уже запущенных сессиях этой игры они пропадут. История игр не
          пострадает.
        </p>
      </ConfirmDialog>
    </>
  );
}
