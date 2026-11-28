// Предпросмотр в конструкторе (этап 1): выбор тем капитанами и сборка колеса. Вращение и задания добавятся вместе с ними.
import type { PreviewDriver } from "../preview";
import { catalogThemes, type RouletteContent } from "./content";
import { openThemes, planWheel, rouletteAction, syncThemes, themesNeeded } from "./logic";

export const roulettePreview: PreviewDriver<RouletteContent> = ({ session, content, participants, answers }) => {
  const name = (pid: string) => session.leaderboard[pid]?.name ?? "Команда";
  switch (rouletteAction(session)) {
    case "openThemes":
      return { label: "Пульт: «Открыть выбор тем»", change: openThemes(session, participants) };
    case "toWheel": {
      const catalog = catalogThemes(content).map((t) => t.id);
      const need = themesNeeded(content);
      const teams = participants.filter((p) => p.kind === "team");
      const waiting = teams.findIndex((p) => !answers.some((a) => a.pid === p.id));
      if (waiting >= 0 && catalog.length > 0) {
        const team = teams[waiting]!;
        const themes = Array.from({ length: need }, (_, k) => catalog[(waiting * need + k) % catalog.length]!);
        return { label: "Капитан «" + name(team.id) + "» выбирает темы и жмёт «Подтвердить»", answers: [{ pid: team.id, value: { themes, confirmed: true } }] };
      }
      const sync = syncThemes(session, content, answers);
      if (sync) return { label: "Экран: все команды готовы", change: sync };
      const plan = planWheel(session, content, participants, answers);
      return plan.ok ? { label: "Пульт: «К колесу» — колесо собрано", change: plan.change } : null;
    }
    default:
      return null;
  }
};
