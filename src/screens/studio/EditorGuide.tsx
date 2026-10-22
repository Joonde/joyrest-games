import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { HostGate } from "../../components/HostGate";
import { StudioSkeleton } from "../../components/Skeleton";
import { TopBar } from "../../components/TopBar";
import { EDITOR_BASICS, EDITOR_GUIDES as ALL_GUIDES, type EditorBasics, type EditorExample, type EditorGuide } from "../../core/editorGuide";
import { normalizeSearch } from "../../core/search";
import { HIDDEN_MECHANICS } from "../../mechanics/hidden";
import type { UserProfile } from "../../data";
import { rich } from "./Guide";
import { studioActions } from "./Studio";

const EDITOR_GUIDES = ALL_GUIDES.filter((g) => !HIDDEN_MECHANICS.has(g.mechanic));

/**
 * «Как создавать игры» (`/studio/editor-guide`, решение владельца 22 октября 2026): инструкция по конструктору —
 * общие правила (редактировать или запустить, сохранение, проверка, картинки и музыка) и раздел каждой игры:
 * шаги, все поля, примеры «что будет на экране и телефонах». Данные — `src/core/editorGuide.ts`.
 */
export function EditorGuidePage() {
  return <HostGate skeleton={<StudioSkeleton />}>{(_user, profile) => <EditorGuideScreen profile={profile} />}</HostGate>;
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).join(" ");
  if (value && typeof value === "object") return Object.values(value).map(textOf).join(" ");
  return "";
}

function matches(value: unknown, query: string): boolean {
  if (!query) return true;
  const hay = normalizeSearch(textOf(value));
  return query.split(" ").every((word) => hay.includes(word));
}

function Flow({ flow }: { flow: NonNullable<EditorBasics["flow"]> }) {
  return (
    <ol className="eg-flow" aria-label="Схема">
      {flow.map((s, i) => (
        <li key={i} className="eg-flow__step">
          <strong>{rich(s.title)}</strong>
          <span>{rich(s.text)}</span>
        </li>
      ))}
    </ol>
  );
}

function Example({ e }: { e: EditorExample }) {
  return (
    <article className="eg-example">
      <h4>{e.title}</h4>
      <dl className="eg-example__grid">
        <div className="eg-example__row eg-example__row--setup">
          <dt>🛠 В конструкторе</dt>
          <dd>{rich(e.setup)}</dd>
        </div>
        <div className="eg-example__row">
          <dt>📺 Экран зала</dt>
          <dd>{rich(e.hall)}</dd>
        </div>
        <div className="eg-example__row">
          <dt>📱 Телефоны гостей</dt>
          <dd>{rich(e.phones)}</dd>
        </div>
        {e.host && (
          <div className="eg-example__row">
            <dt>🎛 Пульт</dt>
            <dd>{rich(e.host)}</dd>
          </div>
        )}
      </dl>
    </article>
  );
}

function Basics({ b, open }: { b: EditorBasics; open: boolean }) {
  return (
    <details id={b.id} className="card eg-section" open={open}>
      <summary className="eg-section__head">
        <span aria-hidden="true">{b.icon}</span> {b.title}
      </summary>
      <div className="stack">
        {b.flow && <Flow flow={b.flow} />}
        <ul className="guide-list">
          {b.items.map((t, i) => (
            <li key={i}>{rich(t)}</li>
          ))}
        </ul>
        {b.examples && b.examples.length > 0 && (
          <div className="stack stack--tight">
            <h3>Что будет, если…</h3>
            {b.examples.map((e) => (
              <Example key={e.title} e={e} />
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function GameSection({ g, open }: { g: EditorGuide; open: boolean }) {
  return (
    <details id={g.mechanic} className="card eg-section" open={open}>
      <summary className="eg-section__head">
        <span aria-hidden="true">{g.icon}</span> {g.title}
      </summary>
      <div className="stack">
        <p>{rich(g.summary)}</p>
        <h3>🚀 С чего начать</h3>
        <ul className="guide-list">
          {g.start.map((t, i) => (
            <li key={i}>{rich(t)}</li>
          ))}
        </ul>
        <h3>🪜 По шагам</h3>
        <ol className="eg-steps">
          {g.steps.map((s, i) => (
            <li key={i} className="eg-steps__item">
              <span className="eg-steps__n" aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <strong>{rich(s.title)}</strong>
                <p>{rich(s.text)}</p>
              </div>
            </li>
          ))}
        </ol>
        <details className="eg-fields">
          <summary>🧰 Все поля и кнопки конструктора · {g.fields.length}</summary>
          <dl>
            {g.fields.map((f) => (
              <div key={f.name} className="eg-fields__row">
                <dt>{f.name}</dt>
                <dd>{rich(f.text)}</dd>
              </div>
            ))}
          </dl>
        </details>
        <h3>💡 Что будет, если…</h3>
        {g.examples.map((e) => (
          <Example key={e.title} e={e} />
        ))}
        <h3>⛔ «▶ Запустить игру» не нажимается — проверьте</h3>
        <ul className="guide-list">
          {g.ready.map((t, i) => (
            <li key={i}>{rich(t)}</li>
          ))}
        </ul>
        <p className="muted small">В конструкторе нажмите «Показать, что исправить» — он сам откроет первое место с ошибкой.</p>
        <h3>⭐ Советы</h3>
        <ul className="guide-list">
          {g.tips.map((t, i) => (
            <li key={i}>{rich(t)}</li>
          ))}
        </ul>
        <Link className="btn btn--quiet btn--block" to={`/studio/guide#${g.mechanic}`}>
          Как проводить эту игру →
        </Link>
      </div>
    </details>
  );
}

export function EditorGuideScreen({ profile }: { profile: UserProfile }) {
  const { hash } = useLocation();
  const target = hash ? decodeURIComponent(hash.slice(1)) : "";
  const [query, setQuery] = useState("");
  const q = normalizeSearch(query.trim());
  // Ссылка из конструктора (#quiz) открывает и показывает раздел игры.
  useEffect(() => {
    if (!target) return window.scrollTo(0, 0);
    window.setTimeout(() => document.getElementById(target)?.scrollIntoView({ block: "start" }), 50);
  }, [target]);
  const basics = useMemo(() => EDITOR_BASICS.filter((b) => matches(b, q)), [q]);
  const games = useMemo(() => EDITOR_GUIDES.filter((g) => matches(g, q)), [q]);
  // Выбрали игру (#quiz) — на странице только её инструкция и «← Все игры».
  const selected = !q ? EDITOR_GUIDES.find((g) => g.mechanic === target) : undefined;

  return (
    <main className="page page--wide guide">
      <TopBar title="Как создавать игры" actions={[{ label: "В студию", to: "/studio" }, ...studioActions(profile)]} />
      {selected ? (
        <>
          <Link className="btn btn--secondary btn--block" to="/studio/editor-guide">
            ← Все игры и общие правила
          </Link>
          <GameSection key={selected.mechanic} g={selected} open />
          <Link className="btn btn--secondary btn--block" to="/studio/editor-guide">
            ← Все игры и общие правила
          </Link>
        </>
      ) : (
        <>
          <section className="card stack stack--tight">
            <h2>✍️ Как создавать игры в конструкторе</h2>
            <p>Выберите игру — откроется её инструкция: с чего начать, шаги, все поля и примеры «что будет на экране и телефонах». Ниже — общие правила для всех игр.</p>
            <label className="field">
              Найти в инструкции
              <input type="search" value={query} placeholder="Например: картинка, трек, раунд, 18+" autoComplete="off" onChange={(e) => setQuery(e.target.value)} />
            </label>
            {q && basics.length === 0 && games.length === 0 && <p className="muted">Ничего не нашли. Попробуйте другое слово.</p>}
          </section>

          {!q && (
            <section className="card stack stack--tight" aria-labelledby="eg-pick">
              <h2 id="eg-pick">🎲 Выберите игру</h2>
              <div className="eg-pick">
                {EDITOR_GUIDES.map((g) => (
                  <Link key={g.mechanic} to={`/studio/editor-guide#${g.mechanic}`} className="eg-pick__item">
                    <span className="eg-pick__icon" aria-hidden="true">
                      {g.icon}
                    </span>
                    <span className="eg-pick__title">{g.title}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {basics.length > 0 && <h2 className="eg-part">📘 Общее для всех игр</h2>}
          {basics.map((b) => (
            <Basics key={`${b.id}:${q}:${target}`} b={b} open={Boolean(q) || target === b.id} />
          ))}
          {q && games.length > 0 && <h2 className="eg-part">🎲 Игры</h2>}
          {q && games.map((g) => <GameSection key={`${g.mechanic}:${q}`} g={g} open />)}
        </>
      )}
    </main>
  );
}
