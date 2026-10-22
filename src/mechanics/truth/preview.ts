import type { PreviewDriver } from "../preview";
import type { TruthContent, TruthKind } from "./content";
import { choiceOf, choose, chooseFromAnswers, handleSuggestion, nextPid, nextTurn, parseTruthResult, pendingSuggestions, resolve, startTruth, suggestionOf, truthPrimary, turnPid } from "./logic";

/** Сколько ходов показать. */
const TURNS = 6;
const KIND: Record<TruthKind, string> = { truth: "Правда", dare: "Действие" };
const GUEST_DARE = "Изобразите жениха, который впервые видит свадебный торт";

export const truthPreview: PreviewDriver<TruthContent> = ({ session, content, participants, answers }) => {
  const r = parseTruthResult(session.state.result);
  const who = turnPid(r);
  const name = (pid: string | null) => (pid ? (session.leaderboard[pid]?.name ?? "игрок") : "игрок");
  // Телефон гостя: в командах — по названию его команды.
  const phoneName = (id: string) => {
    const p = participants.find((x) => x.id === id);
    return p?.teamId ? `Гость из команды ${name(p.teamId)}` : name(id);
  };
  // Случайность колоды — от номера хода: предпросмотр каждый раз одинаковый.
  const random = () => ((r.turn * 0.37 + 0.11) % 1);
  switch (truthPrimary(session, content)) {
    case "start":
      return { label: "Пульт: «Начать игру»", change: startTruth(session, participants) };
    case "waitChoice": {
      if (!who || r.turn >= TURNS) return null;
      const kind: TruthKind = r.turn % 2 === 0 ? "truth" : "dare";
      const chosen = answers.find((a) => a.pid === who && choiceOf(a.value));
      if (!chosen) return { label: `${name(who)}: касается половины «${KIND[kind]}»`, answers: [{ pid: who, value: { choice: kind } }] };
      const change = chooseFromAnswers(session, content, answers, random) ?? choose(session, content, kind, random);
      const card = parseTruthResult(change.state?.result).card;
      return { label: card?.from ? `На экране — задание гостя (${name(participants.find((x) => x.id === card.from)?.teamId ?? card.from)})` : `На экране — карточка «${KIND[kind]}»`, change };
    }
    case "resolve": {
      // Пока идёт первый ход, другой гость присылает своё задание, ведущий берёт его в колоду.
      if (content.guestCards && r.turn === 0 && !answers.some((a) => suggestionOf(a.value))) {
        // Присылает тот, кто ходит не следующим: его задание выпадет другому.
        const following = nextPid(r);
        const phones = participants.filter((p) => p.kind === "player" && (p.teamId ?? p.id) !== who);
        const phone = phones.find((p) => (p.teamId ?? p.id) !== following) ?? phones.at(0);
        if (phone) return { label: `${phoneName(phone.id)} присылает своё задание`, answers: [{ pid: phone.id, value: { suggest: { kind: "dare", text: GUEST_DARE } } }] };
      }
      const pending = pendingSuggestions(r, answers, session.state.step).at(0);
      if (pending) return { label: "Пульт: «В колоду» — задание гостя выпадет следующим", change: handleSuggestion(session, pending, true) };
      const refused = r.turn === 2;
      const points = r.choice === "dare" ? content.darePoints : content.truthPoints;
      return {
        label: refused ? `Пульт: «Отказ»${content.refusePenalty > 0 ? ` — −${content.refusePenalty}` : " — фант"}` : `Пульт: «Выполнено» — +${points}`,
        change: resolve(session, content, refused ? "refused" : "done"),
      };
    }
    case "next":
      return { label: "Пульт: «Следующий»", change: nextTurn(session, participants) };
    default:
      return null;
  }
};
