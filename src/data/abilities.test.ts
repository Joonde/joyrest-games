import { describe, expect, it } from "vitest";
import { abilitiesOf } from "../core/abilities";
import { ACCESS_ROLES } from "../core/accessRoles";
import { PROFESSIONS } from "../core/professions";
import { ADMIN_UID } from "./config";
import * as permissions from "./permissions";
import type { Actor } from "./permissions";

/**
 * «Мои возможности» (`src/core/abilities.ts`) — для каждой профессии и каждой роли: текст собран из тех же функций прав,
 * что проверяет сервер, поэтому PDF не обещает того, чего человек не может, и не прячет того, что может.
 */
const person = (profession: string, accessRole: string | null, active = true): Actor => ({ uid: "u-1", role: "host", active, profession, accessRole });
const texts = (a: ReturnType<typeof abilitiesOf>) => a.can.flatMap((g) => g.items.map((i) => i.text)).join("\n");

describe("«Мои возможности» — все профессии и роли", () => {
  it("у каждого сочетания профессии и роли есть что делать и понятно, чего нельзя", () => {
    for (const prof of PROFESSIONS) {
      for (const role of [null, ...ACCESS_ROLES.map((r) => r.id)]) {
        const a = abilitiesOf(person(prof.id, role), permissions);
        const label = `${prof.id} + ${role ?? "без роли"}`;
        expect(a.can.length, label).toBeGreaterThan(0);
        expect(a.cannot.length, label).toBeGreaterThan(0);
        expect(a.cannot.join(" "), label).toContain("только владелец");
        expect(a.who, label).toBe(prof.title);
        // Пункты не повторяются.
        const all = a.can.flatMap((g) => g.items.map((i) => i.text));
        expect(new Set(all).size, label).toBe(all.length);
      }
    }
  });

  it("ведущий проводит игры, музыка и видео — в своё место 2 ГБ", () => {
    const a = texts(abilitiesOf(person("host", null), permissions));
    expect(a).toContain("Проводить игры");
    expect(a).toContain("Загружать свою музыку");
    expect(a).toContain("в своё место 2 ГБ вместе с музыкой");
    expect(a).not.toContain("База клиентов");
  });

  it("менеджер по продажам: клиенты, «Кто может», мероприятия; без выгрузки и игр", () => {
    const m = abilitiesOf(person("sales", "sales"), permissions);
    const t = texts(m);
    expect(t).toContain("База клиентов");
    expect(t).toContain("«Кто может»");
    expect(t).toContain("Записать, изменить, отменить");
    expect(t).toContain("Инструкция менеджера");
    expect(t).not.toContain("Выгрузка клиентов");
    expect(m.cannot.join(" ")).toContain("Выгружать клиентов");
    expect(m.cannot.join(" ")).toContain("Проводить игры для гостей");
    expect(m.guides.map((g) => g.to)).toContain("/studio/sales-guide");
  });

  it("создатель игр: свои игры с музыкой и видео, без проведения игр", () => {
    const c = abilitiesOf(person("dj", "creator"), permissions);
    const t = texts(c);
    expect(t).toContain("Создавать и править свои игры");
    expect(t).toContain("Загружать свою музыку");
    expect(t).toContain("Загружать видео JoyRest");
    expect(c.cannot.join(" ")).toContain("Проводить игры для гостей");
  });

  it("другие профессии без роли: профиль, команда, календарь — и честно «своего раздела пока нет»", () => {
    for (const prof of PROFESSIONS.filter((p) => p.id !== "host")) {
      const a = abilitiesOf(person(prof.id, null), permissions);
      const t = texts(a);
      expect(t, prof.id).toContain("Свой календарь");
      expect(t, prof.id).not.toContain("Проводить игры");
      if (prof.id !== "sales") expect(a.summary, prof.id).toContain("пока нет");
    }
  });

  it("владелец: всё, включая людей и роли; запретов нет", () => {
    const o = abilitiesOf({ uid: ADMIN_UID, role: "admin", active: true }, permissions);
    const t = texts(o);
    expect(o.who).toBe("Владелец агентства");
    expect(t).toContain("Добавлять и отключать людей");
    expect(t).toContain("Удалять игры библиотеки");
    expect(o.cannot).toEqual([]);
  });

  it("отключённый человек ничего не может", () => {
    const off = abilitiesOf(person("host", "deputy", false), permissions);
    expect(off.can).toEqual([]);
  });
});
