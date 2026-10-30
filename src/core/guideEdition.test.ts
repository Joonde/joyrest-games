import { describe, expect, it } from "vitest";
import { GAME_GUIDES, GUIDE_INTRO, GUIDE_TROUBLE } from "./guide";
import { EDITOR_BASICS, EDITOR_GUIDES } from "./editorGuide";
import { forLite, liteText, LITE_DROP_BLOCKS, LITE_RULES } from "./guideEdition";

const ALL = { GAME_GUIDES, GUIDE_INTRO, GUIDE_TROUBLE, EDITOR_BASICS, EDITOR_GUIDES };

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
  return out;
}

// Разделы агентства, которых в Лайте нет, и роли команды агентства.
const AGENCY_ONLY = [
  /фотоотч/i,
  /чаев/i,
  /авито/i,
  /отзыв/i,
  /telegram/i,
  /календар/i,
  /оформление под заказчика/i,
  /предлож\w* в библиотек/i,
  /игры от ведущих/i,
  /заместител/i,
  /агентств/i,
  /games\.joy-rest\.ru/i,
];

describe("инструкции в Лайте", () => {
  it("каждое правило ещё находит свой текст в инструкциях агентства", () => {
    const texts = strings(ALL);
    for (const [find] of LITE_RULES) {
      expect(texts.some((t) => find.test(t)), `правило ${find} больше ничего не находит — поправьте его по новому тексту`).toBe(true);
    }
    const titles = GUIDE_INTRO.map((b) => b.title).concat(EDITOR_BASICS.map((b) => b.title));
    for (const drop of LITE_DROP_BLOCKS) {
      expect(titles.some((t) => drop.test(t)), `раздел ${drop} больше не найден — поправьте правило`).toBe(true);
    }
  });

  it("в Лайте нет упоминаний скрытых разделов агентства", () => {
    const lite = strings(forLite(ALL, "lite-test.joy-rest.ru"));
    for (const word of AGENCY_ONLY) {
      const left = lite.filter((t) => word.test(t));
      expect(left, `в Лайте осталось «${word}»`).toEqual([]);
    }
  });

  it("в Лайте не остаётся пустых строк и сломанных пунктов", () => {
    const lite = forLite(ALL, "lite.example");
    // Пустые подписи в схемах шагов есть и у агентства — правила новых не добавляют.
    const empty = (list: string[]) => list.filter((t) => !t.trim()).length;
    expect(empty(strings(lite))).toBe(empty(strings(ALL)));
    // Правила не оставляют двойных пробелов и пробелов перед знаком (« .lrc» в текстах агентства — так задумано).
    const spaced = (list: string[]) => list.filter((t) => / {2}| [,.;)]/.test(t)).length;
    expect(spaced(strings(lite))).toBeLessThanOrEqual(spaced(strings(ALL)));
    expect(lite.GUIDE_TROUBLE.every((row) => row.length === 2)).toBe(true);
    expect(lite.GAME_GUIDES.map((g) => g.mechanic)).toEqual(GAME_GUIDES.map((g) => g.mechanic));
    expect(lite.EDITOR_GUIDES.map((g) => g.mechanic)).toEqual(EDITOR_GUIDES.map((g) => g.mechanic));
    expect(lite.GUIDE_INTRO.map((b) => b.title)).toEqual(
      GUIDE_INTRO.map((b) => b.title).filter((t) => !LITE_DROP_BLOCKS.some((r) => r.test(t))),
    );
    expect(lite.GUIDE_INTRO.length).toBeLessThan(GUIDE_INTRO.length);
  });

  it("адрес платформы — свой; у агентства тексты не меняются", () => {
    expect(liteText("Откройте games.joy-rest.ru/j и введите код", "lite.example")).toBe("Откройте lite.example/j и введите код");
    const before = JSON.stringify(ALL);
    forLite(ALL, "lite.example");
    expect(JSON.stringify(ALL)).toBe(before);
    expect(strings(ALL).some((t) => /фотоотч/i.test(t))).toBe(true);
  });

  it("экраны инструкций берут тексты Лайта по метке редакции", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    for (const file of ["Guide.tsx", "EditorGuide.tsx"]) {
      const src = readFileSync(resolve(import.meta.dirname, "../screens/studio", file), "utf8");
      expect(src, file).toContain('const LITE = edition() === "lite";');
      expect(src, file).toMatch(/LITE \? forLite\(/);
    }
  });
});
