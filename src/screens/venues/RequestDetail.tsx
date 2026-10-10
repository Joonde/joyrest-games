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
import { permissions, useLoad, venuesRepo, type OfferSummary, type PublicOffer, type VenueRecord, type VenueRequestRecord } from "../../data";
import { useConfirm } from "../../components/ConfirmDialog";
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
          <RequestLoaded id={requestId} canArchive={permissions.canArchiveVenues(profile)} />
        </main>
      )}
    </VenuesGate>
  );
}

function RequestLoaded({ id, canArchive }: { id: string; canArchive: boolean }) {
  const [state, retry, update] = useLoad(() => (venuesRepo ? venuesRepo.getRequest(id) : Promise.reject(new Error("unavailable"))), [id]);
  if (state.status === "loading") return <ListSkeleton />;
  if (state.status === "error") return <LoadFailedInline onRetry={retry} text="Заявка не открылась: её удалили или нет связи." />;
  return <RequestView request={state.data} canArchive={canArchive} onChange={(next) => update(() => next)} />;
}

function RequestView({ request, canArchive, onChange }: { request: VenueRequestRecord; canArchive: boolean; onChange: (r: VenueRequestRecord) => void }) {
  const navigate = useNavigate();
  const [toast, showToast] = useToast();
  const [notes, setNotes] = useState(request.notes);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, confirm] = useConfirm();
  const r = request.data;
  const archived = request.archivedAt !== null;
  const list = archived ? { to: "/venues?tab=archive", label: "← К архиву" } : { to: "/venues?tab=requests", label: "← К заявкам" };
  const info = requestStatusInfo(request.status);
  const wishes = wishesText(r);

  useEffect(() => setNotes(request.notes), [request.notes]);

  type Patch = Parameters<NonNullable<typeof venuesRepo>["updateRequest"]>[1];

  /** Изменение — только после «Вы точно уверены?»; ошибка остаётся в окне. */
  function save(patch: Patch, done: string, ask: { title: string; text: string; confirmLabel: string }) {
    const repo = venuesRepo;
    if (!repo) return;
    confirm({
      ...ask,
      run: async () => {
        setBusy(true);
        setError(null);
        try {
          onChange(await repo.updateRequest(request.id, patch));
          showToast(done);
          setEditing(false);
        } finally {
          setBusy(false);
        }
      },
    });
  }

  return (
    <>
      <Link className="btn btn--quiet back-link" to={list.to}>
        {list.label}
      </Link>
      {archived && (
        <section className="card notice-card">
          <h2>Заявка в архиве</h2>
          <p className="muted">Убрана {new Date(request.archivedAt ?? 0).toLocaleDateString("ru-RU")}. Отправленные клиенту ссылки открываются.</p>
          <button
            hidden={!canArchive}
            className="btn btn--block"
            type="button"
            disabled={busy}
            onClick={() =>
              confirm({
                title: `Вернуть заявку №${request.number} из архива?`,
                text: "Она снова появится во вкладке «Заявки клиентов».",
                confirmLabel: "Вернуть из архива",
                run: async () => onChange(await venuesRepo!.restoreRequest(request.id)),
              })
            }
          >
            Вернуть из архива
          </button>
        </section>
      )}
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
            {!editing && !archived && (
              <button className="btn btn--secondary btn--block" type="button" onClick={() => setEditing(true)}>
                Уточнить запрос
              </button>
            )}
          </section>

          {editing && (
            <RequestEditor initial={r} busy={busy} onCancel={() => setEditing(false)} onSave={(data) =>
                save({ data }, "Запрос обновлён — подбор пересчитан", { title: "Сохранить изменения?", text: "Запрос клиента обновится, подбор площадок пересчитается.", confirmLabel: "Сохранить изменения" })
              }
            />
          )}

          {!archived && (
          <section className="card">
            <StatusPicker
              label="Статус заявки"
              options={REQUEST_STATUSES}
              value={request.status}
              disabled={busy}
              onChange={(status) => {
                if (status === request.status) return;
                const label = requestStatusInfo(status).label;
                save({ status }, "Статус изменён", { title: `Статус «${label}»?`, text: `Сейчас: «${info.label}». Поменять на «${label}»?`, confirmLabel: "Да, поменять статус" });
              }}
            />
            <label className="field">
              <span className="field__label">Наши заметки</span>
              <textarea value={notes} maxLength={2000} placeholder="Что обсудили по телефону" onChange={(e) => setNotes(e.target.value)} />
            </label>
            {notes !== request.notes && (
              <div className="actions">
                <button
                  className="btn btn--secondary btn--block"
                  type="button"
                  disabled={busy}
                  onClick={() => save({ notes }, "Заметки сохранены", { title: "Сохранить заметки?", text: "Прежний текст заметок заменится новым.", confirmLabel: "Сохранить заметки" })}
                >
                  Сохранить заметки
                </button>
                <button className="btn btn--quiet btn--block" type="button" disabled={busy} onClick={() => setNotes(request.notes)}>
                  Отменить правку заметок
                </button>
              </div>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </section>
          )}
        </div>

        {!archived && <Matching request={request} onOfferCreated={() => onChange({ ...request, status: request.status === "new" ? "sent" : request.status, offers: request.offers + 1 })} />}
      </div>

      <div className="actions">
        <Link className="btn btn--secondary btn--block" to={list.to}>
          {list.label}
        </Link>
        {!archived && canArchive && (
          <button
            className="btn btn--quiet btn--block"
            type="button"
            disabled={busy}
            onClick={() =>
              confirm({
                title: `Убрать заявку №${request.number} в архив?`,
                text: "Она пропадёт из «Заявок клиентов», но не удалится: её можно вернуть во вкладке «Архив». Отправленные клиенту ссылки продолжат открываться.",
                confirmLabel: "Убрать в архив",
                run: async () => {
                  await venuesRepo!.removeRequest(request.id);
                  navigate(list.to, { replace: true });
                },
              })
            }
          >
            Убрать в архив
          </button>
        )}
      </div>
      {dialog}
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
  const [dialog, confirm] = useConfirm();
  // Площадки из архива в подбор не попадают.
  const active = useMemo(() => (state.status === "ready" ? state.data.filter((v) => v.archivedAt === null) : []), [state]);
  const ranked = useMemo(() => rankVenues(active, request.data), [active, request.data]);
  const total = active.filter((v) => v.status !== "rejected").length;

  function toggle(id: string) {
    setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : list.length >= MAX_PICK ? list : [...list, id]));
  }

  function askOffer() {
    if (!venuesRepo || picked.length === 0) return;
    confirm({
      title: "Собрать предложение клиенту?",
      text: `В подборку войдут ${picked.length} ${picked.length === 1 ? "площадка" : picked.length < 5 ? "площадки" : "площадок"} — без адресов и контактов. Будет ссылка, которую можно отправить клиенту.`,
      confirmLabel: "Собрать предложение",
      run: createOffer,
    });
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

      <div className={picked.length > 0 ? "offer-bar offer-bar--sticky card" : "offer-bar card"}>
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
        <button className="btn btn--block" type="button" disabled={busy || picked.length === 0} onClick={askOffer}>
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
      {dialog}
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
