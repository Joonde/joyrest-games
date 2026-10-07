/**
 * Пароли ведущих: scrypt из встроенного node:crypto — без сторонних пакетов и нативных модулей.
 * Формат хэша: `scrypt$<log2 N>$<r>$<p>$<соль base64>$<хэш base64>` — параметры хранятся рядом,
 * поэтому их можно усилить позже, а старые хэши продолжат проверяться.
 *
 * N = 2^15, r = 8: ~32 МБ памяти и ~0,1 с на проверку — перебор дорогой, а сервер с 2 ГБ памяти
 * выдерживает: попытки входа ограничены (auth.ts, 10 за 15 минут на адрес и почту), а одновременно
 * считается не больше SCRYPT_PARALLEL хэшей — остальные ждут в очереди (пиковая память ~64 МБ
 * при лимите контейнера 384 МБ, даже если весь зал разом нажмёт «Войти»).
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";

const LOG_N = 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/** Сколько хэшей scrypt считается одновременно; остальные ждут по очереди. */
export const SCRYPT_PARALLEL = 2;

/** Очередь «не больше N задач одновременно» (FIFO). `peak` — для тестов. */
export class Slots {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly max: number;
  peak = 0;

  constructor(max: number) {
    this.max = max;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active += 1;
    this.peak = Math.max(this.peak, this.active);
    try {
      return await task();
    } finally {
      // Место передаётся следующему в очереди, счётчик не проседает.
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    }
  }

  get queued(): number {
    return this.waiting.length;
  }
}

export const scryptSlots = new Slots(SCRYPT_PARALLEL);

function scrypt(password: string, salt: Buffer, logN: number, r: number, p: number): Promise<Buffer> {
  return scryptSlots.run(() => scryptNow(password, salt, logN, r, p));
}

function scryptNow(password: string, salt: Buffer, logN: number, r: number, p: number): Promise<Buffer> {
  const N = 2 ** logN;
  // Память: 128 · N · r байт; запас вдвое, иначе node отказывает.
  const options: ScryptOptions = { N, r, p, maxmem: 256 * N * r };
  return new Promise((resolve, reject) => {
    scryptCallback(password.normalize("NFC"), salt, KEY_LENGTH, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scrypt(password, salt, LOG_N, R, P);
  return ["scrypt", LOG_N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

const FORMAT = /^scrypt\$(\d{1,2})\$(\d{1,2})\$(\d{1,2})\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/;

/** true — пароль подходит. Испорченный или пустой хэш — false, без исключения. */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const match = stored ? FORMAT.exec(stored) : null;
  if (!match) {
    // Время ответа не должно выдавать, что аккаунта или пароля нет.
    await scrypt(password, Buffer.alloc(SALT_LENGTH), LOG_N, R, P);
    return false;
  }
  const [, logN, r, p, salt, hash] = match;
  const expected = Buffer.from(hash, "base64");
  if (Number(logN) < 10 || Number(logN) > 20 || expected.length !== KEY_LENGTH) return false;
  const key = await scrypt(password, Buffer.from(salt, "base64"), Number(logN), Number(r), Number(p));
  return timingSafeEqual(key, expected);
}
