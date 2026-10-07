/** Без похожих символов (0/O, 1/l/I): пароль диктуют голосом или переписывают с экрана. */
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const TEMP_PASSWORD_LENGTH = 10;

/** Временный пароль ведущего. `random` — источник случайных байт (по умолчанию crypto). */
export function generateTempPassword(
  random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
): string {
  let result = "";
  // Отбрасываем байты за пределами кратного длине алфавита — без перекоса распределения.
  const limit = 256 - (256 % ALPHABET.length);
  while (result.length < TEMP_PASSWORD_LENGTH) {
    for (const byte of random(new Uint8Array(TEMP_PASSWORD_LENGTH * 2))) {
      if (byte < limit && result.length < TEMP_PASSWORD_LENGTH) result += ALPHABET[byte % ALPHABET.length];
    }
  }
  return result;
}

export const PASSWORD_MIN_LENGTH = 8;

export function isStrongEnough(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH;
}
