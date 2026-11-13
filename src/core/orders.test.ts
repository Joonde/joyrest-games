import { describe, expect, it } from "vitest";
import type { OrderEvent, OrdersBoard, OrderTalk } from "../data/types";
import { agencyShare, eventRow, filterCounts, filterRows, groupMeta, hostShare, orderRows, relative, shortDay, summaryOf, talkRow } from "./orders";

// 12 ноября 2026, 20:00 по Москве.
const NOW = Date.UTC(2026, 10, 12, 17, 0);
const H = 3_600_000;

function ev(over: Partial<OrderEvent> = {}): OrderEvent {
  return {
    id: "e1",
    hostId: "h1",
    hostName: "Борис",
    day: "2026-11-20",
    start: 19 * 60,
    end: 21 * 60,
    clientName: "Сергей",
    clientPhone: "+79150000000",
    title: "Корпоратив",
    place: "Москва, Тверская 1",
    guests: 30,
    note: "",
    cancelled: false,
    held: null,
    acceptRev: 1,
    acceptedAt: NOW - 24 * H,
    price: 29_900,
    prepaidAt: NOW - 48 * H,
    updatedAt: NOW - 48 * H,
    ...over,
  };
}

function talk(over: Partial<OrderTalk> = {}): OrderTalk {
  return {
    id: "c1",
    name: "Ирина",
    phone: "+79160000000",
    status: "work",
    ownerName: "Мария",
    nextStep: "",
    nextAt: "",
    notes: "Дата: 11.12.2026\nГостей: 25\nПрограмма: Квиз",
    calc: "",
    origin: "avito",
    newSince: null,
    tgWaitingSince: null,
    lastContactAt: NOW - H,
    ...over,
  };
}

describe("«Активные заказы»: деньги", () => {
  it("доля ведущего: 55%, не меньше 5 000; от 46 гостей — 20 000", () => {
    expect(hostShare(29_900, 30)).toBe(16_445);
    expect(agencyShare(29_900, 30)).toBe(13_455);
    expect(hostShare(8_000, 10)).toBe(5_000);
    expect(agencyShare(8_000, 10)).toBe(3_000);
    expect(hostShare(42_500, 60)).toBe(20_000);
    expect(agencyShare(42_500, 60)).toBe(22_500);
    expect(agencyShare(4_000, 10)).toBe(0);
  });
  it("остаток на месте = стоимость − 2 000; без предоплаты и цены — прочерк", () => {
    expect(eventRow(ev(), NOW).due).toMatchObject({ text: "27 900 ₽", sub: "на месте" });
    expect(eventRow(ev({ prepaidAt: null }), NOW).prepay).toMatchObject({ text: "Не отмечена", tone: "warn" });
    expect(eventRow(ev({ price: null }), NOW)).toMatchObject({ priceText: "не указана", agency: null });
    expect(eventRow(ev({ price: null }), NOW).due.text).toBe("—");
  });
});

describe("«Активные заказы»: группы и колонки", () => {
  it("впереди — «Забронированы», прошло — «Прошли», отменено — «Отменены»", () => {
    expect(eventRow(ev(), NOW).group).toBe("booked");
    expect(eventRow(ev({ day: "2026-11-10" }), NOW).group).toBe("close");
    expect(eventRow(ev({ cancelled: true }), NOW).group).toBe("off");
    expect(talkRow(talk(), NOW).group).toBe("talk");
  });
  it("подтвердил: принял, ждёт, не подтвердил меньше чем за сутки, нужна замена", () => {
    expect(eventRow(ev(), NOW).accepted.tone).toBe("ok");
    expect(eventRow(ev({ acceptedAt: null }), NOW).accepted).toMatchObject({ label: "Ждёт ведущего", tone: "wait" });
    const late = eventRow(ev({ acceptedAt: null, day: "2026-11-13" }), NOW);
    expect(late.accepted).toMatchObject({ label: "Не подтвердил", tone: "late" });
    expect(late).toMatchObject({ alert: true, step: "Позвонить ведущему сегодня (Борис)" });
    const replace = eventRow(ev({ declinedAt: NOW - H }), NOW);
    expect(replace.accepted.tone).toBe("replace");
    expect(replace).toMatchObject({ alert: true, step: "Назначить другого ведущего" });
  });
  it("провёл: впереди, идёт, не отмечено, проведено с остатком", () => {
    expect(eventRow(ev(), NOW).held.label).toBe("—");
    expect(eventRow(ev({ day: "2026-11-12", start: 19 * 60, end: 22 * 60 }), NOW).held.tone).toBe("live");
    const unmarked = eventRow(ev({ day: "2026-11-10" }), NOW);
    expect(unmarked.held).toMatchObject({ label: "Не отмечено", tone: "check" });
    expect(unmarked).toMatchObject({ alert: true, step: "Узнать у ведущего, как прошло (Борис)" });
    const held = eventRow(ev({ day: "2026-11-10", held: true }), NOW);
    expect(held.due).toMatchObject({ sub: "не отмечен", tone: "warn" });
    expect(held).toMatchObject({ alert: true, step: "Остаток: уточнить у ведущего (Борис)" });
    const part = eventRow(ev({ day: "2026-11-10", held: true, restPaid: "part", restAmount: 10_000 }), NOW);
    expect(part.due.sub).toBe("частично: 10 000 ₽");
    const paid = eventRow(ev({ day: "2026-11-10", held: true, restPaid: "yes" }), NOW);
    expect(paid).toMatchObject({ alert: false, step: "Попросить отзыв" });
  });
  it("за 3 дня: нет адреса — узнать адрес, не созвонились — созвониться", () => {
    const soon = { day: "2026-11-14" };
    expect(eventRow(ev({ ...soon, place: "Место уточняется" }), NOW)).toMatchObject({ alert: true, step: "Узнать адрес у клиента", placeWarn: true });
    expect(eventRow(ev({ ...soon, place: "" }), NOW).step).toBe("Узнать адрес у клиента");
    expect(eventRow(ev(soon), NOW)).toMatchObject({ alert: true, step: "Созвониться с клиентом" });
    expect(eventRow(ev({ ...soon, calledAt: NOW - H }), NOW)).toMatchObject({ alert: false, step: "Созвонились — ждём вечера" });
    // Больше трёх дней — рано.
    expect(eventRow(ev({ place: "" }), NOW)).toMatchObject({ alert: false, step: "Напоминание придёт за 3 дня" });
  });
  it("отменённые: вернуть, возвращена, остаётся, перенос", () => {
    const refund = eventRow(ev({ cancelled: true, refundAt: NOW - H, clientStatus: "lost" }), NOW);
    expect(refund).toMatchObject({ refundWaiting: true, alert: true, priceStruck: true, agency: 0 });
    expect(refund.prepay).toMatchObject({ text: "Вернуть 2 000 ₽", tone: "bad" });
    const done = eventRow(ev({ cancelled: true, refundAt: NOW - 30 * H, refundDoneAt: NOW - H, clientStatus: "lost" }), NOW);
    expect(done).toMatchObject({ refundWaiting: false, alert: false, step: "Закрыто" });
    expect(done.prepay.text).toBe("Возвращена");
    const kept = eventRow(ev({ cancelled: true, clientStatus: "lost" }), NOW);
    expect(kept).toMatchObject({ agency: 2_000, step: "Закрыто" });
    expect(kept.prepay.text).toBe("Остаётся 2 000 ₽");
    const moved = eventRow(ev({ cancelled: true, clientStatus: "client" }), NOW);
    expect(moved.held.label).toBe("Перенос");
    expect(moved.step).toBe("Согласовать новую дату");
  });
  it("кто ведёт: клиента, иначе мероприятия, иначе «никто не взял»", () => {
    expect(eventRow(ev({ clientOwnerName: "Мария", ownerName: "Владелец" }), NOW).who).toBe("ведёт Мария");
    expect(eventRow(ev({ ownerName: "Владелец" }), NOW).who).toBe("ведёт Владелец");
    expect(eventRow(ev(), NOW).who).toBe("никто не взял");
  });
  it("отключённый ведущий — передать другому", () => {
    expect(eventRow(ev({ hostOff: true }), NOW)).toMatchObject({ hostWarn: true, alert: true, step: "Передать мероприятие другому ведущему" });
  });
  it("следующий шаг клиента: в его день — красным, раньше — просто подписью", () => {
    expect(eventRow(ev({ nextStep: "Прислать договор", nextAt: "2026-11-12" }), NOW)).toMatchObject({ alert: true, step: "📌 Прислать договор · Чт, 12 ноя" });
    expect(eventRow(ev({ nextStep: "Прислать договор", nextAt: "2026-11-15" }), NOW)).toMatchObject({ alert: false, step: "📌 Прислать договор · Вс, 15 ноя" });
  });
});

describe("«Активные заказы»: переговоры", () => {
  it("дата и программа из анкеты, цена из расчёта с «≈»", () => {
    const r = talkRow(talk({ calc: "🧮 Расчёт JoyRest\n✅ Опытный: 25 900 ₽ — выбран" }), NOW);
    expect(r).toMatchObject({ date: "Пт, 11 дек", what: "Квиз", price: 25_900, priceText: "≈ 25 900 ₽", approx: true });
    expect(r.details).toContain("25 гостей");
    expect(r.details).toContain("Авито");
    expect(talkRow(talk({ notes: "" }), NOW)).toMatchObject({ date: "дата не выбрана", priceText: "—", agency: null });
  });
  it("«Новый» ждёт дольше 30 минут — ответить клиенту, красным", () => {
    expect(talkRow(talk({ status: "new", newSince: NOW - 12 * 60_000 }), NOW)).toMatchObject({ alert: false, step: "Ответить клиенту", when: "ждёт ответа 12 мин" });
    expect(talkRow(talk({ status: "new", newSince: NOW - 45 * 60_000 }), NOW)).toMatchObject({ alert: true, whenAlert: true });
    expect(talkRow(talk({ tgWaitingSince: NOW - 2 * H }), NOW)).toMatchObject({ alert: true, when: "ждёт ответа 2 ч 00 мин" });
  });
  it("без шага: «В работе» — договориться о брони", () => {
    expect(talkRow(talk(), NOW).step).toBe("Договориться о брони");
    expect(talkRow(talk({ nextStep: "Позвонить", nextAt: "2026-11-11" }), NOW)).toMatchObject({ alert: true, step: "📌 Позвонить · Ср, 11 ноя" });
  });
});

describe("«Активные заказы»: порядок, фильтры, итоги", () => {
  const board: OrdersBoard = {
    now: NOW,
    events: [
      ev({ id: "far", day: "2026-12-04", guests: 60, price: 42_500 }),
      ev({ id: "near", day: "2026-11-14" }),
      ev({ id: "past", day: "2026-11-10" }),
      ev({ id: "old", day: "2026-11-07" }),
      ev({ id: "off1", cancelled: true, refundDoneAt: NOW - H, refundAt: NOW - 2 * H, clientStatus: "lost", updatedAt: NOW - H }),
      ev({ id: "off2", cancelled: true, refundAt: NOW - 30 * H, clientStatus: "lost", updatedAt: NOW - 30 * H }),
      ev({ id: "noprice", day: "2026-11-25", price: null, prepaidAt: null }),
    ],
    talks: [talk({ id: "t-late", notes: "Дата: 20.12.2026" }), talk({ id: "t-soon", notes: "Дата: 28.11.2026" }), talk({ id: "t-none", notes: "" })],
  };
  const rows = orderRows(board, NOW);
  it("группы по порядку; впереди — ближайшие сверху, прошли — свежие, отмены — ждущие возврата сверху", () => {
    expect(rows.map((r) => r.key)).toEqual(["e-near", "e-noprice", "e-far", "c-t-soon", "c-t-late", "c-t-none", "e-past", "e-old", "e-off2", "e-off1"]);
  });
  it("«сначала срочные» и «по сумме» — внутри своей группы", () => {
    expect(orderRows(board, NOW, "urgent").filter((r) => r.group === "booked")[0]?.key).toBe("e-near");
    expect(orderRows(board, NOW, "sum").filter((r) => r.group === "booked").map((r) => r.key)).toEqual(["e-far", "e-near", "e-noprice"]);
  });
  it("фильтры и счётчики", () => {
    const c = filterCounts(rows);
    expect(c).toMatchObject({ all: 10, booked: 3, talk: 3, close: 2, off: 2 });
    expect(filterRows(rows, { filter: "alert", host: "", owner: "", query: "" }).every((r) => r.alert)).toBe(true);
    expect(filterRows(rows, { filter: "all", host: "", owner: "Мария", query: "" }).every((r) => r.ownerName === "Мария")).toBe(true);
    expect(filterRows(rows, { filter: "all", host: "", owner: "—", query: "" }).every((r) => !r.ownerName)).toBe(true);
    expect(filterRows(rows, { filter: "all", host: "", owner: "", query: "ирина" }).every((r) => r.group === "talk")).toBe(true);
    expect(filterRows(rows, { filter: "all", host: "Борис", owner: "", query: "" })).toHaveLength(7);
  });
  it("итоги: только забронированные, без стоимости — отдельно, возвраты", () => {
    const s = summaryOf(rows, board, NOW);
    expect(s).toMatchObject({ booked: 3, total: 72_400, noPrice: 1, prepaidCount: 2, prepaidSum: 4_000, due: 68_400, refundCount: 1, refundSum: 2_000 });
    expect(s.agency).toBe(13_455 + 22_500);
    expect(s.hosts).toBe(16_445 + 20_000);
    expect(s.nearest).toBe("Сб, 14 ноя, 19:00");
    expect(groupMeta("off", rows.filter((r) => r.group === "off"))).toBe("2 отмены · к возврату 2 000 ₽");
    expect(groupMeta("booked", rows.filter((r) => r.group === "booked"))).toBe("3 заказа · 72 400 ₽");
  });
});

describe("«Активные заказы»: подписи", () => {
  it("день и время", () => {
    expect(shortDay("2026-11-13")).toBe("Пт, 13 ноя");
    expect(relative(NOW + 23 * H, NOW)).toBe("через 23 ч");
    expect(relative(NOW + 3 * 86_400_000, NOW)).toBe("через 3 дня");
    expect(relative(NOW - 2 * 86_400_000, NOW)).toBe("2 дня назад");
    expect(relative(NOW + 12 * 60_000, NOW)).toBe("через 12 мин");
  });
});
