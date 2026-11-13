/**
 * Нажатия дождя, ремонта и салюта: копим и шлём пачкой раз в 0,3 с одним событием `{ t, n }`. `beforeMs` — сколько мс
 * назад было первое нажатие пачки (`ago` на сервере): последние доли секунды события не теряются (аудит 2b, №14).
 */
export type TapKind = "tap" | "salute";

export interface TapSend {
  event: { t: TapKind; n: number };
  beforeMs: number;
}

export class TapBatch {
  private kind: TapKind = "tap";
  private n = 0;
  private first = 0;

  /** Нажатие. Сменился вид — прежняя пачка уходит сразу (возвращается). */
  tap(kind: TapKind, now: number): TapSend | null {
    const out = this.kind !== kind ? this.flush(now) : null;
    if (this.n === 0) this.first = now;
    this.kind = kind;
    this.n += 1;
    return out;
  }

  /** Накопленное — к отправке (или null, если нажатий не было). */
  flush(now: number): TapSend | null {
    if (this.n === 0) return null;
    const out: TapSend = { event: { t: this.kind, n: this.n }, beforeMs: Math.max(0, now - this.first) };
    this.n = 0;
    return out;
  }
}
