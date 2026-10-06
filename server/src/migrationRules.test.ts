import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrationFiles } from "./migrate";
import { checkMigration } from "./migrationRules";

const DIR = join(__dirname, "..", "migrations");

describe("миграции проекта", () => {
  it("обратно совместимы (expand/contract)", () => {
    const problems = migrationFiles(DIR).flatMap((name) =>
      checkMigration(readFileSync(join(DIR, name), "utf8")).map((p) => `${name}: ${p.reason}: ${p.statement}`),
    );
    expect(problems).toEqual([]);
  });
});

describe("проверка миграций", () => {
  it("пропускает добавляющие миграции", () => {
    expect(
      checkMigration(`
        create table sessions (id text primary key, phase text not null, updated_at timestamptz not null default now());
        alter table sessions add column theme_id text;
        alter table sessions add column answered int not null default 0, add column note text;
        create index sessions_code on sessions (code);
        -- drop table sessions — в комментарии можно
        insert into settings (key, value) values ('drop table', 'rename');
      `),
    ).toEqual([]);
  });

  it.each([
    ["drop table games", "удаление"],
    ["alter table games drop column title", "удаление"],
    ["drop index if exists games_owner", "удаление"],
    ["alter table games rename column title to name", "переименование"],
    ["alter table games rename to library", "переименование"],
    ["alter table games alter column title type varchar(80)", "смена типа"],
    ["alter table games alter column title set not null", "NOT NULL"],
    ["alter table games add column owner text not null", "без DEFAULT"],
    ["alter table games add column a text, add column b int not null", "без DEFAULT"],
    ["truncate answers", "очистка"],
    ["delete from answers where step = 1", "удаление данных"],
    ["ALTER TABLE Games DROP COLUMN Title", "удаление"],
  ])("ловит: %s", (sql, reason) => {
    const problems = checkMigration(sql);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.map((p) => p.reason).join(" ")).toContain(reason);
  });

  it("contract-миграция с обоснованием в первой строке разрешена", () => {
    expect(checkMigration("-- contract: games.title не используется с релиза 0007\nalter table games drop column title;")).toEqual([]);
    expect(checkMigration("-- contract:\nalter table games drop column title;").length).toBe(1);
    expect(checkMigration("select 1;\n-- contract: поздно\nalter table games drop column title;").length).toBe(1);
  });
});
