/**
 * Отзывы гостей (решение владельца 15 октября 2026): гости оставляют их после игры по QR на экране зала или прямо с
 * телефона. Ведущий видит отзывы о своих мероприятиях, владелец — все и отмечает «Показать на сайте» или «Скрыть».
 * Фильтр по оценке (отличные, хорошие, средние, плохие); владелец может удалить отзыв навсегда — только сам отзыв.
 */
import { useState } from "react";
import { inRatingGroup, RATING_GROUPS, type RatingGroup } from "../../core/reviewRating";
import { useConfirm } from "../../components/ConfirmDialog";
import { HostGate } from "../../components/HostGate";
import { ListSkeleton, StudioSkeleton } from "../../components/Skeleton";
import { LoadFailedInline } from "../../components/Status";
import { Toast, useToast } from "../../components/Toast";
import { TopBar } from "../../components/TopBar";
import { finaleRepo, permissions, useLoad, type GuestReview, type ReviewStatus, type UserProfile } from "../../data";
import { studioActions } from "./Studio";

type Filter = "all" | ReviewStatus;
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "Все" },
  { id: "new", label: "Новые" },
  { id: "published", label: "На сайте" },
  { id: "hidden", label: "Скрытые" },
];
const STATUS_LABELS: Record<ReviewStatus, string> = { new: "Новый", published: "На сайте", hidden: "Скрыт" };

const dateLabel = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" }) : "");

export function Reviews() {
  return (
    <HostGate skeleton={<StudioSkeleton />}>
      {(_user, profile) => (
        <main className="page">
          <TopBar title="Отзывы" actions={[{ label: "В студию", to: "/studio" }, ...studioActions(profile)]} />
          {finaleRepo ? <ReviewList profile={profile} /> : <p className="muted">Отзывы доступны на своём сервере JoyRest.</p>}
        </main>
      )}
    </HostGate>
  );
}

function ReviewList({ profile }: { profile: UserProfile }) {
  const repo = finaleRepo;
  const [state, retry, update] = useLoad(() => (repo ? repo.listReviews() : Promise.resolve([] as GuestReview[])), [repo]);
  const [filter, setFilter] = useState<Filter>("all");
  const [stars, setStars] = useState<RatingGroup>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, ask] = useConfirm();
  const [toast, showToast] = useToast();
  const owner = permissions.canModerateReviews(profile);

  async function setStatus(review: GuestReview, status: ReviewStatus) {
    if (!repo) return;
    setBusy(review.id);
    try {
      await repo.setReviewStatus(review.id, status);
      update((list) => list.map((r) => (r.id === review.id ? { ...r, status } : r)));
      showToast(status === "published" ? "Отзыв помещён на сайт" : status === "hidden" ? "Отзыв скрыт" : review.status === "published" ? "Отзыв убран с сайта" : "Отзыв снова в новых");
    } catch {
      showToast("Не получилось. Проверьте интернет.");
    } finally {
      setBusy(null);
    }
  }

  function remove(review: GuestReview) {
    ask({
      title: "Удалить отзыв навсегда?",
      text: "Удалится только этот отзыв: с сайта и из списка. Игра, итоги и другие отзывы останутся. Вернуть нельзя.",
      confirmLabel: "Удалить отзыв",
      run: async () => {
        if (!repo) return;
        await repo.deleteReview(review.id);
        update((list) => list.filter((r) => r.id !== review.id));
        showToast("Отзыв удалён");
      },
    });
  }

  if (state.status === "loading") return <ListSkeleton />;
  if (state.status === "error") return <LoadFailedInline onRetry={retry} />;
  const byStatus = state.data.filter((r) => filter === "all" || r.status === filter);
  const list = byStatus.filter((r) => inRatingGroup(r.rating, stars));
  const countIn = (group: RatingGroup) => byStatus.filter((r) => inRatingGroup(r.rating, group)).length;
  const rated = state.data.filter((r) => r.rating > 0);
  const average = rated.length ? rated.reduce((s, r) => s + r.rating, 0) / rated.length : 0;

  return (
    <div className="stack">
      <p className="muted">
        {owner
          ? "Гости оставляют отзывы после игры — по QR на экране зала или с телефона. «Поместить на сайт» — отзыв появится в ленте отзывов на joy-rest.ru (через несколько минут)."
          : "Отзывы гостей о ваших мероприятиях."}
      </p>
      {state.data.length > 0 && (
        <p>
          <strong>{average.toFixed(1).replace(".", ",")} ★</strong> <span className="muted">· {state.data.length} отзывов</span>
        </p>
      )}
      <div className="seg" role="group" aria-label="Какие отзывы показать">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={filter === f.id ? "seg__btn is-on" : "seg__btn"} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="seg clients-filters" role="group" aria-label="Отзывы по оценке">
        {RATING_GROUPS.map((g) => (
          <button key={g.id} type="button" className={stars === g.id ? "seg__btn is-on" : "seg__btn"} aria-pressed={stars === g.id} onClick={() => setStars(g.id)}>
            {g.label} · {countIn(g.id)}
          </button>
        ))}
      </div>
      {list.length === 0 && <p className="muted">{state.data.length === 0 ? "Отзывов пока нет." : "С такой оценкой отзывов нет."}</p>}
      <ul className="review-list">
        {list.map((r) => (
          <li key={r.id} className="card stack stack--tight">
            <p className="finale-review__stars" aria-label={`Оценка ${r.rating} из 5`}>
              {"★".repeat(r.rating)}
              <span className="muted">{"★".repeat(5 - r.rating)}</span>
            </p>
            {r.text ? <p className="review-list__text">{r.text}</p> : <p className="muted">Без текста</p>}
            <ul className="meta" aria-label="Об отзыве">
              {r.name && <li>{r.name}</li>}
              {r.gameTitle && <li>{r.gameTitle}</li>}
              {owner && r.hostName && <li>Ведущий: {r.hostName}</li>}
              {r.playedAt && <li>{dateLabel(r.playedAt)}</li>}
              <li>{STATUS_LABELS[r.status]}</li>
            </ul>
            {owner && (
              <div className="actions">
                {r.status !== "published" && (
                  <button type="button" className="btn btn--secondary btn--block" disabled={busy === r.id} onClick={() => void setStatus(r, "published")}>
                    Поместить на сайт
                  </button>
                )}
                {r.status === "published" && (
                  <button type="button" className="btn btn--secondary btn--block" disabled={busy === r.id} onClick={() => void setStatus(r, "new")}>
                    Убрать с сайта
                  </button>
                )}
                {r.status !== "hidden" && (
                  <button type="button" className="btn btn--quiet" disabled={busy === r.id} onClick={() => void setStatus(r, "hidden")}>
                    Скрыть
                  </button>
                )}
                <button type="button" className="btn btn--quiet" disabled={busy === r.id} onClick={() => remove(r)}>
                  Удалить отзыв
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {confirm}
      <Toast text={toast} />
    </div>
  );
}
