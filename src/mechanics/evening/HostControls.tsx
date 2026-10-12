// Пульт в перерыве между блоками и в итогах вечера.
import { useState } from "react";
import { useConfirm } from "../../components/ConfirmDialog";
import { hasPodium, nextPlace, podiumBack, podiumLabel, podiumNext, startPodium } from "../../core/podium";
import { nextBlockIndex, type ProgramAction } from "../../core/program";
import { errorCodeOf, sessionsRepo } from "../../data";
import type { HostControlsProps } from "../types";
import type { EveningContent } from "./content";

export function EveningHostControls({ session, control, rehearsal }: HostControlsProps<EveningContent>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, confirm] = useConfirm();
  const program = session.program ?? null;

  if (rehearsal || !program) {
    return <p className="muted">Мероприятие из блоков проводится только вживую. Каждую игру вечера можно прорепетировать отдельно.</p>;
  }

  async function run(job: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await job();
    } catch (e) {
      // Второй пульт уже переключил вечер — свежее состояние придёт само.
      if (errorCodeOf(e) !== "failed-precondition") setError("Не получилось. Проверьте интернет.");
    } finally {
      setBusy(false);
    }
  }

  const move = (action: ProgramAction) => {
    const p = program;
    return run(async () => {
      if (!sessionsRepo.program) throw new Error("unsupported");
      await sessionsRepo.program(session.id, action, p.index);
    });
  };

  const next = nextBlockIndex(program);
  const { stage } = session.state;
  const podium = stage === "podium";

  return (
    <div className="stack">
      <p className="eyebrow">{program.at === "final" ? "Итоги вечера" : `Перерыв после блока ${program.index + 1} из ${program.blocks.length}`}</p>
      {program.at === "break" && next !== null && (
        <>
          <p>
            На экране — победители блока и общий счёт вечера. Когда гости готовы, начните следующую игру: экран и телефоны переключатся сами.
          </p>
          <button type="button" className="btn btn--block" disabled={busy} onClick={() => void move("next")}>
            Начать блок {next + 1}: «{program.blocks[next]?.title}»
          </button>
          <button
            type="button"
            className="btn btn--quiet btn--block"
            disabled={busy}
            onClick={() =>
              confirm({
                title: "Закончить вечер сейчас?",
                text: `Оставшиеся блоки (${program.blocks.length - next}) не будут сыграны — сразу итоги вечера и награждение.`,
                confirmLabel: "К итогам вечера",
                run: async () => {
                  if (!sessionsRepo.program) return;
                  await sessionsRepo.program(session.id, "final", program.index);
                },
              })
            }
          >
            Закончить вечер без оставшихся блоков
          </button>
        </>
      )}
      {program.at === "final" && !podium && (
        <>
          <p>На экране — итоги всех блоков и общий счёт вечера.</p>
          {hasPodium(session.leaderboard) ? (
            <button type="button" className="btn btn--block" disabled={busy} onClick={() => void run(() => control.apply(startPodium(session)))}>
              Награждение вечера
            </button>
          ) : (
            <button type="button" className="btn btn--block" disabled={busy} onClick={() => control.requestFinish()}>
              Завершить вечер
            </button>
          )}
        </>
      )}
      {program.at === "final" && podium && (
        <>
          <button
            type="button"
            className="btn btn--block"
            disabled={busy}
            onClick={() => (nextPlace(session) === null ? control.requestFinish() : void run(() => control.apply(podiumNext(session))))}
          >
            {nextPlace(session) === null ? "Завершить вечер" : podiumLabel(session)}
          </button>
          <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run(() => control.apply(podiumBack(session)))}>
            Назад
          </button>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {dialog}
    </div>
  );
}
