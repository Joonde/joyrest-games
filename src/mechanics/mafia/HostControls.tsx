import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useConfirm } from "../../components/ConfirmDialog";
import { PodiumHostList } from "../../components/live/Podium";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import { awardNow, hasPodium, podiumBack, podiumDone, podiumNext } from "../../core/podium";
import { pointsLabel } from "../../core/results";
import type { Answer, Session, SessionChange } from "../../data/types";
import type { HostControlsProps } from "../types";
import { countsFor, MAFIA_LIMITS, ROLES, type MafiaContent, type RoleId } from "./content";
import { hostKey, keysOf, loadManual, rolesFromCards, rolesFromHost, saveManual, sealDeal, sealWhispers } from "./deal";
import {
  abortGame,
  ACTION_LABELS,
  canHeal,
  dealRoles,
  dealt,
  familyVotes,
  finishGame,
  giveWord,
  healHistory,
  isMafia,
  mafiaBack,
  mafiaPrimary,
  morning,
  nameMap,
  nightChoices,
  nightSync,
  parseMafiaResult,
  resolveNight,
  startDay,
  startDeal,
  startNight,
  startVote,
  toggleNominee,
  verdict,
  whispers,
  type MafiaResult,
} from "./logic";

export const ROLE_ICON: Record<RoleId, string> = { mafia: "🔫", don: "🎩", commissar: "🔦", doctor: "💉", civilian: "🏠" };

/** Проверки Комиссара и Дона за ночь: засчитывается первая (сменить цель после ответа нельзя). */
function lockChecks(locks: Map<string, string>, step: number, roles: Record<string, RoleId>, choices: Record<string, string | null>, donCheck: Record<string, string | null>) {
  const c = { ...choices };
  const d = { ...donCheck };
  for (const [pid, role] of Object.entries(roles)) {
    if (role === "commissar" && c[pid]) {
      const k = `${step}:c:${pid}`;
      if (!locks.has(k)) locks.set(k, c[pid] as string);
      c[pid] = locks.get(k) ?? null;
    }
    if (role === "don" && d[pid]) {
      const k = `${step}:d:${pid}`;
      if (!locks.has(k)) locks.set(k, d[pid] as string);
      d[pid] = locks.get(k) ?? null;
    }
  }
  return { choices: c, donCheck: d };
}

function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Пульт «Мафии»: «Собрать телефоны» → «Раздать роли» → день (слово, кандидаты) → «Голосование» →
 * «Подсчитать голоса» → «Наступает ночь» (ведущий видит выбор каждой роли) → «Наступает утро» → …
 * → «Открыть роли — итог игры» → награждение.
 */
export function MafiaHostControls({ session, content, answers, participants, control, rehearsal }: HostControlsProps<MafiaContent>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const r = parseMafiaResult(session.state.result);
  const started = session.state.result !== null && session.state.result !== undefined && r.seats.length > 0;
  const names = useMemo(() => nameMap(session, participants), [session, participants]);
  const nm = (pid: string | null) => (pid ? (names[pid] ?? "Игрок") : "—");
  const seat = (pid: string) => r.seats.indexOf(pid) + 1;
  // Время идёт всегда: от него считаются таймеры речи, которые ставит пульт.
  const now = useServerNow(500, true);
  const own = answers.filter((a) => a.step === step);

  // Ключи телефонов: на раздаче — из текущих ответов, потом — один раз с сервера.
  const [keys, setKeys] = useState<Record<string, string>>({});
  const dealing = r.mode === "deal" && stage === "question";
  useEffect(() => {
    if (r.dealStep === null) return;
    if (dealing) {
      setKeys(keysOf(answers.filter((a) => a.step === r.dealStep)));
      return;
    }
    let live = true;
    void control
      .freshAnswers(r.dealStep)
      .then((list) => live && setKeys(keysOf(list)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [r.dealStep, dealing, dealing ? answers : null, session.id]);

  // Роли: ключом ведущего (этот пульт раздавал) или по картам телефонов (второй пульт).
  const [roles, setRoles] = useState<Record<string, RoleId> | null>(null);
  const sealedKey = Object.keys(r.sealed).sort().join(",");
  useEffect(() => {
    if (!r.hostSeal) {
      setRoles(null);
      return;
    }
    let live = true;
    void (async () => {
      const fromHost = await rolesFromHost(hostKey(session.id), r.hostSeal);
      const found = fromHost ?? (await rolesFromCards(r.sealed, keys));
      if (live) setRoles(found);
    })();
    return () => {
      live = false;
    };
  }, [r.hostSeal, sealedKey, keys, session.id]);
  const missingRoles = started && r.hostSeal ? r.seats.filter((p) => !roles?.[p]) : [];
  const rolesReady = roles !== null && missingRoles.length === 0;

  // Выбор ведущего за игроков без телефона (на этом шаге).
  const [manual, setManual] = useState<Record<string, string>>(() => loadManual(session.id, step));
  useEffect(() => setManual(loadManual(session.id, step)), [session.id, step]);
  const setManualFor = (pid: string, value: string) => {
    const next = { ...manual };
    if (value) next[pid] = value;
    else delete next[pid];
    setManual(next);
    saveManual(session.id, step, next);
  };
  const keyless = r.seats.filter((p) => !keys[p]);

  // Прошлые ночи: кого лечил Доктор (по ответам тех шагов).
  const past = useRef(new Map<number, Record<string, string | null>>());
  const [, setPastVer] = useState(0);
  const pastSteps = r.nights.filter((s) => !(r.mode === "night" && s === step));
  useEffect(() => {
    let live = true;
    for (const s of pastSteps) {
      if (past.current.has(s)) continue;
      void control
        .freshAnswers(s)
        .then((list) => {
          if (!live) return;
          past.current.set(s, nightChoices(list, r.seats, loadManual(session.id, s)).choices);
          setPastVer((v) => v + 1);
        })
        .catch(() => undefined);
    }
    return () => {
      live = false;
    };
  }, [pastSteps.join(","), session.id]);
  const doctor = roles ? (r.alive.find((p) => roles[p] === "doctor") ?? null) : null;
  const don = roles ? (r.alive.find((p) => roles[p] === "don") ?? null) : null;
  const history = healHistory(doctor, pastSteps.map((s) => past.current.get(s) ?? {}));

  // Ночь: выбор каждого, итог «если утро сейчас».
  const locks = useRef(new Map<string, string>());
  const night = useMemo(() => {
    if (r.mode !== "night" || !roles) return null;
    const raw = nightChoices(own, r.alive, manual);
    const { choices, donCheck } = lockChecks(locks.current, step, roles, raw.choices, raw.donCheck);
    return { choices, donCheck, outcome: resolveNight(roles, r.alive, choices, history, don ? (donCheck[don] ?? null) : null) };
  }, [r.mode, roles, own, r.alive.join(","), manual, step, history.join(","), don]);

  // Ночные подсказки телефонам: голоса семьи, проверки, правило Доктора — у всех одной длины.
  const synced = useRef("");
  useEffect(() => {
    if (r.mode !== "night" || stage !== "question" || !roles || !night || Object.keys(keys).length === 0) return;
    const items = whispers(roles, r.alive, night.choices, night.donCheck, history);
    const plain = `${step}:${JSON.stringify(items)}`;
    if (plain === synced.current) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        const sealed = await sealWhispers(items, keys);
        const cur = latest.current;
        if (cur.state.step !== step || cur.state.stage !== "question") return;
        await control.apply({ ...nightSync(cur, sealed, own.length), expect: { phase: "playing", step, stage: "question" } });
        synced.current = plain;
      })().catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [r.mode, stage, roles, night, keys, step]);

  function nextSession(): Promise<void> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(resolve, 3000);
      waiters.current.push(() => {
        window.clearTimeout(timer);
        resolve();
      });
    });
  }

  async function run(make: SessionChange | null | (() => Promise<SessionChange | null>), clear?: number) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { phase, step: atStep, stage: atStage } = session.state;
    try {
      const change = typeof make === "function" ? await make() : make;
      if (!change) return;
      const arrived = rehearsal ? Promise.resolve() : nextSession();
      const cur = latest.current.state;
      if (clear !== undefined && (cur.step !== atStep || cur.stage !== atStage)) return;
      if (clear !== undefined) await control.clearAnswers(clear);
      // Ночные подсказки меняют итог шага, поэтому сверяем только шаг и этап.
      await control.apply({ ...change, expect: { phase, step: atStep, stage: atStage } });
      await arrived;
    } catch (e) {
      if (!(typeof e === "object" && e !== null && "code" in e && e.code === "failed-precondition")) setError("Не получилось. Проверьте интернет и нажмите ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  const freshOwn = async (): Promise<Answer[]> => {
    const list = await control.freshAnswers(step).catch(() => [] as Answer[]);
    return list.length > 0 ? list : own;
  };

  const doDeal = () =>
    run(async () => {
      const cur = latest.current;
      const list = await freshOwn();
      const k = keysOf([...own, ...list]);
      const rr = parseMafiaResult(cur.state.result);
      const dealtRoles = dealRoles(rr.seats, countsFor(content, rr.seats.length));
      const { sealed, hostSeal } = await sealDeal(rr.seats, dealtRoles, nameMap(cur, participants), k, hostKey(cur.id));
      setKeys(k);
      setRoles(dealtRoles);
      return dealt(cur, sealed, hostSeal);
    });

  const doVerdict = () =>
    run(async () => {
      const list = await freshOwn();
      const voted = new Set(list.map((a) => a.pid));
      const extra: Answer[] = Object.entries(manual)
        .filter(([pid]) => !voted.has(pid))
        .map(([pid, vote]) => ({ id: `${step}_${pid}`, step, pid, uid: pid, value: { vote }, submittedAt: null }));
      return verdict(latest.current, content, [...list, ...extra], roles ?? {});
    });

  const doMorning = () =>
    run(async () => {
      if (!roles) return null;
      const list = await freshOwn();
      const raw = nightChoices(list, r.alive, manual);
      const { choices, donCheck } = lockChecks(locks.current, step, roles, raw.choices, raw.donCheck);
      const outcome = resolveNight(roles, r.alive, choices, history, don ? (donCheck[don] ?? null) : null);
      return morning(latest.current, content, outcome, roles);
    });

  const action = started ? mafiaPrimary(session, content.parties) : "deal";
  const players = r.seats.length > 0 ? r.seats.length : participants.filter((p) => p.kind === "player").length + Object.keys(session.leaderboard).filter((id) => !participants.some((p) => p.id === id)).length;
  const back = stage === "podium" ? { change: podiumBack(session) } : mafiaBack(session);

  const label = (pid: string) => (
    <>
      №{seat(pid)} <NameText name={nm(pid)} />
    </>
  );

  return (
    <div className="stack host-quiz mf-host">
      <p className="eyebrow">
        Мафия · {content.city}
        {content.parties > 1 || r.party > 1 ? ` · партия ${r.party} из ${Math.max(content.parties, r.party)}` : ""}
        {r.round > 0 ? ` · ${r.mode === "night" ? "ночь" : "день"} ${r.round}` : ""}
        {started ? ` · живых ${r.alive.length} из ${r.seats.length}` : ""}
      </p>

      {stage === "podium" ? (
        <PodiumHostList session={session} />
      ) : !started ? (
        <p className="muted">
          Игроки за столом — по порядку входа. Нужно от {MAFIA_LIMITS.minPlayers} игроков, сейчас {players}. Роли раздаются случайно: {rolesLine(content, players)}.
        </p>
      ) : r.mode === "deal" ? (
        <div className="card stack stack--tight">
          <p>
            Телефоны готовы: {Object.keys(keys).length} из {r.seats.length}.
          </p>
          {keyless.length > 0 && <p className="muted small">Без телефона ({keyless.map(nm).join(", ")}) — их роли увидите на пульте и скажете им тихо.</p>}
          <p className="muted small">Роли: {rolesLine(content, r.seats.length)}.</p>
        </div>
      ) : r.mode === "roles" ? (
        <p>Гости смотрят свои карты. Мафия видит свою семью на карте. Когда все посмотрели — «Наступает день».</p>
      ) : null}

      {started && r.mode === "night" && (
        <NightPanel r={r} roles={roles} night={night} history={history} label={label} doneCount={own.filter((a) => r.alive.includes(a.pid)).length} keyless={keyless} manual={manual} onManual={setManualFor} nm={nm} seat={seat} />
      )}

      {started && (r.mode === "day" || r.mode === "morning" || r.mode === "verdict") && stage !== "podium" && (
        <section className="stack stack--tight">
          {r.mode === "morning" && <p className="mf-host__news">{r.killed ? <>Этой ночью убит(а) {label(r.killed)}</> : "Ночь прошла спокойно — никто не погиб"}</p>}
          {r.mode === "verdict" && (
            <div className="card stack stack--tight">
              <p className="eyebrow">Итог голосования{r.revote ? " (переголосование)" : ""}</p>
              <ul className="mf-host__tally">
                {[...r.nominees, "none"].map((p) => (
                  <li key={p}>
                    {p === "none" ? "Никого" : label(p)} — {r.tally?.[p] ?? 0}
                  </li>
                ))}
              </ul>
              <p className="mf-host__news">{r.out ? <>Город выгоняет {label(r.out)}</> : mafiaPrimary(session) === "revote" ? "Ничья — можно переголосовать между равными" : "Никто не уходит"}</p>
            </div>
          )}
          {r.mode !== "day" && (r.killed ?? r.out) && !r.winner && !(r.speakKind === "last" && r.speakEndsAt !== null) && (
            <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run(giveWord(session, r.mode === "morning" ? r.killed : r.out, content.lastWordSeconds, now, "last"))}>
              Последнее слово ({content.lastWordSeconds} с)
            </button>
          )}
          {r.mode === "day" && (
            <>
              <p className="muted small">«Слово» — таймер речи на экране. «На голосование» — выставить кандидата. Никого не выставили — сразу ночь.</p>
              {r.killed && r.speakKind !== "last" && (
                <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run(giveWord(session, r.killed, content.lastWordSeconds, now, "last"))}>
                  Последнее слово убитого ({content.lastWordSeconds} с)
                </button>
              )}
              <ol className="mf-host__seats">
                {r.seats.map((p) => {
                  const dead = !r.alive.includes(p);
                  const speaking = r.speaker === p && r.speakEndsAt !== null;
                  return (
                    <li key={p} className={`mf-host__seat${dead ? " is-dead" : ""}${speaking ? " is-speaking" : ""}${r.nominees.includes(p) ? " is-nominee" : ""}`}>
                      <span className="mf-host__who">
                        {label(p)}
                        {roles?.[p] && <span className="mf-host__role">{ROLE_ICON[roles[p] as RoleId]}</span>}
                        {speaking && <strong className="mf-host__timer"> · {clock((r.speakEndsAt ?? 0) - now)}</strong>}
                      </span>
                      {!dead && (
                        <span className="mf-host__btns">
                          <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => void run(giveWord(session, speaking ? null : p, content.speechSeconds, now))}>
                            {speaking ? "Стоп" : "Слово"}
                          </button>
                          <button type="button" className="btn btn--quiet" aria-pressed={r.nominees.includes(p)} disabled={busy} onClick={() => void run(toggleNominee(session, p))}>
                            {r.nominees.includes(p) ? "✓ Кандидат" : "На голосование"}
                          </button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </>
          )}
          {r.speaker && r.speakKind === "last" && r.speakEndsAt !== null && (
            <p className="mf-host__news">
              Последнее слово: {label(r.speaker)} · {clock(r.speakEndsAt - now)}{" "}
              <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => void run(giveWord(session, null, 0, now))}>
                Стоп
              </button>
            </p>
          )}
        </section>
      )}

      {started && r.mode === "vote" && (
        <section className="card stack stack--tight">
          <p>
            Голосуют: {own.filter((a) => r.alive.includes(a.pid)).length} из {r.alive.length - keyless.filter((p) => r.alive.includes(p)).length} с телефонами. Кандидаты: {r.nominees.map((p) => `№${seat(p)}`).join(", ")}.
          </p>
          {keyless.filter((p) => r.alive.includes(p)).length > 0 && (
            <div className="stack stack--tight">
              <p className="eyebrow">Голоса игроков без телефона</p>
              {keyless
                .filter((p) => r.alive.includes(p))
                .map((p) => (
                  <label key={p} className="field mf-host__manual">
                    <span>{label(p)}</span>
                    <select value={manual[p] ?? ""} onChange={(e) => setManualFor(p, e.target.value)}>
                      <option value="">не голосует</option>
                      {r.nominees
                        .filter((n) => n !== p)
                        .map((n) => (
                          <option key={n} value={n}>
                            №{seat(n)} {nm(n)}
                          </option>
                        ))}
                      <option value="none">Никого</option>
                    </select>
                  </label>
                ))}
            </div>
          )}
        </section>
      )}

      {started && r.mode === "over" && stage !== "podium" && (
        <p className="mf-host__news">{r.winner === "city" ? "Победил город!" : "Победила мафия!"} Роли открыты на экране и телефонах.</p>
      )}

      {started && r.mode !== "deal" && roles && stage !== "podium" && (
        <details className="quest-host__places">
          <summary>Роли игроков (видите только вы)</summary>
          <ol className="mf-host__roles">
            {r.seats.map((p) => {
              const role = roles[p];
              return (
                <li key={p} className={r.alive.includes(p) ? undefined : "is-dead"}>
                  {label(p)} — {role ? `${ROLE_ICON[role]} ${ROLES[role].title}` : "неизвестно"}
                  {keys[p] ? "" : " · без телефона"}
                  {!r.alive.includes(p) ? " · выбыл(а)" : ""}
                  {r.mode === "over" ? ` · ${pointsLabel(session.leaderboard[p]?.score ?? 0)}` : ""}
                </li>
              );
            })}
          </ol>
        </details>
      )}
      {started && r.mode !== "deal" && missingRoles.length > 0 && (
        <p className="muted small">
          Этот пульт не знает роли: {missingRoles.map(nm).join(", ")} (без телефона). Их видно на устройстве, где раздавали роли. Ночь и итог ведите с него.
        </p>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        {stage === "podium" ? (
          podiumDone(session) ? (
            <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => control.requestFinish()}>
              Завершить игру
            </button>
          ) : (
            <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(podiumNext(session))}>
              Открыть следующее место
            </button>
          )
        ) : action === "deal" ? (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || players < MAFIA_LIMITS.minPlayers} onClick={() => void run(startDeal(session, participants))}>
            {ACTION_LABELS.deal}
          </button>
        ) : action === "dealt" ? (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void doDeal()}>
            {ACTION_LABELS.dealt}
          </button>
        ) : action === "day" ? (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(startDay(session))}>
            {ACTION_LABELS.day}
          </button>
        ) : action === "vote" ? (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(startVote(session, content, r.nominees))}>
            {ACTION_LABELS.vote} ({r.nominees.length === 1 ? "1 кандидат" : `${r.nominees.length} кандидата`})
          </button>
        ) : action === "verdict" ? (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void doVerdict()}>
            {ACTION_LABELS.verdict}
          </button>
        ) : action === "revote" ? (
          <>
            <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(startVote(session, content, r.nominees, true))}>
              {ACTION_LABELS.revote}
            </button>
            <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run(startNight(session))}>
              Никто не уходит — {ACTION_LABELS.night.toLowerCase()}
            </button>
          </>
        ) : action === "night" ? (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(startNight(session))}>
            {ACTION_LABELS.night}
          </button>
        ) : action === "morning" ? (
          <>
            {!rolesReady && <p className="muted small">Утро считается по ролям — откройте пульт на устройстве, где раздавали роли.</p>}
            <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || !rolesReady} onClick={() => void doMorning()}>
              {ACTION_LABELS.morning}
            </button>
          </>
        ) : action === "finish" ? (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || !rolesReady || !r.winner} onClick={() => r.winner && roles && void run(finishGame(session, content, roles, r.winner))}>
            {ACTION_LABELS.finish}
          </button>
        ) : action === "nextParty" ? (
          <>
            <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || players < MAFIA_LIMITS.minPlayers} onClick={() => void run(startDeal(session, participants))}>
              Партия {r.party + 1} из {content.parties}: собрать телефоны
            </button>
            <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={() => confirm({ title: "Закончить игру после этой партии?", text: "Сразу награждение по общему счёту.", confirmLabel: "К награждению", run: () => (hasPodium(session.leaderboard) ? run(awardNow(session)) : control.requestFinish()) })}>
              Закончить и наградить
            </button>
          </>
        ) : action === "podium" ? (
          <>
            {hasPodium(session.leaderboard) ? (
              <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(awardNow(session))}>
                {ACTION_LABELS.podium}
              </button>
            ) : (
              <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => control.requestFinish()}>
                Завершить игру
              </button>
            )}
            {started && r.mode === "over" && (
              <button type="button" className="btn btn--quiet btn--block" disabled={busy || players < MAFIA_LIMITS.minPlayers} onClick={() => void run(startDeal(session, participants))}>
                Сыграть ещё партию
              </button>
            )}
          </>
        ) : null}
        {started && !r.winner && r.mode !== "deal" && r.mode !== "over" && stage !== "podium" && (
          <button
            type="button"
            className="btn btn--quiet btn--block"
            disabled={busy || !rolesReady}
            onClick={() =>
              confirm({
                title: "Закончить партию досрочно?",
                text: "Роли откроются, очков за победу никто не получит. Отменить можно кнопкой «Назад».",
                confirmLabel: "Открыть роли",
                run: () => run(roles ? abortGame(session, roles) : null),
              })
            }
          >
            Закончить досрочно
          </button>
        )}
        <button
          type="button"
          className="btn btn--secondary btn--block"
          disabled={busy || back === null}
          onClick={() => back && void run(back.change, "clearAnswers" in back ? back.clearAnswers : undefined)}
        >
          Назад
        </button>
      </div>
      {dialog}
    </div>
  );
}

function rolesLine(content: MafiaContent, players: number): string {
  const c = countsFor(content, Math.max(players, MAFIA_LIMITS.minPlayers));
  const civ = Math.max(0, players - c.mafia - c.don - c.commissar - c.doctor);
  return [c.don ? `Дон` : "", c.mafia ? `мафия ×${c.mafia}` : "", c.commissar ? "Комиссар" : "", c.doctor ? "Доктор" : "", `мирные ×${civ}`].filter(Boolean).join(", ");
}

function NightPanel({
  r,
  roles,
  night,
  history,
  label,
  doneCount,
  keyless,
  manual,
  onManual,
  nm,
  seat,
}: {
  r: MafiaResult;
  roles: Record<string, RoleId> | null;
  night: { choices: Record<string, string | null>; donCheck: Record<string, string | null>; outcome: ReturnType<typeof resolveNight> } | null;
  history: Array<string | null>;
  label: (pid: string) => ReactNode;
  doneCount: number;
  keyless: string[];
  manual: Record<string, string>;
  onManual: (pid: string, value: string) => void;
  nm: (pid: string | null) => string;
  seat: (pid: string) => number;
}) {
  if (!roles || !night) return <p className="muted">Ночь. Роли этого пульта неизвестны — откройте пульт на устройстве, где раздавали роли.</p>;
  const family = r.alive.filter((p) => isMafia(roles[p]));
  const votes = familyVotes(roles, r.alive, night.choices);
  const unanimous = night.outcome.mafiaTarget;
  const actor = (role: RoleId) => r.alive.find((p) => roles[p] === role) ?? null;
  const doctor = actor("doctor");
  const commissar = actor("commissar");
  const don = actor("don");
  const show = (pid: string | null | undefined) => (pid ? label(pid) : <span className="muted">ещё не выбрал(а)</span>);
  const manualActors = keyless.filter((p) => r.alive.includes(p) && roles[p] && roles[p] !== "civilian");
  const options = (exclude: string | null) =>
    r.alive
      .filter((p) => p !== exclude)
      .map((p) => (
        <option key={p} value={p}>
          №{seat(p)} {nm(p)}
        </option>
      ));
  return (
    <section className="stack stack--tight">
      <p>
        Ночь {r.round}: сделали ход {doneCount} из {r.alive.length - keyless.filter((p) => r.alive.includes(p)).length} с телефонами. Пока ночь идёт, выбор можно менять.
      </p>
      <div className="card stack stack--tight mf-host__night">
        <p>
          {ROLE_ICON.mafia} <strong>Мафия</strong>:{" "}
          {family.map((p, i) => (
            <span key={p}>
              {i > 0 ? "; " : ""}
              {label(p)} → {show(night.choices[p])}
            </span>
          ))}
        </p>
        <p className={unanimous ? "success" : "muted"}>{unanimous ? <>Единогласно — выстрел в {label(unanimous)}</> : Object.keys(votes).length > 1 ? "Голоса семьи расходятся — выстрела не будет" : "Выстрел состоится, только если все мафиози выберут одного"}</p>
        {doctor && (
          <p>
            {ROLE_ICON.doctor} <strong>Доктор</strong> ({label(doctor)}) лечит: {show(night.choices[doctor])}
            {night.choices[doctor] && !canHeal(doctor, night.choices[doctor] as string, history) ? " — нельзя (то же, что прошлой ночью, или себя второй раз): лечение не сработает" : ""}
          </p>
        )}
        {commissar && (
          <p>
            {ROLE_ICON.commissar} <strong>Комиссар</strong> ({label(commissar)}) проверяет: {show(night.choices[commissar])}
            {night.outcome.comCheck ? (night.outcome.comCheck.yes ? " — мафия" : " — не мафия") : ""}
          </p>
        )}
        {don && (
          <p>
            {ROLE_ICON.don} <strong>Дон</strong> ищет Комиссара: {show(night.donCheck[don])}
            {night.outcome.donCheck ? (night.outcome.donCheck.yes ? " — Комиссар!" : " — не Комиссар") : ""}
          </p>
        )}
        <p className="mf-host__news">
          Если утро сейчас: {night.outcome.victim ? <>погибнет {label(night.outcome.victim)}</> : night.outcome.mafiaTarget && night.outcome.healed === night.outcome.mafiaTarget ? "Доктор спасёт — тихая ночь" : "тихая ночь"}
        </p>
      </div>
      {manualActors.length > 0 && (
        <div className="stack stack--tight">
          <p className="eyebrow">Ход игроков без телефона — спросите тихо</p>
          {manualActors.map((p) => (
            <div key={p} className="stack stack--tight">
              <label className="field mf-host__manual">
                <span>
                  {label(p)} · {ROLES[roles[p] as RoleId].title}
                </span>
                <select value={manual[p] ?? ""} onChange={(e) => onManual(p, e.target.value)}>
                  <option value="">не выбрал(а)</option>
                  {options(roles[p] === "doctor" ? null : p)}
                </select>
              </label>
              {roles[p] === "don" && (
                <label className="field mf-host__manual">
                  <span>Проверка Дона</span>
                  <select value={manual[`${p}#check`] ?? ""} onChange={(e) => onManual(`${p}#check`, e.target.value)}>
                    <option value="">не проверяет</option>
                    {options(p)}
                  </select>
                </label>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
