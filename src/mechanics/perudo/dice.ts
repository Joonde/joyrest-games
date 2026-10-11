// Тайные кости без отдельного канала (как карты в «Мафии» и «Дураке»): на раздаче телефон создаёт свой
// ключ и отправляет его ответом — ответы видит только пульт. Кости раунда = хэш(ключ, число раунда, номер
// кости): число раунда (`nonce`) пульт ставит при броске, поэтому заранее подобрать удачный ключ нельзя.
// Свои кости видит только свой телефон (ключ у него) и пульт (видит все ключи).

/** FNV-1a с перемешиванием — равномерно на 1…6, без криптографии (это игра в зале, не банк). */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Кости стакана: `count` значений 1…6. */
export function diceOf(key: string, nonce: string, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push((hash(`${key}|${nonce}|${i}`) % 6) + 1);
  return out;
}

/** Ключ стакана без телефона: от ключа ведущего (он только на устройстве пульта). */
export function hostCupKey(host: string, pid: string): string {
  return `${host}:${pid}`;
}

/** Новое случайное число раунда. */
export function newNonce(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(9));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const STORE = "joyrest.perudo";

export function storedCupKey(sessionId: string, pid: string): string | null {
  try {
    return localStorage.getItem(`${STORE}.${sessionId}.${pid}`);
  } catch {
    return null;
  }
}

export function storeCupKey(sessionId: string, pid: string, key: string): void {
  try {
    localStorage.setItem(`${STORE}.${sessionId}.${pid}`, key);
  } catch {
    // Нет хранилища — кости покажет ведущий.
  }
}
