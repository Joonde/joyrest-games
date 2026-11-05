import { useState } from "react";
import { QteHallRing } from "../components/live/qte/QteHallRing";
import { QteMash } from "../components/live/qte/QteMash";
import { QteRing, missText } from "../components/live/qte/QteRing";
import { QteSwipe } from "../components/live/qte/QteSwipe";
import { Tabs } from "../components/Tabs";
import { TopBar } from "../components/TopBar";
import {
  QTE_COUNTDOWN_MS,
  QTE_GRADE_TITLES,
  QTE_LEVELS,
  QTE_LEVEL_TITLES,
  arrowFor,
  dodgeWindow,
  gradeOf,
  ringHalfWindow,
  type QteAnswer,
  type QteLevel,
} from "../core/qte";

type Kind = "ring" | "swipe" | "mash";

const KINDS: Array<{ id: Kind; label: string }> = [
  { id: "ring", label: "Удар катаной" },
  { id: "swipe", label: "Уворот" },
  { id: "mash", label: "Добивание" },
];

/** Строка журнала попыток. */
function logLine(kind: Kind, answer: QteAnswer | null, expected: string): string {
  if (!answer) return kind === "ring" ? "Не нажали — «Слабо»" : "Не успели";
  if (answer.kind === "ring") return `${QTE_GRADE_TITLES[gradeOf(answer.acc)]} · точность ${answer.acc}% · ${missText(answer.ms)}`;
  if (answer.kind === "swipe") return `${answer.dir === expected ? "Увернулись" : "Не в ту сторону"} · ${(answer.ms / 1000).toFixed(2).replace(".", ",")} с`;
  return `Ударов: ${answer.taps}`;
}

/**
 * Стенд QTE (служебная страница, без входа, как /brand): потрогать кольцо, уворот и добивание на
 * своём телефоне до того, как они появятся в «Бое с драконом». В игре старт даёт ведущий с пульта
 * и он общий для всех телефонов (часы сервера); здесь — кнопка «Старт» на этом телефоне.
 */
export function QteLab() {
  const [kind, setKind] = useState<Kind>("ring");
  const [level, setLevel] = useState<QteLevel>("normal");
  const [agility, setAgility] = useState(0);
  const [round, setRound] = useState<{ n: number; goAt: number } | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const half = ringHalfWindow(level, agility);
  const expected = arrowFor(`lab_${round?.n ?? 0}`);

  function start() {
    setRound((r) => ({ n: (r?.n ?? 0) + 1, goAt: Date.now() + QTE_COUNTDOWN_MS }));
  }

  function finish(answer: QteAnswer | null) {
    setLog((l) => [logLine(kind, answer, expected), ...l].slice(0, 8));
  }

  return (
    <main className="page">
      <TopBar title="Стенд QTE" actions={[{ label: "На главную", to: "/" }]} />

      <section className="card qte-lab__intro">
        <h2>Быстрые события «Боя с драконом»</h2>
        <p className="muted">
          Служебная страница: проверьте, как удобно жать на вашем телефоне. В игре старт даёт ведущий, и он один на всех
          гостей. Здесь — кнопка «Старт».
        </p>
      </section>

      <Tabs
        items={KINDS}
        value={kind}
        onChange={(k) => {
          setKind(k);
          setRound(null);
        }}
        label="Вид события"
        idPrefix="qte-lab"
      />

      <section className="card" id={`qte-lab-panel-${kind}`} role="tabpanel">
        {kind !== "mash" && (
          <>
            <div className="field__label qte-lab__label">Сложность</div>
            <div className="seg" role="group" aria-label="Сложность">
              {QTE_LEVELS.map((l) => (
                <button key={l} type="button" className={l === level ? "seg__btn is-on" : "seg__btn"} onClick={() => setLevel(l)}>
                  {QTE_LEVEL_TITLES[l]}
                </button>
              ))}
            </div>
            <div className="field__label qte-lab__label">Ловкость героя</div>
            <div className="seg qte-lab__seg4" role="group" aria-label="Ловкость героя">
              {[0, 1, 2, 3].map((a) => (
                <button key={a} type="button" className={a === agility ? "seg__btn is-on" : "seg__btn"} onClick={() => setAgility(a)}>
                  {a === 0 ? "0" : `+${a}`}
                </button>
              ))}
            </div>
            <p className="muted qte-lab__hint">
              {kind === "ring"
                ? `Зона «Хорошо» — ${((2 * half) / 1000).toFixed(2).replace(".", ",")} с, «Идеально» — ближе 40% от неё.`
                : `На уворот — ${(dodgeWindow(level, agility) / 1000).toFixed(1).replace(".", ",")} с после появления стрелки.`}
            </p>
          </>
        )}

        <div className="actions">
          <button type="button" className="btn" onClick={start}>
            {round ? "▶ Ещё раз" : "▶ Старт"}
          </button>
        </div>

        {round && kind === "ring" && <QteRing key={round.n} goAt={round.goAt} half={half} title="Удар катаной" onResult={finish} />}
        {round && kind === "swipe" && <QteSwipe key={round.n} goAt={round.goAt} window={dodgeWindow(level, agility)} dir={expected} onResult={finish} />}
        {round && kind === "mash" && <QteMash key={round.n} goAt={round.goAt} onResult={finish} />}
      </section>

      {round && kind === "ring" && (
        <section className="card">
          <h3>Так это видит экран зала</h3>
          <div className="qte-lab__hall">
            <QteHallRing key={round.n} goAt={round.goAt} half={half} />
          </div>
        </section>
      )}

      {log.length > 0 && (
        <section className="card">
          <h3>Ваши попытки</h3>
          <ol className="qte-lab__log">
            {log.map((line, i) => (
              <li key={`${log.length - i}`}>{line}</li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
