import { describe, expect, it } from "vitest";
import { eventFillFromClient } from "./clientToEvent";

const TODAY = "2026-10-24";
const CALC = `🧮 Расчёт JoyRest
────────────
Пакет: Квиз
Гостей: до 25
Дата: 20 декабря 2026, вс
Начало: в 19:00 (примерно, подтвердит менеджер)
День: пятница–воскресенье
Продление: нет
Допы: Призы и медали
Длительность: ≈ 1,5–2 часа
✅ Опытный: 32 900 ₽ — выбран`;

describe("из карточки клиента — в мероприятие ведущему", () => {
  it("имя и телефон — из карточки, дата, время, гости и программа — из расчёта в истории", () => {
    const f = eventFillFromClient(
      { name: "Анна", phone: "+7 915 000-77-66", notes: "", history: [{ source: "telegram", summary: `Имя: Аня Петрова\n${CALC}`, at: 1 }] },
      TODAY,
    );
    expect(f.clientName).toBe("Анна");
    expect(f.clientPhone).toBe("+7 915 000-77-66");
    expect(f.day).toBe("2026-12-20");
    expect(f.start).toBe(19 * 60);
    expect(f.guests).toBe(25);
    expect(f.program?.formats).toEqual(["Квиз"]);
    expect(f.program?.addons).toEqual(["Призы и медали"]);
    expect(f.got).toEqual(["имя", "телефон", "дата", "время", "гости", "программа"]);
  });

  it("заметка менеджера свежее заявки: её дата и гости важнее", () => {
    const f = eventFillFromClient(
      {
        name: "Олег",
        phone: "89150001122",
        notes: "Договорились: корпоратив 12 декабря, 40 гостей, с 18:00 до 22:00, ресторан «Север»",
        history: [{ source: "site", summary: "Тип мероприятия: День рождения\nГостей: 15\nДата: 5 ноября", at: 5 }],
      },
      TODAY,
    );
    expect(f.day).toBe("2026-12-12");
    expect(f.guests).toBe(40);
    expect(f.start).toBe(18 * 60);
    expect(f.end).toBe(22 * 60);
    expect(f.title).toBe("Корпоратив");
  });

  it("новые обращения важнее старых; смены статуса и мероприятия не читаются; прошедшая дата не подставляется", () => {
    const f = eventFillFromClient(
      {
        name: "Ира",
        phone: "",
        notes: "",
        history: [
          { source: "site", summary: "Свадьба, 10 марта 2026, 80 гостей", at: 1 },
          { source: "status", summary: "Клиент · Мария, 30 гостей", at: 9 },
          { source: "event", summary: "Юбилей, 70 гостей", at: 8 },
          { source: "manual", summary: "Свадьба, 60 гостей", at: 5 },
        ],
      },
      TODAY,
    );
    expect(f.guests).toBe(60);
    expect(f.title).toBe("Свадьба");
    expect(f.day).toBeUndefined();
    expect(f.clientPhone).toBeUndefined();
  });

  it("пустая карточка — только имя", () => {
    const f = eventFillFromClient({ name: "Без заявки", phone: "", notes: "" }, TODAY);
    expect(f).toEqual({ clientName: "Без заявки", program: null, got: ["имя"] });
  });
});
