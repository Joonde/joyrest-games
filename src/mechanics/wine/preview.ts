import type { Answer } from "../../data/types";
import type { PreviewDriver } from "../preview";
import { scoringIds } from "../preview";
import { boardOf, winningKeys, type BetCategory, type WineContent } from "./content";
import { liveChips, nextWine, openBets, openBottle, parseWineResult, winePrimary } from "./logic";

/** Что ставит гость: категория и угадал ли (у каждого свой вкус — кто-то промахивается). */
const PLANS: Array<Array<[BetCategory, boolean]>> = [
  [["color", true], ["country", true], ["year", false]],
  [["world", true], ["grape", false], ["sweetness", true]],
  [["color", false], ["year", true], ["grape", true]],
  [["sweetness", false], ["country", false], ["world", true]],
];

export const winePreview: PreviewDriver<WineContent> = ({ session, content, participants, answers }) => {
  const teams = scoringIds(participants);
  const r = parseWineResult(session.state.result);
  const wine = content.wines[r.w];
  switch (winePrimary(session, content)) {
    case "bets":
      return { label: `Пульт: «Открыть ставки» — бутылка ${r.w + 1}`, change: openBets(session, content, participants) };
    case "open": {
      if (answers.length === 0 && wine) {
        const board = boardOf(content, r.year);
        const win = winningKeys(content, wine, r.year);
        const keyOf = (cat: BetCategory, right: boolean, shift: number) => {
          if (right) return win[cat];
          const others = board[cat].filter((o) => o.key !== win[cat]);
          return others[shift % Math.max(1, others.length)]?.key ?? win[cat];
        };
        const values = teams.map((pid, i) => {
          const plan = PLANS[(i + (r.w % 2)) % PLANS.length] ?? [];
          // Фишки по ячейкам: первой ставке — остаток, остальным по одной.
          const chips: Record<string, number> = {};
          plan.forEach(([cat, right], k) => {
            const n = k === 0 ? Math.max(1, content.chips - (plan.length - 1)) : 1;
            const key = keyOf(cat, right, i + r.w);
            chips[key] = (chips[key] ?? 0) + n;
          });
          return { pid, value: { chips } };
        });
        // Пульт сразу пишет фишки на экран — как при приходе ставок.
        const at = session.state.startedAt ?? 0;
        const fresh: Answer[] = values.map(({ pid, value }, i) => ({ id: `${session.state.step}_${pid}`, step: session.state.step, pid, uid: pid, value, submittedAt: at + 1500 + i * 700 }));
        return { label: "Гости раскладывают фишки по полю", answers: values, change: liveChips(session, content, fresh) };
      }
      return { label: "Пульт: «Открыть бутылку»", change: openBottle(session, content, answers) };
    }
    case "next":
      return { label: "Пульт: «Следующая бутылка»", change: nextWine(session) };
    default:
      return null;
  }
};
