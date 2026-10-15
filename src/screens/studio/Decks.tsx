/**
 * «Показы» (решение владельца 15 октября 2026, `src/core/decks.ts`): фото и PDF ведущего, которые на мероприятии
 * выводятся на весь экран зала с пульта («Слайды» → «Фото и PDF»). Здесь — подготовить заранее: загрузить, переименовать,
 * переставить и убрать страницы, удалить показ (всё необратимое — с подтверждением).
 */
import { useState } from "react";
import { useConfirm } from "../../components/ConfirmDialog";
import { HostGate } from "../../components/HostGate";
import { uploadErrorText, uploadToDeck, useDecks } from "../../components/live/Decks";
import { ListSkeleton, StudioSkeleton } from "../../components/Skeleton";
import { LoadFailedInline } from "../../components/Status";
import { Toast, useToast } from "../../components/Toast";
import { TopBar } from "../../components/TopBar";
import { cleanDeckTitle, DECK_LIMITS } from "../../core/decks";
import { decksRepo, type Deck } from "../../data";
import { studioActions } from "./Studio";

export function Decks() {
  return (
    <HostGate skeleton={<StudioSkeleton />}>
      {(_user, profile) => (
        <main className="page">
          <TopBar title="Показы" actions={[{ label: "В студию", to: "/studio" }, ...studioActions(profile)]} />
          {decksRepo ? <DeckList /> : <p className="muted">Показы доступны на своём сервере JoyRest.</p>}
        </main>
      )}
    </HostGate>
  );
}

function DeckList() {
  const { decks, failed, reload, set } = useDecks();
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, showToast] = useToast();
  const [confirm, ask] = useConfirm();
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  if (!decksRepo) return null;
  const repo = decksRepo;
  if (failed) return <LoadFailedInline onRetry={reload} />;
  if (!decks) return <ListSkeleton />;
  const list = decks;

  const replace = (deck: Deck) => set([deck, ...list.filter((d) => d.id !== deck.id)]);

  async function upload(files: FileList | null, deck: Deck | null) {
    if (!files || files.length === 0) return;
    setError(null);
    try {
      const saved = await uploadToDeck([...files], deck, setProgress);
      replace(saved);
      showToast(deck ? `Страницы добавлены: ${saved.pages.length - deck.pages.length}` : `Показ «${saved.title}» готов`);
    } catch (e) {
      setError(uploadErrorText(e));
      reload();
    } finally {
      setProgress(null);
    }
  }

  async function save(deck: Deck, patch: Partial<Pick<Deck, "title" | "pages">>) {
    try {
      replace(await repo.save({ id: deck.id, title: patch.title ?? deck.title, pages: patch.pages ?? deck.pages }));
    } catch {
      showToast("Не сохранилось. Проверьте интернет.");
    }
  }

  function move(deck: Deck, i: number, dir: -1 | 1) {
    const pages = [...deck.pages];
    const j = i + dir;
    if (j < 0 || j >= pages.length) return;
    [pages[i], pages[j]] = [pages[j] as (typeof pages)[number], pages[i] as (typeof pages)[number]];
    void save(deck, { pages });
  }

  function removePage(deck: Deck, i: number) {
    ask({
      title: `Убрать страницу ${i + 1}?`,
      text: deck.pages.length === 1 ? "Это последняя страница — показ останется пустым." : "Остальные страницы останутся по порядку.",
      confirmLabel: "Убрать страницу",
      run: async () => {
        const saved = await repo.save({ id: deck.id, title: deck.title, pages: deck.pages.filter((_, n) => n !== i) });
        replace(saved);
      },
    });
  }

  function removeDeck(deck: Deck) {
    ask({
      title: `Удалить показ «${deck.title}»?`,
      text: "Все его страницы пропадут. Если он сейчас на экране зала, страница останется до «Убрать».",
      confirmLabel: "Удалить показ",
      run: async () => {
        await repo.remove(deck.id);
        set(list.filter((d) => d.id !== deck.id));
        showToast(`Показ «${deck.title}» удалён`);
      },
    });
  }

  return (
    <div className="stack">
      <p className="muted">
        Меню, программа вечера, фото пары, презентация заказчика — на весь экран зала. На мероприятии: пульт → «Слайды» → «Фото и PDF», коснитесь страницы,
        листайте ‹ ›. PDF превращается в картинки прямо на телефоне. До {DECK_LIMITS.pages} страниц в показе.
      </p>
      <label className={`btn btn--block${progress ? " is-busy" : ""}`}>
        {progress ?? "+ Новый показ: фото или PDF"}
        <input
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="visually-hidden"
          disabled={progress !== null}
          onChange={(e) => {
            void upload(e.target.files, null);
            e.target.value = "";
          }}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {list.length === 0 && <p className="muted">Показов пока нет.</p>}
      {list.map((deck) => (
        <section key={deck.id} className="card stack stack--tight" aria-label={deck.title}>
          {renaming?.id === deck.id ? (
            <form
              className="stack stack--tight"
              onSubmit={(e) => {
                e.preventDefault();
                const title = cleanDeckTitle(renaming.title);
                if (title) void save(deck, { title });
                setRenaming(null);
              }}
            >
              <label className="field">
                Название показа
                <input value={renaming.title} maxLength={DECK_LIMITS.title} onChange={(e) => setRenaming({ id: deck.id, title: e.target.value })} />
              </label>
              <div className="actions">
                <button type="submit" className="btn btn--block">
                  Сохранить
                </button>
                <button type="button" className="btn btn--secondary btn--block" onClick={() => setRenaming(null)}>
                  Отмена
                </button>
              </div>
            </form>
          ) : (
            <h2>{deck.title}</h2>
          )}
          <ul className="meta">
            <li>{deck.pages.length} стр.</li>
          </ul>
          <ol className="deck-pages">
            {deck.pages.map((page, i) => (
              <li key={`${page.sha}-${i}`} className="deck-page">
                <a href={repo.pageUrl(page.sha)} target="_blank" rel="noopener noreferrer" aria-label={`Страница ${i + 1} целиком`}>
                  <img src={repo.pageUrl(page.sha)} alt={`Страница ${i + 1}`} loading="lazy" decoding="async" />
                </a>
                <div className="deck-page__actions">
                  <span className="deck-page__n">{i + 1}</span>
                  <button type="button" className="btn btn--quiet" disabled={i === 0} onClick={() => move(deck, i, -1)} aria-label={`Страницу ${i + 1} — раньше`}>
                    ↑
                  </button>
                  <button type="button" className="btn btn--quiet" disabled={i + 1 === deck.pages.length} onClick={() => move(deck, i, 1)} aria-label={`Страницу ${i + 1} — позже`}>
                    ↓
                  </button>
                  <button type="button" className="btn btn--quiet" onClick={() => removePage(deck, i)} aria-label={`Убрать страницу ${i + 1}`}>
                    Убрать
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <div className="actions">
            <label className="btn btn--secondary btn--block">
              {progress ?? "+ Добавить страницы"}
              <input
                type="file"
                accept="image/*,application/pdf"
                multiple
                className="visually-hidden"
                disabled={progress !== null || deck.pages.length >= DECK_LIMITS.pages}
                onChange={(e) => {
                  void upload(e.target.files, deck);
                  e.target.value = "";
                }}
              />
            </label>
            <button type="button" className="btn btn--quiet btn--block" onClick={() => setRenaming({ id: deck.id, title: deck.title })}>
              Переименовать
            </button>
            <button type="button" className="btn btn--quiet btn--block" onClick={() => removeDeck(deck)}>
              Удалить показ
            </button>
          </div>
        </section>
      ))}
      {confirm}
      <Toast text={toast} />
    </div>
  );
}
