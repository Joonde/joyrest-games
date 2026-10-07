/**
 * Предложение клиенту по ссылке (`/o/:id`): подборка площадок без адресов и контактов. Открывается
 * без входа; «Скачать PDF» — печать страницы (в браузере телефона — «Сохранить как PDF»).
 */
import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useLoad, venuesRepo, type PublicOffer } from "../../data";
import { Logo } from "../../components/Logo";
import { FormFailed, PublicSkeleton } from "./PublicParts";

export function OfferPage() {
  const { offerId = "" } = useParams();
  const [state, retry] = useLoad(() => (venuesRepo ? venuesRepo.getOffer(offerId) : Promise.reject(Object.assign(new Error("not-found"), { code: "not-found" }))), [offerId]);

  useEffect(() => {
    // Ссылку не индексируют поисковики (у неё и так нет публичных ссылок на неё).
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  if (state.status === "loading") return <PublicSkeleton />;
  if (state.status === "error") return <FormFailed onRetry={retry} text="Подборка не открылась. Проверьте ссылку или интернет." />;
  if (!state.data.id) return <FormFailed onRetry={retry} text="Подборка не найдена." />;
  return <Offer offer={state.data} />;
}

export function Offer({ offer, preview = false }: { offer: PublicOffer; preview?: boolean }) {
  const photoUrl = (sha: string) => (venuesRepo ? venuesRepo.offerPhotoUrl(offer.id, sha) : "");
  return (
    <main className={preview ? "offer offer--preview" : "page offer"}>
      <header className="offer__head">
        <Logo kind="full" className="logo--form offer__logo" />
        <p className="eyebrow">Подборка площадок</p>
        <h1>{offer.title}</h1>
        {offer.comment && <p className="offer__comment">{offer.comment}</p>}
      </header>

      {!preview && (
        <div className="actions offer__tools">
          <button className="btn btn--secondary btn--block" type="button" onClick={() => window.print()}>
            Скачать PDF
          </button>
        </div>
      )}

      <ol className="offer__list">
        {offer.items.map((item, index) => (
          <li key={`${item.venueId}-${index}`} className="card offer__item">
            <div className="offer__title">
              <span className="offer__num" aria-hidden="true">
                {index + 1}
              </span>
              <div className="stack--none">
                <h2>{item.name}</h2>
                <p className="muted small">{[item.type, item.where].filter(Boolean).join(" · ")}</p>
              </div>
            </div>
            {item.photos.length > 0 && (
              <div className="offer__photos" role="list" aria-label={`Фото: ${item.name}`}>
                {item.photos.map((sha, i) => (
                  <img key={sha} role="listitem" src={photoUrl(sha)} alt={`${item.name}, фото ${i + 1}`} loading={index === 0 && i === 0 ? "eager" : "lazy"} />
                ))}
              </div>
            )}
            {item.about && <p>{item.about}</p>}
            <dl className="offer__facts">
              <dt>Вместимость</dt>
              <dd>{item.capacity}</dd>
              <dt>Стоимость</dt>
              <dd>{item.price}</dd>
              {item.cuisine.length > 0 && (
                <>
                  <dt>Кухня</dt>
                  <dd>{item.cuisine.join(", ").toLowerCase()}</dd>
                </>
              )}
              {item.features.length > 0 && (
                <>
                  <dt>Особенности</dt>
                  <dd>{item.features.join(", ").toLowerCase()}</dd>
                </>
              )}
            </dl>
            {item.ok.length > 0 && (
              <p className="offer__fit offer__fit--ok">
                <strong>Подходит по вашим пожеланиям:</strong> {item.ok.join(", ")}
              </p>
            )}
            {item.ask.length > 0 && (
              <p className="offer__fit offer__fit--ask">
                <strong>Уточним у заведения:</strong> {item.ask.join(", ")}
              </p>
            )}
            {item.no.length > 0 && (
              <p className="offer__fit offer__fit--no">
                <strong>Не совпадает:</strong> {item.no.join(", ")}
              </p>
            )}
          </li>
        ))}
      </ol>

      <p className="venue-note">
        <strong>Важно.</strong> Дата, время и условия проведения подтверждаются заведением. Мы созвонимся с выбранными площадками и уточним, свободны ли они в ваш
        день. Площадка может отказать — тогда подберём замену. Цены ориентировочные.
      </p>
      <p className="muted small offer__foot">
        Ваш менеджер JoyRest · <a href="https://t.me/JoyRest">t.me/JoyRest</a>
      </p>
    </main>
  );
}
