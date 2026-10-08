/**
 * Кабинет «База площадок» (`/venues`): вкладки «Площадки», «Заявки клиентов», «QR-коды».
 * Владелец и ведущие, которым он открыл доступ (`permissions.canManageVenues`).
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  findDuplicates,
  formatEventDate,
  formatLabel,
  REQUEST_STATUSES,
  requestStatusInfo,
  statusOrder,
  VENUE_STATUSES,
  venueStatusInfo,
  type StatusTone,
  type VenueData,
} from "../../core/venues";
import { permissions, useLoad, venuesRepo, type UserProfile, type VenueRecord, type VenueRequestRecord } from "../../data";
import { useConfirm } from "../../components/ConfirmDialog";
import { HostGate } from "../../components/HostGate";
import { ListSkeleton, StudioSkeleton } from "../../components/Skeleton";
import { LoadFailedInline, Message } from "../../components/Status";
import { Tabs } from "../../components/Tabs";
import { SearchField } from "../../components/SearchField";
import { matchesSearch } from "../../core/search";
import { TopBar } from "../../components/TopBar";
import { StatusPill, statusColor } from "../../components/venues/Fields";
import { VenueQr } from "../../components/venues/VenueQr";
import { studioActions } from "../studio/Studio";

type TabId = "venues" | "forms" | "requests" | "archive" | "qr";

/** Ворота кабинета: вход, доступ к базе, свой сервер. */
export function VenuesGate({ children }: { children: (profile: UserProfile, uid: string) => ReactNode }) {
  return (
    <HostGate skeleton={<StudioSkeleton />}>
      {(user, profile) => {
        if (!venuesRepo) {
          return (
            <Message title="База площадок">
              <p>База площадок работает на своём сервере JoyRest.</p>
            </Message>
          );
        }
        if (!permissions.canManageVenues(profile)) {
          return (
            <Message title="Нет доступа к базе площадок">
              <p>Базу и заявки клиентов видит владелец агентства. Попросите его открыть вам доступ. QR-коды анкет есть у вас в студии.</p>
              <div className="actions">
                <Link className="btn btn--block" to="/studio/qr">
                  QR-анкеты
                </Link>
                <Link className="btn btn--secondary btn--block" to="/studio">
                  В студию
                </Link>
              </div>
            </Message>
          );
        }
        return children(profile, user.uid);
      }}
    </HostGate>
  );
}

export function venueActions(profile: UserProfile) {
  return [{ label: "В студию", to: "/studio" }, ...studioActions(profile)];
}

export function VenuesHome() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: TabId = raw === "requests" || raw === "qr" || raw === "forms" || raw === "archive" ? raw : "venues";
  const setTab = (next: TabId) => setParams(next === "venues" ? {} : { tab: next }, { replace: true });

  return (
    <VenuesGate>
      {(profile, uid) => (
        <main className="page page--wide">
          <TopBar title="База площадок" actions={venueActions(profile)} />
          <Tabs
            idPrefix="venues"
            label="Разделы базы площадок"
            scroll
            value={tab}
            onChange={setTab}
            items={[
              { id: "venues", label: "Площадки" },
              { id: "forms", label: "Анкеты заведений" },
              { id: "requests", label: "Заявки клиентов" },
              ...(permissions.canArchiveVenues(profile) ? [{ id: "archive" as const, label: "Архив" }] : []),
              { id: "qr", label: "QR-коды" },
            ]}
          />
          <div id={`venues-panel-${tab}`} role="tabpanel" aria-labelledby={`venues-tab-${tab}`} className="stack">
            {tab === "venues" && <VenuesTab mode="base" owner={permissions.isAdmin(profile)} />}
            {tab === "forms" && <VenuesTab mode="forms" owner={permissions.isAdmin(profile)} />}
            {tab === "requests" && <RequestsTab />}
            {tab === "archive" && permissions.canArchiveVenues(profile) && <ArchiveTab />}
            {tab === "qr" && <VenueQr uid={uid} />}
          </div>
        </main>
      )}
    </VenuesGate>
  );
}

// ------------------------------------------------------------------ фильтры

function StatusFilter<Id extends string>({
  options,
  counts,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ id: Id; label: string; tone: StatusTone }>;
  counts: Record<string, number>;
  value: Id | "all";
  onChange: (value: Id | "all") => void;
}) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const item = (id: Id | "all", label: string, count: number, color: string | null) => (
    <button key={id} type="button" className="status-opt" aria-pressed={value === id} onClick={() => onChange(value === id && id !== "all" ? "all" : id)}>
      <span className="status-opt__dot" style={color ? ({ "--dot": color } as CSSProperties) : undefined} aria-hidden="true" />
      <span className="status-opt__label">{label}</span>
      <span className="status-opt__count">{count}</span>
    </button>
  );
  return (
    <div className="filter-group">
      <p className="filter-group__label">Статус</p>
      <div className="status-grid" role="group" aria-label="Показать по статусу">
        {item("all", "Все", total, null)}
        {options.map((o) => item(o.id, o.label, counts[o.id] ?? 0, statusColor(o.tone)))}
      </div>
    </div>
  );
}

function SortSelect<Id extends string>({ options, value, onChange }: { options: ReadonlyArray<{ id: Id; label: string }>; value: Id; onChange: (id: Id) => void }) {
  return (
    <label className="field sort-select">
      <span className="field__label">Сортировка</span>
      <select value={value} onChange={(e) => onChange(e.target.value as Id)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const dateTime = (ms: number) =>
  ms ? new Date(ms).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

function useParam<T extends string>(name: string, allowed: readonly T[], fallback: T): [T, (value: T) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get(name);
  const value = allowed.find((a) => a === raw) ?? fallback;
  const set = (next: T) => {
    const copy = new URLSearchParams(params);
    if (next === fallback) copy.delete(name);
    else copy.set(name, next);
    setParams(copy, { replace: true });
  };
  return [value, set];
}

// ------------------------------------------------------------------ площадки

const VENUE_SORTS = [
  { id: "new", label: "Сначала новые" },
  { id: "old", label: "Сначала старые" },
  { id: "status", label: "По статусу" },
  { id: "name", label: "По названию" },
  { id: "capacity", label: "По вместимости" },
] as const;

type ColumnGroup = "contacts" | "space" | "tech" | "terms" | "ours";
const GROUPS: Array<{ id: ColumnGroup; label: string }> = [
  { id: "contacts", label: "Контакты" },
  { id: "space", label: "Пространство" },
  { id: "tech", label: "Техника" },
  { id: "terms", label: "Условия" },
  { id: "ours", label: "Служебное" },
];

interface Column {
  label: string;
  group: ColumnGroup | "main";
  num?: boolean;
  value: (v: VenueRecord) => ReactNode;
}

const yes = (b: boolean) => (b ? "да" : "—");
const list = (items: string[]) => (items.length ? items.join(", ") : "—");
const n = (x: number | null) => (x === null ? "—" : x.toLocaleString("ru-RU"));
const t = (x: string) => x || "—";
const equipmentList = (v: VenueData) => {
  const items = Object.entries(v.equipment).map(([name, count]) => `${name}${count > 1 ? ` ×${count}` : ""}`);
  return items.length ? items.join(", ") : "—";
};

const COLUMNS: Column[] = [
  { label: "Тип", group: "main", value: (v) => t(v.data.type) },
  { label: "Где", group: "main", value: (v) => t([v.data.district, v.data.metro && `м. ${v.data.metro}`].filter(Boolean).join(", ")) },
  { label: "Сидя", group: "main", num: true, value: (v) => n(v.data.seated) },
  { label: "Стоя", group: "main", num: true, value: (v) => n(v.data.standing) },
  { label: "Банкет от, ₽", group: "main", num: true, value: (v) => n(v.data.perGuest) },
  { label: "Добавлена", group: "main", value: (v) => dateTime(v.createdAt) },
  { label: "Контакт", group: "contacts", value: (v) => t([v.data.person, v.data.role].filter(Boolean).join(", ")) },
  { label: "Телефон", group: "contacts", value: (v) => (v.data.phone ? <a href={`tel:${v.data.phone.replace(/[^\d+]/g, "")}`} onClick={(e) => e.stopPropagation()}>{v.data.phone}</a> : "—") },
  { label: "Мессенджер", group: "contacts", value: (v) => t(v.data.messenger) },
  { label: "Адрес", group: "contacts", value: (v) => t(v.data.address) },
  { label: "Залов", group: "space", num: true, value: (v) => n(v.data.halls) },
  { label: "Мин. гостей", group: "space", num: true, value: (v) => n(v.data.minGuests) },
  { label: "Веранда", group: "space", value: (v) => (v.data.terrace ? `да${v.data.terraceSeats ? `, ${v.data.terraceSeats}` : ""}` : "—") },
  { label: "Танцпол", group: "space", value: (v) => yes(v.data.dance) },
  { label: "Мебель", group: "space", value: (v) => t(v.data.furniture) },
  { label: "Рассадка", group: "space", value: (v) => list(v.data.layouts) },
  { label: "Особенности", group: "space", value: (v) => list(v.data.features) },
  { label: "Оборудование", group: "tech", value: (v) => equipmentList(v.data) },
  { label: "Подключение", group: "tech", value: (v) => list(v.data.connections) },
  { label: "Своя техника", group: "tech", value: (v) => yes(v.data.ownTech) },
  { label: "Кухня", group: "terms", value: (v) => list(v.data.cuisine) },
  { label: "Алкоголь", group: "terms", value: (v) => t(v.data.alcohol) },
  { label: "До", group: "terms", value: (v) => t(v.data.until) },
  { label: "Закрывают", group: "terms", value: (v) => t(v.data.close) },
  { label: "Подрядчики", group: "terms", value: (v) => t(v.data.contractors) },
  { label: "Депозит, ₽", group: "terms", num: true, value: (v) => n(v.data.deposit) },
  { label: "Оценка", group: "ours", value: (v) => (v.rating ? "★".repeat(v.rating) : "—") },
  { label: "Привёл", group: "ours", value: (v) => (v.source === "manual" ? "вручную" : t(v.hostName ?? "")) },
  { label: "Фото", group: "ours", num: true, value: (v) => v.files.filter((f) => f.kind === "photo").length },
  { label: "Заметки", group: "ours", value: (v) => <span className="cell-wide">{t(v.notes)}</span> },
];

/** Анкета с QR, которую ещё не проверили: она в «Анкетах заведений», в базе её пока нет. */
export function awaitsReview(v: VenueRecord): boolean {
  return v.source === "form" && v.status === "new" && v.archivedAt === null;
}

function venueSearchParts(v: VenueRecord): string[] {
  const d = v.data;
  return [d.name, d.type, d.district, d.metro, d.location, d.address, d.about, d.person, d.phone, d.email, d.messenger, d.site, ...d.cuisine, ...d.features, v.notes, v.hostName ?? ""];
}

function VenuesTab({ mode, owner }: { mode: "base" | "forms"; owner: boolean }) {
  const navigate = useNavigate();
  const [state, retry, update] = useLoad(() => (venuesRepo ? venuesRepo.list() : Promise.resolve([] as VenueRecord[])), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useParam("status", ["all", ...VENUE_STATUSES.map((s) => s.id)] as const, "all");
  const [sort, setSort] = useParam("sort", VENUE_SORTS.map((s) => s.id), "new");
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const shown = new Set((params.get("cols") ?? "").split(",").filter(Boolean));

  const all = state.status === "ready" ? state.data : [];
  const venues = useMemo(() => all.filter((v) => v.archivedAt === null && (mode === "forms" ? awaitsReview(v) : !awaitsReview(v))), [all, mode]);
  const duplicates = useMemo(() => findDuplicates(all.filter((v) => v.archivedAt === null)), [all]);
  const [dialog, confirm] = useConfirm();
  const nameOfAll = useMemo(() => new Map(all.map((v) => [v.id, v.data.name])), [all]);
  const suggestions = useMemo(() => venues.flatMap((v) => [v.data.name, v.data.metro, v.data.district, v.data.type, v.data.location]), [venues]);
  const nameOf = nameOfAll;
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of venues) c[v.status] = (c[v.status] ?? 0) + 1;
    return c;
  }, [venues]);

  const rows = useMemo(() => {
    const filtered = venues.filter((v) => (mode === "forms" || status === "all" || v.status === status) && matchesSearch(venueSearchParts(v), query));
    const capacity = (v: VenueRecord) => Math.max(v.data.seated ?? 0, v.data.standing ?? 0);
    return [...filtered].sort((a, b) => {
      if (sort === "old") return a.createdAt - b.createdAt;
      if (sort === "name") return a.data.name.localeCompare(b.data.name, "ru");
      if (sort === "capacity") return capacity(b) - capacity(a);
      if (sort === "status") return statusOrder(VENUE_STATUSES, a.status) - statusOrder(VENUE_STATUSES, b.status) || b.createdAt - a.createdAt;
      return b.createdAt - a.createdAt;
    });
  }, [venues, status, sort, query, mode]);

  /** Модерация анкеты: в базу («Проверено») или «Не подходит» — только после подтверждения. */
  function review(v: VenueRecord, next: "checked" | "rejected") {
    const repo = venuesRepo;
    if (!repo || busy) return;
    const name = v.data.name || "Без названия";
    confirm({
      title: next === "checked" ? `Принять «${name}» в базу?` : `«${name}» не подходит?`,
      text:
        next === "checked"
          ? `Площадка перейдёт в «Площадки» со статусом «Проверено».${v.hostName && owner ? ` Ведущему ${v.hostName} начислятся баллы за то, что он её привёл.` : ""}`
          : "Анкета уйдёт в «Площадки» со статусом «Не подходит» и не попадёт в подбор. Статус можно поменять в карточке.",
      confirmLabel: next === "checked" ? "Принять в базу" : "Не подходит",
      run: async () => {
        setBusy(v.id);
        try {
          const saved = await repo.update(v.id, { status: next });
          update((list) => list.map((x) => (x.id === v.id ? saved : x)));
        } finally {
          setBusy(null);
        }
      },
    });
  }

  function setParam(name: string, value: string) {
    const copy = new URLSearchParams(params);
    if (value) copy.set(name, value);
    else copy.delete(name);
    setParams(copy, { replace: true });
  }

  function toggleGroup(id: ColumnGroup) {
    const next = new Set(shown);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setParam("cols", [...next].join(","));
  }

  if (state.status === "loading") return <ListSkeleton />;
  if (state.status === "error") return <LoadFailedInline onRetry={retry} />;
  const columns = COLUMNS.filter((c) => c.group === "main" || shown.has(c.group));

  return (
    <>
      {mode === "forms" && (
        <p className="muted">Анкеты, которые заведения заполнили по QR-коду. Проверьте и примите в базу или отметьте «Не подходит».</p>
      )}
      <section className="card venues-filters" aria-label="Поиск и фильтры">
        <div className="venues-toolbar">
          <div className="venues-search">
            <SearchField label="Поиск" value={query} placeholder="название, метро, район, телефон" candidates={suggestions} onChange={(value) => setParam("q", value)} />
          </div>
          <SortSelect options={VENUE_SORTS} value={sort} onChange={setSort} />
        </div>
        {mode === "base" && <StatusFilter options={VENUE_STATUSES} counts={counts} value={status} onChange={setStatus} />}
        {mode === "base" && (
          <div className="filter-group">
            <p className="filter-group__label">Колонки таблицы</p>
            <div className="column-grid" role="group" aria-label="Показать колонки">
              {GROUPS.map((g) => (
                <button key={g.id} type="button" className="column-opt" aria-pressed={shown.has(g.id)} onClick={() => toggleGroup(g.id)}>
                  <span className="column-opt__check" aria-hidden="true">{shown.has(g.id) ? "✓" : ""}</span>
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
      {mode === "forms" ? (
        venues.length === 0 ? (
          <section className="card card--center">
            <h2>Новых анкет нет</h2>
            <p className="muted">Покажите администратору заведения QR-код «Для заведения» — анкета появится здесь на проверку.</p>
          </section>
        ) : rows.length === 0 ? (
          <p className="muted empty">Ничего не нашлось. Сбросьте поиск.</p>
        ) : (
          <ul className="request-list">
            {rows.map((v) => {
              const twin = duplicates.get(v.id);
              const capacity = [v.data.seated ? `${v.data.seated} сидя` : "", v.data.standing ? `${v.data.standing} фуршет` : ""].filter(Boolean).join(" · ");
              return (
                <li key={v.id} className="card venue-form-card">
                  <Link to={`/venues/v/${v.id}`} className="venue-form-card__title">
                    {v.data.name || "Без названия"}
                  </Link>
                  <p className="muted small">
                    {[v.data.type, v.data.metro ? `м. ${v.data.metro}` : v.data.district, capacity, dateTime(v.createdAt), v.hostName ? `привёл: ${v.hostName}` : ""].filter(Boolean).join(" · ")}
                  </p>
                  {twin && <span className="dup-badge">похоже на «{nameOf.get(twin) ?? "…"}» — проверьте, не дубль ли</span>}
                  <div className="actions actions--row">
                    <button type="button" className="btn" disabled={busy === v.id} onClick={() => void review(v, "checked")}>
                      Принять в базу
                    </button>
                    <button type="button" className="btn btn--secondary" disabled={busy === v.id} onClick={() => void review(v, "rejected")}>
                      Не подходит
                    </button>
                    <Link className="btn btn--quiet" to={`/venues/v/${v.id}`}>
                      Открыть анкету
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : (
      <>
      <div className="actions">
        <Link className="btn btn--secondary btn--block" to="/venues/new">
          + Добавить площадку вручную
        </Link>
      </div>
      {venues.length === 0 ? (
        <section className="card card--center">
          <h2>Площадок пока нет</h2>
          <p className="muted">Анкеты заведений по QR-коду сначала попадают в «Анкеты заведений», после проверки — сюда. Площадку можно добавить и вручную.</p>
        </section>
      ) : rows.length === 0 ? (
        <p className="muted empty">Ничего не нашлось. Сбросьте поиск или фильтр.</p>
      ) : (
        <div className="table-box" tabIndex={0} aria-label="Таблица площадок, прокручивается вбок">
          <table className="venue-table">
            <thead>
              <tr>
                <th className="sticky-col">Название</th>
                <th>Статус</th>
                {columns.map((c) => (
                  <th key={c.label} className={c.num ? "num" : undefined}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const info = venueStatusInfo(v.status);
                const twin = duplicates.get(v.id);
                return (
                  <tr key={v.id} onClick={() => navigate(`/venues/v/${v.id}`)}>
                    <td className="sticky-col">
                      <Link to={`/venues/v/${v.id}`} className="venue-table__name" onClick={(e) => e.stopPropagation()}>
                        {v.data.name || "Без названия"}
                      </Link>
                      {twin && <span className="dup-badge">похоже на «{nameOf.get(twin) ?? "…"}»</span>}
                    </td>
                    <td>
                      <StatusPill tone={info.tone} label={info.label} />
                    </td>
                    {columns.map((c) => (
                      <td key={c.label} className={c.num ? "num" : undefined}>
                        {c.value(v)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">Нажмите на строку, чтобы открыть карточку площадки. Таблица прокручивается вбок.</p>
      </>
      )}
      {dialog}
    </>
  );
}

// ------------------------------------------------------------------ заявки

const REQUEST_SORTS = [
  { id: "new", label: "Сначала новые" },
  { id: "old", label: "Сначала старые" },
  { id: "status", label: "По статусу" },
  { id: "date", label: "По дате праздника" },
] as const;

function RequestsTab() {
  const [state, retry] = useLoad(() => (venuesRepo ? venuesRepo.listRequests() : Promise.resolve([] as VenueRequestRecord[])), []);
  const [status, setStatus] = useParam("status", ["all", ...REQUEST_STATUSES.map((s) => s.id)] as const, "all");
  const [sort, setSort] = useParam("sort", REQUEST_SORTS.map((s) => s.id), "new");
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const requests = useMemo(() => (state.status === "ready" ? state.data.filter((r) => r.archivedAt === null) : []), [state]);
  const suggestions = useMemo(() => requests.flatMap((r) => [r.data.name, r.data.eventType, r.data.district, `№${r.number}`]), [requests]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of requests) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [requests]);
  const rows = useMemo(() => {
    const filtered = requests.filter(
      (r) =>
        (status === "all" || r.status === status) &&
        matchesSearch([`№${r.number}`, String(r.number), r.data.name, r.data.phone, r.data.eventType, r.data.district, r.data.comment, r.notes, r.hostName ?? ""], query),
    );
    return [...filtered].sort((a, b) => {
      if (sort === "old") return a.createdAt - b.createdAt;
      if (sort === "status") return statusOrder(REQUEST_STATUSES, a.status) - statusOrder(REQUEST_STATUSES, b.status) || b.createdAt - a.createdAt;
      if (sort === "date") return (a.data.date || "9999").localeCompare(b.data.date || "9999") || b.createdAt - a.createdAt;
      return b.createdAt - a.createdAt;
    });
  }, [requests, status, sort, query]);

  if (state.status === "loading") return <ListSkeleton />;
  if (state.status === "error") return <LoadFailedInline onRetry={retry} />;

  return (
    <>
      <section className="card venues-filters" aria-label="Поиск и фильтры">
      <div className="venues-toolbar">
        <div className="venues-search">
          <SearchField
            label="Поиск"
            value={query}
            placeholder="номер, имя, телефон, событие"
            candidates={suggestions}
            onChange={(value) => {
              const copy = new URLSearchParams(params);
              if (value) copy.set("q", value);
              else copy.delete("q");
              setParams(copy, { replace: true });
            }}
          />
        </div>
        <SortSelect options={REQUEST_SORTS} value={sort} onChange={setSort} />
      </div>
      <StatusFilter options={REQUEST_STATUSES} counts={counts} value={status} onChange={setStatus} />
      </section>
      {requests.length === 0 ? (
        <section className="card card--center">
          <h2>Заявок пока нет</h2>
          <p className="muted">Дайте клиенту QR-код «Для клиента» — его заявка появится здесь с номером.</p>
        </section>
      ) : rows.length === 0 ? (
        <p className="muted empty">Ничего не нашлось. Сбросьте поиск или фильтр.</p>
      ) : (
        <ul className="request-list">
          {rows.map((r) => (
            <RequestRow key={r.id} request={r} />
          ))}
        </ul>
      )}
    </>
  );
}

function RequestRow({ request: r }: { request: VenueRequestRecord }) {
  const info = requestStatusInfo(r.status);
  const what = [r.data.eventType || "Мероприятие", r.data.guests ? `${r.data.guests} гостей` : "", formatLabel(r.data.format), formatEventDate(r.data.date)]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="card request-card">
      <div className="request-card__head">
        <Link to={`/venues/r/${r.id}`} className="request-card__number">
          №{r.number}
        </Link>
        <StatusPill tone={info.tone} label={info.label} />
      </div>
      <p className="request-card__name">{r.data.name}</p>
      {r.data.phone && (
        <a className="request-card__phone" href={`tel:${r.data.phone.replace(/[^\d+]/g, "")}`}>
          {r.data.phone}
        </a>
      )}
      <p>{what}</p>
      <ul className="meta">
        <li>{dateTime(r.createdAt)}</li>
        {r.hostName && <li>Привёл: {r.hostName}</li>}
        {r.offers > 0 && <li>Предложений: {r.offers}</li>}
      </ul>
      <Link className="btn btn--block" to={`/venues/r/${r.id}`}>
        Открыть и подобрать площадки
      </Link>
    </li>
  );
}

// ------------------------------------------------------------------ архив

/**
 * Архив: площадки, анкеты и заявки, которые «удалили». Не стираются навсегда — их можно открыть
 * и вернуть (после подтверждения).
 */
function ArchiveTab() {
  const [venues, retryVenues, updateVenues] = useLoad(() => (venuesRepo ? venuesRepo.list() : Promise.resolve([] as VenueRecord[])), []);
  const [requests, retryRequests, updateRequests] = useLoad(() => (venuesRepo ? venuesRepo.listRequests() : Promise.resolve([] as VenueRequestRecord[])), []);
  const [dialog, confirm] = useConfirm();
  if (venues.status === "loading" || requests.status === "loading") return <ListSkeleton />;
  if (venues.status === "error") return <LoadFailedInline onRetry={retryVenues} />;
  if (requests.status === "error") return <LoadFailedInline onRetry={retryRequests} />;
  const byDate = <T extends { archivedAt: number | null }>(a: T, b: T) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0);
  const archivedVenues = venues.data.filter((v) => v.archivedAt !== null).sort(byDate);
  const archivedRequests = requests.data.filter((r) => r.archivedAt !== null).sort(byDate);

  function restoreVenue(v: VenueRecord) {
    const repo = venuesRepo;
    if (!repo) return;
    confirm({
      title: `Вернуть «${v.data.name || "Без названия"}» из архива?`,
      text: "Площадка снова появится в базе и в подборе.",
      confirmLabel: "Вернуть из архива",
      run: async () => {
        const saved = await repo.restore(v.id);
        updateVenues((list) => list.map((x) => (x.id === v.id ? saved : x)));
      },
    });
  }

  function restoreRequest(r: VenueRequestRecord) {
    const repo = venuesRepo;
    if (!repo) return;
    confirm({
      title: `Вернуть заявку №${r.number} из архива?`,
      text: "Она снова появится во вкладке «Заявки клиентов».",
      confirmLabel: "Вернуть из архива",
      run: async () => {
        const saved = await repo.restoreRequest(r.id);
        updateRequests((list) => list.map((x) => (x.id === r.id ? saved : x)));
      },
    });
  }

  return (
    <>
      <p className="muted">Сюда попадает всё, что убрали кнопкой «Убрать в архив». Ничего не стирается: откройте или верните на место.</p>
      <section className="stack">
        <h2>Площадки и анкеты · {archivedVenues.length}</h2>
        {archivedVenues.length === 0 ? (
          <p className="muted empty">В архиве площадок нет.</p>
        ) : (
          <ul className="request-list">
            {archivedVenues.map((v) => (
              <li key={v.id} className="card venue-form-card">
                <Link to={`/venues/v/${v.id}`} className="venue-form-card__title">
                  {v.data.name || "Без названия"}
                </Link>
                <p className="muted small">
                  {[v.data.type, v.data.metro ? `м. ${v.data.metro}` : v.data.district, venueStatusInfo(v.status).label, `в архиве с ${dateTime(v.archivedAt ?? 0)}`].filter(Boolean).join(" · ")}
                </p>
                <div className="actions actions--row">
                  <button type="button" className="btn btn--secondary" onClick={() => restoreVenue(v)}>
                    Вернуть из архива
                  </button>
                  <Link className="btn btn--quiet" to={`/venues/v/${v.id}`}>
                    Открыть
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="stack">
        <h2>Заявки клиентов · {archivedRequests.length}</h2>
        {archivedRequests.length === 0 ? (
          <p className="muted empty">В архиве заявок нет.</p>
        ) : (
          <ul className="request-list">
            {archivedRequests.map((r) => (
              <li key={r.id} className="card venue-form-card">
                <Link to={`/venues/r/${r.id}`} className="venue-form-card__title">
                  Заявка №{r.number} · {r.data.name}
                </Link>
                <p className="muted small">{[r.data.eventType, r.data.guests ? `${r.data.guests} гостей` : "", `в архиве с ${dateTime(r.archivedAt ?? 0)}`].filter(Boolean).join(" · ")}</p>
                <div className="actions actions--row">
                  <button type="button" className="btn btn--secondary" onClick={() => restoreRequest(r)}>
                    Вернуть из архива
                  </button>
                  <Link className="btn btn--quiet" to={`/venues/r/${r.id}`}>
                    Открыть
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {dialog}
    </>
  );
}
