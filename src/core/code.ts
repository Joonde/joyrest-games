/** Длина кода сессии: 6 цифр удобно набирать на цифровой клавиатуре телефона. */
export const SESSION_CODE_LENGTH = 6;

const CODE_PATTERN = new RegExp(`^\\d{${SESSION_CODE_LENGTH}}$`);

/** Случайный код сессии. Первая цифра не ноль, чтобы код не терял вид при диктовке. */
export function generateSessionCode(random: () => number = Math.random): string {
  let code = String(1 + Math.floor(random() * 9));
  for (let i = 1; i < SESSION_CODE_LENGTH; i++) {
    code += String(Math.floor(random() * 10));
  }
  return code;
}

/** Убирает пробелы и дефисы, которые гости часто вводят вместе с кодом. */
export function normalizeSessionCode(input: string): string {
  return input.replace(/[\s-]/g, "");
}

export function isValidSessionCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

/** «123456» → «123 456» для крупного показа на экране. */
export function formatSessionCode(code: string): string {
  return code.length === SESSION_CODE_LENGTH ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}
