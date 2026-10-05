import { useParams } from "react-router-dom";
import { formatDate } from "../core/format";
import { participantsLabel } from "../core/results";
import { resultsRepo, useLoad, type GameResult } from "../data";
import { Logo } from "../components/Logo";
import { ResultsTable, ShareResults } from "../components/Results";
import { PlaySkeleton } from "../components/Skeleton";
import { LoadFailed, Message, Pending } from "../components/Status";
import { Toast, useToast } from "../components/Toast";
import { useTheme } from "../themes/registry";

/** Итоги игры по ссылке: открываются без входа, в оформлении сессии. */
export function Results() {
  const { resultId = "" } = useParams();
  const [state, retry] = useLoad(() => resultsRepo.get(resultId), [resultId]);

  if (state.status === "loading") return <Pending skeleton={<PlaySkeleton />} onRetry={retry} label="Загружаем итоги" />;
  if (state.status === "error") return <LoadFailed onRetry={retry} />;
  if (!state.data) return <Message title="Итоги не найдены">Проверьте ссылку.</Message>;
  return <ResultsView result={state.data} />;
}

function ResultsView({ result }: { result: GameResult }) {
  const [toast, showToast] = useToast();
  useTheme(result.themeId);
  const meta = [
    result.playedAt !== null ? formatDate(result.playedAt) : "",
    participantsLabel(result.participantsCount),
  ].filter(Boolean);

  return (
    <main className="page">
      <Logo kind="monogram" className="logo--mark" title="JoyRest" />
      <header className="stack stack--tight page-heading">
        <p className="eyebrow">Итоги игры</p>
        <h1>{result.gameTitle || "Игра"}</h1>
        <p className="muted">{meta.join(" · ")}</p>
      </header>
      <section className="card">
        <h2>{result.playMode === "teams" ? "Команды" : "Игроки"}</h2>
        <ResultsTable result={result} />
      </section>
      <ShareResults result={result} onToast={showToast} primary />
      <Toast text={toast} />
    </main>
  );
}
