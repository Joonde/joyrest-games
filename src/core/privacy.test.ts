import { describe, expect, it } from "vitest";
import { contactQuery, matchesContact, queryLabel } from "./privacy";

describe("«Данные по номеру»: что искать", () => {
  it("телефон в любом виде — один ключ", () => {
    for (const raw of ["8 (915) 241-59-99", "+7 915 241 59 99", "9152415999", " 89152415999 "]) {
      expect(contactQuery(raw)?.phone, raw).toBe("79152415999");
    }
    expect(queryLabel(contactQuery("89152415999")!)).toBe("+7 915 241-59-99");
  });

  it("ник, ссылка и почта", () => {
    expect(contactQuery("@sofia_joy")?.links).toEqual(["https://t.me/sofia_joy"]);
    expect(contactQuery("https://t.me/Sofia_Joy")?.links).toEqual(["https://t.me/sofia_joy"]);
    expect(contactQuery("sofia_joy")?.links).toEqual(["https://t.me/sofia_joy"]);
    expect(contactQuery("vk.com/anna.k")?.links).toEqual(["https://vk.com/anna.k"]);
    expect(contactQuery("Anna@Mail.ru")).toEqual({ phone: "", links: [], email: "anna@mail.ru", digits: "" });
  });

  it("слишком мало, чтобы искать, — null", () => {
    expect(contactQuery("")).toBeNull();
    expect(contactQuery("123")).toBeNull();
    expect(contactQuery("Анна")).toBeNull();
  });
});

describe("«Данные по номеру»: совпадение", () => {
  const q = contactQuery("8 915 241-59-99")!;
  it("по телефону в любом виде", () => {
    expect(matchesContact(q, { phones: ["+7 (915) 241-59-99"] })).toBe(true);
    expect(matchesContact(q, { phones: ["+7 915 241-59-98"] })).toBe(false);
    expect(matchesContact(q, { texts: ["WhatsApp 89152415999"] })).toBe(true);
  });
  it("по нику в ссылках и в тексте мессенджера, без регистра", () => {
    const nick = contactQuery("@Sofia_Joy")!;
    expect(matchesContact(nick, { links: ["https://t.me/sofia_joy"] })).toBe(true);
    expect(matchesContact(nick, { texts: ["Telegram @sofia_joy"] })).toBe(true);
    expect(matchesContact(nick, { texts: ["@sofia"] })).toBe(false);
  });
  it("неполный номер (без ключа) — по всем цифрам: удаление находит и записи с опечаткой", () => {
    const short = contactQuery("8915123456")!;
    expect(short).not.toBeNull();
    expect(short.phone).toBe("");
    expect(short.digits).toBe("915123456");
    expect(queryLabel(short)).toBe("915123456 (номер неполный)");
    expect(matchesContact(short, { phones: ["8 915 123 45 6"] })).toBe(true);
    expect(matchesContact(short, { phones: ["+7 915 123-45-6"] })).toBe(true);
    expect(matchesContact(short, { texts: ["8915123456"] })).toBe(true);
    expect(matchesContact(short, { phones: ["8 915 123 45 67"] })).toBe(false);
    // Лишняя цифра — тоже без ключа, находится по цифрам.
    const long = contactQuery("+7 916 123 45 678")!;
    expect(long.phone).toBe("");
    expect(matchesContact(long, { phones: ["8-916-123-45-678"] })).toBe(true);
  });
  it("полный номер находит и запись с тем же номером без ключа не находит чужие", () => {
    expect(q.digits).toBe("9152415999");
    expect(matchesContact(q, { phones: ["915 241 59 99"] })).toBe(true);
    expect(matchesContact(q, { phones: ["915 241 59 9"] })).toBe(false);
  });
  it("меньше 6 цифр и ссылки с цифрами — не номер", () => {
    expect(contactQuery("12345")).toBeNull();
    expect(contactQuery("vk.com/id123456")?.digits).toBe("");
  });
  it("по почте", () => {
    const mail = contactQuery("anna@mail.ru")!;
    expect(matchesContact(mail, { emails: ["Anna@mail.ru "] })).toBe(true);
    expect(matchesContact(mail, { emails: ["anna@yandex.ru"] })).toBe(false);
  });
});
