/**
 * Приборы на телефоне (ТЗ: плитка не ниже 96 px; у ползунка числа 0–5 — отдельные кнопки, чтобы не промахнуться).
 * Положение показываем сразу после касания (до ответа сервера) — `shown`; сервер решает, засчитано ли.
 */
import type { CSSProperties } from "react";
import { DIAL_WORDS, LEVER_WORDS } from "../rules/panels";
import type { PanelControlView } from "../rules/types";
import { KidsArt } from "./art";

const TYPE_TITLES: Record<PanelControlView["type"], string> = {
  button: "кнопка",
  toggle: "тумблер",
  slider: "0–5",
  lever: "рычаг",
  dial: "крутилка",
};

function stateWord(c: PanelControlView, state: number): string {
  if (c.type === "toggle") return state === 1 ? "вкл" : "выкл";
  if (c.type === "lever") return LEVER_WORDS[state] ?? "";
  if (c.type === "dial") return DIAL_WORDS[state] ?? "";
  if (c.type === "slider") return String(state);
  return "";
}

export interface ControlProps {
  c: PanelControlView;
  /** Положение на экране: своё касание раньше ответа сервера. */
  shown: number;
  kids: boolean;
  /** Близнец («Бубликатор» / «Бубликатрон») — пометка ↔. */
  twin: boolean;
  /** В полширины (короткий прибор в паре — `halfControls`). */
  half?: boolean;
  /** «Глюк»: плитки поменялись местами — метка ↔. */
  swapped?: boolean;
  onMove: (state: number) => void;
}

export function Control({ c, shown, kids, twin, half = false, swapped = false, onMove }: ControlProps) {
  const hint = c.type === "button" ? TYPE_TITLES.button : `${TYPE_TITLES[c.type]} · сейчас ${stateWord(c, shown)}`;
  return (
    <section className={`bkp-ctl bkp-ctl--${c.type}${half ? " is-half" : ""}`} aria-label={`${c.name}: ${hint}`}>
      <header className="bkp-ctl__head">
        {kids && <KidsArt icon={c.icon} tint={c.tint} size={40} />}
        <span className="bkp-ctl__name">
          {c.name}
          {(twin || swapped) && (
            <span className="bkp-ctl__twin" title={swapped ? "Плитка поменялась местами" : "Похожее название — не перепутайте"}>
              {" "}
              ↔
            </span>
          )}
        </span>
        {!kids && <span className="bkp-ctl__hint">{hint}</span>}
      </header>
      <div className="bkp-ctl__body">{body(c, shown, kids, onMove)}</div>
    </section>
  );
}

function body(c: PanelControlView, shown: number, kids: boolean, onMove: (s: number) => void) {
  switch (c.type) {
    case "button":
      return (
        <button type="button" className="bkp-press" onClick={() => onMove(shown + 1)}>
          {kids ? "Нажмите!" : "Жать"}
        </button>
      );
    case "toggle": {
      const on = shown === 1;
      return (
        <button type="button" role="switch" aria-checked={on} className={`bkp-switch${on ? " is-on" : ""}`} onClick={() => onMove(on ? 0 : 1)}>
          <span className="bkp-switch__knob" />
          <span className="bkp-switch__text">{on ? "ВКЛ" : "ВЫКЛ"}</span>
        </button>
      );
    }
    case "slider":
      return (
        <div className="bkp-steps" role="radiogroup" aria-label={c.name}>
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={shown === n} className={`bkp-step${shown === n ? " is-on" : ""}`} onClick={() => onMove(n)}>
              {n}
            </button>
          ))}
        </div>
      );
    case "lever":
      return (
        <div className="bkp-lever" role="radiogroup" aria-label={c.name}>
          {LEVER_WORDS.map((w, n) => (
            <button key={w} type="button" role="radio" aria-checked={shown === n} className={`bkp-lever__pos${shown === n ? " is-on" : ""}`} onClick={() => onMove(n)}>
              <span className="bkp-lever__arrow" aria-hidden="true">
                {n === 0 ? "▲" : n === 1 ? "●" : "▼"}
              </span>
              {w}
            </button>
          ))}
        </div>
      );
    case "dial":
      return (
        <div className="bkp-dial" role="radiogroup" aria-label={c.name}>
          {DIAL_WORDS.map((w, n) => (
            <button
              key={w}
              type="button"
              role="radio"
              aria-checked={shown === n}
              className={`bkp-dial__pos${shown === n ? " is-on" : ""}`}
              style={{ "--bk-dot": `var(--bk-dial-${n})` } as CSSProperties}
              onClick={() => onMove(n)}
            >
              <span className="bkp-dial__ball" aria-hidden="true" />
              {w}
            </button>
          ))}
        </div>
      );
    default:
      return null;
  }
}

/** Близнецы третьего перелёта — названия с общим корнем (первые 4 буквы). */
export function twinsOf(panel: readonly PanelControlView[]): Set<string> {
  const out = new Set<string>();
  for (const a of panel) {
    for (const b of panel) {
      if (a.id !== b.id && a.name.slice(0, 4).toLowerCase() === b.name.slice(0, 4).toLowerCase()) out.add(a.id);
    }
  }
  return out;
}
