/**
 * Конец игры (решение владельца 15 октября 2026): после награждения — «Спасибо» с делами: чаевые ведущему, отзыв
 * о вечере, отзыв на Авито и Telegram-канал JoyRest. Экран зала показывает QR-коды (слайд «Спасибо»), телефон гостя — те же
 * дела кнопками, отзыв пишется прямо на телефоне. Чаевые (решение владельца 17 октября 2026) — всегда: ссылка ведущего из профиля,
 * нет — ссылка владельца, нет и её — общие чаевые JoyRest (`TIPS_URL`, сейчас пусто), и без своего сервера тоже. Ссылки «Авито · канал · сайт» (`FinaleLinks`) — везде, где гость видит конец игры (17 октября 2026).
 * Только свой сервер (`finaleRepo`); у Firebase — один QR канала, как раньше.
 */
import { useCallback, useEffect, useState } from "react";
import { errorCodeOf, finaleRepo, type Finale } from "../../data";
import { QrCode } from "../QrCode";

export const CHANNEL_URL = "https://t.me/JoyRest";
export const CHANNEL_TEXT = "Мы начали вести Telegram-канал — будем благодарны за подписку. Так вам будет легче найти нас, когда снова захотите праздник.";
export const AVITO_URL = "https://www.avito.ru/brands/ea177461b6df1ce218b27e955ac8a349";
export const AVITO_TEXT = "Отзывы на Авито помогают другим выбрать нас";
export const SITE_URL = "https://joy-rest.ru";
export const SITE_CALC_URL = "https://joy-rest.ru/calc/";
export const SITE_TEXT = "Посчитайте стоимость следующего праздника за минуту";

/** Общие чаевые JoyRest (решение владельца 17 октября 2026): показываются, когда у ведущего и владельца нет своей ссылки. */
/** Пусто — общих чаевых нет (17 октября 2026: прежний QR владелец убрал, новый пришлёт). */
export const TIPS_URL = "";
export const TIPS_TEXT =
  "Огромное спасибо, что играли с нами! Если вечер понравился и есть желание поддержать ведущего и команду JoyRest — можно оставить чаевые.";

export function reviewUrl(sessionId: string): string {
  return `${window.location.origin}/review/${sessionId}`;
}

/**
 * Ссылки конца игры для гостя: отзыв на Авито, канал, сайт. Кнопки столбиком во всю ширину. `avito={false}` — когда
 * кнопка Авито уже стоит рядом (отзыв отправлен — `ReviewForm` зовёт на Авито сам).
 */
export function FinaleLinks({ avito = true }: { avito?: boolean }) {
  return (
    <div className="stack stack--tight finale-links">
      {avito && (
        <>
          <p className="muted small">{AVITO_TEXT}</p>
          <a className="btn btn--secondary btn--block" href={AVITO_URL} target="_blank" rel="noopener noreferrer">
            ⭐ Оставить отзыв на Авито
          </a>
        </>
      )}
      <p className="muted small">{CHANNEL_TEXT}</p>
      <a className="btn btn--secondary btn--block" href={CHANNEL_URL} target="_blank" rel="noopener noreferrer">
        Подписаться на канал JoyRest
      </a>
      <p className="muted small">{SITE_TEXT}</p>
      <a className="btn btn--quiet btn--block" href={SITE_CALC_URL} target="_blank" rel="noopener noreferrer">
        Наш сайт — joy-rest.ru
      </a>
    </div>
  );
}

/** Состояние загрузки данных конца игры. */
export type FinaleStatus = "loading" | "ready" | "notFound" | "failed";

/**
 * Данные конца игры; null — ещё грузится, не нашлось или своего сервера нет. Третий элемент — состояние загрузки:
 * «не найдено» (игру уже убрали — архив) и «не получилось» (сеть, после повторов) с `retry`.
 */
export function useFinale(
  sessionId: string | null | undefined,
): [Finale | null, (f: Finale) => void, { status: FinaleStatus; retry: () => void }] {
  const [finale, setFinale] = useState<Finale | null>(null);
  const [status, setStatus] = useState<FinaleStatus>("loading");
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!finaleRepo || !sessionId) return;
    let alive = true;
    let timer = 0;
    setStatus("loading");
    const load = (attempt: number) => {
      finaleRepo
        ?.get(sessionId)
        .then((f) => {
          if (!alive) return;
          setFinale(f);
          setStatus("ready");
        })
        .catch((e: unknown) => {
          if (!alive) return;
          if (errorCodeOf(e) === "not-found") setStatus("notFound");
          else if (attempt < 5) timer = window.setTimeout(() => load(attempt + 1), 2000 * (attempt + 1));
          else setStatus("failed");
        });
    };
    load(0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [sessionId, round]);
  const retry = useCallback(() => setRound((n) => n + 1), []);
  return [finale, setFinale, { status, retry }];
}

/** Экран зала: QR-коды на слайде «Спасибо». */
export function FinaleQrs({ sessionId }: { sessionId: string | null | undefined }) {
  const [finale] = useFinale(sessionId);
  // Ждём ссылку для чаевых до 4 с, чтобы QR-коды не перестраивались на глазах у зала; нет ответа — без чаевых.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setWaited(true), 4000);
    return () => window.clearTimeout(timer);
  }, []);
  if (finaleRepo && sessionId && !finale && !waited) return <div className="finale-qrs" aria-busy="true" />;
  if (!finaleRepo || !sessionId) {
    return (
      <div className="finale-hall">
        <div className="finale-qrs">
          {TIPS_URL && <TipsQr url={TIPS_URL} />}
          <figure className="finale-qr">
            <QrCode value={CHANNEL_URL} label="QR-код канала JoyRest в Telegram" className="finale-qr__code" />
            <figcaption>
              <strong>Наш Telegram</strong>
              <span>Фото и новые игры — в канале</span>
            </figcaption>
          </figure>
        </div>
        <p className="finale-hall__line">joy-rest.ru · t.me/JoyRest</p>
      </div>
    );
  }
  return (
    <div className="finale-hall">
      <div className="finale-qrs">
        {(finale?.tipsUrl || TIPS_URL) && <TipsQr url={finale?.tipsUrl || TIPS_URL} />}
        <figure className="finale-qr">
          <QrCode value={reviewUrl(sessionId)} label="QR-код: оставить отзыв" className="finale-qr__code" />
          <figcaption>
            <strong>Оставьте отзыв</strong>
            <span>Пара слов о вечере — нам это очень важно</span>
          </figcaption>
        </figure>
        <figure className="finale-qr">
          <QrCode value={AVITO_URL} label="QR-код: отзыв на Авито" className="finale-qr__code" />
          <figcaption>
            <strong>Отзыв на Авито</strong>
            <span>Помогите другим найти нас</span>
          </figcaption>
        </figure>
        <figure className="finale-qr">
          <QrCode value={CHANNEL_URL} label="QR-код: Telegram-канал JoyRest" className="finale-qr__code" />
          <figcaption>
            <strong>Наш Telegram</strong>
            <span>Подпишитесь — так нас будет легче найти</span>
          </figcaption>
        </figure>
      </div>
      <p className="finale-hall__line">joy-rest.ru · t.me/JoyRest</p>
    </div>
  );
}

/** Чаевые на телефоне гостя: благодарность и кнопка. */
export function TipsButton({ url = TIPS_URL }: { url?: string }) {
  return (
    <div className="stack stack--tight finale-tips">
      <p className="small">{TIPS_TEXT}</p>
      <a className="btn btn--block" href={url} target="_blank" rel="noopener noreferrer">
        💛 Оставить чаевые
      </a>
    </div>
  );
}

/** Карточка чаевых на экране зала: всегда есть (своя ссылка ведущего, владельца или общие чаевые JoyRest). */
function TipsQr({ url }: { url: string }) {
  return (
    <figure className="finale-qr finale-qr--tips">
      <QrCode value={url} label="QR-код: чаевые" className="finale-qr__code" />
      <figcaption>
        <strong>Чаевые</strong>
        <span>Если вечер понравился — поддержите ведущего и команду JoyRest</span>
      </figcaption>
    </figure>
  );
}

/** Телефон гостя после игры: те же дела кнопками, отзыв — прямо здесь. */
export function FinalePhone({ sessionId }: { sessionId: string }) {
  const [finale, setFinale] = useFinale(sessionId);
  if (!finaleRepo) {
    if (!TIPS_URL) return null;
    return (
      <section className="card stack finale-phone">
        <TipsButton />
      </section>
    );
  }
  return (
    <section className="card stack finale-phone" aria-labelledby="finale-title">
      <h2 id="finale-title">Спасибо, что были с нами!</h2>
      {(finale?.tipsUrl || TIPS_URL) && <TipsButton url={finale?.tipsUrl || TIPS_URL} />}
      <ReviewForm sessionId={sessionId} initial={finale?.myReview ?? null} onSaved={(r) => finale && setFinale({ ...finale, myReview: r })} />
      <FinaleLinks avito={!finale?.myReview} />
    </section>
  );
}

const STARS = [1, 2, 3, 4, 5] as const;

/** Отзыв: звёзды, пара слов, имя по желанию, согласие. Один на телефон и игру — можно исправить. */
export function ReviewForm({
  sessionId,
  initial,
  onSaved,
}: {
  sessionId: string;
  initial: { rating: number; text: string; name: string } | null;
  onSaved?: (review: { rating: number; text: string; name: string }) => void;
}) {
  const [rating, setRating] = useState(initial?.rating ?? 0);
  const [text, setText] = useState(initial?.text ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [consent, setConsent] = useState(Boolean(initial));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(Boolean(initial));
  const [editing, setEditing] = useState(!initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initial) return;
    setRating(initial.rating);
    setText(initial.text);
    setName(initial.name);
    setConsent(true);
    setDone(true);
    setEditing(false);
  }, [initial]);

  if (!finaleRepo) return null;

  async function send() {
    if (!finaleRepo || rating < 1) return;
    setBusy(true);
    setError(null);
    try {
      await finaleRepo.review({ sessionId, rating, text: text.trim(), name: name.trim(), consent });
      setDone(true);
      setEditing(false);
      onSaved?.({ rating, text: text.trim(), name: name.trim() });
    } catch (e) {
      const code = errorCodeOf(e);
      setError(code === "failed-precondition" ? "Отзыв можно оставить, когда игра закончится." : "Не получилось отправить. Проверьте интернет и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  if (done && !editing) {
    return (
      <div className="stack stack--tight finale-review is-done">
        <p className="finale-review__stars" aria-label={`Ваша оценка: ${rating} из 5`}>
          {"★".repeat(rating)}
          <span className="muted">{"★".repeat(5 - rating)}</span>
        </p>
        <p>Спасибо за отзыв! Нам очень приятно.</p>
        <p className="muted small">Поделитесь отзывом и на Авито — нам это очень поможет.</p>
        <a className="btn btn--secondary btn--block" href={AVITO_URL} target="_blank" rel="noopener noreferrer">
          ⭐ Отзыв на Авито
        </a>
        <button type="button" className="btn btn--quiet" onClick={() => setEditing(true)}>
          Исправить отзыв
        </button>
      </div>
    );
  }

  return (
    <form
      className="stack stack--tight finale-review"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <p className="finale-review__title">Как вам вечер?</p>
      <div className="finale-review__rate" role="radiogroup" aria-label="Оценка">
        {STARS.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} из 5`}
            className={n <= rating ? "finale-star is-on" : "finale-star"}
            onClick={() => setRating(n)}
          >
            ★
          </button>
        ))}
      </div>
      <label className="field">
        Пара слов (по желанию)
        <textarea rows={3} maxLength={1000} value={text} placeholder="Что понравилось больше всего?" onChange={(e) => setText(e.target.value)} />
      </label>
      <label className="field">
        Как вас подписать (по желанию)
        <input maxLength={60} value={name} placeholder="Например: Анна, свадьба 12 октября" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="choice">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span className="choice__text">
          <span className="choice__title">Согласен(на), что JoyRest покажет отзыв с подписью на сайте и в соцсетях</span>
        </span>
      </label>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn--block" disabled={busy || rating < 1 || !consent}>
        {busy ? "Отправляем…" : "Отправить отзыв"}
      </button>
    </form>
  );
}
