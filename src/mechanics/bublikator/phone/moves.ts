/**
 * Движения приборов не чаще, чем принимает комната (`MOVES_PER_SECOND`, «ведро» на 5 с пополнением 5 в секунду): лишнее
 * сервер молча отбросил бы, и прибор на экране «отскочил» бы назад. Телефон сам придерживает лишние движения и шлёт
 * последнее положение каждого прибора, как только можно (аудит 2b, №14).
 */
import { MOVES_PER_SECOND } from "../rules/constants";

export class MoveGate {
  private tokens = MOVES_PER_SECOND;
  private at: number | null = null;
  /** Ждут своей очереди: прибор → последнее положение (порядок — по первому ожиданию). */
  readonly pending = new Map<string, number>();

  private refill(now: number): void {
    if (this.at !== null && now > this.at) this.tokens = Math.min(MOVES_PER_SECOND, this.tokens + ((now - this.at) / 1000) * MOVES_PER_SECOND);
    this.at = this.at === null ? now : Math.max(this.at, now);
  }

  /** Движение прибора: true — слать сейчас; false — придержано (уйдёт из `release`). */
  move(now: number, control: string, state: number): boolean {
    this.refill(now);
    if (this.pending.size === 0 && this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    // Уже ждёт — новое положение заменяет прежнее (сервер всё равно возьмёт последнее).
    this.pending.delete(control);
    this.pending.set(control, state);
    return false;
  }

  /** Что можно отправить сейчас из придержанного (по порядку). */
  release(now: number): Array<[string, number]> {
    this.refill(now);
    const out: Array<[string, number]> = [];
    for (const [control, state] of this.pending) {
      if (this.tokens < 1) break;
      this.tokens -= 1;
      out.push([control, state]);
      this.pending.delete(control);
    }
    return out;
  }

  /** Через сколько мс освободится следующее место (0 — уже). */
  waitMs(now: number): number {
    this.refill(now);
    return this.tokens >= 1 ? 0 : Math.ceil(((1 - this.tokens) / MOVES_PER_SECOND) * 1000);
  }
}
