import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Правило архитектуры (CLAUDE.md, раздел 2): всё про Firebase — только в src/data/.
// Экраны, компоненты, механики и ядро работают через интерфейсы слоя данных.

const SRC = join(process.cwd(), "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const FIREBASE_IMPORT = /from\s+["'](firebase(\/[^"']*)?|@firebase\/[^"']+)["']|import\(\s*["']firebase/;
// Внутренние модули слоя данных: снаружи доступен только src/data/index.ts.
const DATA_INTERNALS = /from\s+["'](\.{1,2}\/)+data\/(?!index["']|types["'])[^"']+["']/g;
// Исключение: main.tsx заранее качает SDK через лёгкий загрузчик, не таща весь слой данных
// в общий чанк главной и /j.
const ALLOWED_INTERNALS: Record<string, string[]> = { "main.tsx": ['from "./data/firebase"'] };

describe("граница слоя данных", () => {
  const outside = files(SRC).filter((f) => !relative(SRC, f).startsWith(`data${sep}`));

  it("вне src/data/ нет импортов Firebase", () => {
    const offenders = outside.filter((f) => FIREBASE_IMPORT.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });

  it("экраны и компоненты берут данные только из src/data/index.ts", () => {
    const offenders = outside.flatMap((f) => {
      const allowed = ALLOWED_INTERNALS[relative(SRC, f)] ?? [];
      const found = readFileSync(f, "utf8").match(DATA_INTERNALS) ?? [];
      return found.filter((m) => !allowed.includes(m)).map((m) => `${relative(SRC, f)}: ${m}`);
    });
    expect(offenders).toEqual([]);
  });
});
