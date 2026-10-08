import { Fragment, useEffect, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { HostGate } from "../../components/HostGate";
import { StudioSkeleton } from "../../components/Skeleton";
import { TopBar } from "../../components/TopBar";
import { GAME_GUIDES, GUIDE_INTRO, GUIDE_TROUBLE, type GameGuide, type GuideFlow } from "../../core/guide";
import type { UserProfile } from "../../data";
import { studioActions } from "./Studio";

/**
 * «Как проводить игры» (`/studio/guide`): инструкция для ведущих из `src/core/guide.ts` — схема каждой игры
 * (кнопки пульта и что в этот момент на телефонах), шаги ведущего и игроков, как объяснить гостям.
 * Правило: меняется механика — в том же PR правится её раздел в guide.ts.
 */
export function Guide() {
  return <HostGate skeleton={<StudioSkeleton />}>{(_user, profile) => <GuidePage profile={profile} />}</HostGate>;
}

/** «Показать вопрос» в тексте — плашкой кнопки. */
function rich(text: string): ReactNode {
  const parts = text.split(/(«[^«»]+(?:«[^«»]*»[^«»]*)*»)/g);
  return parts.map((p, i) =>
    p.startsWith("«") && p.endsWith("»") ? (
      <span key={i} className={p.length <= 24 ? "guide-btn guide-btn--short" : "guide-btn"}>
        {p.slice(1, -1)}
      </span>
    ) : (
      <Fragment key={i}>{p}</Fragment>
    ),
  );
}

function Flow({ flow }: { flow: GuideFlow }) {
  return (
    <div className="guide-flow" aria-label="Схема игры">
      <ol className="guide-flow__steps">
        {flow.host.map((h, i) => {
          const phone = flow.phones[i];
          return (
            <li key={i} className={i + 1 === flow.loop.to ? "guide-step is-loop" : "guide-step"}>
              <span className="guide-step__n" aria-hidden="true">
                {i + 1}
              </span>
              <div className="guide-step__host">
                <span className="guide-step__who">Пульт</span>
                <strong>{h.title}</strong>
                <span>{h.text}</span>
              </div>
              {phone && (
                <div className="guide-step__phone">
                  <span className="guide-step__who">Телефоны</span>
                  <strong>{phone.title}</strong>
                  {phone.text && <span>{phone.text}</span>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <p className="guide-flow__loop">
        ↻ После шага {flow.host.length} — снова шаг {flow.loop.to}: {flow.loop.label}
      </p>
      <p className="muted small">{rich(flow.end)}</p>
    </div>
  );
}

function GameSection({ g }: { g: GameGuide }) {
  return (
    <section id={g.mechanic} className="card stack guide-game">
      <h2>
        <span aria-hidden="true">{g.icon}</span> {g.title}
      </h2>
      <p>{rich(g.summary)}</p>
      <Flow flow={g.flow} />
      <h3>Что делает ведущий</h3>
      <ol className="guide-list">
        {g.host.map((t, i) => (
          <li key={i}>{rich(t)}</li>
        ))}
      </ol>
      {g.notes?.map((t, i) => (
        <p key={i} className="guide-note">
          {rich(t)}
        </p>
      ))}
      {g.tables?.map((t) => (
        <div key={t.title} className="stack stack--tight">
          <h3>{t.title}</h3>
          <div className="guide-table-wrap">
            <table className="guide-table">
              <thead>
                <tr>
                  {t.head.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((r) => (
                  <tr key={r[0]}>
                    {r.map((c, i) => (
                      <td key={i}>{rich(c)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <h3>Что делают игроки</h3>
      <ul className="guide-list">
        {g.players.map((t, i) => (
          <li key={i}>{rich(t)}</li>
        ))}
      </ul>
      <blockquote className="guide-say">
        <span className="guide-step__who">Как объяснить гостям за 20 секунд</span>
        {rich(g.explain)}
      </blockquote>
    </section>
  );
}

export function GuidePage({ profile }: { profile: UserProfile }) {
  const { hash } = useLocation();
  // Ссылка из конструктора ведёт сразу к разделу игры.
  useEffect(() => {
    if (!hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [hash]);
  return (
    <main className="page page--wide guide">
      <TopBar title="Как проводить игры" actions={[{ label: "В студию", to: "/studio" }, ...studioActions(profile)]} />
      <nav className="card guide-toc" aria-label="Игры">
        <a href="#start" className="guide-toc__item">
          🚀 Перед вечером
        </a>
        {GAME_GUIDES.map((g) => (
          <a key={g.mechanic} href={`#${g.mechanic}`} className="guide-toc__item">
            {g.icon} {g.title}
          </a>
        ))}
        <a href="#trouble" className="guide-toc__item">
          🛟 Если что-то пошло не так
        </a>
      </nav>

      <section id="start" className="card stack guide-game">
        <h2>🚀 Перед вечером: общее для всех игр</h2>
        <p>Любая игра проходит одинаково: ведущий запускает сессию в студии, гости входят по QR-коду, вопросы идут на экран зала, ведущий управляет всем с телефона-пульта.</p>
        {GUIDE_INTRO.map((block) => (
          <div key={block.title} className="stack stack--tight">
            <h3>{block.title}</h3>
            {block.ordered ? (
              <ol className="guide-list">
                {block.items.map((t, i) => (
                  <li key={i}>{rich(t)}</li>
                ))}
              </ol>
            ) : (
              <ul className="guide-list">
                {block.items.map((t, i) => (
                  <li key={i}>{rich(t)}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </section>

      {GAME_GUIDES.map((g) => (
        <GameSection key={g.mechanic} g={g} />
      ))}

      <section id="trouble" className="card stack guide-game">
        <h2>🛟 Если что-то пошло не так</h2>
        <div className="guide-table-wrap">
          <table className="guide-table">
            <thead>
              <tr>
                <th>Что случилось</th>
                <th>Что делать</th>
              </tr>
            </thead>
            <tbody>
              {GUIDE_TROUBLE.map(([what, how]) => (
                <tr key={what}>
                  <td>{what}</td>
                  <td>{rich(how)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">
          Перед первым вечером с новой игрой откройте её и посмотрите «Предпросмотр игры», потом пройдите <Link to="/studio">репетицию</Link>: тот же пульт и экран, без гостей,
          ничего не записывается.
        </p>
      </section>
    </main>
  );
}
