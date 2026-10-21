import { describe, expect, it } from "vitest";
import { cleanName, dateIn, matchContact, parseVcf, pastClientMessage, scanContacts } from "./contactsImport";

const VCF = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "N:;Аня квиз 17.10;;;",
  "FN:Аня квиз 17.10",
  "TEL;type=CELL:+7 (915) 241-59-99",
  "END:VCARD",
  "BEGIN:VCARD",
  "VERSION:3.0",
  "FN:Мама",
  "TEL:89160000000",
  "END:VCARD",
  "BEGIN:VCARD",
  "VERSION:2.1",
  "N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:;=D0=9E=D0=BB=D0=B5=D0=B3 =D0=BA=D0=BE=D1=80=D0=BF;;;",
  "TEL;CELL:9031112233",
  "END:VCARD",
  "BEGIN:VCARD",
  "FN:Сергей",
  "NOTE:ДР 20-го ноября\\, 30 гостей",
  "TEL:+79055554433",
  "item1.TEL:+79055554433",
  "END:VCARD",
  "BEGIN:VCARD",
  "FN:Ира не игры",
  "TEL:+79261234567",
  "END:VCARD",
].join("\r\n");

describe("загрузка контактов с телефона", () => {
  it("читает vCard 3.0 и 2.1 (Quoted-Printable), заметки и переносы", () => {
    const list = parseVcf(VCF);
    expect(list.map((c) => c.name)).toEqual(["Аня квиз 17.10", "Мама", "Олег корп", "Сергей", "Ира не игры"]);
    expect(list[3]?.note).toBe("ДР 20-го ноября, 30 гостей");
    expect(list[0]?.phones[0]).toBe("+7 (915) 241-59-99");
  });

  it("находит прежних клиентов по словам и датам, просто имя — нет", () => {
    const [anya, mama, oleg, sergey, ira] = parseVcf(VCF).map(matchContact);
    expect(anya?.reasons).toEqual(["квиз", "17.10"]);
    expect(mama?.reasons).toEqual([]);
    expect(oleg?.reasons).toEqual(["корпоратив"]);
    expect(sergey?.reasons).toContain("день рождения");
    expect(sergey?.reasons).toContain("20-го ноября");
    expect(ira?.reasons).toEqual(["игры"]);
  });

  it("даты: 17.10, 17/10/24, 17 октября, 20-е; телефон и время — не дата", () => {
    expect(dateIn("Аня 17.10")).toBe("17.10");
    expect(dateIn("Петя 3/12/24")).toBe("3/12/24");
    expect(dateIn("Катя 17 окт")).toBe("17 окт");
    expect(dateIn("на 20-е")).toBe("20-е");
    expect(dateIn("Вася 45.13")).toBeNull();
    expect(dateIn("Коля")).toBeNull();
    expect(matchContact({ name: "Дима +7 915 241 59 99", phones: [], org: "", note: "" }).reasons).toEqual([]);
    expect(dateIn("Женя 1.5 кг")).toBeNull();
  });

  it("обычные имена и похожие слова — не клиенты", () => {
    for (const name of ["Игорь", "Дрон", "Ольга Игоревна", "Шоура", "Клиентская служба банка", "Корпус Олег", "Вика 2015"]) {
      expect(matchContact({ name, phones: [], org: "", note: "" }).reasons, name).toEqual([]);
    }
    expect(matchContact({ name: "Лёша НГ", phones: [], org: "", note: "" }).reasons).toEqual(["Новый год"]);
    expect(matchContact({ name: "Маша Д.Р.", phones: [], org: "", note: "" }).reasons).toEqual(["день рождения"]);
  });

  it("одинаковые номера — один раз, похожие на клиентов — сверху", () => {
    const { matches, total } = scanContacts(VCF + "\r\n" + VCF);
    expect(total).toBe(10);
    expect(matches).toHaveLength(5);
    expect(matches.slice(0, 4).every((m) => m.reasons.length > 0)).toBe(true);
    expect(matches[4]?.label).toBe("Мама");
  });

  it("имя для карточки — без слов мероприятия и даты", () => {
    expect(cleanName("Аня квиз 17.10")).toBe("Аня");
    expect(cleanName("Олег корп")).toBe("Олег");
    expect(cleanName("квиз")).toBe("квиз");
  });

  it("сообщение прежнему клиенту — без цен и скидок, с вопросом о согласии", () => {
    const text = pastClientMessage("Михаил", { channel: "t.me/JoyRest", calc: "joy-rest.ru/calc/", avito: "avito.ru/brands/x" });
    expect(text).toContain("Это Михаил, ведущий.");
    expect(text).toContain("я или мой коллега");
    expect(text).toContain("можно иногда присылать вам новости?");
    expect(text).not.toMatch(/скидк|₽|%/);
  });
});
