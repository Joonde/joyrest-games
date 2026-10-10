// Конструктор «Олимпа»: история и правила заданы в коде, здесь — сложность боёв, время голосования
// и обзор сцен истории (читать перед игрой).
import type { EditorProps } from "../types";
import { DIFFICULTIES, storyOf, validateOlymp, type OlympContent } from "./content";
import { foeOf } from "./foes";
import { placeOf } from "./story";

const KIND: Record<string, string> = { narrate: "рассказ", check: "проверка кубиком", vote: "голосование", fight: "бой", branch: "развилка по Саге", end: "концовка" };

export function OlympEditor({ content, onChange, editable }: EditorProps<OlympContent>) {
  const story = storyOf(content);
  const errors = validateOlymp(content);
  return (
    <div className="stack">
      <section className="card stack">
        <h2>{story.title}</h2>
        <p>{story.blurb}</p>
        <p className="muted small">Одна команда — один бог (до 10). Ведущий читает сцены с пульта, команды бросают d100, голосуют за путь и сражаются. Очки — опыт богов, в конце — награждение. Только 18+.</p>
      </section>
      <section className="card stack">
        <h2>Сложность боёв</h2>
        <div className="stack stack--tight" role="radiogroup" aria-label="Сложность">
          {DIFFICULTIES.map((d) => (
            <label key={d.id} className="choice">
              <input type="radio" name="olymp-difficulty" checked={content.difficulty === d.id} disabled={!editable} onChange={() => onChange({ ...content, difficulty: d.id })} />
              <span className="choice__title">{d.title}</span>
              <span className="choice__hint">{d.hint}</span>
            </label>
          ))}
        </div>
        <label className="stack stack--tight">
          <span>Время на голосование, секунд (0 — закрывает ведущий)</span>
          <input
            type="number"
            min={0}
            max={300}
            value={content.voteSeconds}
            disabled={!editable}
            onChange={(e) => onChange({ ...content, voteSeconds: Math.max(0, Math.min(300, Math.round(Number(e.target.value) || 0))) })}
          />
        </label>
      </section>
      <section className="card stack">
        <h2>Сцены истории · {story.scenes.length}</h2>
        <p className="muted small">Тексты истории правятся в коде игры (черновик — владелец согласует). Здесь — что будет и в каком месте.</p>
        <ol className="ol-scene-list">
          {story.scenes.map((s) => (
            <li key={s.id}>
              <b>{s.title}</b> <span className="muted small">· {placeOf(story, s.place)?.name} · {KIND[s.kind]}</span>
              {s.kind === "fight" && <span className="muted small"> · {foeOf(s.foe)?.name}</span>}
              <br />
              <span className="small">{s.screen}</span>
            </li>
          ))}
        </ol>
      </section>
      {errors.length > 0 && (
        <ul className="error">
          {errors.map((e, i) => (
            <li key={i}>{e.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
