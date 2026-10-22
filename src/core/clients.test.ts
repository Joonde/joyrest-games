import { describe, expect, it } from "vitest";
import {
  appendMyNote,
  cleanLinks,
  clientsCsv,
  durationLabel,
  forcedStatusAndMarketing,
  linkTitle,
  parseLinks,
  phoneKey,
  phoneKeyVariants,
  phoneLabel,
  reachable,
  responseStats,
  statusAfterEvent,
  timerOf,
  timerSortKey,
  waitingOf,
  originOf,
  originStats,
} from "./clients";

describe("база клиентов: телефон — ключ", () => {
  it("8…, +7…, 9… и с разделителями — один и тот же человек", () => {
    expect(phoneKey("8 (915) 241-59-99")).toBe("79152415999");
    expect(phoneKey("+7 915 241 59 99")).toBe("79152415999");
    expect(phoneKey("9152415999")).toBe("79152415999");
    expect(phoneKey("12345")).toBe("");
    expect(phoneKey("+375 29 123 45 67")).toBe("375291234567");
    expect(phoneLabel("89152415999")).toBe("+7 915 241-59-99");
  });

  it("городской без семёрки (495, 499, 812, 3xx) — тот же номер, что с +7", () => {
    expect(phoneKey("495 123-45-67")).toBe("74951234567");
    expect(phoneKey("(499) 123 45 67")).toBe("74991234567");
    expect(phoneKey("+7 (495) 123-45-67")).toBe("74951234567");
    expect(phoneKey("8 495 123 45 67")).toBe("74951234567");
    expect(phoneKey("812 123 45 67")).toBe("78121234567");
    expect(phoneKey("343 123 45 67")).toBe("73431234567");
    expect(phoneLabel("4951234567")).toBe("+7 495 123-45-67");
    // Не российский код из 10 цифр — как есть.
    expect(phoneKey("1234567890")).toBe("1234567890");
    expect(phoneKey("5551234567")).toBe("5551234567");
  });

  it("варианты ключа: городской мог лежать в базе без семёрки, мобильный — нет", () => {
    expect(phoneKeyVariants("74951234567")).toEqual(["74951234567", "4951234567"]);
    expect(phoneKeyVariants("78121234567")).toEqual(["78121234567", "8121234567"]);
    expect(phoneKeyVariants("79152415999")).toEqual(["79152415999"]);
    expect(phoneKeyVariants("375291234567")).toEqual(["375291234567"]);
    expect(phoneKeyVariants("")).toEqual([]);
  });
});

describe("база клиентов: споры за заметку и статус", () => {
  it("«Добавить мой текст в конец» — только дописанное, без повтора общего текста", () => {
    expect(appendMyNote("квиз\nперезвонить в 18:00", "квиз\n30 гостей", "квиз")).toBe("квиз\nперезвонить в 18:00\n30 гостей");
    // Ничего своего не дописал — их версия как есть.
    expect(appendMyNote("квиз\nперезвонить", "квиз", "квиз")).toBe("квиз\nперезвонить");
    // Правил строку внутри — новая строка добавляется, общие строки — нет.
    expect(appendMyNote("квиз\nперезвонить", "квиз, 30 гостей", "квиз")).toBe("квиз\nперезвонить\nквиз, 30 гостей");
    // Тот же текст уже есть у них — не дублируем (регистр и пробелы не важны).
    expect(appendMyNote("квиз\nПерезвонить  в 18:00", "квиз\nперезвонить в 18:00", "квиз")).toBe("квиз\nПерезвонить  в 18:00");
    // Пустая основа и пустая их версия.
    expect(appendMyNote("", "новая заметка", "")).toBe("новая заметка");
    expect(appendMyNote("их текст", "мой текст", "")).toBe("их текст\nмой текст");
  });

  it("«Сохранить мои правки поверх»: статус и согласие — свои, только если их меняли", () => {
    const opened = { status: "new", marketing: "unknown" };
    const fresh = { status: "client", marketing: "yes" };
    expect(forcedStatusAndMarketing({ status: "new", marketing: "unknown" }, opened, fresh)).toEqual({ status: "client", marketing: "yes" });
    expect(forcedStatusAndMarketing({ status: "work", marketing: "unknown" }, opened, fresh)).toEqual({ status: "work", marketing: "yes" });
    expect(forcedStatusAndMarketing({ status: "new", marketing: "no" }, opened, fresh)).toEqual({ status: "client", marketing: "no" });
  });

  it("мероприятие и статус: новое — «Клиент» (и из «Провели»), правка учтённого — только из «Новый» и «В работе»", () => {
    expect(statusAfterEvent("new", false)).toBe("client");
    expect(statusAfterEvent("held", false)).toBe("client");
    expect(statusAfterEvent("lost", false)).toBe("client");
    expect(statusAfterEvent("client", false)).toBeNull();
    expect(statusAfterEvent("held", true)).toBeNull();
    expect(statusAfterEvent("lost", true)).toBeNull();
    expect(statusAfterEvent("work", true)).toBe("client");
    expect(statusAfterEvent("new", true)).toBe("client");
  });
});

describe("база клиентов: ссылки на соцсети", () => {
  it("Telegram, @ник, ВКонтакте, Instagram, WhatsApp; почта — не ник", () => {
    expect(parseLinks("пишите @sofia_joy или t.me/Sofia_Joy, vk.com/id123, https://www.instagram.com/sofi.party wa.me/79152415999 mail me@mail.ru")).toEqual([
      "https://t.me/Sofia_Joy",
      "https://vk.com/id123",
      "https://instagram.com/sofi.party",
      "https://wa.me/79152415999",
    ]);
    expect(parseLinks("Связь: @anna_k")).toEqual(["https://t.me/anna_k"]);
    expect(cleanLinks(["t.me/abcd", 5, "javascript:alert(1)"])).toEqual(["https://t.me/abcd"]);
    expect(linkTitle("https://t.me/abcd")).toBe("Telegram @abcd");
    expect(reachable({ phone: "", links: [] })).toBe(false);
    // Клиент без ника из Telegram Business — ссылка по номеру в Telegram.
    expect(cleanLinks(["tg://user?id=123456789"])).toEqual(["tg://user?id=123456789"]);
    expect(linkTitle("tg://user?id=123456789")).toBe("Telegram (без ника)");
    expect(cleanLinks(["tg://resolve?domain=x", "tg://user?id=abc"])).toEqual([]);
  });
});

describe("база клиентов: откуда пришёл", () => {
  it("канал по первому сообщению: Авито, визитка, QR после мероприятия; обычный текст — не узнали", () => {
    expect(originOf("Здравствуйте! Пишу с Авито")).toBe("avito");
    expect(originOf("Добрый день, я по вашей визитке")).toBe("card");
    expect(originOf("Здравствуйте! Я была у вас на празднике в субботу")).toBe("qr");
    expect(originOf("Отсканировал QR после вечера")).toBe("qr");
    expect(originOf("Здравствуйте, сколько стоит квиз?")).toBeNull();
    expect(originOf("🧮 Расчёт JoyRest\nПакет: Квиз")).toBeNull();
  });
  it("«Итоги» по каналам: новые клиенты за период и мероприятия их клиентов по телефону", () => {
    const at = (day: string) => Date.parse(`${day}T12:00:00Z`);
    const clients = [
      { origin: "avito", phone: "+7 900 111-22-33", createdAt: at("2026-10-05") },
      { origin: "avito", phone: "89002223344", createdAt: at("2026-09-05") },
      { origin: "site", phone: "", createdAt: at("2026-10-07") },
      { origin: "", phone: "8 900 555 66 77", createdAt: at("2026-10-08") },
    ];
    const events = [
      { day: "2026-10-20", clientPhone: "89001112233", cancelled: false, held: true },
      { day: "2026-10-21", clientPhone: "+7 900 222 33 44", cancelled: false, held: null },
      { day: "2026-10-22", clientPhone: "89001112233", cancelled: true, held: null },
      { day: "2026-11-02", clientPhone: "89001112233", cancelled: false, held: true },
      { day: "2026-10-23", clientPhone: "", cancelled: false, held: true },
    ];
    const rows = originStats(clients, events, "2026-10-01", "2026-10-31");
    expect(rows).toEqual([
      { origin: "avito", title: "Авито", clients: 1, planned: 2, held: 1 },
      { origin: "site", title: "Сайт", clients: 1, planned: 0, held: 0 },
      { origin: "", title: "Не указан", clients: 1, planned: 0, held: 0 },
    ]);
  });
});

describe("база клиентов: кто ждёт ответа", () => {
  it("новый — с последнего обращения; ждущий в Telegram — с его сообщения, в любом статусе; архив не ждёт", () => {
    const base = { status: "new" as const, archived: false, lastContactAt: 1000, tgWaitingSince: null };
    expect(waitingOf(base)).toEqual({ since: 1000, telegram: false });
    expect(waitingOf({ ...base, status: "work" })).toBeNull();
    expect(waitingOf({ ...base, status: "work", tgWaitingSince: 5000 })).toEqual({ since: 5000, telegram: true });
    expect(waitingOf({ ...base, tgWaitingSince: 5000 })).toEqual({ since: 5000, telegram: true });
    expect(waitingOf({ ...base, archived: true, tgWaitingSince: 5000 })).toBeNull();
  });
});

describe("база клиентов: выгрузка для рассылки", () => {
  it("CSV для Excel: BOM, «;», кавычки и защита от формул", () => {
    const csv = clientsCsv([
      { name: '=HYPERLINK("x")', phone: "89152415999", links: ["https://t.me/abcd"], status: "new", marketing: "yes", marketingAt: Date.parse("2026-10-14T10:00:00Z"), lastContactAt: Date.parse("2026-10-14T10:00:00Z") },
    ]);
    expect(csv.startsWith("﻿Имя;Телефон;")).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")";+7 915 241-59-99;https://t.me/abcd;Новый;Согласен на рассылку;2026-10-14;2026-10-14`);
  });
});

describe("база клиентов: таймер ответа", () => {
  const base = { archived: false, lastContactAt: 1_000_000 };
  it("«Новый» — таймер идёт от прихода в «Новый», старые карточки — от обращения", () => {
    expect(timerOf({ ...base, status: "new", newSince: 1_060_000 }, 1_120_000)).toEqual({ running: true, ms: 60_000, by: "" });
    expect(timerOf({ ...base, status: "new" }, 1_120_000)).toEqual({ running: true, ms: 120_000, by: "" });
    expect(timerOf({ ...base, status: "new", archived: true }, 1_120_000)).toBeNull();
  });
  it("ушёл из «Нового» — таймер стоит на том, сколько ждал, и кто взял; без данных — нет таймера", () => {
    expect(timerOf({ ...base, status: "work", takenMs: 492_000, takenBy: "Мария" }, 9e12)).toEqual({ running: false, ms: 492_000, by: "Мария" });
    expect(timerOf({ ...base, status: "client", takenMs: null }, 9e12)).toBeNull();
  });
  it("подписи времени", () => {
    expect(durationLabel(45_000)).toBe("45 с");
    expect(durationLabel(12 * 60_000 + 5_000)).toBe("12 мин 05 с");
    expect(durationLabel(3 * 3_600_000 + 12 * 60_000)).toBe("3 ч 12 мин");
    expect(durationLabel(52 * 3_600_000)).toBe("2 дн 4 ч");
    expect(durationLabel(-5)).toBe("0 с");
  });
  it("по таймеру: ждущие сейчас — выше всех, дольше ждущий — первым, потом дольше ждавшие", () => {
    const now = 10_000_000;
    const list = [
      { id: "a", ...base, status: "work" as const, takenMs: 3_600_000 },
      { id: "b", ...base, status: "new" as const, newSince: now - 60_000 },
      { id: "c", ...base, status: "new" as const, newSince: now - 600_000 },
      { id: "d", ...base, status: "lost" as const },
      { id: "e", ...base, status: "work" as const, takenMs: 60_000 },
    ];
    expect([...list].sort((x, y) => timerSortKey(y, now) - timerSortKey(x, now)).map((c) => c.id)).toEqual(["c", "b", "a", "e", "d"]);
  });
  it("среднее и обычное время ответа, по каждому менеджеру; ночная заявка не портит «обычно»", () => {
    const st = responseStats([
      { userName: "Мария", waitedMs: 5 * 60_000, takenAt: 1 },
      { userName: "Мария", waitedMs: 7 * 60_000, takenAt: 2 },
      { userName: "Мария", waitedMs: 10 * 3_600_000, takenAt: 3 },
      { userName: "Олег", waitedMs: 20 * 60_000, takenAt: 4 },
    ]);
    expect(st.count).toBe(4);
    expect(st.inTime).toBe(3);
    expect(st.medianMs).toBe(Math.round((7 * 60_000 + 20 * 60_000) / 2));
    expect(st.avgMs).toBeGreaterThan(2 * 3_600_000);
    expect(st.byUser.map((u) => [u.name, u.count, u.medianMs])).toEqual([
      ["Мария", 3, 7 * 60_000],
      ["Олег", 1, 20 * 60_000],
    ]);
    expect(responseStats([])).toMatchObject({ count: 0, avgMs: 0, medianMs: 0 });
  });
});
