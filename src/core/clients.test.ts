import { describe, expect, it } from "vitest";
import { cleanLinks, clientsCsv, linkTitle, parseLinks, phoneKey, phoneLabel, reachable } from "./clients";

describe("база клиентов: телефон — ключ", () => {
  it("8…, +7…, 9… и с разделителями — один и тот же человек", () => {
    expect(phoneKey("8 (915) 241-59-99")).toBe("79152415999");
    expect(phoneKey("+7 915 241 59 99")).toBe("79152415999");
    expect(phoneKey("9152415999")).toBe("79152415999");
    expect(phoneKey("12345")).toBe("");
    expect(phoneKey("+375 29 123 45 67")).toBe("375291234567");
    expect(phoneLabel("89152415999")).toBe("+7 915 241-59-99");
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

describe("база клиентов: выгрузка для рассылки", () => {
  it("CSV для Excel: BOM, «;», кавычки и защита от формул", () => {
    const csv = clientsCsv([
      { name: '=HYPERLINK("x")', phone: "89152415999", links: ["https://t.me/abcd"], status: "new", marketing: "yes", marketingAt: Date.parse("2026-10-14T10:00:00Z"), lastContactAt: Date.parse("2026-10-14T10:00:00Z") },
    ]);
    expect(csv.startsWith("﻿Имя;Телефон;")).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")";+7 915 241-59-99;https://t.me/abcd;Новый;Согласен на рассылку;2026-10-14;2026-10-14`);
  });
});
