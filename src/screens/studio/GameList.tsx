import { useState } from "react";
import { Link } from "react-router-dom";
import { copyOfGame } from "../../core/games";
import { gamesRepo, permissions, useLoad, type Game, type GameScope, type UserProfile } from "../../data";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ListSkeleton } from "../../components/Skeleton";
import { LoadFailedInline } from "../../components/Status";
import { GameCard } from "./GameCard";

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

  async function duplicate(game: Game, target: GameScope) {
    try {
      const draft = copyOfGame(game, target, profile.uid);
      const id = await gamesRepo.create(draft);
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

      {state.status === "loading" && <ListSkeleton />}
      {state.status === "error" && <LoadFailedInline onRetry={retry} />}
      {state.status === "ready" && state.data.length === 0 && <p className="muted empty">{intro.empty}</p>}
      {state.status === "ready" && state.data.length > 0 && (
        <ul className="cards" aria-label={intro.title}>
          {state.data.map((game) => (
            <li key={game.id}>
              <GameCard
                game={game}
                profile={profile}
                onDuplicate={(target) => void duplicate(game, target)}
                onDelete={() => {
                  setDeleteError(null);
                  setToDelete(game);
                }}
              />
            </li>
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
          Идущие сессии и история игр не пострадают.
        </p>
      </ConfirmDialog>
    </>
  );
}
