/**
 * Календарь команды (CLAUDE.md, раздел 3, «Календарь»; решение владельца 14 октября 2026).
 * «Мой календарь» — каждый отмечает, когда свободен и когда занят. «Кто может» — владелец вводит дату
 * и время мероприятия и сразу видит, кто свободен, кто занят и кто ничего не отметил; закрепляет
 * время за ведущим («Мероприятие JoyRest» — у ведущего это время становится занятым).
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  addDays,
  availabilityOf,
  DAY_MINUTES,
  dayIndex,
  dayTitle,
  DEFAULT_QUERY,
  endAfter,
  entriesOfDay,
  isWholeDay,
  KIND_TITLES,
  monthGrid,
  monthTitle,
  NOTE_MAX,
  rangeLabel,
  STATUS_ORDER,
  STATUS_TITLES,
  timeLabel,
  TIME_OPTIONS,
  todayMoscow,
  WEEK_SHORT,
  weeklyDays,
  type MemberAvailability,
  type MemberStatus,
} from "../../core/calendar";
import { professionOf, professionTitle } from "../../core/professions";
import { calendarRepo, permissions, useLoad, type AvailabilityEntry, type AvailabilityKind, type CalendarMember, type UserProfile } from "../../data";
import { useConfirm } from "../../components/ConfirmDialog";
import { HostGate } from "../../components/HostGate";
import { ListSkeleton, StudioSkeleton } from "../../components/Skeleton";
import { LoadFailedInline } from "../../components/Status";
import { Tabs } from "../../components/Tabs";
import { Toast, useToast } from "../../components/Toast";
import { TopBar } from "../../components/TopBar";
import { brand } from "../../themes/brand";
import { studioActions } from "./Studio";

const KIND_COLORS: Record<AvailabilityKind, string> = { free: brand.sage, busy: brand.coral, booked: brand.gold };
const STATUS_COLORS: Record<MemberStatus, string> = { free: brand.sage, partial: brand.gold, unknown: brand.taupe, busy: brand.coral };

/** id записи создаёт браузер: повтор после обрыва — та же запись. */
function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return "c" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20);
}

export function Calendar() {
  return (
    <HostGate skeleton={<StudioSkeleton />}>
      {(_user, profile) => <CalendarPage profile={profile} />}
    </HostGate>
  );
}

type Tab = "who" | "mine";

function CalendarPage({ profile }: { profile: UserProfile }) {
  const [params, setParams] = useSearchParams();
  const owner = permissions.canViewTeamCalendar(profile);
  const tab: Tab = owner && params.get("tab") !== "mine" ? "who" : "mine";
  const [toast, showToast] = useToast();
  const actions = [{ label: "В студию", to: "/studio" }, ...studioActions(profile)];
  return (
    <main className="page">
      <TopBar title="Календарь" actions={actions} />
      {!calendarRepo ? (
        <p className="muted">Календарь доступен на своём сервере JoyRest.</p>
      ) : (
        <>
          {owner && (
            <Tabs
              idPrefix="calendar"
              label="Календарь"
              value={tab}
              onChange={(next) => setParams({ tab: next }, { replace: true })}
              items={[
                { id: "who", label: "Кто может" },
                { id: "mine", label: "Мой календарь" },
              ]}
            />
          )}
          <div id={`calendar-panel-${tab}`} role={owner ? "tabpanel" : undefined} className="stack">
            {tab === "who" ? <WhoCan onToast={showToast} /> : <MyCalendar onToast={showToast} />}
          </div>
        </>
      )}
      <Toast text={toast} />
    </main>
  );
}

/** Подпись времени в списке: «02:00 (след. день)» для конца после полуночи. */
function endOptionLabel(start: number, value: number): string {
  return endAfter(start, value) > DAY_MINUTES ? `${timeLabel(value)} (след. день)` : timeLabel(value);
}

function TimeSelects({ start, end, onChange, disabled }: { start: number; end: number; onChange: (start: number, end: number) => void; disabled?: boolean }) {
  // В списке «до» — время дня; меньше «с» — значит после полуночи.
  const endValue = end % DAY_MINUTES;
  return (
    <div className="cal-times">
      <label className="field">
        <span className="field__label">С</span>
        <select value={start} disabled={disabled} onChange={(e) => {
          const s = Number(e.target.value);
          onChange(s, endAfter(s, endValue));
        }}>
          {TIME_OPTIONS.map((t) => (
            <option key={t} value={t}>{timeLabel(t)}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field__label">До</span>
        <select value={endValue} disabled={disabled} onChange={(e) => onChange(start, Math.min(endAfter(start, Number(e.target.value)), DAY_MINUTES + 6 * 60))}>
          {TIME_OPTIONS.map((t) => (
            <option key={t} value={t} disabled={endAfter(start, t) > DAY_MINUTES + 6 * 60}>
              {endOptionLabel(start, t)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function Pill({ color, children }: { color: string; children: string }) {
  return (
    <span className="status-pill" style={{ "--status-color": color } as CSSProperties}>
      {children}
    </span>
  );
}

/** Месяц для загрузки: с первого по последнее число (сервер добавит прошлый день сам). */
function monthRange(day: string): { from: string; to: string; year: number; month: number } {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const from = `${day.slice(0, 7)}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // Ночь последнего дня месяца задевает первое число следующего.
  return { from, to: addDays(`${day.slice(0, 7)}-${String(last).padStart(2, "0")}`, 1), year, month };
}

function shiftMonth(day: string, delta: number): string {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7)) - 1 + delta;
  const d = new Date(Date.UTC(year, month, 1));
  return d.toISOString().slice(0, 10);
}

// ───────────────────────────── Кто может (владелец) ─────────────────────────────

function WhoCan({ onToast }: { onToast: (text: string) => void }) {
  const today = todayMoscow();
  const [day, setDay] = useState(today);
  const [start, setStart] = useState(DEFAULT_QUERY.start);
  const [end, setEnd] = useState(DEFAULT_QUERY.end);
  const [everyone, setEveryone] = useState(false);
  const range = monthRange(day);
  const [state, retry, update] = useLoad(
    () => (calendarRepo ? calendarRepo.team(range.from, range.to) : Promise.resolve({ members: [] as CalendarMember[], entries: [] as AvailabilityEntry[] })),
    [range.from, range.to],
  );
  const [confirm, ask] = useConfirm();

  if (state.status === "loading") return <ListSkeleton />;
  if (state.status === "error") return <LoadFailedInline onRetry={retry} />;
  const { members, entries } = state.data;
  const people = members.filter((m) => everyone || m.owner || professionOf(m.profession) === "host");
  const rows = people
    .map((m) => ({ member: m, info: availabilityOf(entries.filter((e) => e.uid === m.uid), day, start, end) }))
    .sort((a, b) => STATUS_ORDER[a.info.status] - STATUS_ORDER[b.info.status] || a.member.name.localeCompare(b.member.name, "ru"));
  const counts = (status: MemberStatus) => rows.filter((r) => r.info.status === status).length;

  async function book(member: CalendarMember, note: string) {
    if (!calendarRepo) return;
    const entry = await calendarRepo.book({ id: newId(), uid: member.uid, day, start, end, note });
    update((data) => ({ ...data, entries: [...data.entries, entry] }));
    onToast(`Время закреплено за: ${member.name}`);
  }

  function unbook(member: CalendarMember, entry: AvailabilityEntry) {
    ask({
      title: `Снять мероприятие у ${member.name}?`,
      text: `${dayTitle(entry.day)}, ${rangeLabel(entry.start, entry.end)}${entry.note ? ` — ${entry.note}` : ""}. Время снова станет незанятым.`,
      confirmLabel: "Снять",
      run: async () => {
        await calendarRepo?.remove(entry.id);
        update((data) => ({ ...data, entries: data.entries.filter((e) => e.id !== entry.id) }));
        onToast("Мероприятие снято");
      },
    });
  }

  return (
    <>
      <section className="card stack" aria-labelledby="who-when">
        <h2 id="who-when">Когда мероприятие</h2>
        <label className="field">
          <span className="field__label">Дата</span>
          <input type="date" value={day} min={addDays(today, -31)} onChange={(e) => dayIndex(e.target.value) !== null && setDay(e.target.value)} />
        </label>
        <TimeSelects start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e); }} />
        <p className="muted small">{dayTitle(day)}, {rangeLabel(start, end)}</p>
        <label className="choice">
          <input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} />
          <span className="choice__text">
            <span className="choice__title">Вся команда</span>
            <span className="choice__hint">Не только ведущие: диджеи, музыканты, фокусники и другие.</span>
          </span>
        </label>
      </section>

      <p className="cal-summary" aria-live="polite">
        Могут: <b>{counts("free")}</b> · частично: <b>{counts("partial")}</b> · не отметили: <b>{counts("unknown")}</b> · заняты: <b>{counts("busy")}</b>
      </p>

      <ul className="cal-people">
        {rows.map(({ member, info }) => (
          <PersonRow key={member.uid} member={member} info={info} showProfession={everyone} onBook={book} onUnbook={unbook} />
        ))}
      </ul>
      {rows.length === 0 && <p className="muted">В команде пока никого — добавьте людей в «Команда JoyRest → Управление».</p>}

      <MonthFree day={day} start={start} end={end} people={people} entries={entries} onPick={setDay} onMonth={(d) => setDay(d)} />
      {confirm}
    </>
  );
}

function PersonRow({
  member,
  info,
  showProfession,
  onBook,
  onUnbook,
}: {
  member: CalendarMember;
  info: MemberAvailability;
  showProfession: boolean;
  onBook: (member: CalendarMember, note: string) => Promise<void>;
  onUnbook: (member: CalendarMember, entry: AvailabilityEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onBook(member, note.trim());
      setOpen(false);
      setNote("");
    } catch {
      setError("Не получилось закрепить. Проверьте интернет и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="card cal-person">
      <div className="cal-person__head">
        <span className="cal-person__name">{member.name}</span>
        <Pill color={STATUS_COLORS[info.status]}>{STATUS_TITLES[info.status]}</Pill>
      </div>
      {showProfession && <p className="muted small">{member.owner ? "Владелец" : professionTitle(member.profession)}</p>}
      {info.status === "partial" && (
        <p className="small">Свободен только {info.free.map((f) => `${timeLabel(f.start)}–${timeLabel(f.end)}`).join(", ")}</p>
      )}
      {info.status === "unknown" && <p className="muted small">Этот день не отмечен — уточните у человека.</p>}
      {info.busy.map((e) => (
        <div key={e.id} className="cal-busy">
          <p className="small">
            <b>{KIND_TITLES[e.kind]}</b> · {e.day === info.busy[0]?.day ? "" : `${dayTitle(e.day)}, `}{rangeLabel(e.start, e.end)}
            {e.note ? ` — ${e.note}` : ""}
          </p>
          {e.kind === "booked" && (
            <button type="button" className="btn btn--quiet" onClick={() => onUnbook(member, e)}>
              Снять мероприятие
            </button>
          )}
        </div>
      ))}
      {info.status !== "busy" &&
        (open ? (
          <div className="stack">
            <label className="field">
              <span className="field__label">Что за мероприятие (увидит ведущий)</span>
              <input type="text" maxLength={NOTE_MAX} value={note} placeholder="Например: корпоратив, 40 гостей" onChange={(e) => setNote(e.target.value)} />
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="actions">
              <button type="button" className="btn btn--block" disabled={busy} onClick={() => void submit()}>
                {busy ? "Закрепляем…" : "Закрепить время"}
              </button>
              <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={() => setOpen(false)}>
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn--secondary btn--block" aria-label={`Закрепить это время за: ${member.name}`} onClick={() => setOpen(true)}>
            Закрепить это время
          </button>
        ))}
    </li>
  );
}

/** Месяц: сколько людей может в каждый день в выбранное время. Касание дня — выбрать его. */
function MonthFree({
  day,
  start,
  end,
  people,
  entries,
  onPick,
  onMonth,
}: {
  day: string;
  start: number;
  end: number;
  people: CalendarMember[];
  entries: AvailabilityEntry[];
  onPick: (day: string) => void;
  onMonth: (day: string) => void;
}) {
  const { year, month } = monthRange(day);
  const byUser = useMemo(() => {
    const map = new Map<string, AvailabilityEntry[]>();
    for (const e of entries) map.set(e.uid, [...(map.get(e.uid) ?? []), e]);
    return map;
  }, [entries]);
  const freeOn = (d: string) => people.filter((p) => availabilityOf(byUser.get(p.uid) ?? [], d, start, end).status === "free").length;
  return (
    <section className="card stack" aria-labelledby="who-month">
      <h2 id="who-month">Свободные дни</h2>
      <p className="muted small">Число в дне — сколько человек могут {rangeLabel(start, end)}. Удобно предложить клиенту другую дату.</p>
      <MonthHeader year={year} month={month} onPrev={() => onMonth(shiftMonth(day, -1))} onNext={() => onMonth(shiftMonth(day, 1))} />
      <MonthGrid
        year={year}
        month={month}
        selected={day}
        render={(d) => {
          const n = freeOn(d);
          return (
            <span className={n > 0 ? "cal-count" : "cal-count cal-count--none"} style={{ "--count-color": brand.sage } as CSSProperties}>
              {n > 0 ? n : ""}
            </span>
          );
        }}
        onPick={onPick}
      />
    </section>
  );
}

// ───────────────────────────── Мой календарь ─────────────────────────────

function MyCalendar({ onToast }: { onToast: (text: string) => void }) {
  const today = todayMoscow();
  const [day, setDay] = useState(today);
  const range = monthRange(day);
  const [state, retry, update] = useLoad(() => (calendarRepo ? calendarRepo.mine(range.from, range.to) : Promise.resolve([] as AvailabilityEntry[])), [range.from, range.to]);
  const [confirm, ask] = useConfirm();

  if (state.status === "loading") return <ListSkeleton />;
  if (state.status === "error") return <LoadFailedInline onRetry={retry} />;
  const entries = state.data;
  const ofDay = entriesOfDay(entries, day);

  function remove(entry: AvailabilityEntry) {
    ask({
      title: "Убрать отметку?",
      text: `${KIND_TITLES[entry.kind]}: ${dayTitle(entry.day)}, ${rangeLabel(entry.start, entry.end)}`,
      confirmLabel: "Убрать",
      run: async () => {
        await calendarRepo?.remove(entry.id);
        update((data) => data.filter((e) => e.id !== entry.id));
        onToast("Отметка убрана");
      },
    });
  }

  return (
    <>
      <p className="muted">Отмечайте, когда вы свободны и когда заняты — владелец видит это, когда договаривается с клиентом.</p>
      <section className="card stack" aria-label="Месяц">
        <MonthHeader year={range.year} month={range.month} onPrev={() => setDay(shiftMonth(day, -1))} onNext={() => setDay(shiftMonth(day, 1))} />
        <MonthGrid
          year={range.year}
          month={range.month}
          selected={day}
          today={today}
          render={(d) => {
            const kinds = new Set(entriesOfDay(entries, d).map((e) => e.kind));
            return (
              <span className="cal-dots" aria-hidden="true">
                {(["free", "busy", "booked"] as const).filter((k) => kinds.has(k)).map((k) => (
                  <span key={k} className="cal-dot" style={{ "--dot": KIND_COLORS[k] } as CSSProperties} />
                ))}
              </span>
            );
          }}
          onPick={setDay}
        />
        <p className="cal-legend small">
          {(["free", "busy", "booked"] as const).map((k) => (
            <span key={k}>
              <span className="cal-dot" style={{ "--dot": KIND_COLORS[k] } as CSSProperties} aria-hidden="true" /> {KIND_TITLES[k]}
            </span>
          ))}
        </p>
      </section>

      <section className="card stack" aria-labelledby="my-day">
        <h2 id="my-day">{dayTitle(day)}</h2>
        {ofDay.length === 0 ? (
          <p className="muted">Ничего не отмечено.</p>
        ) : (
          <ul className="cal-entries">
            {ofDay.map((e) => (
              <li key={e.id} className="cal-entry">
                <Pill color={KIND_COLORS[e.kind]}>{KIND_TITLES[e.kind]}</Pill>
                <span className="cal-entry__time">
                  {e.day !== day ? `с вечера ${dayTitle(e.day).split(",")[0]}: до ${timeLabel(e.end)}` : rangeLabel(e.start, e.end)}
                </span>
                {e.note && <span className="muted small cal-entry__note">{e.note}</span>}
                {e.kind === "booked" ? (
                  <span className="muted small">Закрепил владелец</span>
                ) : (
                  <button type="button" className="btn btn--quiet" onClick={() => remove(e)}>
                    Убрать
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <AddEntry
          day={day}
          today={today}
          onSaved={(added, text) => {
            update((data) => [...data.filter((e) => !added.some((a) => a.id === e.id)), ...added]);
            onToast(text);
          }}
        />
      </section>
      {confirm}
    </>
  );
}

const REPEATS = [
  { weeks: 1, label: "Только этот день" },
  { weeks: 4, label: "Каждую неделю — 4 недели" },
  { weeks: 8, label: "Каждую неделю — 8 недель" },
  { weeks: 12, label: "Каждую неделю — 12 недель" },
];

function AddEntry({ day, today, onSaved }: { day: string; today: string; onSaved: (added: AvailabilityEntry[], text: string) => void }) {
  const [kind, setKind] = useState<"free" | "busy">("free");
  const [whole, setWhole] = useState(false);
  const [start, setStart] = useState(DEFAULT_QUERY.start);
  const [end, setEnd] = useState(DEFAULT_QUERY.end + 60);
  const [note, setNote] = useState("");
  const [weeks, setWeeks] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const past = (dayIndex(day) ?? 0) < (dayIndex(today) ?? 0);

  async function save(k: "free" | "busy", s: number, e: number, w: number, n: string) {
    if (!calendarRepo) return;
    setBusy(true);
    setError(null);
    try {
      const days = weeklyDays(day, w);
      const added: AvailabilityEntry[] = [];
      for (const d of days) added.push(await calendarRepo.save({ id: newId(), day: d, start: s, end: e, kind: k, note: n }));
      const what = `${k === "free" ? "Свободен" : "Занят"} ${rangeLabel(s, e)}`;
      onSaved(added, days.length > 1 ? `${what} — ${days.length} недель` : what);
      setNote("");
    } catch {
      setError("Не получилось сохранить. Проверьте интернет и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  if (past) return <p className="muted small">Прошедший день — отмечать не нужно.</p>;
  return (
    <div className="stack cal-add">
      <div className="actions">
        <button type="button" className="btn btn--block" disabled={busy} onClick={() => void save("free", 0, DAY_MINUTES, 1, "")}>
          Свободен весь день
        </button>
      </div>
      <fieldset className="stack">
        <legend>Или точнее</legend>
        {(["free", "busy"] as const).map((k) => (
          <label key={k} className="choice">
            <input type="radio" name="cal-kind" checked={kind === k} onChange={() => setKind(k)} />
            <span className="choice__text">
              <span className="choice__title">{k === "free" ? "Свободен" : "Занят"}</span>
              <span className="choice__hint">{k === "free" ? "Можно ставить на мероприятие" : "Своё мероприятие, работа, личное"}</span>
            </span>
          </label>
        ))}
        <label className="choice">
          <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} />
          <span className="choice__text">
            <span className="choice__title">Весь день</span>
          </span>
        </label>
        {!whole && <TimeSelects start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e); }} />}
        <label className="field">
          <span className="field__label">Заметка (видит владелец, можно пусто)</span>
          <input type="text" maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Повторять</span>
          <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
            {REPEATS.map((r) => (
              <option key={r.weeks} value={r.weeks}>{r.label}</option>
            ))}
          </select>
        </label>
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button
          type="button"
          className="btn btn--secondary btn--block"
          disabled={busy}
          onClick={() => void save(kind, whole ? 0 : start, whole ? DAY_MINUTES : end, weeks, note.trim())}
        >
          {busy ? "Сохраняем…" : `Добавить: ${kind === "free" ? "свободен" : "занят"} ${whole || isWholeDay(start, end) ? "весь день" : rangeLabel(start, end)}`}
        </button>
      </div>
    </div>
  );
}

// ───────────────────────────── Сетка месяца ─────────────────────────────

function MonthHeader({ year, month, onPrev, onNext }: { year: number; month: number; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="cal-month">
      <button type="button" className="btn btn--quiet" aria-label="Прошлый месяц" onClick={onPrev}>
        ←
      </button>
      <span className="cal-month__title">{monthTitle(year, month)}</span>
      <button type="button" className="btn btn--quiet" aria-label="Следующий месяц" onClick={onNext}>
        →
      </button>
    </div>
  );
}

function MonthGrid({
  year,
  month,
  selected,
  today,
  render,
  onPick,
}: {
  year: number;
  month: number;
  selected: string;
  today?: string;
  render: (day: string) => ReactNode;
  onPick: (day: string) => void;
}) {
  const cells = monthGrid(year, month);
  return (
    <div className="cal-grid" role="grid" aria-label={monthTitle(year, month)}>
      {WEEK_SHORT.map((w) => (
        <span key={w} className="cal-grid__week" role="columnheader">
          {w}
        </span>
      ))}
      {cells.map((d, i) =>
        d ? (
          <button
            key={d}
            type="button"
            className={`cal-day${d === selected ? " is-selected" : ""}${d === today ? " is-today" : ""}`}
            aria-pressed={d === selected}
            aria-label={dayTitle(d)}
            onClick={() => onPick(d)}
          >
            <span className="cal-day__n">{Number(d.slice(8, 10))}</span>
            {render(d)}
          </button>
        ) : (
          <span key={`e${i}`} className="cal-day cal-day--empty" />
        ),
      )}
    </div>
  );
}
