import { describe, expect, it } from "vitest";
import { cleanName, dateIn, greetName, matchContact, messageVariant, parseVcf, pastClientMessage, scanContacts } from "./contactsImport";

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
    for (const name of ["Игорь", "Дрон", "Ольга Игоревна", "Шоура", "Клиентская служба банка", "Корпус Олег", "Вика 2015", "Игорь (Ведущий )", "Света тамада"]) {
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
    expect(cleanName("Петя день рождения")).toBe("Петя");
    expect(cleanName("Аня свадьба")).toBe("Аня");
    expect(cleanName("Маша юбилей 17 октября")).toBe("Маша");
  });

  it("Android: длинное имя в Quoted-Printable с переносом строки, N без FN — «Имя Фамилия»", () => {
    const qp = ["BEGIN:VCARD", "VERSION:2.1", "N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:;=D0=90=D0=BD=D1=8F =D0=BA=D0=B2=D0=B8=D0=B7 =D0=B4=D0=B5=D0=BD=D1=8C =", "=D1=80=D0=BE=D0=B6=D0=B4=D0=B5=D0=BD=D0=B8=D1=8F;;;", "TEL:+79150000001", "END:VCARD"].join("\r\n");
    expect(parseVcf(qp)[0]?.name).toBe("Аня квиз день рождения");
    const n = ["BEGIN:VCARD", "N:Иванов;Иван;Иванович;;", "TEL:+79150000002", "END:VCARD"].join("\n");
    expect(parseVcf(n)[0]?.name).toBe("Иван Иванович Иванов");
  });

  it("один номер в двух карточках — остаётся та, где признаки клиента", () => {
    const two = ["BEGIN:VCARD", "FN:Аня", "TEL:+79150000003", "END:VCARD", "BEGIN:VCARD", "FN:Аня квиз 17.10", "TEL:8 915 000-00-03", "END:VCARD"].join("\n");
    const { matches } = scanContacts(two);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.reasons).toEqual(["квиз", "17.10"]);
  });

  it("май и маяк: «Лена 2 маяк» — не дата, «Оля 9 мая» — дата", () => {
    expect(dateIn("Лена 2 маяк")).toBeNull();
    expect(dateIn("Оля 9 мая")).toBe("9 мая");
  });

  it("сообщение прежнему клиенту — 5 вариантов от команды JoyRest: имя, обновились, извинение, вопрос о согласии, без цен и скидок", () => {
    const links = { channel: "t.me/JoyRest", calc: "joy-rest.ru/calc/", avito: "avito.ru/brands/x" };
    const texts = [1, 2, 3, 4, 5].map((v) => pastClientMessage("Юлия Вота 27 В 19 00", links, v));
    expect(new Set(texts).size).toBe(5);
    for (const text of texts) {
      expect(text).toContain("Юлия");
      expect(text).not.toMatch(/Вота|19 00/);
      expect(text).toContain("✨ JoyRest ✨");
      expect(text).toMatch(/ведущ/);
      expect(text).toMatch(/обновил/);
      expect(text).toMatch(/ошиб|перепута|не туда/);
      expect(text).toMatch(/присылать вам (наши )?новости\?/);
      expect(text).toContain("t.me/JoyRest");
      expect(text).toContain("joy-rest.ru/calc/");
      expect(text).toContain("avito.ru/brands/x");
      expect(text).not.toMatch(/скидк|₽|%|undefined|\{n\}/);
    }
    // Вне диапазона — по кругу, не падает.
    expect(pastClientMessage("Анна", links, 6)).toBe(pastClientMessage("Анна", links, 1));
    expect(pastClientMessage("Анна", links, 0)).toBe(pastClientMessage("Анна", links, 5));
  });

  it("имя для обращения: первое слово-имя подписи, роли и даты пропускаются; нет имени — без обращения", () => {
    expect(greetName("Юлия Вота 27 В 19 00")).toBe("Юлия");
    expect(greetName("29 Мария")).toBe("Мария");
    expect(greetName("МАРИЯ")).toBe("Мария");
    expect(greetName("23 с 17 00 Ксения")).toBe("Ксения");
    expect(greetName("Наталья Ведущий + Каиз+угадай Мелодию 17 30")).toBe("Наталья");
    expect(greetName("Ведущий 20 30")).toBe("");
    expect(greetName("Марина")).toBe("Марина");
    expect(greetName("Елена 22 Дек 2 улице Измайловского зверинца д 2")).toBe("Елена");
    expect(greetName("Анастасия 28 Дек")).toBe("Анастасия");
    expect(greetName("")).toBe("");
    const links = { channel: "c", calc: "k", avito: "a" };
    expect(pastClientMessage("Ведущий 20 30", links, 1).startsWith("Добрый день! 👋")).toBe(true);
    expect(pastClientMessage("", links, 3).startsWith("Привет от ✨ JoyRest ✨!")).toBe(true);
  });

  it("вариант сообщения — один и тот же для клиента, все 5 встречаются", () => {
    expect(messageVariant("c-abc")).toBe(messageVariant("c-abc"));
    const seen = new Set(Array.from({ length: 200 }, (_, i) => messageVariant(`c${i}x`)));
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
