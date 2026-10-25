import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canImport, findHeader, knownContacts, nickOf, parseClientRows, templateSheets, TEMPLATE_COLUMNS, type ImportResult } from "./clientsImport";
import { contactProblem, contactTitle, telegramHref, writeChannels } from "./clients";
import { excelDate, readCsv, readXlsx, writeXlsx, XlsxError } from "./xlsx";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)));

function ok(r: ReturnType<typeof parseClientRows>): ImportResult {
  if (typeof r === "string") throw new Error(`ожидали строки, а получили ${r}`);
  return r;
}

describe("Excel: чтение", () => {
  it("своя таблица владельца: телефоны числом, даты датой, номера в «№» без данных", async () => {
    const rows = await readXlsx(fixture("clients-own.xlsx"));
    expect(rows[0]).toEqual(["№", "Ссылка телеграмм", "Имя", "Интерактив", "Дата", "Статус"]);
    expect(rows[1]?.slice(0, 5)).toEqual(["1", "test_anna_v", "Анна", "Квиз", "06.04.2026"]);
    expect(rows[2]?.[1]).toBe("89991112233");
  });

  it("заполненный шаблон: общие строки, спецсимволы, второй лист не читается", async () => {
    const rows = await readXlsx(fixture("clients-template-filled.xlsx"));
    expect(rows[0]?.[3]).toBe("Способ связи");
    expect(rows[3]?.[7]).toBe("Перезвонить & уточнить <дату>");
    expect(rows[3]?.[5]).toBe("05.09.2026");
    expect(rows.flat()).not.toContain("не читать");
  });

  it("шаблон платформы читается обратно: шапка, текстовые колонки, кириллица", async () => {
    const book = writeXlsx(templateSheets());
    const rows = await readXlsx(book);
    expect(rows).toEqual([TEMPLATE_COLUMNS.map((c) => c.title)]);
    // Лист «Как заполнять» — второй: в разбор клиентов не попадает.
    const filled = writeXlsx([{ name: "Клиенты", rows: [["Имя", "Телефон", "Telegram"], ["Анна", "89151234567", ""], ["Боря", "", "@borya_test"]] }]);
    const r = ok(parseClientRows(await readXlsx(filled)));
    expect(r.rows.map((x) => [x.name, x.phone, x.nick])).toEqual([
      ["Анна", "+7 915 123-45-67", ""],
      ["Боря", "", "@borya_test"],
    ]);
  });

  it("не таблица, старый .xls и обрезанный файл — понятная ошибка, а не падение", async () => {
    await expect(readXlsx(new TextEncoder().encode("просто текст"))).rejects.toBeInstanceOf(XlsxError);
    await expect(readXlsx(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]))).rejects.toMatchObject({ problem: "old-xls" });
    const book = fixture("clients-own.xlsx");
    await expect(readXlsx(book.subarray(0, 300))).rejects.toBeInstanceOf(XlsxError);
    await expect(readXlsx(new Uint8Array())).rejects.toBeInstanceOf(XlsxError);
  });

  it("дата Excel: обычная книга и книга 1904 года", () => {
    expect(excelDate(46118)).toBe("06.04.2026");
    expect(excelDate(46118.75)).toBe("06.04.2026");
    expect(excelDate(44656, true)).toBe("06.04.2026");
    expect(excelDate(46023)).toBe("01.01.2026");
  });
});

describe("CSV", () => {
  it("«;», «,», кавычки, переносы внутри ячейки, BOM и защита от формул", () => {
    const text = '﻿Имя;Телефон;Заметка\r\n"Анна; Б.";\'+7 915 123-45-67;"две\nстроки ""в кавычках"""\r\n';
    expect(readCsv(new TextEncoder().encode(text))).toEqual([
      ["Имя", "Телефон", "Заметка"],
      ["Анна; Б.", "+7 915 123-45-67", 'две\nстроки "в кавычках"'],
    ]);
    expect(readCsv(new TextEncoder().encode("Имя,Telegram\nАня,@anya_test"))).toEqual([
      ["Имя", "Telegram"],
      ["Аня", "@anya_test"],
    ]);
  });

  it("Excel на Windows: CSV в кодировке 1251", () => {
    // «Имя;Телефон» в Windows-1251.
    const bytes = new Uint8Array([0xc8, 0xec, 0xff, 0x3b, 0xd2, 0xe5, 0xeb, 0xe5, 0xf4, 0xee, 0xed]);
    expect(readCsv(bytes)).toEqual([["Имя", "Телефон"]]);
  });
});

describe("загрузка клиентов: шапка и колонки", () => {
  it("узнаёт шапку шаблона и свою («Ссылка телеграмм», «Интерактив»), шапка может быть не в первой строке", () => {
    expect(findHeader([TEMPLATE_COLUMNS.map((c) => c.title)])?.columns).toMatchObject({ name: 0, phone: 1, telegram: 2, contact: 3, event: 4, date: 5, status: 6, note: 7 });
    expect(findHeader([["Мои клиенты"], [], ["№", "Ссылка телеграмм", "Имя", "Интерактив", "Дата"]])).toEqual({
      line: 3,
      columns: { telegram: 1, name: 2, event: 3, date: 4 },
    });
  });

  it("без телефона и Telegram в шапке — «нет шапки»; пустая таблица — «пусто»", () => {
    expect(parseClientRows([["Имя", "Дата"], ["Анна", "01.01.2026"]])).toBe("no-header");
    expect(parseClientRows([[], ["", " "]])).toBe("empty");
    expect(parseClientRows([])).toBe("empty");
  });

  it("ник: @, t.me, https, без @; не ник — пусто", () => {
    expect(nickOf("@anna_party")).toBe("@anna_party");
    expect(nickOf("https://t.me/anna_party")).toBe("@anna_party");
    expect(nickOf("t.me/anna_party/")).toBe("@anna_party");
    expect(nickOf("anna_party")).toBe("@anna_party");
    expect(nickOf("ann")).toBe("");
    expect(nickOf("89151234567")).toBe("");
    expect(nickOf("Анна")).toBe("");
  });
});

describe("загрузка клиентов: своя таблица владельца", () => {
  it("номер и ник из одной колонки, строка-заголовок и пустые номера пропущены, ошибки — по строкам", async () => {
    const r = ok(parseClientRows(await readXlsx(fixture("clients-own.xlsx"))));
    expect(r.found).toEqual(["Telegram", "Имя", "Мероприятие", "Дата", "Статус"]);
    expect(r.skipped).toBe(3);
    const by = Object.fromEntries(r.rows.map((x) => [x.name, x]));
    expect(by["Анна"]).toMatchObject({ line: 2, phone: "", nick: "@test_anna_v", contact: "telegram", status: "held", errors: [] });
    expect(by["Анна"]?.request).toBe("Из таблицы Excel: Квиз, 06.04.2026");
    expect(by["Борис"]).toMatchObject({ phone: "+7 999 111-22-33", nick: "", contact: "", errors: [] });
    expect(by["Вера"]?.phone).toBe("+7 999 111-22-44");
    expect(by["Галина"]?.phone).toBe("+972530000001");
    expect(by["Дмитрий"]?.phone).toBe("+7 999 111-22-55");
    expect(by["Анна 2"]?.errors[0]).toContain("строке 2");
    expect(by["Евгений"]?.errors[0]).toContain("12345");
    expect(by["Жанна"]?.errors).toEqual(["Нет телефона и ника Telegram — связаться не с кем."]);
    expect(r.rows.filter(canImport).map((x) => x.name)).toEqual(["Анна", "Борис", "Вера", "Галина", "Дмитрий"]);
  });

  it("кто уже в «Клиентах» (телефон в любом виде или ник без регистра) — отмечен, второй раз не добавляется", async () => {
    const known = knownContacts([
      { phone: "8 (999) 111-22-33", links: [] },
      { phone: "", links: ["https://t.me/Test_Anna_V"] },
    ]);
    const r = ok(parseClientRows(await readXlsx(fixture("clients-own.xlsx")), known));
    expect(r.rows.filter((x) => x.known).map((x) => x.name)).toEqual(["Анна", "Борис"]);
    expect(r.rows.filter(canImport).map((x) => x.name)).toEqual(["Вера", "Галина", "Дмитрий"]);
  });
});

describe("загрузка клиентов: заполненный шаблон", () => {
  it("способ связи, статус, заметка; WhatsApp без телефона и непонятное — предупреждение, а не потеря клиента", async () => {
    const r = ok(parseClientRows(await readXlsx(fixture("clients-template-filled.xlsx"))));
    const by = Object.fromEntries(r.rows.map((x) => [x.name, x]));
    expect(by["Ирина"]).toMatchObject({ phone: "+7 999 222-33-44", contact: "whatsapp", status: "held", errors: [], warnings: [] });
    expect(by["Ирина"]?.request).toBe("Из таблицы Excel: Квиз, 17.10.2026\nЗаметка: Корпоратив, 30 гостей");
    expect(by["Кирилл"]).toMatchObject({ phone: "", nick: "@test_kirill", contact: "telegram", errors: [] });
    expect(by["Лена"]).toMatchObject({ phone: "+7 999 222-33-55", nick: "@test_lena", contact: "call", status: "client", errors: [] });
    expect(by["Мила"]?.errors).toEqual(["Нет телефона и ника Telegram — связаться не с кем."]);
    expect(by["Нина"]).toMatchObject({ contact: "telegram", status: "work", errors: [] });
    expect(by["Нина"]?.warnings[0]).toContain("Для WhatsApp нужен телефон");
    expect(by["Олег"]).toMatchObject({ contact: "", status: "held", errors: [] });
    expect(by["Олег"]?.warnings).toHaveLength(2);
  });

  it("лимит строк: больше 2000 — читаем 2000 и говорим об этом", () => {
    const rows = [["Имя", "Телефон"], ...Array.from({ length: 2100 }, (_, i) => [`К${i}`, `+7 999 ${String(1000000 + i).slice(0, 3)}-${String(1000000 + i).slice(3, 5)}-${String(1000000 + i).slice(5, 7)}`])];
    const r = ok(parseClientRows(rows));
    expect(r.rows).toHaveLength(2000);
    expect(r.cut).toBe(true);
  });
});

describe("способ связи клиента", () => {
  const nickOnly = { phone: "", links: ["https://t.me/anna_party"] };
  const phoneOnly = { phone: "89151234567", links: [] };
  it("что нужно для способа", () => {
    expect(contactProblem("telegram", nickOnly)).toBe("");
    expect(contactProblem("telegram", phoneOnly)).toBe("");
    expect(contactProblem("whatsapp", nickOnly)).toContain("телефон");
    expect(contactProblem("call", nickOnly)).toContain("телефон");
    expect(contactProblem("telegram", { phone: "", links: ["https://vk.com/anna"] })).toContain("ник");
    expect(contactProblem("", { phone: "", links: [] })).toBe("");
  });
  it("Telegram: по нику с готовым текстом, без ника — по номеру, Telegram без ника (tg://) — как есть", () => {
    expect(telegramHref(nickOnly, "Привет!")).toBe("https://t.me/anna_party?text=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82!");
    expect(telegramHref({ ...nickOnly, phone: "89151234567" }, "")).toBe("https://t.me/anna_party");
    expect(telegramHref(phoneOnly, "")).toBe("https://t.me/+79151234567");
    expect(telegramHref({ phone: "", links: ["tg://user?id=12345"] })).toBe("tg://user?id=12345");
    expect(telegramHref({ phone: "", links: [] })).toBe("");
  });
  it("кнопки «Написать»: удобный клиенту способ — первым; без телефона — только Telegram", () => {
    expect(writeChannels(nickOnly).map((w) => w.kind)).toEqual(["telegram"]);
    expect(writeChannels({ ...phoneOnly, contact: "whatsapp" }).map((w) => w.kind)).toEqual(["whatsapp", "telegram", "call"]);
    expect(writeChannels({ ...phoneOnly, contact: "call" }).map((w) => w.kind)).toEqual(["call", "telegram", "whatsapp"]);
    expect(writeChannels({ ...phoneOnly, contact: "мусор" }).map((w) => w.kind)).toEqual(["telegram", "whatsapp", "call"]);
    expect(writeChannels({ phone: "", links: [] })).toEqual([]);
  });
  it("подпись", () => {
    expect(contactTitle({ ...nickOnly, contact: "telegram" })).toBe("Telegram @anna_party");
    expect(contactTitle({ ...phoneOnly, contact: "telegram" })).toBe("Telegram");
    expect(contactTitle({ ...phoneOnly, contact: "whatsapp" })).toBe("WhatsApp");
    expect(contactTitle({ ...phoneOnly, contact: "" })).toBe("");
  });
});

describe("загрузка клиентов: находки тестировщика 25 октября 2026", () => {
  it("«-», «—», «нет» в ячейке — пусто; непонятный телефон при живом нике (и наоборот) — предупреждение, строку добавить можно", () => {
    const r = ok(
      parseClientRows([
        ["Имя", "Телефон", "Telegram"],
        ["Анна", "89151234567", "-"],
        ["Боря", "89151234568", "нет"],
        ["Вера", "—", "@vera_test"],
        ["Галя", "915123", "@galya_test"],
        ["Дима", "915123", ""],
      ]),
    );
    const by = Object.fromEntries(r.rows.map((x) => [x.name, x]));
    expect(by["Анна"]).toMatchObject({ phone: "+7 915 123-45-67", errors: [], warnings: [] });
    expect(by["Боря"]).toMatchObject({ errors: [], warnings: [] });
    expect(by["Вера"]).toMatchObject({ phone: "", nick: "@vera_test", errors: [], warnings: [] });
    expect(by["Галя"]).toMatchObject({ phone: "", nick: "@galya_test", errors: [] });
    expect(by["Галя"]?.warnings[0]).toContain("Добавим по нику");
    expect(by["Дима"]?.errors[0]).toContain("915123");
    expect(r.rows.filter(canImport).map((x) => x.name)).toEqual(["Анна", "Боря", "Вера", "Галя"]);
  });

  it("«Номер п/п», «№», «Ссылка на Instagram» — не телефон и не Telegram; явный «Телефон» сильнее простого «Номер»; «Контакт» — телефон или ник", () => {
    const pp = findHeader([["Номер п/п", "Имя", "Телефон", "Ссылка на Instagram", "Ник"]]);
    expect(pp?.columns).toEqual({ name: 1, phone: 2, telegram: 4 });
    expect(findHeader([["Номер", "Имя", "Телефон"]])?.columns.phone).toBe(2);
    expect(findHeader([["Имя", "Номер"]])?.columns.phone).toBe(1);
    const r = ok(parseClientRows([["Имя", "Контакт"], ["Анна", "89151234567"], ["Боря", "@borya_test"]]));
    expect(r.rows.map((x) => [x.phone, x.nick])).toEqual([["+7 915 123-45-67", ""], ["", "@borya_test"]]);
  });

  it("ник Telegram — от 5 знаков, служебные адреса t.me — не ник", () => {
    expect(nickOf("abcd")).toBe("");
    expect(nickOf("abcde")).toBe("@abcde");
    expect(nickOf("https://t.me/joinchat/AAAA")).toBe("");
    expect(nickOf("t.me/addstickers/pack")).toBe("");
  });

  it("CSV: первая строка — заголовок без разделителей, запятые в заметке не путают «;»", () => {
    const enc = new TextEncoder();
    expect(readCsv(enc.encode("Клиенты 2025\nИмя,Телефон\nАнна,89151234567\n"))).toEqual([["Клиенты 2025"], ["Имя", "Телефон"], ["Анна", "89151234567"]]);
    expect(readCsv(enc.encode("Имя;Телефон;Заметка\nАнна;8915;квиз, мафия, лото, шоу\nБоря;8916;\n"))[1]).toEqual(["Анна", "8915", "квиз, мафия, лото, шоу"]);
  });

  it("Excel: пустая оформленная строка далеко внизу не мешает, строка с данными ниже 20 000 — «слишком большая»", async () => {
    // Файлы сделаны openpyxl (как Google Таблицы и другие программы): строка 30000 только с высотой, без ячеек.
    const rows = await readXlsx(fixture("clients-far-row.xlsx"));
    expect(rows).toEqual([["Имя", "Телефон", "Дата"], ["Анна", "89151234567", "06.04.2026"]]);
    await expect(readXlsx(fixture("clients-too-big.xlsx"))).rejects.toMatchObject({ problem: "too-big" });
  });
});
