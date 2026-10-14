/**
 * Планировщик мероприятий (CLAUDE.md, раздел 3, «Календарь»; решение владельца 14 октября 2026).
 * Владелец записывает мероприятие: клиент, телефон, дата, время, что за мероприятие, ведущий — и видит
 * все мероприятия: день по часам (таймлайн — что идёт и кто ведёт), 7 дней, месяц и списки «Предстоящие»,
 * «Идут сейчас», «Архив», «Отменённые». Ведущий видит свои мероприятия без правки.
 * Карточки свёрнуты: что, когда, кто ведёт; касание — клиент, телефон, место, гости, комментарий.
 * Время «идёт сейчас» — по часам сервера (часы телефона могут спешить).
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { addDays, availabilityOf, dayIndex, dayTitle, DEFAULT_QUERY, rangeLabel, STATUS_ORDER, STATUS_TITLES, timeLabel, todayMoscow, type MemberStatus } from "../../core/calendar";
import {
  bookingId,
  crowdedClusters,
  DURATIONS,
  endIn,
  EVENT_LIMITS,
  EVENT_STATUS_TITLES,
  EVENT_TITLES,
  eventsOfDay,
  eventStatus,
  fillFromRequest,
  parseLeadText,
  PERIOD_TITLES,
  periodOf,
  shiftPeriod,
  statsOf,
  sortEvents,
  TIME_PRESETS,
  timelineHours,
  timelineOf,
  weekStart,
  type EventStatus,
  type LeadFill,
  type PeriodKind,
  type TimelineCluster,
} from "../../core/events";
import { professionOf } from "../../core/professions";
import { matchesSearch } from "../../core/search";
import { calendarRepo, clock, dataBackend, eventsRepo, useLoad, venuesRepo, type AgencyEvent, type AvailabilityEntry, type CalendarMember, type VenueRequestRecord } from "../../data";
import { useConfirm } from "../../components/ConfirmDialog";
import { Fold } from "../../components/Fold";
import { useServerNow } from "../../components/live/useServerNow";
import { SearchField } from "../../components/SearchField";
import { TelegramConnect } from "../../components/TelegramConnect";
import { ListSkeleton } from "../../components/Skeleton";
import { LoadFailedInline } from "../../components/Status";
import { brand, teamColors } from "../../themes/brand";
import { MonthGrid, MonthHeader, monthRange, newId, Pill, shiftMonth, TimeSelects, useLastReady } from "./calendarParts";

type View = "day" | "week" | "month" | "list" | "stats";
type ListFilter = "upcoming" | "now" | "past" | "cancelled";

const VIEW_TITLES: Record<View, string> = { day: "День", week: "7 дней", month: "Месяц", list: "Списком", stats: "Итоги" };
const FILTER_TITLES: Record<ListFilter, string> = { upcoming: "Предстоящие", now: "Идут сейчас", past: "Архив", cancelled: "Отменённые" };
const EVENT_STATUS_COLORS: Record<EventStatus, string> = { upcoming: brand.gold, now: brand.sage, past: brand.taupe, cancelled: brand.coral };
const MEMBER_COLORS: Record<MemberStatus, string> = { free: brand.sage, partial: brand.gold, unknown: brand.taupe, busy: brand.coral };

/** Цвет ведущего на таймлайне — постоянный по его id (пастель, текст тёмный). */
function hostColor(hostId: string): string {
  let h = 0;
  for (const ch of hostId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return teamColors[h % teamColors.length] ?? brand.gold;
}

const eventName = (e: Pick<AgencyEvent, "title">) => e.title || "Мероприятие";

/** Плашка статуса: после окончания — «Проведено», «Не состоялось» или «Прошло — отметьте». */
function statusPill(e: AgencyEvent, now: number): { title: string; color: string } {
  const status = eventStatus(e, now);
  if (e.held === true && !e.cancelled) return { title: "Проведено", color: brand.sage };
  if (e.held === false && !e.cancelled) return { title: "Не состоялось", color: brand.coral };
  if (status === "past") return { title: "Прошло — отметьте", color: brand.gold };
  return { title: EVENT_STATUS_TITLES[status], color: EVENT_STATUS_COLORS[status] };
}

/** Окно загрузки для дня, недели и месяца выбранной даты (до 62 дней). */
function loadRange(day: string): { from: string; to: string } {
  const month = monthRange(day);
  const week = weekStart(day);
  const from = week < month.from ? week : month.from;
  const weekEnd = addDays(week, 7);
  return { from, to: weekEnd > month.to ? weekEnd : month.to };
}

/** Сколько мероприятий рядом помещается на таймлайне: телефон — 2, планшет и компьютер — 4. */
function useMaxLanes(): number {
  const query = "(min-width: 700px)";
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches === true);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide ? 4 : 2;
}

/** Время по часам сервера (раз в 30 с): «Идёт сейчас» и линия «сейчас» не зависят от часов телефона. */
function usePlannerNow(): number {
  useEffect(() => {
    if (dataBackend() === "server") void clock.sync().catch(() => 0);
  }, []);
  return useServerNow(30_000);
}

type FormState = { event?: AgencyEvent; template?: AgencyEvent; day: string };

export function Planner({ owner, onToast }: { owner: boolean; onToast: (text: string) => void }) {
  const today = todayMoscow();
  const [view, setView] = useState<View>("day");
  const [day, setDay] = useState(today);
  const [filter, setFilter] = useState<ListFilter>("upcoming");
  const [form, setForm] = useState<FormState | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // Удалённые и изменённые здесь — чтобы списки не показывали устаревшее до перезагрузки.
  const [removed, setRemoved] = useState<string[]>([]);
  const [changed, setChanged] = useState<AgencyEvent[]>([]);
  const range = loadRange(day);
  const [state, retry, update] = useLoad(() => (eventsRepo ? eventsRepo.range(range.from, range.to) : Promise.resolve([] as AgencyEvent[])), [range.from, range.to]);
  const shown = useLastReady(state);
  const [confirm, ask] = useConfirm();
  const now = usePlannerNow();

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

  async function markHeld(event: AgencyEvent, held: boolean | null) {
    if (!eventsRepo) return;
    try {
      replace(await eventsRepo.setHeld(event.id, held));
      onToast(held === true ? "Отмечено: проведено" : held === false ? "Отмечено: не состоялось" : "Отметка снята");
    } catch {
      onToast("Не получилось отметить. Проверьте интернет.");
    }
  }

  if (form) {
    return (
      <EventForm
        initial={form.event}
        template={form.template}
        day={form.day}
        onCancel={() => setForm(null)}
        onSaved={(saved) => {
          replace(saved);
          setForm(null);
          setDay(saved.day);
          setOpenId(saved.id);
          setView("day");
          onToast(form.event ? "Мероприятие сохранено" : `Мероприятие записано: ${saved.hostName}`);
        }}
      />
    );
  }

  const card = (e: AgencyEvent, open = false) => (
    <EventCard
      key={e.id}
      event={e}
      now={now}
      owner={owner}
      defaultOpen={open}
      onEdit={() => setForm({ event: e, day: e.day })}
      onCopy={() => setForm({ template: e, day: e.day < today ? today : e.day })}
      onCancel={() => cancel(e)}
      onRestore={() => restore(e)}
      onRemove={() => remove(e)}
      onHeld={(held) => void markHeld(e, held)}
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
      <div className="seg plan-seg plan-seg--views" role="group" aria-label="Вид">
        {(Object.keys(VIEW_TITLES) as View[]).filter((v) => owner || v !== "stats").map((v) => (
          <button key={v} type="button" className={view === v ? "seg__btn is-on" : "seg__btn"} aria-pressed={view === v} onClick={() => setView(v)}>
            {VIEW_TITLES[v]}
          </button>
        ))}
      </div>

      {view === "stats" && owner ? (
        <StatsView now={now} changed={changed} render={(e) => card(e)} />
      ) : view === "list" ? (
        <EventList filter={filter} onFilter={setFilter} now={now} removed={removed} changed={changed} render={(e) => card(e)} />
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
              onDay={(d) => {
                setDay(d);
                setOpenId(null);
              }}
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
                  setOpenId(null);
                  setView("day");
                }}
              />
              <p className="muted small">Число в дне — сколько мероприятий. Коснитесь дня — откроется день по часам.</p>
            </section>
          )}
        </>
      )}
      {!owner && <TelegramConnect />}
      {confirm}
    </>
  );
}

// ───────────────────────────── Итоги ─────────────────────────────

function StatsView({ now, changed, render }: { now: number; changed: AgencyEvent[]; render: (e: AgencyEvent) => ReactNode }) {
  const [kind, setKind] = useState<PeriodKind>("month");
  const [anchor, setAnchor] = useState(todayMoscow());
  const period = periodOf(kind, anchor);
  const [state, retry] = useLoad(() => (eventsRepo ? eventsRepo.period(period.from, period.to) : Promise.resolve([] as AgencyEvent[])), [period.from, period.to]);
  const shown = useLastReady(state);
  const events = useMemo(() => {
    const base = (shown ?? []).filter((e) => !changed.some((c) => c.id === e.id));
    return [...base, ...changed];
  }, [shown, changed]);
  const stats = statsOf(events, period.from, period.to, now);
  const unmarked = sortEvents(
    events.filter((e) => e.day >= period.from && e.day <= period.to && !e.cancelled && e.held === null && eventStatus(e, now) === "past"),
    false,
  );
  const tiles: Array<[string, number, string]> = [
    ["Записано", stats.planned, "без отменённых"],
    ["Проведено", stats.held, "отмечено ведущим или вами"],
    ["Впереди", stats.upcoming, "ещё не начались или идут"],
    ["Не отмечено", stats.unmarked, "прошли, но без отметки"],
    ["Не состоялось", stats.failed, ""],
    ["Отменено", stats.cancelled, ""],
    ["Гостей", stats.guests, stats.guestsMissing ? `на проведённых; без числа гостей: ${stats.guestsMissing}` : "на проведённых"],
  ];
  return (
    <section className="stack" aria-labelledby="plan-stats">
      <div className="seg plan-seg plan-seg--views" role="group" aria-label="Период">
        {(Object.keys(PERIOD_TITLES) as PeriodKind[]).map((k) => (
          <button key={k} type="button" className={kind === k ? "seg__btn is-on" : "seg__btn"} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {PERIOD_TITLES[k]}
          </button>
        ))}
      </div>
      <div className="cal-month">
        <button type="button" className="btn btn--quiet" aria-label="Прошлый период" onClick={() => setAnchor(shiftPeriod(kind, anchor, -1))}>
          ←
        </button>
        <span className="cal-month__title" id="plan-stats">
          {period.title}
        </span>
        <button type="button" className="btn btn--quiet" aria-label="Следующий период" onClick={() => setAnchor(shiftPeriod(kind, anchor, 1))}>
          →
        </button>
      </div>
      {state.status === "error" && <LoadFailedInline onRetry={retry} />}
      {!shown ? (
        state.status !== "error" && <ListSkeleton />
      ) : (
        <div className={state.status === "ready" ? "stack" : "stack is-stale"}>
          <div className="plan-tiles">
            {tiles.map(([title, n, hint]) => (
              <div key={title} className="card plan-tile">
                <span className="plan-tile__n">{n}</span>
                <span className="plan-tile__title">{title}</span>
                {hint && <span className="plan-tile__hint">{hint}</span>}
              </div>
            ))}
          </div>
          {stats.byHost.length > 0 && (
            <section className="card stack stack--tight" aria-label="По ведущим">
              <h2>По ведущим</h2>
              <table className="plan-table">
                <thead>
                  <tr>
                    <th scope="col">Ведущий</th>
                    <th scope="col">Записано</th>
                    <th scope="col">Проведено</th>
                    <th scope="col">Гостей</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.byHost.map((h) => (
                    <tr key={h.hostId}>
                      <th scope="row">{h.hostName || "—"}</th>
                      <td>{h.planned}</td>
                      <td>{h.held}</td>
                      <td>{h.guests}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {stats.byTitle.length > 0 && (
            <section className="card stack stack--tight" aria-label="По видам">
              <h2>По видам мероприятий</h2>
              <table className="plan-table">
                <thead>
                  <tr>
                    <th scope="col">Что</th>
                    <th scope="col">Записано</th>
                    <th scope="col">Проведено</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.byTitle.map((t) => (
                    <tr key={t.title}>
                      <th scope="row">{t.title}</th>
                      <td>{t.planned}</td>
                      <td>{t.held}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {unmarked.length > 0 && (
            <section className="stack stack--tight" aria-label="Отметьте, состоялись ли">
              <h2>Отметьте, состоялись ли ({unmarked.length})</h2>
              <p className="muted small">Ведущий может отметить сам в «Моих мероприятиях»; вы — здесь.</p>
              {unmarked.map(render)}
            </section>
          )}
          {stats.planned === 0 && stats.cancelled === 0 && <p className="muted">За этот период мероприятий нет.</p>}
        </div>
      )}
    </section>
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
  render: (e: AgencyEvent, open?: boolean) => ReactNode;
}) {
  const maxLanes = useMaxLanes();
  const items = timelineOf(events, day);
  const crowded = crowdedClusters(items, maxLanes);
  const crowdedGroups = new Set(crowded.map((c) => c.group));
  const { from, to } = timelineHours(items);
  const hours: number[] = [];
  for (let m = from; m <= to; m += 60) hours.push(m);
  // Линия «сейчас» — только в сегодняшнем дне (московское время по часам сервера).
  const nowMin = Math.floor((now + 3 * 3_600_000) / 60_000) % 1440;
  const groupKey = (c: TimelineCluster) => `group-${c.group}`;
  const openCluster = crowded.find((c) => groupKey(c) === openId) ?? null;
  const opened = openCluster ? null : (items.find((i) => i.event.id === openId)?.event ?? null);
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
        {items.length === 0 ? "В этот день мероприятий нет." : `Мероприятий: ${items.length}. Коснитесь плашки — подробности.`}
      </p>
      <div className={stale ? "plan-timeline is-stale" : "plan-timeline"} style={{ height: `${(to - from) * PX}px` }} aria-label={`День по часам: ${dayTitle(day)}`}>
        {hours.map((m) => (
          <div key={m} className="plan-hour" style={{ top: `${(m - from) * PX}px` }}>
            <span className="plan-hour__label">{timeLabel(m)}</span>
          </div>
        ))}
        {day === today && nowMin >= from && nowMin <= to && <div className="plan-now" style={{ top: `${(nowMin - from) * PX}px` }} aria-label={`Сейчас ${timeLabel(nowMin)}`} />}
        <div className="plan-lanes">
          {items
            .filter((it) => !crowdedGroups.has(it.group))
            .map((it) => {
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
          {crowded.map((c) => {
            const key = groupKey(c);
            const height = Math.max(88, (c.bottom - c.top) * PX - 2);
            const lines = Math.max(1, Math.floor((height - 48) / 20));
            return (
              <button
                key={key}
                type="button"
                className={`plan-event plan-event--group${openId === key ? " is-open" : ""}`}
                style={{ top: `${(c.top - from) * PX}px`, height: `${height}px`, left: 0, width: "calc(100% - 4px)" } as CSSProperties}
                aria-expanded={openId === key}
                onClick={() => onOpen(openId === key ? null : key)}
              >
                <span className="plan-event__time">
                  {timeLabel(c.top)}–{timeLabel(c.bottom)}
                </span>
                <span className="plan-event__title">Одновременно: {c.items.length} мероприятий</span>
                {c.items.slice(0, lines).map((it) => (
                  <span key={it.event.id} className="plan-event__row">
                    <span className="plan-dot" style={{ "--plan-color": hostColor(it.event.hostId) } as CSSProperties} aria-hidden="true" />
                    {timeLabel(it.event.start)} {eventName(it.event)} · {it.event.hostName}
                  </span>
                ))}
                {c.items.length > lines && <span className="plan-event__row">и ещё {c.items.length - lines} — коснитесь</span>}
              </button>
            );
          })}
        </div>
      </div>
      {openCluster && (
        <div className="stack" aria-label="Мероприятия в одно время">
          <p className="small">
            <b>Одновременно {openCluster.items.length}</b> · {timeLabel(openCluster.top)}–{timeLabel(openCluster.bottom)}
          </p>
          {openCluster.items.map((it) => render(it.event))}
        </div>
      )}
      {opened && render(opened, true)}
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
  const [query, setQuery] = useState("");
  const events = useMemo(() => {
    // Правки на этом экране (отмена, возврат, удаление) — сразу, без перезагрузки списка.
    const all = [...(shown ?? []).filter((e) => !removed.includes(e.id) && !changed.some((c) => c.id === e.id)), ...changed.filter((c) => !removed.includes(c.id))];
    const found = query.trim() ? all.filter((e) => matchesSearch([e.title, e.clientName, e.clientPhone, e.hostName, e.place, e.note], query)) : all;
    if (filter === "cancelled") return sortEvents(found.filter((e) => e.cancelled), true);
    if (filter === "past") return sortEvents(found.filter((e) => eventStatus(e, now) === "past"), true);
    if (filter === "upcoming") return sortEvents(found.filter((e) => eventStatus(e, now) === "upcoming"), false);
    return sortEvents(found.filter((e) => eventStatus(e, now) === "now"), false);
  }, [shown, filter, now, removed, changed, query]);
  const candidates = useMemo(() => [...new Set((shown ?? []).flatMap((e) => [e.clientName, e.title, e.hostName]).filter(Boolean))], [shown]);
  return (
    <>
      <div className="seg plan-seg plan-seg--filters" role="group" aria-label="Какие мероприятия">
        {(Object.keys(FILTER_TITLES) as ListFilter[]).map((f) => (
          <button key={f} type="button" className={filter === f ? "seg__btn is-on" : "seg__btn"} aria-pressed={filter === f} onClick={() => onFilter(f)}>
            {FILTER_TITLES[f]}
          </button>
        ))}
      </div>
      <SearchField label="Поиск" value={query} placeholder="Клиент, телефон, ведущий, место" candidates={candidates} onChange={setQuery} />
      {!shown ? (
        state.status === "error" ? <LoadFailedInline onRetry={retry} /> : <ListSkeleton />
      ) : (
        <div className={state.status === "ready" ? "stack" : "stack is-stale"}>
          {events.length === 0 && (
            <p className="muted">
              {query.trim()
                ? "Ничего не нашлось."
                : filter === "past"
                  ? "В архиве пока пусто."
                  : filter === "cancelled"
                    ? "Отменённых нет."
                    : filter === "now"
                      ? "Сейчас ничего не идёт."
                      : "Предстоящих мероприятий нет."}
            </p>
          )}
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
  defaultOpen,
  onEdit,
  onCopy,
  onCancel,
  onRestore,
  onRemove,
  onHeld,
}: {
  event: AgencyEvent;
  now: number;
  owner: boolean;
  defaultOpen: boolean;
  onEdit: () => void;
  onCopy: () => void;
  onCancel: () => void;
  onRestore: () => void;
  onRemove: () => void;
  onHeld: (held: boolean | null) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const status = eventStatus(event, now);
  const pill = statusPill(event, now);
  const started = !event.cancelled && (status === "now" || status === "past");
  const detailsId = `plan-card-${event.id}`;
  return (
    <article className={open ? "card plan-card is-open" : "card plan-card"} style={{ "--plan-color": hostColor(event.hostId) } as CSSProperties}>
      <button type="button" className="plan-card__head" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen(!open)}>
        <span className="plan-card__top">
          <span className="plan-card__title">{eventName(event)}</span>
          <Pill color={pill.color}>{pill.title}</Pill>
        </span>
        <span className="plan-card__when">
          {dayTitle(event.day)}, {rangeLabel(event.start, event.end)}
        </span>
        <span className="plan-card__host">
          Ведёт: <b>{event.hostName || "—"}</b>
        </span>
        <span className="plan-card__more" aria-hidden="true">
          {open ? "Свернуть ▲" : "Подробнее ▼"}
        </span>
      </button>
      {open && (
        <div id={detailsId} className="stack stack--tight">
          <dl className="plan-facts">
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
                <dt>Комментарий</dt>
                <dd className="plan-facts__note">{event.note}</dd>
              </>
            )}
          </dl>
          {!event.clientName && !event.clientPhone && !event.place && event.guests === null && !event.note && <p className="muted small">Подробностей нет.</p>}
          {started && (
            <div className="stack stack--tight">
              <p className="small">
                <b>{event.held === null ? "Мероприятие состоялось?" : event.held ? "Отмечено: проведено" : "Отмечено: не состоялось"}</b>
              </p>
              <div className="plan-quick" role="group" aria-label="Состоялось ли">
                <button type="button" className={event.held === true ? "seg__btn is-on" : "seg__btn"} aria-pressed={event.held === true} onClick={() => onHeld(event.held === true ? null : true)}>
                  Проведено
                </button>
                <button type="button" className={event.held === false ? "seg__btn is-on" : "seg__btn"} aria-pressed={event.held === false} onClick={() => onHeld(event.held === false ? null : false)}>
                  Не состоялось
                </button>
              </div>
              {event.held === true && event.guests === null && owner && <p className="muted small">Впишите точное число гостей («Изменить») — оно попадёт в итоги.</p>}
            </div>
          )}
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
                  <button type="button" className="btn btn--quiet btn--block" onClick={onCopy}>
                    Создать похожее
                  </button>
                  <button type="button" className="btn btn--quiet btn--block" onClick={onCancel}>
                    Отменить мероприятие
                  </button>
                </>
              )}
            </div>
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

const FILLED_TITLES: Record<keyof LeadFill, string> = {
  clientName: "имя",
  clientPhone: "телефон",
  title: "что за мероприятие",
  day: "дата",
  start: "время",
  end: "",
  guests: "гости",
  place: "место",
  note: "комментарий",
};

/** Ближайшие дни для быстрого выбора: сегодня, завтра, пятница, суббота, воскресенье. */
function quickDays(today: string): Array<{ day: string; label: string }> {
  const out = [
    { day: today, label: "Сегодня" },
    { day: addDays(today, 1), label: "Завтра" },
  ];
  const weekday = ((dayIndex(today) ?? 0) + 3) % 7; // 0 — понедельник
  for (const [target, label] of [
    [4, "Пт"],
    [5, "Сб"],
    [6, "Вс"],
  ] as const) {
    const delta = (target - weekday + 7) % 7 || 7;
    const d = addDays(today, delta);
    if (!out.some((o) => o.day === d)) out.push({ day: d, label: `${label} ${Number(d.slice(8))}` });
  }
  return out;
}

function errorText(e: unknown): string {
  const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "";
  if (code === "invalid-argument") return "Проверьте дату и время: записать можно не раньше чем за месяц назад и не дальше двух лет вперёд.";
  if (code === "not-found") return "Этот человек отключён — выберите другого ведущего.";
  if (code === "failed-precondition") return "Мероприятие уже отменено — сначала верните его во вкладке «Отменённые».";
  return "Не получилось сохранить. Проверьте интернет и нажмите ещё раз.";
}

/**
 * Новое мероприятие, правка или «похожее» (только владелец). Быстро: заполнить из текста заявки или из
 * заявки клиента базы площадок, дни, время, гости и вид мероприятия — одним касанием. Ведущие — карточками,
 * сначала те, кто может; занятого записать можно, форма предупреждает.
 */
export function EventForm({
  initial,
  template,
  day: initialDay,
  draft,
  onSaved,
  onCancel,
}: {
  initial?: AgencyEvent;
  template?: AgencyEvent;
  day: string;
  draft?: EventDraft;
  onSaved: (event: AgencyEvent) => void;
  onCancel: () => void;
}) {
  const base = initial ?? template;
  const [id] = useState(() => initial?.id ?? newId());
  const [day, setDay] = useState(initial?.day ?? draft?.day ?? initialDay);
  const [start, setStart] = useState(base?.start ?? draft?.start ?? DEFAULT_QUERY.start);
  const [end, setEnd] = useState(base?.end ?? draft?.end ?? DEFAULT_QUERY.end);
  const [hostId, setHostId] = useState(base?.hostId ?? draft?.hostId ?? "");
  const [title, setTitle] = useState(base?.title ?? "");
  const [clientName, setClientName] = useState(base?.clientName ?? "");
  const [clientPhone, setClientPhone] = useState(base?.clientPhone ?? "");
  const [place, setPlace] = useState(base?.place ?? "");
  const [guests, setGuests] = useState(base?.guests != null ? String(base.guests) : "");
  const [note, setNote] = useState(base?.note ?? "");
  const [allTeam, setAllTeam] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filled, setFilled] = useState<string | null>(null);
  const [confirm, ask] = useConfirm();
  const [team, retryTeam] = useLoad(
    () => (calendarRepo ? calendarRepo.team(day, addDays(day, 1)) : Promise.resolve({ members: [] as CalendarMember[], entries: [] as AvailabilityEntry[] })),
    [day],
  );
  const teamData = useLastReady(team);
  // Прежние клиенты и места — подсказки при вводе (имя клиента подставит его телефон).
  const [known] = useLoad(async () => {
    if (!eventsRepo) return [] as AgencyEvent[];
    const [a, b] = await Promise.all([eventsRepo.list("upcoming"), eventsRepo.list("past")]);
    return [...a, ...b];
  }, []);
  const today = todayMoscow();
  const pastEvents = known.status === "ready" ? known.data : [];
  const clientPhones = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of pastEvents) if (e.clientName && e.clientPhone && !map.has(e.clientName)) map.set(e.clientName, e.clientPhone);
    return map;
  }, [pastEvents]);
  const places = useMemo(() => [...new Set(pastEvents.map((e) => e.place).filter(Boolean))].slice(0, 30), [pastEvents]);

  const initialSnapshot = useState(() => JSON.stringify([day, start, end, hostId, title, clientName, clientPhone, place, guests, note]))[0];
  const dirty = JSON.stringify([day, start, end, hostId, title, clientName, clientPhone, place, guests, note]) !== initialSnapshot;

  const statusOf = (uid: string) =>
    availabilityOf(
      (teamData?.entries ?? []).filter((e) => e.uid === uid && e.id !== bookingId(id)),
      day,
      start,
      end,
    );
  const members = (teamData?.members ?? [])
    .filter((m) => allTeam || m.owner || professionOf(m.profession) === "host" || m.uid === hostId)
    .map((m) => ({ member: m, info: statusOf(m.uid) }))
    .sort((a, b) => STATUS_ORDER[a.info.status] - STATUS_ORDER[b.info.status] || a.member.name.localeCompare(b.member.name, "ru"));
  const hostGone = Boolean(hostId) && team.status === "ready" && !teamData?.members.some((m) => m.uid === hostId);
  const chosen = hostId && !hostGone ? statusOf(hostId) : null;
  const guestsNum = guests.trim() === "" ? null : Number(guests);
  const guestsOk = guestsNum === null || (Number.isInteger(guestsNum) && guestsNum >= 0 && guestsNum <= EVENT_LIMITS.guestsMax);
  const missing = [!hostId || hostGone ? "ведущий" : "", !title.trim() && !clientName.trim() ? "что за мероприятие или имя клиента" : "", guestsOk ? "" : "число гостей"].filter(Boolean);
  const ready = missing.length === 0;

  function apply(fill: LeadFill) {
    if (fill.clientName) setClientName(fill.clientName);
    if (fill.clientPhone) setClientPhone(fill.clientPhone);
    if (fill.title) setTitle(fill.title);
    if (fill.day) setDay(fill.day);
    if (fill.start !== undefined && fill.end !== undefined) {
      setStart(fill.start);
      setEnd(fill.end);
    }
    if (fill.guests) setGuests(String(fill.guests));
    if (fill.place) setPlace(fill.place);
    if (fill.note) setNote(fill.note);
    const got = (Object.keys(fill) as Array<keyof LeadFill>).map((k) => FILLED_TITLES[k]).filter(Boolean);
    setFilled(got.length ? `Заполнено: ${got.join(", ")}. Проверьте и выберите ведущего.` : "В тексте не нашлось ни имени, ни телефона, ни даты — заполните вручную.");
  }

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
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function close() {
    if (!dirty) return onCancel();
    ask({ title: "Не сохранять мероприятие?", text: "Введённое пропадёт.", confirmLabel: "Не сохранять", run: async () => onCancel() });
  }

  return (
    <section className="card stack plan-form" aria-labelledby="event-form">
      <h2 id="event-form">{initial ? "Изменить мероприятие" : template ? "Похожее мероприятие" : "Новое мероприятие"}</h2>

      {!initial && <ImportFromLead today={today} onFill={apply} />}
      {filled && (
        <p className="small plan-filled" role="status">
          {filled}
        </p>
      )}

      <fieldset className="stack stack--tight">
        <legend>Когда</legend>
        <div className="plan-quick" role="group" aria-label="Быстрый выбор дня">
          {quickDays(today).map((q) => (
            <button key={q.day} type="button" className={day === q.day ? "seg__btn is-on" : "seg__btn"} aria-pressed={day === q.day} onClick={() => setDay(q.day)}>
              {q.label}
            </button>
          ))}
        </div>
        <label className="field">
          <span className="field__label">Дата</span>
          <input type="date" value={day} min={addDays(today, -31)} onChange={(e) => dayIndex(e.target.value) !== null && setDay(e.target.value)} />
        </label>
        <div className="plan-quick" role="group" aria-label="Готовое время">
          {TIME_PRESETS.map((p) => (
            <button
              key={`${p.start}-${p.end}`}
              type="button"
              className={start === p.start && end === p.end ? "seg__btn is-on" : "seg__btn"}
              aria-pressed={start === p.start && end === p.end}
              onClick={() => {
                setStart(p.start);
                setEnd(p.end);
              }}
            >
              {timeLabel(p.start)}–{timeLabel(p.end)}
            </button>
          ))}
        </div>
        <TimeSelects start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e); }} />
        <div className="plan-quick" role="group" aria-label="Сколько часов">
          {DURATIONS.map((h) => (
            <button key={h} type="button" className={end === endIn(start, h) ? "seg__btn is-on" : "seg__btn"} aria-pressed={end === endIn(start, h)} onClick={() => setEnd(endIn(start, h))}>
              {h} ч
            </button>
          ))}
        </div>
        <p className="plan-when">
          {dayTitle(day)}, {rangeLabel(start, end)}
        </p>
      </fieldset>

      <fieldset className="stack stack--tight">
        <legend>Кто ведёт</legend>
        {team.status === "error" && <LoadFailedInline onRetry={retryTeam} />}
        {!teamData && team.status !== "error" && <p className="muted small">Загружаем команду…</p>}
        {hostGone && <p className="error small">{initial?.hostName || "Этот ведущий"} сейчас отключён — выберите другого.</p>}
        <div className="plan-hosts" role="radiogroup" aria-label="Ведущий">
          {members.map(({ member, info }) => (
            <label key={member.uid} className="choice plan-host">
              <input type="radio" name={`host-${id}`} checked={hostId === member.uid} onChange={() => setHostId(member.uid)} />
              <span className="choice__text">
                <span className="choice__title">{member.name}</span>
                <span className="choice__hint">
                  <Pill color={MEMBER_COLORS[info.status]}>{STATUS_TITLES[info.status]}</Pill>
                  {info.status === "partial" && ` свободен ${info.free.map((f) => `${timeLabel(f.start)}–${timeLabel(f.end)}`).join(", ")}`}
                  {info.status === "busy" && ` ${info.busy.map((b) => `${rangeLabel(b.start, b.end)}${b.note ? ` — ${b.note}` : ""}`).join("; ")}`}
                </span>
              </span>
            </label>
          ))}
        </div>
        <label className="choice">
          <input type="checkbox" checked={allTeam} onChange={(e) => setAllTeam(e.target.checked)} />
          <span className="choice__text">
            <span className="choice__title">Показать всю команду</span>
            <span className="choice__hint">Не только ведущие: диджеи, музыканты, фокусники и другие.</span>
          </span>
        </label>
        {chosen?.status === "busy" && <p className="small plan-warn">У выбранного ведущего это время занято. Записать всё равно можно.</p>}
      </fieldset>

      <fieldset className="stack stack--tight">
        <legend>Что за мероприятие</legend>
        <div className="plan-quick" role="group" aria-label="Вид мероприятия">
          {EVENT_TITLES.slice(0, 6).map((t) => (
            <button key={t} type="button" className={title === t ? "seg__btn is-on" : "seg__btn"} aria-pressed={title === t} onClick={() => setTitle(t)}>
              {t}
            </button>
          ))}
        </div>
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
          <span className="field__label">Гостей (точное число)</span>
          <input type="number" inputMode="numeric" min={0} max={EVENT_LIMITS.guestsMax} step={1} value={guests} placeholder="Например, 37" onChange={(e) => setGuests(e.target.value.replace(/\D/g, ""))} />
        </label>
      </fieldset>

      <fieldset className="stack stack--tight">
        <legend>Клиент и место</legend>
        <label className="field">
          <span className="field__label">Клиент — имя</span>
          <input
            type="text"
            autoComplete="off"
            list="event-clients"
            maxLength={EVENT_LIMITS.client}
            value={clientName}
            onChange={(e) => {
              setClientName(e.target.value);
              const phone = clientPhones.get(e.target.value);
              if (phone && !clientPhone.trim()) setClientPhone(phone);
            }}
          />
        </label>
        <datalist id="event-clients">
          {[...clientPhones.keys()].slice(0, 50).map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <label className="field">
          <span className="field__label">Телефон клиента</span>
          <input type="tel" inputMode="tel" autoComplete="off" maxLength={EVENT_LIMITS.phone} value={clientPhone} placeholder="+7 …" onChange={(e) => setClientPhone(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Где (адрес или площадка)</span>
          <input type="text" list="event-places" maxLength={EVENT_LIMITS.place} value={place} onChange={(e) => setPlace(e.target.value)} />
        </label>
        <datalist id="event-places">
          {places.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <label className="field">
          <span className="field__label">Комментарий (программа, пожелания)</span>
          <textarea rows={3} maxLength={EVENT_LIMITS.note} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <p className="muted small">Имя и телефон клиента видят только вы и ведущий этого мероприятия.</p>
      </fieldset>

      {!ready && <p className="muted small">Осталось указать: {missing.join(", ")}.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="btn btn--block" disabled={busy || !ready} onClick={() => void save()}>
          {busy ? "Сохраняем…" : initial ? "Сохранить" : "Записать мероприятие"}
        </button>
        <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={close}>
          Отмена
        </button>
      </div>
      {confirm}
    </section>
  );
}

/** «Заполнить из заявки»: вставить текст (сообщение с сайта, переписка) или взять заявку клиента из базы площадок. */
function ImportFromLead({ today, onFill }: { today: string; onFill: (fill: LeadFill) => void }) {
  const [text, setText] = useState("");
  const [showRequests, setShowRequests] = useState(false);
  return (
    <Fold title="Заполнить из заявки" value="вставить текст или выбрать заявку">
      <div className="stack stack--tight">
        <label className="field">
          <span className="field__label">Текст заявки</span>
          <textarea rows={4} value={text} placeholder="Вставьте сообщение с сайта или из переписки: имя, телефон, дата, время, гости" onChange={(e) => setText(e.target.value)} />
        </label>
        <div className="actions">
          <button type="button" className="btn btn--secondary btn--block" disabled={!text.trim()} onClick={() => onFill(parseLeadText(text, today))}>
            Заполнить из текста
          </button>
          {venuesRepo && (
            <button type="button" className="btn btn--quiet btn--block" aria-expanded={showRequests} onClick={() => setShowRequests(!showRequests)}>
              {showRequests ? "Скрыть заявки клиентов" : "Взять из заявок клиентов"}
            </button>
          )}
        </div>
        {showRequests && <RequestPicker onPick={(r) => onFill(fillFromRequest(r.data))} />}
      </div>
    </Fold>
  );
}

function RequestPicker({ onPick }: { onPick: (r: VenueRequestRecord) => void }) {
  const [state, retry] = useLoad(() => (venuesRepo ? venuesRepo.listRequests() : Promise.resolve([] as VenueRequestRecord[])), []);
  if (state.status === "error") return <LoadFailedInline onRetry={retry} />;
  if (state.status !== "ready") return <p className="muted small">Загружаем заявки…</p>;
  const list = state.data
    .filter((r) => r.archivedAt === null)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 20);
  if (list.length === 0) return <p className="muted small">Заявок клиентов пока нет.</p>;
  return (
    <ul className="plan-requests">
      {list.map((r) => (
        <li key={r.id}>
          <button type="button" className="plan-request" onClick={() => onPick(r)}>
            <b>№{r.number}</b> {r.data.name || "без имени"}
            <span className="muted small">
              {[r.data.eventType, r.data.date ? dayTitle(r.data.date).replace(/^[^,]+, /, "") : "", r.data.guests ? `${r.data.guests} гостей` : ""].filter(Boolean).join(" · ")}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
