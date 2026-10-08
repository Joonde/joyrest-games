// Тайные роли без отдельного канала: телефон сам создаёт ключ (AES-GCM, 256 бит) и отправляет его
// ответом на шаге раздачи — ответы видит только пульт ведущего. Пульт шифрует роль (и ночные
// подсказки) этим ключом и кладёт в общее состояние игры: его видят все, но открыть может только
// телефон с ключом. Ключ хранится на телефоне (localStorage) и в ответе на сервере.

const ALGO = "AES-GCM";

function cryptoApi(): Crypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("no-crypto");
  return c;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Новый ключ телефона (base64, 32 байта). */
export function newKey(): string {
  return toBase64(cryptoApi().getRandomValues(new Uint8Array(32)));
}

export function isKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 40 || value.length > 60) return false;
  try {
    return fromBase64(value).length === 32;
  } catch {
    return false;
  }
}

async function importKey(key: string): Promise<CryptoKey> {
  return cryptoApi().subtle.importKey("raw", fromBase64(key) as BufferSource, ALGO, false, ["encrypt", "decrypt"]);
}

/** Зашифровать данные ключом телефона: base64(iv + шифр). */
export async function seal(key: string, data: unknown): Promise<string> {
  const iv = cryptoApi().getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(data));
  const cipher = new Uint8Array(await cryptoApi().subtle.encrypt({ name: ALGO, iv }, await importKey(key), plain));
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv, 0);
  out.set(cipher, iv.length);
  return toBase64(out);
}

/** Открыть данные своим ключом; чужой ключ или испорченный текст — null. */
export async function unseal(key: string, sealed: unknown): Promise<unknown> {
  if (typeof sealed !== "string" || !isKey(key)) return null;
  try {
    const bytes = fromBase64(sealed);
    if (bytes.length < 13) return null;
    const plain = await cryptoApi().subtle.decrypt({ name: ALGO, iv: bytes.slice(0, 12) }, await importKey(key), bytes.slice(12));
    return JSON.parse(new TextDecoder().decode(plain)) as unknown;
  } catch {
    return null;
  }
}

/** Ключ телефона для этой игры (на устройстве). */
export function storedKey(sessionId: string, pid: string): string | null {
  try {
    const v = localStorage.getItem(`joyrest.mafia.${sessionId}.${pid}`);
    return isKey(v) ? v : null;
  } catch {
    return null;
  }
}

export function storeKey(sessionId: string, pid: string, key: string): void {
  try {
    localStorage.setItem(`joyrest.mafia.${sessionId}.${pid}`, key);
  } catch {
    // Нет хранилища (приватный режим) — роль покажет ведущий.
  }
}
