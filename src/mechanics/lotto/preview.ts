import type { PreviewDriver } from "../preview";
import { scoringIds } from "../preview";
import type { LottoContent } from "./content";
import { cardFor, isWin, lottoPrimary, nextSong, parseLottoResult, playSong, playedUpTo, revealSong } from "./logic";

export const lottoPreview: PreviewDriver<LottoContent> = ({ session, content, participants, answers }) => {
  const players = scoringIds(participants);
  switch (lottoPrimary(session, content)) {
    case "play":
      return { label: "Пульт: «Включить песню»", change: playSong(session) };
    case "reveal": {
      if (answers.length === 0) {
        // Кто собрал линию по сыгранным песням — жмёт «Лото!».
        const won = new Set(parseLottoResult(session.state.result).winners);
        const played = playedUpTo(content, session.state.step);
        const claims = players.flatMap((pid) => {
          if (won.has(pid)) return [];
          const marks = cardFor(content, pid).filter((t) => played.has(t));
          return isWin(cardFor(content, pid), new Set(marks), content.size, content.rule) ? [{ pid, value: { marks } }] : [];
        });
        if (claims.length > 0) return { label: "Гость собрал линию и жмёт «Лото!»", answers: claims };
      }
      return { label: "Пульт: «Показать название»", change: revealSong(session, content, answers, participants) };
    }
    case "next":
      return { label: "Пульт: «Следующая песня»", change: nextSong(session) };
    default:
      return null;
  }
};
