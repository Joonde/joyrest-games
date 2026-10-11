// Перерыв между блоками и итоги вечера: экран зала и телефоны гостей.
import type { CSSProperties } from "react";
import { BoardView } from "../../components/live/BoardView";
import { NameText } from "../../components/NameText";
import { rankedLeaderboard } from "../../core/leaderboard";
import { blockWinners, nextBlockIndex, type SessionProgram } from "../../core/program";
import { teamColorVar } from "../../themes/registry";
import type { PlayerViewProps, ViewProps } from "../types";
import type { EveningContent } from "./content";

/** Строки программы: сыгранные — с победителями, следующий — «Дальше», остальные — по порядку. */
function BlockList({ program, compact }: { program: SessionProgram; compact?: boolean }) {
  const next = nextBlockIndex(program);
  return (
    <ol className={compact ? "ev-blocks ev-blocks--compact" : "ev-blocks"}>
      {program.blocks.map((block, i) => {
        const result = program.results.find((r) => r.index === i);
        const winners = result ? blockWinners(result) : [];
        const state = result ? "done" : i === next ? "next" : "later";
        return (
          <li key={i} className={`ev-block ev-block--${state}`}>
            <span className="ev-block__num" aria-hidden="true">
              {result ? "✓" : i + 1}
            </span>
            <span className="ev-block__text">
              <span className="ev-block__title">
                {state === "next" ? "Дальше: " : ""}
                {block.title}
              </span>
              {result && (
                <span className="ev-block__win">
                  {winners.length === 0 ? (
                    "без очков"
                  ) : (
                    <>
                      {winners.length > 1 ? "Победители: " : "Победитель: "}
                      {winners.slice(0, 3).map((w, k) => (
                        <span key={w.pid} className="ev-block__name" style={{ "--team": teamColorVar(w.colorIndex) } as CSSProperties}>
                          {k > 0 ? ", " : ""}
                          <NameText name={w.name} />
                        </span>
                      ))}
                      {winners.length > 3 ? ` и ещё ${winners.length - 3}` : ""} · {winners[0]?.score}
                    </>
                  )}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function heading(program: SessionProgram): { eyebrow: string; title: string } {
  if (program.at === "final") return { eyebrow: program.title || "Мероприятие", title: "Итоги вечера" };
  const done = program.blocks[program.index]?.title ?? "";
  return { eyebrow: `Блок ${program.index + 1} из ${program.blocks.length} окончен`, title: done ? `«${done}» — сыграно!` : "Перерыв" };
}

export function EveningScreenView({ session }: ViewProps<EveningContent>) {
  const program = session.program ?? null;
  if (!program) {
    return (
      <div className="screen-center">
        <h1 className="screen-title">Мероприятие из блоков</h1>
        <p className="screen-sub">Каждую игру вечера репетируйте отдельно.</p>
      </div>
    );
  }
  const { eyebrow, title } = heading(program);
  return (
    <div className="ev-screen">
      <section className="ev-screen__program">
        <p className="ev-screen__eyebrow">{eyebrow}</p>
        <h1 className="ev-screen__title">{title}</h1>
        <BlockList program={program} />
      </section>
      <section className="ev-screen__board">
        <BoardView leaderboard={session.leaderboard} title="Общий счёт вечера" showLast={false} limit={8} />
      </section>
    </div>
  );
}

export function EveningPlayerView({ session, pid }: PlayerViewProps<EveningContent, never>) {
  const program = session.program ?? null;
  if (!program) return <p className="muted">Мероприятие из блоков.</p>;
  const { eyebrow, title } = heading(program);
  const me = rankedLeaderboard(session.leaderboard).find((e) => e.id === pid);
  const next = nextBlockIndex(program);
  return (
    <section className="card stack ev-phone">
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      {me && (
        <p className="ev-phone__me">
          Ваше место в вечере: <strong>{me.place}</strong> · {me.score} очк.
        </p>
      )}
      <BlockList program={program} compact />
      <p className="muted small">
        {program.at === "final"
          ? "Смотрите на экран — сейчас награждение."
          : next !== null
            ? `Скоро начнётся «${program.blocks[next]?.title ?? ""}». Телефон переключится сам — ничего вводить не нужно.`
            : "Смотрите на экран."}
      </p>
    </section>
  );
}
