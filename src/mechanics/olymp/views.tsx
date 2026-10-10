// «Олимп»: экран зала (сцена с погодой, бросок d100, голосование, бой с очередью ходов, концовка) и
// телефон гостя (выбор бога, бросок, голос, ход в бою; вкладки «Игра», «Мой бог», «Журнал»).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { playSound } from "../../components/live/sound";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import { acceptsAnswers, secondsLeft } from "../../core/session";
import type { Session } from "../../data/types";
import type { PlayerViewProps, ViewProps } from "../types";
import { abilitiesOf, godOf, GODS, ROLES, type Ability, type God } from "./gods";
import { foeOf } from "./foes";
import { intentOf, turnQueue, type Battle, type Fighter, type LogEntry } from "./combat";
import { ELEMENT_NAMES, OUTCOME_NAMES, STAT_NAMES, STATS, levelOf, threshold, xpToNext, type ElementId, type Outcome } from "./rules";
import { placeOf, sceneOf, visibleOptions, type Scene } from "./story";
import { storyOf, type OlympContent } from "./content";
import { currentScene, godName, hpMaxOfMember, memberRollMod, memberStat, parseOlympResult, readyAbilities, type Member, type OlympResult } from "./logic";

export type OlympAnswerValue = { god: string } | { roll: true } | { vote: number } | { ability: string; target: string | null };

export const ELEMENT_COLORS: Record<ElementId, string> = {
  fire: "#E8875A",
  water: "#6FA8D6",
  ice: "#9EC3D6",
  bolt: "#F3DFAE",
  earth: "#C9A15F",
  wind: "#A9D3B5",
  light: "#FBF1C7",
  dark: "#B3AADD",
  poison: "#9DCB6B",
  chaos: "#D98AB8",
};

const KIND_ICON: Record<string, [string, string]> = {
  fight: ["⚔", "#E8875A"],
  curse: ["☠", "#E3AA9C"],
  heal: ["✚", "#A3C2AA"],
  coin: ["◉", "#E3C68C"],
  level: ["★", "#F3DFAE"],
  start: ["⚑", "#9EC3D6"],
  vote: ["✓", "#B3AADD"],
  story: ["❧", "#CFE3EE"],
  idea: ["💡", "#CFE3EE"],
};

export function Emblem({ god, size = 40 }: { god: God | undefined; size?: number }) {
  if (!god) return <span className="ol-emb" style={{ width: size, height: size }} aria-hidden="true" />;
  return (
    <span className="ol-emb" style={{ width: size, height: size, fontSize: size * 0.45, ["--ec" as string]: ELEMENT_COLORS[god.element] }} aria-hidden="true">
      {god.name[0]}
    </span>
  );
}

function teamName(session: Session, pid: string): string {
  return session.leaderboard[pid]?.name ?? "";
}

function Bar({ value, max, kind = "hp" }: { value: number; max: number; kind?: "hp" | "foe" | "xp" | "shield" }) {
  const share = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <span className={`ol-bar ol-bar--${kind}${kind === "hp" && share < 0.35 ? " is-low" : ""}`} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <i style={{ width: `${share * 100}%` }} />
    </span>
  );
}

function LogLine({ e, fresh = false }: { e: LogEntry; fresh?: boolean }) {
  const [icon, color] = KIND_ICON[e.k] ?? (KIND_ICON.story as [string, string]);
  // Имена из `who` — жирным; остальной текст как есть (без HTML).
  const names = [...new Set(e.who.filter((n) => n && n !== "все"))].sort((a, b) => b.length - a.length);
  const parts: Array<{ t: string; b: boolean }> = [];
  let rest = e.x;
  while (rest) {
    let at = -1;
    let hit = "";
    for (const n of names) {
      const i = rest.indexOf(n);
      if (i >= 0 && (at < 0 || i < at)) {
        at = i;
        hit = n;
      }
    }
    if (at < 0) {
      parts.push({ t: rest, b: false });
      break;
    }
    if (at > 0) parts.push({ t: rest.slice(0, at), b: false });
    parts.push({ t: hit, b: true });
    rest = rest.slice(at + hit.length);
  }
  return (
    <li className={`ol-ev ol-ev--${e.k}${fresh ? " is-fresh" : ""}`}>
      <span className="ol-ev__i" style={{ ["--c" as string]: color }} aria-hidden="true">
        {icon}
      </span>
      <span>{parts.map((p, i) => (p.b ? <b key={i}>{p.t}</b> : <span key={i}>{p.t}</span>))}</span>
    </li>
  );
}

function Weather({ kind }: { kind: string }) {
  if (kind === "none") return null;
  const n = kind === "mist" ? 6 : kind === "embers" ? 18 : 30;
  return (
    <div className={`ol-weather ol-weather--${kind}`} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <i key={i} style={{ left: `${(i * 37) % 100}%`, top: kind === "mist" ? `${(i * 23) % 80}%` : undefined, animationDuration: `${(kind === "mist" ? 16 : 6) + ((i * 7) % 9)}s`, animationDelay: `${-((i * 13) % 17)}s` }} />
      ))}
    </div>
  );
}

function D100({ roll, outcome, spin }: { roll: number | null; outcome: Outcome | null; spin?: boolean }) {
  return (
    <div className="ol-die-row">
      <span className={`ol-die${spin ? " is-spin" : ""}`}>{roll ?? "?"}</span>
      {outcome && <span className={`ol-outcome ol-o-${outcome}`}>{OUTCOME_NAMES[outcome]}</span>}
    </div>
  );
}

function FighterRow({ f, session, current, size }: { f: Fighter; session: Session; current: boolean; size: "screen" | "phone" }) {
  const god = godOf(f.ref);
  return (
    <li className={`ol-fighter${current ? " is-current" : ""}${f.down ? " is-down" : ""} ol-fighter--${size}`}>
      <Emblem god={god} size={size === "screen" ? 44 : 34} />
      <span className="ol-fighter__body">
        <span className="ol-fighter__name">
          {f.name}
          {size === "screen" && teamName(session, f.id) && (
            <span className="ol-fighter__team">
              {" · "}
              <NameText name={teamName(session, f.id)} />
            </span>
          )}
        </span>
        <span className="ol-fighter__hp">
          <Bar value={f.hp} max={f.hpMax} />
          <span>
            {f.down ? "без сил" : `${f.hp}/${f.hpMax}`}
            {f.shield > 0 ? ` · щит ${f.shield}` : ""}
          </span>
        </span>
        {f.effects.length > 0 && (
          <span className="ol-chips">
            {f.effects.map((e) => (
              <span key={e.id} className={`ol-chip ${e.kind === "curse" ? "is-bad" : "is-good"}`}>
                {e.name} · {e.left}
              </span>
            ))}
          </span>
        )}
      </span>
    </li>
  );
}

function FoeCard({ b, size }: { b: Battle; size: "screen" | "phone" }) {
  const foe = foeOf(b.foe);
  const f = b.fighters.find((x) => x.side === "foe");
  if (!foe || !f) return null;
  const intent = b.over ? null : intentOf(b);
  const res = Object.entries(foe.resist).filter(([, v]) => v !== 100) as Array<[ElementId, number]>;
  return (
    <div className={`ol-foe ol-foe--${size}${foe.boss ? " is-boss" : ""}`}>
      {size === "screen" && foe.boss && <img className="ol-foe__img" src="/olymp/art/boss.jpg" alt="" />}
      <div className="ol-foe__body">
        <span className="ol-place">
          {foe.boss ? "Босс · " : ""}ранг {foe.rank} · {ELEMENT_NAMES[foe.element]}
        </span>
        <span className="ol-foe__name">{foe.name}</span>
        <span className="ol-foe__hp">
          <Bar value={f.hp} max={f.hpMax} kind="foe" />
          <b>
            {f.hp} / {f.hpMax}
          </b>
        </span>
        {intent && (
          <span className="ol-foe__intent">
            Готовит: <b>{intent.name}</b> — {intent.hint}
          </span>
        )}
        {f.effects.length > 0 && (
          <span className="ol-chips">
            {f.effects.map((e) => (
              <span key={e.id} className={`ol-chip ${e.kind === "curse" ? "is-bad" : "is-good"}`}>
                {e.name} · {e.left}
              </span>
            ))}
          </span>
        )}
        {size === "screen" && (
          <span className="ol-res">
            {res.map(([k, v]) => (
              <span key={k} className={v > 100 ? "is-weak" : "is-strong"}>
                {ELEMENT_NAMES[k]} {v}%
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

function Queue({ b }: { b: Battle }) {
  const q = turnQueue(b, 9);
  return (
    <ol className="ol-queue" aria-label="Очередь ходов">
      {q.map((id, i) => {
        const f = b.fighters.find((x) => x.id === id);
        return (
          <li key={`${id}-${i}`} className={`${i === 0 ? "is-now" : ""}${f?.side === "foe" ? " is-foe" : ""}`}>
            {f?.side === "foe" ? "Противник" : f?.name}
          </li>
        );
      })}
    </ol>
  );
}

function StoryHead({ scene, place }: { scene: Scene; place: string }) {
  return (
    <>
      <span className="ol-place">{place}</span>
      <h2 className="ol-title">{scene.title}</h2>
    </>
  );
}

/** Эффекты при новом шаге: звук броска, удара, голосования. */
function useOlympSounds(session: Session, r: OlympResult) {
  const prev = useRef(`${session.state.step}:${session.state.stage}:${r.seq}`);
  useEffect(() => {
    const key = `${session.state.step}:${session.state.stage}:${r.seq}`;
    if (prev.current !== key) {
      if (r.phase === "check" && r.check?.outcome) playSound(r.check.outcome === "crit" || r.check.outcome === "good" ? "correct" : r.check.outcome === "fail" ? "wrong" : "gong");
      else if (r.phase === "fightEnd") playSound(r.fightEnd?.win ? "fanfare" : "wrong");
      else if (r.phase === "fight" && r.lastDie) playSound(r.lastDie.outcome === "fail" ? "wrong" : "correct");
      else if (r.phase === "vote" && r.vote?.picked !== null && r.vote?.picked !== undefined) playSound("gong");
    }
    prev.current = key;
  }, [session.state.step, session.state.stage, r]);
}

export function OlympScreenView({ session, content }: ViewProps<OlympContent>) {
  const r = parseOlympResult(session.state.result);
  const story = storyOf(content);
  const scene = currentScene(content, r);
  const place = scene ? placeOf(story, scene.place) : undefined;
  const { stage } = session.state;
  const now = useServerNow(500, stage === "question");
  const left = stage === "question" ? secondsLeft(session.state, now) : null;
  useOlympSounds(session, r);
  const b = r.battle;

  let main: ReactNode;
  if (r.order.length === 0 || r.phase === "pick") {
    main = (
      <section className="ol-screen__main">
        <span className="ol-place">Олимп · 18+</span>
        <h2 className="ol-title">{story.title}</h2>
        <p className="ol-lead">{story.blurb}</p>
        <p className="ol-note">{r.phase === "pick" ? `Капитаны выбирают богов на телефонах · выбрали ${session.state.answered} из ${r.order.length}` : "Скоро начинаем: капитаны выберут богов"}</p>
        <ul className="ol-godgrid">
          {GODS.map((g) => (
            <li key={g.id}>
              <Emblem god={g} size={46} />
              <b>{g.name}</b>
              <small>
                {ROLES[g.role].name} · {ELEMENT_NAMES[g.element]}
              </small>
            </li>
          ))}
        </ul>
      </section>
    );
  } else if ((r.phase === "fight" || r.phase === "fightEnd") && b) {
    main = (
      <section className="ol-screen__fight">
        <FoeCard b={b} size="screen" />
        {!b.over && <Queue b={b} />}
        {r.lastDie && (
          <div className="ol-lastdie">
            <D100 roll={r.lastDie.roll} outcome={r.lastDie.outcome} />
            <span>
              {godName(r, r.lastDie.pid)}: «{r.lastDie.ability}»
            </span>
          </div>
        )}
        {r.phase === "fightEnd" && r.fightEnd ? (
          <div className="ol-result">
            <h2 className="ol-title">{r.fightEnd.win ? "Победа!" : "Отряд отступает"}</h2>
            {r.fightEnd.win && (
              <p className="ol-note">
                Опыт: {Object.entries(r.fightEnd.xp).map(([p, v]) => `${godName(r, p)} +${v}`).join(" · ")}
              </p>
            )}
          </div>
        ) : (
          <ul className="ol-log ol-log--screen" aria-live="polite">
            {b.log.slice(0, 3).map((e, i) => (
              <LogLine key={e.n} e={e} fresh={i === 0} />
            ))}
          </ul>
        )}
        {b.over && r.phase === "fight" && <h2 className="ol-title">{b.over === "win" ? "Противник повержен!" : "Отряд пал"}</h2>}
        <p className="ol-note ol-note--small">
          {/* Из бойцов, а не из журнала: журнал боя обрезан до последних записей. */}
          Урон отряда: {b.fighters.filter((f) => f.side === "god" && f.dealt > 0).map((f) => `${f.name} ${f.dealt}`).join(" · ") || "—"}
        </p>
      </section>
    );
  } else if (scene) {
    const check = r.phase === "check" ? r.check : null;
    const vote = r.phase === "vote" ? r.vote : null;
    main = (
      <section className="ol-screen__main">
        <StoryHead scene={scene} place={place?.name ?? ""} />
        {scene.kind === "end" ? <p className="ol-lead">{scene.text}</p> : <p className="ol-lead">{scene.screen}</p>}
        {check && scene.kind === "check" && (
          <div className="ol-check">
            <p className="ol-note">
              Бросает <b>{godName(r, check.who)}</b>
              {check.who && teamName(session, check.who) ? (
                <>
                  {" "}
                  (<NameText name={teamName(session, check.who)} />)
                </>
              ) : null}{" "}
              · {STAT_NAMES[scene.stat]}, порог {check.who && r.party[check.who] ? threshold(memberStat(r.party[check.who] as Member, scene.stat)) : "—"}
            </p>
            <D100 roll={check.roll} outcome={check.outcome} spin={stage === "question"} />
            {check.outcome && <p className="ol-lead ol-lead--small">{scene.outcomes[check.outcome].text}</p>}
            {check.chips.length > 0 && (
              <span className="ol-chips">
                {check.chips.map(({ t, k }, i) => (
                  <span key={i} className={`ol-chip is-${k}`}>
                    {t}
                  </span>
                ))}
              </span>
            )}
          </div>
        )}
        {vote && scene.kind === "vote" && (
          <>
          <ol className="ol-vote">
            {vote.options.map((o, i) => (
              <li key={o} className={vote.picked === i ? "is-picked" : ""}>
                <b>{scene.options[o]?.label}</b>
                <span>{scene.options[o]?.hint}</span>
                {vote.picked !== null && <em>{vote.tally[i] ?? 0}</em>}
              </li>
            ))}
          </ol>
            {stage === "question" && (
              <p className="ol-note">
                Голосуют капитаны · {session.state.answered} из {r.order.length}
                {left !== null ? ` · ${left} с` : ""}
              </p>
            )}
            {vote.tie && <p className="ol-note">Ничья — решил жребий</p>}
          </>
        )}
        {scene.kind === "fight" && <p className="ol-note">Сейчас начнётся бой: {foeOf(scene.foe)?.name}</p>}
      </section>
    );
  } else {
    main = <section className="ol-screen__main" />;
  }

  return (
    <div className={`ol-screen ol-place--${place?.id ?? "olympus"}`}>
      <Weather kind={r.phase === "fight" || r.phase === "fightEnd" ? "snow" : (place?.weather ?? "snow")} />
      {main}
      {r.order.length > 0 && r.phase !== "pick" && (
        <ul className="ol-party">
          {(b && (r.phase === "fight" || r.phase === "fightEnd") ? b.fighters.filter((f) => f.side === "god") : []).map((f) => (
            <FighterRow key={f.id} f={f} session={session} current={b?.actor === f.id && !b.over} size="screen" />
          ))}
          {!(b && (r.phase === "fight" || r.phase === "fightEnd")) &&
            r.order
              .filter((p) => r.party[p])
              .map((p) => {
                const m = r.party[p] as Member;
                const god = godOf(m.god);
                return (
                  <li key={p} className="ol-fighter ol-fighter--screen">
                    <Emblem god={god} size={44} />
                    <span className="ol-fighter__body">
                      <span className="ol-fighter__name">
                        {god?.name}
                        <span className="ol-fighter__team">
                          {" · "}
                          <NameText name={teamName(session, p)} />
                        </span>
                      </span>
                      <span className="ol-fighter__hp">
                        <Bar value={m.hp} max={hpMaxOfMember(m)} />
                        <span>
                          {levelOf(m.xp).level} ур. · {m.hp}/{hpMaxOfMember(m)}
                        </span>
                      </span>
                    </span>
                  </li>
                );
              })}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ телефон

function GodPicker({ onSend, sending }: { onSend: (v: OlympAnswerValue) => void; sending: boolean }) {
  const [god, setGod] = useState<string>(GODS[0]?.id ?? "zeus");
  const chosen = godOf(god);
  return (
    <div className="stack">
      <h2>Выберите бога</h2>
      <div className="ol-pick" role="radiogroup" aria-label="Бог">
        {GODS.map((g) => (
          <button key={g.id} type="button" role="radio" aria-checked={god === g.id} className="ol-pick__item" onClick={() => setGod(g.id)}>
            <Emblem god={g} size={36} />
            <span>
              <b>{g.name}</b>
              <small>
                {ROLES[g.role].name} · {ELEMENT_NAMES[g.element]}
              </small>
            </span>
          </button>
        ))}
      </div>
      {chosen && (
        <div className="ol-card">
          <p className="small">{chosen.about}</p>
          <ul className="ol-abil-list">
            {abilitiesOf(chosen).map((a) => (
              <li key={a.id}>
                <b>
                  {a.name}
                  {a.ult ? " · ульта" : ""}
                </b>{" "}
                — {a.text}
              </li>
            ))}
          </ul>
          <p className="muted small">Если бога уже взяла другая команда, вам достанется первый свободный.</p>
        </div>
      )}
      <button type="button" className="btn btn--block" disabled={sending} onClick={() => onSend({ god })}>
        Играть за: {chosen?.name}
      </button>
    </div>
  );
}

function kindLabel(a: Ability): string {
  return (
    {
      strike: "удар по одному",
      blast: "удар по всем",
      heal: a.target === "allies" ? "лечение всех" : "лечение",
      shield: a.target === "allies" ? "щит всем" : "щит союзнику",
      bless: "благословение",
      curse: "проклятие",
    } as Record<string, string>
  )[a.kind] ?? "";
}

function TurnPicker({ b, pid, onSend, sending }: { b: Battle; pid: string; onSend: (v: OlympAnswerValue) => void; sending: boolean }) {
  const [pending, setPending] = useState<string | null>(null);
  const me = b.fighters.find((f) => f.id === pid);
  const god = me ? godOf(me.ref) : undefined;
  if (!me || !god) return null;
  const ready = readyAbilities(b, pid).map((a) => a.id);
  const allies = b.fighters.filter((f) => f.side === "god" && !f.down);
  if (pending) {
    return (
      <div className="stack">
        <h2>На кого?</h2>
        <ul className="ol-party ol-party--phone">
          {allies.map((f) => (
            <li key={f.id}>
              <button type="button" className="ol-target" disabled={sending} onClick={() => onSend({ ability: pending, target: f.id })}>
                <Emblem god={godOf(f.ref)} size={30} />
                <span>
                  {f.name} · {f.hp}/{f.hpMax}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn--secondary btn--block" onClick={() => setPending(null)}>
          Другая способность
        </button>
      </div>
    );
  }
  return (
    <div className="stack">
      <h2>Ваш ход: {god.name}</h2>
      <div className="ol-abil">
        {abilitiesOf(god).map((a) => {
          const ok = ready.includes(a.id);
          const cd = me.cd[a.id] ?? 0;
          return (
            <button
              key={a.id}
              type="button"
              className={`ol-ab${a.ult ? " is-ult" : ""}`}
              disabled={!ok || sending}
              onClick={() => (a.target === "ally" ? setPending(a.id) : onSend({ ability: a.id, target: null }))}
            >
              <b>{a.name}</b>
              <small>{a.ult ? (me.ultUsed ? "уже использована" : `заряд ${me.charge}%`) : cd ? `ещё ${cd} ход.` : `${a.element ? ELEMENT_NAMES[a.element] + " · " : ""}${kindLabel(a)}`}</small>
              <small>{a.text}</small>
            </button>
          );
        })}
      </div>
      <p className="muted small">Нажмите способность — сервер бросит d100, сила зависит от исхода. Результат — на экране зала.</p>
    </div>
  );
}

function MyGod({ r, pid }: { r: OlympResult; pid: string }) {
  const m = r.party[pid];
  const god = m ? godOf(m.god) : undefined;
  if (!m || !god) return <p className="muted">Бог ещё не выбран.</p>;
  const lv = levelOf(m.xp);
  const f = r.battle?.fighters.find((x) => x.id === pid);
  const hp = f ? f.hp : m.hp;
  const hpMax = f ? f.hpMax : hpMaxOfMember(m);
  const effects = f ? f.effects : m.effects;
  return (
    <div className="stack">
      <div className="ol-me">
        <Emblem god={god} size={56} />
        <span>
          <b className="ol-me__name">{god.name}</b>
          <small>
            {ROLES[god.role].name} · {ELEMENT_NAMES[god.element]} · {lv.level}-й уровень · ◉ {m.coins}
          </small>
        </span>
      </div>
      <div className="ol-meter">
        <span>Здоровье</span>
        <b>
          {hp} / {hpMax}
        </b>
      </div>
      <Bar value={hp} max={hpMax} />
      <div className="ol-meter">
        <span>Опыт до {lv.level + 1}-го</span>
        <b>
          {lv.xp} / {xpToNext(lv.level)}
        </b>
      </div>
      <Bar value={lv.xp} max={xpToNext(lv.level)} kind="xp" />
      {effects.length > 0 && (
        <span className="ol-chips">
          {effects.map((e) => (
            <span key={e.id} className={`ol-chip ${e.kind === "curse" ? "is-bad" : "is-good"}`}>
              {e.name}
            </span>
          ))}
        </span>
      )}
      <ul className="ol-stats">
        {STATS.map((k) => (
          <li key={k}>
            {STAT_NAMES[k]}
            <b>{memberStat(m, k)}</b>
          </li>
        ))}
        <li>
          Скорость<b>{god.speed}</b>
        </li>
      </ul>
      <ul className="ol-abil-list">
        {abilitiesOf(god).map((a) => (
          <li key={a.id}>
            <b>
              {a.name}
              {a.ult ? " · ульта" : ""}
            </b>{" "}
            — {a.text}
          </li>
        ))}
      </ul>
      <p className="muted small">
        {god.about} Символы: {god.symbols}. Слабость: {god.weakness}.
      </p>
    </div>
  );
}

const LOG_FILTERS: Array<[string, string]> = [
  ["all", "Все"],
  ["fight", "Бой"],
  ["curse", "Проклятия"],
  ["heal", "Помощь"],
  ["coin", "Награды"],
  ["story", "История"],
];

function Journal({ r }: { r: OlympResult }) {
  const [f, setF] = useState("all");
  const list = r.log.filter((e) => f === "all" || e.k === f || (f === "coin" && e.k === "level") || (f === "story" && (e.k === "vote" || e.k === "start")));
  return (
    <div className="stack">
      <div className="ol-filters" role="group" aria-label="Что показать">
        {LOG_FILTERS.map(([k, n]) => (
          <button key={k} type="button" aria-pressed={f === k} onClick={() => setF(k)}>
            {n}
          </button>
        ))}
      </div>
      <ul className="ol-log">{list.length > 0 ? list.map((e) => <LogLine key={e.n} e={e} />) : <li className="muted">Пока пусто</li>}</ul>
    </div>
  );
}

export function OlympPlayerView({ session, content, pid, role, myAnswer, sending, onAnswer }: PlayerViewProps<OlympContent, OlympAnswerValue>) {
  const r = parseOlympResult(session.state.result);
  const [tab, setTab] = useState<"game" | "god" | "log">("game");
  const { stage } = session.state;
  const now = useServerNow(500, stage === "question");
  const open = acceptsAnswers(session.state, now);
  const scene = currentScene(content, r);
  const captain = role !== "member";
  const canAct = captain && open && !myAnswer;
  const m = r.party[pid];
  const god = m ? godOf(m.god) : undefined;
  const b = r.battle;
  // Ждём действия этого телефона (бросок, голос, ход в бою) — сами открываем вкладку «Игра»,
  // иначе капитан, читающий журнал, не видит кнопку.
  const mustAct =
    captain &&
    stage === "question" &&
    !myAnswer &&
    ((r.phase === "check" && r.check?.who === pid) || r.phase === "vote" || (r.phase === "fight" && !!b && b.actor === pid && !b.over && !r.acted));
  useEffect(() => {
    if (mustAct) setTab("game");
  }, [mustAct, session.state.step]);

  let body: ReactNode;
  if (r.phase === "pick" && r.order.length > 0) {
    body = canAct ? <GodPicker sending={sending} onSend={onAnswer} /> : myAnswer ? <p className="success">Бог выбран — ждём остальных</p> : <h2>{captain ? "Скоро начнём" : "Капитан выбирает бога"}</h2>;
  } else if (r.order.length === 0 || !scene) {
    body = <h2>Скоро начнём: капитан выберет бога</h2>;
  } else if (r.phase === "check" && scene.kind === "check" && r.check) {
    const mine = r.check.who === pid;
    body = (
      <div className="stack">
        <h2>{scene.title}</h2>
        <p className="muted">{scene.screen}</p>
        {mine && stage === "question" && canAct ? (
          <div className="buzz">
            <button type="button" className="buzz__button quest-roll" disabled={sending} onClick={() => onAnswer({ roll: true })}>
              🎲<span>Бросить d100</span>
            </button>
            <div className="buzz__plate buzz__plate--glow" role="status">
              <strong>
                {STAT_NAMES[scene.stat]}: {m ? memberStat(m, scene.stat) : 0} · порог {m ? threshold(memberStat(m, scene.stat)) : "—"}
                {m && memberRollMod(m) ? ` · эффекты ${memberRollMod(m) > 0 ? "+" : "−"}${Math.abs(memberRollMod(m))}` : ""}
              </strong>
              <span>Число выпадет на экране зала</span>
            </div>
          </div>
        ) : (
          <p className="ol-note-phone">{mine ? (r.check.outcome ? "Бросок сделан — смотрите на экран" : myAnswer ? "Бросок отправлен — смотрите на экран" : role === "member" ? "Бросает капитан вашей команды" : "Ваш бог бросает — ждите кнопку") : `Бросает ${godName(r, r.check.who)}`}</p>
        )}
        {r.check.outcome && (
          <div className="ol-card">
            <D100 roll={r.check.roll} outcome={r.check.outcome} />
            <p>{scene.outcomes[r.check.outcome].text}</p>
          </div>
        )}
      </div>
    );
  } else if (r.phase === "vote" && scene.kind === "vote" && r.vote) {
    const opts = visibleOptions(scene, r.flags);
    body = (
      <div className="stack">
        <h2>{scene.title}</h2>
        <p className="muted">{scene.screen}</p>
        {canAct && stage === "question" ? (
          opts.map((o, i) => (
            <button key={o.next + i} type="button" className="btn btn--secondary btn--block ol-voteopt" disabled={sending} onClick={() => onAnswer({ vote: i })}>
              <b>{o.label}</b>
              <small>{o.hint}</small>
            </button>
          ))
        ) : (
          <p className="ol-note-phone">
            {r.vote.picked !== null ? `Решили: «${opts[r.vote.picked]?.label ?? ""}»` : myAnswer ? "Голос отправлен" : stage === "question" ? (captain ? "Голосование закрыто" : "Голосует капитан — подсказывайте!") : "Скоро голосование"}
          </p>
        )}
      </div>
    );
  } else if ((r.phase === "fight" || r.phase === "fightEnd") && b) {
    const myTurn = b.actor === pid && !b.over && !r.acted;
    body = (
      <div className="stack">
        <FoeCard b={b} size="phone" />
        {r.phase === "fightEnd" && r.fightEnd ? (
          <div className="ol-card">
            <h2>{r.fightEnd.win ? "Победа!" : "Отряд отступает"}</h2>
            {r.fightEnd.win && <p>Опыт: +{r.fightEnd.xp[pid] ?? 0} · драхмы: +{r.fightEnd.coins[pid] ?? 0}</p>}
          </div>
        ) : myTurn && canAct && stage === "question" ? (
          <TurnPicker b={b} pid={pid} onSend={onAnswer} sending={sending} />
        ) : (
          <p className="ol-note-phone">{myTurn ? (myAnswer ? "Ход отправлен — смотрите на экран" : role === "member" ? "Ходит капитан вашей команды" : "Ваш ход — ждите кнопки") : `Ходит: ${b.fighters.find((f) => f.id === b.actor)?.name ?? "—"}`}</p>
        )}
        <ul className="ol-log">{b.log.slice(0, 3).map((e, i) => <LogLine key={e.n} e={e} fresh={i === 0} />)}</ul>
        <ul className="ol-party ol-party--phone">
          {b.fighters
            .filter((f) => f.side === "god")
            .map((f) => (
              <FighterRow key={f.id} f={f} session={session} current={b.actor === f.id && !b.over} size="phone" />
            ))}
        </ul>
      </div>
    );
  } else {
    body = (
      <div className="stack">
        <span className="ol-place">{placeOf(storyOf(content), scene.place)?.name}</span>
        <h2>{scene.title}</h2>
        <p>{scene.kind === "end" ? scene.text : scene.screen}</p>
        {scene.kind === "fight" && <p className="muted">Скоро бой: {foeOf(scene.foe)?.name}</p>}
      </div>
    );
  }

  return (
    <div className="quiz-phone ol-phone">
      <p className="eyebrow">
        Олимп{god ? ` · ${god.name}` : ""}
        {m ? ` · ${levelOf(m.xp).level}-й ур.` : ""}
      </p>
      {r.order.length > 0 && r.phase !== "pick" && (
        <div className="ol-tabs" role="tablist">
          {(
            [
              ["game", "Игра"],
              ["god", "Мой бог"],
              ["log", `Журнал (${r.log.length})`],
            ] as const
          ).map(([k, n]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {n}
            </button>
          ))}
        </div>
      )}
      {tab === "god" && r.phase !== "pick" ? <MyGod r={r} pid={pid} /> : tab === "log" && r.phase !== "pick" ? <Journal r={r} /> : body}
    </div>
  );
}

/** Сцена по id (для пульта). */
export function sceneTitle(content: OlympContent, id: string): string {
  return sceneOf(storyOf(content), id)?.title ?? "";
}
