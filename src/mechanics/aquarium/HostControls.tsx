import { useEffect, useRef, type ReactNode } from "react";
import { useConfirm } from "../../components/ConfirmDialog";
import { useHostRun } from "../../components/live/useHostRun";
import { NameText } from "../../components/NameText";
import { drawingsRepo } from "../../data";
import type { HostControlsProps } from "../types";
import { GARLAND_MODES, SCENE_TITLES, type AquariumContent, type SceneId } from "./content";
import { figureById } from "./figures";
import { drawThumb } from "./paint";
import { feedFish, hideItem, keyOf, nextGarland, parseAquaResult, pendingItems, releaseItems, setScene, startAquarium, type AquaItem } from "./logic";

/**
 * Пульт «Аквариума и Ёлки»: «Открыть раскраску» → гости рисуют на телефонах → рисунки появляются на экране сами
 * (или после «Выпустить», если ведущий смотрит их сначала) → «Покормить рыбок» / гирлянда, смена сцены, «Убрать» →
 * «Завершить игру».
 */
export function AquariumHostControls({ session, content, answers, participants, control, rehearsal }: HostControlsProps<AquariumContent>) {
  const { run, quiet, busy, error } = useHostRun(session, control, rehearsal);
  const [dialog, confirm] = useConfirm();
  const { stage } = session.state;
  const r = parseAquaResult(session.state.result, content);
  const pending = stage === "question" ? pendingItems(session, answers, content) : [];
  const name = (pid: string) => session.leaderboard[pid]?.name ?? participants.find((p) => p.id === pid)?.name ?? "Гость";

  // Выпускать сразу: новые рисунки — на экран без касаний ведущего.
  const pendingKey = content.moderation === "auto" ? pending.map(keyOf).join(",") : "";
  useEffect(() => {
    if (!pendingKey || busy) return;
    void quiet((s) => releaseItems(s, content, pendingItems(s, answers, content)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при новых рисунках
  }, [pendingKey, busy]);

  const onScreen = r.items.filter((i) => i.scene === r.scene);
  const other: SceneId = r.scene === "aqua" ? "tree" : "aqua";

  return (
    <div className="stack host-quiz aq-host">
      <p className="eyebrow">
        {SCENE_TITLES[r.scene]} · рисунков на экране: {onScreen.length}
      </p>
      {stage === "ready" ? (
        <p className="muted">Раздайте гостям раскраску: на телефонах откроется лист с фигурами. Каждый рисунок сам появится на большом экране.</p>
      ) : (
        <div className="card stack stack--tight">
          <div className="aq-host__scenes" role="group" aria-label="Сцена на экране">
            {(["aqua", "tree"] as const).map((sc) => (
              <button key={sc} type="button" className={`btn ${r.scene === sc ? "" : "btn--secondary"}`} aria-pressed={r.scene === sc} disabled={busy} onClick={() => void run((s) => setScene(s, content, sc))}>
                {SCENE_TITLES[sc]}
              </button>
            ))}
          </div>
          {r.scene === "aqua" ? (
            <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run((s) => feedFish(s, content))}>
              Покормить рыбок
            </button>
          ) : (
            <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run((s) => nextGarland(s, content))}>
              Гирлянда: {GARLAND_MODES[r.garland]}
            </button>
          )}
          <p className="muted small">
            {r.scene === "aqua" ? "Гости раскрашивают рыбок" : "Гости раскрашивают игрушки"}. Сменить сцену — гостям откроются {other === "aqua" ? "рыбки" : "игрушки"}, прежние рисунки останутся на своей сцене.
          </p>
        </div>
      )}

      {stage === "question" && content.moderation === "host" && pending.length > 0 && (
        <section className="stack stack--tight">
          <p className="eyebrow">Ждут показа · {pending.length}</p>
          <ul className="aq-host__list">
            {pending.map((i) => (
              <ItemRow key={keyOf(i)} item={i} who={name(i.pid)}>
                <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => void run((s) => releaseItems(s, content, [i]))}>
                  На экран
                </button>
                <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => void run((s) => hideItem(s, content, i))}>
                  Не показывать
                </button>
              </ItemRow>
            ))}
          </ul>
          {pending.length > 1 && (
            <button type="button" className="btn btn--block" disabled={busy} onClick={() => void run((s) => releaseItems(s, content, pendingItems(s, answers, content)))}>
              Выпустить все ({pending.length})
            </button>
          )}
        </section>
      )}

      {stage === "question" && r.items.length > 0 && (
        <details className="aq-host__fold">
          <summary>Рисунки на экране · {r.items.length}</summary>
          <ul className="aq-host__list">
            {[...r.items].reverse().map((i) => (
              <ItemRow key={keyOf(i)} item={i} who={name(i.pid)}>
                <button
                  type="button"
                  className="btn btn--quiet"
                  disabled={busy}
                  onClick={() =>
                    confirm({
                      title: "Убрать рисунок с экрана?",
                      text: "Он исчезнет со сцены и больше не появится.",
                      confirmLabel: "Убрать",
                      run: () => run((s) => hideItem(s, content, i)),
                    })
                  }
                >
                  Убрать
                </button>
              </ItemRow>
            ))}
          </ul>
        </details>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        {stage === "ready" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run((s) => startAquarium(s, content, participants))}>
            Открыть раскраску
          </button>
        )}
        {stage === "question" && (
          <button
            type="button"
            className="btn btn--secondary btn--block"
            disabled={busy}
            onClick={() => control.requestFinish()}
          >
            Завершить игру
          </button>
        )}
      </div>
      <p className="muted small">
        Для зала: «Движок раскрасок — по мотивам проекта Paper Aquarium, автор MrMoT9I».
      </p>
      {dialog}
    </div>
  );
}

function ItemRow({ item, who, children }: { item: AquaItem; who: string; children: ReactNode }) {
  const fig = figureById(item.fig);
  return (
    <li className="aq-host__item">
      {item.sha && drawingsRepo ? <img className="aq-host__thumb" src={drawingsRepo.url(item.sha)} alt="" loading="lazy" /> : <FigureThumb fig={item.fig} />}
      <span className="aq-host__who">
        <span>{fig?.name ?? "Рисунок"}</span>
        <span className="muted small">
          <NameText name={who} />
          {item.name ? ` · «${item.name}»` : ""}
        </span>
      </span>
      <span className="aq-host__btns">{children}</span>
    </li>
  );
}

/** Рисунка ещё нет (предпросмотр) — контур фигуры. */
function FigureThumb({ fig }: { fig: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const def = figureById(fig);
    if (ref.current && def) drawThumb(def, ref.current);
  }, [fig]);
  return <canvas ref={ref} className="aq-host__thumb" width={144} height={96} aria-hidden="true" />;
}
