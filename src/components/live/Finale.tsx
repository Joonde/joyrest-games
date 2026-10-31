/**
 * Конец игры (решение владельца 15 октября 2026): после награждения — «Спасибо» с делами: общие чаевые, отзыв
 * о вечере, отзыв на Авито и Telegram-канал JoyRest. Экран зала показывает QR-коды (слайд «Спасибо»), телефон гостя — те же
 * дела кнопками, отзыв пишется прямо на телефоне. Чаевые (решение владельца 17 октября 2026) — всегда одна общая
 * ссылка JoyRest (`TIPS_URL` — Яндекс Чаевые) на всех играх, своих ссылок у ведущих нет; и без своего сервера тоже. Ссылки «Авито · канал · сайт» (`FinaleLinks`) — везде, где гость видит конец игры (17 октября 2026).
 * Только свой сервер (`finaleRepo`); у Firebase — один QR канала, как раньше.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { edition, errorCodeOf, finaleRepo, type Finale } from "../../data";
import { QrCode } from "../QrCode";
import { shareResults, StoryShare } from "./StoryCard";
import type { StoryCardInput } from "../../core/storyCard";
import { activeStep, FINALE_STEP_LABELS, finaleSteps, parseMarks, stepsHint, type FinaleStepId, type FinaleStepStatus } from "../../core/finaleSteps";
import type { GameResult } from "../../data";

export const CHANNEL_URL = "https://t.me/JoyRest";
/** Сообщество JoyRest во ВКонтакте (создано 31 октября 2026); пусто — кнопки «ВКонтакте» нет. */
export const VK_URL = "";
export const CHANNEL_TEXT = "Мы начали вести Telegram-канал — будем благодарны за подписку. Так вам будет легче найти нас, когда снова захотите праздник.";
export const AVITO_URL = "https://www.avito.ru/brands/ea177461b6df1ce218b27e955ac8a349";
export const AVITO_TEXT = "Отзывы на Авито помогают другим выбрать нас";
export const SITE_URL = "https://joy-rest.ru";
export const SITE_CALC_URL = "https://joy-rest.ru/calc/";
export const SITE_TEXT = "Посчитайте стоимость следующего праздника за минуту";

/** Общие чаевые JoyRest (решение владельца 17 октября 2026): показываются, когда у ведущего и владельца нет своей ссылки. */
/** Общие чаевые JoyRest — одна ссылка на всех играх (Яндекс Чаевые, решение владельца 17 октября 2026: копим на
 * оборудование и костюмы ведущих). Своих ссылок у ведущих нет. Пусто — карточки чаевых нет. */
export const TIPS_URL = "https://tips.yandex.ru/guest/payment/4035386?is_from_qr=true";
export const TIPS_TEXT =
  "Огромное спасибо, что играли с нами! Если вечер понравился и есть желание поддержать ведущего и команду JoyRest — можно оставить чаевые.";

/**
 * Ссылки JoyRest в конце игры (чаевые, Авито, канал, сайт, QR на «Спасибо») — только у агентства. В Лайте гости ведущих-
 * подписчиков их не видят (решение владельца 22 октября 2026); свои ссылки подписчика — позже.
 */
export const JOYREST_LINKS = edition() !== "lite";

export function reviewUrl(sessionId: string): string {
  return `${window.location.origin}/review/${sessionId}`;
}

/**
 * Ссылки конца игры для гостя: отзыв на Авито, канал, сайт. Кнопки столбиком во всю ширину. `avito={false}` — когда
 * кнопка Авито уже стоит рядом (отзыв отправлен — `ReviewForm` зовёт на Авито сам).
 */
export function FinaleLinks({ avito = true }: { avito?: boolean }) {
  if (!JOYREST_LINKS) return null;
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
  return JOYREST_LINKS ? <FinaleQrsJoyRest sessionId={sessionId} /> : null;
}

function FinaleQrsJoyRest({ sessionId }: { sessionId: string | null | undefined }) {
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
        {TIPS_URL && <TipsQr url={TIPS_URL} />}
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
export function TipsButton({ url = TIPS_URL, onOpen }: { url?: string; onOpen?: () => void }) {
  if (!JOYREST_LINKS) return null;
  return (
    <div className="stack stack--tight finale-tips">
      <p className="small">{TIPS_TEXT}</p>
      <a className="btn btn--block" href={url} target="_blank" rel="noopener noreferrer" onClick={onOpen}>
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

const MARKS_KEY = "joyrest.finale.";

function readMarks(sessionId: string): Partial<Record<FinaleStepId, FinaleStepStatus>> {
  try {
    return parseMarks(JSON.parse(localStorage.getItem(MARKS_KEY + sessionId) ?? "null"));
  } catch {
    return {};
  }
}

function writeMarks(sessionId: string, marks: Partial<Record<FinaleStepId, FinaleStepStatus>>) {
  try {
    localStorage.setItem(MARKS_KEY + sessionId, JSON.stringify(marks));
  } catch {
    // Нет хранилища — отметки живут до перезагрузки.
  }
}

/**
 * Телефон гостя после игры (решение владельца 31 октября 2026): дела по шагам, чтобы не разбегались глаза —
 * 1 карточка для сторис → 2 оценка вечера → 3 чаевые → 4 канал (`src/core/finaleSteps.ts`). Сверху полоска шагов,
 * подсвечен первый несделанный, сделанный сворачивается в строку («ещё раз» — развернуть). Отметки помнит телефон.
 */
export function FinalePhone({ sessionId, story }: { sessionId: string; story?: { input: StoryCardInput; result: GameResult } | null }) {
  const [finale, setFinale] = useFinale(sessionId);
  const [marks, setMarks] = useState(() => readMarks(sessionId));
  const [open, setOpen] = useState<FinaleStepId | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Стиль карточки, выбранный в ленте, — чтобы «ещё раз» открывал его же.
  const [storyStyle, setStoryStyle] = useState(0);
  if (!JOYREST_LINKS) return null;

  const steps = finaleSteps({ card: Boolean(story), review: Boolean(finaleRepo), tips: Boolean(TIPS_URL) });
  // Отзыв, отправленный раньше (с этого телефона), — шаг сделан.
  const all: Partial<Record<FinaleStepId, FinaleStepStatus>> = finale?.myReview && !marks.review ? { ...marks, review: "done" } : marks;
  const active = activeStep(steps, all);
  const mark = (id: FinaleStepId, status: FinaleStepStatus) => {
    setMarks((prev) => {
      if (prev[id] === "done") return prev;
      const next = { ...prev, [id]: status };
      writeMarks(sessionId, next);
      return next;
    });
    setOpen((o) => (o === id ? null : o));
  };
  const numberOf = (id: FinaleStepId) => steps.indexOf(id) + 1;
  const step = (id: FinaleStepId, title: string, sub: string, doneLine: string, body: ReactNode) => (
    <FinaleStep
      key={id}
      id={id}
      n={numberOf(id)}
      title={title}
      sub={sub}
      status={all[id]}
      active={active === id}
      expanded={open === id}
      doneLine={doneLine}
      onReopen={() => setOpen(id)}
      onSkip={() => mark(id, "skip")}
    >
      {body}
    </FinaleStep>
  );
  const isCard = Boolean(story);
  const title = story && story.input.place === 1 ? "Ваша карточка победителя" : "Ваша карточка для сторис";

  return (
    <section className="stack finale-phone" aria-label="Что можно сделать после игры">
      <ol className="finale-steps">
        {steps.map((id) => {
          const status = all[id];
          const cls = status ? "finale-steps__item is-done" : active === id ? "finale-steps__item is-active" : "finale-steps__item";
          return (
            <li key={id} className={cls}>
              <button
                type="button"
                aria-current={active === id ? "step" : undefined}
                onClick={() => {
                  if (status) setOpen(id);
                  requestAnimationFrame(() => document.getElementById(`finale-${id}`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
                }}
              >
                <span className="finale-steps__n" aria-hidden>
                  {status === "done" ? "✓" : numberOf(id)}
                </span>
                {FINALE_STEP_LABELS[id]}
              </button>
            </li>
          );
        })}
      </ol>
      {active && <p className="muted small finale-steps__hint">{stepsHint(steps.length)}</p>}

      {isCard &&
        story &&
        step(
          "card",
          title,
          "Листайте ← → и выберите стиль",
          all.card === "done" ? "Карточка отправлена" : "Карточка — пропущено",
          <StoryShare input={story.input} start={storyStyle} onPick={setStoryStyle} onShared={() => mark("card", "done")} />,
        )}

      {finaleRepo &&
        step(
          "review",
          "Как вам вечер?",
          finale?.myReview ? "Спасибо за отзыв!" : "Одно касание — пара слов по желанию",
          finale?.myReview ? `Отзыв отправлен ${"★".repeat(finale.myReview.rating)}` : "Оценка — пропущено",
          <>
            <ReviewForm
              sessionId={sessionId}
              initial={finale?.myReview ?? null}
              hideTitle
              onSaved={(r) => {
                if (finale) setFinale({ ...finale, myReview: r });
                mark("review", "done");
                // Остаётся раскрытым: «спасибо» и приглашение на Авито видно сразу, подсветка уходит к чаевым.
                setOpen("review");
              }}
            />
            {!finale?.myReview && (
              <a className="finale-step__aside" href={AVITO_URL} target="_blank" rel="noopener noreferrer">
                {AVITO_TEXT} — оставить отзыв на Авито →
              </a>
            )}
          </>,
        )}

      {TIPS_URL &&
        step(
          "tips",
          "Поддержать ведущего 💛",
          "По желанию · копим на костюмы и технику ведущих",
          all.tips === "done" ? "Спасибо за чаевые! 💛" : "Чаевые — пропущено",
          <TipsButton onOpen={() => mark("tips", "done")} />,
        )}

      {step(
        "channel",
        "Будем на связи",
        "Фото с вечера, новые игры и праздники",
        all.channel === "done" ? "Вы с нами — спасибо!" : "Канал — пропущено",
        <div className="stack stack--tight">
          <p className="muted small">{CHANNEL_TEXT}</p>
          <div className={VK_URL ? "finale-step__row" : undefined}>
            <a className="btn btn--secondary btn--block" href={CHANNEL_URL} target="_blank" rel="noopener noreferrer" onClick={() => mark("channel", "done")}>
              ✈️ Telegram
            </a>
            {VK_URL && (
              <a className="btn btn--secondary btn--block" href={VK_URL} target="_blank" rel="noopener noreferrer" onClick={() => mark("channel", "done")}>
                ВКонтакте
              </a>
            )}
          </div>
        </div>,
      )}

      <div className="finale-phone__more">
        <p className="muted small">
          {SITE_TEXT}:{" "}
          <a href={SITE_CALC_URL} target="_blank" rel="noopener noreferrer">
            joy-rest.ru
          </a>
        </p>
        {story && (
          <button
            type="button"
            className="btn btn--quiet"
            onClick={async () => {
              setNote(null);
              setNote(await shareResults(story.result));
            }}
          >
            Поделиться итогами игры
          </button>
        )}
        {note && (
          <p className="muted small" role="status">
            {note}
          </p>
        )}
        <p className="finale-phone__thanks">Спасибо, что были с нами!</p>
      </div>
    </section>
  );
}

/** Один шаг: развёрнут, пока не сделан (или «ещё раз»); сделанный — строка с галочкой. */
function FinaleStep({
  id,
  n,
  title,
  sub,
  status,
  active,
  expanded,
  doneLine,
  onReopen,
  onSkip,
  children,
}: {
  id: FinaleStepId;
  n: number;
  title: string;
  sub: string;
  status: FinaleStepStatus | undefined;
  active: boolean;
  expanded: boolean;
  doneLine: string;
  onReopen: () => void;
  onSkip: () => void;
  children: ReactNode;
}) {
  if (status && !expanded) {
    return (
      <div id={`finale-${id}`} className="finale-step is-done">
        <span className={status === "done" ? "finale-step__n is-ok" : "finale-step__n is-skip"} aria-hidden>
          {status === "done" ? "✓" : "–"}
        </span>
        <span className="finale-step__done">{doneLine}</span>
        <button type="button" className="finale-step__again" onClick={onReopen}>
          {status === "done" ? (id === "review" ? "исправить" : "ещё раз") : "открыть"}
        </button>
      </div>
    );
  }
  return (
    <div id={`finale-${id}`} className={active ? "finale-step is-active" : "finale-step"}>
      <div className="finale-step__head">
        <span className="finale-step__n" aria-hidden>
          {n}
        </span>
        <div>
          <h2 className="finale-step__title">{title}</h2>
          <p className="finale-step__sub">{sub}</p>
        </div>
      </div>
      {children}
      {active && !status && (
        <button type="button" className="finale-step__skip" onClick={onSkip}>
          Пропустить
        </button>
      )}
    </div>
  );
}

const STARS = [1, 2, 3, 4, 5] as const;

/** Отзыв: звёзды, пара слов, имя по желанию, согласие. Один на телефон и игру — можно исправить. */
export function ReviewForm({
  sessionId,
  initial,
  onSaved,
  hideTitle = false,
}: {
  sessionId: string;
  initial: { rating: number; text: string; name: string } | null;
  onSaved?: (review: { rating: number; text: string; name: string }) => void;
  /** Заголовок «Как вам вечер?» уже стоит над формой (шаг на телефоне гостя). */
  hideTitle?: boolean;
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
        <p className="muted small">
          Поделитесь отзывом и на Авито — нам это очень поможет.{text.trim() ? " Ваш текст скопируем — останется вставить." : ""}
        </p>
        <a
          className="btn btn--secondary btn--block"
          href={AVITO_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            if (text.trim()) void navigator.clipboard?.writeText(text.trim()).catch(() => undefined);
          }}
        >
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
      {!hideTitle && <p className="finale-review__title">Как вам вечер?</p>}
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
