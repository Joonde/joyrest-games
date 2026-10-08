// «Бой с драконом»: на экране зала — дракон с полоской здоровья, задание и герои команд (жизни, урон);
// на телефоне капитана — выбор героя и свойств, ответы, кубик.
import { useEffect, useRef, useState } from "react";
import { Confetti } from "../../components/live/Confetti";
import { playSound } from "../../components/live/sound";
import { DragonArt, dragonKind, type DragonKind, type DragonMood } from "./DragonArt";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import { pointsLabel } from "../../core/results";
import { acceptsAnswers, secondsLeft } from "../../core/session";
import type { Session } from "../../data/types";
import type { PlayerViewProps, ViewProps } from "../types";
import { HEROES, heroOf, STAT_MAX, STAT_POINTS, STATS, statTitle, type DragonContent, type DragonTask, type Stat, type Stats } from "./content";
import { battleOf, maxLives, parseDragonResult, taskOf, type DragonResult } from "./logic";

export type DragonAnswerValue = { hero: string; stats: Stats } | { choice: number } | { roll: true };

const LETTERS = ["A", "B", "C", "D"];
const nameOf = (session: Session, pid: string | null) => (pid ? (session.leaderboard[pid]?.name ?? "") : "");

function Hearts({ lives, max }: { lives: number; max: number }) {
  return (
    <span className="dr-hearts" aria-label={`Жизни: ${lives} из ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < lives ? "dr-heart is-on" : "dr-heart"} aria-hidden="true">
          {i < lives ? "❤️" : "🖤"}
        </span>
      ))}
    </span>
  );
}

function StatBadge({ stat }: { stat: Stat }) {
  const s = STATS.find((x) => x.id === stat);
  return (
    <span className="dr-stat">
      {s?.icon} {s?.title}
    </span>
  );
}

function TaskCard({ task, reveal, size = "screen" }: { task: DragonTask; reveal: boolean; size?: "screen" | "phone" }) {
  return (
    <div className={`dr-task dr-task--${size}`}>
      <StatBadge stat={task.stat} />
      <p className="dr-task__text">{task.kind === "dice" ? task.text || "Бросайте кубик!" : task.text}</p>
      {task.kind === "choice" && (
        <ol className="mil-options">
          {task.options.map((o, i) => (
            <li key={i} className={`mil-option${reveal && i === task.correct ? " is-right" : ""}`}>
              <span className="mil-option__letter">{LETTERS[i]}</span>
              <span className="mil-option__text">{o}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Герои команд: значок героя, имя команды, жизни, урон в этом бою и за последнее задание. */
export function HeroRow({ session, content, result, size = "screen" }: { session: Session; content: DragonContent; result: DragonResult; size?: "screen" | "phone" }) {
  const reveal = result.phase === "reveal" || result.phase === "victory";
  return (
    <ul className={`dr-heroes dr-heroes--${size}`} style={{ gridTemplateColumns: `repeat(${size === "phone" ? Math.min(2, Math.max(1, result.order.length)) : result.order.length <= 6 ? Math.max(1, result.order.length) : Math.ceil(result.order.length / 2)}, minmax(0, 1fr))` }}>
      {result.order.map((p) => {
        const h = result.heroes[p];
        const hero = heroOf(h?.hero);
        const dead = result.dead.includes(p);
        const hit = result.last[p];
        return (
          <li key={p} className={`dr-hero${dead ? " is-dead" : ""}${result.killer === p ? " is-killer" : ""}`}>
            <span className="dr-hero__icon" aria-hidden="true">
              {dead ? "💀" : (hero?.icon ?? "❔")}
            </span>
            <span className="dr-hero__name">
              <NameText name={nameOf(session, p)} />
            </span>
            <span className="dr-hero__kind">{hero ? `${hero.name} · ${hero.ability}` : "Герой выбирается"}</span>
            {result.phase !== "heroes" && <Hearts lives={result.lives[p] ?? 0} max={maxLives(content, h)} />}
            {reveal && hit && (
              <span key={`${session.state.step}:${p}`} className={`dr-hero__hit${hit.damage > 0 ? " is-ok" : " is-miss"}`}>
                {hit.damage > 0 ? `−${hit.damage} 🐉` : hit.saved === "shield" ? "🛡 щит!" : hit.saved === "dodge" ? "💨 увернулись" : hit.lost > 0 ? "−1 ❤️" : ""}
                {hit.roll ? ` 🎲${hit.roll}` : ""}
                {hit.healed ? " +❤️" : ""}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function DragonBar({ name, hp, max, kind, mood, pulse }: { name: string; hp: number; max: number; kind: DragonKind; mood: DragonMood; pulse: string }) {
  const share = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
  return (
    <div className="dr-dragon">
      <DragonArt kind={kind} mood={hp === 0 ? "down" : mood} pulse={pulse} />
      <div className="dr-dragon__side">
        <p className="dr-dragon__name">{name}</p>
        <div className="dr-dragon__bar" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={hp} aria-label={`${name}: здоровье ${hp} из ${max}`}>
          <span className="dr-dragon__fill" style={{ width: `${share * 100}%` }} />
          <span className="dr-dragon__hp">
            {hp.toLocaleString("ru-RU")} / {max.toLocaleString("ru-RU")}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Что делает дракон после «Удар!»: ранен (урон), бьёт сам (кто-то потерял жизнь), то и другое. */
function moodOf(r: ReturnType<typeof parseDragonResult>): DragonMood {
  if (r.phase === "defeat") return "attack";
  if (r.phase !== "reveal" && r.phase !== "victory") return "idle";
  const hits = Object.values(r.last);
  const hurt = hits.some((h) => h.damage > 0);
  const attack = hits.some((h) => h.lost > 0 || h.saved === "shield" || h.saved === "dodge");
  return hurt && attack ? "hurtAttack" : hurt ? "hurt" : attack ? "attack" : "idle";
}

export function DragonScreenView({ session, content }: ViewProps<DragonContent>) {
  const r = parseDragonResult(session.state.result);
  const { stage, step } = session.state;
  const battle = battleOf(content, r);
  const task = taskOf(content, r);
  const now = useServerNow(250, stage === "question");
  const left = stage === "question" ? secondsLeft(session.state, now) : null;
  const prev = useRef(`${step}:${r.phase}`);
  useEffect(() => {
    const key = `${step}:${r.phase}`;
    if (prev.current !== key) {
      const mood = moodOf(r);
      if (r.phase === "victory") {
        // Предсмертный рык, потом фанфары.
        playSound("roar");
        window.setTimeout(() => playSound("fanfare"), 1300);
      } else if (r.phase === "defeat") {
        playSound("flame");
        window.setTimeout(() => playSound("roar"), 700);
      } else if (r.phase === "reveal") {
        // Ранен — рычит от боли; бьёт в ответ — пламя.
        if (mood === "hurt" || mood === "hurtAttack") playSound("roar");
        if (mood === "attack" || mood === "hurtAttack") window.setTimeout(() => playSound("flame"), mood === "hurtAttack" ? 900 : 0);
        if (mood === "idle") playSound("wrong");
      } else if (r.phase === "intro") playSound(r.task === 0 ? "roar" : "gong");
    }
    prev.current = key;
  }, [step, r.phase, r.last]);

  const killer = nameOf(session, r.killer);
  const mvp = [...r.order].sort((a, b) => (r.dmg[b] ?? 0) - (r.dmg[a] ?? 0))[0] ?? null;

  return (
    <div className="dr-screen">
      {r.phase === "victory" && <Confetti burst={`dr:${step}`} />}
      {r.order.length === 0 || r.phase === "heroes" ? (
        <section className="dr-screen__main">
          <span className="quiz-screen__badge">Бой с драконом</span>
          {content.battles[0] && (
            <div className="dr-screen__preview">
              <DragonArt kind={dragonKind(content.battles[0].name, 0)} mood="idle" pulse="preview" />
            </div>
          )}
          <h2 className="dr-title">{r.phase === "heroes" ? "Капитаны выбирают героев" : "Скоро в бой!"}</h2>
          <p className="dr-note">У каждого героя своя сила. Капитан раскладывает {STAT_POINTS} очков по свойствам: Сила, Ум, Ловкость, Удача, Харизма.</p>
          {r.phase === "heroes" && session.state.answered > 0 && <p className="dr-note">Выбрали: {session.state.answered} из {r.order.length}</p>}
        </section>
      ) : r.phase === "over" ? (
        <section className="dr-screen__main">
          <h2 className="dr-title">Битвы окончены!</h2>
        </section>
      ) : (
        <section className="dr-screen__main">
          {battle && <DragonBar name={battle.name} hp={r.hp} max={battle.hp} kind={dragonKind(battle.name, r.battle)} mood={moodOf(r)} pulse={`${step}:${r.phase}`} />}
          {r.phase === "intro" && task ? (
            <>
              <span className="quiz-screen__badge">
                Бой {r.battle + 1} · задание {r.task + 1} из {battle?.tasks.length ?? 0}
              </span>
              <h2 className="dr-title">
                <StatBadge stat={task.stat} />
              </h2>
              <p className="dr-note">{task.kind === "dice" ? "Капитаны бросают кубик" : task.kind === "task" ? "Активное задание — засчитывает ведущий" : "Вопрос — отвечает капитан"}</p>
            </>
          ) : r.phase === "victory" ? (
            <>
              <h2 className="dr-title">Дракон повержен! 🏆</h2>
              {killer && (
                <p className="dr-who">
                  Последний удар — <NameText name={killer} /> (+{content.killBonus})
                </p>
              )}
            </>
          ) : r.phase === "defeat" ? (
            <>
              <h2 className="dr-title">Дракон победил 🔥</h2>
              <p className="dr-note">Очки этого боя сгорели. Следующий бой — новый шанс!</p>
            </>
          ) : task ? (
            <>
              <span className="quiz-screen__badge">
                Задание {r.task + 1}
                {left !== null ? ` · ${left} с` : ""}
              </span>
              <TaskCard task={task} reveal={stage === "reveal"} />
            </>
          ) : null}
          {(r.phase === "victory" || r.phase === "defeat") && mvp && (r.dmg[mvp] ?? 0) > 0 && (
            <p className="dr-note">
              Больше всех урона: <NameText name={nameOf(session, mvp)} /> — {r.dmg[mvp]}
            </p>
          )}
        </section>
      )}
      <section className="dr-screen__heroes" aria-label="Герои">
        <HeroRow session={session} content={content} result={r} />
      </section>
    </div>
  );
}

function HeroPicker({ onSend, sending }: { onSend: (value: DragonAnswerValue) => void; sending: boolean }) {
  const [hero, setHero] = useState<string>(HEROES[0]?.id ?? "knight");
  const [stats, setStats] = useState<Stats>({ str: 1, mind: 1, agi: 1, luck: 1, cha: 1 });
  const used = Object.values(stats).reduce((a, b) => a + b, 0);
  const change = (s: Stat, d: number) => setStats((cur) => ({ ...cur, [s]: Math.max(0, Math.min(STAT_MAX, cur[s] + d)) }));
  const chosen = heroOf(hero);
  return (
    <div className="stack">
      <h2>Выберите героя</h2>
      <div className="dr-pick" role="radiogroup" aria-label="Герой">
        {HEROES.map((h) => (
          <button key={h.id} type="button" role="radio" aria-checked={hero === h.id} className="dr-pick__item" onClick={() => setHero(h.id)}>
            <span className="dr-pick__icon" aria-hidden="true">
              {h.icon}
            </span>
            <span className="dr-pick__name">{h.name}</span>
          </button>
        ))}
      </div>
      {chosen && (
        <p className="buzz__plate" role="status">
          <strong>
            {chosen.icon} {chosen.ability}
          </strong>
          <span>{chosen.hint}</span>
        </p>
      )}
      <h2>Свойства · осталось {STAT_POINTS - used}</h2>
      <ul className="dr-stats">
        {STATS.map((s) => (
          <li key={s.id} className="dr-stats__row">
            <span className="dr-stats__name">
              {s.icon} {s.title}
              <span className="muted small"> — {s.hint}</span>
            </span>
            <span className="dr-stats__ctrl">
              <button type="button" className="btn btn--secondary" aria-label={`${s.title}: меньше`} disabled={stats[s.id] <= 0} onClick={() => change(s.id, -1)}>
                −
              </button>
              <strong aria-live="polite">{stats[s.id]}</strong>
              <button type="button" className="btn btn--secondary" aria-label={`${s.title}: больше`} disabled={stats[s.id] >= STAT_MAX || used >= STAT_POINTS} onClick={() => change(s.id, 1)}>
                +
              </button>
            </span>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn--block" disabled={sending || used === 0} onClick={() => onSend({ hero, stats })}>
        В бой с героем «{chosen?.name}»
      </button>
    </div>
  );
}

export function DragonPlayerView({ session, content, pid, role, myAnswer, sending, onAnswer }: PlayerViewProps<DragonContent, DragonAnswerValue>) {
  const r = parseDragonResult(session.state.result);
  const { stage } = session.state;
  const now = useServerNow(500, stage === "question");
  const open = acceptsAnswers(session.state, now);
  const task = taskOf(content, r);
  const mine = r.heroes[pid];
  const hero = heroOf(mine?.hero);
  const dead = r.dead.includes(pid);
  const canAct = role !== "member" && open && !myAnswer && r.order.includes(pid) && !dead;
  const head = (
    <p className="eyebrow">
      Бой с драконом{hero ? ` · ${hero.icon} ${hero.name}` : ""}
      {mine && r.phase !== "heroes" ? ` · ❤️ ${r.lives[pid] ?? 0}` : ""}
      {session.leaderboard[pid] ? ` · ${pointsLabel(session.leaderboard[pid]?.score ?? 0)}` : ""}
    </p>
  );

  if (r.phase === "heroes") {
    return (
      <div className="quiz-phone">
        {head}
        {canAct ? (
          <HeroPicker sending={sending} onSend={onAnswer} />
        ) : myAnswer ? (
          <p className="success">Герой выбран — ждём остальных</p>
        ) : (
          <h2>{role === "member" ? "Капитан выбирает героя" : "Скоро в бой!"}</h2>
        )}
      </div>
    );
  }
  if (r.order.length === 0 || r.phase === "over" || r.phase === "intro" || !task) {
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        <h2>{r.phase === "over" ? "Битвы окончены!" : r.phase === "intro" && task ? `Задание ${r.task + 1}: ${statTitle(task.stat)}` : "Скоро в бой!"}</h2>
        {r.phase === "intro" && mine && task && <p className="muted">Ваше свойство «{statTitle(task.stat)}» — {mine.stats[task.stat]}. Урон ×{1 + mine.stats[task.stat]}.</p>}
      </div>
    );
  }
  if (r.phase === "victory" || r.phase === "defeat") {
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        <h2>{r.phase === "victory" ? "Дракон повержен! 🏆" : "Дракон победил 🔥"}</h2>
        {r.killer === pid && <p className="success">Последний удар — ваш! +{content.killBonus}</p>}
        {r.phase === "defeat" && <p className="muted">Очки этого боя сгорели. Следующий бой — новый шанс.</p>}
      </div>
    );
  }
  const hit = r.last[pid];
  return (
    <div className="quiz-phone">
      {head}
      {dead && stage === "question" ? (
        <div className="buzz__plate">
          <strong>💀 Ваш герой пал в этом бою</strong>
          <span>В следующем бою вы снова в строю</span>
        </div>
      ) : stage === "question" && task.kind === "choice" && canAct ? (
        <>
          <TaskCard task={task} reveal={false} size="phone" />
          <div className="mil-phone-options">
            {task.options.map((o, i) => (
              <button key={i} type="button" className="btn btn--secondary mil-phone-option" disabled={sending} onClick={() => onAnswer({ choice: i })}>
                <span className="mil-option__letter">{LETTERS[i]}</span> {o}
              </button>
            ))}
          </div>
        </>
      ) : stage === "question" && task.kind === "dice" && canAct ? (
        <div className="buzz">
          <button type="button" className="buzz__button quest-roll" disabled={sending} onClick={() => onAnswer({ roll: true })}>
            🎲
            <span>Бросить кубик</span>
          </button>
          <div className="buzz__plate buzz__plate--glow" role="status">
            <strong>Удача: {mine?.stats.luck ?? 0}</strong>
            <span>Число выпадет на экране зала</span>
          </div>
        </div>
      ) : (
        <>
          <TaskCard task={task} reveal={stage === "reveal"} size="phone" />
          {stage === "question" && task.kind === "task" && <p className="muted">Выполняйте — ведущий засчитает удар.</p>}
          {stage === "question" && myAnswer && <p className="success">Отправлено — смотрите на экран</p>}
          {stage === "question" && role === "member" && task.kind !== "task" && <p className="muted">Отвечает капитан — подсказывайте!</p>}
        </>
      )}
      {stage === "reveal" && hit && (
        <p className={hit.damage > 0 ? "success" : "error"}>
          {hit.damage > 0 ? `Удар! −${hit.damage} дракону` : hit.saved === "shield" ? "Щит рыцаря спас!" : hit.saved === "dodge" ? "Увернулись!" : hit.lost > 0 ? "Дракон ранил: −1 ❤️" : ""}
          {hit.healed ? " · Жрица вернула жизнь" : ""}
        </p>
      )}
      {session.screenMode === "none" && <HeroRow session={session} content={content} result={r} size="phone" />}
    </div>
  );
}
