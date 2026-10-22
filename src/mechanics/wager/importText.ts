// «Держи пари» — разбор вставки списком: строка «Вопрос? = 330 м» (после «=» — число, потом единицы).
import { cleanNumber, newQuestion, WAGER_LIMITS, type WagerQuestion } from "./content";

export interface WagerImport {
  questions: WagerQuestion[];
  /** Строки, которые не разобрали: номер строки (с 1) и текст — показываем ведущему, а не теряем молча. */
  skipped: Array<{ line: number; text: string }>;
}

/**
 * Число сразу после «=»: начинается с цифры (минус — по желанию), пробелы между разрядами («1 665»), дробь через точку
 * или запятую. «= около 330 м» — не число: строка пропущена (раньше `[\d\s]+` брал пробел, и выходил ответ 0).
 */
const NUMBER = /^\s*([-−]?\d[\d   ]*(?:[.,]\d+)?)\s*(.*)$/;

export function importWager(text: string): WagerImport {
  const questions: WagerQuestion[] = [];
  const skipped: WagerImport["skipped"] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const at = line.lastIndexOf("=");
    const question = at > 0 ? line.slice(0, at).trim() : "";
    const m = at > 0 ? NUMBER.exec(line.slice(at + 1)) : null;
    const answer = m ? cleanNumber((m[1] ?? "").replace("−", "-")) : null;
    if (!question || answer === null) {
      skipped.push({ line: i + 1, text: line });
      return;
    }
    questions.push({ ...newQuestion(), text: question.slice(0, WAGER_LIMITS.text), answer, unit: (m?.[2] ?? "").trim().slice(0, WAGER_LIMITS.unit) });
  });
  return { questions, skipped };
}
