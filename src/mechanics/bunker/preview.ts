// Предпросмотр «Бункера»: те же функции пульта, что в игре (раздача, раунды с картами бункера, круг
// открытия, обсуждение, голосование, финал с угрозами). Персонажей тестовых игроков пульт раздаёт так же
// (`dealSecrets`), но с постоянным жребием — сцены не меняются от открытия к открытию. В настоящей игре
// персонаж каждого шифруется ключом его телефона (WebCrypto, асинхронно) — предпросмотр синхронный, поэтому
// своя карта на телефоне здесь не открывается; открытые карты на экране зала видны, как в игре.
// Особые условия в предпросмотре не играют.
import type { PreviewDriver } from "../preview";
import type { BunkerContent } from "./content";
import { CAT_TITLES } from "./decks";
import {
  answerOf,
  bunkerPrimary,
  countVotes,
  dealSecrets,
  dealt,
  finishBunker,
  judgeThreat,
  nextSpeaker,
  nextThreat,
  openCard,
  openable,
  parseBunkerResult,
  speakOnly,
  startDeal,
  startDiscuss,
  startFinal,
  startOpening,
  startRound,
  startVote,
  turnDone,
  type BunkerResult,
} from "./logic";

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

const secretsOf = (r: BunkerResult, content: BunkerContent) => dealSecrets(r.seats, content, seeded(104729 * r.party + r.seats.length));

export const bunkerPreview: PreviewDriver<BunkerContent> = ({ session, content, participants, answers }) => {
  const r = parseBunkerResult(session.state.result);
  const started = session.state.result !== null && session.state.result !== undefined;
  const secrets = started ? secretsOf(r, content) : null;
  const name = (p: string | null) => (p ? (session.leaderboard[p]?.name ?? "игрок") : "никто");
  const now = Date.now();
  const action = bunkerPrimary(session, content);
  if (action !== "deal" && !secrets) return null;
  switch (action) {
    case "deal":
      return { label: "Пульт: «Собрать телефоны» — игроки садятся за стол", change: startDeal(session, participants) };
    case "dealt":
      if (answers.length === 0) return { label: "Телефоны прислали свои ключи", answers: r.seats.map((pid) => ({ pid, value: { key: keyOf(pid) } })) };
      // Карты персонажей шифруются асинхронно — в предпросмотре их нет, персонажей знает только пульт.
      return { label: "Пульт: «Раздать карты» — катастрофа на экране, у каждого свой персонаж", change: dealt(session, content, {}, "", seeded(31 * r.party + 7)) };
    case "round":
      return secrets ? { label: `Пульт: «Раунд ${r.round + 1}» — открывается карта бункера`, change: startRound(session, content, secrets) } : null;
    case "opening":
      return { label: "Пульт: «Круг открытия карт»", change: startOpening(session) };
    case "nextSpeaker":
    case "discuss": {
      const speaker = r.speaker;
      if (speaker && !turnDone(r) && secrets) {
        const cats = openable(r, speaker);
        const cat = cats[(r.round + r.turn) % Math.max(1, cats.length)];
        if (!cat) return { label: `${name(speaker)} говорит (открывать нечего)`, change: speakOnly(session, content, now) };
        return {
          label: `${name(speaker)} открывает карту «${CAT_TITLES[cat]}» и говорит`,
          answers: [{ pid: speaker, value: { open: cat } }],
          change: openCard(session, content, speaker, cat, secrets.chars, now),
        };
      }
      if (action === "nextSpeaker") return { label: "Пульт: «Следующий игрок»", change: nextSpeaker(session) };
      return { label: "Пульт: «Обсуждение» — общий таймер", change: startDiscuss(session, content, now) };
    }
    case "vote":
    case "moreVote":
      return { label: "Пульт: «Голосование» — тайно на телефонах", change: startVote(session, content, now) };
    case "revote":
      return { label: "Пульт: «Переголосовать» — только между равными", change: startVote(session, content, now, r.candidates) };
    case "count": {
      if (!secrets) return null;
      // Все голосуют против последнего в списке, он — против первого: изгнание без ничьей.
      const target = r.candidates.at(-1) ?? null;
      const list = r.alive.map((pid) => ({ pid, value: { vote: pid === target ? (r.candidates.find((c) => c !== pid) ?? pid) : (target ?? pid) } }));
      const votes: Record<string, string> = {};
      for (const a of list) {
        const v = answerOf(a.value).vote;
        if (v) votes[a.pid] = v;
      }
      const change = countVotes(session, content, votes, secrets.chars, seeded(r.round + 11));
      const out = parseBunkerResult(change.state?.result).tally?.out ?? null;
      return { label: out ? `Телефоны проголосовали. Пульт: «Подсчитать голоса» — изгнан ${name(out)}` : "Телефоны проголосовали. Пульт: «Подсчитать голоса»", answers: list, change };
    }
    case "final":
      return secrets ? { label: "Пульт: «Финал: кто в бункере» — открываются все карты спасшихся", change: startFinal(session, content, secrets) } : null;
    case "threat":
      return secrets ? { label: `Пульт: «Открыть угрозу ${r.threatsShown.length + 1} из ${content.threats}»`, change: nextThreat(session, secrets) } : null;
    case "judge":
      return { label: "Ведущий решает: спасшиеся справились с угрозой", change: judgeThreat(session, true) };
    case "outcome":
    {
      if (!secrets) return null;
      const change = finishBunker(session, content, secrets.chars);
      const won = parseBunkerResult(change.state?.result).outcome?.won === true;
      return { label: won ? "Пульт: «Итог игры» — бункер выжил, спасшимся очки" : "Пульт: «Итог игры» — бункер не выжил", change };
    }
    // Следующие партии — так же; предпросмотр показывает одну и сразу награждение.
    default:
      return null;
  }
};
