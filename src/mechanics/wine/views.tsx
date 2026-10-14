// «Винное казино»: экран зала — сукно рулетки с категориями и фишками гостей, после «Открыть бутылку» — паспорт
// вина и выигравшие ячейки; телефон — свои фишки на поле.
import { useEffect, useRef, useState } from "react";
import { NameText } from "../../components/NameText";
import { playSound } from "../../components/live/sound";
import { useServerNow } from "../../components/live/useServerNow";
import { pointsLabel } from "../../core/results";
import { acceptsAnswers, secondsLeft } from "../../core/session";
import type { Session } from "../../data/types";
import type { PlayerViewProps, ViewProps } from "../types";
import { boardOf, CATEGORIES, CATEGORY_TITLES, COLOR_TITLES, SWEETNESS_TITLES, winningKeys, WORLD_TITLES, type BetCategory, type Wine, type WineContent } from "./content";
import { parseWineResult, type WineResult } from "./logic";

export type WineAnswerValue = { chips: Record<string, number> };

const nameOf = (session: Session, p: string) => session.leaderboard[p]?.name ?? "";

/** Цвет вина для бокала: CSS-переменные темы вина (wine.css в styles.css). */
const GLASS: Record<Wine["color"], string> = { red: "is-red", white: "is-white", rose: "is-rose", orange: "is-orange" };

function Glass({ color }: { color?: Wine["color"] }) {
  return (
    <svg className={`wine-glass ${color ? GLASS[color] : "is-unknown"}`} viewBox="0 0 60 100" aria-hidden="true">
      <path className="wine-glass__wine" d="M12 22 Q30 26 48 22 Q47 44 30 50 Q13 44 12 22 Z" />
      <path className="wine-glass__bowl" d="M8 6 H52 Q54 40 30 52 Q6 40 8 6 Z" />
      <path className="wine-glass__stem" d="M30 52 V88 M16 94 H44" />
    </svg>
  );
}

/** Сукно: категории строками, ячейки с фишками; после открытия — выигравшие подсвечены. */
export function WineTable({ content, r, win, compact = false }: { content: WineContent; r: WineResult; win: Record<BetCategory, string> | null; compact?: boolean }) {
  const board = boardOf(content, r.year);
  const winning = new Set(win ? Object.values(win) : []);
  return (
    <div className={compact ? "wine-table wine-table--compact" : "wine-table"}>
      {CATEGORIES.map((cat) => (
        <div key={cat} className="wine-row">
          <span className="wine-row__head">
            <span className="wine-row__title">{CATEGORY_TITLES[cat]}</span>
            <span className="wine-row__odds">×{content.odds[cat]}</span>
          </span>
          <span className="wine-row__cells">
            {board[cat].map((o) => {
              const n = r.chips[o.key] ?? 0;
              const isWin = winning.has(o.key);
              return (
                <span key={o.key} className={`wine-cell${n > 0 ? " has-chips" : ""}${isWin ? " is-win" : ""}${win && !isWin ? " is-lost" : ""}`}>
                  <span className="wine-cell__label">{o.label}</span>
                  {n > 0 && <span className="wine-cell__chips">{n}</span>}
                </span>
              );
            })}
          </span>
        </div>
      ))}
    </div>
  );
}

function Passport({ wine }: { wine: Wine }) {
  return (
    <div className="wine-passport">
      <Glass color={wine.color} />
      <div className="wine-passport__text">
        <p className="wine-passport__name">{wine.name}</p>
        <p className="wine-passport__facts">
          {COLOR_TITLES[wine.color]} · {SWEETNESS_TITLES[wine.sweetness]} · {WORLD_TITLES[wine.world]}
        </p>
        <p className="wine-passport__facts">
          {wine.country} · {wine.grape} · {wine.year ?? "без года"}
        </p>
        {wine.note && <p className="wine-passport__note">{wine.note}</p>}
      </div>
    </div>
  );
}

export function WineScreenView({ session, content }: ViewProps<WineContent>) {
  const r = parseWineResult(session.state.result);
  const { stage } = session.state;
  const wine = content.wines[r.w];
  const now = useServerNow(250, stage === "question");
  const left = stage === "question" ? secondsLeft(session.state, now) : null;
  const total = Object.keys(session.leaderboard).length;

  const previous = useRef(`${r.w}:${r.mode}:${stage}`);
  useEffect(() => {
    const key = `${r.w}:${r.mode}:${stage}`;
    if (previous.current !== key) {
      if (r.mode === "bet" && stage === "question") playSound("whoosh");
      if (r.mode === "open") playSound("fanfare");
    }
    previous.current = key;
  }, [r.w, r.mode, stage]);

  if (stage === "ready" || !wine) {
    return (
      <div className="wine-screen wine-screen--intro">
        <p className="wine-screen__brand">Винное казино</p>
        <Glass />
        <h2 className="wine-screen__title">
          Бутылка {r.w + 1} из {content.wines.length}
        </h2>
        <p className="wine-screen__lead">Попробуйте вино и ставьте фишки на телефоне: цвет, страну, сорт, год. Чем точнее — тем выше выигрыш.</p>
      </div>
    );
  }

  const open = r.mode === "open";
  const gains = Object.entries(r.payouts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  return (
    <div className={open ? "wine-screen wine-screen--open" : "wine-screen"}>
      <div className="wine-screen__top">
        <span className="quiz-screen__badge">
          Бутылка {r.w + 1} из {content.wines.length}
        </span>
        {!open && (
          <span className="wine-screen__count">
            Поставили: <b>{r.bettors.length}</b> из {total}
          </span>
        )}
        {left !== null && <span className={left === 0 ? "quiz-screen__timer is-over" : "quiz-screen__timer"}>{left}</span>}
      </div>
      {open && <Passport wine={wine} />}
      <WineTable content={content} r={r} win={open ? winningKeys(content, wine, r.year) : null} />
      {open && gains.length > 0 && (
        <ul className="wine-gains">
          {gains.map(([p, n]) => (
            <li key={p}>
              <NameText name={nameOf(session, p)} /> <b>+{n}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function rec(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function WinePlayerView({ session, content, pid, role, myAnswer, sending, onAnswer }: PlayerViewProps<WineContent, WineAnswerValue>) {
  const r = parseWineResult(session.state.result);
  const { stage, step } = session.state;
  const wine = content.wines[r.w];
  const now = useServerNow(500, stage === "question");
  const open = acceptsAnswers(session.state, now);
  const left = stage === "question" ? secondsLeft(session.state, now) : null;
  const me = session.leaderboard[pid];
  const head = (
    <p className="eyebrow">
      Винное казино · бутылка {r.w + 1} из {content.wines.length}
      {me ? ` · ${pointsLabel(me.score)}` : ""}
      {left !== null ? ` · ${left} с` : ""}
    </p>
  );

  if (stage === "ready" || !wine) {
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        <h2>Пробуем вино</h2>
        <p className="muted">Скоро откроются ставки: у вас {content.chips} фишек на эту бутылку.</p>
      </div>
    );
  }

  if (r.mode === "bet") {
    if (role === "member") {
      return (
        <div className="quiz-phone quiz-phone--center">
          {head}
          <h2>Ставит капитан</h2>
          <p className="muted">Подсказывайте ему — фишки команды на его телефоне.</p>
        </div>
      );
    }
    const sent = rec(rec(myAnswer?.value).chips) as Record<string, number>;
    return (
      <div className="quiz-phone">
        {head}
        <ChipsForm key={step} content={content} r={r} sent={myAnswer ? sent : null} disabled={!open || sending} onSend={(chips) => onAnswer({ chips })} />
        {!open && <p className="muted">Ставки закрыты — сейчас откроют бутылку.</p>}
      </div>
    );
  }

  const mine = r.payouts[pid] ?? 0;
  return (
    <div className="quiz-phone quiz-phone--center">
      {head}
      <p className="muted">Это было</p>
      <h2>{wine.name}</h2>
      <p className="muted small">
        {COLOR_TITLES[wine.color]} · {wine.country} · {wine.grape} · {wine.year ?? "без года"}
      </p>
      <div className={mine > 0 ? "buzz__plate buzz__plate--glow" : "buzz__plate"} role="status">
        <strong>{mine > 0 ? `+${mine} очков!` : "В этот раз мимо"}</strong>
        <span>{mine > 0 ? "Фишки сыграли" : "Следующая бутылка — новые фишки"}</span>
      </div>
    </div>
  );
}

function ChipsForm({ content, r, sent, disabled, onSend }: { content: WineContent; r: WineResult; sent: Record<string, number> | null; disabled: boolean; onSend: (chips: Record<string, number>) => void }) {
  const [chips, setChips] = useState<Record<string, number>>(sent ?? {});
  const [cat, setCat] = useState<BetCategory>("color");
  const board = boardOf(content, r.year);
  const used = Object.values(chips).reduce((s, n) => s + n, 0);
  const left = content.chips - used;
  const same = sent !== null && JSON.stringify(Object.entries(sent).sort()) === JSON.stringify(Object.entries(chips).filter(([, n]) => n > 0).sort());
  const add = (key: string, d: number) =>
    setChips((prev) => {
      const n = Math.max(0, (prev[key] ?? 0) + d);
      const next = { ...prev, [key]: n };
      if (n === 0) delete next[key];
      return next;
    });
  const perCat = (c: BetCategory) => board[c].reduce((s, o) => s + (chips[o.key] ?? 0), 0);

  return (
    <div className="stack">
      <p className="wine-phone__left" aria-live="polite">
        Фишек: <b>{left}</b> из {content.chips} · фишка — {content.chipValue} очков × коэффициент
      </p>
      <div className="wine-tabs" role="tablist" aria-label="Категории">
        {CATEGORIES.map((c) => (
          <button key={c} type="button" role="tab" aria-selected={cat === c} className={cat === c ? "wine-tab is-on" : "wine-tab"} onClick={() => setCat(c)}>
            {CATEGORY_TITLES[c].replace("Старый или Новый Свет", "Свет")} ×{content.odds[c]}
            {perCat(c) > 0 && <span className="wine-tab__n"> · {perCat(c)}</span>}
          </button>
        ))}
      </div>
      <ul className="wine-options">
        {board[cat].map((o) => {
          const n = chips[o.key] ?? 0;
          return (
            <li key={o.key} className={n > 0 ? "wine-option is-on" : "wine-option"}>
              <button type="button" className="wine-option__main" disabled={disabled || left <= 0} onClick={() => add(o.key, 1)}>
                <span>{o.label}</span>
                {n > 0 && <span className="wine-option__chips">{"●".repeat(Math.min(n, 10))}</span>}
              </button>
              {n > 0 && (
                <button type="button" className="wine-option__minus" disabled={disabled} aria-label={`Снять фишку: ${o.label}`} onClick={() => add(o.key, -1)}>
                  −
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" className="btn btn--block" disabled={disabled || used === 0 || same} onClick={() => onSend(chips)}>
        {same ? "Ставки приняты ✓" : sent ? "Изменить ставки" : `Поставить ${used} ${used === 1 ? "фишку" : used < 5 ? "фишки" : "фишек"}`}
      </button>
      {sent && <p className="muted small">Можно поменять, пока идёт время.</p>}
    </div>
  );
}
