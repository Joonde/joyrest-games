// Тайные кости без отдельного канала (как карты в «Мафии» и «Дураке»): на раздаче телефон создаёт свой
// ключ и отправляет его ответом — ответы видит только пульт. Кости раунда = хэш(ключ, число раунда, номер
// кости): число раунда (`nonce`) пульт ставит при броске, поэтому заранее подобрать удачный ключ нельзя.
// Свои кости видит только свой телефон (ключ у него) и пульт (видит все ключи).

/**
 * cyrb128 — 128 бит состояния: по открытым на вскрытиях костям ключ перебором не подобрать (32 бит хватало бы на
 * минуты). Не криптография банка, но для игры в зале достаточно.
 */
function cyrb128(text: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** Кости стакана: `count` значений 1…6 (без перекоса: значения ≥ 2³²−4 отбрасываются). */
export function diceOf(key: string, nonce: string, count: number): number[] {
  // sfc32 от 128-битного состояния: последовательность костей стакана на раунд.
  let [a, b, c, d] = cyrb128(`${key}|${nonce}`);
  const next = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < 12; i++) next();
  const out: number[] = [];
  while (out.length < count) {
    const v = next();
    if (v >= 4294967292) continue;
    out.push((v % 6) + 1);
  }
  return out;
}

/** Короткий отпечаток ключа: пульт отмечает, с каким ключом бросил кости (сам ключ в нём не виден). */
export function keyPrint(key: string): string {
  return cyrb128(`print|${key}`)[0].toString(16);
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
