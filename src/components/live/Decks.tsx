/**
 * Показы ведущего на пульте (решение владельца 15 октября 2026, `src/core/decks.ts`): фото и страницы PDF на весь экран
 * зала. «Слайды» → «Фото и PDF»: загрузить с телефона, коснуться страницы — она на экране; ‹ › листают (и из плашки
 * «На экране» сверху пульта на любой вкладке). Подготовить заранее, переименовать, убрать страницы — студия → «Показы».
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DECK_LIMITS, DECK_RELOAD_MS, deckReloadKey, shouldReloadDecks, titleFromFile } from "../../core/decks";
import { imageSlide } from "../../core/slides";
import { decksRepo, type Deck, type DeckPage, type SessionChange, type SlideState } from "../../data";
import { Fold } from "../Fold";
import { DISK_FULL_TEXT, isServerDiskFull } from "../Status";
import { ImageError } from "../media/compressImage";
import { prepareDeckFiles } from "../media/deckFiles";
import { slideId } from "./SlidesPanel";

// Список показов — один на страницу пульта: панель «Слайды» и плашка сверху берут его отсюда.
let cache: Promise<Deck[]> | null = null;
const listeners = new Set<(decks: Deck[]) => void>();

function loadDecks(force = false): Promise<Deck[]> {
  if (!decksRepo) return Promise.resolve([]);
  if (!cache || force) {
    cache = decksRepo.list().catch((e: unknown) => {
      cache = null;
      throw e;
    });
  }
  return cache;
}

function publish(decks: Deck[]) {
  cache = Promise.resolve(decks);
  for (const l of listeners) l(decks);
}

// Перечитывание списка — одно на страницу пульта: плашка сверху и панель «Слайды» видят один и тот же пропавший показ,
// а запрос уходит один (повторная проверка QA 22 октября 2026). Сбой сети — повтор через `DECK_RELOAD_MS`, пока показ
// кому-то нужен.
let lastReload = 0;
let reloadTimer: number | null = null;
let reloadBusy = false;
const reloadWanted = new Set<symbol>();
// Страницы (`deckReloadKey`), для которых список перечитали, а их в нём нет: больше не перечитываем, пока на экране
// не сменится показ или страница (показ удалили — не крутим запрос раз в 10 с до конца вечера).
const reloadTried = new Set<string>();

function scheduleDeckReload(delay: number): void {
  if (reloadTimer !== null || reloadBusy || reloadWanted.size === 0) return;
  reloadTimer = window.setTimeout(() => {
    reloadTimer = null;
    if (reloadWanted.size === 0) return;
    reloadBusy = true;
    lastReload = Date.now();
    loadDecks(true).then(
      (decks) => {
        reloadBusy = false;
        // Все, кто ждал перечитывания, получили ответ: если их страницы в списке нет — второй раз не просим.
        for (const token of reloadWanted) if (token.description) reloadTried.add(token.description);
        publish(decks);
      },
      () => {
        reloadBusy = false;
        scheduleDeckReload(DECK_RELOAD_MS);
      },
    );
  }, delay);
}

/**
 * На экране показ, которого нет в списке (загрузили с другого пульта, QA 22 октября 2026, M9) — перечитываем список,
 * но не чаще раза в `DECK_RELOAD_MS`: чужой показ (владелец ведёт игру ведущего) в списке так и не появится.
 */
function useMissingDeckReload(decks: Deck[] | null, media: SlideState["media"]): void {
  const missing = shouldReloadDecks(decks, media, reloadTried);
  const key = media ? deckReloadKey(media) : "";
  useEffect(() => {
    if (!missing) return;
    const token = Symbol(key);
    reloadWanted.add(token);
    scheduleDeckReload(Math.max(0, lastReload + DECK_RELOAD_MS - Date.now()));
    return () => {
      reloadWanted.delete(token);
      if (reloadWanted.size === 0 && reloadTimer !== null) {
        window.clearTimeout(reloadTimer);
        reloadTimer = null;
      }
    };
  }, [missing, key]);
}

export function useDecks(): { decks: Deck[] | null; failed: boolean; reload: () => void; set: (decks: Deck[]) => void } {
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    listeners.add(setDecks);
    setFailed(false);
    loadDecks(attempt > 0)
      .then((d) => alive && setDecks(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      listeners.delete(setDecks);
    };
  }, [attempt]);
  return { decks, failed, reload: () => setAttempt((n) => n + 1), set: publish };
}

const newDeckId = () => `dk${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * Загрузить фото и PDF в показ (новый — `deck` null): страницы готовит телефон и отправляет по одной; показ сохраняется
 * каждые несколько страниц, так что оборванная загрузка не теряет уже отправленное.
 */
export async function uploadToDeck(
  files: File[],
  deck: Deck | null,
  onProgress: (text: string) => void,
): Promise<Deck> {
  if (!decksRepo) throw new Error("unavailable");
  const repo = decksRepo;
  let current: Omit<Deck, "updatedAt"> = deck ?? { id: newDeckId(), title: titleFromFile(files[0]?.name ?? "Показ"), pages: [] };
  const room = DECK_LIMITS.pages - current.pages.length;
  if (room <= 0) throw new ImageError(`В показе уже ${DECK_LIMITS.pages} страниц — начните новый показ.`);
  let saved: Deck | null = null;
  let pending = 0;
  await prepareDeckFiles(files, room, async (page, label) => {
    onProgress(`Загружаем: ${label}`);
    const uploaded: DeckPage = await repo.uploadPage(page.blob, page.w, page.h);
    current = { ...current, pages: [...current.pages, uploaded] };
    pending += 1;
    if (pending >= 5) {
      saved = await repo.save(current);
      pending = 0;
    }
  });
  if (current.pages.length === (deck?.pages.length ?? 0)) throw new ImageError("В файлах не нашлось страниц.");
  saved = await repo.save(current);
  return saved;
}

export function uploadErrorText(e: unknown): string {
  if (e instanceof ImageError) return e.message;
  const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "";
  if (isServerDiskFull(e)) return DISK_FULL_TEXT;
  if (code === "resource-exhausted") return "Места под показы не хватает: уберите старые показы в студии («Показы») и попробуйте снова.";
  return "Не получилось загрузить. Проверьте интернет и попробуйте ещё раз — уже загруженные страницы сохранятся.";
}

/** Плашка сверху пульта для страницы показа: ‹ › листают, где бы ни был ведущий. */
export function DeckStepper({ slide, onApply }: { slide: SlideState; onApply: (change: SessionChange) => Promise<void> }) {
  const { decks } = useDecks();
  const media = slide.media;
  useMissingDeckReload(decks, media);
  if (!media) return null;
  const deck = decks?.find((d) => d.id === media.deck) ?? null;
  const go = (page: number) => {
    const next = deck ? imageSlide(slideId(), deck, page) : null;
    if (next) void onApply({ state: { slide: next } }).catch(() => undefined);
  };
  return (
    <div className="deck-stepper" role="group" aria-label="Листать показ">
      <button type="button" className="btn btn--secondary" disabled={!deck || media.page === 0} onClick={() => go(media.page - 1)} aria-label="Предыдущая страница">
        ‹
      </button>
      <span className="deck-stepper__count">
        {media.page + 1} / {media.count}
      </span>
      <button type="button" className="btn btn--secondary" disabled={!deck || media.page + 1 >= media.count} onClick={() => go(media.page + 1)} aria-label="Следующая страница">
        ›
      </button>
    </div>
  );
}

/** «Фото и PDF» на вкладке «Слайды»: свои показы, загрузить с телефона, коснуться страницы — на экран. */
export function DeckPanel({ current, onApply }: { current: SlideState | null; onApply: (change: SessionChange) => Promise<void> }) {
  const { decks, failed, reload, set } = useDecks();
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Только что загруженный показ — раскрыт: следующую страницу сразу видно.
  const [fresh, setFresh] = useState<string | null>(null);
  useMissingDeckReload(decks, current?.kind === "image" ? current.media : null);
  if (!decksRepo) return null;
  const repo = decksRepo;
  const shownDeck = current?.kind === "image" ? current.media?.deck : null;

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    try {
      const deck = await uploadToDeck([...files], null, setProgress);
      setFresh(deck.id);
      set([deck, ...(decks ?? []).filter((d) => d.id !== deck.id)]);
      const first = imageSlide(slideId(), deck, 0);
      if (first) await onApply({ state: { slide: first } });
    } catch (e) {
      setError(uploadErrorText(e));
      reload();
    } finally {
      setProgress(null);
    }
  }

  return (
    <section className="stack stack--tight" aria-labelledby="deck-panel">
      <h3 id="deck-panel">Фото и PDF на весь экран</h3>
      <p className="muted small">Меню, программа вечера, фото пары, презентация заказчика. Коснитесь страницы — она на экране; листайте ‹ › сверху пульта.</p>
      <label className={`btn btn--secondary btn--block${progress ? " is-busy" : ""}`}>
        {progress ?? "+ Фото или PDF с телефона"}
        <input
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="visually-hidden"
          disabled={progress !== null}
          onChange={(e) => {
            void upload(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      {failed && (
        <button type="button" className="btn btn--quiet" onClick={reload}>
          Показы не загрузились — повторить
        </button>
      )}
      {decks?.map((deck) => (
        <Fold key={deck.id} title={deck.title} value={`${deck.pages.length} стр.`} open={deck.id === shownDeck || deck.id === fresh}>
          <div className="deck-grid">
            {deck.pages.map((page, i) => {
              const on = current?.kind === "image" && current.media?.deck === deck.id && current.media.page === i;
              return (
                <button
                  key={`${page.sha}-${i}`}
                  type="button"
                  className={on ? "deck-thumb is-on" : "deck-thumb"}
                  aria-pressed={on}
                  aria-label={`Показать страницу ${i + 1}`}
                  onClick={() => {
                    const slide = imageSlide(slideId(), deck, i);
                    if (slide) void onApply({ state: { slide } }).catch(() => setError("Не отправилось. Проверьте интернет."));
                  }}
                >
                  <img src={repo.pageUrl(page.sha)} alt="" loading="lazy" decoding="async" />
                  <span className="deck-thumb__n">{i + 1}</span>
                </button>
              );
            })}
          </div>
        </Fold>
      ))}
      {decks && decks.length > 0 && (
        <Link className="btn btn--quiet" to="/studio/decks">
          Переименовать, убрать страницы — студия → «Показы»
        </Link>
      )}
    </section>
  );
}
