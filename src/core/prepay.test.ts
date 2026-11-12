import { describe, expect, it } from "vitest";
import { cleanPrice, dueLine, dueOnSite, PREPAY_RUB, prepaidOwnerText, priceFromCalc, refundOpen, REFUND_HOURS, refundOwnerText, rub } from "./prepay";
import { noticeText, parseEventInput } from "./events";
import { addDays, todayMoscow } from "./calendar";

const H = 3_600_000;

describe("предоплата мероприятия (решение владельца 12 ноября 2026)", () => {
  it("предоплата — 2 000 ₽, возврат — не позже чем за 48 часов", () => {
    expect(PREPAY_RUB).toBe(2000);
    expect(REFUND_HOURS).toBe(48);
  });

  it("сумма — с обычным пробелом между тысячами", () => {
    expect(rub(2000)).toBe("2 000 ₽");
    expect(rub(24900)).toBe("24 900 ₽");
    expect(rub(900)).toBe("900 ₽");
    expect(rub(1250000)).toBe("1 250 000 ₽");
  });

  it("стоимость: целые рубли от предоплаты, пусто — нет, мусор — отказ", () => {
    expect(cleanPrice(24900)).toBe(24900);
    expect(cleanPrice("24 900")).toBe(24900);
    expect(cleanPrice("24 900")).toBe(24900);
    expect(cleanPrice(2000)).toBe(2000);
    expect(cleanPrice("")).toBeNull();
    expect(cleanPrice(null)).toBeNull();
    expect(cleanPrice(undefined)).toBeNull();
    for (const bad of [1999, 0, -5, 24900.5, 3_000_001, "24,9", "много", "24900 ₽", true, {}, NaN]) expect(cleanPrice(bad)).toBeUndefined();
  });

  it("к оплате на месте: стоимость минус внесённая предоплата", () => {
    expect(dueOnSite(24900, true)).toBe(22900);
    expect(dueOnSite(24900, false)).toBe(24900);
    expect(dueOnSite(2000, true)).toBe(0);
    expect(dueOnSite(null, true)).toBeNull();
    expect(dueOnSite(undefined, false)).toBeNull();
    expect(dueLine(24900, true)).toBe("💰 К оплате на месте: 22 900 ₽ (предоплата 2 000 ₽ уже внесена)");
    expect(dueLine(24900, false)).toBe("💰 К оплате на месте: 24 900 ₽");
    expect(dueLine(null, true)).toBe("");
  });

  it("«Вернуть предоплату» работает, пока до начала не меньше 48 часов", () => {
    const start = Date.UTC(2026, 11, 20, 15, 0, 0);
    expect(refundOpen(start, start - 10 * 24 * H)).toBe(true);
    expect(refundOpen(start, start - 48 * H)).toBe(true);
    expect(refundOpen(start, start - 48 * H + 1)).toBe(false);
    expect(refundOpen(start, start - 47 * H)).toBe(false);
    expect(refundOpen(start, start)).toBe(false);
    expect(refundOpen(start, start + H)).toBe(false);
  });

  it("стоимость из расчёта клиента: выбранный формат или цена готового пакета", () => {
    const calc = [
      "🧮 Расчёт JoyRest",
      "Имя: Анна",
      "Пакет: Квиз",
      "Гостей: до 25",
      "Дата: 20.12.2026",
      "Стоимость по формату ведущего (новогодняя надбавка уже в итоге):",
      "▫️ Опытный: 31 900 ₽ (24 900 ₽ + 7 000 ₽ новогодняя надбавка)",
      "✅ Новые лица (−20%): 25 600 ₽ (20 000 ₽ + 5 600 ₽ новогодняя надбавка) — выбран",
      "▫️ Первый старт (−35%): 20 800 ₽",
    ].join("\n");
    expect(priceFromCalc(calc)).toBe(25600);
    expect(priceFromCalc(calc.replace(" — выбран", "").replace("✅", "▫️"))).toBeNull();
    expect(priceFromCalc("🎁 Готовый пакет JoyRest\nПакет: Вечер JoyRest\nЦена: 29 900 ₽ — опытный ведущий, будни, до 25 гостей")).toBe(29900);
    expect(priceFromCalc("Здравствуйте! Хотим квиз на 30 человек, бюджет 20 000 ₽")).toBeNull();
    expect(priceFromCalc("Стоимость: обсудим индивидуально")).toBeNull();
    expect(priceFromCalc("")).toBeNull();
  });

  it("форма мероприятия: стоимость и галочка разбираются, мусор в стоимости — отказ", () => {
    const day = addDays(todayMoscow(), 10);
    const body = { id: "e1", hostId: "h1", day, start: 1080, end: 1320, title: "Квиз", clientName: "Анна", clientPhone: "", place: "", guests: null, note: "" };
    expect(parseEventInput(body)).not.toHaveProperty("price");
    expect(parseEventInput(body)).not.toHaveProperty("prepaid");
    expect(parseEventInput({ ...body, price: 24900, prepaid: true })).toMatchObject({ price: 24900, prepaid: true });
    expect(parseEventInput({ ...body, price: "", prepaid: false })).toMatchObject({ price: null, prepaid: false });
    expect(parseEventInput({ ...body, price: null, prepaid: "да" })).toMatchObject({ price: null, prepaid: false });
    expect(parseEventInput({ ...body, price: 1500, prepaid: true })).toBeNull();
    expect(parseEventInput({ ...body, price: "много" })).toBeNull();
  });

  it("ведущему в Telegram: остаток — при назначении, изменении и в напоминаниях; при отмене и «снято» — нет", () => {
    const e = { id: "e1", title: "Квиз", guests: 30, day: addDays(todayMoscow(), 10), start: 1080, end: 1320, price: 24900, prepaidAt: 1 };
    for (const kind of ["created", "changed", "day", "hours"] as const) {
      expect(noticeText(kind, e, "https://games.joy-rest.ru")).toContain("💰 К оплате на месте: 22 900 ₽ (предоплата 2 000 ₽ уже внесена)");
    }
    for (const kind of ["removed", "cancelled", "after"] as const) expect(noticeText(kind, e, "https://games.joy-rest.ru")).not.toContain("К оплате");
    // Стоимости нет (мероприятие записано раньше) — строки нет.
    expect(noticeText("created", { ...e, price: null, prepaidAt: null }, "https://games.joy-rest.ru")).not.toContain("К оплате");
    expect(noticeText("created", { ...e, prepaidAt: null }, "https://games.joy-rest.ru")).toContain("💰 К оплате на месте: 24 900 ₽\n");
  });

  it("владельцу в Telegram: что отмечено и что вернуть — без клиента", () => {
    const paid = prepaidOwnerText("Квиз · 30 гостей", "суббота, 20 декабря, 18:00–22:00", 24900, "Мария", "https://games.joy-rest.ru/studio/calendar?tab=events&event=e1");
    expect(paid).toContain("💰 Предоплата 2 000 ₽ отмечена");
    expect(paid).toContain("Стоимость 24 900 ₽ · на месте клиент платит 22 900 ₽");
    expect(paid).toContain("Отметил(а): Мария");
    expect(paid).toContain("event=e1");
    const back = refundOwnerText("Квиз · 30 гостей", "суббота, 20 декабря, 18:00–22:00", "Мария", "https://games.joy-rest.ru/studio/calendar?tab=events&event=e1");
    expect(back).toContain("💸 Верните предоплату 2 000 ₽");
    expect(back).toContain("Запросил(а): Мария");
    expect(back).toContain("«Отметить: вернул»");
  });
});
