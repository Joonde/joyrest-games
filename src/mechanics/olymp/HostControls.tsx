import { useEffect, useRef, useState } from "react";
import { useConfirm } from "../../components/ConfirmDialog";
import { PodiumHostList } from "../../components/live/Podium";
import { NameText } from "../../components/NameText";
import { awardNow, podiumNext } from "../../core/podium";
import { scoringParticipants } from "../../core/leaderboard";
import { resultKey } from "../../core/session";
import type { Session, SessionChange } from "../../data/types";
import type { HostControlsProps } from "../types";
import { abilitiesOf, godOf } from "./gods";
import { foeOf } from "./foes";
import { intentOf } from "./combat";
import { OUTCOME_NAMES, STAT_NAMES, threshold } from "./rules";
import { storyOf, type OlympContent } from "./content";
import {
  actionOf,
  closePick,
  closeVote,
  currentScene,
  fightResult,
  godName,
  godTurn,
  hpMaxOfMember,
  memberStat,
  nextScene,
  nextTurn,
  olympBack,
  olympPrimary,
  openRoll,
  openVote,
  parseOlympResult,
  readyAbilities,
  setRoller,
  showRoll,
  startFight,
  startOlymp,
  type Member,
} from "./logic";
import { Emblem } from "./views";

/**
 * Пульт «Олимпа»: ведущий читает сцену (текст — здесь), жмёт «Дальше», «Бросок», «Голосование»,
 * «Начать бой». В бою — ход бога (способность с телефона капитана или выбор ведущего) и «Следующий ход».
 */
export function OlympHostControls({ session, content, answers, participants, control, rehearsal }: HostControlsProps<OlympContent>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [dialog, confirm] = useConfirm();
  const latest = useRef<Session>(session);
  const waiters = useRef<Array<() => void>>([]);
  useEffect(() => {
    latest.current = session;
    const done = waiters.current;
    waiters.current = [];
    done.forEach((w) => w());
  }, [session]);
  const { stage, step } = session.state;
  // Выбор способности ведущим сбрасывается только с новым шагом (новый ход), а не при любом
  // обновлении сессии — вход гостя или счётчик ответов не стирают выбор.
  useEffect(() => {
    setPick(null);
  }, [step]);
  const r = parseOlympResult(session.state.result);
  const scene = currentScene(content, r);
  const noTeams = scoringParticipants(participants, session.playMode).length === 0 && Object.keys(session.leaderboard).length === 0;
  const action = olympPrimary(session, content);
  const back = olympBack(session);
  const b = r.battle;

  function nextSession(): Promise<void> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(resolve, 3000);
      waiters.current.push(() => {
        window.clearTimeout(timer);
        resolve();
      });
    });
  }

  async function run(make: SessionChange | null | (() => Promise<SessionChange | null>)) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { phase, step: atStep, stage: atStage } = session.state;
    const seen = resultKey(session.state.result);
    try {
      const change = typeof make === "function" ? await make() : make;
      if (!change) {
        setError("Это действие сейчас недоступно.");
        return;
      }
      const arrived = rehearsal ? Promise.resolve() : nextSession();
      await control.apply({ ...change, expect: { phase, step: atStep, stage: atStage, result: seen } });
      await arrived;
    } catch (e) {
      if (!(typeof e === "object" && e !== null && "code" in e && e.code === "failed-precondition")) setError("Не получилось. Проверьте интернет и нажмите ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  const fresh = <T,>(make: (list: typeof answers) => T) => () => control.freshAnswers(step).then((list) => make(list.length > 0 ? list : answers));
  const team = (p: string | null) => (p ? (session.leaderboard[p]?.name ?? participants.find((x) => x.id === p)?.name ?? "") : "");
  const answered = new Set(answers.filter((a) => a.step === step && (a.submittedAt ?? 0) >= (session.state.startedAt ?? 0)).map((a) => a.pid));
  const primary = "btn btn--block host-quiz__primary";

  // ---- текст сцены для ведущего
  const sceneCard = scene && r.phase !== "pick" && (
    <div className="card stack stack--tight">
      <p className="eyebrow">
        {storyOf(content).title} · {scene.title}
      </p>
      <p className="ol-host-text">{scene.text}</p>
      {scene.kind === "check" && <p className="muted small">{scene.action}</p>}
    </div>
  );

  return (
    <div className="stack host-quiz">
      <p className="eyebrow">
        Олимп · {r.order.length} {r.order.length === 1 ? "бог" : r.order.length < 5 ? "бога" : "богов"}
        {r.flags.length > 0 ? ` · Сага: ${r.flags.length}` : ""}
      </p>
      {stage === "podium" ? (
        <PodiumHostList session={session} />
      ) : r.order.length === 0 ? (
        <p className="muted">Капитаны выберут богов: одна команда — один бог. Потом ведущий читает сцены, команды бросают кубик, голосуют и сражаются.</p>
      ) : r.phase === "pick" ? (
        <p>
          Богов выбрали: {[...answered].filter((p) => r.order.includes(p)).length} из {r.order.length}. Кто не успеет — получит первого свободного бога.
        </p>
      ) : (
        sceneCard
      )}

      {r.phase === "check" && scene?.kind === "check" && r.check && (
        <section className="card stack stack--tight">
          <p className="eyebrow">
            Бросает · {STAT_NAMES[scene.stat]}
          </p>
          {!r.check.outcome && stage !== "question" && (
            <div className="ol-host-who">
              {r.order
                .filter((p) => r.party[p])
                .map((p) => {
                  const m = r.party[p] as Member;
                  return (
                    <button key={p} type="button" className="column-opt" aria-pressed={r.check?.who === p} disabled={busy} onClick={() => void run(setRoller(session, participants, p))}>
                      <Emblem god={godOf(m.god)} size={26} />
                      <span className="line-clamp">
                        {godOf(m.god)?.name} · <NameText name={team(p)} /> · {STAT_NAMES[scene.stat]} {memberStat(m, scene.stat)}
                      </span>
                    </button>
                  );
                })}
            </div>
          )}
          {r.check.who && (
            <p className="small">
              {godName(r, r.check.who)}: порог {threshold(memberStat(r.party[r.check.who] as Member, scene.stat))}, «хорошо» от {threshold(memberStat(r.party[r.check.who] as Member, scene.stat)) + 20}
              {stage === "question" ? (answered.has(r.check.who) ? " · бросок пришёл" : " · ждём бросок с телефона") : ""}
            </p>
          )}
          {r.check.outcome && (
            <p>
              <b>
                {r.check.roll} — {OUTCOME_NAMES[r.check.outcome]}
              </b>
              : {scene.outcomes[r.check.outcome].text}
            </p>
          )}
        </section>
      )}

      {r.phase === "vote" && scene?.kind === "vote" && r.vote && (
        <section className="card stack stack--tight">
          <ol className="ol-host-list">
            {r.vote.options.map((o, i) => (
              <li key={o} className={r.vote?.picked === i ? "is-picked" : undefined}>
                {scene.options[o]?.label}
                {r.vote?.picked !== null ? ` — ${r.vote?.tally[i] ?? 0}` : ""}
              </li>
            ))}
          </ol>
          {stage === "question" && (
            <p className="small">
              Проголосовали: {[...answered].filter((p) => r.order.includes(p)).length} из {r.order.length}
            </p>
          )}
        </section>
      )}

      {(r.phase === "fight" || r.phase === "fightEnd") && b && (
        <section className="card stack stack--tight">
          <p className="eyebrow">
            {foeOf(b.foe)?.name} · {b.fighters.find((f) => f.side === "foe")?.hp} / {b.fighters.find((f) => f.side === "foe")?.hpMax}
            {!b.over ? ` · готовит «${intentOf(b)?.name ?? ""}»` : ""}
          </p>
          {b.log.slice(0, 2).map((e) => (
            <p key={e.n} className="small">
              {e.x}
            </p>
          ))}
          {action === "act" && b.actor && (
            <>
              <p>
                <b>Ход: {b.fighters.find((f) => f.id === b.actor)?.name}</b> · <NameText name={team(b.actor)} />
              </p>
              {(() => {
                const sent = actionOf(answers, session, b.actor);
                const actorGod = godOf(b.fighters.find((f) => f.id === b.actor)?.ref);
                const ab = sent && actorGod ? abilitiesOf(actorGod).find((a) => a.id === sent.ability) : undefined;
                return sent && ab ? <p className="success small">Капитан выбрал «{ab.name}»{sent.target ? ` → ${b.fighters.find((f) => f.id === sent.target)?.name ?? ""}` : ""}</p> : <p className="muted small">Ждём выбор капитана — или выберите за команду:</p>;
              })()}
              <div className="ol-host-abil">
                {readyAbilities(b, b.actor).map((a) => (
                  <button key={a.id} type="button" className="column-opt" aria-pressed={pick === a.id} disabled={busy} onClick={() => setPick(pick === a.id ? null : a.id)}>
                    <span className="line-clamp">
                      {a.name}
                      {a.ult ? " · ульта" : ""}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          {r.phase === "fightEnd" && r.fightEnd && (
            <p>
              {r.fightEnd.win ? `Победа! Опыт: ${Object.entries(r.fightEnd.xp).map(([p, v]) => `${godName(r, p)} +${v}`).join(", ")}` : "Отряд отступает: наград нет, история продолжается."}
            </p>
          )}
        </section>
      )}

      {r.order.length > 0 && r.phase !== "pick" && (
        <details className="quest-host__places">
          <summary>Отряд: здоровье, опыт, драхмы</summary>
          <ol>
            {r.order
              .filter((p) => r.party[p])
              .map((p) => {
                const m = r.party[p] as Member;
                const f = b?.fighters.find((x) => x.id === p);
                return (
                  <li key={p}>
                    {godOf(m.god)?.name} · <NameText name={team(p)} /> — ❤ {f ? f.hp : m.hp}/{f ? f.hpMax : hpMaxOfMember(m)}, опыт {m.xp}, ◉ {m.coins}
                    {m.effects.length ? ` · ${m.effects.map((e) => e.name).join(", ")}` : ""}
                  </li>
                );
              })}
          </ol>
        </details>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        {action === "start" && (
          <>
            {noTeams && <p className="muted small">Ждём, пока подключатся команды.</p>}
            <button type="button" className={primary} disabled={busy || noTeams} onClick={() => void run(startOlymp(session, participants))}>
              Выбор богов
            </button>
          </>
        )}
        {action === "pickDone" && (
          <button type="button" className={primary} disabled={busy} onClick={() => void run(fresh((list) => closePick(latest.current, content, list, participants)))}>
            Боги выбраны — в путь!
          </button>
        )}
        {action === "next" && (
          <button type="button" className={primary} disabled={busy} onClick={() => void run(nextScene(session, content, participants))}>
            Дальше
          </button>
        )}
        {action === "roll" && (
          <>
            <button type="button" className={primary} disabled={busy || !r.check?.who} onClick={() => void run(openRoll(session, participants))}>
              Бросок: {godName(r, r.check?.who)}
            </button>
          </>
        )}
        {action === "showRoll" && (
          <button type="button" className={primary} disabled={busy} onClick={() => void run(fresh((list) => showRoll(latest.current, content, list, participants)))}>
            {r.check?.who && answered.has(r.check.who) ? "Показать бросок" : "Бросить за команду"}
          </button>
        )}
        {action === "openVote" && (
          <button type="button" className={primary} disabled={busy} onClick={() => void run(openVote(session, content, participants))}>
            Голосование
          </button>
        )}
        {action === "closeVote" && (
          <button type="button" className={primary} disabled={busy} onClick={() => void run(fresh((list) => closeVote(latest.current, content, list, participants)))}>
            Итог голосования
          </button>
        )}
        {action === "fight" && (
          <button type="button" className={primary} disabled={busy} onClick={() => void run(startFight(session, content, participants))}>
            Начать бой
          </button>
        )}
        {action === "act" && b?.actor && (
          <button
            type="button"
            className={primary}
            disabled={busy || (!pick && !actionOf(answers, session, b.actor))}
            onClick={() => void run(fresh((list) => godTurn(latest.current, participants, list, pick ? { ability: pick, target: null } : undefined)))}
          >
            {pick ? "Бросок за команду" : "Показать ход"}
          </button>
        )}
        {action === "nextTurn" && (
          <button type="button" className={primary} disabled={busy} onClick={() => void run(nextTurn(session, participants))}>
            Следующий ход
          </button>
        )}
        {action === "fightResult" && (
          <button type="button" className={primary} disabled={busy} onClick={() => void run(fightResult(session, participants))}>
            Итог боя
          </button>
        )}
        {(action === "podium" || action === "podiumNext") && (
          <button type="button" className={primary} disabled={busy} onClick={() => void run(action === "podium" ? awardNow(session) : podiumNext(session))}>
            {action === "podium" ? "Награждение" : "Открыть следующее место"}
          </button>
        )}
        {action === "finish" && (
          <button type="button" className={primary} disabled={busy} onClick={() => control.requestFinish()}>
            Завершить игру
          </button>
        )}
        {/* Не во время броска, голосования и хода: таймер шага потом не вернуть «Назад». */}
        {stage !== "podium" && stage !== "question" && r.order.length > 0 && r.phase !== "pick" && r.phase !== "end" && (
          <button
            type="button"
            className="btn btn--quiet btn--block"
            disabled={busy}
            onClick={() =>
              confirm({
                title: "Закончить историю досрочно?",
                text: "Сразу награждение по опыту богов. «Назад» на награждении вернёт к истории.",
                confirmLabel: "К награждению",
                run: () => run(awardNow(session)),
              })
            }
          >
            Закончить досрочно
          </button>
        )}
        <button type="button" className="btn btn--secondary btn--block" disabled={busy || back === null} onClick={() => back && void run(back)}>
          Назад
        </button>
      </div>
      {dialog}
    </div>
  );
}
