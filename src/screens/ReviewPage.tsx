// Отзыв о вечере по QR с экрана зала (`/review/:sessionId`): без входа (телефон получает устройство), звёзды, пара слов,
// подпись по желанию. Там же — чаевые ведущему и «Мы на связи» (Авито, канал, сайт — `FinaleLinks`). Игру уже убрали
// (сессии живут 30 дней) — «уже в архиве» и те же ссылки; сеть не ответила — «Повторить». Только свой сервер (`finaleRepo`).
import { useParams } from "react-router-dom";
import { FinaleLinks, ReviewForm, TIPS_URL, TipsButton, useFinale } from "../components/live/Finale";
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
        <p>Оставить отзыв можно на Авито или в нашем Telegram-канале.</p>
        <FinaleLinks />
      </Message>
    );
  }
  if (auth.status === "error") return <LoadFailed onRetry={retryAuth} />;
  if (auth.status === "loading") return <Pending skeleton={<PlaySkeleton />} label="Открываем отзыв" />;
  return <ReviewBody sessionId={sessionId} />;
}

function ReviewBody({ sessionId }: { sessionId: string }) {
  const [finale, setFinale, load] = useFinale(sessionId);
  if (load.status === "notFound") {
    return (
      <main className="page review-page">
        <Logo kind="full" className="logo--form" />
        <section className="card stack">
          <h1>Эта игра уже в архиве — спасибо, что были с нами!</h1>
          <FinaleLinks />
        </section>
      </main>
    );
  }
  return (
    <main className="page review-page">
      <Logo kind="full" className="logo--form" />
      <section className="card stack">
        <h1>Спасибо, что были с нами!</h1>
        {finale?.gameTitle && <p className="muted">{finale.gameTitle}{finale.hostName ? ` · ведущий — ${finale.hostName}` : ""}</p>}
        {finale ? (
          <ReviewForm sessionId={sessionId} initial={finale.myReview} onSaved={(r) => setFinale({ ...finale, myReview: r })} />
        ) : load.status === "failed" ? (
          <div className="stack stack--tight">
            <p className="muted">Не получилось загрузить отзыв — проверьте интернет.</p>
            <button type="button" className="btn btn--block" onClick={load.retry}>
              Повторить
            </button>
          </div>
        ) : (
          <p className="muted">Загружаем…</p>
        )}
      </section>
      <section className="card stack">
        <h2>Чаевые</h2>
        <TipsButton url={finale?.tipsUrl || TIPS_URL} />
      </section>
      <section className="card stack">
        <h2>Мы на связи</h2>
        <FinaleLinks avito={!finale?.myReview} />
      </section>
    </main>
  );
}
