// Предпросмотр «Мафии»: те же функции пульта, что в игре (раздача, день, голосование, ночь, утро, итог).
// Роли тестовых игроков пульт раздаёт так же (`dealRoles`), но с постоянным жребием — сцены не меняются от
// открытия к открытию. Карты ролей и ночные подсказки в настоящей игре шифруются ключами телефонов
// (WebCrypto, асинхронно) — предпросмотр синхронный, поэтому тайные карты на телефонах здесь не открываются:
// виден весь открытый ход игры (экран зала, кто выбыл, голоса, итог с ролями).
import type { PreviewDriver } from "../preview";
import { countsFor, type MafiaContent, type RoleId } from "./content";
import { dealRoles, isMafia, mafiaPrimary, morning, nightChoices, nightSync, parseMafiaResult, resolveNight, startDay, startDeal, startMeet, startNight, startVote, verdict, voteCandidates, dealt, finishGame, giveWord, type MafiaResult } from "./logic";

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

function rolesOf(r: MafiaResult, content: MafiaContent): Record<string, RoleId> {
  return dealRoles(r.seats, countsFor(content, r.seats.length), seeded(7919 * r.party + r.seats.length));
}

const firstWith = (alive: string[], roles: Record<string, RoleId>, role: RoleId) => alive.find((p) => roles[p] === role) ?? null;

/** На кого охотится мафия: на Комиссара, пока он жив, потом на любого мирного. */
function victimOf(alive: string[], roles: Record<string, RoleId>): string | null {
  return firstWith(alive, roles, "commissar") ?? alive.find((p) => !isMafia(roles[p])) ?? null;
}

/** Кого лечит Доктор: в первую ночь угадывает жертву (Комиссара), во вторую — себя, дальше не лечит. */
function healOf(night: number, seats: string[], roles: Record<string, RoleId>): string | null {
  if (night === 1) return seats.find((p) => roles[p] === "commissar") ?? null;
  if (night === 2) return seats.find((p) => roles[p] === "doctor") ?? null;
  return null;
}

export const mafiaPreview: PreviewDriver<MafiaContent> = ({ session, content, participants, answers }) => {
  const r = parseMafiaResult(session.state.result);
  const started = session.state.result !== null && session.state.result !== undefined;
  const roles = started ? rolesOf(r, content) : {};
  const name = (p: string | null) => (p ? (session.leaderboard[p]?.name ?? "игрок") : "никто");
  const action = started ? mafiaPrimary(session, content.parties) : "deal";
  switch (action) {
    case "deal":
      return { label: "Пульт: «Собрать телефоны» — игроки садятся за стол по номерам", change: startDeal(session, participants) };
    case "dealt":
      if (answers.length === 0) return { label: "Телефоны прислали свои ключи", answers: r.seats.map((pid) => ({ pid, value: { key: keyOf(pid) } })) };
      // Карты ролей шифруются асинхронно — в предпросмотре их нет, роли знает только пульт.
      return { label: "Пульт: «Раздать роли» — у каждого тайная карта на телефоне", change: dealt(session, {}, null) };
    case "meet":
      return { label: "Пульт: «Ночь знакомства» — мафия видит свою семью, город спит", change: startMeet(session) };
    case "day":
      return { label: r.mode === "morning" ? `Пульт: «Наступает день» — день ${r.round + 1}` : "Пульт: «Наступает день» — день 1", change: startDay(session) };
    case "vote": {
      // В первый день — слово первому игроку, потом голосование.
      if (r.round === 1 && r.speaker === null && r.speakEndsAt === null) {
        const first = r.alive[0] ?? null;
        return { label: `Пульт: «Слово» — говорит ${name(first)}`, change: giveWord(session, first, content.speechSeconds, Date.now()) };
      }
      return { label: "Пульт: «Голосование» — тайно на телефонах", change: startVote(session, content, voteCandidates(r)) };
    }
    case "verdict": {
      if (answers.length === 0) {
        // Город в первый день ошибается (выгоняет мирного), дальше — находит мафию (Комиссар проверил).
        const civilians = r.alive.filter((p) => roles[p] === "civilian");
        const family = r.alive.filter((p) => isMafia(roles[p]));
        const suspect = (r.round === 1 ? civilians[0] : family[0]) ?? r.alive[0] ?? null;
        const city = r.alive.find((p) => !isMafia(roles[p]) && p !== suspect) ?? null;
        const list = r.alive
          .map((pid) => {
            const vote = pid === suspect ? (family[0] ?? city) : isMafia(roles[pid]) && r.round > 1 ? city : suspect;
            return vote && vote !== pid ? { pid, value: { vote } } : { pid, value: { vote: "none" } };
          });
        return { label: "Телефоны голосуют тайно", answers: list };
      }
      const change = verdict(session, content, answers, roles);
      const out = parseMafiaResult(change.state?.result).out;
      return { label: out ? `Пульт: «Подсчитать голоса» — город выгоняет ${name(out)}` : "Пульт: «Подсчитать голоса» — никого не выгнали", change };
    }
    case "revote":
      return { label: "Пульт: «Переголосовать»", change: startVote(session, content, r.nominees, true) };
    case "night":
      return { label: "Пульт: «Наступает ночь» — город засыпает", change: startNight(session) };
    case "morning": {
      const night = r.nights.length;
      if (answers.length === 0) {
        const victim = victimOf(r.alive, roles);
        const heal = healOf(night, r.seats, roles);
        const commissar = firstWith(r.alive, roles, "commissar");
        const suspect = r.alive.find((p) => isMafia(roles[p])) ?? null;
        const list = r.alive.map((pid) => {
          const role = roles[pid];
          if (role === "don") return { pid, value: { target: victim ?? "", ...(commissar ? { check: commissar } : {}) } };
          if (role === "mafia") return { pid, value: { target: victim ?? "" } };
          if (role === "doctor") return { pid, value: heal && r.alive.includes(heal) ? { target: heal } : {} };
          if (role === "commissar") return { pid, value: { target: suspect ?? "" } };
          // Мирные нажимают для вида — со стороны никто не поймёт, кто действовал.
          return { pid, value: { target: r.alive.find((p) => p !== pid) ?? "" } };
        });
        return { label: "Ночь: все нажимают на телефонах — мафия выбирает, у ролей свои ходы, мирные — для вида", answers: list, change: nightSync(session, {}, list.length) };
      }
      const { choices, donCheck } = nightChoices(answers, r.alive);
      const doctor = firstWith(r.alive, roles, "doctor");
      const don = firstWith(r.alive, roles, "don");
      const history: Array<string | null> = [];
      for (let k = 1; k < night; k++) history.push(doctor ? healOf(k, r.seats, roles) : null);
      const outcome = resolveNight(roles, r.alive, choices, history, don ? (donCheck[don] ?? null) : null);
      return {
        label: outcome.victim ? `Пульт: «Наступает утро» — ночью убит ${name(outcome.victim)}` : "Пульт: «Наступает утро» — тихая ночь: Доктор спас",
        change: morning(session, content, outcome, roles),
      };
    }
    case "finish": {
      if (!r.winner) return null;
      return { label: r.winner === "city" ? "Пульт: «Открыть роли» — победил город" : "Пульт: «Открыть роли» — победила мафия", change: finishGame(session, content, roles, r.winner) };
    }
    // Следующие партии — так же; предпросмотр показывает одну и сразу награждение.
    default:
      return null;
  }
};
