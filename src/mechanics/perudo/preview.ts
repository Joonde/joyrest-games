// Предпросмотр «Перудо»: те же функции пульта (`startDeal`, `startRound`, `placeBid`, `resolveCall`), ключи
// стаканов у тестовых телефонов придуманы заранее — пульт-судья знает кости всех, как в настоящей игре.
import type { Session, SessionChange } from "../../data/types";
import type { PreviewDriver } from "../preview";
import type { PerudoContent } from "./content";
import { diceOf, keyPrint } from "./dice";
import { aliveCups, countFace, minQty, parsePerudoResult, perudoPrimary, placeBid, resolveCall, startDeal, startRound, totalDice, type Bid } from "./logic";
import { bidText } from "./text";

/** Ключ стакана тестового телефона (настоящий телефон создаёт свой случайный). */
const keyOf = (pid: string) => `preview-cup-${pid}-0123456789`;

/** Кости всех стаканов раунда — пульт видит все. */
function allDice(r: ReturnType<typeof parsePerudoResult>): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const p of aliveCups(r)) out[p] = diceOf(keyOf(p), r.nonce, r.dice[p] ?? 0);
  return out;
}

/** Первая ставка: самая частая своя грань (не единицы), на одну больше, чем у себя. */
function openingBid(own: number[], palifico: boolean, total: number): Bid {
  let best = 2;
  let bestN = -1;
  for (let f = 2; f <= 6; f++) {
    const n = own.filter((d) => d === f || (!palifico && d === 1)).length;
    if (n > bestN) {
      best = f;
      bestN = n;
    }
  }
  return { q: Math.min(total, Math.max(1, bestN + 1)), f: best };
}

/** «: кость теряет …» по итогу вскрытия. */
function outcome(session: Session, change: SessionChange | null): string {
  const call = change?.state?.result ? parsePerudoResult(change.state.result).call : null;
  const name = (p: string) => session.leaderboard[p]?.name ?? "игрок";
  if (!call) return "";
  if (call.out) return `, ${name(call.out)} выбывает`;
  if (call.loser) return `, кость теряет ${name(call.loser)}`;
  if (call.gainer) return `, ${name(call.gainer)} возвращает кость`;
  return ", без потерь";
}

export const perudoPreview: PreviewDriver<PerudoContent> = ({ session, content, participants, answers }) => {
  const r = parsePerudoResult(session.state.result);
  switch (perudoPrimary(session, content)) {
    case "deal":
      return { label: "Пульт: «Собрать стаканы» — игроки садятся за стол", change: startDeal(session, participants, content) };
    case "roll": {
      // Сначала телефоны присылают ключи (телефон запоминает свой — потом видит свои кости), потом бросок.
      if (answers.length === 0) return { label: "Телефоны прислали ключи стаканов", answers: r.seats.map((pid) => ({ pid, value: { key: keyOf(pid) } })) };
      const prints: Record<string, string> = {};
      for (const p of r.seats) prints[p] = keyPrint(keyOf(p));
      return { label: "Пульт: «Бросить кости» — свои кости каждый видит на телефоне", change: startRound(session, `preview-${r.party}-${r.round + 1}`, prints) };
    }
    case "nextRound": {
      const prints: Record<string, string> = {};
      for (const p of r.seats) prints[p] = keyPrint(keyOf(p));
      return { label: `Пульт: «Следующий раунд»${r.palificoNext ? " — Палифико" : ""}`, change: startRound(session, `preview-${r.party}-${r.round + 1}`, prints) };
    }
    case "wait": {
      const who = r.turn;
      if (!who) return null;
      const dice = allDice(r);
      const total = totalDice(r);
      const n = String(r.seq);
      const name = session.leaderboard[who]?.name ?? "Игрок";
      if (!r.bid) {
        const bid = openingBid(dice[who] ?? [], r.palifico, total);
        const change = placeBid(session, who, bid);
        return change ? { label: `${name}: ставка «${bidText(bid)}»`, answers: [{ pid: who, value: { n, bid } }], change } : null;
      }
      const count = countFace(dice, r.bid.f, r.palifico);
      // Партия в предпросмотре короткая: в первых раундах ставку поднимают, дальше сразу «Не верю!».
      // «Ровно!» — один раз (во втором раунде), если на столе точно столько.
      if (content.calza && r.round === 2 && count === r.bid.q) {
        const change = resolveCall(session, content, "calza", dice);
        return { label: `${name}: «Ровно!» — вскрытие${outcome(session, change)}`, answers: [{ pid: who, value: { n, calza: true } }], change };
      }
      const raise: Bid = { q: r.bid.q + 1, f: r.bid.f };
      const m = minQty(r.bid, raise.f, r.palifico);
      const raised = count < r.bid.q || r.history.length >= (r.round <= 2 ? 2 : 1) || m === null || raise.q > total ? null : placeBid(session, who, raise);
      if (raised) return { label: `${name}: выше — «${bidText(raise)}»`, answers: [{ pid: who, value: { n, bid: raise } }], change: raised };
      const change = resolveCall(session, content, "dudo", dice);
      return { label: `${name}: «Не верю!» — вскрытие${outcome(session, change)}`, answers: [{ pid: who, value: { n, dudo: true } }], change };
    }
    // Следующие партии — так же; предпросмотр показывает одну и сразу награждение.
    default:
      return null;
  }
};
