/**
 * «Активные заказы» (вкладка «Клиентов», решения владельца 12–13 ноября 2026; логика — docs/active-orders.md, расчёт строк —
 * src/core/orders.ts). Таблица всех, кого сейчас ведём: забронированы, в переговорах, прошли и не закрыты, отменены.
 * Страница только показывает: касание строки — карточка мероприятия в планировщике или карточка клиента.
 * От 1024 px — таблица, уже — карточки. «Агентству» — только владелец.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  filterCounts,
  filterRows,
  GROUP_TITLES,
  groupMeta,
  ORDER_GROUPS,
  orderRows,
  plural,
  summaryOf,
  type Mark,
  type Money,
  type OrderFilter,
  type OrderGroup,
  type OrderRow,
  type OrderSort,
  type OrderView,
} from "../../core/orders";
import { rub } from "../../core/prepay";
import { eventsRepo, permissions, type OrdersBoard, type UserProfile } from "../../data";
import { SearchField } from "../../components/SearchField";
import { ListSkeleton } from "../../components/Skeleton";
import { LoadFailedInline } from "../../components/Status";

const VIEW_KEY = "joyrest.orders.view";
const FILTER_TITLES: Record<OrderFilter, string> = {
  all: "Все",
  alert: "Требуют внимания",
  booked: "Забронированы",
  talk: "В переговорах",
  close: "Нужно закрыть",
  off: "Отменены",
};
const SORT_TITLES: Record<OrderSort, string> = { date: "По дате, ближайшие сверху", urgent: "Сначала срочные", sum: "По сумме" };
const REFRESH_MS = 30_000;

interface SavedView extends OrderView {
  sort: OrderSort;
}
const EMPTY_VIEW: SavedView = { filter: "all", host: "", owner: "", query: "", sort: "date" };

function readView(): SavedView {
  try {
    const raw = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null") as Partial<SavedView> | null;
    if (!raw || typeof raw !== "object") return EMPTY_VIEW;
    return {
      filter: raw.filter && raw.filter in FILTER_TITLES ? raw.filter : "all",
      host: typeof raw.host === "string" ? raw.host : "",
      owner: typeof raw.owner === "string" ? raw.owner : "",
      // Поиск не запоминаем: в нём может быть имя или телефон клиента.
      query: "",
      sort: raw.sort && raw.sort in SORT_TITLES ? raw.sort : "date",
    };
  } catch {
    return EMPTY_VIEW;
  }
}
function saveView(v: SavedView): void {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ filter: v.filter, host: v.host, owner: v.owner, sort: v.sort }));
  } catch {
    /* без памяти — не беда */
  }
}

function useWide(): boolean {
  const query = "(min-width: 1024px)";
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches === true);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; board: OrdersBoard; offset: number };

/** Ответ сервера и сдвиг часов: время строк — по часам сервера (неверные часы телефона не перекрашивают строки). */
function useOrders(): [Load, () => void] {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!eventsRepo) return;
    const repo = eventsRepo;
    let alive = true;
    const fetchNow = (first: boolean) => {
      if (!first && document.visibilityState !== "visible") return;
      repo
        .orders()
        .then((board) => alive && setLoad({ status: "ready", board, offset: board.now - Date.now() }))
        .catch(() => {
          // Обновление не удалось — прежние строки остаются на экране.
          if (alive && first) setLoad((prev) => (prev.status === "ready" ? prev : { status: "error" }));
        });
    };
    fetchNow(true);
    const timer = window.setInterval(() => fetchNow(false), REFRESH_MS);
    const onVisible = () => fetchNow(false);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [attempt]);
  return [
    load,
    () => {
      setLoad({ status: "loading" });
      setAttempt((n) => n + 1);
    },
  ];
}

function useServerNow(offset: number): number {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    setNow(Date.now() + offset);
    const timer = window.setInterval(() => setNow(Date.now() + offset), 30_000);
    return () => window.clearInterval(timer);
  }, [offset]);
  return now;
}

export function OrdersTab({ profile }: { profile: UserProfile }) {
  const [load, retry] = useOrders();
  if (!eventsRepo) return <p className="muted">«Активные заказы» доступны на своём сервере JoyRest.</p>;
  if (load.status === "loading") return <ListSkeleton />;
  if (load.status === "error") return <LoadFailedInline onRetry={retry} />;
  return <OrdersBoardView board={load.board} offset={load.offset} owner={permissions.canSeeAgencyShare(profile)} />;
}

function OrdersBoardView({ board, offset, owner }: { board: OrdersBoard; offset: number; owner: boolean }) {
  const now = useServerNow(offset);
  const wide = useWide();
  const navigate = useNavigate();
  const [view, setView] = useState<SavedView>(readView);
  const change = (patch: Partial<SavedView>) =>
    setView((v) => {
      const next = { ...v, ...patch };
      saveView(next);
      return next;
    });

  const rows = useMemo(() => orderRows(board, now, view.sort), [board, now, view.sort]);
  const counts = useMemo(() => filterCounts(rows), [rows]);
  const summary = useMemo(() => summaryOf(rows, board, now), [rows, board, now]);
  const hosts = useMemo(() => [...new Set(rows.map((r) => r.host.replace(/ · отключён$/, "")).filter((h) => h && h !== "—" && h !== "не назначен"))].sort(), [rows]);
  const owners = useMemo(() => [...new Set(rows.map((r) => r.ownerName).filter(Boolean))].sort(), [rows]);
  const shown = useMemo(() => filterRows(rows, view), [rows, view]);
  const groups = ORDER_GROUPS.map((g) => ({ group: g, rows: shown.filter((r) => r.group === g) })).filter((g) => g.rows.length > 0);

  if (rows.length === 0) {
    return (
      <section className="card stack orders-empty">
        <h2>Активных заказов пока нет</h2>
        <p className="muted">Здесь будут все, кого сейчас ведём: брони, переговоры, прошедшие без отметок и отмены.</p>
        <Link className="btn btn--secondary" to="/studio/calendar?tab=events">Записать мероприятие</Link>
      </section>
    );
  }

  return (
    <div className="stack orders">
      <p className="muted small">
        Все, кого сейчас ведём: забронировали, договариваемся, прошло и ещё не закрыто, или отменено. Касание строки — карточка мероприятия
        или клиента. Обновляется само раз в 30 секунд.
      </p>

      <section className="orders-sum" aria-label="Итоги">
        <Tile title="Забронировано впереди" value={String(summary.booked)} sub={summary.nearest ? `ближайшее — ${summary.nearest}` : "впереди ничего нет"} />
        <Tile title="На сумму" value={rub(summary.total)} sub={`на месте — ${rub(summary.due)}${summary.noPrice ? ` · ${plural(summary.noPrice, ["без стоимости", "без стоимости", "без стоимости"])}` : ""}`} />
        {owner && <Tile title="Агентству" value={rub(summary.agency)} sub={`ведущим — ${rub(summary.hosts)} · оценка`} tone="gold" />}
        <Tile title="Предоплаты внесены" value={rub(summary.prepaidSum)} sub={`${summary.prepaidCount} из ${summary.booked} заказов`} />
        <Tile
          title="Вернуть предоплату"
          value={rub(summary.refundSum)}
          sub={summary.refundCount ? `${plural(summary.refundCount, ["клиент ждёт", "клиента ждут", "клиентов ждут"])} возврата` : "возвратов нет"}
          tone={summary.refundCount ? "bad" : undefined}
        />
        <Tile title="Требуют внимания" value={String(summary.alerts)} sub="строки подсвечены" tone={summary.alerts ? "bad" : undefined} />
      </section>

      <div className="orders-chips" role="group" aria-label="Какие заказы">
        {(Object.keys(FILTER_TITLES) as OrderFilter[]).map((f) => (
          <button key={f} type="button" className={view.filter === f ? "orders-chip is-on" : "orders-chip"} aria-pressed={view.filter === f} onClick={() => change({ filter: f })}>
            {FILTER_TITLES[f]} · {counts[f]}
          </button>
        ))}
      </div>

      <div className="orders-tools">
        <SearchField
          value={view.query}
          onChange={(query) => setView((v) => ({ ...v, query }))}
          label="Поиск"
          placeholder="Имя, телефон или ведущий"
          candidates={rows.map((r) => r.client)}
        />
        <label className="orders-select">
          <span>Ведущий</span>
          <select value={view.host} onChange={(e) => change({ host: e.target.value })}>
            <option value="">Все</option>
            {hosts.map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
        </label>
        <label className="orders-select">
          <span>Кто ведёт клиента</span>
          <select value={view.owner} onChange={(e) => change({ owner: e.target.value })}>
            <option value="">Все</option>
            {owners.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
            <option value="—">Никто не взял</option>
          </select>
        </label>
        <label className="orders-select">
          <span>Порядок</span>
          <select value={view.sort} onChange={(e) => change({ sort: e.target.value as OrderSort })}>
            {(Object.keys(SORT_TITLES) as OrderSort[]).map((s) => (
              <option key={s} value={s}>{SORT_TITLES[s]}</option>
            ))}
          </select>
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="muted">По этим условиям ничего нет. <button type="button" className="btn--quiet orders-reset" onClick={() => change({ ...EMPTY_VIEW })}>Показать все</button></p>
      ) : wide ? (
        <div className="orders-scroll">
          <div className={owner ? "orders-table" : "orders-table orders-table--no-agency"} role="table" aria-label="Активные заказы">
            <div className="orders-row orders-head orders-head--top" role="row">
              <span role="columnheader" className="orders-span-client">Клиент</span>
              <span role="columnheader" className="orders-span-host orders-sep">Ведущий</span>
              <span role="columnheader" className="orders-span-money orders-sep">Деньги</span>
              <span role="columnheader" className="orders-sep">Что делать</span>
            </div>
            <div className="orders-row orders-head" role="row">
              <span role="columnheader">Дата и время</span>
              <span role="columnheader">Клиент и мероприятие</span>
              <span role="columnheader">Статус клиента</span>
              <span role="columnheader" className="orders-sep">Кто</span>
              <span role="columnheader">Подтвердил</span>
              <span role="columnheader">Провёл</span>
              <span role="columnheader" className="orders-sep">Итого</span>
              <span role="columnheader">Предоплата</span>
              <span role="columnheader">Остаток</span>
              {owner && <span role="columnheader">Агентству</span>}
              <span role="columnheader" className="orders-sep">Следующий шаг</span>
            </div>
            {groups.map(({ group, rows: list }) => (
              <div key={group} className={`orders-group orders-group--${group}`} role="rowgroup">
                <GroupHead group={group} rows={list} />
                {list.map((r) => (
                  <TableRow key={r.key} row={r} owner={owner} open={() => navigate(r.href)} />
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="orders-cards">
          {groups.map(({ group, rows: list }) => (
            <section key={group} className={`orders-group orders-group--${group}`} aria-label={GROUP_TITLES[group].title}>
              <GroupHead group={group} rows={list} />
              {list.map((r) => (
                <Card key={r.key} row={r} owner={owner} />
              ))}
            </section>
          ))}
        </div>
      )}

      <p className="orders-legend muted small">
        <span><i className="plan-light__dot orders-dot--ok" aria-hidden="true" /> Принял</span>
        <span><i className="plan-light__dot orders-dot--wait" aria-hidden="true" /> Ждёт ведущего</span>
        <span><i className="plan-light__dot orders-dot--late" aria-hidden="true" /> Не подтвердил · нужна замена</span>
        <span><i className="plan-light__dot orders-dot--held" aria-hidden="true" /> Проведено</span>
        <span><i className="plan-light__dot orders-dot--check" aria-hidden="true" /> Прошло — не отмечено</span>
        <span><i className="plan-light__dot orders-dot--off" aria-hidden="true" /> Отменено</span>
        <span>Остаток ведущий получает на месте.{owner ? " «Агентству» — оценка: 55% ведущему, не меньше 5 000 ₽, от 46 гостей — 20 000 ₽." : ""}</span>
      </p>
    </div>
  );
}

function Tile({ title, value, sub, tone }: { title: string; value: string; sub: string; tone?: "gold" | "bad" }) {
  return (
    <div className={tone ? `orders-tile orders-tile--${tone}` : "orders-tile"}>
      <span className="orders-tile__title">{title}</span>
      <b className="orders-tile__value">{value}</b>
      <span className="orders-tile__sub">{sub}</span>
    </div>
  );
}

function GroupHead({ group, rows }: { group: OrderGroup; rows: OrderRow[] }) {
  return (
    <div className="orders-group__head">
      <h3>
        <i aria-hidden="true" />
        {GROUP_TITLES[group].title}
        <small>{GROUP_TITLES[group].hint}</small>
      </h3>
      <span>{groupMeta(group, rows)}</span>
    </div>
  );
}

function Dot({ mark }: { mark: Mark }) {
  return (
    <div className={`orders-mark orders-mark--${mark.tone}`}>
      <span className="orders-mark__label">
        {mark.tone !== "none" && <i className={`plan-light__dot orders-dot--${mark.tone}`} aria-hidden="true" />}
        {mark.label}
      </span>
      {mark.sub && <span className="orders-sub">{mark.sub}</span>}
    </div>
  );
}

function Cash({ money }: { money: Money }) {
  return (
    <div className={`orders-money orders-money--${money.tone}`}>
      <b>{money.text}</b>
      {money.sub && <span className="orders-sub">{money.sub}</span>}
    </div>
  );
}

function agencyText(r: OrderRow): string {
  if (r.agency === null) return "—";
  return `${r.approx ? "≈ " : ""}${rub(r.agency)}`;
}

function TableRow({ row: r, owner, open }: { row: OrderRow; owner: boolean; open: () => void }) {
  return (
    <div
      className={r.alert ? "orders-row orders-line is-alert" : "orders-line orders-row"}
      role="row"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      aria-label={`${r.client}, ${r.date}${r.alert ? " — требует внимания" : ""}`}
    >
      <div role="cell">
        <b>{r.date}</b>
        <span className="orders-sub">{r.time}</span>
        {r.when && <span className={r.whenAlert ? "orders-sub is-bad" : "orders-sub"}>{r.when}</span>}
      </div>
      <div role="cell">
        <b>{r.client}</b>
        <span>{r.what}</span>
        <span className={r.placeWarn ? "orders-sub is-warn" : "orders-sub"}>{r.details}</span>
      </div>
      <div role="cell">
        {r.status ? <span className={`orders-st orders-st--${r.status.tone}`}>{r.status.label}</span> : <span className="orders-sub">нет в «Клиентах»</span>}
        <span className="orders-sub">{r.who}</span>
      </div>
      <div role="cell" className={r.hostWarn ? "orders-sep is-warn" : "orders-sep"}>{r.host}</div>
      <div role="cell"><Dot mark={r.accepted} /></div>
      <div role="cell"><Dot mark={r.held} /></div>
      <div role="cell" className="orders-sep">
        <b className={r.priceStruck ? "orders-struck" : r.price === null ? "orders-muted" : undefined}>{r.priceText}</b>
        {r.priceSub && <span className="orders-sub">{r.priceSub}</span>}
      </div>
      <div role="cell"><Cash money={r.prepay} /></div>
      <div role="cell"><Cash money={r.due} /></div>
      {owner && (
        <div role="cell" className="orders-agency">
          <b>{agencyText(r)}</b>
          {r.hostPay !== null && <span className="orders-sub">ведущему {r.approx ? "≈ " : ""}{rub(r.hostPay)}</span>}
        </div>
      )}
      <div role="cell" className={`orders-sep orders-step orders-step--${r.stepTone}`}>{r.step}</div>
    </div>
  );
}

function Card({ row: r, owner }: { row: OrderRow; owner: boolean }) {
  return (
    <Link to={r.href} className={r.alert ? "orders-card is-alert" : "orders-card"}>
      <div className="orders-card__top">
        <div>
          <b className="orders-card__date">{r.date}</b>
          <span className="orders-sub">
            {r.time}
            {r.when && <> · <span className={r.whenAlert ? "is-bad" : undefined}>{r.when}</span></>}
          </span>
        </div>
        <b className={r.priceStruck ? "orders-card__price orders-struck" : "orders-card__price"}>{r.priceText}</b>
      </div>
      <b>{r.client}</b>
      <span>{r.what}</span>
      <span className={r.placeWarn ? "orders-sub is-warn" : "orders-sub"}>{r.details}</span>
      <div className="orders-card__who">
        {r.status ? <span className={`orders-st orders-st--${r.status.tone}`}>{r.status.label}</span> : <span className="orders-sub">нет в «Клиентах»</span>}
        <span className="orders-sub">
          {r.who}
          {r.host !== "—" ? ` · ведущий ${r.host}` : ""}
        </span>
      </div>
      {r.group !== "talk" && (
        <div className="orders-card__marks">
          <div>
            <span className="orders-sub">Ведущий подтвердил</span>
            <Dot mark={r.accepted} />
          </div>
          <div>
            <span className="orders-sub">Ведущий провёл</span>
            <Dot mark={r.held} />
          </div>
        </div>
      )}
      <div className={owner ? "orders-card__money" : "orders-card__money orders-card__money--two"}>
        <div>
          <span className="orders-sub">Предоплата</span>
          <Cash money={r.prepay} />
        </div>
        <div>
          <span className="orders-sub">Остаток</span>
          <Cash money={r.due} />
        </div>
        {owner && (
          <div className="orders-agency">
            <span className="orders-sub">Агентству</span>
            <b>{agencyText(r)}</b>
            {r.hostPay !== null && <span className="orders-sub">ведущему {r.approx ? "≈ " : ""}{rub(r.hostPay)}</span>}
          </div>
        )}
      </div>
      <span className={`orders-step orders-step--${r.stepTone}`}>{r.step}</span>
    </Link>
  );
}
