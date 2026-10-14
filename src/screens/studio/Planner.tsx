/**
 * Планировщик мероприятий (CLAUDE.md, раздел 3, «Календарь»; решение владельца 14 октября 2026).
 * Владелец записывает мероприятие: клиент, телефон, дата, время, что за мероприятие, ведущий — и видит
 * все мероприятия: день по часам (таймлайн — что идёт и кто ведёт), 7 дней, месяц и списки «Предстоящие»,
 * «Идут сейчас», «Архив», «Отменённые». Ведущий видит свои мероприятия без правки.
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { addDays, availabilityOf, dayIndex, dayTitle, DEFAULT_QUERY, rangeLabel, STATUS_TITLES, timeLabel, todayMoscow, type MemberStatus } from "../../core/calendar";
import {
  bookingId,
  EVENT_LIMITS,
  EVENT_STATUS_TITLES,
  EVENT_TITLES,
  eventsOfDay,
  eventStatus,
  sortEvents,
  timelineHours,
  timelineOf,
  weekStart,
  type EventStatus,
} from "../../core/events";
import { professionOf } from "../../core/professions";
import { calendarRepo, eventsRepo, useLoad, type AgencyEvent, type AvailabilityEntry, type CalendarMember } from "../../data";
import { useConfirm } from "../../components/ConfirmDialog";
import { ListSkeleton } from "../../components/Skeleton";
import { LoadFailedInline } from "../../components/Status";
import { brand, teamColors } from "../../themes/brand";
import { MonthGrid, MonthHeader, monthRange, newId, Pill, shiftMonth, TimeSelects, useLastReady } from "./calendarParts";

type View = "day" | "week" | "month" | "list";
type ListFilter = "upcoming" | "now" | "past" | "cancelled";

const VIEW_TITLES: Record<View, string> = { day: "День", week: "7 дней", month: "Месяц", list: "Списком" };
const FILTER_TITLES: Record<ListFilter, string> = { upcoming: "Предстоящие", now: "Идут сейчас", past: "Архив", cancelled: "Отменённые" };
const EVENT_STATUS_COLORS: Record<EventStatus, string> = { upcoming: brand.gold, now: brand.sage, past: brand.taupe, cancelled: brand.coral };
const MEMBER_COLORS: Record<MemberStatus, string> = { free: brand.sage, partial: brand.gold, unknown: brand.taupe, busy: brand.coral };

/** Цвет ведущего на таймлайне — постоянный по его id (пастель, текст тёмный). */
function hostColor(hostId: string): string {
  let h = 0;
  for (const ch of hostId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return teamColors[h % teamColors.length] ?? brand.gold;
}

const eventName = (e: AgencyEvent) => e.title || "Мероприятие";

/** Окно загрузки для дня, недели и месяца выбранной даты (до 62 дней). */
function loadRange(day: string): { from: string; to: string } {
  const month = monthRange(day);
  const week = weekStart(day);
  const from = week < month.from ? week : month.from;
  const weekEnd = addDays(week, 7);
  return { from, to: weekEnd > month.to ? weekEnd : month.to };
}

export function Planner({ owner, onToast }: { owner: boolean; onToast: (text: string) => void }) {
  const today = todayMoscow();
  const [view, setView] = useState<View>("day");
  const [day, setDay] = useState(today);
  const [filter, setFilter] = useState<ListFilter>("upcoming");
  const [form, setForm] = useState<{ event?: AgencyEvent; day: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // Удалённые и изменённые здесь — чтобы списки не показывали устаревшее до перезагрузки.
  const [removed, setRemoved] = useState<string[]>([]);
  const [changed, setChanged] = useState<AgencyEvent[]>([]);
  const range = loadRange(day);
  const [state, retry, update] = useLoad(() => (eventsRepo ? eventsRepo.range(range.from, range.to) : Promise.resolve([] as AgencyEvent[])), [range.from, range.to]);
  const shown = useLastReady(state);
  const [confirm, ask] = useConfirm();
  // Раз в минуту — перерисовка: «Идёт сейчас» и линия «сейчас» на таймлайне.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  function replace(saved: AgencyEvent) {
    update((data) => [...data.filter((e) => e.id !== saved.id), saved]);
    setChanged((list) => [...list.filter((e) => e.id !== saved.id), saved]);
  }

  function cancel(event: AgencyEvent) {
    ask({
      title: `Отменить «${eventName(event)}»?`,
      text: `${dayTitle(event.day)}, ${rangeLabel(event.start, event.end)} · ведущий ${event.hostName}. Мероприятие уйдёт в «Отменённые», у ведущего время освободится. Вернуть можно там же.`,
      confirmLabel: "Отменить мероприятие",
      run: async () => {
        if (!eventsRepo) return;
        replace(await eventsRepo.cancel(event.id));
        onToast("Мероприятие отменено");
      },
    });
  }

  function restore(event: AgencyEvent) {
    ask({
      title: `Вернуть «${eventName(event)}»?`,
      text: `${dayTitle(event.day)}, ${rangeLabel(event.start, event.end)}. У ведущего ${event.hostName} время снова станет занятым.`,
      confirmLabel: "Вернуть",
      run: async () => {
        if (!eventsRepo) return;
        replace(await eventsRepo.restore(event.id));
        onToast("Мероприятие возвращено");
      },
    });
  }

  function remove(event: AgencyEvent) {
    ask({
      title: `Удалить «${eventName(event)}» навсегда?`,
      text: `${dayTitle(event.day)}, ${rangeLabel(event.start, event.end)}. Запись исчезнет из «Отменённых», вернуть её будет нельзя.`,
      confirmLabel: "Удалить навсегда",
      run: async () => {
        if (!eventsRepo) return;
        await eventsRepo.remove(event.id);
        update((data) => data.filter((e) => e.id !== event.id));
        setRemoved((ids) => [...ids, event.id]);
        onToast("Мероприятие удалено");
      },
    });
  }

  if (form) {
    return (
      <EventForm
        initial={form.event}
        day={form.day}
        onCancel={() => setForm(null)}
        onSaved={(saved) => {
          replace(saved);
          setForm(null);
          setDay(saved.day);
          setOpenId(saved.id);
          if (view === "list") setView("day");
          onToast(form.event ? "Мероприятие сохранено" : `Мероприятие записано: ${saved.hostName}`);
        }}
      />
    );
  }

  const card = (e: AgencyEvent) => (
    <EventCard
      key={e.id}
      event={e}
      now={now}
      owner={owner}
      onEdit={() => setForm({ event: e, day: e.day })}
      onCancel={() => cancel(e)}
      onRestore={() => restore(e)}
      onRemove={() => remove(e)}
    />
  );

  return (
    <>
      <p className="muted">
        {owner
          ? "Все мероприятия агентства: кто, когда и у кого ведёт. Ведущий видит свои мероприятия, его время в календаре занято."
          : "Мероприятия, закреплённые за вами владельцем."}
      </p>
      {owner && (
        <div className="actions">
          <button type="button" className="btn btn--block" onClick={() => setForm({ day: day < today ? today : day })}>
            + Новое мероприятие
          </button>
        </div>
      )}
      <div className="seg plan-views" role="group" aria-label="Вид">
        {(Object.keys(VIEW_TITLES) as View[]).map((v) => (
          <button key={v} type="button" className={view === v ? "seg__btn is-on" : "seg__btn"} aria-pressed={view === v} onClick={() => setView(v)}>
            {VIEW_TITLES[v]}
          </button>
        ))}
      </div>

      {view === "list" ? (
        <EventList filter={filter} onFilter={setFilter} now={now} removed={removed} changed={changed} render={card} />
      ) : !shown ? (
        state.status === "error" ? <LoadFailedInline onRetry={retry} /> : <ListSkeleton />
      ) : (
        <>
          {state.status === "error" && <LoadFailedInline onRetry={retry} />}
          {view === "day" && (
            <DayView
              day={day}
              today={today}
              now={now}
              events={shown}
              stale={state.status !== "ready"}
              openId={openId}
              onOpen={setOpenId}
              onDay={setDay}
              owner={owner}
              onAdd={() => setForm({ day })}
              render={card}
            />
          )}
          {view === "week" && (
            <WeekView
              day={day}
              today={today}
              events={shown}
              stale={state.status !== "ready"}
              onDay={setDay}
              onPick={(d, id) => {
                setDay(d);
                setOpenId(id ?? null);
                setView("day");
              }}
            />
          )}
          {view === "month" && (
            <section className="card stack" aria-label="Месяц">
              <MonthHeader year={monthRange(day).year} month={monthRange(day).month} onPrev={() => setDay(shiftMonth(day, -1))} onNext={() => setDay(shiftMonth(day, 1))} />
              {state.status === "loading" && <p className="muted small">Загружаем месяц…</p>}
              <MonthGrid
                year={monthRange(day).year}
                month={monthRange(day).month}
                selected={day}
                today={today}
                render={(d) => {
                  const n = shown.filter((e) => !e.cancelled && e.day === d).length;
                  return (
                    <span className={n > 0 ? "cal-count" : "cal-count cal-count--none"} style={{ "--count-color": brand.gold } as CSSProperties}>
                      {n > 0 ? n : ""}
                    </span>
                  );
                }}
                onPick={(d) => {
                  setDay(d);
                  setView("day");
                }}
              />
              <p className="muted small">Число в дне — сколько мероприятий. Коснитесь дня — откроется день по часам.</p>
            </section>
          )}
        </>
      )}
      {confirm}
    </>
  );
}

// ───────────────────────────── День: таймлайн ─────────────────────────────

/** Пикселей на минуту таймлайна. */
const PX = 1.1;

function DayView({
  day,
  today,
  now,
  events,
  stale,
  openId,
  onOpen,
  onDay,
  owner,
  onAdd,
  render,
}: {
  day: string;
  today: string;
  now: number;
  events: AgencyEvent[];
  stale: boolean;
  openId: string | null;
  onOpen: (id: string | null) => void;
  onDay: (day: string) => void;
  owner: boolean;
  onAdd: () => void;
  render: (e: AgencyEvent) => ReactNode;
}) {
  const items = timelineOf(events, day);
  const { from, to } = timelineHours(items);
  const hours: number[] = [];
  for (let m = from; m <= to; m += 60) hours.push(m);
  // Линия «сейчас» — только в сегодняшнем дне (московское время).
  const nowMin = Math.floor((now + 3 * 3_600_000) / 60_000) % 1440;
  const opened = items.find((i) => i.event.id === openId)?.event ?? null;
  return (
    <section className="card stack" aria-labelledby="plan-day">
      <div className="cal-month">
        <button type="button" className="btn btn--quiet" aria-label="Прошлый день" onClick={() => onDay(addDays(day, -1))}>
          ←
        </button>
        <span className="cal-month__title" id="plan-day">
          {dayTitle(day)}
        </span>
        <button type="button" className="btn btn--quiet" aria-label="Следующий день" onClick={() => onDay(addDays(day, 1))}>
          →
        </button>
      </div>
      <div className="plan-day-tools">
        <label className="field">
          <span className="field__label">Дата</span>
          <input type="date" value={day} onChange={(e) => dayIndex(e.target.value) !== null && onDay(e.target.value)} />
        </label>
        {day !== today && (
          <button type="button" className="btn btn--quiet" onClick={() => onDay(today)}>
            Сегодня
          </button>
        )}
      </div>
      <p className="muted small" aria-live="polite">
        {items.length === 0 ? "В этот день мероприятий нет." : `Мероприятий: ${items.length}`}
      </p>
      <div className={stale ? "plan-timeline is-stale" : "plan-timeline"} style={{ height: `${(to - from) * PX}px` }} aria-label={`День по часам: ${dayTitle(day)}`}>
        {hours.map((m) => (
          <div key={m} className="plan-hour" style={{ top: `${(m - from) * PX}px` }}>
            <span className="plan-hour__label">{timeLabel(m)}</span>
          </div>
        ))}
        {day === today && nowMin >= from && nowMin <= to && <div className="plan-now" style={{ top: `${(nowMin - from) * PX}px` }} aria-label={`Сейчас ${timeLabel(nowMin)}`} />}
        <div className="plan-lanes">
          {items.map((it) => {
            const e = it.event;
            const height = Math.max(44, (it.bottom - it.top) * PX - 2);
            return (
              <button
                key={e.id}
                type="button"
                className={`plan-event${openId === e.id ? " is-open" : ""}`}
                style={
                  {
                    top: `${(it.top - from) * PX}px`,
                    height: `${height}px`,
                    left: `${(it.lane / it.lanes) * 100}%`,
                    width: `calc(${100 / it.lanes}% - 4px)`,
                    "--plan-color": hostColor(e.hostId),
                  } as CSSProperties
                }
                aria-expanded={openId === e.id}
                onClick={() => onOpen(openId === e.id ? null : e.id)}
              >
                <span className="plan-event__time">{e.day === day ? rangeLabel(e.start, e.end) : `до ${timeLabel(e.end)}`}</span>
                <span className="plan-event__title">{eventName(e)}</span>
                <span className="plan-event__host">Ведёт: {e.hostName}</span>
                {e.clientName && <span className="plan-event__client">{e.clientName}</span>}
              </button>
            );
          })}
        </div>
      </div>
      {opened && render(opened)}
      {owner && (
        <div className="actions">
          <button type="button" className="btn btn--secondary btn--block" onClick={onAdd}>
            + Мероприятие в этот день
          </button>
        </div>
      )}
    </section>
  );
}

// ───────────────────────────── 7 дней ─────────────────────────────

function WeekView({
  day,
  today,
  events,
  stale,
  onDay,
  onPick,
}: {
  day: string;
  today: string;
  events: AgencyEvent[];
  stale: boolean;
  onDay: (day: string) => void;
  onPick: (day: string, eventId?: string) => void;
}) {
  const monday = weekStart(day);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const short = (d: string) => dayTitle(d).replace(/ \d{4}$/, "");
  return (
    <section className="card stack" aria-labelledby="plan-week">
      <div className="cal-month">
        <button type="button" className="btn btn--quiet" aria-label="Прошлая неделя" onClick={() => onDay(addDays(day, -7))}>
          ←
        </button>
        <span className="cal-month__title" id="plan-week">
          {Number(monday.slice(8))}–{short(addDays(monday, 6)).split(", ")[1]}
        </span>
        <button type="button" className="btn btn--quiet" aria-label="Следующая неделя" onClick={() => onDay(addDays(day, 7))}>
          →
        </button>
      </div>
      <ol className={stale ? "plan-week is-stale" : "plan-week"}>
        {days.map((d) => {
          const list = eventsOfDay(events, d).filter((e) => e.day === d);
          return (
            <li key={d} className={d === today ? "plan-week__day is-today" : "plan-week__day"}>
              <button type="button" className="plan-week__head" onClick={() => onPick(d)}>
                <span>{short(d)}</span>
                <span className="muted small">{list.length ? `${list.length}` : "—"}</span>
              </button>
              {list.length > 0 && (
                <ul className="plan-week__events">
                  {list.map((e) => (
                    <li key={e.id}>
                      <button type="button" className="plan-chip" style={{ "--plan-color": hostColor(e.hostId) } as CSSProperties} onClick={() => onPick(d, e.id)}>
                        <b>{rangeLabel(e.start, e.end)}</b> · {eventName(e)} · {e.hostName}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ───────────────────────────── Списки ─────────────────────────────

function EventList({
  filter,
  onFilter,
  now,
  removed,
  changed,
  render,
}: {
  filter: ListFilter;
  onFilter: (f: ListFilter) => void;
  now: number;
  removed: string[];
  changed: AgencyEvent[];
  render: (e: AgencyEvent) => ReactNode;
}) {
  const scope = filter === "now" ? "upcoming" : filter;
  const [state, retry] = useLoad(() => (eventsRepo ? eventsRepo.list(scope) : Promise.resolve([] as AgencyEvent[])), [scope]);
  const shown = useLastReady(state);
  const events = useMemo(() => {
    // Правки на этом экране (отмена, возврат, удаление) — сразу, без перезагрузки списка.
    const all = [...(shown ?? []).filter((e) => !removed.includes(e.id) && !changed.some((c) => c.id === e.id)), ...changed.filter((c) => !removed.includes(c.id))];
    if (filter === "cancelled") return sortEvents(all.filter((e) => e.cancelled), true);
    if (filter === "past") return sortEvents(all.filter((e) => eventStatus(e, now) === "past"), true);
    if (filter === "upcoming") return sortEvents(all.filter((e) => eventStatus(e, now) === "upcoming"), false);
    if (filter === "now") return sortEvents(all.filter((e) => eventStatus(e, now) === "now"), false);
    return [];
  }, [shown, filter, now, removed, changed]);
  return (
    <>
      <div className="seg plan-views" role="group" aria-label="Какие мероприятия">
        {(Object.keys(FILTER_TITLES) as ListFilter[]).map((f) => (
          <button key={f} type="button" className={filter === f ? "seg__btn is-on" : "seg__btn"} aria-pressed={filter === f} onClick={() => onFilter(f)}>
            {FILTER_TITLES[f]}
          </button>
        ))}
      </div>
      {!shown ? (
        state.status === "error" ? <LoadFailedInline onRetry={retry} /> : <ListSkeleton />
      ) : (
        <div className={state.status === "ready" ? "stack" : "stack is-stale"}>
          {events.length === 0 && <p className="muted">{filter === "past" ? "В архиве пока пусто." : filter === "cancelled" ? "Отменённых нет." : filter === "now" ? "Сейчас ничего не идёт." : "Предстоящих мероприятий нет."}</p>}
          {events.map(render)}
        </div>
      )}
    </>
  );
}

// ───────────────────────────── Карточка ─────────────────────────────

function EventCard({
  event,
  now,
  owner,
  onEdit,
  onCancel,
  onRestore,
  onRemove,
}: {
  event: AgencyEvent;
  now: number;
  owner: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onRestore: () => void;
  onRemove: () => void;
}) {
  const status = eventStatus(event, now);
  return (
    <article className="card stack stack--tight plan-card" style={{ "--plan-color": hostColor(event.hostId) } as CSSProperties}>
      <div className="cal-person__head">
        <span className="cal-person__name">{eventName(event)}</span>
        <Pill color={EVENT_STATUS_COLORS[status]}>{EVENT_STATUS_TITLES[status]}</Pill>
      </div>
      <p>
        <b>{dayTitle(event.day)}</b>, {rangeLabel(event.start, event.end)}
      </p>
      <dl className="plan-facts">
        <dt>Ведёт</dt>
        <dd>{event.hostName || "—"}</dd>
        {event.clientName && (
          <>
            <dt>Клиент</dt>
            <dd>{event.clientName}</dd>
          </>
        )}
        {event.clientPhone && (
          <>
            <dt>Телефон</dt>
            <dd>
              <a href={`tel:${event.clientPhone.replace(/[^\d+]/g, "")}`}>{event.clientPhone}</a>
            </dd>
          </>
        )}
        {event.place && (
          <>
            <dt>Где</dt>
            <dd>{event.place}</dd>
          </>
        )}
        {event.guests !== null && (
          <>
            <dt>Гостей</dt>
            <dd>{event.guests}</dd>
          </>
        )}
        {event.note && (
          <>
            <dt>Заметка</dt>
            <dd className="plan-facts__note">{event.note}</dd>
          </>
        )}
      </dl>
      {owner && (
        <div className="actions">
          {event.cancelled ? (
            <>
              <button type="button" className="btn btn--secondary btn--block" onClick={onRestore}>
                Вернуть мероприятие
              </button>
              <button type="button" className="btn btn--quiet btn--block" onClick={onRemove}>
                Удалить навсегда
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn--secondary btn--block" onClick={onEdit}>
                Изменить
              </button>
              <button type="button" className="btn btn--quiet btn--block" onClick={onCancel}>
                Отменить мероприятие
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
}

// ───────────────────────────── Форма ─────────────────────────────

export interface EventDraft {
  day: string;
  start?: number;
  end?: number;
  hostId?: string;
}

/**
 * Новое мероприятие или правка (только владелец). Рядом с каждым ведущим — может ли он в это время
 * (по его календарю); занятого выбрать можно, но форма предупреждает.
 */
export function EventForm({
  initial,
  day: initialDay,
  draft,
  onSaved,
  onCancel,
}: {
  initial?: AgencyEvent;
  day: string;
  draft?: EventDraft;
  onSaved: (event: AgencyEvent) => void;
  onCancel: () => void;
}) {
  const [id] = useState(() => initial?.id ?? newId());
  const [day, setDay] = useState(initial?.day ?? draft?.day ?? initialDay);
  const [start, setStart] = useState(initial?.start ?? draft?.start ?? DEFAULT_QUERY.start);
  const [end, setEnd] = useState(initial?.end ?? draft?.end ?? DEFAULT_QUERY.end);
  const [hostId, setHostId] = useState(initial?.hostId ?? draft?.hostId ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [clientName, setClientName] = useState(initial?.clientName ?? "");
  const [clientPhone, setClientPhone] = useState(initial?.clientPhone ?? "");
  const [place, setPlace] = useState(initial?.place ?? "");
  const [guests, setGuests] = useState(initial?.guests != null ? String(initial.guests) : "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [allTeam, setAllTeam] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [team, retryTeam] = useLoad(
    () => (calendarRepo ? calendarRepo.team(day, addDays(day, 1)) : Promise.resolve({ members: [] as CalendarMember[], entries: [] as AvailabilityEntry[] })),
    [day],
  );
  const teamData = useLastReady(team);
  const today = todayMoscow();

  const members = (teamData?.members ?? []).filter((m) => allTeam || m.owner || professionOf(m.profession) === "host" || m.uid === hostId);
  const statusOf = (uid: string) =>
    availabilityOf(
      (teamData?.entries ?? []).filter((e) => e.uid === uid && e.id !== bookingId(id)),
      day,
      start,
      end,
    );
  const chosen = hostId ? statusOf(hostId) : null;
  const guestsNum = guests.trim() === "" ? null : Number(guests);
  const guestsOk = guestsNum === null || (Number.isInteger(guestsNum) && guestsNum >= 0 && guestsNum <= EVENT_LIMITS.guestsMax);
  const ready = Boolean(hostId) && (title.trim() !== "" || clientName.trim() !== "") && guestsOk;

  async function save() {
    if (!eventsRepo || !ready) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await eventsRepo.save({
          id,
          hostId,
          day,
          start,
          end,
          title: title.trim(),
          clientName: clientName.trim(),
          clientPhone: clientPhone.trim(),
          place: place.trim(),
          guests: guestsNum,
          note: note.trim(),
        }),
      );
    } catch {
      setError("Не получилось сохранить. Проверьте интернет и нажмите ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack" aria-labelledby="event-form">
      <h2 id="event-form">{initial ? "Изменить мероприятие" : "Новое мероприятие"}</h2>
      <label className="field">
        <span className="field__label">Дата</span>
        <input type="date" value={day} min={addDays(today, -31)} onChange={(e) => dayIndex(e.target.value) !== null && setDay(e.target.value)} />
      </label>
      <TimeSelects start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e); }} />
      <p className="muted small">{dayTitle(day)}, {rangeLabel(start, end)}</p>

      <label className="field">
        <span className="field__label">Ведущий</span>
        <select value={hostId} aria-label="Ведущий" onChange={(e) => setHostId(e.target.value)}>
          <option value="">Выберите…</option>
          {hostId && !members.some((m) => m.uid === hostId) && <option value={hostId}>Загружаем…</option>}
          {members.map((m) => (
            <option key={m.uid} value={m.uid}>
              {m.name} — {STATUS_TITLES[statusOf(m.uid).status].toLowerCase()}
            </option>
          ))}
        </select>
      </label>
      {team.status === "error" && <LoadFailedInline onRetry={retryTeam} />}
      <label className="choice">
        <input type="checkbox" checked={allTeam} onChange={(e) => setAllTeam(e.target.checked)} />
        <span className="choice__text">
          <span className="choice__title">Показать всю команду</span>
          <span className="choice__hint">Не только ведущие: диджеи, музыканты, фокусники и другие.</span>
        </span>
      </label>
      {chosen && (
        <p className="small">
          <Pill color={MEMBER_COLORS[chosen.status]}>{STATUS_TITLES[chosen.status]}</Pill>{" "}
          {chosen.status === "busy"
            ? `Занят: ${chosen.busy.map((b) => `${rangeLabel(b.start, b.end)}${b.note ? ` — ${b.note}` : ""}`).join("; ")}. Записать всё равно можно.`
            : chosen.status === "partial"
              ? `Свободен только ${chosen.free.map((f) => `${timeLabel(f.start)}–${timeLabel(f.end)}`).join(", ")}.`
              : chosen.status === "unknown"
                ? "Этот день не отмечен — уточните у человека."
                : "В это время свободен."}
        </p>
      )}

      <label className="field">
        <span className="field__label">Что за мероприятие</span>
        <input type="text" list="event-titles" maxLength={EVENT_LIMITS.title} value={title} placeholder="Свадьба, корпоратив…" onChange={(e) => setTitle(e.target.value)} />
      </label>
      <datalist id="event-titles">
        {EVENT_TITLES.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <label className="field">
        <span className="field__label">Клиент — имя</span>
        <input type="text" autoComplete="off" maxLength={EVENT_LIMITS.client} value={clientName} onChange={(e) => setClientName(e.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">Телефон клиента</span>
        <input type="tel" inputMode="tel" autoComplete="off" maxLength={EVENT_LIMITS.phone} value={clientPhone} placeholder="+7 …" onChange={(e) => setClientPhone(e.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">Где (адрес или площадка)</span>
        <input type="text" maxLength={EVENT_LIMITS.place} value={place} onChange={(e) => setPlace(e.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">Гостей</span>
        <input type="number" inputMode="numeric" min={0} max={EVENT_LIMITS.guestsMax} value={guests} onChange={(e) => setGuests(e.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">Заметка (программа, пожелания)</span>
        <textarea rows={3} maxLength={EVENT_LIMITS.note} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <p className="muted small">Имя и телефон клиента видят только вы и ведущий этого мероприятия.</p>
      {!ready && <p className="muted small">Нужны ведущий и что за мероприятие или имя клиента.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="btn btn--block" disabled={busy || !ready} onClick={() => void save()}>
          {busy ? "Сохраняем…" : initial ? "Сохранить" : "Записать мероприятие"}
        </button>
        <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={onCancel}>
          Отмена
        </button>
      </div>
    </section>
  );
}
