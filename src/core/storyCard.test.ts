import { describe, expect, it } from "vitest";
import { closestSlide, STORY_STYLES, storyCardText, storyDate, storyEyebrow, storyGameTitle, type StoryCardInput } from "./storyCard";

const base: StoryCardInput = {
  name: "🦊 Аня",
  teams: false,
  place: 5,
  total: 20,
  gameTitle: "Новогодний переполох",
  formatTitle: "Квиз",
  mechanic: "quiz",
  playedAt: Date.UTC(2026, 9, 31, 17, 0),
};

describe("карточка для сторис", () => {
  it("победитель — «1 место 🏆» и «Поделиться победой»", () => {
    const t = storyCardText({ ...base, place: 1, teams: true, name: "🦉 Совы" });
    expect(t.headline).toBe("1 место 🏆");
    expect(t.who).toBe("Команда «Совы»");
    expect(t.emoji).toBe("🦉");
    expect(t.placeNumber).toBe(1);
    expect(t.button).toBe("🏆 Поделиться победой");
    expect(t.game).toBe("Квиз «Новогодний переполох» · 31.10.2026");
    expect(t.footer).toBe("joy-rest.ru · t.me/JoyRest");
  });

  it("остальные — «Я играл(а) в квиз JoyRest!», места на картинке нет", () => {
    const t = storyCardText(base);
    expect(t.headline).toBe("Я играл(а) в квиз JoyRest!");
    expect(t.placeNumber).toBeNull();
    expect(t.medal).toBeNull();
    expect(t.who).toBe("Аня");
    expect(t.button).toBe("📸 Поделиться карточкой");
    expect(t.shareText).not.toMatch(/место/);
  });

  it("команда не на пьедестале — «Мы играли…», формат без своего слова — «в игру»", () => {
    expect(storyCardText({ ...base, teams: true, name: "Совы" }).headline).toBe("Мы играли в квиз JoyRest!");
    expect(storyCardText({ ...base, mechanic: "dragon", formatTitle: "Бой с драконом" }).headline).toBe("Я играл(а) в игру JoyRest!");
    expect(storyCardText({ ...base, mechanic: "lotto" }).headline).toBe("Я играл(а) в музыкальное лото JoyRest!");
  });

  it("2 и 3 место — с медалью, если участников хватает", () => {
    expect(storyCardText({ ...base, place: 2 }).headline).toBe("2 место 🥈");
    expect(storyCardText({ ...base, place: 3 }).button).toBe("🥉 Поделиться результатом");
    // Двое в игре: второй — не «серебро».
    expect(storyCardText({ ...base, place: 2, total: 2 }).medal).toBeNull();
  });

  it("смайлик не из набора тоже отделяется, «Команда» не удваивается", () => {
    expect(storyCardText({ ...base, name: "🚀 Ракета" }).emoji).toBe("🚀");
    expect(storyCardText({ ...base, teams: true, name: "Команда мечты" }).who).toBe("Команда мечты");
  });

  it("название игры без повтора формата, дата по Москве", () => {
    expect(storyGameTitle("Квиз «Офис»", "Квиз")).toBe("Квиз «Офис»");
    expect(storyGameTitle("Музыкальное лото: хиты", "Музыкальное лото")).toBe("Музыкальное лото: хиты");
    expect(storyGameTitle("", "Квиз")).toBe("Квиз");
    expect(storyGameTitle("Вечер", null)).toBe("Вечер");
    // 31 октября, 22:30 по UTC — уже 1 ноября в Москве.
    expect(storyDate(Date.UTC(2026, 9, 31, 22, 30))).toBe("01.11.2026");
  });
});

describe("стили карточки и лента", () => {
  it("три стиля, первым — «Венок», id не повторяются", () => {
    expect(STORY_STYLES.map((s) => s.title)).toEqual(["Венок", "Ар-деко", "Светлый"]);
    expect(new Set(STORY_STYLES.map((s) => s.id)).size).toBe(STORY_STYLES.length);
  });

  it("надпись над цифрой — по месту и стилю", () => {
    expect(storyEyebrow("wreath", "gold")).toBe("ПОБЕДИТЕЛЬ");
    expect(storyEyebrow("deco", "gold")).toBe("ЧЕМПИОН ВЕЧЕРА");
    expect(storyEyebrow("light", "silver")).toBe("СЕРЕБРО");
    expect(storyEyebrow("deco", "bronze")).toBe("БРОНЗА");
    expect(storyEyebrow("wreath", null)).toBe("ИГРОВОЙ ВЕЧЕР");
  });

  it("по центру — ближайший к центру окна слайд, где бы ни остановилась лента", () => {
    const centers = [180, 430, 680];
    expect(closestSlide(centers, 180)).toBe(0);
    expect(closestSlide(centers, 300)).toBe(0);
    expect(closestSlide(centers, 310)).toBe(1);
    expect(closestSlide(centers, 430)).toBe(1);
    expect(closestSlide(centers, 556)).toBe(2);
    expect(closestSlide(centers, 9999)).toBe(2);
    expect(closestSlide(centers, -50)).toBe(0);
    expect(closestSlide([], 100)).toBe(0);
  });
});
