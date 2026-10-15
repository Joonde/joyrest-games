// Предпросмотр «Шпиона»: те же функции пульта, что в игре (раздача, обсуждение, голосование, последний шанс,
// итог). Тайну партии пульт выбирает так же (`dealSecret`), но с постоянным жребием — сцены не меняются от
// открытия к открытию. Карты в настоящей игре шифруются ключами телефонов (WebCrypto, асинхронно) — предпросмотр
// синхронный, поэтому карты на телефонах здесь не открываются: виден весь открытый ход игры.
import type { PreviewDriver } from "../preview";
import type { SpyContent } from "./content";
import { dealSecret, dealt, openAccused, parseSpyResult, resolveLast, spyPrimary, startDeal, startTalk, startVote, verdict, type SpyResult, type SpySecret } from "./logic";

/** Постоянный жребий (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ключ тестового телефона: base64 от 32 байт, как у настоящего. */
const keyOf = (pid: string) => btoa(`preview:${pid}`.padEnd(32, "#").slice(0, 32));

function secretOf(r: SpyResult, content: SpyContent): SpySecret {
  return dealSecret(r.seats, content, r.used, seeded(104729 * r.party + r.seats.length));
}

export const spyPreview: PreviewDriver<SpyContent> = ({ session, content, participants, answers }) => {
  const r = parseSpyResult(session.state.result);
  const begun = session.state.result !== null && session.state.result !== undefined;
  const secret = begun ? secretOf(r, content) : null;
  const name = (p: string | null) => (p ? (session.leaderboard[p]?.name ?? "игрок") : "никто");
  const action = begun ? spyPrimary(session, content.parties) : "deal";
  const now = Date.now();
  switch (action) {
    case "deal":
      return { label: "Пульт: «Собрать телефоны» — игроки садятся за стол по номерам", change: startDeal(session, participants) };
    case "dealt":
      if (answers.length === 0) return { label: "Телефоны прислали свои ключи", answers: r.seats.map((pid) => ({ pid, value: { key: keyOf(pid) } })) };
      return { label: "Пульт: «Раздать карты» — у всех локация и роль, у шпиона — «Вы — шпион»", change: dealt(session, {}, null) };
    case "talk":
      return { label: "Пульт: «Начать обсуждение» — таймер на экране, первый вопрос по жребию", change: startTalk(session, content, now, seeded(7)) };
    case "vote":
      return { label: "Пульт: «Голосование» — тайно на телефонах", change: startVote(session, content, now) };
    case "verdict": {
      if (!secret) return null;
      if (answers.length === 0) {
        // Город вычисляет шпиона: все голосуют за первого шпиона, шпион — за соседа.
        const spy = secret.spies[0] ?? r.seats[0] ?? "";
        const other = r.seats.find((p) => p !== spy) ?? "";
        return { label: "Телефоны голосуют тайно", answers: r.seats.map((pid) => ({ pid, value: { vote: pid === spy ? other : spy } })) };
      }
      const change = verdict(session, answers);
      const accused = parseSpyResult(change.state?.result).accused;
      return { label: accused ? `Пульт: «Подсчитать голоса» — город обвиняет ${name(accused)}` : "Пульт: «Подсчитать голоса» — не договорились", change };
    }
    case "open":
      return secret ? { label: "Пульт: «Открыть карту обвиняемого» — это шпион! Последний шанс", change: openAccused(session, content, secret) } : null;
    case "lastCheck": {
      if (!secret || !r.accused) return null;
      // Шпион ошибается: называет не ту локацию.
      const wrong = content.locations.findIndex((l, i) => i !== secret.location && l.name.trim() !== "");
      if (answers.length === 0) return { label: "Шпион называет локацию на телефоне", answers: [{ pid: r.accused, value: { guess: wrong } }] };
      return { label: "Пульт: «Проверить ответ шпиона» — не угадал, победил город", change: resolveLast(session, content, secret, wrong) };
    }
    // Следующие партии — так же; предпросмотр показывает одну и сразу награждение.
    default:
      return null;
  }
};
