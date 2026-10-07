/**
 * Заявка клиента (`/venues/r/:id`): кто, что празднует, пожелания; подбор площадок из базы с
 * процентом совпадения; выбор галочками → «Предложение клиенту» (ссылка, «Поделиться», PDF).
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  DISTRICTS,
  formatEventDate,
  formatLabel,
  FORMATS,
  offerText,
  rankVenues,
  REQUEST_STATUSES,
  requestStatusInfo,
  venueStatusInfo,
  wishesText,
  type Mark,
  type RequestData,
} from "../../core/venues";
import { useLoad, venuesRepo, type OfferSummary, type PublicOffer, type VenueRecord, type VenueRequestRecord } from "../../data";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ListSkeleton } from "../../components/Skeleton";
import { LoadFailedInline } from "../../components/Status";
import { Toast, useToast } from "../../components/Toast";
import { TopBar } from "../../components/TopBar";
import { ChoiceChips, NumberField, StatusPicker, StatusPill, WishPicker } from "../../components/venues/Fields";
import { venueActions, VenuesGate } from "./VenuesHome";

export function RequestDetail() {
  const { requestId = "" } = useParams();
  return (
    <VenuesGate>
      {(profile) => (
        <main className="page page--wide">
          <TopBar title="Заявка клиента" actions={[{ label: "К заявкам", to: "/venues?tab=requests" }, ...venueActions(profile)]} />
          <RequestLoaded id={requestId} />
        </main>
      )}
    </VenuesGate>
  );
}

function RequestLoaded({ id }: { id: string }) {
  const [state, retry, update] = useLoad(() => (venuesRepo ? venuesRepo.getRequest(id) : Promise.reject(new Error("unavailable"))), [id]);
  if (state.status === "loading") return <ListSkeleton />;
  if (state.status === "error") return <LoadFailedInline onRetry={retry} text="Заявка не открылась: её удалили или нет связи." />;
  return <RequestView request={state.data} onChange={(next) => update(() => next)} />;
}

function RequestView({ request, onChange }: { request: VenueRequestRecord; onChange: (r: VenueRequestRecord) => void }) {
  const navigate = useNavigate();
  const [toast, showToast] = useToast();
  const [notes, setNotes] = useState(request.notes);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const r = request.data;
  const info = requestStatusInfo(request.status);
  const wishes = wishesText(r);

  useEffect(() => setNotes(request.notes), [request.notes]);

  async function save(patch: Parameters<NonNullable<typeof venuesRepo>["updateRequest"]>[1], done: string) {
    if (!venuesRepo) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await venuesRepo.updateRequest(request.id, patch));
      showToast(done);
      setEditing(false);
    } catch {
      setError("Не получилось сохранить. Проверьте интернет и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="request-layout">
        <div className="stack">
          <section className="card">
            <div className="row venue-card__head">
              <h2>Заявка №{request.number}</h2>
              <StatusPill tone={info.tone} label={info.label} />
            </div>
            <dl className="kv">
              <dt>Клиент</dt>
              <dd>{r.name}</dd>
              <dt>Телефон</dt>
              <dd>{r.phone ? <a href={`tel:${r.phone.replace(/[^\d+]/g, "")}`}>{r.phone}</a> : "—"}</dd>
              <dt>Что</dt>
              <dd>{[r.eventType, formatLabel(r.format)].filter(Boolean).join(", ") || "—"}</dd>
              <dt>Когда</dt>
              <dd>{[formatEventDate(r.date), r.from && r.to ? `${r.from}–${r.to}` : r.from].filter(Boolean).join(", ") || "дата не выбрана"}</dd>
              <dt>Гостей</dt>
              <dd>{r.guests ?? "—"}</dd>
              <dt>Бюджет</dt>
              <dd>{r.budget ? `до ${r.budget.toLocaleString("ru-RU")} ₽ на гостя` : "не указан"}</dd>
              <dt>Где</dt>
              <dd>{r.district || "не важно"}</dd>
              <dt>Пожелания</dt>
              <dd>{wishes || "без пожеланий"}</dd>
              {r.comment && (
                <>
                  <dt>Комментарий</dt>
                  <dd className="pre-line">{r.comment}</dd>
                </>
              )}
            </dl>
            <ul className="meta">
              <li>Пришла {new Date(request.createdAt).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}</li>
              {request.hostName && <li>Привёл: {request.hostName}</li>}
            </ul>
            {!editing && (
              <button className="btn btn--secondary btn--block" type="button" onClick={() => setEditing(true)}>
                Уточнить запрос
              </button>
            )}
          </section>

          {editing && <RequestEditor initial={r} busy={busy} onCancel={() => setEditing(false)} onSave={(data) => void save({ data }, "Запрос обновлён — подбор пересчитан")} />}

          <section className="card">
            <StatusPicker label="Статус заявки" options={REQUEST_STATUSES} value={request.status} disabled={busy} onChange={(status) => void save({ status }, "Статус изменён")} />
            <label className="field">
              <span className="field__label">Наши заметки</span>
              <textarea value={notes} maxLength={2000} placeholder="Что обсудили по телефону" onChange={(e) => setNotes(e.target.value)} />
            </label>
            {notes !== request.notes && (
              <button className="btn btn--secondary btn--block" type="button" disabled={busy} onClick={() => void save({ notes }, "Заметки сохранены")}>
                Сохранить заметки
              </button>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </section>
        </div>

        <Matching request={request} onOfferCreated={() => onChange({ ...request, status: request.status === "new" ? "sent" : request.status, offers: request.offers + 1 })} />
      </div>

      <div className="actions">
        <button className="btn btn--quiet btn--block" type="button" onClick={() => setConfirmDelete(true)}>
          Удалить заявку
        </button>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title={`Удалить заявку №${request.number}?`}
        confirmLabel="Удалить заявку"
        busy={busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          if (!venuesRepo) return;
          setBusy(true);
          venuesRepo
            .removeRequest(request.id)
            .then(() => navigate("/venues?tab=requests", { replace: true }))
            .catch(() => {
              setBusy(false);
              setConfirmDelete(false);
              setError("Не получилось удалить. Проверьте интернет.");
            });
        }}
      >
        <p>Имя и телефон клиента удалятся. Отправленные ему ссылки продолжат открываться.</p>
      </ConfirmDialog>
      <Toast text={toast} />
    </>
  );
}

function RequestEditor({ initial, busy, onSave, onCancel }: { initial: RequestData; busy: boolean; onSave: (data: RequestData) => void; onCancel: () => void }) {
  const [data, setData] = useState(initial);
  const set = <K extends keyof RequestData>(key: K, value: RequestData[K]) => setData({ ...data, [key]: value });
  return (
    <section className="card">
      <h3>Уточнить запрос</h3>
      <NumberField label="Гостей" required value={data.guests} max={5000} onChange={(x) => set("guests", x)} />
      <ChoiceChips
        label="Формат"
        options={FORMATS.map((f) => f.label)}
        value={FORMATS.find((f) => f.id === data.format)?.label ?? ""}
        onChange={(x) => set("format", FORMATS.find((f) => f.label === x)?.id ?? "")}
      />
      <NumberField label="Бюджет на гостя до, ₽" value={data.budget} onChange={(x) => set("budget", x)} />
      <ChoiceChips label="Округ" options={DISTRICTS} value={data.district} onChange={(x) => set("district", x)} />
      <WishPicker value={data.wishes} onChange={(x) => set("wishes", x)} />
      <div className="actions">
        <button className="btn btn--block" type="button" disabled={busy || !data.guests} onClick={() => onSave(data)}>
          {busy ? "Сохраняем…" : "Сохранить и пересчитать подбор"}
        </button>
        <button className="btn btn--secondary btn--block" type="button" disabled={busy} onClick={onCancel}>
          Отмена
        </button>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ подбор и предложение

function markClass(mark: Mark): string {
  return mark.fit === true ? "mark mark--yes" : mark.fit === false ? "mark mark--no" : "mark mark--maybe";
}

function markIcon(mark: Mark): string {
  return mark.fit === true ? "✓" : mark.fit === 0.5 ? "≈" : mark.fit === null ? "?" : "✗";
}

const MAX_PICK = 10;

function Matching({ request, onOfferCreated }: { request: VenueRequestRecord; onOfferCreated: () => void }) {
  const [state, retry] = useLoad(() => (venuesRepo ? venuesRepo.list() : Promise.resolve([] as VenueRecord[])), []);
  const [offers, , updateOffers] = useLoad(() => (venuesRepo ? venuesRepo.listOffers(request.id) : Promise.resolve([] as OfferSummary[])), [request.id]);
  const [picked, setPicked] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<PublicOffer | null>(null);
  const ranked = useMemo(() => (state.status === "ready" ? rankVenues(state.data, request.data) : []), [state, request.data]);
  const total = state.status === "ready" ? state.data.filter((v) => v.status !== "rejected").length : 0;

  function toggle(id: string) {
    setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : list.length >= MAX_PICK ? list : [...list, id]));
  }

  async function createOffer() {
    if (!venuesRepo || picked.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      // Порядок в предложении — как в подборе (лучшие сверху).
      const order = ranked.map((x) => x.item.id).filter((id) => picked.includes(id));
      const offer = await venuesRepo.createOffer({ requestId: request.id, venueIds: order, comment });
      setCreated(offer);
      setPicked([]);
      onOfferCreated();
      updateOffers((list) => [{ id: offer.id, title: offer.title, venues: offer.items.map((i) => i.name), createdAt: offer.createdAt }, ...list]);
      window.setTimeout(() => document.getElementById("offer-ready")?.scrollIntoView({ block: "start" }), 50);
    } catch {
      setError("Не получилось собрать предложение. Проверьте интернет и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  if (state.status === "loading") return <ListSkeleton />;
  if (state.status === "error") return <LoadFailedInline onRetry={retry} />;

  return (
    <section className="stack matching">
      <div className="row matching__head">
        <h2>Подбор площадок</h2>
        <span className="muted small">
          подходит {ranked.length} из {total}
        </span>
      </div>
      <p className="muted small">
        Мест меньше, чем гостей, или нет того, что клиент отметил «обязательно», — площадка не показывается. Остальные — по проценту совпадения. Отметьте
        галочками до {MAX_PICK} площадок для предложения.
      </p>

      {created && <OfferReady offer={created} />}

      {ranked.length === 0 ? (
        <section className="card card--center">
          <h3>Ничего не подошло</h3>
          <p className="muted">Уточните запрос: переведите часть «обязательно» в «хотелось бы» или уберите округ.</p>
        </section>
      ) : (
        <>
          {picked.length === 0 && ranked.length > 0 && (
            <button className="btn btn--secondary btn--block" type="button" onClick={() => setPicked(ranked.slice(0, 3).map((x) => x.item.id))}>
              Отметить {Math.min(3, ranked.length)} лучших
            </button>
          )}
          <ul className="match-list">
            {ranked.map(({ item, match }) => {
              const status = venueStatusInfo(item.status);
              const on = picked.includes(item.id);
              return (
                <li key={item.id} className={`card match${on ? " match--on" : ""}`}>
                  <label className="match__pick">
                    <input type="checkbox" checked={on} disabled={!on && picked.length >= MAX_PICK} onChange={() => toggle(item.id)} />
                    <span className="match__name">{item.data.name}</span>
                  </label>
                  <div className="row">
                    <StatusPill tone={status.tone} label={status.label} />
                    {match.score !== null && (
                      <span className="score" aria-label={`Совпадение ${match.score}%`}>
                        <span className="score__bar">
                          <span style={{ width: `${match.score}%` }} />
                        </span>
                        {match.score}%
                      </span>
                    )}
                  </div>
                  <p className="muted small">
                    {[item.data.type, item.data.district, item.data.metro && `м. ${item.data.metro}`].filter(Boolean).join(" · ")}
                    {" · "}
                    {item.data.seated ?? "?"} сидя / {item.data.standing ?? "?"} стоя
                    {item.data.perGuest ? ` · от ${item.data.perGuest.toLocaleString("ru-RU")} ₽` : ""}
                  </p>
                  {match.marks.length > 0 && (
                    <ul className="marks">
                      {match.marks.map((mark, i) => (
                        <li key={`${mark.label}-${i}`} className={`${markClass(mark)}${mark.must ? " mark--must" : ""}`}>
                          {markIcon(mark)} {mark.label}
                        </li>
                      ))}
                    </ul>
                  )}
                  <Link className="small" to={`/venues/v/${item.id}`}>
                    Карточка площадки
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="offer-bar card">
        <p>
          <strong>Выбрано: {picked.length}</strong>
          {picked.length === 0 && <span className="muted small"> — отметьте площадки галочками</span>}
        </p>
        <label className="field">
          <span className="field__label">Слово клиенту</span>
          <textarea value={comment} maxLength={1000} placeholder="Например: подобрали три площадки на 19 июня, все свободны по нашим данным" onChange={(e) => setComment(e.target.value)} />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn--block" type="button" disabled={busy || picked.length === 0} onClick={() => void createOffer()}>
          {busy ? "Собираем предложение…" : "Предложение клиенту"}
        </button>
        <p className="muted small">В предложение не попадут адреса, телефоны и наши заметки — клиент договаривается через вас.</p>
      </div>

      {offers.status === "ready" && offers.data.length > 0 && (
        <section className="card">
          <h3>Отправленные предложения</h3>
          <ul className="list">
            {offers.data.map((o) => (
              <li key={o.id} className="offer-sent">
                <span className="stack--none">
                  <span>{o.venues.join(", ")}</span>
                  <span className="muted small">{new Date(o.createdAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                </span>
                <a className="btn btn--quiet" href={`/o/${o.id}`} target="_blank" rel="noreferrer">
                  Открыть
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

function OfferReady({ offer }: { offer: PublicOffer }) {
  const [toast, showToast] = useToast();
  const url = `${window.location.origin}/o/${offer.id}`;

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(done);
    } catch {
      showToast("Не получилось скопировать — удерживайте ссылку пальцем");
    }
  }

  return (
    <section className="card offer-ready" id="offer-ready" aria-live="polite">
      <h3>Предложение готово</h3>
      <p className="muted small">Клиент откроет ссылку с телефона: фото, вместимость, цены. «Скачать PDF» — на странице предложения.</p>
      <p className="line-clamp small">{url.replace(/^https?:\/\//, "")}</p>
      <div className="actions">
        {typeof navigator.share === "function" && (
          <button
            className="btn btn--block"
            type="button"
            onClick={() => void navigator.share({ title: "JoyRest — подборка площадок", text: `${offer.title}\n`, url }).catch(() => undefined)}
          >
            Поделиться ссылкой
          </button>
        )}
        <button className="btn btn--secondary btn--block" type="button" onClick={() => void copy(url, "Ссылка скопирована")}>
          Скопировать ссылку
        </button>
        <button className="btn btn--secondary btn--block" type="button" onClick={() => void copy(offerText(offer, url), "Текст скопирован")}>
          Скопировать текстом
        </button>
        <a className="btn btn--quiet btn--block" href={url} target="_blank" rel="noreferrer">
          Открыть и скачать PDF
        </a>
      </div>
      <Toast text={toast} />
    </section>
  );
}
