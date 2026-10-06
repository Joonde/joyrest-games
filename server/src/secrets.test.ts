/**
 * Токены только на сервере (CLAUDE.md, «Сайт агентства»): ищем в коде строки, похожие на
 * токен бота Telegram (123456789:AA…), и падаем, если нашли. Токен хранится только в
 * /srv/joyrest/secrets.env и задаётся командой `sudo joyrest lead-bot`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const DIRS = ["site", "src", "server", "deploy", "docs", "scripts", "public", ".github"];
// Шаблон собран из частей, чтобы этот файл не находил сам себя.
const TOKEN = new RegExp(["\\d{8,10}", ":", "AA", "[\\w-]{30,}"].join(""), "g");

function files(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    if (name === "node_modules") return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("токены не попадают в код", () => {
  it("шаблон находит токен бота", () => {
    const fake = "1234567890" + ":" + "AA" + "x".repeat(33);
    expect(`const token = "${fake}";`.match(TOKEN)).toHaveLength(1);
  });

  it(`в корне и ${DIRS.join(", ")} нет строк, похожих на токен Telegram`, () => {
    const found: string[] = [];
    const rootFiles = readdirSync(ROOT).filter((name) => statSync(join(ROOT, name)).isFile()).map((name) => join(ROOT, name));
    for (const file of [...rootFiles, ...DIRS.flatMap((dir) => files(join(ROOT, dir)))]) {
      const bytes = readFileSync(file);
      if (bytes.length > 5_000_000) continue;
      const text = bytes.toString("latin1");
      for (const match of text.matchAll(TOKEN)) {
        found.push(`${relative(ROOT, file)}: ${match[0].slice(0, 12)}…`);
      }
    }
    expect(found, "Найдены похожие на токен строки — уберите их и перевыпустите токен в @BotFather").toEqual([]);
  });
});
