import { useCallback, useEffect, useState } from "react";
import { mediaRepo, type MediaVariant } from "../../data";

/** Адреса картинок на всё время вкладки: одна и та же картинка не декодируется дважды. */
const urls = new Map<string, string>();

function key(gameId: string, mediaId: string, variant: MediaVariant): string {
  return `${gameId}/${mediaId}/${variant}`;
}

async function loadUrl(gameId: string, mediaId: string, variant: MediaVariant): Promise<string | null> {
  const k = key(gameId, mediaId, variant);
  const known = urls.get(k);
  if (known) return known;
  const blob = await mediaRepo.load(gameId, mediaId, variant);
  if (!blob) return null;
  const url = urls.get(k) ?? URL.createObjectURL(blob);
  urls.set(k, url);
  return url;
}

/** Заранее загружает картинки (экран зала — следующий вопрос). Ошибки не важны. */
export function preloadMedia(gameId: string | null, mediaIds: Array<string | null>, variant: MediaVariant): void {
  if (!gameId) return;
  for (const id of mediaIds) if (id) void loadUrl(gameId, id, variant).catch(() => undefined);
}

type MediaState = { status: "loading" } | { status: "ready"; url: string } | { status: "missing" } | { status: "error" };

export function useMediaUrl(gameId: string | null, mediaId: string | null, variant: MediaVariant): [MediaState, () => void] {
  const ready = gameId && mediaId ? urls.get(key(gameId, mediaId, variant)) : undefined;
  const [state, setState] = useState<MediaState>(ready ? { status: "ready", url: ready } : { status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!gameId || !mediaId) {
      setState({ status: "missing" });
      return;
    }
    let cancelled = false;
    const known = urls.get(key(gameId, mediaId, variant));
    setState(known ? { status: "ready", url: known } : { status: "loading" });
    if (known) return;
    loadUrl(gameId, mediaId, variant)
      .then((url) => {
        if (!cancelled) setState(url ? { status: "ready", url } : { status: "missing" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, mediaId, variant, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return [state, retry];
}

interface Props {
  gameId: string | null;
  mediaId: string;
  variant: MediaVariant;
  /** Описание для экранного диктора; пустая строка — картинка декоративная. */
  alt: string;
  className?: string;
}

/** Картинка игры по id: место под неё занято сразу, без прыжков разметки. */
export function MediaImage({ gameId, mediaId, variant, alt, className }: Props) {
  const [state, retry] = useMediaUrl(gameId, mediaId, variant);
  const classes = ["media", className].filter(Boolean).join(" ");

  if (state.status === "ready") return <img className={classes} src={state.url} alt={alt} decoding="async" />;
  if (state.status === "loading") return <span className={`${classes} media--placeholder skeleton`} aria-label="Загружаем картинку" />;
  return (
    <span className={`${classes} media--placeholder media--problem`} role="note">
      <span>{state.status === "missing" ? "Картинка не найдена" : "Не удалось загрузить картинку"}</span>
      {state.status === "error" && (
        <button type="button" className="btn btn--quiet" onClick={retry}>
          Повторить
        </button>
      )}
    </span>
  );
}
