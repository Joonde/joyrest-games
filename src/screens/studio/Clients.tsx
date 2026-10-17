/**
 * База клиентов (CLAUDE.md, раздел 3, «База клиентов»; решение владельца 14 октября 2026) — владелец и менеджер по
 * продажам (роль `sales`, решение 15 октября 2026); выгрузка, «Данные по номеру» и согласие «да» — только владелец.
 * Сюда сами попадают все, кто оставил заявку или вопрос на сайте, запрос по QR, записан в планировщик или переслан
 * боту в Telegram. Один человек — одна карточка (по телефону). Выгрузка для рассылки — только согласившиеся.
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
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
  CLIENT_ORIGINS,
  ORIGIN_TITLES,
  originTitle,
  waitingOf,
  timerOf,
  timerSortKey,
  durationLabel,
  responseStats,
  ANSWER_LIMIT_MS,
} from "../../core/clients";
import { firstMessage } from "../../core/salesGuide";
import { matchesSearch } from "../../core/search";
import { clientsRepo, permissions, useLoad, type ClientDetails, type ClientRecord, type ClientResponse, type UserProfile } from "../../data";
import { useConfirm } from "../../components/ConfirmDialog";
import { Fold } from "../../components/Fold";
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
  held: "Провели",
  lost: "Отказ",
  mailing: "Рассылка",
  archive: "Архив",
};
const STATUS_COLORS: Record<ClientStatus, string> = { new: brand.gold, work: brand.lavender, client: brand.sage, held: brand.wine, lost: brand.coral };
/** Порядок списка: свежие обращения сверху или по таймеру ответа — дольше ждущие (и дольше ждавшие) сверху. */
type Sort = "fresh" | "timer";
const dayOf = (ms: number) => new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10);

const dateLabel = (ms: number) => new Date(ms).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" });
/** Дата и время по Москве — в истории видно, сколько анкета ждала до «В работе». */
const dateTimeLabel = (ms: number) =>
  new Date(ms).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
const isFilter = (v: string | null): v is Filter => v !== null && v in FILTER_TITLES;
/** Новую анкету ждут ответа не дольше 30 минут (инструкция менеджера, «Сроки»). */
const ANSWER_MS = ANSWER_LIMIT_MS;

/** «12 мин», «3 ч», «2 дн» — сколько прошло. */
function agoLabel(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} ч` : `${Math.floor(h / 24)} дн`;
}

/** Текущее время, обновляется раз в минуту: «ждёт ответа» растёт без перезагрузки. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
const sourceTitle = (s: string) => SOURCE_TITLES[s as ClientSource] ?? s;
/** «В работе · Мария» → «Мария» (у старых карточек — кто последним менял статус). */
const lastPart = (line: string) => {
  const parts = line.split(" · ");
  return parts.length > 1 ? (parts[parts.length - 1] ?? line) : line;
};

/**
 * Таймер ответа сверху карточки (решение владельца 17 октября 2026): заявка пришла — пошёл отсчёт по секундам;
 * менеджер перевёл из «Нового» — таймер встал и показывает, сколько клиент ждал и кто взял.
 */
function TimerBadge({ client: c }: { client: ClientRecord }) {
  const [now, setNow] = useState(() => Date.now());
  const running = c.status === "new" && !c.archived;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const t = timerOf(c, now);
  if (!t) return null;
  const late = t.ms > ANSWER_MS;
  return (
    <span className={["clients-timer", t.running ? "is-running" : "is-stopped", late ? "is-late" : ""].filter(Boolean).join(" ")} role="timer">
      <span aria-hidden="true">{t.running ? "⏱" : "✓"}</span>{" "}
      {t.running ? (
        <>
          Ждёт ответа <b>{durationLabel(t.ms)}</b>
        </>
      ) : (
        <>
          Ответили за <b>{durationLabel(t.ms)}</b>
          {t.by ? ` · ${t.by}` : ""}
        </>
      )}
    </span>
  );
}

/** Сколько в среднем ждут ответа новые заявки (за 30 дней): в среднем, обычно (медиана) и сколько — вовремя. */
function ResponseSummary({ refresh }: { refresh: number }) {
  const [state] = useLoad(() => {
    if (!clientsRepo) return Promise.resolve([] as ClientResponse[]);
    const now = Date.now();
    return clientsRepo.responses(dayOf(now - 29 * 86_400_000), dayOf(now));
  }, [refresh]);
  if (state.status !== "ready" || state.data.length === 0) return null;
  const st = responseStats(state.data);
  return (
    <p className="small clients-speed">
      ⏱ Ответ на новую заявку за 30 дней: в среднем <b>{durationLabel(st.avgMs)}</b>, обычно <b>{durationLabel(st.medianMs)}</b> · до 30 минут — {st.inTime} из {st.count}
    </p>
  );
}

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
  const [params, setParams] = useSearchParams();
  // Колокольчик открывает одного клиента (?id=): только его карточка, сразу раскрыта.
  const focusId = params.get("id");
  // «Рабочее место» открывает «Клиентов» сразу на «Новых» (?f=new).
  const [filter, setFilter] = useState<Filter>(() => {
    const f = params.get("f");
    return isFilter(f) ? f : "all";
  });
  const archived = filter === "archive";
  const now = useNow();
  const [state, retry, update] = useLoad(() => (clientsRepo ? clientsRepo.list(archived) : Promise.resolve([] as ClientRecord[])), [archived]);
  const shown = useLastReady(state);
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const [form, setForm] = useState<ClientRecord | "new" | null>(null);
  const [toast, showToast] = useToast();
  // «Новые» — сразу по таймеру (дольше ждущие сверху), остальные — свежие обращения сверху; менеджер меняет сам.
  const [sort, setSort] = useState<Sort>(() => (params.get("f") === "new" ? "timer" : "fresh"));
  const [saves, setSaves] = useState(0);

  // Владелец и менеджер работают одновременно: список тихо обновляется раз в 30 секунд и при возврате на вкладку,
  // без каркаса и мигания — новые анкеты и чужие смены статуса видны без перезагрузки.
  useEffect(() => {
    if (!clientsRepo) return;
    const repo = clientsRepo;
    let alive = true;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      repo
        .list(archived)
        .then((data) => alive && update(() => data))
        .catch(() => undefined);
    };
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [archived, update]);
  const [confirm, ask] = useConfirm();

  const list = useMemo(() => {
    if (focusId) return (shown ?? []).filter((c) => c.id === focusId);
    const all = (shown ?? []).filter((c) => c.archived === archived);
    const byFilter = all.filter((c) => (filter === "all" || filter === "archive" ? true : filter === "mailing" ? c.marketing === "yes" : c.status === filter));
    const found = query.trim() ? byFilter.filter((c) => matchesSearch([c.name, c.phone, phoneKey(c.phone), c.notes, ...c.links], query)) : byFilter;
    // По таймеру: кто ждёт ответа прямо сейчас — сверху (дольше ждущий — первым), дальше — кого дольше ждали.
    if (sort === "timer") {
      const at = Date.now();
      return [...found].sort((a, b) => timerSortKey(b, at) - timerSortKey(a, at) || b.lastContactAt - a.lastContactAt);
    }
    return found;
  }, [shown, filter, query, archived, focusId, sort]);
  // Счётчики у фильтров (кроме «Архива»: в архиве свой список).
  const counts = useMemo((): Partial<Record<Filter, number>> => {
    if (archived) return {};
    const active = (shown ?? []).filter((c) => !c.archived);
    const n: Partial<Record<Filter, number>> = { all: active.length, mailing: active.filter((c) => c.marketing === "yes").length };
    for (const st of CLIENT_STATUSES) n[st] = active.filter((c) => c.status === st).length;
    return n;
  }, [shown, archived]);
  const late = (shown ?? []).filter((c) => {
    const w = waitingOf(c);
    return w !== null && now - w.since > ANSWER_MS;
  }).length;
  const candidates = useMemo(() => [...new Set((shown ?? []).map((c) => c.name).filter(Boolean))], [shown]);
  const consented = (shown ?? []).filter((c) => !c.archived && c.marketing === "yes").length;

  function saved(c: ClientRecord, text: string) {
    update((data) => [c, ...data.filter((x) => x.id !== c.id)]);
    setForm(null);
    setSaves((n) => n + 1);
    showToast(text);
  }

  /** Тот же телефон уже есть в базе — открыть его карточку (в списке; нет — поиском по номеру). */
  function openExisting(phone: string) {
    const key = phoneKey(phone);
    const other = (shown ?? []).find((c) => phoneKey(c.phone) === key);
    setForm(null);
    if (other) setParams({ id: other.id }, { replace: true });
    else {
      setFilter("all");
      setQuery(phone);
    }
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
        onOpenExisting={openExisting}
      />
    );
  }

  return (
    <>
      <p className="muted">
        Сюда сами попадают все, кто оставил заявку или вопрос на сайте, запрос по QR-анкете, записан в планировщик мероприятий или кого вы переслали
        боту в Telegram — даже если мероприятия не было. Один человек — одна карточка (по телефону). Площадку подбираем только для мероприятия «под ключ» — в{" "}
        <Link to="/venues?tab=requests">базе площадок</Link> («Заявки клиентов»), из истории клиента — одним касанием.
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
            {counts[f] !== undefined ? ` ${counts[f]}` : ""}
          </button>
        ))}
      </div>
      <div className="seg clients-sort" role="group" aria-label="Порядок">
        <button type="button" className={sort === "fresh" ? "seg__btn is-on" : "seg__btn"} aria-pressed={sort === "fresh"} onClick={() => setSort("fresh")}>
          Свежие сверху
        </button>
        <button type="button" className={sort === "timer" ? "seg__btn is-on" : "seg__btn"} aria-pressed={sort === "timer"} onClick={() => setSort("timer")}>
          ⏱ По таймеру — дольше ждут сверху
        </button>
      </div>
      {late > 0 && (
        <p className="clients-late" role="status">
          ⏰ Ждут ответа дольше 30 минут: {late}. «По таймеру» — они первыми.
        </p>
      )}
      <ResponseSummary refresh={saves + (shown?.filter((c) => c.status !== "new").length ?? 0)} />
      <SearchField label="Поиск" value={query} placeholder="Имя, телефон, ссылка, заметка" candidates={candidates} onChange={setQuery} />

      {!shown ? (
        state.status === "error" ? <LoadFailedInline onRetry={retry} /> : <ListSkeleton />
      ) : (
        <div className={state.status === "ready" ? "stack" : "stack is-stale"}>
          {focusId ? (
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => {
                const next = new URLSearchParams(params);
                next.delete("id");
                setParams(next, { replace: true });
              }}
            >
              ← Все клиенты
            </button>
          ) : (
            <p className="small muted" aria-live="polite">
              Показано: {list.length}
            </p>
          )}
          {focusId && list.length === 0 && <p className="muted">Клиента нет в этом списке — возможно, он в архиве.</p>}
          {list.length === 0 && <p className="muted">{query.trim() ? "Ничего не нашлось." : archived ? "В архиве пусто." : "Клиентов пока нет — они появятся с первыми заявками."}</p>}
          {list.map((c) => (
            <ClientCard
              key={c.id}
              client={c}
              startOpen={c.id === focusId}
              now={now}
              manager={profile.name}
              onEdit={() => setForm(c)}
              onArchive={() => toggleArchive(c)}
              onChanged={(next, text) => {
                update((data) => data.map((x) => (x.id === next.id ? next : x)));
                showToast(text);
              }}
              onToast={showToast}
            />
          ))}
        </div>
      )}
      <TelegramConnect owner />
      {confirm}
      <Toast text={toast} />
    </>
  );
}

/** Как связаться: звонок, WhatsApp и Telegram по номеру (российский или международный). */
function contactLinks(phone: string): { label: string; href: string }[] {
  const key = phoneKey(phone);
  if (!key) return [];
  return [
    { label: "📞 Позвонить", href: `tel:+${key}` },
    { label: "WhatsApp", href: `https://wa.me/${key}` },
    { label: "Telegram", href: `https://t.me/+${key}` },
  ];
}

/** Повод из последней заявки: первая строка до запятой («Корпоратив, 25 гостей» → «Корпоратив»). */
function occasionOf(details: ClientDetails | null): string {
  const lead = details?.history.find((h) => h.source === "site" && h.summary);
  return lead ? (lead.summary.split("\n")[0] ?? "").split(",")[0] ?? "" : "";
}

/** Путь клиента: «Новый» → «В работе» → «Клиент» → «Провели»; «Отказ» — отдельно, в стороне. */
const PATH: ClientStatus[] = ["new", "work", "client", "held"];
const STATUS_HINTS: Record<ClientStatus, string> = {
  new: "Таймер идёт. Ответьте в течение 30 минут и переведите в «В работе» — таймер остановится.",
  work: "Ведёте переговоры. Договорились — «Клиент» (поставится сам, когда мероприятие запишут), не вышло — «Отказ» с причиной в заметке.",
  client: "Договорились, мероприятие впереди. После него ведущий отметит «Проведено» — статус станет «Провели» сам.",
  held: "Мероприятие прошло. На следующий день попросите отзыв (шаблон — в инструкции) и предложите следующий праздник. Напишет снова — станет «Новым».",
  lost: "Не договорились — причина в заметке. Напишет снова — станет «Новым», таймер пойдёт заново.",
};

/**
 * Статус — отдельной рамкой вверху карточки, подальше от «Позвонить» (решение владельца 15 октября 2026): рамка и
 * плашка цвета статуса, путь клиента со сдвигающимся ползунком, при смене — короткая вспышка («уменьшить движение» —
 * без анимации). «Отказ» стоит отдельно, чтобы не нажать его вместо «Клиент».
 */
function StatusPanel({ client: c, busy, onPick }: { client: ClientRecord; busy: boolean; onPick: (status: ClientStatus) => void }) {
  const [confirm, ask] = useConfirm();
  const index = PATH.indexOf(c.status);
  const name = c.name || phoneLabel(c.phone) || "клиента";
  // Защита от случайного касания (решение владельца 15 октября 2026): «Отказ» — только после «Вы точно уверены?».
  const askLost = () =>
    ask({
      title: "Вы точно уверены?",
      text: `Перевести «${name}» в «Отказ» — значит, не договорились. После этого напишите в заметке причину. Вернуть статус можно в любой момент.`,
      confirmLabel: "Да, отказ",
      cancelLabel: "Нет, оставить",
      run: () => onPick("lost"),
    });
  const next = index >= 0 && index < PATH.length - 1 ? PATH[index + 1] : null;
  return (
    <section
      className="clients-status"
      style={{ "--status-color": STATUS_COLORS[c.status], "--status-index": Math.max(index, 0) } as CSSProperties}
      aria-label="Статус клиента"
    >
      <div className="clients-status__now">
        <span className="small muted">Статус</span>
        <span key={c.status} className="clients-status__pill" aria-live="polite">
          {CLIENT_STATUS_TITLES[c.status]}
        </span>
      </div>
      {c.statusLine && c.status !== "new" && (
        <p className="small muted clients-status__who">
          {c.statusLine}
          {c.statusAt ? ` · ${dateTimeLabel(c.statusAt)}` : ""}
        </p>
      )}
      <p className="small">{STATUS_HINTS[c.status]}</p>
      <div className={index >= 0 ? "clients-status__path" : "clients-status__path is-off"} role="group" aria-label="Сменить статус">
        <span className="clients-status__slider" aria-hidden="true" />
        {PATH.map((st, i) => (
          <button
            key={st}
            type="button"
            className={["clients-status__step", c.status === st ? "is-on" : "", index > i ? "is-done" : ""].filter(Boolean).join(" ")}
            aria-pressed={c.status === st}
            disabled={busy}
            onClick={() => onPick(st)}
          >
            {index > i ? "✓ " : ""}
            {CLIENT_STATUS_TITLES[st]}
          </button>
        ))}
      </div>
      {next && (
        <button type="button" className="btn btn--block" disabled={busy} onClick={() => onPick(next)}>
          Перевести в «{CLIENT_STATUS_TITLES[next]}» →
        </button>
      )}
      <button
        type="button"
        className={c.status === "lost" ? "btn btn--quiet btn--block clients-status__lost is-on" : "btn btn--quiet btn--block clients-status__lost"}
        aria-pressed={c.status === "lost"}
        disabled={busy || c.status === "lost"}
        onClick={askLost}
      >
        {c.status === "lost" ? "Отказ" : "Не договорились — «Отказ»"}
      </button>
      {c.status === "lost" && !c.notes.trim() && <p className="small clients-late">Напишите причину отказа в заметке ниже.</p>}
      {confirm}
    </section>
  );
}

function ClientCard({
  client: c,
  startOpen = false,
  now,
  manager,
  onEdit,
  onArchive,
  onChanged,
  onToast,
}: {
  client: ClientRecord;
  startOpen?: boolean;
  now: number;
  manager: string;
  onEdit: () => void;
  onArchive: () => void;
  onChanged: (c: ClientRecord, toast: string) => void;
  onToast: (text: string) => void;
}) {
  const [open, setOpen] = useState(startOpen);
  const [details, retry] = useLoad(() => (open && clientsRepo ? clientsRepo.get(c.id) : Promise.resolve(null as ClientDetails | null)), [open, c.id, c.lastContactAt, c.status, c.notes]);
  const full = details.status === "ready" ? details.data : null;
  const [note, setNote] = useState(c.notes);
  // Текст, с которого начали править заметку: сервер сверяет его, чтобы не затереть чужую правку.
  const [noteBase, setNoteBase] = useState(c.notes);
  // Пока вы писали, заметку изменил другой человек: его текст (обе версии на экране, ничего не потеряно).
  const [conflict, setConflict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = note !== noteBase;
  useEffect(() => {
    // Карточку обновили (своё сохранение или чужая правка): без своих несохранённых правок — показываем свежий текст.
    if (!dirty) {
      setNote(c.notes);
      setNoteBase(c.notes);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.notes]);
  const wait = waitingOf(c);
  const waiting = wait ? now - wait.since : 0;
  const late = waiting > ANSWER_MS;

  // Статус одним касанием: сервер меняет только статус (чужую заметку не трогает), в историю — «В работе · имя».
  async function setStatus(status: ClientRecord["status"]) {
    if (!clientsRepo || busy || status === c.status) return;
    setBusy(true);
    setError(null);
    try {
      onChanged(await clientsRepo.setStatus(c.id, status), `Статус: ${CLIENT_STATUS_TITLES[status]}`);
    } catch {
      setError("Не получилось сменить статус. Проверьте интернет и нажмите ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  // Заметка: сохраняется, только если с начала правки её никто не менял; иначе — обе версии на экране.
  async function saveNote(text: string, base: string) {
    if (!clientsRepo || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await clientsRepo.saveNotes(c.id, text, base);
      setConflict(null);
      setNote(saved.notes);
      setNoteBase(saved.notes);
      onChanged(saved, "Заметка сохранена");
    } catch (e) {
      const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "";
      if (code === "failed-precondition" && clientsRepo) {
        const fresh = await clientsRepo.get(c.id).catch(() => null);
        if (fresh) {
          setConflict(fresh.notes);
          onChanged(fresh, "Заметку только что изменил другой человек");
        } else setError("Заметку только что изменил другой человек. Обновите страницу.");
      } else setError("Не получилось сохранить. Проверьте интернет и нажмите ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  async function copyFirst() {
    const text = firstMessage(c.name, manager, occasionOf(full));
    try {
      await navigator.clipboard.writeText(text);
      onToast("Первое сообщение скопировано — вставьте его клиенту");
    } catch {
      onToast("Не получилось скопировать — текст есть в инструкции менеджера");
    }
  }

  return (
    <article className={open ? "card plan-card is-open" : "card plan-card"} style={{ "--plan-color": STATUS_COLORS[c.status] } as CSSProperties}>
      <button type="button" className="plan-card__head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <TimerBadge client={c} />
        <span className="plan-card__top">
          <span className="plan-card__title">{c.name || "Без имени"}</span>
          <Pill color={STATUS_COLORS[c.status]}>{CLIENT_STATUS_TITLES[c.status]}</Pill>
        </span>
        <span className="plan-card__when">{c.phone ? phoneLabel(c.phone) : c.links[0] ? linkTitle(c.links[0]) : "—"}</span>
        {/* Под именем — подписанные поля, а не одна строка через точки (решение владельца 15 октября 2026). */}
        <span className="clients-facts">
          <span className="clients-facts__row">
            <span className="clients-facts__label">Источник</span>
            <span className="clients-facts__value">{originTitle(c.origin ?? "")}</span>
          </span>
          <span className="clients-facts__row">
            <span className="clients-facts__label">Последнее</span>
            <span className="clients-facts__value">{sourceTitle(c.lastSource)}</span>
          </span>
          <span className="clients-facts__row">
            <span className="clients-facts__label">Обращение</span>
            <span className="clients-facts__value">
              {dateTimeLabel(c.lastContactAt)}
              {c.contacts > 1 ? ` · всего ${c.contacts}` : ""}
            </span>
          </span>
          {c.status !== "new" && (c.takenBy || c.statusLine) && (
            <span className="clients-facts__row">
              <span className="clients-facts__label">Ведёт</span>
              <span className="clients-facts__value">
                {c.takenBy || lastPart(c.statusLine)}
                {c.takenAt ? ` · с ${dateTimeLabel(c.takenAt)}` : c.statusAt ? ` · ${dateTimeLabel(c.statusAt)}` : ""}
              </span>
            </span>
          )}
          {c.marketing === "yes" && (
            <span className="clients-facts__row">
              <span className="clients-facts__label">Рассылка</span>
              <span className="clients-facts__value">✉️ согласен</span>
            </span>
          )}
        </span>
        {/* Новый клиент — таймер сверху; здесь — только «ждёт ответа в Telegram» (у любого статуса). */}
        {wait?.telegram && waiting > 0 && <span className={late ? "clients-wait is-late" : "clients-wait"}>{late ? "⏰ " : ""}ждёт ответа в Telegram {agoLabel(waiting)}</span>}
        {!open && c.notes && <span className="clients-note-line">📝 {c.notes.split("\n")[0]}</span>}
        <span className="plan-card__more" aria-hidden="true">
          {open ? "Свернуть ▲" : "Подробнее ▼"}
        </span>
      </button>
      {open && (
        <div className="stack stack--tight">
          {!c.archived && <StatusPanel client={c} busy={busy} onPick={(st) => void setStatus(st)} />}

          {(c.phone || c.links.length > 0) && (
            <h3 className="small clients-section">Связаться</h3>
          )}
          {(c.phone || c.links.length > 0) && (
            <div className="clients-contact" role="group" aria-label="Связаться">
              {contactLinks(c.phone).map((l) => (
                <a key={l.label} className="btn btn--secondary" href={l.href} target={l.href.startsWith("tel:") ? undefined : "_blank"} rel="noopener noreferrer">
                  {l.label}
                </a>
              ))}
              {c.links.map((l) => (
                <a key={l} className="btn btn--secondary" href={l} target="_blank" rel="noopener noreferrer">
                  {linkTitle(l)}
                </a>
              ))}
            </div>
          )}
          {c.status === "new" && (
            <button type="button" className="btn btn--quiet btn--block" onClick={() => void copyFirst()}>
              Скопировать первое сообщение
            </button>
          )}

          {!c.archived && (
            <label className="field">
              <span className="field__label">Заметка: дата, гости, расчёт, следующий шаг</span>
              <textarea rows={3} maxLength={CLIENT_LIMITS.notes} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          )}
          {!c.archived && conflict === null && dirty && (
            <button type="button" className="btn btn--block" disabled={busy} onClick={() => void saveNote(note, noteBase)}>
              {busy ? "Сохраняем…" : "Сохранить заметку"}
            </button>
          )}
          {!c.archived && conflict === null && dirty && c.notes !== noteBase && (
            <p className="small clients-late">Пока вы пишете, заметку изменил другой человек — при сохранении покажем обе версии.</p>
          )}
          {conflict !== null && (
            <div className="card stack stack--tight clients-conflict" role="alert">
              <p className="small">
                <b>Пока вы писали, заметку изменил другой человек.</b> Сейчас в карточке:
              </p>
              <p className="clients-history__text">{conflict || "(пусто)"}</p>
              <p className="small muted">Ваш текст — в поле выше, он не потерян.</p>
              <button type="button" className="btn btn--block" disabled={busy} onClick={() => void saveNote(`${conflict}\n${note}`.trim(), conflict)}>
                Добавить мой текст в конец
              </button>
              <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void saveNote(note, conflict)}>
                Заменить моим текстом
              </button>
              <button
                type="button"
                className="btn btn--quiet btn--block"
                disabled={busy}
                onClick={() => {
                  setNote(conflict);
                  setNoteBase(conflict);
                  setConflict(null);
                }}
              >
                Оставить их текст, мой убрать
              </button>
            </div>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          <dl className="plan-facts">
            {c.phone && (
              <>
                <dt>Телефон</dt>
                <dd>
                  <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>{phoneLabel(c.phone)}</a>
                </dd>
              </>
            )}
            <dt>Рассылка</dt>
            <dd>
              {MARKETING_TITLES[c.marketing]}
              {c.marketing === "yes" && c.marketingAt ? ` (${dateLabel(c.marketingAt)}${c.marketingSource ? `, ${c.marketingSource}` : ""})` : ""}
            </dd>
            <dt>В базе с</dt>
            <dd>{dateLabel(c.createdAt)}</dd>
            {c.archived && c.notes && (
              <>
                <dt>Заметка</dt>
                <dd className="plan-facts__note">{c.notes}</dd>
              </>
            )}
          </dl>
          {/* История свёрнута (решение владельца 15 октября 2026): длинный список не растягивает карточку. */}
          <Fold title="Обращения и история" value={full ? `${full.history.length}` : undefined}>
            {details.status === "error" && <LoadFailedInline onRetry={retry} />}
            {!full && details.status !== "error" && <p className="muted small">Загружаем…</p>}
            {full && (
              <ul className="clients-history">
                {full.history.map((h) => (
                  <li key={h.id}>
                    <b>{dateTimeLabel(h.at)}</b> · {sourceTitle(h.source)}
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
                    {h.summary && <span className="clients-history__text">{h.summary}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Fold>
          <div className="actions">
            <button type="button" className="btn btn--secondary btn--block" onClick={onEdit}>
              Изменить имя, телефон, ссылки
            </button>
            <button type="button" className="btn btn--quiet btn--block" onClick={onArchive}>
              {c.archived ? "Вернуть из архива" : "Убрать в архив (спам)"}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

/**
 * Карточка клиента вручную (звонок, Авито, рекомендация) и правка. Проверки (17 октября 2026): у нового — телефон
 * или ссылка обязательны (без них клиенту не написать), неполный телефон не сохраняется, тот же телефон — «Открыть
 * его карточку», чужая правка — «Сохранить мои правки поверх» без потери введённого, выход с правками — через вопрос.
 */
function ClientForm({
  initial,
  canConsent,
  onSaved,
  onCancel,
  onOpenExisting,
}: {
  initial: ClientRecord | null;
  canConsent: boolean;
  onSaved: (c: ClientRecord) => void;
  onCancel: () => void;
  onOpenExisting: (phone: string) => void;
}) {
  const [id] = useState(() => initial?.id ?? newId());
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [links, setLinks] = useState((initial?.links ?? []).join("\n"));
  const [status, setStatus] = useState<ClientStatus>(initial?.status ?? "new");
  const [marketing, setMarketing] = useState<Marketing>(initial?.marketing ?? "unknown");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [origin, setOrigin] = useState(initial?.origin ?? "");
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Что пошло не так при сохранении: тот же телефон у другого клиента или карточку только что изменил другой.
  const [problem, setProblem] = useState<"duplicate" | "changed" | null>(null);
  const [confirm, ask] = useConfirm();
  const parsedLinks = parseLinks(links);
  const key = phoneKey(phone);
  const phoneBad = phone.trim() !== "" && key === "";
  // Новый клиент — нужен телефон или ссылка; у старых карточек (бывают только с именем) хватит имени.
  const reachableNow = key !== "" || parsedLinks.length > 0;
  const ready = !phoneBad && (initial ? reachableNow || name.trim() !== "" : reachableNow);
  const dirty =
    name !== (initial?.name ?? "") ||
    phone !== (initial?.phone ?? "") ||
    links !== (initial?.links ?? []).join("\n") ||
    status !== (initial?.status ?? "new") ||
    marketing !== (initial?.marketing ?? "unknown") ||
    notes !== (initial?.notes ?? "") ||
    origin !== (initial?.origin ?? "") ||
    request.trim() !== "";

  async function save(force = false) {
    if (!clientsRepo || !ready) return;
    setBusy(true);
    setError(null);
    setProblem(null);
    try {
      onSaved(
        await clientsRepo.save({
          id,
          name: name.trim(),
          phone: phone.trim(),
          links: parsedLinks,
          status,
          marketing,
          notes,
          origin,
          ...(initial ? {} : { request: request.trim() }),
          ...(initial && !force ? { expect: initial.updatedAt } : {}),
        }),
      );
    } catch (e) {
      const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "";
      if (code === "already-exists") setProblem("duplicate");
      else if (code === "failed-precondition") setProblem("changed");
      else setError("Не получилось сохранить. Проверьте интернет и нажмите ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    if (!dirty) return onCancel();
    ask({
      title: "Выйти без сохранения?",
      text: "Введённое в форме не сохранится.",
      confirmLabel: "Выйти без сохранения",
      cancelLabel: "Остаться",
      run: () => onCancel(),
    });
  }

  return (
    <section className="card stack plan-form" aria-labelledby="client-form">
      <h2 id="client-form">{initial ? "Изменить клиента" : "Новый клиент"}</h2>
      <label className="field">
        <span className="field__label">Имя</span>
        <input type="text" autoComplete="off" maxLength={CLIENT_LIMITS.name} value={name} placeholder="Как обращаться: Мария" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">Телефон</span>
        <input
          type="tel"
          inputMode="tel"
          autoComplete="off"
          maxLength={CLIENT_LIMITS.phone}
          value={phone}
          placeholder="+7 915 241-59-99"
          aria-invalid={phoneBad}
          onChange={(e) => setPhone(e.target.value)}
        />
      </label>
      {phoneBad && <p className="error small">Телефон неполный: нужно 10–11 цифр, например +7 915 241-59-99.</p>}
      {key !== "" && phoneLabel(phone) !== phone.trim() && <p className="muted small">Сохранится как {phoneLabel(phone)}</p>}
      <label className="field">
        <span className="field__label">Соцсети (Telegram, ВКонтакте, Instagram, WhatsApp)</span>
        <textarea rows={2} value={links} placeholder="@nick, vk.com/…, instagram.com/…" onChange={(e) => setLinks(e.target.value)} />
      </label>
      {parsedLinks.length > 0 && <p className="muted small">Распознано: {parsedLinks.map(linkTitle).join(", ")}</p>}
      {links.trim() !== "" && parsedLinks.length === 0 && <p className="error small">Ссылку не распознали: вставьте @ник Telegram или ссылку vk.com/…, instagram.com/…, wa.me/…</p>}
      {!initial && (
        <label className="field">
          <span className="field__label">Что хочет клиент</span>
          <textarea
            rows={2}
            maxLength={CLIENT_LIMITS.notes}
            value={request}
            placeholder="Свадьба, 12 июня, 60 гостей, бюджет до 40 000 ₽"
            onChange={(e) => setRequest(e.target.value)}
          />
          <span className="field__hint">Первой записью попадёт в историю клиента — как заявка с сайта.</span>
        </label>
      )}
      <label className="field">
        <span className="field__label">Откуда пришёл</span>
        <select value={origin} onChange={(e) => setOrigin(e.target.value)}>
          <option value="">Не указан</option>
          {CLIENT_ORIGINS.map((o) => (
            <option key={o} value={o}>
              {ORIGIN_TITLES[o]}
            </option>
          ))}
        </select>
        {!initial && origin === "" && <span className="field__hint">Укажите — по этому считаются «Итоги»: откуда приходят клиенты.</span>}
      </label>
      <fieldset className="stack stack--tight">
        <legend>Статус</legend>
        <div className="plan-quick" role="group" aria-label="Статус">
          {CLIENT_STATUSES.map((s) => (
            <button key={s} type="button" className={status === s ? "seg__btn is-on" : "seg__btn"} aria-pressed={status === s} onClick={() => setStatus(s)}>
              {CLIENT_STATUS_TITLES[s]}
            </button>
          ))}
        </div>
        {!initial && (
          <p className="muted small">
            {status === "new"
              ? "«Новый» — ещё не связались: пойдёт таймер ответа. Уже разговариваете с клиентом — выберите «В работе»."
              : status === "work"
                ? "«В работе» — вы уже говорите с клиентом, таймер не нужен."
                : STATUS_HINTS[status]}
          </p>
        )}
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
        <span className="field__label">Заметка: дата, гости, расчёт, следующий шаг</span>
        <textarea rows={3} maxLength={CLIENT_LIMITS.notes} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {!ready && !phoneBad && (
        <p className="muted small">{initial ? "Нужны имя, телефон или ссылка." : "Нужен телефон или ссылка на соцсеть — без них клиенту не написать."}</p>
      )}
      {problem === "duplicate" && (
        <div className="card stack stack--tight clients-conflict" role="alert">
          <p className="small">
            <b>Клиент с этим телефоном уже есть.</b> Один человек — одна карточка: откройте его и допишите заметку там.
          </p>
          <button type="button" className="btn btn--block" onClick={() => onOpenExisting(phone)}>
            Открыть его карточку
          </button>
        </div>
      )}
      {problem === "changed" && (
        <div className="card stack stack--tight clients-conflict" role="alert">
          <p className="small">
            <b>Пока вы правили, карточку изменил другой человек.</b> Ваши правки — в форме, они не потеряны.
          </p>
          <button type="button" className="btn btn--block" disabled={busy} onClick={() => void save(true)}>
            Сохранить мои правки поверх
          </button>
          <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={onCancel}>
            Открыть свежую версию (мои правки не сохранятся)
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="btn btn--block" disabled={busy || !ready} onClick={() => void save()}>
          {busy ? "Сохраняем…" : "Сохранить"}
        </button>
        <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={cancel}>
          Отмена
        </button>
      </div>
      {confirm}
    </section>
  );
}
