import type { PreviewDriver } from "../preview";
import { tileOf, type StageContent } from "./content";
import { battlesLocked, countVotes, finishPerform, hypeText, liveGifts, liveVotes, nextTurn, parseStageResult, pickTile, stagePrimary, startGame, startVote, turnPid } from "./logic";

/** Сколько плиток показать: все команды выступают по разу, батл и ещё одно выступление. */
const PLAYED = 5;

export const stagePreview: PreviewDriver<StageContent> = ({ session, content, participants, answers }) => {
  const r = parseStageResult(session.state.result);
  const name = (pid: string | null) => (pid ? (session.leaderboard[pid]?.name ?? "команда") : "команда");
  // Телефоны: игроки (каждый сам) или телефоны капитанов команд; сторона — команда телефона.
  const phones = participants.filter((p) => p.kind === "player").map((p) => ({ id: p.id, side: p.teamId ?? p.id }));
  const catTitle = (id: string) => content.categories.find((c) => c.id === id)?.title ?? "";
  switch (stagePrimary(session, content)) {
    case "start":
      return { label: "Пульт: «Начать игру»", change: startGame(session, participants) };
    case "pickTile": {
      const battlePlayed = content.tiles.some((t) => t.kind === "battle" && r.played.includes(t.id));
      if (r.played.length >= PLAYED) return null;
      const regular = content.tiles.filter((t) => t.kind !== "battle" && !r.played.includes(t.id));
      const battle = content.tiles.find((t) => t.kind === "battle" && !r.played.includes(t.id));
      // Батлы закрыты, пока не выступили все, — сначала обычные плитки из разных категорий.
      const useBattle = !battlePlayed && battle !== undefined && !battlesLocked(content, r) && r.order.length >= 2;
      const cat = content.categories[r.played.length % Math.max(1, content.categories.length)]?.id;
      const tile = useBattle ? battle : (regular.find((t) => t.cat === cat) ?? regular.at(0) ?? battle);
      if (!tile) return null;
      const who = turnPid(r);
      const change = pickTile(session, content, tile.id, participants);
      const next = parseStageResult(change.state?.result);
      const label =
        tile.kind === "battle"
          ? `Батл «${catTitle(tile.cat)} за ${tile.points}»: ${name(next.performer)} против ${name(next.opponent)}`
          : `${name(who)}: «${catTitle(tile.cat)} за ${tile.points}» — плитка переворачивается`;
      return { label, change };
    }
    case "done": {
      const givers = phones.filter((p) => p.side !== r.performer);
      if (answers.length === 0 && givers.length > 0 && content.gift > 0) {
        // Первому выступлению дарит одна команда, дальше — все зрители.
        const list = r.played.length === 0 ? givers.slice(0, 1) : givers;
        return { label: `Зрители дарят симпатию: +${content.gift} выступающим`, answers: list.map((p) => ({ pid: p.id, value: { gift: true } })) };
      }
      const gifts = liveGifts(session, answers, participants);
      if (gifts) return { label: "На экране: сердечки зрительской симпатии", change: gifts };
      const tile = tileOf(content, r.tile);
      return { label: `Пульт: «Выступили» — +${tile?.points ?? 0} и подарки зала`, change: finishPerform(session, content, answers, participants, true) };
    }
    case "vote": {
      const hype = session.state.step;
      return { label: `Батл окончен — на экране «${hypeText(content.variant, hype)}», голосует зал`, change: startVote(session, content, hype) };
    }
    case "count": {
      // Голосуют телефоны не из сторон батла (при трёх командах — третья).
      const voters = phones.filter((p) => p.side !== r.performer && p.side !== r.opponent);
      if (answers.length === 0 && voters.length > 0 && r.performer && r.opponent) {
        const performer = r.performer;
        const opponent = r.opponent;
        return { label: "Зал голосует с телефонов", answers: voters.map((p, i) => ({ pid: p.id, value: { vote: i % 3 === 2 ? opponent : performer } })) };
      }
      const votes = liveVotes(session, answers, participants);
      if (votes) return { label: "На экране — перетягивание каната", change: votes };
      return { label: "Пульт: «Подсчитать голоса»", change: countVotes(session, content, answers, participants) };
    }
    case "next":
      return { label: "Пульт: «Следующая команда»", change: nextTurn(session, participants) };
    default:
      return null;
  }
};
