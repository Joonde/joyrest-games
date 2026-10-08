// «Правда или действие»: экран зала — кто ходит, две большие карты, перевёрнутая карточка с заданием,
// «Выполнено!» или «Отказ»; телефон — выбор (у того, чья очередь), карточка, предложить своё задание.
import { useEffect, useRef, useState } from "react";
import { Confetti } from "../../components/live/Confetti";
import { playSound } from "../../components/live/sound";
import { NameText } from "../../components/NameText";
import { pointsLabel } from "../../core/results";
import type { Session } from "../../data/types";
import type { PlayerViewProps, ViewProps } from "../types";
import { CardFace, SplitBack } from "./CardArt";
import { KIND_TITLES, TRUTH_LIMITS, type TruthContent, type TruthKind } from "./content";
import { choiceOf, parseTruthResult, roundOf, suggestionOf, turnPid, type DrawnCard, type TruthResult } from "./logic";

export type TruthAnswerValue = { choice: TruthKind } | { suggest: { kind: TruthKind; text: string } };

const nameOf = (session: Session, pid: string | null) => (pid ? (session.leaderboard[pid]?.name ?? "Игрок") : "");

/** Карточка хода: лицевая сторона с именем автора задания. */
function FaceCard({ session, card, size = "screen", stamp }: { session: Session; card: DrawnCard; size?: "screen" | "phone"; stamp?: "done" | "refused" | null }) {
  return (
    <div key={card.id} className={`td-flip td-flip--${size}`}>
      <CardFace kind={card.kind} text={card.text} from={card.from ? nameOf(session, card.from) : null} size={size} stamp={stamp ?? null} />
    </div>
  );
}

function Queue({ session, r }: { session: Session; r: TruthResult }) {
  const who = turnPid(r);
  if (r.order.length === 0) return null;
  const start = r.order.indexOf(who ?? "");
  const list = [...r.order.slice(start), ...r.order.slice(0, start)].slice(0, 8);
  return (
    <ol className="td-queue" aria-label="Очередь">
      {list.map((p, i) => (
        <li key={p} className={i === 0 ? "is-now" : undefined}>
          <span className="td-queue__name">
            <NameText name={nameOf(session, p)} />
          </span>
          <span className="td-queue__score">{session.leaderboard[p]?.score ?? 0}</span>
        </li>
      ))}
    </ol>
  );
}

export function TruthScreenView({ session, content }: ViewProps<TruthContent>) {
  const r = parseTruthResult(session.state.result);
  const { stage, step } = session.state;
  const who = turnPid(r);
  const prev = useRef(`${step}:${r.mode}:${r.card?.id ?? ""}`);
  useEffect(() => {
    const key = `${step}:${r.mode}:${r.card?.id ?? ""}`;
    if (prev.current !== key) {
      if (r.mode === "card") playSound("whoosh");
      else if (r.mode === "done") playSound(r.outcome === "done" ? "fanfare" : "wrong");
      else if (r.mode === "pick" && stage === "question") playSound("drumroll");
    }
    prev.current = key;
  }, [step, r.mode, r.card?.id]);

  return (
    <div className="td-screen">
      {r.mode === "done" && r.outcome === "done" && <Confetti burst={`td:${step}`} count={50} />}
      <section className="td-screen__main">
        {stage === "ready" || r.order.length === 0 ? (
          <>
            <span className="quiz-screen__badge">Правда или действие</span>
            <div className="td-deck">
              <SplitBack />
            </div>
            <p className="td-note">Ходим по очереди: выбираете на телефоне — честный ответ или смелое задание.{content.guestCards ? " Свои вопросы и задания можно прислать с телефона." : ""}</p>
          </>
        ) : (
          <>
            <p className="td-who">
              <span className="td-who__label">{r.mode === "done" ? "Ходил(а)" : "Ходит"}</span>
              <span className="td-who__name">
                <NameText name={nameOf(session, who)} />
              </span>
              <span className="td-who__round">
                круг {roundOf(r)}
                {content.rounds > 0 ? ` из ${content.rounds}` : ""}
              </span>
            </p>
            {r.mode === "pick" ? (
              <>
                <div className="td-deck is-choosing">
                  <SplitBack />
                </div>
                <p className="td-note">Выбирает на телефоне…</p>
              </>
            ) : r.card ? (
              <>
                <FaceCard session={session} card={r.card} stamp={r.mode === "done" ? r.outcome : null} />
                {r.mode === "done" && r.delta !== 0 && <p className={`td-delta${r.delta > 0 ? " is-plus" : " is-minus"}`}>{r.delta > 0 ? `+${r.delta}` : r.delta}</p>}
              </>
            ) : null}
          </>
        )}
      </section>
      {stage !== "ready" && <Queue session={session} r={r} />}
    </div>
  );
}

const IDEAS: Record<TruthKind, string> = {
  truth: "Например: «Кого из гостей вы знаете дольше всех и как познакомились?»",
  dare: "Например: «Произнесите тост голосом диктора новостей»",
};

/** Своё задание: вид и текст, отправка ведущему. */
function Suggest({ sent, sending, onSend }: { sent: { kind: TruthKind; text: string } | null; sending: boolean; onSend: (v: { kind: TruthKind; text: string }) => void }) {
  const [kind, setKind] = useState<TruthKind>("dare");
  const [text, setText] = useState("");
  if (sent) {
    return (
      <p className="buzz__plate">
        <strong>Отправлено ведущему: {KIND_TITLES[sent.kind]}</strong>
        <span>«{sent.text}» — если ведущий возьмёт, карточка выпадет кому-то из игроков. Следующее — в следующий ход.</span>
      </p>
    );
  }
  return (
    <details className="td-suggest">
      <summary>Предложить свой вопрос или задание</summary>
      <div className="stack stack--tight">
        <div className="td-suggest__kinds" role="radiogroup" aria-label="Вид">
          {(["truth", "dare"] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={`td-chip td-chip--${k}`} onClick={() => setKind(k)}>
              {KIND_TITLES[k]}
            </button>
          ))}
        </div>
        <label className="field">
          <span className="visually-hidden">Текст</span>
          <textarea className="input" rows={3} maxLength={TRUTH_LIMITS.text} value={text} placeholder={IDEAS[kind]} onChange={(e) => setText(e.target.value)} />
        </label>
        <button type="button" className="btn btn--secondary btn--block" disabled={sending || text.trim().length < 3} onClick={() => onSend({ kind, text: text.trim() })}>
          Отправить ведущему
        </button>
        <p className="muted small">Ведущий сам решит, брать ли ваше задание. Имя автора увидят на экране.</p>
      </div>
    </details>
  );
}

export function TruthPlayerView({ session, content, pid, role, myAnswer, sending, onAnswer, personal }: PlayerViewProps<TruthContent, TruthAnswerValue>) {
  const r = parseTruthResult(session.state.result);
  const { stage } = session.state;
  const who = turnPid(r);
  const mine = who === pid;
  const teams = session.playMode === "teams";
  const myChoice = myAnswer ? choiceOf(myAnswer.value) : null;
  // Предложение: в командах — свой ответ телефона, в одиночной игре — ответ игрока (когда не его ход).
  const sentRaw = teams ? personal?.value : myAnswer;
  const sent = sentRaw ? suggestionOf(sentRaw.value) : null;
  const sendSuggest = (v: { kind: TruthKind; text: string }) => (teams ? personal?.send({ suggest: v }) : onAnswer({ suggest: v }));
  const me = session.leaderboard[pid];
  const canSuggest = content.guestCards && stage === "question" && !(mine && !teams) && (teams ? personal !== undefined : true);

  const head = (
    <p className="eyebrow">
      Правда или действие{r.order.length > 0 ? ` · круг ${roundOf(r)}` : ""}
      {me ? ` · ${pointsLabel(me.score)}` : ""}
    </p>
  );

  if (stage === "ready" || r.order.length === 0) {
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        <div className="td-deck td-deck--phone">
          <SplitBack size="phone" />
        </div>
        <h2>Скоро начнём</h2>
        <p className="muted">Когда настанет ваш ход, выберете здесь: правда или действие.</p>
      </div>
    );
  }

  let body;
  if (r.mode === "pick" && mine) {
    body =
      role === "member" ? (
        <h2>Ваша команда ходит — выбирает капитан</h2>
      ) : myChoice ? (
        <p className="success">Выбрано: {KIND_TITLES[myChoice]}. Смотрите на экран!</p>
      ) : (
        <>
          <h2>Ваш ход! Что выбираете?</h2>
          <p className="muted small">Коснитесь половины карты.</p>
          <div className="td-deck td-deck--phone">
            <SplitBack size="phone" onPick={(kind) => onAnswer({ choice: kind })} disabled={sending} />
          </div>
          <p className="muted small">
            Правда — +{content.truthPoints}, действие — +{content.darePoints}
            {content.refusePenalty > 0 ? `, отказ — −${content.refusePenalty}` : ""}.
          </p>
        </>
      );
  } else if (r.mode === "pick") {
    body = (
      <p className="td-phone-who">
        Ходит <NameText name={nameOf(session, who)} /> — выбирает…
      </p>
    );
  } else if (r.card) {
    body = (
      <>
        {!mine && (
          <p className="td-phone-who">
            Ходит <NameText name={nameOf(session, who)} />
          </p>
        )}
        <FaceCard session={session} card={r.card} size="phone" stamp={r.mode === "done" ? r.outcome : null} />
        {mine && r.mode === "card" && <p className="success">{r.card.kind === "truth" ? "Отвечайте честно — ведущий засчитает" : "Выполняйте — ведущий засчитает"}</p>}
        {r.mode === "done" && mine && r.delta !== 0 && <p className={r.delta > 0 ? "success" : "error"}>{r.delta > 0 ? `+${r.delta} очков` : `${r.delta} очков`}</p>}
      </>
    );
  }

  return (
    <div className="quiz-phone td-phone">
      {head}
      {body}
      {canSuggest && <Suggest sent={sent} sending={teams ? (personal?.sending ?? false) : sending} onSend={sendSuggest} />}
    </div>
  );
}
