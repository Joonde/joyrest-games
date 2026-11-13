/**
 * «Активные заказы» (решения владельца 12–13 ноября 2026). Источник истины — docs/active-orders.md: группы, колонки, деньги,
 * подсветка и следующий шаг. Чистые функции без сети: на входе ответ `GET /api/orders` и время сервера, на выходе — строки
 * страницы. Страница ничего не меняет, только показывает и ведёт в карточку клиента или мероприятия.
 */
import type { OrderEvent, OrdersBoard, OrderTalk } from "../data/types";
import { dayIndex, todayMoscow } from "./calendar";
import { CLIENT_STATUS_TITLES, originTitle } from "./clients";
import { wishFromText } from "./clientWish";
import { eventLight } from "./eventLight";
import { eventSpan, PLACE_TBD } from "./events";
import { dueOnSite, PREPAY_RUB, priceFromCalc, rub } from "./prepay";
import { matchesSearch } from "./search";

export type OrderGroup = "booked" | "talk" | "close" | "off";
export const ORDER_GROUPS: OrderGroup[] = ["booked", "talk", "close", "off"];
export const GROUP_TITLES: Record<OrderGroup, { title: string; hint: string }> = {
  booked: { title: "Забронированы", hint: "мероприятие впереди" },
  talk: { title: "В переговорах", hint: "предоплаты ещё нет" },
  close: { title: "Прошли", hint: "нужно закрыть" },
  off: { title: "Отменены", hint: "предоплата остаётся или возвращается" },
};

/** Тон плашки или подписи: цвета — классы `orders-tone--*` в src/styles.css. */
export type Tone = "replace" | "late" | "wait" | "ok" | "live" | "over" | "held" | "check" | "failed" | "off" | "none";
export type MoneyTone = "ok" | "warn" | "bad" | "muted" | "plain";

export interface Mark {
  label: string;
  sub: string;
  tone: Tone;
}
export interface Money {
  text: string;
  sub: string;
  tone: MoneyTone;
}

export interface OrderRow {
  key: string;
  group: OrderGroup;
  /** Куда ведёт касание строки. */
  href: string;
  date: string;
  time: string;
  when: string;
  whenAlert: boolean;
  client: string;
  what: string;
  details: string;
  placeWarn: boolean;
  status: { label: string; tone: string } | null;
  who: string;
  /** Имя того, кто ведёт клиента (фильтр «Кто ведёт клиента»), пусто — никто. */
  ownerName: string;
  host: string;
  hostWarn: boolean;
  accepted: Mark;
  held: Mark;
  price: number | null;
  priceText: string;
  priceSub: string;
  priceStruck: boolean;
  prepay: Money;
  due: Money;
  /** Агентству и ведущему, ₽ (null — не считается); `approx` — «≈» (нет стоимости по брони). */
  agency: number | null;
  hostPay: number | null;
  approx: boolean;
  step: string;
  stepTone: "alert" | "plain" | "muted";
  alert: boolean;
  /** Для порядка «по дате» внутри группы. */
  sortAt: number;
  /** Отменено и ждёт возврата предоплаты. */
  refundWaiting: boolean;
  prepaid: boolean;
  search: string[];
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;
/** Клиент ждёт ответа дольше — строка красная (как ⏰ в «Клиентах»). */
export const ANSWER_WAIT_MS = 30 * MIN_MS;
/** За сколько до начала нужны адрес и созвон. */
export const CALL_BEFORE_MS = 3 * DAY_MS;

const WD = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const MON = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (min: number) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

/** «Пт, 13 ноя». */
export function shortDay(day: string): string {
  const i = dayIndex(day);
  if (i === null) return day;
  const d = new Date(i * DAY_MS);
  return `${WD[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}

/** Дата и время по Москве из мс: «11 ноя, 09:15». */
export function stamp(ms: number): string {
  const d = new Date(ms + 3 * HOUR_MS);
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 10;
  const b = Math.abs(n) % 100;
  const f = a === 1 && b !== 11 ? forms[0] : a >= 2 && a <= 4 && (b < 12 || b > 14) ? forms[1] : forms[2];
  return `${n} ${f}`;
}

/** «через 23 ч», «через 2 дня», «2 дня назад», «сейчас». */
export function relative(ms: number, now: number): string {
  const d = ms - now;
  const a = Math.abs(d);
  let text: string;
  if (a < HOUR_MS) text = plural(Math.max(1, Math.round(a / MIN_MS)), ["мин", "мин", "мин"]);
  else if (a < 2 * DAY_MS) text = `${Math.round(a / HOUR_MS)} ч`;
  else text = plural(Math.round(a / DAY_MS), ["день", "дня", "дней"]);
  return d >= 0 ? `через ${text}` : `${text} назад`;
}

/** Ожидание: «12 мин», «2 ч 05 мин». */
export function waitText(ms: number): string {
  const m = Math.max(0, Math.floor(ms / MIN_MS));
  return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${pad(m % 60)} мин`;
}

/**
 * Доля ведущего (решения владельца 16 октября 2026): 55% стоимости, не меньше 5 000 ₽; от 46 гостей — 20 000 ₽ ровно.
 * Формат ведущего платформа не знает — это оценка («≈»).
 */
export const HOST_SHARE = 0.55;
export const HOST_MIN_RUB = 5000;
export const BIG_PARTY_GUESTS = 46;
export const BIG_PARTY_HOST_RUB = 20_000;
export function hostShare(price: number, guests: number | null): number {
  if (guests !== null && guests >= BIG_PARTY_GUESTS) return Math.min(price, BIG_PARTY_HOST_RUB);
  return Math.min(price, Math.max(HOST_MIN_RUB, Math.round(price * HOST_SHARE)));
}
export function agencyShare(price: number, guests: number | null): number {
  return Math.max(0, price - hostShare(price, guests));
}

/**
 * Цена из присланного расчёта: «✅ … — выбран» или «Цена:» (`priceFromCalc`), иначе строка заявки сайта
 * «… Итого: Опытный — 29 900 ₽, Новые лица — 23 900 ₽, …» — выбранный формат по строке «Ведущий: …», без неё — первый.
 */
export function talkPrice(text: string): number | null {
  const direct = priceFromCalc(text);
  if (direct !== null) return direct;
  const total = /Итого[^:\n]*:\s*([^\n]+)/.exec(text)?.[1] ?? "";
  const pairs = [...total.matchAll(/([А-ЯЁа-яё][А-ЯЁа-яё ]*?)\s+—\s+([\d\s\u00a0\u202f]{1,12})₽/g)].map((m) => ({
    name: (m[1] ?? "").trim(),
    price: Number((m[2] ?? "").replace(/\D/g, "")),
  }));
  if (!pairs.length) return null;
  const level = /^Ведущий:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? "";
  const pick = (level && pairs.find((p) => level.startsWith(p.name))) || pairs[0];
  return pick && pick.price > 0 ? pick.price : null;
}

const emptyPlace = (place: string) => !place.trim() || place.trim() === PLACE_TBD;

function guestsText(n: number | null | undefined): string {
  return typeof n === "number" && n > 0 ? plural(n, ["гость", "гостя", "гостей"]) : "гостей не указано";
}

/** Строка мероприятия (группы «Забронированы», «Прошли», «Отменены»). */
export function eventRow(e: OrderEvent, now: number): OrderRow {
  const span = eventSpan(e);
  const from = span?.from ?? 0;
  const to = span?.to ?? 0;
  const off = e.cancelled;
  const started = now >= from;
  const ended = now >= to;
  const group: OrderGroup = off ? "off" : ended ? "close" : "booked";
  const light = eventLight(e, now);
  const host = e.hostName || "не назначен";
  const firstName = e.hostName.split(" ")[0] ?? "";
  const prepaid = Boolean(e.prepaidAt);
  const price = typeof e.price === "number" ? e.price : null;
  const refundWaiting = off && Boolean(e.refundAt) && !e.refundDoneAt;
  // Перенос — клиент остался «Клиентом» (не в архиве), предоплата у агентства, возврата нет (как в SQL, docs раздел 2).
  // Новую дату уже записали (`clientAhead`) — перенос сделан; иначе (отказ, возврат, клиента нет) — просто «Отменено».
  const moved = off && e.clientStatus === "client" && !e.clientArchived && prepaid && !e.refundAt;
  const rebooked = moved && Boolean(e.clientAhead);
  const lost = !moved;

  // Подтвердил
  let accepted: Mark;
  if (off) accepted = { label: "Отменено", sub: "ведущий свободен", tone: "off" };
  else if (!started && light.light === "replace") accepted = { label: "Нужна замена", sub: "ведущий не сможет провести", tone: "replace" };
  else if (!started && light.light === "late") accepted = { label: "Не подтвердил", sub: `до начала ${relative(from, now).replace("через ", "")}`, tone: "late" };
  else if (!started && light.light === "wait") accepted = { label: "Ждёт ведущего", sub: "ещё не нажал «Принял»", tone: "wait" };
  else if (e.acceptedAt) accepted = { label: "Принял", sub: stamp(e.acceptedAt), tone: "ok" };
  else if ((e.acceptRev ?? 0) === 0) accepted = { label: "Принято", sub: "записано до подтверждений", tone: "ok" };
  else accepted = { label: "—", sub: "не нажал «Принял»", tone: "none" };

  // Провёл
  let held: Mark;
  if (off) held = lost
      ? { label: "Отменено", sub: "не состоится", tone: "off" }
      : { label: "Перенос", sub: rebooked ? "новая дата записана" : "новой даты нет", tone: "off" };
  else if (e.held === true) held = { label: "Проведено", sub: "", tone: "held" };
  else if (e.held === false) held = { label: "Не состоялось", sub: "", tone: "failed" };
  else if (light.light === "over") held = { label: "Сверх плана", sub: light.label.replace("Сверх плана · ", ""), tone: "over" };
  else if (light.light === "live" || (started && !ended)) held = { label: "Идёт", sub: `до ${hhmm(e.end)}`, tone: "live" };
  else if (ended) held = { label: "Не отмечено", sub: "узнайте у ведущего", tone: "check" };
  else held = { label: "—", sub: "ещё впереди", tone: "none" };

  // Деньги
  let prepay: Money;
  if (off) {
    if (refundWaiting) prepay = { text: `Вернуть ${rub(PREPAY_RUB)}`, sub: e.refundAt ? `запрошено ${stamp(e.refundAt)}` : "", tone: "bad" };
    else if (e.refundDoneAt) prepay = { text: "Возвращена", sub: `${rub(PREPAY_RUB)} — ${stamp(e.refundDoneAt)}`, tone: "muted" };
    else if (prepaid) prepay = { text: `Остаётся ${rub(PREPAY_RUB)}`, sub: lost ? "у агентства" : "идёт в новую дату", tone: "warn" };
    else prepay = { text: "—", sub: "не вносили", tone: "muted" };
  } else if (prepaid) prepay = { text: rub(PREPAY_RUB), sub: "внесена", tone: "ok" };
  else prepay = { text: "Не отмечена", sub: "ждём 2 000 ₽", tone: "warn" };

  // Остаток — только у мероприятия со стоимостью и предоплатой (docs/active-orders.md, раздел 4).
  const dueSum = off || !prepaid ? null : dueOnSite(price, prepaid);
  let due: Money;
  if (dueSum === null) due = { text: "—", sub: off ? "" : price === null ? "нет стоимости" : "после предоплаты", tone: "muted" };
  else if (e.held === true) {
    if (e.restPaid === "yes") due = { text: rub(dueSum), sub: "получен", tone: "ok" };
    else if (e.restPaid === "no") due = { text: rub(dueSum), sub: "не получен", tone: "bad" };
    else if (e.restPaid === "part") due = { text: rub(dueSum), sub: `частично: ${rub(e.restAmount ?? 0)}`, tone: "warn" };
    else due = { text: rub(dueSum), sub: "не отмечен", tone: "warn" };
  } else due = { text: rub(dueSum), sub: "на месте", tone: "plain" };

  let agency: number | null = null;
  let hostPay: number | null = null;
  if (off) agency = prepaid && !e.refundAt ? PREPAY_RUB : null;
  else if (price !== null) {
    hostPay = hostShare(price, e.guests);
    agency = agencyShare(price, e.guests);
  }

  // Подсветка и следующий шаг: первый подходящий по порядку docs/active-orders.md, раздел 6.
  const left = from - now;
  const soon = !off && !started && left <= CALL_BEFORE_MS;
  const today = todayMoscow(now);
  const clientStep = e.nextStep ? `📌 ${e.nextStep}${e.nextAt ? ` · ${shortDay(e.nextAt)}` : ""}` : "";
  const due2 = e.nextAt ? e.nextAt <= today : false;
  let step = "";
  let alert = true;
  if (refundWaiting) step = `Вернуть ${rub(PREPAY_RUB)} клиенту и отметить`;
  else if (off && moved && !rebooked) step = "Согласовать новую дату";
  else if (off) {
    alert = false;
    step = rebooked ? "Новая дата записана" : "Закрыто";
  } else if (!started && e.declinedAt) step = "Назначить другого ведущего";
  else if (e.hostOff && !ended) step = "Передать мероприятие другому ведущему";
  else if (!started && light.light === "late") step = `Позвонить ведущему сегодня${e.hostName ? ` (${firstName})` : ""}`;
  else if (soon && emptyPlace(e.place)) step = "Узнать адрес у клиента";
  else if (soon && !e.calledAt) step = "Созвониться с клиентом";
  else if (ended && e.held === null) step = `Узнать у ведущего, как прошло${e.hostName ? ` (${firstName})` : ""}`;
  else if (e.held === true && dueSum !== null && e.restPaid !== "yes") step = `Остаток: уточнить у ведущего${e.hostName ? ` (${firstName})` : ""}`;
  else if (e.nextStep && due2) step = clientStep;
  else {
    alert = false;
    if (e.held === true && !e.review) step = "Попросить отзыв";
    else if (e.held === true) step = e.review === "got" ? "Отзыв получен" : "Отзыв попросили";
    else if (clientStep) step = clientStep;
    else if (started && !ended) step = "Идёт — отметить «Проведено» после конца";
    else if (e.calledAt && soon) step = "Созвонились — ждём вечера";
    else step = "Напоминание придёт за 3 дня";
  }

  const when = off
    ? e.refundAt
      ? `отказ ${stamp(e.refundAt).split(",")[0]}`
      : `отменено ${stamp(e.cancelledAt || e.updatedAt || from).split(",")[0]}`
    : started && !ended
      ? "идёт сейчас"
      : relative(from, now);
  const placeWarn = !off && emptyPlace(e.place);
  return {
    key: `e-${e.id}`,
    group,
    href: `/studio/calendar?tab=events&event=${encodeURIComponent(e.id)}`,
    date: shortDay(e.day),
    time: `${hhmm(e.start)}–${hhmm(e.end)}`,
    when,
    whenAlert: !off && !started && light.light === "late",
    client: e.clientName || "Клиент не указан",
    what: e.title || "Мероприятие",
    details: [guestsText(e.guests), placeWarn ? "место уточняется" : e.place.trim()].filter(Boolean).join(" · "),
    placeWarn,
    status: e.clientStatus ? { label: CLIENT_STATUS_TITLES[e.clientStatus], tone: e.clientStatus } : null,
    who: e.clientOwnerName ? `ведёт ${e.clientOwnerName}` : e.ownerName ? `ведёт ${e.ownerName}` : "никто не взял",
    ownerName: e.clientOwnerName || e.ownerName || "",
    host: e.hostOff ? `${host} · ⚠ отключён` : host,
    hostWarn: Boolean(e.hostOff) && !off,
    accepted,
    held,
    price,
    priceText: price !== null ? rub(price) : "не указана",
    priceSub: off ? "не состоится" : price === null ? "нет в записи" : "",
    priceStruck: off,
    prepay,
    due,
    agency,
    hostPay,
    approx: false,
    step,
    stepTone: alert ? "alert" : step === "Закрыто" || step === "Новая дата записана" || step.startsWith("Отзыв ") ? "muted" : "plain",
    alert,
    sortAt: group === "off" ? e.cancelledAt || e.updatedAt || from : from,
    refundWaiting,
    prepaid,
    search: [e.clientName, e.clientPhone, e.hostName, e.title, e.place, e.ownerName ?? "", e.clientOwnerName ?? ""],
  };
}

/** Строка клиента в переговорах. */
export function talkRow(t: OrderTalk, now: number): OrderRow {
  const today = todayMoscow(now);
  const wish = wishFromText(t.notes, today, true);
  const day = dayIndex(wish.day);
  const guests = /^\d+$/.test(wish.guests) ? Number(wish.guests) : null;
  // Расчёт — из последнего обращения, иначе из заметки (менеджер вставляет туда присланный расчёт).
  const price = (t.calc ? talkPrice(t.calc) : null) ?? (t.notes ? talkPrice(t.notes) : null);
  // У старых карточек «Новый» без таймера отсчёт — от последнего обращения (как в «Клиентах»).
  const since = [t.status === "new" ? t.newSince ?? t.lastContactAt : null, t.tgWaitingSince].filter((x): x is number => typeof x === "number");
  const waited = since.length ? now - Math.min(...since) : 0;
  const waiting = waited > ANSWER_WAIT_MS;
  const clientStep = t.nextStep ? `📌 ${t.nextStep}${t.nextAt ? ` · ${shortDay(t.nextAt)}` : ""}` : "";
  const overdue = Boolean(t.nextStep && t.nextAt && t.nextAt <= today);
  let step: string;
  let alert = true;
  if (waiting) step = "Ответить клиенту";
  else if (overdue) step = clientStep;
  else {
    alert = false;
    step = clientStep || (t.status === "new" ? "Ответить клиенту" : "Договориться о брони");
  }
  const origin = t.origin ? originTitle(t.origin) : "";
  return {
    key: `c-${t.id}`,
    group: "talk",
    href: `/studio/clients?id=${encodeURIComponent(t.id)}&from=orders`,
    date: day !== null ? shortDay(wish.day) : "дата не выбрана",
    time: wish.time ? `с ${wish.time}` : "время не выбрано",
    when: since.length ? `ждёт ответа ${waitText(waited)}` : day !== null ? relative(day * DAY_MS + 9 * HOUR_MS, now) : "",
    whenAlert: waiting,
    client: t.name || "Без имени",
    what: wish.formats.length ? wish.formats.join(" → ") : "программа не выбрана",
    details: [guests ? guestsText(guests) : "", origin ? `пришёл: ${origin}` : ""].filter(Boolean).join(" · ") || "гостей не указано",
    placeWarn: false,
    status: { label: CLIENT_STATUS_TITLES[t.status], tone: t.status },
    who: t.ownerName ? `ведёт ${t.ownerName}` : "никто не взял",
    ownerName: t.ownerName,
    host: "—",
    hostWarn: false,
    accepted: { label: "—", sub: "после брони", tone: "none" },
    held: { label: "—", sub: "после брони", tone: "none" },
    price,
    priceText: price !== null ? `≈ ${rub(price)}` : "—",
    priceSub: price !== null ? "по расчёту" : t.calc ? "в расчёте нет цены" : "расчёта нет",
    priceStruck: false,
    prepay: { text: "Не внесена", sub: "ждём 2 000 ₽", tone: "warn" },
    due: { text: "—", sub: "", tone: "muted" },
    agency: price !== null ? agencyShare(price, guests) : null,
    hostPay: price !== null ? hostShare(price, guests) : null,
    approx: true,
    step,
    stepTone: alert ? "alert" : "plain",
    alert,
    sortAt: day !== null ? day * DAY_MS : Number.MAX_SAFE_INTEGER - t.lastContactAt,
    refundWaiting: false,
    prepaid: false,
    search: [t.name, t.phone, t.ownerName, t.notes],
  };
}

export type OrderSort = "date" | "urgent" | "sum";
export type OrderFilter = "all" | "alert" | OrderGroup;

/** Все строки страницы в порядке групп (`ORDER_GROUPS`), внутри — по `sort`. */
export function orderRows(board: OrdersBoard, now: number, sort: OrderSort = "date"): OrderRow[] {
  const rows = [...board.events.map((e) => eventRow(e, now)), ...board.talks.map((t) => talkRow(t, now))];
  const byDate = (a: OrderRow, b: OrderRow) => {
    if (a.group === "off") return Number(b.refundWaiting) - Number(a.refundWaiting) || b.sortAt - a.sortAt;
    if (a.group === "close") return b.sortAt - a.sortAt;
    return a.sortAt - b.sortAt;
  };
  return rows.sort((a, b) => {
    const g = ORDER_GROUPS.indexOf(a.group) - ORDER_GROUPS.indexOf(b.group);
    if (g !== 0) return g;
    if (sort === "urgent" && a.alert !== b.alert) return a.alert ? -1 : 1;
    if (sort === "sum" && (a.price ?? -1) !== (b.price ?? -1)) return (b.price ?? -1) - (a.price ?? -1);
    return byDate(a, b);
  });
}

export interface OrderView {
  filter: OrderFilter;
  host: string;
  owner: string;
  query: string;
}

export function filterRows(rows: OrderRow[], view: OrderView): OrderRow[] {
  return rows.filter(
    (r) =>
      (view.filter === "all" || (view.filter === "alert" ? r.alert : r.group === view.filter)) &&
      (!view.host || r.host.replace(/ · ⚠ отключён$/, "") === view.host) &&
      (!view.owner || (view.owner === "—" ? !r.ownerName : r.ownerName === view.owner)) &&
      (!view.query.trim() || matchesSearch([r.client, r.what, r.host, ...r.search], view.query)),
  );
}

export function filterCounts(rows: OrderRow[]): Record<OrderFilter, number> {
  const out: Record<OrderFilter, number> = { all: rows.length, alert: 0, booked: 0, talk: 0, close: 0, off: 0 };
  for (const r of rows) {
    out[r.group] += 1;
    if (r.alert) out.alert += 1;
  }
  return out;
}

export interface OrderSummary {
  booked: number;
  nearest: string;
  total: number;
  noPrice: number;
  due: number;
  agency: number;
  hosts: number;
  prepaidSum: number;
  prepaidCount: number;
  refundSum: number;
  refundCount: number;
  alerts: number;
}

/** Итоги сверху — по всем строкам, без фильтров (docs/active-orders.md, раздел 5). */
export function summaryOf(rows: OrderRow[], board: OrdersBoard, now: number): OrderSummary {
  const booked = rows.filter((r) => r.group === "booked");
  const first = board.events
    .filter((e) => !e.cancelled && (eventSpan(e)?.to ?? 0) > now)
    .sort((a, b) => (eventSpan(a)?.from ?? 0) - (eventSpan(b)?.from ?? 0))[0];
  const firstFrom = first ? eventSpan(first)?.from ?? 0 : 0;
  const nearest = first ? (firstFrom <= now ? `идёт сейчас, до ${hhmm(first.end)}` : `${shortDay(first.day)}, ${hhmm(first.start)}`) : "";
  const sum = (list: OrderRow[], f: (r: OrderRow) => number | null) => list.reduce((s, r) => s + (f(r) ?? 0), 0);
  const refunds = rows.filter((r) => r.refundWaiting);
  const prepaid = booked.filter((r) => r.prepaid);
  return {
    booked: booked.length,
    nearest,
    total: sum(booked, (r) => r.price),
    noPrice: booked.filter((r) => r.price === null).length,
    due: booked.reduce((s, r) => s + (r.prepaid && r.price !== null ? Math.max(0, r.price - PREPAY_RUB) : 0), 0),
    agency: sum(booked, (r) => r.agency),
    hosts: sum(booked, (r) => r.hostPay),
    prepaidSum: prepaid.length * PREPAY_RUB,
    prepaidCount: prepaid.length,
    refundSum: refunds.length * PREPAY_RUB,
    refundCount: refunds.length,
    alerts: rows.filter((r) => r.alert).length,
  };
}

/** Подпись итога группы: «5 заказов · 158 700 ₽». */
export function groupMeta(group: OrderGroup, rows: OrderRow[]): string {
  const n = rows.length;
  const total = rows.reduce((s, r) => s + (r.price ?? 0), 0);
  if (group === "booked") return `${plural(n, ["заказ", "заказа", "заказов"])} · ${rub(total)}`;
  if (group === "talk") return `${plural(n, ["клиент", "клиента", "клиентов"])}${total ? ` · ≈ ${rub(total)}` : ""}`;
  if (group === "close") return `${plural(n, ["мероприятие", "мероприятия", "мероприятий"])} · ${rub(total)}`;
  const refunds = rows.filter((r) => r.refundWaiting).length;
  return `${plural(n, ["отмена", "отмены", "отмен"])} · к возврату ${rub(refunds * PREPAY_RUB)}`;
}
