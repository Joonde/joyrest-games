import { describe, expect, it } from "vitest";
import { composeWish, EMPTY_WISH, wishFromText } from "./clientWish";
import { eventFillFromClient } from "./clientToEvent";

const TODAY = "2026-10-24";

describe("«Что хочет клиент» полями", () => {
  it("поля → текст заметки: понятные строки, пустые не пишутся", () => {
    expect(composeWish(EMPTY_WISH)).toBe("");
    const text = composeWish({ day: "2026-12-20", time: "19:00", guests: "35", formats: ["Квиз", "Музыкальный"], wishes: "Без конкурсов с раздеванием" });
    expect(text).toBe("Дата: 20.12.2026\nНачало: в 19:00\nГостей: 35\nПрограмма: Квиз → Музыкальный\nПожелания: Без конкурсов с раздеванием");
    expect(composeWish({ ...EMPTY_WISH, guests: "0", time: "25:00", day: "2026-02-30", formats: ["Бокс"] })).toBe("");
  });

  it("текст анкеты → те же поля (туда и обратно без потерь), порядок форматов сохраняется", () => {
    const w = { day: "2026-12-20", time: "19:00", guests: "35", formats: ["Танцевальный", "Квиз"], wishes: "Свадьба, тихий зал\nбез алкоголя" };
    expect(wishFromText(composeWish(w), TODAY, true)).toEqual(w);
  });

  it("старая свободная заметка: в строгом режиме всё остаётся в «Пожеланиях», поля пустые", () => {
    const old = "Свадьба 12 июня, 60 гостей, перезвонить в пятницу";
    expect(wishFromText(old, TODAY, true)).toEqual({ ...EMPTY_WISH, wishes: old });
  });

  it("вставленная переписка: дата, время, гости и формат по всему тексту, имя и телефон — не в пожелания", () => {
    const w = wishFromText("Имя: Ольга\nТелефон: +7 915 001-08-70\nКорпоратив 04.12.2026, 35 гостей, с 18:00 до 22:00, нужен квиз\nПишу с Авито", TODAY);
    expect(w.day).toBe("2026-12-04");
    expect(w.time).toBe("18:00");
    expect(w.guests).toBe("35");
    expect(w.formats).toEqual(["Квиз"]);
    expect(w.wishes).toBe("Корпоратив 04.12.2026, 35 гостей, с 18:00 до 22:00, нужен квиз\nПишу с Авито");
  });

  it("из полей анкеты «Записать мероприятие ведущему» берёт дату, время, гостей и программу", () => {
    const notes = composeWish({ day: "2026-12-20", time: "19:00", guests: "35", formats: ["Квиз", "Музыкальный"], wishes: "Корпоратив" });
    const f = eventFillFromClient({ name: "Ольга", phone: "+7 915 001-08-70", notes }, TODAY);
    expect(f.day).toBe("2026-12-20");
    expect(f.start).toBe(19 * 60);
    expect(f.guests).toBe(35);
    expect(f.program?.formats).toEqual(["Квиз", "Музыкальный"]);
    expect(f.title).toBe("Корпоратив");
  });
});
