// Отзыв о вечере по QR с экрана зала (`/review/:sessionId`): без входа (телефон получает устройство), звёзды, пара слов,
// подпись по желанию. Там же — чаевые ведущему и канал JoyRest. Только свой сервер (`finaleRepo`).
import { useParams } from "react-router-dom";
import { CHANNEL_TEXT, CHANNEL_URL, ReviewForm, useFinale } from "../components/live/Finale";
import { Logo } from "../components/Logo";
import { PlaySkeleton } from "../components/Skeleton";
import { LoadFailed, Message, Pending } from "../components/Status";
import { finaleRepo, useGuestSignIn } from "../data";

export function ReviewPage() {
  const { sessionId = "" } = useParams();
  const [auth, retryAuth] = useGuestSignIn();
  if (!finaleRepo) {
    return (
      <Message title="Спасибо!">
        <p>Оставить отзыв можно в нашем Telegram-канале.</p>
        <a className="btn btn--block" href={CHANNEL_URL} target="_blank" rel="noopener noreferrer">
          Открыть канал JoyRest
        </a>
      </Message>
    );
  }
  if (auth.status === "error") return <LoadFailed onRetry={retryAuth} />;
  if (auth.status === "loading") return <Pending skeleton={<PlaySkeleton />} label="Открываем отзыв" />;
  return <ReviewBody sessionId={sessionId} />;
}

function ReviewBody({ sessionId }: { sessionId: string }) {
  const [finale, setFinale] = useFinale(sessionId);
  return (
    <main className="page review-page">
      <Logo kind="full" className="logo--form" />
      <section className="card stack">
        <h1>Спасибо, что были с нами!</h1>
        {finale?.gameTitle && <p className="muted">{finale.gameTitle}{finale.hostName ? ` · ведущий — ${finale.hostName}` : ""}</p>}
        {finale ? (
          <ReviewForm sessionId={sessionId} initial={finale.myReview} onSaved={(r) => setFinale({ ...finale, myReview: r })} />
        ) : (
          <p className="muted">Загружаем…</p>
        )}
      </section>
      {finale?.tipsUrl && (
        <section className="card stack">
          <h2>Чаевые ведущему</h2>
          <p className="muted small">Если вечер понравился — это лучшая благодарность.</p>
          <a className="btn btn--block" href={finale.tipsUrl} target="_blank" rel="noopener noreferrer">
            💛 Оставить чаевые
          </a>
        </section>
      )}
      <section className="card stack">
        <h2>Наш Telegram</h2>
        <p className="muted small">{CHANNEL_TEXT}</p>
        <a className="btn btn--secondary btn--block" href={CHANNEL_URL} target="_blank" rel="noopener noreferrer">
          Подписаться на канал JoyRest
        </a>
      </section>
    </main>
  );
}
