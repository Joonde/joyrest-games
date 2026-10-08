// «Мафия»: экран зала — город днём и ночью, места игроков, речь с таймером, голосование, утро, итог;
// телефон — своя карта (переворот касанием), ночной ход своей роли, тайное голосование.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Confetti } from "../../components/live/Confetti";
import { playSound } from "../../components/live/sound";
import { useCountdownSounds } from "../../components/live/useCountdownSounds";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import { acceptsAnswers, secondsLeft } from "../../core/session";
import type { Session } from "../../data/types";
import type { PlayerViewProps, ViewProps } from "../types";
import { ROLES, type MafiaContent, type RoleId } from "./content";
import { CardBack, RoleArt, RoleCardView, RoleFace } from "./RoleArt";
import { canHeal, checkOf, isMafia, parseMafiaResult, parseRoleCard, parseWhisper, targetOf, voteOf, type MafiaResult, type RoleCard, type Whisper } from "./logic";
import { isKey, newKey, storedKey, storeKey, unseal } from "./seal";

export type MafiaAnswerValue = { key: string } | { target?: string; check?: string } | { vote: string };

const nameOf = (session: Session, pid: string | null) => (pid ? (session.leaderboard[pid]?.name ?? "Игрок") : "");

function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function rec(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** Номер и имя игрока: «№3 🦊 Аня». */
function Who({ session, r, pid }: { session: Session; r: MafiaResult; pid: string }) {
  return (
    <>
      <span className="mf-num">№{r.seats.indexOf(pid) + 1}</span> <NameText name={nameOf(session, pid)} />
    </>
  );
}

/** Роль выбывшего: открыта, если так задано в игре или игра окончена. */
function deadRole(r: MafiaResult, pid: string): RoleId | null {
  return r.reveal?.[pid] ?? r.deaths.find((d) => d.pid === pid)?.role ?? null;
}

// ---------------------------------------------------------------- экран зала

/** Места за столом: живые, выбывшие (с ролью, если она открыта), кандидаты, кто говорит. */
function Seats({ session, r, size = "screen" }: { session: Session; r: MafiaResult; size?: "screen" | "phone" }) {
  return (
    <ol className={`mf-seats mf-seats--${size}`} style={size === "screen" ? { gridTemplateColumns: `repeat(${r.seats.length <= 8 ? 4 : r.seats.length <= 12 ? 6 : 8}, minmax(0, 1fr))` } : undefined}>
      {r.seats.map((p, i) => {
        const dead = !r.alive.includes(p);
        const role = dead ? deadRole(r, p) : null;
        return (
          <li key={p} className={`mf-seat${dead ? " is-dead" : ""}${r.nominees.includes(p) && (r.mode === "day" || r.mode === "vote") ? " is-nominee" : ""}${r.speaker === p && r.speakEndsAt ? " is-speaking" : ""}`}>
            <span className="mf-seat__num">{i + 1}</span>
            <span className="mf-seat__name">
              <NameText name={nameOf(session, p)} />
            </span>
            {dead && <span className={`mf-seat__role${role && isMafia(role) ? " is-mafia" : ""}`}>{role ? ROLES[role].title : "выбыл(а)"}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function NightSky() {
  return (
    <div className="mf-sky" aria-hidden="true">
      <span className="mf-sky__moon" />
      {Array.from({ length: 18 }, (_, i) => (
        <span key={i} className="mf-sky__star" style={{ left: `${(i * 53) % 100}%`, top: `${(i * 29) % 45}%`, animationDelay: `${(i % 6) * 0.6}s` }} />
      ))}
      <div className="mf-sky__city">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className="mf-sky__house" style={{ height: `${30 + ((i * 37) % 45)}%` }}>
            <span className={`mf-sky__win${i % 3 === 0 ? " is-on" : ""}`} style={{ animationDelay: `${i * 0.9}s` }} />
          </span>
        ))}
      </div>
    </div>
  );
}

function Fan({ count }: { count: number }) {
  const n = Math.min(7, Math.max(3, count));
  return (
    <div className="mf-fan" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="mf-fan__card" style={{ ["--i" as string]: i - (n - 1) / 2, animationDelay: `${i * 0.12}s` }}>
          <div className="mf-card mf-card--still">
            <span className="mf-card__inner">
              <CardBack city="" />
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Tally({ session, r }: { session: Session; r: MafiaResult }) {
  const rows = [...r.nominees, "none"];
  const max = Math.max(1, ...rows.map((p) => r.tally?.[p] ?? 0));
  return (
    <ul className="mf-tally">
      {rows.map((p) => {
        const n = r.tally?.[p] ?? 0;
        return (
          <li key={p} className={`mf-tally__row${r.out === p ? " is-out" : ""}`}>
            <span className="mf-tally__name">{p === "none" ? "Никого" : <Who session={session} r={r} pid={p} />}</span>
            <span className="mf-tally__bar">
              <span className="mf-tally__fill" style={{ width: `${(n / max) * 100}%` }} />
            </span>
            <strong className="mf-tally__n">{n}</strong>
          </li>
        );
      })}
    </ul>
  );
}

function Speaker({ session, r, now }: { session: Session; r: MafiaResult; now: number }) {
  if (!r.speaker || r.speakEndsAt === null) return null;
  const left = r.speakEndsAt - now;
  return (
    <div className={`mf-speaker${left <= 10000 ? " is-ending" : ""}`}>
      <span className="mf-speaker__label">{r.speakKind === "last" ? "Последнее слово" : "Говорит"}</span>
      <span className="mf-speaker__name">
        <Who session={session} r={r} pid={r.speaker} />
      </span>
      <span className="mf-speaker__time">{clock(left)}</span>
    </div>
  );
}

export function MafiaScreenView({ session, content }: ViewProps<MafiaContent>) {
  const r = parseMafiaResult(session.state.result);
  const { stage, step } = session.state;
  const started = r.seats.length > 0;
  const now = useServerNow(250, stage === "question" || r.speakEndsAt !== null);
  const left = r.mode === "vote" && stage === "question" ? secondsLeft(session.state, now) : null;
  useCountdownSounds(left);
  const prev = useRef(`${step}:${r.mode}`);
  useEffect(() => {
    const key = `${step}:${r.mode}`;
    if (prev.current !== key) {
      if (r.mode === "night") playSound("gong");
      else if (r.mode === "deal") playSound("whoosh");
      else if (r.mode === "verdict") playSound(r.out ? "wrong" : "sparkle");
      else if (r.mode === "morning") {
        playSound("drumroll");
        window.setTimeout(() => playSound(r.killed ? "wrong" : "sparkle"), 1800);
      } else if (r.mode === "over") playSound("fanfare");
    }
    prev.current = key;
  }, [step, r.mode]);
  const nightish = r.mode === "night" || r.mode === "deal" || r.mode === "roles";
  const alive = r.alive.length;

  let main: ReactNode;
  if (!started) {
    main = (
      <>
        <span className="quiz-screen__badge">Мафия · {content.city}</span>
        <h2 className="mf-title">Скоро раздача ролей</h2>
        <p className="mf-note">Нужно от 5 игроков. Роли тайные — смотрите только в свой телефон.</p>
      </>
    );
  } else if (r.mode === "deal" || r.mode === "roles") {
    main = (
      <>
        <Fan count={r.seats.length} />
        <h2 className="mf-title">{r.mode === "deal" ? "Раздаём роли…" : "Посмотрите свою роль"}</h2>
        <p className="mf-note">{r.mode === "deal" ? `Телефоны готовы: ${session.state.answered} из ${r.seats.length}` : "Коснитесь карты на телефоне. Никому не показывайте! Мафия знает своих."}</p>
      </>
    );
  } else if (r.mode === "night") {
    main = (
      <>
        <span className="quiz-screen__badge">Ночь {r.round}</span>
        <h2 className="mf-title">Город засыпает…</h2>
        <p className="mf-note">Все делают ночной ход на телефонах — так никто не поймёт, кто есть кто.</p>
        <p className="mf-note">
          Сделали ход: {Math.min(session.state.answered, alive)} из {alive}
        </p>
      </>
    );
  } else if (r.mode === "morning") {
    const role = r.killed ? deadRole(r, r.killed) : null;
    main = (
      <>
        <span className="quiz-screen__badge">Утро</span>
        <h2 className="mf-title">Город просыпается</h2>
        {r.killed ? (
          <div className="mf-news is-dark">
            <p className="mf-news__line">Этой ночью убит(а)</p>
            <p className="mf-news__name">
              <Who session={session} r={r} pid={r.killed} />
            </p>
            {role && <p className="mf-news__role">{ROLES[role].title}</p>}
          </div>
        ) : (
          <div className="mf-news">
            <p className="mf-news__line">Ночь прошла спокойно — никто не погиб</p>
          </div>
        )}
        <Speaker session={session} r={r} now={now} />
      </>
    );
  } else if (r.mode === "vote") {
    main = (
      <>
        <span className="quiz-screen__badge">
          {r.revote ? "Переголосование" : "Голосование"}
          {left !== null ? ` · ${left} с` : ""}
        </span>
        <h2 className="mf-title">Кого город выгоняет?</h2>
        <ul className="mf-nominees">
          {r.nominees.map((p) => (
            <li key={p}>
              <Who session={session} r={r} pid={p} />
            </li>
          ))}
        </ul>
        <p className="mf-note">
          Голосуйте тайно на телефоне · проголосовали {Math.min(session.state.answered, alive)} из {alive}
        </p>
      </>
    );
  } else if (r.mode === "verdict") {
    const role = r.out ? deadRole(r, r.out) : null;
    main = (
      <>
        <span className="quiz-screen__badge">Итог голосования</span>
        <Tally session={session} r={r} />
        <p className="mf-title mf-title--small">
          {r.out ? (
            <>
              Город выгоняет <Who session={session} r={r} pid={r.out} />
              {role ? ` — ${ROLES[role].title}` : ""}
            </>
          ) : r.nominees.length > 1 && r.tally && !r.revote ? (
            "Ничья"
          ) : (
            "Никто не уходит"
          )}
        </p>
        <Speaker session={session} r={r} now={now} />
      </>
    );
  } else if (r.mode === "over") {
    main = (
      <>
        {r.winner && <Confetti burst={`mf:${step}`} />}
        <h2 className="mf-title">{r.winner === "city" ? "Победил город!" : r.winner === "mafia" ? "Победила мафия!" : "Партия окончена"}</h2>
        <ul className="mf-reveal">
          {r.seats.map((p) => {
            const role = r.reveal?.[p];
            return (
              <li key={p} className={`mf-reveal__item mf-role--${role ?? "civilian"}${r.alive.includes(p) ? "" : " is-dead"}${role && r.winner && ROLES[role].side === r.winner ? " is-winner" : ""}`}>
                {role && (
                  <span className="mf-reveal__art">
                    <RoleArt role={role} />
                  </span>
                )}
                <span className="mf-reveal__name">
                  <Who session={session} r={r} pid={p} />
                </span>
                <span className="mf-reveal__role">{role ? ROLES[role].title : "—"}</span>
              </li>
            );
          })}
        </ul>
      </>
    );
  } else {
    main = (
      <>
        <span className="quiz-screen__badge">День {r.round}</span>
        {r.killed && r.speakKind !== "speech" && !r.speaker ? (
          <p className="mf-note">
            Ночью погиб(ла) <Who session={session} r={r} pid={r.killed} />
          </p>
        ) : null}
        <h2 className="mf-title mf-title--small">{r.speaker ? "Обсуждение" : r.nominees.length > 0 ? "Кандидаты на голосование" : "Город обсуждает: кто мафия?"}</h2>
        <Speaker session={session} r={r} now={now} />
      </>
    );
  }

  return (
    <div className={`mf-screen${nightish ? " is-night" : " is-day"}`}>
      {nightish && <NightSky />}
      <section className="mf-screen__main">{main}</section>
      {started && r.mode !== "over" && r.mode !== "deal" && r.mode !== "roles" && (
        <section className="mf-screen__seats" aria-label="Игроки">
          <Seats session={session} r={r} />
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- телефон

/** Открыть зашифрованное своим ключом; пока открывается — прежнее значение. */
function useOpened<T>(key: string | null, text: string | undefined, parse: (raw: unknown) => T | null): T | null | undefined {
  const [value, setValue] = useState<T | null | undefined>(undefined);
  useEffect(() => {
    if (!key || !text) {
      setValue(key ? null : null);
      return;
    }
    let live = true;
    void unseal(key, text).then((raw) => live && setValue(parse(raw)));
    return () => {
      live = false;
    };
  }, [key, text]);
  return value;
}

/** Клетки игроков для ночного выбора и голосования. */
function Targets({
  session,
  r,
  list,
  picked,
  badges,
  disabled,
  tags,
  onPick,
}: {
  session: Session;
  r: MafiaResult;
  list: string[];
  picked: string | null;
  badges?: Record<string, number>;
  disabled?: (pid: string) => boolean;
  tags?: Record<string, string>;
  onPick: (pid: string) => void;
}) {
  return (
    <div className="mf-targets">
      {list.map((p) => {
        const off = disabled?.(p) ?? false;
        const n = badges?.[p] ?? 0;
        return (
          <button key={p} type="button" className={`mf-target${picked === p ? " is-picked" : ""}`} aria-pressed={picked === p} disabled={off} onClick={() => onPick(p)}>
            {n > 0 && (
              <span key={n} className="mf-target__badge" aria-label={`Голосов семьи: ${n}`}>
                {n}
              </span>
            )}
            <span className="mf-target__num">№{r.seats.indexOf(p) + 1}</span>
            <span className="mf-target__name">
              <NameText name={nameOf(session, p)} />
            </span>
            {tags?.[p] && <span className="mf-target__tag">{tags[p]}</span>}
          </button>
        );
      })}
    </div>
  );
}

function NightMove({ session, r, me, card, whisper, myAnswer, sending, onAnswer }: { session: Session; r: MafiaResult; me: string; card: RoleCard; whisper: Whisper | null | undefined; myAnswer: { value: unknown } | null | undefined; sending: boolean; onAnswer: (v: MafiaAnswerValue) => void }) {
  const role = card.role;
  const target = myAnswer ? targetOf(myAnswer.value) : null;
  const check = myAnswer ? checkOf(myAnswer.value) : null;
  const others = r.alive.filter((p) => p !== me);
  const familyIds = card.family.map((f) => f.pid);
  const tags: Record<string, string> = {};
  for (const f of card.family) if (r.alive.includes(f.pid)) tags[f.pid] = f.role === "don" ? "Дон · свой" : "свой";

  if (isMafia(role)) {
    const fam = whisper?.family ?? {};
    const badges: Record<string, number> = {};
    for (const [pid, t] of Object.entries(fam)) if (t && r.alive.includes(pid)) badges[t] = (badges[t] ?? 0) + 1;
    const members = Object.keys(fam).filter((p) => r.alive.includes(p));
    const chosen = members.map((p) => fam[p] ?? null);
    const same = chosen.length > 0 && chosen.every((t) => t && t === chosen[0]);
    return (
      <div className="stack">
        <h2>Выстрел семьи</h2>
        <p className="muted small">Убийство состоится, только если вся семья выберет одного. Цифра над игроком — голоса вашей семьи.</p>
        <Targets session={session} r={r} list={others} picked={target} badges={badges} tags={tags} disabled={(p) => sending || familyIds.includes(p)} onPick={(p) => onAnswer(role === "don" ? { target: p, ...(check ? { check } : {}) } : { target: p })} />
        <p className={same ? "success" : "muted"} role="status">
          {whisper === undefined ? "Связываемся с семьёй…" : same ? "Вся семья выбрала одного — выстрел состоится" : members.length > 1 ? "Договоритесь: голоса пока расходятся" : target ? "Выбор сделан — можно поменять до утра" : "Выберите цель"}
        </p>
        {role === "don" && (
          <>
            <h2>Проверка Дона: кто Комиссар?</h2>
            <Targets session={session} r={r} list={others.filter((p) => !familyIds.includes(p))} picked={check} disabled={() => sending || check !== null} onPick={(p) => onAnswer({ ...(target ? { target } : {}), check: p })} />
            {check && (
              <p className={whisper?.check?.target === check && whisper.check.yes ? "error" : "muted"} role="status">
                {whisper?.check?.target === check ? (whisper.check.yes ? "Это Комиссар!" : "Не Комиссар") : "Проверяем…"}
              </p>
            )}
          </>
        )}
      </div>
    );
  }
  if (role === "doctor") {
    const last = whisper?.lastHeal ?? null;
    const history = last ? [last] : [];
    if (whisper?.selfHealed) history.unshift(me);
    return (
      <div className="stack">
        <h2>Кого лечите этой ночью?</h2>
        <p className="muted small">Одного и того же — не две ночи подряд, себя — один раз за игру. Можно поменять до утра.</p>
        <Targets session={session} r={r} list={r.alive} picked={target} tags={{ [me]: "это вы" }} disabled={(p) => sending || whisper === undefined || !canHeal(me, p, history)} onPick={(p) => onAnswer({ target: p })} />
        {target && <p className="success">Лечите №{r.seats.indexOf(target) + 1}</p>}
      </div>
    );
  }
  if (role === "commissar") {
    return (
      <div className="stack">
        <h2>Кого проверяете?</h2>
        <p className="muted small">Одна проверка за ночь — выбирайте внимательно.</p>
        <Targets session={session} r={r} list={others} picked={target} disabled={() => sending || target !== null} onPick={(p) => onAnswer({ target: p })} />
        {target && (
          <p className={whisper?.check?.target === target ? (whisper.check.yes ? "mf-verdict is-mafia" : "mf-verdict is-clean") : "muted"} role="status">
            {whisper?.check?.target === target ? (whisper.check.yes ? "№" + (r.seats.indexOf(target) + 1) + " — МАФИЯ!" : "№" + (r.seats.indexOf(target) + 1) + " — не мафия") : "Проверяем…"}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="stack">
      <h2>Город спит</h2>
      <p className="muted small">Отметьте, кого подозреваете. Это ваша заметка — её никто не увидит. Все нажимают одновременно, чтобы никого не выдать.</p>
      <Targets session={session} r={r} list={others} picked={target} disabled={() => sending} onPick={(p) => onAnswer({ target: p })} />
      {target && <p className="success">Отмечено. Спите спокойно…</p>}
    </div>
  );
}

export function MafiaPlayerView({ session, content, pid, myAnswer, sending, onAnswer }: PlayerViewProps<MafiaContent, MafiaAnswerValue>) {
  const r = parseMafiaResult(session.state.result);
  const { stage } = session.state;
  const [key, setKey] = useState<string | null>(() => storedKey(session.id, pid));
  const [noCrypto, setNoCrypto] = useState(false);
  const dealing = r.mode === "deal" && stage === "question" && r.seats.includes(pid);

  // Раздача: телефон сам создаёт ключ и отправляет ведущему.
  useEffect(() => {
    if (!dealing || myAnswer === undefined || sending) return;
    const sent = myAnswer ? rec(myAnswer.value).key : null;
    if (isKey(sent)) {
      if (sent !== key) {
        storeKey(session.id, pid, sent);
        setKey(sent);
      }
      return;
    }
    if (myAnswer) return;
    try {
      const k = key ?? newKey();
      storeKey(session.id, pid, k);
      setKey(k);
      onAnswer({ key: k });
    } catch {
      setNoCrypto(true);
    }
  }, [dealing, myAnswer, sending]);

  const card = useOpened(key, r.sealed[pid], parseRoleCard);
  const whisper = useOpened(key, r.whisper[pid], parseWhisper);
  const now = useServerNow(500, stage === "question" || r.speakEndsAt !== null);
  const open = acceptsAnswers(session.state, now);
  const seated = r.seats.includes(pid);
  const alive = r.alive.includes(pid);
  const seatNo = r.seats.indexOf(pid) + 1;

  const head = (
    <p className="eyebrow">
      Мафия{seated ? ` · ваш номер ${seatNo}` : ""}
      {r.round > 0 && r.mode !== "over" ? ` · ${r.mode === "night" ? "ночь" : "день"} ${r.round}` : ""}
    </p>
  );

  if (r.seats.length === 0) {
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        <h2>Скоро раздача ролей</h2>
        <p className="muted">Роль придёт на этот телефон. Никому её не показывайте!</p>
      </div>
    );
  }
  if (!seated) {
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        <h2>Партия уже идёт</h2>
        <p className="muted">Смотрите на экран — в следующей партии сыграете.</p>
      </div>
    );
  }
  if (r.mode === "deal") {
    return (
      <div className="quiz-phone quiz-phone--center mf-phone">
        {head}
        <div className="mf-phone__deck">
          <Fan count={4} />
        </div>
        <h2>{noCrypto ? "Этот браузер не умеет тайные карты" : myAnswer ? "Телефон готов — ждём раздачу" : "Готовим вашу карту…"}</h2>
        {noCrypto && <p className="muted">Обновите браузер или скажите ведущему — он сообщит роль тихо.</p>}
      </div>
    );
  }

  const cardView =
    card && r.mode !== "over" ? (
      <RoleCardView role={card.role} seat={card.seat} family={card.family.map((f) => ({ name: f.name, role: f.role }))} city={content.city} />
    ) : card === null && r.mode !== "over" ? (
      <p className="buzz__plate">
        <strong>Карту не открыть на этом телефоне</strong>
        <span>Роль скажет ведущий — подойдите к нему тихо.</span>
      </p>
    ) : null;

  if (r.mode === "roles") {
    return (
      <div className="quiz-phone mf-phone">
        {head}
        <h2>Ваша роль</h2>
        <div className="mf-phone__card">{cardView ?? <p className="muted">Открываем карту…</p>}</div>
        <p className="muted small">Коснитесь карты, чтобы перевернуть. Через 6 секунд она сама закроется.</p>
      </div>
    );
  }

  if (r.mode === "over") {
    const role = r.reveal?.[pid] ?? card?.role ?? null;
    const won = role && r.winner ? ROLES[role].side === r.winner : false;
    return (
      <div className="quiz-phone mf-phone">
        {head}
        <h2>{r.winner === "city" ? "Победил город!" : r.winner === "mafia" ? "Победила мафия!" : "Партия окончена"}</h2>
        {r.winner && <p className={won ? "success" : "muted"}>{won ? "Ваша сторона победила! 🎉" : "В этот раз не повезло"}</p>}
        {role && (
          <div className="mf-phone__card">
            <div className="mf-card is-open mf-card--still">
              <span className="mf-card__inner">
                <RoleFace role={role} seat={seatNo} />
              </span>
            </div>
          </div>
        )}
        <ul className="mf-phone__reveal">
          {r.seats.map((p) => (
            <li key={p}>
              <Who session={session} r={r} pid={p} /> — {r.reveal?.[p] ? ROLES[r.reveal[p] as RoleId].title : "—"}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  let body: ReactNode = null;
  if (!alive) {
    body = (
      <div className="buzz__plate">
        <strong>Вы выбыли из игры</strong>
        <span>Молчите и наблюдайте 🤫 — не подсказывайте живым.</span>
      </div>
    );
  } else if (r.mode === "night" && stage === "question") {
    body = card ? <NightMove session={session} r={r} me={pid} card={card} whisper={whisper} myAnswer={myAnswer} sending={sending} onAnswer={onAnswer} /> : <p className="muted">Открываем карту…</p>;
  } else if (r.mode === "vote") {
    const voted = myAnswer ? voteOf(myAnswer.value) : null;
    const left = secondsLeft(session.state, now);
    body = (
      <div className="stack">
        <h2>Кого выгоняем?{left !== null && stage === "question" ? ` · ${left} с` : ""}</h2>
        {voted ? (
          <p className="success">Ваш голос принят: {voted === "none" ? "никого" : `№${r.seats.indexOf(voted) + 1}`}</p>
        ) : open ? (
          <>
            <p className="muted small">Голос тайный и один — изменить нельзя.</p>
            <Targets session={session} r={r} list={r.nominees} picked={null} disabled={(p) => sending || p === pid} tags={{ [pid]: "это вы" }} onPick={(p) => onAnswer({ vote: p })} />
            <button type="button" className="btn btn--secondary btn--block" disabled={sending} onClick={() => onAnswer({ vote: "none" })}>
              Никого не выгонять
            </button>
          </>
        ) : (
          <p className="muted">Голосование закрыто</p>
        )}
      </div>
    );
  } else if (r.mode === "verdict") {
    body = (
      <div className="stack">
        <Tally session={session} r={r} />
        <p className="mf-phone__news">{r.out === pid ? "Город выгоняет вас. Последнее слово!" : r.out ? <>Город выгоняет <Who session={session} r={r} pid={r.out} /></> : "Никто не уходит"}</p>
      </div>
    );
  } else if (r.mode === "morning") {
    body = <p className="mf-phone__news">{r.killed ? <>Ночью убит(а) <Who session={session} r={r} pid={r.killed} /></> : "Ночь прошла спокойно"}</p>;
  } else {
    body = (
      <div className="stack">
        {r.killed && r.mode === "day" && (
          <p className="muted">
            Ночью погиб(ла) <Who session={session} r={r} pid={r.killed} />
          </p>
        )}
        {r.speaker && r.speakEndsAt !== null ? (
          <p className={`mf-phone__news${r.speaker === pid ? " is-me" : ""}`}>
            {r.speaker === pid ? "Ваше слово!" : <><Who session={session} r={r} pid={r.speaker} /> говорит</>} · {clock(r.speakEndsAt - now)}
          </p>
        ) : (
          <h2>Обсуждение: кто мафия?</h2>
        )}
        {r.nominees.length > 0 && (
          <p>
            На голосование: {r.nominees.map((p) => `№${r.seats.indexOf(p) + 1}`).join(", ")}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="quiz-phone mf-phone">
      {head}
      {r.speaker === pid && r.speakEndsAt !== null && r.mode !== "day" && <p className="mf-phone__news is-me">Ваше последнее слово · {clock(r.speakEndsAt - now)}</p>}
      {body}
      {cardView && (
        <details className="mf-phone__mine">
          <summary>Моя карта</summary>
          <div className="mf-phone__card mf-phone__card--small">{cardView}</div>
        </details>
      )}
      {session.screenMode === "none" && <Seats session={session} r={r} size="phone" />}
    </div>
  );
}
