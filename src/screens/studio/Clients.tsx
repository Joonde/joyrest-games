/**
 * База клиентов (CLAUDE.md, раздел 3, «База клиентов»; решение владельца 14 октября 2026) — владелец и менеджер по
 * продажам (роль `sales`, решение 15 октября 2026); выгрузка, «Данные по номеру» и согласие «да» — только владелец.
 * Сюда сами попадают все, кто оставил заявку или вопрос на сайте, запрос по QR, записан в планировщик или переслан
 * боту в Telegram. Один человек — одна карточка (по телефону). Выгрузка для рассылки — только согласившиеся.
 */
import { useMemo, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  CLIENT_LIMITS,
  CLIENT_STATUS_TITLES,
  CLIENT_STATUSES,
  linkTitle,
  MARKETING_TITLES,
  parseLinks,
  phoneKey,
  phoneLabel,
  SOURCE_TITLES,
  type ClientSource,
  type ClientStatus,
  type Marketing,
} from "../../core/clients";
import { matchesSearch } from "../../core/search";
import { clientsRepo, permissions, useLoad, type ClientDetails, type ClientRecord, type UserProfile } from "../../data";
import { useConfirm } from "../../components/ConfirmDialog";
import { HostGate } from "../../components/HostGate";
import { SearchField } from "../../components/SearchField";
import { ListSkeleton, StudioSkeleton } from "../../components/Skeleton";
import { LoadFailedInline } from "../../components/Status";
import { TelegramConnect } from "../../components/TelegramConnect";
import { Toast, useToast } from "../../components/Toast";
import { TopBar } from "../../components/TopBar";
import { brand } from "../../themes/brand";
import { newId, Pill, useLastReady } from "./calendarParts";
import { studioActions } from "./Studio";

type Filter = "all" | ClientStatus | "mailing" | "archive";
const FILTER_TITLES: Record<Filter, string> = {
  all: "Все",
  new: "Новые",
  work: "В работе",
  client: "Клиенты",
  lost: "Отказ",
  mailing: "Рассылка",
  archive: "Архив",
};
const STATUS_COLORS: Record<ClientStatus, string> = { new: brand.gold, work: brand.lavender, client: brand.sage, lost: brand.coral };

const dateLabel = (ms: number) => new Date(ms).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" });
const sourceTitle = (s: string) => SOURCE_TITLES[s as ClientSource] ?? s;

export function Clients() {
  return (
    <HostGate skeleton={<StudioSkeleton />}>
      {(_user, profile) => (
        <main className="page">
          <TopBar title="Клиенты" actions={[{ label: "В студию", to: "/studio" }, ...studioActions(profile)]} />
          {!clientsRepo ? (
            <p className="muted">База клиентов доступна на своём сервере JoyRest.</p>
          ) : !permissions.canManageClients(profile) ? (
            <p className="muted">База клиентов открыта владельцу агентства и менеджеру по продажам.</p>
          ) : (
            <ClientBase profile={profile} />
          )}
        </main>
      )}
    </HostGate>
  );
}

function ClientBase({ profile }: { profile: UserProfile }) {
  const owner = permissions.canExportClients(profile);
  const [filter, setFilter] = useState<Filter>("all");
  const archived = filter === "archive";
  const [state, retry, update] = useLoad(() => (clientsRepo ? clientsRepo.list(archived) : Promise.resolve([] as ClientRecord[])), [archived]);
  const shown = useLastReady(state);
  const [params] = useSearchParams();
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const [form, setForm] = useState<ClientRecord | "new" | null>(null);
  const [toast, showToast] = useToast();
  const [confirm, ask] = useConfirm();

  const list = useMemo(() => {
    const all = (shown ?? []).filter((c) => c.archived === archived);
    const byFilter = all.filter((c) => (filter === "all" || filter === "archive" ? true : filter === "mailing" ? c.marketing === "yes" : c.status === filter));
    return query.trim() ? byFilter.filter((c) => matchesSearch([c.name, c.phone, phoneKey(c.phone), c.notes, ...c.links], query)) : byFilter;
  }, [shown, filter, query, archived]);
  const candidates = useMemo(() => [...new Set((shown ?? []).map((c) => c.name).filter(Boolean))], [shown]);
  const consented = (shown ?? []).filter((c) => !c.archived && c.marketing === "yes").length;

  function saved(c: ClientRecord, text: string) {
    update((data) => [c, ...data.filter((x) => x.id !== c.id)]);
    setForm(null);
    showToast(text);
  }

  function toggleArchive(c: ClientRecord) {
    ask({
      title: c.archived ? `Вернуть «${c.name || phoneLabel(c.phone) || "клиента"}» из архива?` : `Убрать «${c.name || phoneLabel(c.phone) || "клиента"}» в архив?`,
      text: c.archived ? "Клиент снова будет в общем списке." : "Клиент пропадёт из списка и выгрузки для рассылки. Ничего не стирается — вернуть можно из «Архива». Новая заявка вернёт его сама.",
      confirmLabel: c.archived ? "Вернуть" : "В архив",
      run: async () => {
        if (!clientsRepo) return;
        if (c.archived) await clientsRepo.restore(c.id);
        else await clientsRepo.archive(c.id);
        update((data) => data.filter((x) => x.id !== c.id));
        showToast(c.archived ? "Клиент возвращён" : "Клиент в архиве");
      },
    });
  }

  if (form) {
    return (
      <ClientForm
        initial={form === "new" ? null : form}
        canConsent={permissions.canSetMarketingConsent(profile)}
        onCancel={() => setForm(null)}
        onSaved={(c) => saved(c, form === "new" ? "Клиент добавлен" : "Сохранено")}
      />
    );
  }

  return (
    <>
      <p className="muted">
        Сюда сами попадают все, кто оставил заявку или вопрос на сайте, запрос по QR-анкете, записан в планировщик мероприятий или кого вы переслали
        боту в Telegram — даже если мероприятия не было. Один человек — одна карточка (по телефону). Подбор площадок по запросу клиента — в{" "}
        <Link to="/venues">базе площадок</Link> («Заявки клиентов»), из истории клиента — одним касанием.
      </p>
      <div className="actions">
        <button type="button" className="btn btn--block" onClick={() => setForm("new")}>
          + Клиент
        </button>
        {owner && clientsRepo && (
          <a className="btn btn--secondary btn--block" href={clientsRepo.exportUrl(false)} download>
            Выгрузить для рассылки ({consented})
          </a>
        )}
      </div>
      {owner ? (
        <>
          <p className="muted small">
            В выгрузку для рассылки попадают только согласившиеся: по закону о рекламе рассылать можно только тем, кто сам дал согласие. Таблица
            открывается в Excel и Google Таблицах.{" "}
            {clientsRepo && (
              <a href={clientsRepo.exportUrl(true)} download>
                Выгрузить всех (для своей работы)
              </a>
            )}
          </p>
          <p className="muted small">
            Человек попросил удалить свои данные? <Link to="/studio/privacy">Данные по номеру →</Link> — всё о нём в базе и удаление навсегда.
          </p>
        </>
      ) : (
        <p className="muted small">
          Как вести клиента от заявки до мероприятия — <Link to="/studio/sales-guide">инструкция менеджера →</Link>. Смена статуса записывается в
          историю клиента с вашим именем. Выгрузка базы и удаление данных — только у владельца; просьбу удалить данные человек присылает на
          joyrest@mail.ru.
        </p>
      )}

      <div className="seg plan-seg clients-filters" role="group" aria-label="Какие клиенты">
        {(Object.keys(FILTER_TITLES) as Filter[]).map((f) => (
          <button key={f} type="button" className={filter === f ? "seg__btn is-on" : "seg__btn"} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {FILTER_TITLES[f]}
          </button>
        ))}
      </div>
      <SearchField label="Поиск" value={query} placeholder="Имя, телефон, ссылка, заметка" candidates={candidates} onChange={setQuery} />

      {!shown ? (
        state.status === "error" ? <LoadFailedInline onRetry={retry} /> : <ListSkeleton />
      ) : (
        <div className={state.status === "ready" ? "stack" : "stack is-stale"}>
          <p className="small muted" aria-live="polite">
            Показано: {list.length}
          </p>
          {list.length === 0 && <p className="muted">{query.trim() ? "Ничего не нашлось." : archived ? "В архиве пусто." : "Клиентов пока нет — они появятся с первыми заявками."}</p>}
          {list.map((c) => (
            <ClientCard key={c.id} client={c} onEdit={() => setForm(c)} onArchive={() => toggleArchive(c)} />
          ))}
        </div>
      )}
      <TelegramConnect owner />
      {confirm}
      <Toast text={toast} />
    </>
  );
}

function ClientCard({ client: c, onEdit, onArchive }: { client: ClientRecord; onEdit: () => void; onArchive: () => void }) {
  const [open, setOpen] = useState(false);
  const [details, retry] = useLoad(() => (open && clientsRepo ? clientsRepo.get(c.id) : Promise.resolve(null as ClientDetails | null)), [open, c.id, c.lastContactAt]);
  const full = details.status === "ready" ? details.data : null;
  return (
    <article className={open ? "card plan-card is-open" : "card plan-card"} style={{ "--plan-color": STATUS_COLORS[c.status] } as CSSProperties}>
      <button type="button" className="plan-card__head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="plan-card__top">
          <span className="plan-card__title">{c.name || "Без имени"}</span>
          <Pill color={STATUS_COLORS[c.status]}>{CLIENT_STATUS_TITLES[c.status]}</Pill>
        </span>
        <span className="plan-card__when">{c.phone ? phoneLabel(c.phone) : c.links[0] ? linkTitle(c.links[0]) : "—"}</span>
        <span className="plan-card__host">
          {sourceTitle(c.lastSource)} · {dateLabel(c.lastContactAt)}
          {c.contacts > 1 ? ` · обращений: ${c.contacts}` : ""}
          {c.marketing === "yes" ? " · ✉️ рассылка" : ""}
        </span>
        <span className="plan-card__more" aria-hidden="true">
          {open ? "Свернуть ▲" : "Подробнее ▼"}
        </span>
      </button>
      {open && (
        <div className="stack stack--tight">
          <dl className="plan-facts">
            {c.phone && (
              <>
                <dt>Телефон</dt>
                <dd>
                  <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>{phoneLabel(c.phone)}</a>
                </dd>
              </>
            )}
            {c.links.map((l) => (
              <div key={l} className="clients-link">
                <dt>Ссылка</dt>
                <dd>
                  <a href={l} target="_blank" rel="noopener noreferrer">
                    {linkTitle(l)}
                  </a>
                </dd>
              </div>
            ))}
            <dt>Рассылка</dt>
            <dd>
              {MARKETING_TITLES[c.marketing]}
              {c.marketing === "yes" && c.marketingAt ? ` (${dateLabel(c.marketingAt)}${c.marketingSource ? `, ${c.marketingSource}` : ""})` : ""}
            </dd>
            <dt>В базе с</dt>
            <dd>{dateLabel(c.createdAt)}</dd>
            {c.notes && (
              <>
                <dt>Заметка</dt>
                <dd className="plan-facts__note">{c.notes}</dd>
              </>
            )}
          </dl>
          <h3 className="small">Обращения</h3>
          {details.status === "error" && <LoadFailedInline onRetry={retry} />}
          {!full && details.status !== "error" && <p className="muted small">Загружаем…</p>}
          {full && (
            <ul className="clients-history">
              {full.history.map((h) => (
                <li key={h.id}>
                  <b>{dateLabel(h.at)}</b> · {sourceTitle(h.source)}
                  {h.summary ? ` — ${h.summary}` : ""}
                  {h.source === "venue" && h.ref && (
                    <>
                      {" "}
                      <Link to={`/venues/r/${encodeURIComponent(h.ref)}`}>Подбор площадки →</Link>
                    </>
                  )}
                  {h.source === "event" && (
                    <>
                      {" "}
                      <Link to="/studio/calendar?tab=events">В планировщик →</Link>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="actions">
            <button type="button" className="btn btn--secondary btn--block" onClick={onEdit}>
              Изменить
            </button>
            <button type="button" className="btn btn--quiet btn--block" onClick={onArchive}>
              {c.archived ? "Вернуть из архива" : "Убрать в архив"}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function ClientForm({ initial, canConsent, onSaved, onCancel }: { initial: ClientRecord | null; canConsent: boolean; onSaved: (c: ClientRecord) => void; onCancel: () => void }) {
  const [id] = useState(() => initial?.id ?? newId());
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [links, setLinks] = useState((initial?.links ?? []).join("\n"));
  const [status, setStatus] = useState<ClientStatus>(initial?.status ?? "new");
  const [marketing, setMarketing] = useState<Marketing>(initial?.marketing ?? "unknown");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsedLinks = parseLinks(links);
  const ready = name.trim() !== "" || phoneKey(phone) !== "" || parsedLinks.length > 0;

  async function save() {
    if (!clientsRepo || !ready) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await clientsRepo.save({ id, name: name.trim(), phone: phone.trim(), links: parsedLinks, status, marketing, notes }));
    } catch (e) {
      const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "";
      setError(code === "already-exists" ? "Клиент с этим телефоном уже есть — найдите его поиском." : "Не получилось сохранить. Проверьте интернет и нажмите ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack plan-form" aria-labelledby="client-form">
      <h2 id="client-form">{initial ? "Изменить клиента" : "Новый клиент"}</h2>
      <label className="field">
        <span className="field__label">Имя</span>
        <input type="text" autoComplete="off" maxLength={CLIENT_LIMITS.name} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">Телефон</span>
        <input type="tel" inputMode="tel" autoComplete="off" maxLength={CLIENT_LIMITS.phone} value={phone} placeholder="+7 …" onChange={(e) => setPhone(e.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">Соцсети (Telegram, ВКонтакте, Instagram, WhatsApp)</span>
        <textarea rows={2} value={links} placeholder="@nick, vk.com/…, instagram.com/…" onChange={(e) => setLinks(e.target.value)} />
      </label>
      {parsedLinks.length > 0 && <p className="muted small">Распознано: {parsedLinks.map(linkTitle).join(", ")}</p>}
      <fieldset className="stack stack--tight">
        <legend>Статус</legend>
        <div className="plan-quick" role="group" aria-label="Статус">
          {CLIENT_STATUSES.map((s) => (
            <button key={s} type="button" className={status === s ? "seg__btn is-on" : "seg__btn"} aria-pressed={status === s} onClick={() => setStatus(s)}>
              {CLIENT_STATUS_TITLES[s]}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="stack stack--tight">
        <legend>Рассылка</legend>
        {(["yes", "unknown", "no"] as const).filter((m) => m !== "yes" || canConsent || initial?.marketing === "yes").map((m) => (
          <label key={m} className="choice">
            <input type="radio" name={`mkt-${id}`} checked={marketing === m} onChange={() => setMarketing(m)} />
            <span className="choice__text">
              <span className="choice__title">{MARKETING_TITLES[m]}</span>
              {m === "yes" && <span className="choice__hint">Только если человек сам согласился получать новости и предложения (на сайте, письменно или в переписке).</span>}
            </span>
          </label>
        ))}
        {!canConsent && initial?.marketing !== "yes" && (
          <p className="muted small">Согласие на рассылку отмечает владелец. Клиент согласился в переписке — напишите это в заметке.</p>
        )}
      </fieldset>
      <label className="field">
        <span className="field__label">Заметка</span>
        <textarea rows={3} maxLength={CLIENT_LIMITS.notes} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {!ready && <p className="muted small">Нужны имя, телефон или ссылка.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="btn btn--block" disabled={busy || !ready} onClick={() => void save()}>
          {busy ? "Сохраняем…" : "Сохранить"}
        </button>
        <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={onCancel}>
          Отмена
        </button>
      </div>
    </section>
  );
}
