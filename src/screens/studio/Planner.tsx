/**
 * Планировщик мероприятий (CLAUDE.md, раздел 3, «Календарь»; решение владельца 14 октября 2026).
 * Владелец записывает мероприятие: клиент, телефон, дата, время, что за мероприятие, ведущий — и видит
 * все мероприятия: день по часам (таймлайн — что идёт и кто ведёт), 7 дней, месяц и списки «Предстоящие»,
 * «Идут сейчас», «Архив», «Отменённые». Ведущий видит свои мероприятия без правки.
 * Карточки свёрнуты: что, когда, кто ведёт; касание — клиент, телефон, место, гости, комментарий.
 * Время «идёт сейчас» — по часам сервера (часы телефона могут спешить).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { addDays, availabilityOf, DAY_MINUTES, dayIndex, dayTitle, DEFAULT_QUERY, MAX_END, rangeLabel, STATUS_ORDER, STATUS_TITLES, timeLabel, todayMoscow, type MemberStatus } from "../../core/calendar";
import {
  bookingId,
  CONTACT_KINDS,
  CONTACT_TITLES,
  contactLabel,
  crowdedClusters,
  EVENT_LIMITS,
  formatContact,
  parseContact,
  telegramNick,
  validEmail,
  type ContactKind,
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
  timelineHours,
  timelineOf,
  weekStart,
  type LeadFill,
  type PeriodKind,
  type TimelineCluster,
} from "../../core/events";
import { professionOf } from "../../core/professions";
import { cleanProgram, isEmptyProgram, prepareHints, programFromCalc, programLines, PROGRAM_ADDONS, PROGRAM_EXTENSIONS, PROGRAM_FORMATS, PROGRAM_MAX_FORMATS, type EventProgram } from "../../core/eventProgram";
import { eventLight, LIGHT_HINTS, LIGHT_ORDER, LIGHT_TITLES, lightCounts, sortByLight, type EventLight } from "../../core/eventLight";
import { matchesSearch } from "../../core/search";
import { eventFillFromClient, type ClientEventFill } from "../../core/clientToEvent";
import { draftHasContent, draftsKey, draftTitle, parseDrafts, removeDraft, upsertDraft, type EventFormDraft } from "../../core/eventDrafts";
import { CLIENT_STATUS_TITLES, durationLabel, originStats, phoneIssueText, phoneKey, phoneLabel, responseStats, telHref } from "../../core/clients";
import { calendarRepo, clientsRepo, clock, dataBackend, eventsRepo, useLoad, venuesRepo, type AgencyEvent, type AvailabilityEntry, type ClientRecord, type ClientResponse, type CalendarMember, type VenueRequestRecord } from "../../data";
import { useConfirm } from "../../components/ConfirmDialog";
import { Fold } from "../../components/Fold";
import { useServerNow } from "../../components/live/useServerNow";
import { SearchField } from "../../components/SearchField";
import { CalendarSubscribe } from "../../components/CalendarSubscribe";
import { TelegramConnect } from "../../components/TelegramConnect";
import { ListSkeleton } from "../../components/Skeleton";
import { LoadFailedInline } from "../../components/Status";
import { brand, teamColors } from "../../themes/brand";
import { MonthGrid, MonthHeader, monthRange, newId, Pill, shiftMonth, TimeSelects, useLastReady } from "./calendarParts";

type View = "day" | "week" | "month" | "list" | "stats";
type ListFilter = "light" | "upcoming" | "now" | "past" | "cancelled";

const VIEW_TITLES: Record<View, string> = { day: "День", week: "7 дней", month: "Месяц", list: "Список", stats: "Итоги" };
const FILTER_TITLES: Record<ListFilter, string> = { light: "По цвету", upcoming: "Предстоящие", now: "Идут сейчас", past: "Архив", cancelled: "Отменённые" };
const MEMBER_COLORS: Record<MemberStatus, string> = { free: brand.sage, partial: brand.gold, unknown: brand.taupe, busy: brand.coral };

/** Цвет ведущего на таймлайне — постоянный по его id (пастель, текст тёмный). */
function hostColor(hostId: string): string {
  let h = 0;
  for (const ch of hostId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return teamColors[h % teamColors.length] ?? brand.gold;
}

const eventName = (e: Pick<AgencyEvent, "title">) => e.title || "Мероприятие";

/**
 * Цветной кружок мероприятия (решение владельца 24 октября 2026): что с ним сейчас — ждёт ведущего, не подтвердил,
 * принято, идёт, сверх плана, прошло — отметьте, проведено, отменено. Ведущему своё «Ждёт ведущего» — «Подтвердите».
 */
export function LightBadge({ event, now, mine = false }: { event: AgencyEvent; now: number; mine?: boolean }) {
  const info = eventLight(event, now);
  const label = mine && (info.light === "wait" || info.light === "late") ? info.label.replace(/^(Ждёт ведущего|Не подтвердил)/, "Подтвердите") : info.label;
  return (
    <span className={`plan-light plan-light--${info.light}`} title={LIGHT_HINTS[info.light]}>
      <span className="plan-light__dot" aria-hidden="true" />
      {label}
    </span>
  );
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

type FormState = { event?: AgencyEvent; template?: AgencyEvent; day: string; resume?: EventFormDraft; prefill?: ClientEventFill };

// ───────────────────────────── Черновики (на устройстве) ─────────────────────────────

function readDrafts(uid: string): EventFormDraft[] {
  try {
    return parseDrafts(localStorage.getItem(draftsKey(uid)), Date.now());
  } catch {
    return [];
  }
}

function writeDrafts(uid: string, list: EventFormDraft[]): void {
  try {
    if (list.length) localStorage.setItem(draftsKey(uid), JSON.stringify(list));
    else localStorage.removeItem(draftsKey(uid));
    window.dispatchEvent(new Event(DRAFTS_EVENT));
  } catch {
    /* приватный режим или нет места — черновик живёт, пока открыта форма */
  }
}

const DRAFTS_EVENT = "joyrest:event-drafts";

/** Черновики этого человека; обновляются, когда форма их пишет (и в другой вкладке). */
function useEventDrafts(uid: string): EventFormDraft[] {
  const [list, setList] = useState(() => readDrafts(uid));
  useEffect(() => {
    const refresh = () => setList(readDrafts(uid));
    refresh();
    window.addEventListener(DRAFTS_EVENT, refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(DRAFTS_EVENT, refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [uid]);
  return list;
}

/** «Черновики мероприятий»: продолжить заполнять или удалить. Нет черновиков — ничего. */
export function EventDrafts({ uid, onOpen }: { uid: string; onOpen: (draft: EventFormDraft) => void }) {
  const drafts = useEventDrafts(uid);
  const [confirm, ask] = useConfirm();
  if (!drafts.length) return null;
  return (
    <section className="card stack stack--tight plan-drafts" aria-labelledby="plan-drafts">
      <h3 id="plan-drafts">📝 Черновики мероприятий · {drafts.length}</h3>
      <p className="muted small">Начатые и не записанные — хранятся на этом устройстве. Продолжите с того же места.</p>
      <ul className="plan-drafts__list">
        {drafts.map((d) => (
          <li key={d.id} className="plan-drafts__item">
            <div className="plan-drafts__text">
              <b>{draftTitle(d)}</b>
              <span className="muted small">
                {dayTitle(d.day)}, {rangeLabel(d.start, d.end)}
                {d.clientPhone.trim() ? ` · ${d.clientPhone.trim()}` : ""}
              </span>
            </div>
            <div className="plan-drafts__actions">
              <button type="button" className="btn" onClick={() => onOpen(d)}>
                Продолжить
              </button>
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() =>
                  ask({
                    title: "Удалить черновик?",
                    text: `«${draftTitle(d)}» — введённое пропадёт.`,
                    confirmLabel: "Удалить черновик",
                    run: async () => writeDrafts(uid, removeDraft(readDrafts(uid), d.id)),
                  })
                }
              >
                Удалить
              </button>
            </div>
          </li>
        ))}
      </ul>
      {confirm}
    </section>
  );
}

/**
 * `owner` — записывает и правит мероприятия (владелец и менеджер по продажам), `admin` — ещё «Итоги» и «Удалить навсегда»
 * (только владелец).
 */
export function Planner({
  owner,
  admin = owner,
  me = "",
  openDraft,
  onDraftOpened,
  openClient,
  onClientOpened,
  onToast,
}: {
  owner: boolean;
  admin?: boolean;
  me?: string;
  openDraft?: string | null;
  onDraftOpened?: () => void;
  /** «📅 Записать мероприятие ведущему» из карточки клиента: форма с его данными. */
  openClient?: string | null;
  onClientOpened?: () => void;
  onToast: (text: string) => void;
}) {
  const today = todayMoscow();
  // Менеджер и владелец отслеживают мероприятия по цветным кружкам — сразу «Список · По цвету» (24 октября 2026).
  const [view, setView] = useState<View>(owner ? "list" : "day");
  const [day, setDay] = useState(today);
  const [filter, setFilter] = useState<ListFilter>("light");
  const [form, setForm] = useState<FormState | null>(() => {
    // «Продолжить» черновик из «Кто может» — открываем его сразу.
    const d = owner && openDraft ? readDrafts(me).find((x) => x.id === openDraft) : undefined;
    return d ? { day: d.day, resume: d } : null;
  });
  useEffect(() => {
    if (openDraft) onDraftOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Из карточки клиента: имя, телефон и то, что известно о празднике, — сразу в форме.
  useEffect(() => {
    if (!owner || !openClient || !clientsRepo) return;
    let gone = false;
    clientsRepo
      .get(openClient)
      .then((c) => {
        if (gone) return;
        const fill = eventFillFromClient(c, todayMoscow());
        setForm({ day: fill.day ?? todayMoscow(), prefill: fill });
      })
      .catch(() => !gone && onToast("Не получилось открыть клиента — заполните мероприятие вручную"))
      .finally(() => !gone && onClientOpened?.());
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openClient]);
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

  const accepting = useRef(new Set<string>());
  // «Принял, готовлюсь» — ведущий этого мероприятия; то же, что кнопка в Telegram.
  async function accept(event: AgencyEvent) {
    // Двойное касание — один запрос.
    if (!eventsRepo || accepting.current.has(event.id)) return;
    accepting.current.add(event.id);
    try {
      replace(await eventsRepo.accept(event.id, event.acceptRev ?? 0));
      onToast("Принято — менеджер видит, что вы готовитесь");
    } catch (e) {
      const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "";
      if (code === "changed") {
        onToast("Программу только что поменяли — посмотрите её и нажмите ещё раз");
        retry();
      } else onToast("Не получилось отметить. Проверьте интернет.");
    } finally {
      accepting.current.delete(event.id);
    }
  }

  if (form) {
    return (
      <EventForm
        initial={form.event}
        template={form.template}
        day={form.day}
        resume={form.resume}
        prefill={form.prefill}
        draftOwner={me}
        onCancel={(kept) => {
          setForm(null);
          if (kept) onToast("Черновик сохранён — он сверху, в «Черновиках мероприятий»");
        }}
        onSaved={(saved) => {
          replace(saved);
          setForm(null);
          setDay(saved.day);
          setOpenId(saved.id);
          setView("day");
          // Клиент не попал в базу клиентов даже после повторов сервера — сказать прямо, чтобы его не потеряли.
          // Телефон неполный или его нет (только имя) — сервер клиента не записал: нужен полный телефон или ссылка.
          if (saved.clientNotSaved && (saved.clientIncomplete || !phoneKey(saved.clientPhone)))
            onToast("Мероприятие записано. Клиент не попал в «Клиенты»: нужен полный телефон или ссылка — добавьте его вручную");
          else if (saved.clientNotSaved) onToast("Мероприятие записано, но клиент не попал в «Клиенты» — добавьте его вручную");
          else onToast(form.event ? "Мероприятие сохранено" : `Мероприятие записано: ${saved.hostName}`);
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
      admin={admin}
      me={me}
      defaultOpen={open}
      onAccept={() => void accept(e)}
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
      {owner && <EventDrafts uid={me} onOpen={(d) => setForm({ day: d.day, resume: d })} />}
      {owner && (
        <div className="actions">
          <button type="button" className="btn btn--block" onClick={() => setForm({ day: day < today ? today : day })}>
            + Новое мероприятие
          </button>
        </div>
      )}
      <div className="seg plan-seg plan-seg--views" role="group" aria-label="Вид">
        {(Object.keys(VIEW_TITLES) as View[]).filter((v) => admin || v !== "stats").map((v) => (
          <button key={v} type="button" className={view === v ? "seg__btn is-on" : "seg__btn"} aria-pressed={view === v} onClick={() => setView(v)}>
            {VIEW_TITLES[v]}
          </button>
        ))}
      </div>

      {view === "stats" && admin ? (
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
      <CalendarSubscribe owner={owner} />
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
  // Откуда клиенты: новые клиенты за период и мероприятия их клиентов (по телефону) — по каналам.
  const [clientsState] = useLoad(
    () => (clientsRepo ? Promise.all([clientsRepo.list(false), clientsRepo.list(true)]).then(([a, b]) => [...a, ...b]) : Promise.resolve([] as ClientRecord[])),
    [],
  );
  const origins = clientsState.status === "ready" ? originStats(clientsState.data.map((c) => ({ origin: c.origin ?? "", phone: c.phone, createdAt: c.createdAt })), events, period.from, period.to) : [];
  // Скорость ответа на новые заявки за период: кто брал клиентов, в среднем и обычно (медиана), сколько — до 30 минут.
  const [responsesState] = useLoad(() => (clientsRepo ? clientsRepo.responses(period.from, period.to) : Promise.resolve([] as ClientResponse[])), [period.from, period.to]);
  const speed = responsesState.status === "ready" && responsesState.data.length > 0 ? responseStats(responsesState.data) : null;
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
          {origins.length > 0 && (
            <section className="card stack stack--tight" aria-label="Откуда клиенты">
              <h2>Откуда клиенты</h2>
              <p className="muted small">Новые клиенты за период и мероприятия их клиентов (по телефону клиента). Источник — в карточке «Клиентов».</p>
              <table className="plan-table">
                <thead>
                  <tr>
                    <th scope="col">Источник</th>
                    <th scope="col">Новых</th>
                    <th scope="col">Записано</th>
                    <th scope="col">Проведено</th>
                  </tr>
                </thead>
                <tbody>
                  {origins.map((o) => (
                    <tr key={o.origin || "none"}>
                      <th scope="row">{o.title}</th>
                      <td>{o.clients}</td>
                      <td>{o.planned}</td>
                      <td>{o.held}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {speed && (
            <section className="card stack stack--tight" aria-label="Скорость ответа">
              <h2>Скорость ответа на заявки</h2>
              <p className="muted small">
                От прихода заявки до «В работе». Всего {speed.count}: в среднем {durationLabel(speed.avgMs)}, обычно {durationLabel(speed.medianMs)}, до 30 минут —{" "}
                {speed.inTime}. «Обычно» — середина: одна заявка, пролежавшая ночь, его не портит.
              </p>
              <table className="plan-table">
                <thead>
                  <tr>
                    <th scope="col">Кто взял</th>
                    <th scope="col">Заявок</th>
                    <th scope="col">Обычно</th>
                    <th scope="col">До 30 мин</th>
                  </tr>
                </thead>
                <tbody>
                  {speed.byUser.map((u) => (
                    <tr key={u.name}>
                      <th scope="row">{u.name}</th>
                      <td>{u.count}</td>
                      <td>{durationLabel(u.medianMs)}</td>
                      <td>{u.inTime}</td>
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
  const [state, retry] = useLoad(async () => {
    if (!eventsRepo) return [] as AgencyEvent[];
    // «По цвету»: всё, что можно отслеживать, — предстоящие, прошедшие и отменённые вместе.
    if (scope === "light") return (await Promise.all([eventsRepo.list("upcoming"), eventsRepo.list("past"), eventsRepo.list("cancelled")])).flat();
    return eventsRepo.list(scope);
  }, [scope]);
  const shown = useLastReady(state);
  const [query, setQuery] = useState("");
  const [light, setLight] = useState<EventLight | null>(null);
  const all = useMemo(() => {
    // Правки на этом экране (отмена, возврат, удаление) — сразу, без перезагрузки списка.
    const list = [...(shown ?? []).filter((e) => !removed.includes(e.id) && !changed.some((c) => c.id === e.id)), ...changed.filter((c) => !removed.includes(c.id))];
    return query.trim() ? list.filter((e) => matchesSearch([e.title, e.clientName, e.clientPhone, e.hostName, e.place, e.note], query)) : list;
  }, [shown, removed, changed, query]);
  const counts = useMemo(() => lightCounts(all, now), [all, now]);
  const events = useMemo(() => {
    if (filter === "light") return sortByLight(light ? all.filter((e) => eventLight(e, now).light === light) : all, now);
    if (filter === "cancelled") return sortEvents(all.filter((e) => e.cancelled), true);
    if (filter === "past") return sortEvents(all.filter((e) => eventStatus(e, now) === "past"), true);
    if (filter === "upcoming") return sortEvents(all.filter((e) => eventStatus(e, now) === "upcoming"), false);
    return sortEvents(all.filter((e) => eventStatus(e, now) === "now"), false);
  }, [all, filter, now, light]);
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
      {filter === "light" && (
        <div className="plan-lights" role="group" aria-label="Цвет кружка">
          <button type="button" className={light === null ? "plan-lights__btn is-on" : "plan-lights__btn"} aria-pressed={light === null} onClick={() => setLight(null)}>
            Все · {all.length}
          </button>
          {LIGHT_ORDER.filter((l) => counts[l] > 0 || light === l).map((l) => (
            <button
              key={l}
              type="button"
              className={`plan-lights__btn plan-light--${l}${light === l ? " is-on" : ""}`}
              aria-pressed={light === l}
              title={LIGHT_HINTS[l]}
              onClick={() => setLight(light === l ? null : l)}
            >
              <span className="plan-light__dot" aria-hidden="true" />
              {LIGHT_TITLES[l]} · {counts[l]}
            </button>
          ))}
        </div>
      )}
      {filter === "light" && <p className="muted small">Сверху — что требует внимания: сверх плана, не подтвердил, идёт, прошло — отметьте. Коснитесь цвета — останутся только такие.</p>}
      <SearchField label="Поиск" value={query} placeholder="Клиент, телефон, ведущий, место" candidates={candidates} onChange={setQuery} />
      {!shown ? (
        state.status === "error" ? <LoadFailedInline onRetry={retry} /> : <ListSkeleton />
      ) : (
        <div className={state.status === "ready" ? "stack" : "stack is-stale"}>
          {events.length === 0 && (
            <p className="muted">
              {query.trim()
                ? "Ничего не нашлось."
                : filter === "light"
                  ? light
                    ? `Мероприятий «${LIGHT_TITLES[light]}» нет.`
                    : "Мероприятий пока нет."
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
  admin,
  me,
  defaultOpen,
  onAccept,
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
  admin: boolean;
  me: string;
  defaultOpen: boolean;
  onAccept: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onCancel: () => void;
  onRestore: () => void;
  onRemove: () => void;
  onHeld: (held: boolean | null) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const status = eventStatus(event, now);
  const started = !event.cancelled && (status === "now" || status === "past");
  const detailsId = `plan-card-${event.id}`;
  // Отметку «принял» спрашиваем у мероприятий, записанных или изменённых после 22 октября 2026 (`acceptRev` > 0).
  const ahead = !event.cancelled && status === "upcoming" && (event.acceptRev ?? 0) > 0;
  const mine = Boolean(me) && me === event.hostId;
  const accepted = Boolean(event.acceptedAt);
  return (
    <article className={open ? "card plan-card is-open" : "card plan-card"} style={{ "--plan-color": hostColor(event.hostId) } as CSSProperties}>
      <button type="button" className="plan-card__head" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen(!open)}>
        <span className="plan-card__top">
          <span className="plan-card__title">
            {eventName(event)}
            {event.guests !== null ? ` · ${event.guests} гостей` : ""}
          </span>
          <LightBadge event={event} now={now} mine={mine} />
        </span>
        <span className="plan-card__when">
          {dayTitle(event.day)}, {rangeLabel(event.start, event.end)}
        </span>
        <span className="plan-card__host">
          Ведёт: <b>{event.hostName || "—"}</b>
          {owner && event.clientName ? ` · клиент ${event.clientName}` : ""}
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
                  {telHref(event.clientPhone) ? <a href={telHref(event.clientPhone)}>{event.clientPhone}</a> : event.clientPhone}
                </dd>
              </>
            )}
            {event.clientContact && contactLabel(event.clientContact) && (
              <>
                <dt>Связь</dt>
                <dd>
                  {(() => {
                    const c = parseContact(event.clientContact);
                    const label = contactLabel(event.clientContact);
                    if (c.kind === "telegram" && c.value) return <a href={`https://t.me/${c.value.slice(1)}`} target="_blank" rel="noopener noreferrer">{label}</a>;
                    if (c.kind === "email" && c.value) return <a href={`mailto:${c.value}`}>{label}</a>;
                    return label;
                  })()}
                </dd>
              </>
            )}
            <dt>Время</dt>
            <dd>{lengthHint(event.start, event.end)}</dd>
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
          {!event.clientName && !event.clientPhone && !event.place && event.guests === null && !event.note && isEmptyProgram(event.program) && <p className="muted small">Подробностей нет.</p>}
          <ProgramView program={event.program ?? null} />
          {ahead && mine && (
            accepted ? (
              <p className="small plan-accepted">✅ Вы приняли {event.acceptedAt ? acceptedLabel(event.acceptedAt) : ""}. Поменяют программу — придёт сообщение, примите заново.</p>
            ) : (
              <button type="button" className="btn btn--block" onClick={onAccept}>
                ✅ Принял, готовлюсь
              </button>
            )
          )}
          {ahead && owner && !mine && (
            <p className="muted small">{accepted ? `✅ Ведущий принял ${event.acceptedAt ? acceptedLabel(event.acceptedAt) : ""}.` : "⏳ Ведущий ещё не нажал «Принял, готовлюсь». За сутки до начала без отметки придёт напоминание."}</p>
          )}
          {eventsRepo && !event.cancelled && !started && (
            <a className="btn btn--secondary btn--block" href={eventsRepo.icsUrl(event.id)}>
              📅 Добавить в календарь телефона
            </a>
          )}
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
                  {admin && (
                    <button type="button" className="btn btn--quiet btn--block" onClick={onRemove}>
                      Удалить навсегда
                    </button>
                  )}
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

/** «Пт 22 окт, 17:42» — когда ведущий принял программу (по Москве). */
function acceptedLabel(ms: number): string {
  return new Date(ms).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Программа в карточке: форматы, продление, длительность, допы и что подготовить. Цены нет. */
function ProgramView({ program }: { program: EventProgram | null }) {
  if (!program || isEmptyProgram(program)) return null;
  const hints = prepareHints(program);
  return (
    <div className="plan-program stack stack--tight">
      <p className="plan-program__title">🎯 Программа</p>
      {programLines(program).map((line) => (
        <p key={line} className="small">
          {line}
        </p>
      ))}
      {hints.length > 0 && (
        <>
          <p className="plan-program__title">🧰 Подготовить</p>
          <ul className="plan-program__prep small">
            {hints.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * Программа в форме мероприятия (решение владельца 24 октября 2026): форматы по порядку вечера — строками с номером,
 * ↑ ↓ и ✕, «＋ Добавить формат» (до 6); продление и допы — кнопками. Вставка расчёта сверху формы отмечает всё сама.
 * Цена в программу не попадает.
 */
function ProgramField({ program, onChange }: { program: EventProgram | null; onChange: (p: EventProgram | null) => void }) {
  const [adding, setAdding] = useState(false);
  const p: EventProgram = program ?? { formats: [], extension: "", addons: [], duration: "" };
  const set = (next: Partial<EventProgram>) => onChange(cleanProgram({ ...p, ...next }));
  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  const move = (i: number, d: number) => {
    const list = [...p.formats];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    set({ formats: list });
  };
  const rest = PROGRAM_FORMATS.filter((f) => !p.formats.includes(f));
  const full = p.formats.length >= PROGRAM_MAX_FORMATS;
  return (
    <div className="stack stack--tight">
      {p.formats.length > 0 && (
        <ol className="plan-formats" aria-label="Форматы по порядку вечера">
          {p.formats.map((f, i) => (
            <li key={f} className="plan-formats__row">
              <span className="plan-formats__n" aria-hidden="true">
                {i + 1}
              </span>
              <b className="plan-formats__name">{f}</b>
              <span className="plan-formats__ctl">
                <button type="button" className="btn btn--quiet plan-icon" aria-label={`${f} — раньше`} disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button type="button" className="btn btn--quiet plan-icon" aria-label={`${f} — позже`} disabled={i === p.formats.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button type="button" className="btn btn--quiet plan-icon" aria-label={`Убрать ${f}`} onClick={() => set({ formats: p.formats.filter((x) => x !== f) })}>
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      {!full && rest.length > 0 && (
        <>
          <button type="button" className="btn btn--secondary btn--block" aria-expanded={adding || p.formats.length === 0} onClick={() => setAdding(!adding)}>
            ＋ {p.formats.length ? "Добавить ещё формат" : "Добавить формат"}
          </button>
          {(adding || p.formats.length === 0) && (
            <div className="plan-quick" role="group" aria-label="Какой формат добавить">
              {rest.map((f) => (
                <button
                  key={f}
                  type="button"
                  className="seg__btn"
                  onClick={() => {
                    set({ formats: [...p.formats, f] });
                    setAdding(false);
                  }}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {full && <p className="muted small">В одном вечере — до {PROGRAM_MAX_FORMATS} форматов.</p>}
      <span className="field__label">⏱ Продление</span>
      <div className="plan-quick" role="group" aria-label="Продление">
        {["", ...PROGRAM_EXTENSIONS].map((x) => (
          <button key={x || "none"} type="button" className={p.extension === x ? "seg__btn is-on" : "seg__btn"} aria-pressed={p.extension === x} onClick={() => set({ extension: x })}>
            {x ? `+${x}` : "Нет"}
          </button>
        ))}
      </div>
      <span className="field__label">🎁 Допы</span>
      <div className="plan-quick" role="group" aria-label="Допы">
        {PROGRAM_ADDONS.map((a) => (
          <button key={a} type="button" className={p.addons.includes(a) ? "seg__btn is-on" : "seg__btn"} aria-pressed={p.addons.includes(a)} onClick={() => set({ addons: toggle(p.addons, a) })}>
            {a}
          </button>
        ))}
      </div>
      {p.duration && (
        <p className="small">
          ⌛ Длительность по расчёту: {p.duration}{" "}
          <button type="button" className="btn btn--quiet plan-inline" onClick={() => set({ duration: "" })}>
            убрать
          </button>
        </p>
      )}
    </div>
  );
}

// ───────────────────────────── Форма ─────────────────────────────

export interface EventDraft {
  day: string;
  start?: number;
  end?: number;
  hostId?: string;
}

/** «Где» ещё не известно — галочка «Место пока уточняется» (поле обязательное, ведущий видит эту строку). */
export const PLACE_TBD = "Место уточняется";

/** Обязательные поля формы — в порядке на экране (для «Заполнено N из 8 · осталось …»). */
type Need = "name" | "phone" | "contact" | "when" | "title" | "program" | "place" | "host";
const NEED_TITLES: Record<Need, string> = {
  name: "имя",
  phone: "телефон",
  contact: "связь",
  when: "дата и время с … до",
  title: "повод",
  program: "программа",
  place: "где",
  host: "кто ведёт",
};
/** Что подставилось (из расчёта, заявки, карточки клиента) — подсвечено, пока менеджер это поле не поправит. */
type Got = Need | "guests" | "note";

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
  if (code === "changed") return "Пока вы правили, это мероприятие изменил другой человек. Ваши правки не сохранены: нажмите «Отмена», откройте его снова и внесите их ещё раз.";
  return "Не получилось сохранить. Проверьте интернет и нажмите ещё раз.";
}

/** «3,5 ч: программа 3 ч + 30 мин запаса без доплаты. После 22:30 — продление за доплату». */
function lengthHint(start: number, end: number): string {
  const total = end - start;
  if (total <= 0) return "";
  const h = (m: number) => `${String(Math.round((m / 60) * 10) / 10).replace(".", ",")} ч`;
  const after = `После ${timeLabel(end % DAY_MINUTES)} — продление за доплату.`;
  if (total <= 30) return `${h(total)}. ${after}`;
  return `${h(total)}: программа ${h(total - 30)} + 30 мин запаса без доплаты. ${after}`;
}

/** Метка над полем: обязательное (*), подставлено («из расчёта»), ещё нужно («заполнить»), готово (✓). */
function NeedMark({ need, done, got }: { need?: boolean; done?: boolean; got?: string }) {
  return (
    <>
      {need && (
        <span className="plan-star" aria-label="обязательно">
          *
        </span>
      )}
      {got && <span className="plan-got">{got}</span>}
      {need && !done && <span className="plan-needt">заполнить</span>}
      {need && done && (
        <span className="plan-ok" aria-label="готово">
          ✓
        </span>
      )}
    </>
  );
}

/**
 * Новое мероприятие, правка или «похожее» (решение владельца 24 октября 2026 — форма по макету «Заявка ведущему»):
 * сверху — «Вставить расчёт или заявку» (заполняет только пустые поля, подставленное подсвечено), «Заполнено N из 8».
 * Для карточки клиента: имя, телефон, связь. Для ведущего: когда (дата, с … до …), повод, программа по порядку, где,
 * кто ведёт. По желанию: гости и комментарий. «Записать» — когда всё обязательное заполнено.
 */
export function EventForm({
  initial,
  template,
  day: initialDay,
  draft,
  resume,
  prefill,
  draftOwner,
  onSaved,
  onCancel,
}: {
  initial?: AgencyEvent;
  template?: AgencyEvent;
  day: string;
  draft?: EventDraft;
  /** Черновик, который продолжаем заполнять. */
  resume?: EventFormDraft;
  /** Данные из карточки клиента. */
  prefill?: ClientEventFill;
  /** Чьи черновики: задан — новое мероприятие само сохраняется черновиком на устройстве (правка записанного — нет). */
  draftOwner?: string;
  onSaved: (event: AgencyEvent) => void;
  /** kept — введённое осталось в черновике. */
  onCancel: (kept?: boolean) => void;
}) {
  const base = initial ?? template;
  const r = initial ? undefined : resume;
  const pf = initial || resume ? undefined : prefill;
  const [id] = useState(() => initial?.id ?? r?.id ?? newId());
  const [day, setDay] = useState(initial?.day ?? r?.day ?? pf?.day ?? draft?.day ?? initialDay);
  const [start, setStart] = useState(r?.start ?? pf?.start ?? base?.start ?? draft?.start ?? DEFAULT_QUERY.start);
  const [end, setEnd] = useState(r?.end ?? pf?.end ?? base?.end ?? draft?.end ?? DEFAULT_QUERY.end);
  // «Когда» заполнено, только если время выбрали (или оно пришло из расчёта, «Кто может», записанного мероприятия).
  const [whenSet, setWhenSet] = useState(Boolean(initial || template) || (r ? r.whenSet === true : pf?.start !== undefined || draft?.start !== undefined));
  const [hostId, setHostId] = useState(r?.hostId ?? base?.hostId ?? draft?.hostId ?? "");
  const [title, setTitle] = useState(r?.title ?? pf?.title ?? base?.title ?? "");
  const [clientName, setClientName] = useState(r?.clientName ?? pf?.clientName ?? base?.clientName ?? "");
  const [clientPhone, setClientPhone] = useState(r?.clientPhone ?? pf?.clientPhone ?? base?.clientPhone ?? "");
  const startContact = parseContact(r?.contact ?? pf?.contact ?? base?.clientContact ?? "");
  const [contactKind, setContactKind] = useState<ContactKind | "">(startContact.kind);
  const [contactValue, setContactValue] = useState(startContact.value);
  const [place, setPlace] = useState(r?.place ?? pf?.place ?? base?.place ?? "");
  const [guests, setGuests] = useState(r ? r.guests : pf?.guests !== undefined ? String(pf.guests) : base?.guests != null ? String(base.guests) : "");
  const [note, setNote] = useState(r?.note ?? base?.note ?? "");
  const [program, setProgram] = useState<EventProgram | null>(r ? r.program : (pf?.program ?? base?.program ?? null));
  const [allTeam, setAllTeam] = useState(false);
  const [busy, setBusy] = useState(false);
  // Двойное касание «Записать»: второй запрос не уходит, пока первый не вернулся (иначе ведущему — два уведомления).
  const saving = useRef(false);
  const [error, setError] = useState<string | null>(null);
  // Подставленное: поле → откуда («из расчёта», «из заявки», «из карточки клиента»). Поправили поле — метка уходит.
  const [got, setGot] = useState<Partial<Record<Got, string>>>(() => {
    if (!pf) return {};
    const from = "из карточки клиента";
    const out: Partial<Record<Got, string>> = {};
    if (pf.clientName) out.name = from;
    if (pf.clientPhone) out.phone = from;
    if (pf.contact) out.contact = from;
    if (pf.start !== undefined) out.when = from;
    if (pf.title) out.title = from;
    if (pf.program && pf.program.formats.length) out.program = from;
    if (pf.place) out.place = from;
    if (pf.guests !== undefined) out.guests = from;
    return out;
  });
  const touch = (...keys: Got[]) =>
    setGot((g) => {
      if (!keys.some((k) => g[k])) return g;
      const next = { ...g };
      for (const k of keys) delete next[k];
      return next;
    });
  const [filled, setFilled] = useState<string | null>(() =>
    pf ? `Из карточки клиента: ${pf.got.join(", ")}. Проверьте подсвеченное и заполните остальное.${pf.day ? "" : " Даты в заявке нет — выберите её."}` : null,
  );
  // Подсказки из «Клиентов» под полями имени и телефона (решение владельца 24 октября 2026).
  const clientBase = useClientBase();
  const [pickFor, setPickFor] = useState<"name" | "phone" | null>(null);
  const pickClient = (c: ClientRecord) => {
    setClientName(c.name);
    setClientPhone(c.phone);
    const tg = c.links.map((l) => /^https:\/\/t\.me\/([A-Za-z][A-Za-z0-9_]{3,31})$/i.exec(l)?.[1]).find(Boolean);
    if (tg && (!contactKind || contactKind === "telegram")) {
      setContactKind("telegram");
      setContactValue(`@${tg}`);
    } else if (!contactKind && c.links.some((l) => /wa\.me\//i.test(l))) setContactKind("whatsapp");
    touch("name", "phone");
    setPickFor(null);
  };
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
  const places = useMemo(() => [...new Set(pastEvents.map((e) => e.place).filter((p) => p && p !== PLACE_TBD))].slice(0, 30), [pastEvents]);

  const contact = formatContact({ kind: contactKind, value: contactKind === "telegram" ? telegramNick(contactValue) : contactKind === "email" ? contactValue.trim() : "" });
  const fields = [day, start, end, whenSet, hostId, title, clientName, clientPhone, contactKind, contactValue, place, guests, note, program];
  const initialSnapshot = useState(() => JSON.stringify(fields))[0];
  const dirty = JSON.stringify(fields) !== initialSnapshot;

  // Черновик: новое мероприятие само сохраняется на устройстве (через 0,4 с после правки и при уходе со страницы),
  // менеджер может уйти в «Клиенты» и вернуться. Записали или удалили — черновика больше нет.
  const drafting = !initial && draftOwner !== undefined;
  const snapshot: EventFormDraft = {
    id,
    savedAt: 0,
    day,
    start,
    end,
    hostId,
    title,
    clientName,
    clientPhone,
    place,
    guests,
    note,
    program,
    contact: contactKind ? `${contactKind}${contactValue.trim() ? `:${contactValue.trim()}` : ""}` : "",
    whenSet,
  };
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const draftDone = useRef(false);
  const draftTouched = useRef(Boolean(r || pf));
  if (dirty) draftTouched.current = true;
  const keepDraft = () => {
    if (!drafting || draftDone.current || !draftTouched.current) return;
    const uid = draftOwner ?? "";
    writeDrafts(uid, upsertDraft(readDrafts(uid), { ...latest.current, savedAt: Date.now() }));
  };
  const snapKey = JSON.stringify(snapshot);
  useEffect(() => {
    if (!drafting || !draftTouched.current) return;
    const t = window.setTimeout(keepDraft, 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapKey]);
  useEffect(() => {
    const hide = () => keepDraft();
    window.addEventListener("pagehide", hide);
    return () => {
      window.removeEventListener("pagehide", hide);
      keepDraft();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const hasDraft = drafting && draftTouched.current && draftHasContent(snapshot);
  function dropDraft() {
    if (!drafting) return;
    draftDone.current = true;
    const uid = draftOwner ?? "";
    writeDrafts(uid, removeDraft(readDrafts(uid), id));
  }

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

  // ── Обязательное ──
  const fullPhone = phoneKey(clientPhone) !== "";
  const nick = contactKind === "telegram" ? telegramNick(contactValue) : "";
  const phoneIncomplete = clientPhone.trim() !== "" && !fullPhone;
  const contactProblem =
    contactKind === ""
      ? "Выберите, где писать клиенту."
      : contactKind === "telegram"
        ? contactValue.trim() && !nick
          ? "Ник Telegram — латиницей, от 5 знаков: @anna_party."
          : !nick && !fullPhone
            ? "Впишите ник Telegram или полный телефон."
            : ""
        : contactKind === "email"
          ? validEmail(contactValue.trim())
            ? ""
            : "Впишите адрес почты: anna@mail.ru."
          : fullPhone
            ? ""
            : `${CONTACT_TITLES[contactKind]} — по номеру: впишите полный телефон.`;
  const done: Record<Need, boolean> = {
    name: clientName.trim() !== "",
    phone: fullPhone || nick !== "",
    contact: contactProblem === "",
    when: whenSet,
    title: title.trim() !== "",
    program: (program?.formats.length ?? 0) > 0,
    place: place.trim() !== "",
    host: Boolean(hostId) && !hostGone,
  };
  const needs = (Object.keys(NEED_TITLES) as Need[]).filter((k) => !done[k]);
  const doneCount = 8 - needs.length;
  const ready = needs.length === 0 && guestsOk;
  const secId = (k: Need) => `ef-${k}-${id}`;
  const goToFirst = () => {
    const first = needs[0];
    if (first) document.getElementById(secId(first))?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const secClass = (k: Need) => `plan-sec${done[k] ? " is-done" : " is-need"}${got[k] ? " is-got" : ""}`;

  /** Вставка: заполняет только пустые поля (ничего не затирает), подставленное подсвечивает. */
  function apply(fill: LeadFill & { program?: EventProgram | null }, from: string) {
    const took: Got[] = [];
    if (fill.clientName && !clientName.trim()) {
      setClientName(fill.clientName);
      took.push("name");
    }
    if (fill.clientPhone && !clientPhone.trim()) {
      setClientPhone(fill.clientPhone);
      took.push("phone");
    }
    if (fill.contact && !contactKind) {
      const c = parseContact(fill.contact);
      if (c.kind) {
        setContactKind(c.kind);
        setContactValue(c.value);
        took.push("contact");
      }
    }
    if (fill.title && !title.trim()) {
      setTitle(fill.title);
      took.push("title");
    }
    if (!whenSet && (fill.day || fill.start !== undefined)) {
      if (fill.day) setDay(fill.day);
      if (fill.start !== undefined && fill.end !== undefined) {
        setStart(fill.start);
        setEnd(fill.end);
        setWhenSet(true);
        took.push("when");
      } else if (fill.day) took.push("when");
    }
    if (fill.guests && !guests.trim()) {
      setGuests(String(fill.guests));
      took.push("guests");
    }
    if (fill.place && !place.trim()) {
      setPlace(fill.place);
      took.push("place");
    }
    if (fill.note && !note.trim()) {
      setNote(fill.note);
      took.push("note");
    }
    if (fill.program && !isEmptyProgram(fill.program) && isEmptyProgram(program)) {
      setProgram(fill.program);
      took.push("program");
    }
    setGot((g) => ({ ...g, ...Object.fromEntries(took.map((k) => [k, from])) }));
    const titles: Record<Got, string> = { ...NEED_TITLES, when: fill.start !== undefined ? "дата и время" : "дата", guests: "гости", note: "комментарий" };
    setFilled(
      took.length
        ? `Подставлено ${from}: ${took.map((k) => titles[k]).join(", ")}. Проверьте подсвеченное и заполните остальное.${!fill.start && took.includes("when") ? " Время в тексте не нашлось — выберите «с» и «до»." : ""}`
        : "Новых данных в тексте не нашлось — заполненное не трогали. Заполните остальное вручную.",
    );
  }

  async function save() {
    if (!eventsRepo || !ready || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const saved = await eventsRepo.save({
        id,
        hostId,
        day,
        start,
        end,
        title: title.trim(),
        clientName: clientName.trim(),
        clientPhone: clientPhone.trim(),
        clientContact: contact,
        place: place.trim(),
        guests: guestsNum,
        note: note.trim(),
        program,
        // Правка — с версией, с которой открыли форму (владелец и менеджер могут править одно мероприятие).
        ...(initial?.updatedAt ? { expect: initial.updatedAt } : {}),
      });
      dropDraft();
      onSaved(saved);
    } catch (e) {
      setError(errorText(e));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  function close() {
    // Новое мероприятие: введённое остаётся в черновике — «Отмена» ничего не стирает.
    if (drafting) {
      keepDraft();
      return onCancel(hasDraft);
    }
    if (!dirty) return onCancel();
    ask({ title: "Не сохранять мероприятие?", text: "Введённое пропадёт.", confirmLabel: "Не сохранять", run: async () => onCancel() });
  }

  const tbd = place === PLACE_TBD;
  return (
    <section className="card stack plan-form" aria-labelledby="event-form">
      <h2 id="event-form">{initial ? "Изменить мероприятие" : r ? "Черновик мероприятия" : template ? "Похожее мероприятие" : "Новое мероприятие"}</h2>

      <div className={needs.length ? "plan-progress" : "plan-progress is-done"} role="status">
        <button type="button" className="plan-progress__text" onClick={goToFirst} disabled={!needs.length}>
          {needs.length ? (
            <>
              <b>
                Заполнено {doneCount} из 8 обязательных
              </b>
              <span> · осталось: {needs.map((k) => NEED_TITLES[k]).join(", ")}</span>
            </>
          ) : (
            <b>✓ Всё обязательное заполнено</b>
          )}
        </button>
        <span className="plan-progress__track" aria-hidden="true">
          <i style={{ width: `${(doneCount / 8) * 100}%` }} />
        </span>
      </div>

      <ImportFromLead today={today} onFill={apply} />
      {filled && (
        <p className="small plan-filled" role="status">
          {filled}
        </p>
      )}
      <p className="plan-legend small">
        <span>
          <span className="plan-star">*</span> обязательно
        </span>
        <span>
          <span className="plan-got">из расчёта</span> подставлено
        </span>
        <span>
          <span className="plan-needt">заполнить</span> ещё нужно
        </span>
      </p>

      <p className="plan-group">Для карточки клиента</p>
      <fieldset id={secId("name")} className={`plan-sec${done.name && done.phone && done.contact ? " is-done" : " is-need"}${got.name || got.phone || got.contact ? " is-got" : ""}`}>
        <legend>
          Клиент <NeedMark need done={done.name && done.phone && done.contact} />
        </legend>
        <label className="field">
          <span className="field__label">
            Имя <NeedMark need done={done.name} got={got.name} />
          </span>
          <input
            type="text"
            autoComplete="off"
            list={clientsRepo ? undefined : "event-clients"}
            maxLength={EVENT_LIMITS.client}
            value={clientName}
            placeholder="Как обращаться"
            className={got.name ? "is-got" : done.name ? "" : "is-need"}
            onFocus={() => {
              setPickFor("name");
              clientBase.load();
            }}
            onBlur={() => window.setTimeout(() => setPickFor((v) => (v === "name" ? null : v)), 250)}
            onChange={(e) => {
              setPickFor("name");
              setClientName(e.target.value);
              touch("name");
              const phone = clientPhones.get(e.target.value);
              if (phone && !clientPhone.trim()) setClientPhone(phone);
            }}
          />
        </label>
        {pickFor === "name" && <ClientSuggestions base={clientBase} query={clientName} onPick={pickClient} />}
        <datalist id="event-clients">
          {[...clientPhones.keys()].slice(0, 50).map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <label className="field" id={secId("phone")}>
          <span className="field__label">
            Телефон <NeedMark need done={done.phone} got={got.phone} />
          </span>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="off"
            maxLength={EVENT_LIMITS.phone}
            value={clientPhone}
            placeholder="+7 …"
            aria-invalid={phoneIncomplete}
            className={got.phone ? "is-got" : done.phone ? "" : "is-need"}
            onFocus={() => {
              setPickFor("phone");
              clientBase.load();
            }}
            onBlur={() => window.setTimeout(() => setPickFor((v) => (v === "phone" ? null : v)), 250)}
            onChange={(e) => {
              setPickFor("phone");
              setClientPhone(e.target.value);
              touch("phone");
            }}
          />
        </label>
        {pickFor === "phone" && <ClientSuggestions base={clientBase} query={clientPhone} onPick={pickClient} />}
        {phoneIncomplete && <p className="small plan-warn">{phoneIssueText(clientPhone)}</p>}
        {!fullPhone && !phoneIncomplete && nick && <p className="muted small">Без телефона клиент попадёт в «Клиенты» по нику Telegram.</p>}
        <div className="field" id={secId("contact")}>
          <span className="field__label">
            Связь — где писать клиенту <NeedMark need done={done.contact} got={got.contact} />
          </span>
          <div className="plan-quick plan-contact" role="radiogroup" aria-label="Где писать клиенту">
            {CONTACT_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={contactKind === k}
                className={contactKind === k ? "seg__btn is-on" : "seg__btn"}
                onClick={() => {
                  setContactKind(k);
                  if (k !== contactKind) setContactValue("");
                  touch("contact");
                }}
              >
                {CONTACT_TITLES[k]}
              </button>
            ))}
          </div>
          {contactKind === "telegram" && (
            <input
              type="text"
              autoComplete="off"
              aria-label="Ник Telegram"
              maxLength={60}
              value={contactValue}
              placeholder="@ник — или пусто, тогда по номеру"
              onChange={(e) => {
                setContactValue(e.target.value);
                touch("contact");
              }}
            />
          )}
          {contactKind === "email" && (
            <input
              type="email"
              autoComplete="off"
              aria-label="Почта клиента"
              maxLength={100}
              value={contactValue}
              placeholder="anna@mail.ru"
              onChange={(e) => {
                setContactValue(e.target.value);
                touch("contact");
              }}
            />
          )}
          {contactKind && !contactProblem && <p className="muted small">✓ {contactLabel(contact)}</p>}
          {contactKind && contactProblem && <p className="small plan-warn">{contactProblem}</p>}
        </div>
      </fieldset>

      <p className="plan-group">Для ведущего</p>
      <fieldset id={secId("when")} className={secClass("when")}>
        <legend>
          Когда <NeedMark need done={done.when} got={got.when} />
        </legend>
        <div className="plan-quick" role="group" aria-label="Быстрый выбор дня">
          {quickDays(today).map((q) => (
            <button
              key={q.day}
              type="button"
              className={day === q.day ? "seg__btn is-on" : "seg__btn"}
              aria-pressed={day === q.day}
              onClick={() => {
                setDay(q.day);
                touch("when");
              }}
            >
              {q.label}
            </button>
          ))}
        </div>
        <label className="field">
          <span className="field__label">Дата</span>
          <input
            type="date"
            value={day}
            min={addDays(today, -31)}
            onChange={(e) => {
              if (dayIndex(e.target.value) === null) return;
              setDay(e.target.value);
              touch("when");
            }}
          />
        </label>
        <TimeSelects
          start={start}
          end={end}
          unsetStart={!whenSet}
          unsetEnd={!whenSet}
          onChange={(s, e, which) => {
            setStart(s);
            // Выбрали «с», а «до» ещё не выбрано — «до» по умолчанию через 3,5 часа (типичный вечер с запасом).
            setEnd(!whenSet && which === "start" ? Math.min(s + 210, MAX_END) : e);
            setWhenSet(true);
            touch("when");
          }}
        />
        {whenSet ? (
          <p className="plan-when">
            {dayTitle(day)}, {rangeLabel(start, end)}
            <span className="muted small plan-when__hint">{lengthHint(start, end)}</span>
          </p>
        ) : (
          <p className="muted small">Выберите время «с» и «до». «До» — вместе с 30 минутами запаса: после него — продление за доплату.</p>
        )}
      </fieldset>

      <fieldset id={secId("title")} className={secClass("title")}>
        <legend>
          Повод <NeedMark need done={done.title} got={got.title} />
        </legend>
        <div className="plan-quick" role="group" aria-label="Повод">
          {EVENT_TITLES.slice(0, 6).map((t) => (
            <button
              key={t}
              type="button"
              className={title === t ? "seg__btn is-on" : "seg__btn"}
              aria-pressed={title === t}
              onClick={() => {
                setTitle(t);
                touch("title");
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <label className="field">
          <span className="field__label">Или своё</span>
          <input
            type="text"
            list="event-titles"
            maxLength={EVENT_LIMITS.title}
            value={title}
            placeholder="Юбилей, выпускной…"
            onChange={(e) => {
              setTitle(e.target.value);
              touch("title");
            }}
          />
        </label>
        <datalist id="event-titles">
          {EVENT_TITLES.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </fieldset>

      <fieldset id={secId("program")} className={secClass("program")}>
        <legend>
          Программа <NeedMark need done={done.program} got={got.program} />
        </legend>
        <p className="muted small">Форматы по порядку вечера. Ведущий увидит программу и подтвердит, что принял. Цена в программу не попадает.</p>
        <ProgramField
          program={program}
          onChange={(p) => {
            setProgram(p);
            touch("program");
          }}
        />
      </fieldset>

      <fieldset id={secId("place")} className={secClass("place")}>
        <legend>
          Где <NeedMark need done={done.place} got={got.place} />
        </legend>
        <label className="field">
          <span className="field__label">Адрес или площадка</span>
          <input
            type="text"
            list="event-places"
            maxLength={EVENT_LIMITS.place}
            value={tbd ? "" : place}
            disabled={tbd}
            placeholder={tbd ? PLACE_TBD : "Ресторан «Север», Тверская 7"}
            onChange={(e) => {
              setPlace(e.target.value);
              touch("place");
            }}
          />
        </label>
        <datalist id="event-places">
          {places.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <label className="choice">
          <input
            type="checkbox"
            checked={tbd}
            onChange={(e) => {
              setPlace(e.target.checked ? PLACE_TBD : "");
              touch("place");
            }}
          />
          <span className="choice__text">
            <span className="choice__title">Место пока уточняется</span>
            <span className="choice__hint">Ведущий увидит «Место уточняется». Узнаете адрес — «Изменить».</span>
          </span>
        </label>
      </fieldset>

      <fieldset id={secId("host")} className={secClass("host")}>
        <legend>
          Кто ведёт <NeedMark need done={done.host} />
        </legend>
        {team.status === "error" && <LoadFailedInline onRetry={retryTeam} />}
        {!teamData && team.status !== "error" && <p className="muted small">Загружаем команду…</p>}
        {!whenSet && <p className="muted small">Сначала выберите время — покажем, кто свободен.</p>}
        {hostGone && <p className="error small">{initial?.hostName || "Этот ведущий"} сейчас отключён — выберите другого.</p>}
        <div className="plan-hosts" role="radiogroup" aria-label="Ведущий">
          {members.map(({ member, info }) => (
            <label key={member.uid} className="choice plan-host">
              <input type="radio" name={`host-${id}`} checked={hostId === member.uid} onChange={() => setHostId(member.uid)} />
              <span className="choice__text">
                <span className="choice__title">{member.name}</span>
                {whenSet && (
                  <span className="choice__hint">
                    <Pill color={MEMBER_COLORS[info.status]}>{STATUS_TITLES[info.status]}</Pill>
                    {info.status === "partial" && ` свободен ${info.free.map((f) => `${timeLabel(f.start)}–${timeLabel(f.end)}`).join(", ")}`}
                    {info.status === "busy" && ` ${info.busy.map((b) => `${rangeLabel(b.start, b.end)}${b.note ? ` — ${b.note}` : ""}`).join("; ")}`}
                  </span>
                )}
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
        {whenSet && chosen?.status === "busy" && <p className="small plan-warn">У выбранного ведущего это время занято. Записать всё равно можно.</p>}
      </fieldset>

      <p className="plan-group">По желанию</p>
      <fieldset className={`plan-sec${got.guests || got.note ? " is-got" : ""}`}>
        <legend>Гостей и комментарий</legend>
        <label className="field">
          <span className="field__label">
            Гостей (точное число) <NeedMark got={got.guests} />
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={EVENT_LIMITS.guestsMax}
            step={1}
            value={guests}
            placeholder="Например, 37"
            aria-invalid={!guestsOk}
            onChange={(e) => {
              setGuests(e.target.value.replace(/\D/g, ""));
              touch("guests");
            }}
          />
        </label>
        {!guestsOk && <p className="small plan-warn">Гостей — числом до {EVENT_LIMITS.guestsMax}.</p>}
        <label className="field">
          <span className="field__label">
            Комментарий ведущему <NeedMark got={got.note} />
          </span>
          <textarea
            rows={3}
            maxLength={EVENT_LIMITS.note}
            value={note}
            placeholder="Пожелания, особенности зала, что взять с собой"
            onChange={(e) => {
              setNote(e.target.value);
              touch("note");
            }}
          />
        </label>
        <p className="muted small">Имя, телефон и связь клиента видят только вы и ведущий этого мероприятия. В Telegram ведущему уходит без клиента и адреса.</p>
      </fieldset>

      {needs.length > 0 && (
        <p className="small plan-warn" role="status">
          Чтобы записать, осталось: {needs.map((k) => NEED_TITLES[k]).join(", ")}.
        </p>
      )}
      {!initial && <p className="muted small">Записывайте, когда клиент согласен и внёс предоплату 2 000 ₽: ведущему сразу уходит заявка, его время занято.</p>}
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
          {hasDraft ? "Закрыть — оставить в черновике" : "Отмена"}
        </button>
        {hasDraft && (
          <button
            type="button"
            className="btn btn--quiet btn--block"
            disabled={busy}
            onClick={() =>
              ask({
                title: "Удалить черновик?",
                text: "Введённое в этой форме пропадёт.",
                confirmLabel: "Удалить черновик",
                run: async () => {
                  dropDraft();
                  onCancel();
                },
              })
            }
          >
            Удалить черновик
          </button>
        )}
      </div>
      {hasDraft && <p className="muted small">Черновик сохраняется сам на этом устройстве — можно уйти в «Клиенты» и вернуться.</p>}
      {confirm}
    </section>
  );
}

/**
 * Клиенты из базы (решение владельца 24 октября 2026): менеджер перевела клиента в «Клиент» и записывает мероприятие —
 * под полями имени и телефона сразу видны свежие «Клиент» и «В работе», по набранному имени или цифрам номера — все
 * подходящие; касание подставляет имя и полный телефон. Список перечитывается при касании поля и при возврате на вкладку.
 * Только владельцу и менеджеру по продажам (у остальных «Клиенты» закрыты — подсказок нет).
 */
interface ClientBase {
  list: ClientRecord[] | null;
  failed: boolean;
  load: () => void;
}

function useClientBase(): ClientBase {
  const [list, setList] = useState<ClientRecord[] | null>(null);
  const [failed, setFailed] = useState(false);
  const loading = useRef(false);
  const last = useRef(0);
  const load = () => {
    // Не чаще раза в 3 с: касание поля и возврат на вкладку приходят почти одновременно.
    if (!clientsRepo || loading.current || Date.now() - last.current < 3000) return;
    loading.current = true;
    last.current = Date.now();
    clientsRepo
      .list(false)
      .then((data) => {
        setList(data);
        setFailed(false);
      })
      .catch(() => setFailed(true))
      .finally(() => {
        loading.current = false;
      });
  };
  useEffect(() => {
    const again = () => document.visibilityState === "visible" && load();
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { list, failed, load };
}

function ClientSuggestions({ base, query, onPick }: { base: ClientBase; query: string; onPick: (c: ClientRecord) => void }) {
  if (!clientsRepo) return null;
  const q = query.trim();
  const digits = q.replace(/\D/g, "");
  const all = base.list ?? [];
  const byText = digits.length >= 3 && digits.length === q.replace(/[\s()+-]/g, "").length;
  const found = q
    ? all
        .filter((c) => (byText ? c.phone.replace(/\D/g, "").includes(digits.replace(/^[78]/, "")) : matchesSearch([c.name, phoneLabel(c.phone)], q)))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 6)
    : all
        .filter((c) => c.status === "client" || c.status === "work")
        .sort((a, b) => (b.statusAt ?? b.updatedAt) - (a.statusAt ?? a.updatedAt))
        .slice(0, 5);
  if (base.list === null) return <p className="muted small">{base.failed ? "Не получилось открыть «Клиентов» — впишите вручную." : "Открываем «Клиентов»…"}</p>;
  if (!found.length) return q ? <p className="muted small">В «Клиентах» такого нет — впишите вручную.</p> : null;
  return (
    <div className="plan-client-pick">
      <p className="muted small">{q ? "Из «Клиентов» — коснитесь, чтобы подставить:" : "Недавно «Клиент» и «В работе» — коснитесь, чтобы подставить:"}</p>
      <ul className="plan-client-pick__list">
        {found.map((c) => (
          <li key={c.id}>
            {/* mousedown/pointerdown не уводит фокус из поля — касание срабатывает раньше, чем список спрячется. */}
            <button type="button" className="plan-client-pick__item" onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(c)}>
              <b>{c.name || "Без имени"}</b>
              <span className="muted small">
                {c.phone ? phoneLabel(c.phone) : "без телефона"} · {CLIENT_STATUS_TITLES[c.status]}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * «📋 Вставить расчёт или заявку» (решение владельца 24 октября 2026): текст из WhatsApp, Telegram, Авито, почты или
 * заявки с сайта — имя, телефон, ник, дата, время «с» и «до» (из длительности расчёта), повод, гости, место и программа.
 * Заполняет только пустые поля. Или заявка клиента из базы площадок.
 */
function ImportFromLead({ today, onFill }: { today: string; onFill: (fill: LeadFill & { program?: EventProgram | null }, from: string) => void }) {
  const [text, setText] = useState("");
  const [showRequests, setShowRequests] = useState(false);
  return (
    <Fold title="📋 Вставить расчёт или заявку" value="текст из чата — поля заполнятся сами">
      <div className="stack stack--tight">
        <label className="field">
          <span className="field__label">Расчёт клиента или текст заявки</span>
          <textarea rows={5} value={text} placeholder="🧮 Расчёт JoyRest… или сообщение клиента: имя, телефон, дата, время, гости" onChange={(e) => setText(e.target.value)} />
        </label>
        <div className="actions">
          <button
            type="button"
            className="btn btn--secondary btn--block"
            disabled={!text.trim()}
            onClick={() => onFill({ ...parseLeadText(text, today), program: programFromCalc(text) }, /Расч[её]т JoyRest/i.test(text) ? "из расчёта" : "из заявки")}
          >
            Разложить по полям
          </button>
          {venuesRepo && (
            <button type="button" className="btn btn--quiet btn--block" aria-expanded={showRequests} onClick={() => setShowRequests(!showRequests)}>
              {showRequests ? "Скрыть заявки клиентов" : "Взять из заявок клиентов"}
            </button>
          )}
        </div>
        {showRequests && <RequestPicker onPick={(r) => onFill(fillFromRequest(r.data), "из заявки")} />}
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
