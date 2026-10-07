import { describe, expect, it } from "vitest";
import {
  CRITERIA,
  emptyRequest,
  emptyVenue,
  findDuplicates,
  matchVenue,
  offerItem,
  offerText,
  parseRequest,
  parseVenue,
  rankVenues,
  requestMissing,
  requestTitle,
  venueMissing,
  type RequestData,
  type VenueData,
  type VenueStatus,
} from "./venues";

function venue(patch: Partial<VenueData>): VenueData {
  return { ...emptyVenue(), name: "Зал", type: "Ресторан", address: "ул. Примерная, 1", person: "Ольга", phone: "+7 900 000-00-01", seated: 100, standing: 150, ...patch };
}

function request(patch: Partial<RequestData>): RequestData {
  return { ...emptyRequest(), name: "Анна", phone: "+7 900 111-22-33", eventType: "Свадьба", guests: 80, format: "banquet", ...patch };
}

describe("анкета площадки", () => {
  it("чистит текст, числа и варианты; чужие значения выбрасывает", () => {
    const v = parseVenue({
      name: "  Белая\u0007 веранда\n ",
      type: "Ресторан",
      district: "Марс",
      seated: "120",
      standing: -5,
      halls: "два",
      cuisine: ["Русская", "Итальянская", "Европейская", "Японская", "Русская"],
      features: ["Камин", "Бассейн с акулами"],
      equipment: { Радиомикрофоны: 2, Пушка: 3, Проектор: 0 },
      alcohol: "Можно",
      corkage: 500,
      terrace: false,
      terraceSeats: 40,
      extra: "лишнее поле",
    });
    expect(v.name).toBe("Белая веранда");
    expect(v.district).toBe("");
    expect(v.seated).toBe(120);
    expect(v.standing).toBeNull();
    expect(v.halls).toBeNull();
    expect(v.cuisine).toEqual(["Русская", "Итальянская", "Европейская"]);
    expect(v.features).toEqual(["Камин"]);
    expect(v.equipment).toEqual({ Радиомикрофоны: 2 });
    expect(v.corkage).toBeNull();
    expect(v.terraceSeats).toBeNull();
    expect(v).not.toHaveProperty("extra");
  });

  it("не падает на мусоре", () => {
    for (const raw of [null, undefined, 5, "текст", [], { equipment: "x", layouts: "y" }]) {
      expect(() => parseVenue(raw)).not.toThrow();
    }
    expect(parseVenue(null).ownTech).toBe(true);
  });

  it("обязательные поля; меню — файлом или ссылкой; вручную — только название", () => {
    expect(venueMissing(parseVenue({}), 0)).toEqual(["название", "тип", "адрес", "имя", "телефон", "гостей сидя", "гостей стоя", "меню (файл или ссылка)"]);
    expect(venueMissing(venue({}), 1)).toEqual([]);
    expect(venueMissing(venue({ menuLink: "https://example.ru/menu" }), 0)).toEqual([]);
    expect(venueMissing(venue({ phone: "123" }), 1)).toEqual(["телефон"]);
    expect(venueMissing(venue({ seated: 0 }), 1)).toEqual([]);
    expect(venueMissing(parseVenue({ name: "Лофт" }), 0, true)).toEqual([]);
  });
});

describe("запрос клиента", () => {
  it("дата, время, формат и пожелания — только правильные", () => {
    const r = parseRequest({
      name: "Анна",
      date: "2027-02-30",
      from: "25:00",
      to: "03:00",
      format: "buffet",
      wishes: { terrace: 1, round: 2, hack: 2, dance: 3 },
      guests: "80",
    });
    expect(r.date).toBe("");
    expect(r.from).toBe("");
    expect(r.to).toBe("03:00");
    expect(r.format).toBe("buffet");
    expect(r.wishes).toEqual({ terrace: 1, round: 2 });
    expect(r.guests).toBe(80);
    expect(parseRequest({ date: "2027-06-19" }).date).toBe("2027-06-19");
  });

  it("обязательные поля", () => {
    expect(requestMissing(parseRequest({}))).toEqual(["имя", "телефон", "что празднуем", "гостей"]);
    expect(requestMissing(request({}))).toEqual([]);
  });

  it("заголовок заявки", () => {
    expect(requestTitle(request({ date: "2027-06-19" }))).toBe("Свадьба · 19 июня 2027 · 80 гостей");
  });
});

describe("подбор", () => {
  it("вместимость — жёсткое условие, минимум гостей тоже", () => {
    expect(matchVenue(venue({ seated: 60 }), request({ guests: 80 }))).toBeNull();
    expect(matchVenue(venue({ minGuests: 100 }), request({ guests: 80 }))).toBeNull();
    expect(matchVenue(venue({ seated: 60, standing: 150 }), request({ guests: 80, format: "buffet" }))).not.toBeNull();
    expect(matchVenue(venue({ seated: 60, standing: 150 }), request({ guests: 80, format: "unknown" }))).not.toBeNull();
    const unknown = matchVenue(venue({ seated: null, standing: null }), request({}));
    expect(unknown?.marks[0]).toMatchObject({ kind: "capacity", fit: null });
  });

  it("«обязательно» исключает площадку без этого, «не указано» — нет", () => {
    const r = request({ wishes: { terrace: 2 } });
    expect(matchVenue(venue({ terrace: false }), r)).toBeNull();
    expect(matchVenue(venue({ terrace: true }), r)?.score).toBe(100);
    const round = request({ wishes: { round: 2 } });
    expect(matchVenue(venue({ layouts: [] }), round)?.marks.at(-1)?.fit).toBeNull();
    expect(matchVenue(venue({ layouts: ["Фуршет"] }), round)).toBeNull();
  });

  it("процент: да 1, частично 0,5, не указано 0,25, нет 0", () => {
    const r = request({ budget: 5000, wishes: { dance: 1, furniture: 1, round: 1, terrace: 1 } });
    const v = venue({ perGuest: 5000, dance: true, furniture: "Частично", layouts: [], terrace: false });
    // бюджет 1 + танцпол 1 + мебель 0,5 + рассадка не указана 0,25 + веранды нет 0 = 2,75 из 5
    expect(matchVenue(v, r)?.score).toBe(55);
    expect(matchVenue(venue({ perGuest: 5600 }), request({ budget: 5000 }))?.marks[1]?.fit).toBe(0.5);
    expect(matchVenue(venue({ perGuest: 7000 }), request({ budget: 5000 }))?.marks[1]?.fit).toBe(false);
    expect(matchVenue(venue({}), request({}))?.score).toBeNull();
  });

  it("все критерии отвечают на пустую анкету без исключений", () => {
    const blank = emptyVenue();
    for (const c of CRITERIA) expect(() => c.test(blank)).not.toThrow();
  });

  it("порядок: процент, потом «Работали», «Проверено», «Новая»; «Не подходит» скрыт", () => {
    const items: Array<{ id: string; data: VenueData; status: VenueStatus }> = [
      { id: "a", data: venue({ name: "А", dance: false }), status: "worked" },
      { id: "b", data: venue({ name: "Б", dance: true }), status: "new" },
      { id: "c", data: venue({ name: "В", dance: true }), status: "worked" },
      { id: "d", data: venue({ name: "Г", dance: true }), status: "rejected" },
    ];
    const ranked = rankVenues(items, request({ wishes: { dance: 1 } }));
    expect(ranked.map((r) => r.item.id)).toEqual(["c", "b", "a"]);
  });
});

describe("дубли", () => {
  it("тот же телефон или адрес — дубль более ранней записи", () => {
    const dups = findDuplicates([
      { id: "1", createdAt: 1, data: venue({ phone: "+7 (900) 000-00-01", address: "ул. Примерная, 12" }) },
      { id: "2", createdAt: 2, data: venue({ phone: "8 900 000 00 01", address: "Другая, 5" }) },
      { id: "3", createdAt: 3, data: venue({ phone: "+7 900 555-55-55", address: "Примерная улица д. 12" }) },
      { id: "4", createdAt: 4, data: venue({ phone: "+7 900 777-77-77", address: "Совсем другая, 99" }) },
    ]);
    expect(dups.get("2")).toBe("1");
    expect(dups.get("3")).toBe("1");
    expect(dups.has("1")).toBe(false);
    expect(dups.has("4")).toBe(false);
  });
});

describe("предложение клиенту", () => {
  it("без адреса, телефона, контактного лица и почты", () => {
    const v = venue({ phone: "+7 900 000-00-01", email: "x@example.ru", person: "Ольга Иванова", address: "ул. Секретная, 1", metro: "Курская", district: "ЦАО" });
    const match = matchVenue(v, request({ wishes: { dance: 1 } }));
    const item = offerItem("v1", v, match, ["a".repeat(64)]);
    const text = JSON.stringify(item) + offerText({ title: "Свадьба", comment: "", items: [item] }, "https://games.joy-rest.ru/o/x");
    for (const secret of ["900", "x@example.ru", "Ольга", "Секретная"]) expect(text).not.toContain(secret);
    expect(item.where).toBe("ЦАО · м. Курская");
    expect(item.no).toEqual(["танцпол"]);
  });
});
