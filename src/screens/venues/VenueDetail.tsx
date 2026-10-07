/**
 * Карточка площадки (`/venues/v/:id`) и новая площадка вручную (`/venues/new`): вся анкета,
 * контакты, фото и меню, наш статус, оценка и заметки, правка и удаление.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { emptyVenue, findDuplicates, VENUE_FILES, VENUE_STATUSES, venueMissing, venueStatusInfo, type VenueData } from "../../core/venues";
import { useLoad, venuesRepo, type VenueRecord, type VenueUpload } from "../../data";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ListSkeleton } from "../../components/Skeleton";
import { LoadFailedInline } from "../../components/Status";
import { Toast, useToast } from "../../components/Toast";
import { TopBar } from "../../components/TopBar";
import { StatusPicker, StatusPill } from "../../components/venues/Fields";
import { FilePicker } from "../../components/venues/FilePicker";
import { VenueEditor } from "../../components/venues/VenueEditor";
import { venueActions, VenuesGate } from "./VenuesHome";

export function VenueDetail() {
  const { venueId = "" } = useParams();
  return (
    <VenuesGate>
      {(profile) => (
        <main className="page">
          <TopBar title="Площадка" actions={[{ label: "К базе площадок", to: "/venues" }, ...venueActions(profile)]} />
          <VenueLoaded id={venueId} />
        </main>
      )}
    </VenuesGate>
  );
}

export function NewVenue() {
  const navigate = useNavigate();
  const [data, setData] = useState<VenueData>(emptyVenue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!venuesRepo) return;
    const missing = venueMissing(data, 0, true);
    if (missing.length > 0) return setError(`Заполните: ${missing.join(", ")}.`);
    setBusy(true);
    setError(null);
    try {
      const created = await venuesRepo.create(data);
      navigate(`/venues/v/${created.id}`, { replace: true });
    } catch {
      setError("Не получилось сохранить. Проверьте интернет и нажмите ещё раз.");
      setBusy(false);
    }
  }

  return (
    <VenuesGate>
      {(profile) => (
        <main className="page">
          <TopBar title="Новая площадка" actions={[{ label: "К базе площадок", to: "/venues" }, ...venueActions(profile)]} />
          <p className="muted">Заполните то, что знаете: обязательно только название. Фото и меню добавите в карточке после сохранения.</p>
          <VenueEditor value={data} onChange={setData} />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="actions">
            <button className="btn btn--block" type="button" disabled={busy} onClick={() => void save()}>
              {busy ? "Сохраняем…" : "Сохранить площадку"}
            </button>
          </div>
        </main>
      )}
    </VenuesGate>
  );
}

function VenueLoaded({ id }: { id: string }) {
  const [state, retry, update] = useLoad(() => (venuesRepo ? venuesRepo.get(id) : Promise.reject(new Error("unavailable"))), [id]);
  const [others] = useLoad(() => (venuesRepo ? venuesRepo.list() : Promise.resolve([] as VenueRecord[])), []);
  if (state.status === "loading") return <ListSkeleton />;
  if (state.status === "error") return <LoadFailedInline onRetry={retry} text="Площадка не открылась: её удалили или нет связи." />;
  const twinId = others.status === "ready" ? findDuplicates(others.data).get(id) : undefined;
  const twin = twinId && others.status === "ready" ? others.data.find((v) => v.id === twinId) : undefined;
  return <VenueCard venue={state.data} onChange={(next) => update(() => next)} twin={twin ?? null} />;
}

function VenueCard({ venue, onChange, twin }: { venue: VenueRecord; onChange: (venue: VenueRecord) => void; twin: VenueRecord | null }) {
  const navigate = useNavigate();
  const [toast, showToast] = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<VenueData>(venue.data);
  const [notes, setNotes] = useState(venue.notes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploading, setUploading] = useState<VenueUpload[]>([]);
  const v = venue.data;
  const info = venueStatusInfo(venue.status);
  const photos = venue.files.filter((f) => f.kind === "photo");
  const menus = venue.files.filter((f) => f.kind === "menu");

  useEffect(() => setNotes(venue.notes), [venue.notes]);

  async function run(action: () => Promise<VenueRecord | void>, done?: string) {
    if (!venuesRepo) return;
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result) onChange(result);
      if (done) showToast(done);
    } catch {
      setError("Не получилось сохранить. Проверьте интернет и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  async function upload(files: VenueUpload[]) {
    const repo = venuesRepo;
    if (!repo || files.length === 0) return;
    setUploading(files);
    await run(async () => {
      for (const file of files) await repo.uploadFile(venue.id, file);
      return repo.get(venue.id);
    }, "Файлы добавлены");
    setUploading([]);
  }

  function removeFile(sha: string, done: string) {
    const repo = venuesRepo;
    if (!repo) return;
    void run(async () => {
      await repo.removeFile(venue.id, sha);
      return repo.get(venue.id);
    }, done);
  }

  if (editing) {
    return (
      <>
        <h2>Изменить анкету</h2>
        <VenueEditor value={draft} onChange={setDraft} />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button
            className="btn btn--block"
            type="button"
            disabled={busy || !draft.name}
            onClick={() =>
              void run(async () => {
                const saved = await venuesRepo?.update(venue.id, { data: draft });
                setEditing(false);
                return saved;
              }, "Анкета сохранена")
            }
          >
            {busy ? "Сохраняем…" : "Сохранить"}
          </button>
          <button className="btn btn--secondary btn--block" type="button" disabled={busy} onClick={() => setEditing(false)}>
            Отмена
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <section className="card">
        <div className="row venue-card__head">
          <h2>{v.name || "Без названия"}</h2>
          <StatusPill tone={info.tone} label={info.label} />
        </div>
        <ul className="meta">
          {v.type && <li>{v.type}</li>}
          <li>{venue.source === "manual" ? "Добавлена вручную" : venue.hostName ? `Привёл: ${venue.hostName}` : "По QR-анкете"}</li>
          <li>{new Date(venue.createdAt).toLocaleDateString("ru-RU")}</li>
        </ul>
        {twin && (
          <p className="notice small">
            Похоже на дубль: тот же телефон или адрес, что у <Link to={`/venues/v/${twin.id}`}>«{twin.data.name}»</Link>.
          </p>
        )}
        {v.about && <p>{v.about}</p>}
      </section>

      <section className="card">
        <StatusPicker label="Статус" options={VENUE_STATUSES} value={venue.status} disabled={busy} onChange={(status) => void run(() => venuesRepo!.update(venue.id, { status }), "Статус изменён")} />
        <div className="stack stack--tight">
          <span className="field__label">Наша оценка</span>
          <div className="rating" role="radiogroup" aria-label="Наша оценка">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                role="radio"
                aria-checked={venue.rating === star}
                aria-label={`${star} из 5`}
                className={`rating__star${(venue.rating ?? 0) >= star ? " rating__star--on" : ""}`}
                disabled={busy}
                onClick={() => void run(() => venuesRepo!.update(venue.id, { rating: venue.rating === star ? null : star }))}
              >
                ★
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span className="field__label">Наши заметки</span>
          <textarea value={notes} maxLength={2000} placeholder="Опыт работы: «звукорежиссёр Олег хорошо помогает»" onChange={(e) => setNotes(e.target.value)} />
        </label>
        {notes !== venue.notes && (
          <button className="btn btn--secondary btn--block" type="button" disabled={busy} onClick={() => void run(() => venuesRepo!.update(venue.id, { notes }), "Заметки сохранены")}>
            Сохранить заметки
          </button>
        )}
      </section>

      <section className="card">
        <h3>Связь</h3>
        <dl className="kv">
          <Row label="Контакт" value={[v.person, v.role].filter(Boolean).join(", ")} />
          <Row label="Телефон" value={v.phone && <a href={`tel:${v.phone.replace(/[^\d+]/g, "")}`}>{v.phone}</a>} />
          <Row label="Мессенджер" value={v.messenger} />
          <Row label="Почта" value={v.email && <a href={`mailto:${v.email}`}>{v.email}</a>} />
          <Row label="Сайт" value={v.site && <ExternalLink href={v.site} />} />
          <Row label="Адрес" value={[v.address, v.district, v.metro && `м. ${v.metro}`].filter(Boolean).join(", ")} />
        </dl>
      </section>

      <section className="card">
        <h3>Фото · {photos.length}</h3>
        {photos.length > 0 && (
          <div className="offer__photos">
            {photos.map((f, i) => (
              <figure key={f.sha} className="venue-photo">
                <a href={venuesRepo?.fileUrl(venue.id, f.sha)} target="_blank" rel="noreferrer">
                  <img src={venuesRepo?.fileUrl(venue.id, f.sha)} alt={`${v.name}, фото ${i + 1}`} loading="lazy" />
                </a>
                <button type="button" className="btn btn--quiet venue-photo__remove" disabled={busy} onClick={() => removeFile(f.sha, "Фото убрано")}>
                  Убрать
                </button>
              </figure>
            ))}
          </div>
        )}
        {v.album && (
          <p>
            Альбом: <ExternalLink href={v.album} />
          </p>
        )}
        {photos.length < VENUE_FILES.photo && (
          <FilePicker kind="photo" label="Добавить фото" max={VENUE_FILES.photo - photos.length} files={uploading.filter((f) => f.kind === "photo")} onChange={(files) => void upload(files)} />
        )}
      </section>

      <section className="card">
        <h3>Меню · {menus.length}</h3>
        {menus.length > 0 && (
          <ul className="list">
            {menus.map((f, i) => (
              <li key={f.sha}>
                <a href={venuesRepo?.fileUrl(venue.id, f.sha)} target="_blank" rel="noreferrer" className="line-clamp">
                  {f.name || `Меню ${i + 1}`} {f.mime === "application/pdf" ? "(PDF)" : "(фото)"}
                </a>
                <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => removeFile(f.sha, "Файл убран")}>
                  Убрать
                </button>
              </li>
            ))}
          </ul>
        )}
        {v.menuLink && (
          <p>
            Ссылка: <ExternalLink href={v.menuLink} />
          </p>
        )}
        {v.menuKinds.length > 0 && <p className="muted small">{v.menuKinds.join(", ")}</p>}
        {menus.length < VENUE_FILES.menu && (
          <FilePicker kind="menu" label="Добавить меню" max={VENUE_FILES.menu - menus.length} files={uploading.filter((f) => f.kind === "menu")} onChange={(files) => void upload(files)} />
        )}
      </section>

      <VenueFacts v={v} />

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button
          className="btn btn--secondary btn--block"
          type="button"
          onClick={() => {
            setDraft(venue.data);
            setEditing(true);
          }}
        >
          Изменить анкету
        </button>
        <button className="btn btn--quiet btn--block" type="button" onClick={() => setConfirmDelete(true)}>
          Удалить площадку
        </button>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title="Удалить площадку?"
        confirmLabel="Удалить площадку"
        busy={busy}
        error={error}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() =>
          void run(async () => {
            await venuesRepo!.remove(venue.id);
            navigate("/venues", { replace: true });
          })
        }
      >
        <p>Анкета, фото и меню удалятся из базы. Уже отправленные клиентам подборки продолжат открываться.</p>
      </ConfirmDialog>
      <Toast text={toast} />
    </>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  if (value === "" || value === null || value === undefined || value === false) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function ExternalLink({ href }: { href: string }) {
  const url = /^https?:\/\//i.test(href) ? href : `https://${href}`;
  let safe = "";
  try {
    const parsed = new URL(url);
    safe = parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : "";
  } catch {
    safe = "";
  }
  return safe ? (
    <a href={safe} target="_blank" rel="noreferrer noopener" className="line-clamp">
      {href}
    </a>
  ) : (
    <span>{href}</span>
  );
}

const yesNo = (b: boolean) => (b ? "да" : "нет");
const num = (n: number | null, suffix = "") => (n === null ? "" : `${n.toLocaleString("ru-RU")}${suffix}`);

function VenueFacts({ v }: { v: VenueData }) {
  const equipment = Object.entries(v.equipment).map(([name, count]) => `${name} — ${count}`);
  return (
    <>
      <section className="card">
        <h3>Гости и залы</h3>
        <dl className="kv">
          <Row label="Банкет, сидя" value={num(v.seated)} />
          <Row label="Фуршет, стоя" value={num(v.standing)} />
          <Row label="Залов" value={num(v.halls)} />
          <Row label="Минимум гостей" value={num(v.minGuests)} />
          <Row label="Веранда" value={v.terrace ? [num(v.terraceSeats, " мест"), v.terraceSeason].filter(Boolean).join(", ") || "есть" : "нет"} />
          <Row label="VIP-зал" value={v.vip ? num(v.vipSeats, " мест") || "есть" : "нет"} />
          <Row label="Танцпол" value={yesNo(v.dance)} />
          <Row label="Мебель" value={v.furniture} />
          <Row label="Рассадка" value={v.layouts.join(", ")} />
        </dl>
      </section>
      <section className="card">
        <h3>Особенности</h3>
        <dl className="kv">
          <Row label="Что есть" value={v.features.join(", ")} />
          <Row label="Где" value={v.location} />
          <Row label="Громкость" value={v.loudness} />
          <Row label="Парковка" value={[v.parking, num(v.parkingSpots, " мест")].filter(Boolean).join(", ")} />
          <Row label="Разгрузка у входа" value={yesNo(v.unload)} />
        </dl>
      </section>
      <section className="card">
        <h3>Кухня и деньги</h3>
        <dl className="kv">
          <Row label="Кухня" value={v.cuisine.join(", ")} />
          <Row label="В меню есть" value={v.diet.join(", ")} />
          <Row label="Банкет на гостя от" value={num(v.perGuest, " ₽")} />
          <Row label="Депозит" value={num(v.deposit, " ₽")} />
          <Row label="Сервисный сбор" value={num(v.service, "%")} />
          <Row label="Свой алкоголь" value={[v.alcohol, num(v.corkage, " ₽ за бутылку")].filter(Boolean).join(", ")} />
          <Row label="Можно своё" value={v.ownItems.join(", ")} />
          <Row label="Оплата" value={v.pay.join(", ")} />
        </dl>
      </section>
      <section className="card">
        <h3>Техника</h3>
        <dl className="kv">
          <Row label="Оборудование" value={equipment.join("; ")} />
          <Row label="Подключение" value={v.connections.join(", ")} />
          <Row label="Своя техника" value={v.ownTech ? "можно" : "нельзя"} />
          <Row label="Техник на площадке" value={yesNo(v.technician)} />
        </dl>
      </section>
      <section className="card">
        <h3>Условия</h3>
        <dl className="kv">
          <Row label="В один день" value={v.parallel} />
          <Row label="Разрешено" value={v.fx.join(", ")} />
          <Row label="Наши подрядчики" value={v.contractors} />
          <Row label="Монтаж" value={v.setup} />
          <Row label="Закрывают под нас" value={v.close} />
          <Row label="Можно до" value={v.until} />
          <Row label="Агентства" value={[v.agency, num(v.commission, "%")].filter(Boolean).join(", ")} />
        </dl>
      </section>
    </>
  );
}
