// «Держи пари» — разбор вставки списком: строка «Вопрос? = 330 м» (после «=» — число, потом единицы).
import { isQuestionHeader, parseNumberText, QUESTION_NUMBERING, splitLines } from "../quiz/listText";
import { cleanNumber, newQuestion, WAGER_LIMITS, type WagerQuestion } from "./content";

export interface WagerImport {
  questions: WagerQuestion[];
  /** Строки, которые не разобрали: номер строки (с 1) и текст — показываем ведущему, а не теряем молча. */
  skipped: Array<{ line: number; text: string }>;
}

/**
 * Число сразу после «=» — общий разбор чисел квиза (`parseNumberText`): начинается с цифры (минус — по желанию), пробелы
 * между разрядами («1 665»), «1.665» и «1,665» — тысячи (1665), «1,5» и «3.14» — дробь. «= около 330 м» — не число:
 * строка пропущена (раньше `[\d\s]+` брал пробел, и выходил ответ 0; потом «1.665» читалось как 1,67).
 */
export function importWager(text: string): WagerImport {
  const questions: WagerQuestion[] = [];
  const skipped: WagerImport["skipped"] = [];
  splitLines(text).forEach((raw, i) => {
    const line = raw.trim();
    // «Вопрос 1» отдельной строкой — заголовок, не вопрос: пропускаем молча.
    if (!line || isQuestionHeader(line)) return;
    const at = line.lastIndexOf("=");
    const question = at > 0 ? line.slice(0, at).replace(QUESTION_NUMBERING, "").trim() : "";
    const parsed = at > 0 ? parseNumberText(line.slice(at + 1)) : null;
    const answer = parsed && parsed.value !== null ? cleanNumber(parsed.value) : null;
    if (!question || answer === null) {
      skipped.push({ line: i + 1, text: line });
      return;
    }
    questions.push({ ...newQuestion(), text: question.slice(0, WAGER_LIMITS.text), answer, unit: (parsed?.unit ?? "").slice(0, WAGER_LIMITS.unit) });
  });
  return { questions, skipped };
}
