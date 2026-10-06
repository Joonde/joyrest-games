/**
 * Миграции обратно совместимы (expand/contract): они выполняются ДО переключения версии,
 * а откат возвращает прошлый код, но не схему. Поэтому новая схема должна работать и со
 * старым кодом. Этот модуль находит в миграции операции, которые ломают прошлую версию.
 *
 * Удаление и переименование — только отдельной «contract»-миграцией с первой строкой
 * `-- contract: <что удаляем и с какого релиза это не используется>`, не раньше чем через
 * релиз после того, как код перестал это использовать.
 */

export interface MigrationProblem {
  statement: string;
  reason: string;
}

const CONTRACT_HEADER = /^\s*--\s*contract:\s*\S/;

const RULES: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bdrop\s+(table|column|view|materialized\s+view|schema|type|function|index|constraint|sequence|trigger)\b/, reason: "удаление (прошлая версия может этим пользоваться)" },
  { pattern: /\brename\b/, reason: "переименование (прошлая версия ищет старое имя)" },
  { pattern: /\balter\s+column\b[\s\S]*\btype\b/, reason: "смена типа колонки" },
  { pattern: /\bset\s+not\s+null\b/, reason: "NOT NULL на существующей колонке (прошлая версия может писать NULL)" },
  { pattern: /\btruncate\b/, reason: "очистка таблицы" },
  { pattern: /\bdelete\s+from\b/, reason: "удаление данных" },
];

/** Убирает комментарии и строковые литералы, приводит к нижнему регистру. */
function normalize(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .toLowerCase();
}

export function isContractMigration(sql: string): boolean {
  return CONTRACT_HEADER.test(sql.split("\n", 1)[0] ?? "");
}

export function checkMigration(sql: string): MigrationProblem[] {
  if (isContractMigration(sql)) return [];
  const problems: MigrationProblem[] = [];
  for (const raw of normalize(sql).split(";")) {
    const statement = raw.replace(/\s+/g, " ").trim();
    if (!statement) continue;
    for (const rule of RULES) {
      if (rule.pattern.test(statement)) problems.push({ statement, reason: rule.reason });
    }
    // Новая обязательная колонка без значения по умолчанию: прошлая версия её не заполняет.
    for (const column of statement.split(/\badd\s+column\b/).slice(1)) {
      const definition = column.split(",")[0];
      if (/\bnot\s+null\b/.test(definition) && !/\bdefault\b/.test(definition)) {
        problems.push({ statement, reason: "новая колонка NOT NULL без DEFAULT" });
      }
    }
  }
  return problems;
}
