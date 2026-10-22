import { useState } from "react";
import { Link } from "react-router-dom";
import { copyOfGame, HOST_GAMES_FOLDER } from "../../core/games";
import { gameFoldersRepo, gamesRepo, permissions, proposalsRepo, useLoad, type Game, type GameScope, type LibraryProposal, type UserProfile } from "../../data";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Fold } from "../../components/Fold";
import { ListSkeleton } from "../../components/Skeleton";
import { Tabs } from "../../components/Tabs";
import { LoadFailedInline, NOT_YET_TEXT } from "../../components/Status";
import { demoGames, gameMediaIds } from "../../mechanics/registry";
import { groupByCategory, popularGames, type CategoryId } from "../../mechanics/categories";
import { DEFAULT_THEME_ID } from "../../themes/registry";
import { GameCard } from "./GameCard";
import { ProposalsBlock } from "./Proposals";

const NO_PROPOSALS: LibraryProposal[] = [];
const NO_FOLDERS: string[] = [];

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

  // Папки «Моих игр» (решение владельца 15 октября 2026, только свой сервер).
  const foldersOn = scope === "personal" && gameFoldersRepo !== null;
  const [folderList, retryFolders] = useLoad(() => (foldersOn && gameFoldersRepo ? gameFoldersRepo.list() : Promise.resolve(NO_FOLDERS)), [foldersOn, profile.uid]);
  const [moveFor, setMoveFor] = useState<Game | null>(null);
  const [folderDraft, setFolderDraft] = useState("");
  const [folderDialog, setFolderDialog] = useState<{ kind: "create" } | { kind: "rename"; from: string } | { kind: "delete"; name: string; count: number } | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const games = state.status === "ready" ? state.data : [];
  const folderNamesAll = foldersOn
    ? [...new Set([...(folderList.status === "ready" ? folderList.data : []), ...games.map((g) => (g.folder ?? "").trim()).filter(Boolean)])].sort((a, b) => a.localeCompare(b, "ru"))
    : [];
  // Библиотека: принятые игры ведущих — своей папкой внизу, не по разделам форматов (решение владельца 22 октября 2026).
  const hostGames = scope === "agency" ? games.filter((g) => g.folder === HOST_GAMES_FOLDER) : [];
  const loose = foldersOn ? games.filter((g) => !(g.folder ?? "").trim()) : scope === "agency" ? games.filter((g) => g.folder !== HOST_GAMES_FOLDER) : games;
  const [hostOpen, setHostOpen] = useState(false);

  // Владельцу на вкладке библиотеки — две странички: игры и предложения ведущих.
  const reviewing = scope === "agency" && proposalsRepo !== null && permissions.canReviewProposals(profile);
  const [page, setPage] = useState<"games" | "proposals">("games");
  const [pending, retryPending, updatePending] = useLoad(
    () => (reviewing && proposalsRepo ? proposalsRepo.listPending() : Promise.resolve(NO_PROPOSALS)),
    [reviewing],
  );
  const pendingCount = pending.status === "ready" ? pending.data.length : 0;

  async function moveLibraryGame(game: Game) {
    const folder = game.folder === HOST_GAMES_FOLDER ? "" : HOST_GAMES_FOLDER;
    try {
      await gamesRepo.update(game.id, { folder });
      update((list) => list.map((g) => (g.id === game.id ? { ...g, folder } : g)));
      onToast(folder ? `«${game.title}» — в папке «${HOST_GAMES_FOLDER}»` : `«${game.title}» — в общих разделах библиотеки`);
    } catch {
      onToast("Не удалось перенести. Проверьте интернет.");
    }
  }

  async function saveMove() {
    if (!moveFor) return;
    setFolderBusy(true);
    setFolderError(null);
    try {
      const folder = folderDraft.trim();
      await gamesRepo.update(moveFor.id, { folder });
      const id = moveFor.id;
      update((list) => list.map((g) => (g.id === id ? { ...g, folder } : g)));
      setMoveFor(null);
      onToast(folder ? `Игра в папке «${folder}»` : "Игра без папки");
    } catch {
      setFolderError("Не удалось сохранить. Проверьте интернет.");
    } finally {
      setFolderBusy(false);
    }
  }

  async function runFolderDialog() {
    if (!gameFoldersRepo || !folderDialog) return;
    const name = folderDraft.trim();
    if (folderDialog.kind !== "delete" && !name) return setFolderError("Напишите название папки.");
    setFolderBusy(true);
    setFolderError(null);
    try {
      if (folderDialog.kind === "create") await gameFoldersRepo.create(name);
      if (folderDialog.kind === "rename") await gameFoldersRepo.rename(folderDialog.from, name);
      if (folderDialog.kind === "delete") await gameFoldersRepo.remove(folderDialog.name);
      setFolderDialog(null);
      retry();
      retryFolders();
      onToast(folderDialog.kind === "create" ? `Папка «${name}» создана` : folderDialog.kind === "rename" ? `Папка теперь «${name}»` : "Папка удалена, игры остались");
    } catch {
      setFolderError("Не удалось сохранить. Проверьте интернет.");
    } finally {
      setFolderBusy(false);
    }
  }

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
  // Игры из готовых шаблонов (по названию), которые уже в библиотеке: их можно обновить до свежей версии.
  const templateGames =
    scope === "agency" && canCreate && state.status === "ready" ? state.data.filter((g) => demoGames.some((d) => d.title === g.title && d.mechanic === g.mechanic)) : [];
  const [refreshOpen, setRefreshOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  /** «Обновить готовые игры»: шаблоны в библиотеке получают свежее содержимое из кода, недостающие добавляются. */
  async function refreshTemplates() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      for (const game of templateGames) {
        const demo = demoGames.find((d) => d.title === game.title && d.mechanic === game.mechanic);
        if (!demo) continue;
        await gamesRepo.update(game.id, {
          content: demo.content,
          themeId: demo.themeId ?? DEFAULT_THEME_ID,
          ageRating: demo.ageRating ?? "0+",
          playMode: demo.playMode ?? "solo",
        });
      }
      for (const demo of missingDemos) await addDemo(demo, true);
      setRefreshOpen(false);
      retry();
      onToast("Готовые игры обновлены");
    } catch {
      setRefreshError("Не всё обновилось. Проверьте интернет и нажмите ещё раз — уже обновлённые игры не пострадают.");
    } finally {
      setRefreshing(false);
    }
  }
  const [demosOpen, setDemosOpen] = useState(false);
  const [open, setOpen] = useState<CategoryId | null>(() => readOpen(scope));
  function toggle(id: CategoryId) {
    const next = open === id ? null : id;
    setOpen(next);
    saveOpen(scope, next);
  }

  async function addDemo(demo: (typeof demoGames)[number], quiet = false) {
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
      if (!quiet) onToast("Игра добавлена в библиотеку");
    } catch (e) {
      if (quiet) throw e;
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
      onLibraryFolder={reviewing ? () => void moveLibraryGame(game) : undefined}
      onFolder={
        foldersOn
          ? () => {
              setFolderDraft(game.folder ?? "");
              setFolderError(null);
              setMoveFor(game);
            }
          : undefined
      }
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

      {reviewing && (
        <Tabs
          idPrefix="library"
          label="Библиотека JoyRest"
          value={page}
          onChange={(id) => {
            setPage(id);
            if (id === "proposals") retryPending();
          }}
          items={[
            { id: "games", label: "Игры" },
            { id: "proposals", label: pendingCount > 0 ? `Предложения ведущих · ${pendingCount}` : "Предложения ведущих" },
          ]}
        />
      )}

      {reviewing && page === "proposals" && (
        <div id="library-panel-proposals" role="tabpanel">
          {pending.status === "loading" && <ListSkeleton />}
          {pending.status === "error" && <LoadFailedInline onRetry={retryPending} />}
          {pending.status === "ready" && (
            <ProposalsBlock
              proposals={pending.data}
              onRemoved={(id) => updatePending((list) => list.filter((p) => p.id !== id))}
              onAccepted={retry}
              onOpenFolder={() => {
                setPage("games");
                setHostOpen(true);
                window.setTimeout(() => document.getElementById("host-games")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
              }}
              onToast={onToast}
            />
          )}
        </div>
      )}

      {(!reviewing || page === "games") && (
        <div id="library-panel-games" role={reviewing ? "tabpanel" : undefined} className="stack">

      {templateGames.length > 0 && (
        <section className="card stack stack--tight">
          <p className="muted small">
            Готовые игры в библиотеке: {templateGames.length}. Когда шаблоны улучшаются (новые вопросы, раунды, задания), обновите их одним касанием.
          </p>
          <button type="button" className="btn btn--secondary btn--block" disabled={refreshing} onClick={() => setRefreshOpen(true)}>
            Обновить готовые игры до свежих шаблонов
          </button>
        </section>
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
      {foldersOn && state.status === "ready" && (
        <section className="card stack stack--tight" aria-label="Папки">
          <button
            type="button"
            className="btn btn--secondary btn--block"
            onClick={() => {
              setFolderDraft("");
              setFolderError(null);
              setFolderDialog({ kind: "create" });
            }}
          >
            + Новая папка
          </button>
          {folderNamesAll.map((name) => {
            const inside = games.filter((g) => (g.folder ?? "").trim() === name);
            return (
              <Fold key={name} title={`📁 ${name}`} value={`${inside.length}`}>
                {inside.length === 0 ? (
                  <p className="muted small">Пустая папка. Положите игру: у игры «⋯ → В папку».</p>
                ) : (
                  <ul className="cards">
                    {inside.map((game) => (
                      <li key={game.id}>{card(game)}</li>
                    ))}
                  </ul>
                )}
                <div className="actions">
                  <button
                    type="button"
                    className="btn btn--quiet btn--block"
                    onClick={() => {
                      setFolderDraft(name);
                      setFolderError(null);
                      setFolderDialog({ kind: "rename", from: name });
                    }}
                  >
                    Переименовать папку
                  </button>
                  <button
                    type="button"
                    className="btn btn--quiet btn--block"
                    onClick={() => {
                      setFolderError(null);
                      setFolderDialog({ kind: "delete", name, count: inside.length });
                    }}
                  >
                    Удалить папку
                  </button>
                </div>
              </Fold>
            );
          })}
        </section>
      )}
      {state.status === "ready" && scope === "agency" && popularGames(loose).length > 0 && (
        <section className="card popular" aria-labelledby={`popular-${scope}`}>
          <h2 id={`popular-${scope}`} className="popular__title">
            <span aria-hidden="true">⭐</span> Популярные
          </h2>
          <p className="muted small">Самые востребованные игры JoyRest — они же есть в своих разделах ниже.</p>
          <ul className="cards">
            {popularGames(loose).map((game) => (
              <li key={game.id}>{card(game)}</li>
            ))}
          </ul>
        </section>
      )}
      {state.status === "ready" && loose.length > 0 && (scope === "agency" || loose.length >= GROUP_FROM) && (
        <div className="categories" aria-label={`${intro.title}: разделы`}>
          {groupByCategory(loose).map(({ category, games }) => {
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
      {state.status === "ready" && loose.length > 0 && scope !== "agency" && loose.length < GROUP_FROM && (
        <ul className="cards" aria-label={intro.title}>
          {loose.map((game) => (
            <li key={game.id}>{card(game)}</li>
          ))}
        </ul>
      )}
      {state.status === "ready" && scope === "agency" && (hostGames.length > 0 || reviewing) && (
        <section id="host-games" className={hostOpen ? "card category category--hosts is-open" : "card category category--hosts"}>
          <button type="button" className="category-row" aria-expanded={hostOpen} aria-controls="cat-host-games" onClick={() => setHostOpen((v) => !v)}>
            <span className="category-row__icon" aria-hidden="true">
              👥
            </span>
            <span className="category-row__text">
              <span className="category-row__title">{HOST_GAMES_FOLDER}</span>
              <span className="category-row__hint">Игры, которые придумали ведущие и предложили в библиотеку</span>
            </span>
            <span className="category-row__count" aria-label={`игр: ${hostGames.length}`}>
              {hostGames.length}
            </span>
            <span className="category-row__chevron" aria-hidden="true" />
          </button>
          {hostOpen &&
            (hostGames.length === 0 ? (
              <p className="muted small" id="cat-host-games">
                Пока пусто. Примите предложение ведущего на страничке «Предложения ведущих» — игра появится здесь.
              </p>
            ) : (
              <ul className="cards category__games" id="cat-host-games">
                {hostGames.map((game) => (
                  <li key={game.id}>{card(game)}</li>
                ))}
              </ul>
            ))}
        </section>
      )}
        </div>
      )}

      <ConfirmDialog
        open={refreshOpen}
        title="Обновить готовые игры?"
        confirmLabel="Обновить"
        busy={refreshing}
        error={refreshError}
        onConfirm={() => void refreshTemplates()}
        onCancel={() => setRefreshOpen(false)}
      >
        <p>
          {templateGames.length} игр из шаблонов получат свежие вопросы и настройки
          {missingDemos.length > 0 ? `, ещё ${missingDemos.length} новых шаблонов добавятся в библиотеку` : ""}. Ваши правки в этих играх библиотеки
          заменятся шаблоном. Копии у ведущих («Мои игры») и уже идущие игры не изменятся.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={moveFor !== null}
        title="В какую папку?"
        confirmLabel="Положить"
        busy={folderBusy}
        error={folderError}
        onConfirm={() => void saveMove()}
        onCancel={() => setMoveFor(null)}
      >
        <div className="stack stack--tight">
          <div className="pick-chips">
            {folderNamesAll.map((name) => (
              <button key={name} type="button" className="pick-chip" aria-pressed={folderDraft.trim() === name} onClick={() => setFolderDraft(name)}>
                📁 {name}
              </button>
            ))}
            <button type="button" className="pick-chip" aria-pressed={folderDraft.trim() === ""} onClick={() => setFolderDraft("")}>
              Без папки
            </button>
          </div>
          <label className="field">
            Или новая папка
            <input maxLength={40} placeholder="Например: Свадьбы, Корпоративы, Дети" value={folderDraft} onChange={(e) => setFolderDraft(e.target.value)} />
          </label>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={folderDialog !== null}
        title={folderDialog?.kind === "create" ? "Новая папка" : folderDialog?.kind === "rename" ? "Переименовать папку" : "Удалить папку?"}
        confirmLabel={folderDialog?.kind === "create" ? "Создать" : folderDialog?.kind === "rename" ? "Сохранить" : "Удалить папку"}
        busy={folderBusy}
        error={folderError}
        onConfirm={() => void runFolderDialog()}
        onCancel={() => setFolderDialog(null)}
      >
        {folderDialog?.kind === "delete" ? (
          <p>
            Папка «{folderDialog.name}» пропадёт.{" "}
            {folderDialog.count > 0 ? `Игры из неё (${folderDialog.count}) не удалятся — останутся без папки.` : "Она пустая."}
          </p>
        ) : (
          <label className="field">
            Название папки
            <input maxLength={40} placeholder="Например: Свадьбы, Корпоративы, Дети" value={folderDraft} onChange={(e) => setFolderDraft(e.target.value)} />
          </label>
        )}
      </ConfirmDialog>

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
