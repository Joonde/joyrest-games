import { describe, expect, it } from "vitest";
import type { AgencyEvent } from "../data/types";
import { bookingId, bookingNote, calcHoursMax, cleanPhone, contactLabel, contactLinks, crowdedClusters, formatContact, noticeText, parseContact, telegramNick, validEmail, periodOf, reminderDue, shiftPeriod, statsOf, endIn, eventSpan, eventStatus, fillFromRequest, parseEventInput, parseLeadText, sortEvents, timelineHours, timelineOf, weekStart } from "./events";

const ev = (id: string, day: string, start: number, end: number, extra: Partial<AgencyEvent> = {}): AgencyEvent => ({
  id,
  hostId: "h1",
  hostName: "Анна",
  day,
  start,
  end,
  clientName: "",
  clientPhone: "",
  title: "Свадьба",
  place: "",
  guests: null,
  note: "",
  cancelled: false,
  held: null,
  ...extra,
});

describe("планировщик: статус по московскому времени", () => {
  const e = ev("e1", "2026-10-20", 18 * 60, 23 * 60);
  // 18:00 МСК = 15:00 UTC.
  const at = (iso: string) => Date.parse(iso);
  it("предстоит, идёт сейчас, прошло, отменено", () => {
    expect(eventSpan(e)).toEqual({ from: at("2026-10-20T15:00:00Z"), to: at("2026-10-20T20:00:00Z") });
    expect(eventStatus(e, at("2026-10-20T14:59:00Z"))).toBe("upcoming");
    expect(eventStatus(e, at("2026-10-20T15:00:00Z"))).toBe("now");
    expect(eventStatus(e, at("2026-10-20T20:00:00Z"))).toBe("past");
    expect(eventStatus({ ...e, cancelled: true }, at("2026-10-20T16:00:00Z"))).toBe("cancelled");
  });
  it("вечер за полночь идёт до утра следующего дня", () => {
    const night = ev("e2", "2026-10-20", 22 * 60, 26 * 60);
    expect(eventStatus(night, at("2026-10-20T22:30:00Z"))).toBe("now"); // 01:30 МСК 21-го
  });
});

describe("планировщик: проверка формы", () => {
  const now = Date.parse("2026-10-14T10:00:00Z");
  const ok = { id: "e1", hostId: "h1", day: "2026-11-01", start: 1080, end: 1380, title: "Свадьба", clientName: " Ольга ", clientPhone: "+7 (999) 123-45-67 доб", guests: 40 };
  it("принимает верное и чистит текст", () => {
    expect(parseEventInput(ok, now)).toMatchObject({ clientName: "Ольга", clientPhone: "+7 (999) 123-45-67", guests: 40, place: "", note: "" });
  });
  it("нужны ведущий, дата, время и что за мероприятие или клиент", () => {
    expect(parseEventInput({ ...ok, hostId: "" }, now)).toBeNull();
    expect(parseEventInput({ ...ok, day: "2030-01-01" }, now)).toBeNull();
    expect(parseEventInput({ ...ok, start: 1081 }, now)).toBeNull();
    expect(parseEventInput({ ...ok, title: "", clientName: "" }, now)).toBeNull();
    expect(parseEventInput({ ...ok, title: "" }, now)).not.toBeNull();
    expect(parseEventInput({ ...ok, guests: -1 }, now)).toBeNull();
    expect(parseEventInput({ ...ok, guests: null }, now)?.guests).toBeNull();
  });
  it("в календарь ведущего — без имени и телефона клиента", () => {
    expect(bookingNote({ title: "Свадьба", guests: 40 })).toBe("Свадьба, 40 гостей");
    expect(bookingNote({ title: "", guests: null })).toBe("Мероприятие");
    expect(bookingId("e1")).toBe("ev-e1");
    expect(cleanPhone("8 999 <b>")).toBe("8 999");
  });
});

describe("планировщик: таймлайн дня", () => {
  it("пересекающиеся — в соседних колонках, непересекающиеся — во всю ширину", () => {
    const items = timelineOf(
      [ev("a", "2026-10-20", 1080, 1380), ev("b", "2026-10-20", 1140, 1260), ev("c", "2026-10-20", 600, 720), ev("x", "2026-10-20", 600, 700, { cancelled: true })],
      "2026-10-20",
    );
    const by = (id: string) => items.find((i) => i.event.id === id);
    expect(items).toHaveLength(3);
    expect(by("c")).toMatchObject({ lane: 0, lanes: 1 });
    expect(by("a")).toMatchObject({ lane: 0, lanes: 2 });
    expect(by("b")).toMatchObject({ lane: 1, lanes: 2 });
  });
  it("вчерашний вечер за полночь — с 00:00, часы расширяются до конца ночного", () => {
    const items = timelineOf([ev("n", "2026-10-19", 1320, 1620), ev("m", "2026-10-20", 1260, 1560)], "2026-10-20");
    expect(items.find((i) => i.event.id === "n")).toMatchObject({ top: 0, bottom: 180 });
    expect(timelineHours(items)).toEqual({ from: 0, to: 1620 });
    expect(timelineHours([])).toEqual({ from: 480, to: 1440 });
    // Вечернее мероприятие — таймлайн с 17:00, без пустого утра.
    expect(timelineHours(timelineOf([ev("e", "2026-10-20", 1080, 1380)], "2026-10-20"))).toEqual({ from: 1020, to: 1440 });
  });
});

describe("планировщик: неделя и сортировка", () => {
  it("неделя — с понедельника", () => {
    expect(weekStart("2026-10-14")).toBe("2026-10-12"); // среда
    expect(weekStart("2026-10-12")).toBe("2026-10-12");
    expect(weekStart("2026-10-18")).toBe("2026-10-12"); // воскресенье
  });
  it("архив — сначала новые", () => {
    const list = [ev("a", "2026-10-01", 600, 700), ev("b", "2026-10-03", 600, 700), ev("c", "2026-10-03", 500, 700)];
    expect(sortEvents(list, false).map((e) => e.id)).toEqual(["a", "c", "b"]);
    expect(sortEvents(list, true).map((e) => e.id)).toEqual(["b", "c", "a"]);
  });
});

describe("планировщик: пять мероприятий в одно время", () => {
  const five = [1, 2, 3, 4, 5].map((i) => ev(`e${i}`, "2026-10-20", 1080, 1380, { hostId: `h${i}` }));
  it("пять колонок — на телефоне одной плашкой «5 мероприятий», отдельное утреннее — само по себе", () => {
    const items = timelineOf([...five, ev("m", "2026-10-20", 600, 700)], "2026-10-20");
    expect(items.filter((i) => i.lanes === 5)).toHaveLength(5);
    const crowded = crowdedClusters(items, 2);
    expect(crowded).toHaveLength(1);
    expect(crowded[0]).toMatchObject({ top: 1080, bottom: 1380 });
    expect(crowded[0]?.items).toHaveLength(5);
    expect(crowdedClusters(items, 5)).toHaveLength(0);
  });
});

describe("планировщик: заполнение из заявки", () => {
  const today = "2026-10-14";
  it("сообщение с сайта в Telegram", () => {
    const text = "📩 Заявка с сайта JoyRest\n\nИмя: Софья\nТелефон: +7 915 241-59-99\nТип мероприятия: Корпоратив\nГостей: 25\nСвязь: Telegram\nКомментарий: Нужен квиз на 2 часа";
    expect(parseLeadText(text, today)).toEqual({ clientName: "Софья", clientPhone: "+7 915 241-59-99", title: "Корпоратив", guests: 25, note: "Нужен квиз на 2 часа" });
  });
  it("переписка: дата словами или точками, время, гости, место", () => {
    expect(parseLeadText("Свадьба 20 июня, с 16 до 23, человек 60.\nГде: Лофт на Китай-городе\n89152415999", today)).toEqual({
      title: "Свадьба",
      day: "2027-06-20",
      start: 960,
      end: 1380,
      guests: 60,
      place: "Лофт на Китай-городе",
      clientPhone: "89152415999",
    });
    const p = parseLeadText("ДР 15.10 18:00-23:00, гостей 30", today);
    expect(p).toMatchObject({ title: "День рождения", day: "2026-10-15", start: 1080, end: 1380, guests: 30 });
    // Время после даты не путается с датой; вечер за полночь.
    expect(parseLeadText("18.00–02.00 25.12.2026", today)).toMatchObject({ day: "2026-12-25", start: 1080, end: 1560 });
    expect(parseLeadText("просто текст", today)).toEqual({});
  });
  it("заявка клиента из базы площадок", () => {
    expect(
      fillFromRequest({ name: "Ольга", phone: "8 900 000 00 00", eventType: "Юбилей", date: "2026-11-01", from: "19:00", to: "", guests: 40, district: "ЦАО", comment: "" }),
    ).toEqual({ clientName: "Ольга", clientPhone: "8 900 000 00 00", title: "Юбилей", day: "2026-11-01", start: 1140, end: 1380, guests: 40, place: "ЦАО" });
    expect(endIn(1320, 10)).toBe(1800);
  });
});

describe("планировщик: уведомления ведущему в Telegram", () => {
  const e = ev("e1", "2026-10-20", 1080, 1380, { guests: 40, clientName: "Ольга", clientPhone: "+7 900 000-00-00", place: "ул. Ленина, 1" });
  const start = Date.parse("2026-10-20T15:00:00Z");
  it("напоминания — за день (24 часа) и за 2 часа, после начала — нет", () => {
    expect(reminderDue(start, start - 25 * 3_600_000)).toBeNull();
    expect(reminderDue(start, start - 20 * 3_600_000)).toBe("day");
    expect(reminderDue(start, start - 3 * 3_600_000)).toBe("day");
    expect(reminderDue(start, start - 2 * 3_600_000)).toBe("hours");
    expect(reminderDue(start, start - 30 * 60_000)).toBe("hours");
    expect(reminderDue(start, start + 1)).toBeNull();
  });
  it("текст — что, когда и ссылка; без имени, телефона и адреса клиента", () => {
    const text = noticeText("created", e, "https://games.joy-rest.ru");
    expect(text).toContain("Вам назначено мероприятие");
    expect(text).toContain("Свадьба · 40 гостей");
    expect(text).toContain("вторник, 20 октября 2026, 18:00–23:00");
    expect(text).toContain("https://games.joy-rest.ru/studio/calendar?tab=events");
    for (const secret of ["Ольга", "900", "Ленина"]) expect(text).not.toContain(secret);
    expect(noticeText("hours", e, "u", start - 2 * 3_600_000)).toContain("Через 2 ч");
    expect(noticeText("cancelled", e, "u")).not.toContain("студии");
  });
});

describe("планировщик: итоги", () => {
  it("периоды: неделя, месяц, квартал, год и соседние", () => {
    expect(periodOf("week", "2026-10-14")).toEqual({ from: "2026-10-12", to: "2026-10-18", title: "12–18 октября 2026" });
    expect(periodOf("week", "2026-10-29").title).toBe("26 октября – 1 ноября 2026");
    expect(periodOf("month", "2026-10-14")).toEqual({ from: "2026-10-01", to: "2026-10-31", title: "Октябрь 2026" });
    expect(periodOf("quarter", "2026-11-14")).toEqual({ from: "2026-10-01", to: "2026-12-31", title: "IV квартал 2026" });
    expect(periodOf("year", "2026-11-14")).toEqual({ from: "2026-01-01", to: "2026-12-31", title: "2026" });
    expect(shiftPeriod("month", "2026-12-14", 1)).toBe("2027-01-01");
    expect(shiftPeriod("quarter", "2026-02-10", -1)).toBe("2025-10-01");
    expect(shiftPeriod("week", "2026-10-14", -1)).toBe("2026-10-05");
  });
  it("записано, проведено, не состоялось, не отмечено, впереди, отменено; гости — только проведённых", () => {
    const now = Date.parse("2026-10-20T12:00:00Z");
    const list = [
      ev("a", "2026-10-01", 1080, 1380, { held: true, guests: 40, hostId: "h1", hostName: "Анна", title: "Свадьба" }),
      ev("b", "2026-10-05", 1080, 1380, { held: true, guests: null, hostId: "h1", hostName: "Анна", title: "свадьба" }),
      ev("c", "2026-10-06", 1080, 1380, { held: false, hostId: "h2", hostName: "Борис", title: "Корпоратив" }),
      ev("d", "2026-10-07", 1080, 1380, { hostId: "h2", hostName: "Борис", title: "Корпоратив" }),
      ev("e", "2026-10-25", 1080, 1380, { hostId: "h2", hostName: "Борис", title: "Корпоратив", guests: 99 }),
      ev("f", "2026-10-26", 1080, 1380, { cancelled: true }),
      ev("g", "2026-11-02", 1080, 1380, { held: true, guests: 10 }),
    ];
    const s = statsOf(list, "2026-10-01", "2026-10-31", now);
    expect(s).toMatchObject({ planned: 5, held: 2, failed: 1, unmarked: 1, upcoming: 1, cancelled: 1, guests: 40, guestsMissing: 1 });
    expect(s.byHost[0]).toMatchObject({ hostName: "Анна", planned: 2, held: 2, guests: 40 });
    expect(s.byTitle).toEqual([
      { title: "Корпоратив", planned: 3, held: 0 },
      { title: "Свадьба", planned: 2, held: 2 },
    ]);
  });
});

describe("форма мероприятия по расчёту сайта (24 октября 2026)", () => {
  it("«до» = начало + верхнее число длительности расчёта (в нём уже 30 минут запаса)", () => {
    const text = "🧮 Расчёт JoyRest\n────────────\nИмя: Анна\nПакет: Квиз\nГостей: до 45\nДата: 4 декабря 2026, пт\nНачало: в 19:00 (примерно, подтвердит менеджер)\nДень: пятница–воскресенье\nДлительность: ≈ 3–3,5 часа";
    const f = parseLeadText(text, "2026-10-24");
    expect(f).toMatchObject({ clientName: "Анна", day: "2026-12-04", start: 19 * 60, end: 22 * 60 + 30, guests: 45 });
    expect(calcHoursMax(text)).toBe(210);
    expect(calcHoursMax("Квиз, до 25 гостей. Вечер ≈ 1,5–2 часа. Итого")).toBe(120);
    expect(calcHoursMax("Длительность: ≈ 2 часа")).toBe(120);
    expect(calcHoursMax("в 19:00, гостей 30")).toBeNull();
    // Без длительности — как раньше, 4 часа.
    expect(parseLeadText("Свадьба 20.12 в 18:00", "2026-10-24")).toMatchObject({ start: 18 * 60, end: 22 * 60 });
    // Вечер за полночь: начало 22:00 + 3,5 ч = 01:30 следующего дня.
    expect(parseLeadText("Начало: в 22:00\nДлительность: ≈ 3–3,5 часа", "2026-10-24")).toMatchObject({ start: 22 * 60, end: 25 * 60 + 30 });
  });
  it("связь из текста: ник Telegram или почта", () => {
    expect(parseLeadText("Анна, пишите в телеграм @anna_party", "2026-10-24").contact).toBe("telegram:@anna_party");
    expect(parseLeadText("Анна https://t.me/AnnaParty2", "2026-10-24").contact).toBe("telegram:@AnnaParty2");
    expect(parseLeadText("почта anna.ivanova@mail.ru", "2026-10-24").contact).toBe("email:anna.ivanova@mail.ru");
    expect(parseLeadText("Анна, +7 915 012-74-60", "2026-10-24").contact).toBeUndefined();
  });
  it("связь хранится строкой «вид:значение», мусор отбрасывается", () => {
    expect(parseContact("telegram:@anna_party")).toEqual({ kind: "telegram", value: "@anna_party" });
    expect(parseContact("telegram:https://t.me/anna_party")).toEqual({ kind: "telegram", value: "@anna_party" });
    expect(parseContact("telegram:@a")).toEqual({ kind: "telegram", value: "" });
    expect(parseContact("whatsapp:+7915")).toEqual({ kind: "whatsapp", value: "" });
    expect(parseContact("email:нет")).toEqual({ kind: "email", value: "" });
    expect(parseContact("pigeon:x")).toEqual({ kind: "", value: "" });
    expect(parseContact(42)).toEqual({ kind: "", value: "" });
    expect(formatContact({ kind: "telegram", value: "@anna_party" })).toBe("telegram:@anna_party");
    expect(formatContact({ kind: "whatsapp", value: "" })).toBe("whatsapp");
    expect(contactLabel("telegram:@anna_party")).toBe("Telegram @anna_party");
    expect(contactLabel("telegram")).toBe("Telegram по номеру");
    expect(contactLabel("whatsapp")).toBe("WhatsApp по номеру");
    expect(contactLabel("email:a@b.ru")).toBe("Почта a@b.ru");
    expect(contactLabel("call")).toBe("Звонок");
    expect(contactLabel("")).toBe("");
    expect(contactLinks("telegram:@anna_party")).toEqual(["https://t.me/anna_party"]);
    expect(contactLinks("whatsapp")).toEqual([]);
    expect(telegramNick("t.me/anna_party?start=1")).toBe("@anna_party");
    expect(validEmail("anna@mail.ru")).toBe(true);
    expect(validEmail("anna@mail")).toBe(false);
  });
  it("сервер принимает связь только своего вида; старая форма без поля связь не трогает", () => {
    const now = Date.parse("2026-10-24T12:00:00Z");
    const body = { id: "ev1", hostId: "h1", day: "2026-12-04", start: 1140, end: 1350, title: "Корпоратив", clientName: "Анна" };
    expect(parseEventInput({ ...body, clientContact: "telegram:@anna_party" }, now)?.clientContact).toBe("telegram:@anna_party");
    expect(parseEventInput({ ...body, clientContact: "<script>" }, now)?.clientContact).toBe("");
    expect(parseEventInput(body, now)).not.toHaveProperty("clientContact");
  });
});

describe("дата праздника, а не дата ранней брони (24 октября 2026)", () => {
  it("строка «Дата:» главнее; «Ранняя бронь: до 15 ноября» датой не считается", () => {
    const calc = "🧮 Расчёт JoyRest\nПакет: Квиз\nДата: 7 декабря 2026, пн\nНачало: в 19:00\nДлительность: ≈ 3–3,5 часа\nПраздничная цена: +20% — декабрь\nРанняя бронь: до 15 ноября — посчитано 24 октября 2026";
    expect(parseLeadText(calc, "2026-10-24").day).toBe("2026-12-07");
    // Заметка карточки: «Дата: 07.12.2026», а ниже в пожеланиях — «до 15 ноября».
    const notes = "Дата: 07.12.2026\nНачало: в 19:00\nПожелания: Ранняя бронь: до 15 ноября — посчитано 24 октября 2026";
    expect(parseLeadText(notes, "2026-10-24").day).toBe("2026-12-07");
    // Без строки «Дата» — самая ранняя дата в тексте.
    expect(parseLeadText("Корпоратив 20.12, а оплату внесём до 1 ноября", "2026-10-24").day).toBe("2026-12-20");
    expect(parseLeadText("Свадьба 14 февраля", "2026-10-24").day).toBe("2027-02-14");
  });
});
