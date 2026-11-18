/** Пульт ведущего «Игр Матрёшки» (3d): только поток host и команды комнаты; все решения и переходы — на сервере. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { MATRYOSHKA_TITLE } from "../../../core/matryoshkaTitle";
import type { HostView, TrialKind } from "../rules/types";
import { errorParts, type HostLink } from "./link";
import { applyHost, commandError, duelLabel, emptyHost, leftOf, mmss, nextLabel, pausedMomentOf, type HostModel } from "./model";
import "./host.css";

export interface HostProps {
  link: HostLink;
  sessionFinished?: boolean;
  now?: () => number;
  onView?: (view: HostView) => void;
  onFinish?: () => void;
  /** Платформа готовит завершение: команды не должны уходить параллельно. */
  finishing?: boolean;
}

interface Confirm {
  title: string;
  text: string;
  label: string;
  cmd: string;
  args?: unknown;
}
interface OpenConfirm extends Confirm { moment: string }

type PlayerFilter = "all" | "offline" | "returnable";

const TRIAL_TITLES: Record<TrialKind, string> = { freeze: "Замри!", ginger: "Пряник", chairs: "Стулья", rope: "Канат", hopscotch: "Классики" };
const RULES: Record<TrialKind, string> = {
  freeze: "Держи — бежишь. Отпустил — стоишь. Когда Матрёшка смотрит — не держи зону.",
  ginger: "Выбери коробку и обведи фигуру по линии. Слишком долго вне полосы — пряник треснет.",
  chairs: "Танцуй, а после остановки выбери свободный стул на телефоне. Кого не сел — тот прозевал.",
  rope: "Тапай часто и вместе со своей стороной. Болельщики помогают рывками вполсилы.",
  hopscotch: "Выбери клетку. Смельчаки прыгают первыми, но исход их прыжка остальные не видят.",
};

function useTick(ms: number, on: boolean): void {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const h = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(h);
  }, [ms, on]);
}

function rec(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function num(value: unknown, fallback = 0): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
function str(value: unknown, fallback = ""): string { return typeof value === "string" ? value : fallback; }
function arr(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function playerName(v: HostView, pid: string): string {
  const p = v.players.find((x) => x.pid === pid);
  return p ? `№ ${String(p.num).padStart(3, "0")} ${p.name}` : "Игрок";
}

export function MatryoshkaHost({ link, sessionFinished = false, now = () => Date.now(), onView, onFinish, finishing = false }: HostProps) {
  const [m, setM] = useState<HostModel>(emptyHost);
  const [gen, setGen] = useState(0);
  const [take, setTake] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ seq: number; until: number; inFlight: boolean } | null>(null);
  const [confirm, setConfirm] = useState<OpenConfirm | null>(null);
  const [playersOpen, setPlayersOpen] = useState(false);
  const [playerFilter, setPlayerFilter] = useState<PlayerFilter>("all");
  const receivedAt = useRef(now());
  const model = useRef(m);
  model.current = m;
  const onViewRef = useRef(onView);
  onViewRef.current = onView;

  useEffect(() => {
    setProblem(null);
    const stop = link.subscribe((event) => {
      receivedAt.current = now();
      setM((x) => applyHost(x, event, receivedAt.current));
    }, (err) => {
      const { reason } = errorParts(err);
      if (reason === "busy" || reason === "replaced" || reason === "finished") setM((x) => ({ ...x, closed: reason }));
      else setProblem("Связь с игрой прервалась.");
    }, take);
    return stop;
    // Новая подписка — только «Открыть здесь» и «Переподключить».
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, gen]);

  useEffect(() => { if (m.view) onViewRef.current?.(m.view); }, [m.view]);
  useEffect(() => { if (pending && !pending.inFlight && m.seq > pending.seq) setPending(null); }, [m.seq, pending]);
  useEffect(() => {
    if (!pending) return;
    const h = setTimeout(() => setPending(null), Math.max(0, pending.until - now()));
    return () => clearTimeout(h);
  }, [pending, now]);

  const v = m.view;
  const pausedAt = pausedMomentOf(m);
  const serverNow = now() + m.skew;
  const busy = pending !== null || finishing;
  useTick(500, v?.endsAt !== null && v !== null && pausedAt === null);

  const run = useCallback(async (cmd: string, args?: unknown, expect: boolean | string = true): Promise<boolean> => {
    const before = model.current;
    setError(null);
    setPending({ seq: before.seq, until: now() + 10_000, inFlight: true });
    const moment = typeof expect === "string" ? expect : expect ? before.moment : undefined;
    try {
      await link.command(cmd, args, moment);
      setPending({ seq: model.current.seq, until: now() + 3000, inFlight: false });
      return true;
    } catch (e) {
      const { code, reason } = errorParts(e);
      const text = commandError(code, reason);
      if (text) { setError(text); setPending(null); }
      else setPending({ seq: model.current.seq, until: now() + 3000, inFlight: false });
      return false;
    }
  }, [link, now]);

  const ask = (c: Confirm) => setConfirm({ ...c, moment: model.current.moment });
  const doConfirm = async () => {
    const c = confirm;
    if (!c) return;
    setConfirm(null);
    await run(c.cmd, c.args, c.moment);
  };
  const openPlayers = (returnable = false) => { setPlayerFilter(returnable ? "returnable" : "all"); setPlayersOpen(true); };

  if (m.closed === "busy" || m.closed === "replaced") return (
    <Notice title={m.closed === "replaced" ? "Этот пульт отключился" : "Пульт уже открыт в трёх вкладках"} text="Нажмите «Открыть здесь» — самая старая вкладка пульта на этом устройстве отключится.">
      <button type="button" className="btn btn--block" onClick={() => { setM(emptyHost()); setTake(true); setGen((g) => g + 1); }}>Открыть здесь</button>
    </Notice>
  );
  if (m.closed === "abandoned") return (
    <Notice title="Игра долго стояла" text="Больше 12 часов не было действий. Можно продолжить с того же места.">
      <button type="button" className="btn btn--block" disabled={busy} onClick={async () => { await run("resume", undefined, false); setM(emptyHost()); setGen((g) => g + 1); }}>Продолжить игру</button>
    </Notice>
  );
  if (m.closed === "finished" || sessionFinished) return <Notice title="Игра завершена" text="Итоги сохранены в «Истории игр»." />;
  if (problem && !v) return <Notice title="Нет связи с игрой" text="Проверьте интернет и переподключитесь."><button type="button" className="btn btn--block" onClick={() => setGen((g) => g + 1)}>Переподключить</button></Notice>;
  if (!v) return <div className="math" aria-busy="true"><p className="muted">Подключаемся к игре…</p></div>;

  const lag = m.loop ? Math.round(m.loop.maxLagMs) : null;
  return (
    <div className={m.paused ? "math is-paused" : "math"}>
      <header className="math-head">
        <div>
          <p className="eyebrow">{MATRYOSHKA_TITLE} · {v.style === "night" ? "Ночной двор" : "Солнечный двор"}</p>
          <h2>{titleOf(v)}</h2>
        </div>
        <button type="button" className="btn btn--secondary math-players-button" onClick={() => openPlayers(false)}>Игроки · {v.players.length}</button>
        <p className="math-status">
          <span>на связи {m.online} из {m.players}</span>
          {lag !== null && <span className={lag > 100 ? "is-warn" : undefined}>цикл {lag} мс</span>}
          {m.paused && <span className="is-warn">пауза</span>}
        </p>
      </header>

      {problem && <p className="error" role="alert">{problem} <button type="button" className="btn btn--quiet" onClick={() => setGen((g) => g + 1)}>Переподключить</button></p>}
      {m.paused && v.phase !== "lobby" && v.phase !== "podium" && v.phase !== "finished" && (
        <section className="math-pause" role="status">
          <b>{m.restored ? "Сервер перезапускался — игра на паузе" : "Игра на паузе — время стоит"}</b>
          <p className="small">Отсчёты и события стоят. После продолжения удержание на телефоне начинается новым касанием.</p>
          <button type="button" className="btn btn--block" disabled={busy} onClick={() => void run("resume", undefined, false)}>▶ Продолжить игру</button>
        </section>
      )}

      {playersOpen ? (
        <PlayerPanel v={v} busy={busy || m.paused} filter={playerFilter} setFilter={setPlayerFilter} onClose={() => setPlayersOpen(false)} onReturn={(pid) => void run("return", { pid })} onRemove={(player) => ask({
          title: `Убрать № ${String(player.num).padStart(3, "0")} ${player.name}?`,
          text: `Гость станет болельщиком без монеты, место — как выбывший сейчас. ${isDuelist(v, player.pid) ? "Он в дуэли: соперник выиграет автоматически. " : ""}До разрешённого этапа его можно вернуть.`,
          label: "Убрать из игры", cmd: "remove", args: { pid: player.pid },
        })} />
      ) : (
        <Board v={v} busy={busy} paused={m.paused} run={run} ask={ask} serverNow={serverNow} pausedAt={pausedAt} openPlayers={openPlayers} onFinish={onFinish} finishing={finishing} />
      )}
      {error && <p className="error" role="alert">{error}</p>}

      <footer className="math-footer">
        {v.can.board && <button type="button" className={v.board ? "btn btn--secondary is-on" : "btn btn--secondary"} disabled={busy} onClick={() => void run("board")}>{v.board ? "Убрать табло" : "Табло на экран"}</button>}
        {!m.paused && !["lobby", "podium", "finished"].includes(v.phase) && <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => void run("pause", undefined, false)}>⏸ Пауза</button>}
      </footer>

      <ConfirmDialog open={confirm !== null} title={confirm?.title ?? ""} confirmLabel={confirm?.label ?? "Да"} onConfirm={() => void doConfirm()} onCancel={() => setConfirm(null)}>
        <p>{confirm?.text}</p>
      </ConfirmDialog>
    </div>
  );
}

function titleOf(v: HostView): string {
  if (v.phase === "lobby") return "Ждём гостей";
  if (v.phase === "trial") {
    const kind = str(rec(v.trial)?.kind) as TrialKind;
    const name = TRIAL_TITLES[kind] ?? "Испытание";
    const stages: Record<string, string> = { open: "раскрытие", rules: "правило", countdown: "отсчёт", play: "игра", judging: "проверка", reveal: "вскрытие", results: "итоги" };
    return `${name} · ${stages[v.stage] ?? v.stage}`;
  }
  if (v.phase === "chance") return `Второй шанс · ${{ offer: "открытие", question: "вопрос", back: "результат", done: "итоги" }[v.stage] ?? v.stage}`;
  if (v.phase === "dobivka") return v.stage === "results" ? "Добивка · итоги" : "Добивка";
  if (v.phase === "final") return v.stage === "bracket" ? "Сетка финала" : v.stage === "champion" ? "Чемпион двора" : "Финальная дуэль";
  if (v.phase === "podium") return "Чемпион и пьедестал";
  return "Игра завершена";
}

function Notice({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return <div className="math" role="status"><h2>{title}</h2><p className="muted">{text}</p>{children && <div className="actions">{children}</div>}</div>;
}

interface BoardProps {
  v: HostView;
  busy: boolean;
  paused: boolean;
  run: (cmd: string, args?: unknown, expect?: boolean | string) => Promise<boolean>;
  ask: (confirm: Confirm) => void;
  serverNow: number;
  pausedAt: number | null;
  openPlayers: (returnable?: boolean) => void;
  onFinish?: () => void;
  finishing: boolean;
}

function Board(p: BoardProps) {
  const { v, busy, paused } = p;
  const disabled = busy || paused;
  if (v.phase === "finished") return <section className="math-sec"><p>Комната игры завершена. Итоги готовы для сохранения платформой.</p></section>;
  if (v.phase === "lobby") return <Lobby v={v} busy={busy} run={p.run} />;
  if (v.phase === "trial") return <Trial {...p} disabled={disabled} />;
  if (v.phase === "chance") return <Chance {...p} disabled={disabled} />;
  if (v.phase === "dobivka") return <Dobivka {...p} disabled={disabled} />;
  if (v.phase === "final") return <Final {...p} disabled={disabled} />;
  if (v.phase === "podium") return <Podium v={v} busy={busy} onFinish={p.onFinish} finishing={p.finishing} />;
  return null;
}

function Timer({ v, serverNow, pausedAt }: { v: HostView; serverNow: number; pausedAt: number | null }) {
  const left = leftOf(v.endsAt, serverNow, pausedAt);
  if (left === null) return null;
  return <div className="math-timer"><span>{pausedAt !== null ? "На паузе" : "Осталось"}</span><strong>{mmss(left)}</strong></div>;
}

function Metrics({ items }: { items: Array<[string, string | number]> }) {
  return <div className="math-metrics">{items.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>;
}

function Target({ v }: { v: HostView }) {
  if (!v.target) return null;
  return v.target.seeding ? <p className="math-note">Испытание на посев — никто не теряет сердечко.</p> : <Metrics items={[["Сейчас", v.target.A], ["Цель T", v.target.T], ["Выбывать", v.target.need]]} />;
}

function Lobby({ v, busy, run }: { v: HostView; busy: boolean; run: BoardProps["run"] }) {
  const count = num(v.lobbyCount, v.players.length);
  const need = Math.max(0, 6 - count);
  return <section className="math-sec">
    <div className="math-lobby"><strong>{count}</strong><span>гостей во дворе · вход открыт</span></div>
    <Metrics items={[["Финалистов", v.F], ["Сердечек", v.lives], ["Минимум", 6]]} />
    <p className="small muted">После «Начать» новые гости становятся болельщиками. Первые 100 по входу — игроки.</p>
    <button type="button" className="btn btn--block" disabled={busy || !v.can.start} onClick={() => void run("start")}>Начать игру</button>
    {need > 0 && <p className="small">Нужно ещё {need} игроков.</p>}
  </section>;
}

function Trial(p: BoardProps & { disabled: boolean }) {
  const { v, disabled, run, ask } = p;
  const t = rec(v.trial);
  const kind = str(t?.kind) as TrialKind;
  const outcome = rec(t?.outcome);
  return <section className="math-sec">
    <Timer v={v} serverNow={p.serverNow} pausedAt={p.pausedAt} />
    <div className="math-progress"><span>Испытание {v.trialIndex + 1} из {v.plan.length}</span><span>{TRIAL_TITLES[kind]}</span></div>
    {v.stage === "rules" && <div className="math-rule"><b>Коротко для ведущего</b><p>{RULES[kind]}</p></div>}
    {(v.stage === "open" || v.stage === "rules") && <Target v={v} />}
    {v.stage === "play" && <PlayMetrics v={v} kind={kind} />}
    {outcome && <Metrics items={[["Выбыли", num(outcome.out)], ["Минус сердечко", num(outcome.lost)], ["Лучший прогноз", num(outcome.guessBest)]]} />}
    {v.stage === "reveal" && <p className="math-note">Идёт вскрытие. Следующий переход будет доступен на итогах.</p>}

    {v.can["skip-rules"] && <button type="button" className="btn btn--block" disabled={disabled} onClick={() => void run("skip-rules")}>Пропустить правило</button>}
    {v.can["skip-trial"] && <button type="button" className="btn btn--secondary btn--block" disabled={disabled} onClick={() => ask({ title: `Пропустить «${TRIAL_TITLES[kind]}»?`, text: "Испытание будет отмечено не сыгранным, никто не выбудет. Откроется следующее.", label: "Пропустить испытание", cmd: "skip-trial" })}>Пропустить испытание</button>}
    {v.can["more-time"] && <MoreTime v={v} disabled={disabled} run={run} />}
    {v.can["end-now"] && <button type="button" className="btn btn--secondary btn--block" disabled={disabled} onClick={() => ask({ title: "Закончить сейчас?", text: kind === "hopscotch" ? "Текущий ряд завершится штатно, следующие ряды не начнутся. Дальше — обычная проверка." : "Текущий этап закончится, дальше — обычная проверка и вскрытие результатов.", label: "Закончить сейчас", cmd: "end-now" })}>Закончить сейчас</button>}
    {v.can.chance && <button type="button" className="btn btn--block" disabled={disabled} onClick={() => void run("chance")}>Второй шанс</button>}
    {v.can.next && <button type="button" className={v.can.chance ? "btn btn--secondary btn--block" : "btn btn--block"} disabled={disabled} onClick={() => void run("next")}>{v.can.chance ? "Продолжить без второго шанса" : nextLabel(v)}</button>}
    {v.can.return && <button type="button" className="btn btn--secondary btn--block" disabled={disabled} onClick={() => p.openPlayers(true)}>Вернуть игрока</button>}
    {v.can["to-final"] && <button type="button" className="btn btn--secondary btn--block" disabled={disabled} onClick={() => ask({ title: "Перейти к финалу?", text: "Оставшиеся испытания не будут сыграны. Сетка построится по фактическому числу игроков.", label: "К финалу", cmd: "to-final" })}>К финалу</button>}
    {v.can.back && <button type="button" className="btn btn--quiet btn--block" disabled={disabled} onClick={() => ask({ title: "Переиграть испытание?", text: "Сердечки, вылет, прогнозы, монеты и Копилка вернутся к началу испытания. Вошедшие и убранные останутся.", label: "Назад к началу", cmd: "back" })}>↶ Назад — переиграть испытание</button>}
  </section>;
}

function MoreTime({ v, disabled, run }: { v: HostView; disabled: boolean; run: BoardProps["run"] }) {
  const t = rec(v.trial);
  const play = rec(t?.freeze) ?? rec(t?.ginger);
  const extra = num(play?.extra);
  const limit = extra >= 60_000;
  return <>
    <button type="button" className="btn btn--secondary btn--block" disabled={disabled || limit} onClick={() => void run("more-time")}>+10 секунд{!limit && <span className="math-button-meta"> · ещё {6 - extra / 10_000}</span>}</button>
    {limit && <p className="small muted">Максимум +60 секунд за испытание.</p>}
  </>;
}

function PlayMetrics({ v, kind }: { v: HostView; kind: TrialKind }) {
  const t = rec(v.trial);
  if (kind === "freeze") {
    const x = rec(t?.freeze);
    return <Metrics items={[["В игре", v.inGame], ["Добежали", num(x?.finished)], ["Пойманы", num(x?.caught)], ["Держат", num(x?.holding)]]} />;
  }
  if (kind === "ginger") {
    const x = rec(t?.ginger);
    return <><p className="math-note">Этап: {str(x?.sub) === "pick" ? "выбор коробки" : str(x?.sub) === "unbox" ? "показ фигур" : str(x?.sub) === "trace" ? "обводка" : "проверка"}</p><Metrics items={[["Выбрали", num(x?.picked)], ["Готовы", num(x?.done)], ["Треснули", num(x?.cracked)]]} /></>;
  }
  if (kind === "chairs") {
    const x = rec(t?.chairs);
    return <Metrics items={[["Заход", num(x?.round) + 1], ["Стульев", num(x?.chairs)], ["Сели", num(x?.sat)], ["В заходе", num(x?.inRound)]]} />;
  }
  if (kind === "rope") {
    const x = rec(t?.rope);
    return <Metrics items={[["Попытка", num(x?.attempt) + 1], ["Узел", num(x?.knot)], ["Победы", arr(x?.wins).map((n) => num(n)).join(" : ")]]} />;
  }
  const x = rec(t?.hop);
  return <Metrics items={[["Ряд", num(x?.row) + 1], ["Смельчаки", num(x?.braves)], ["Выбрали", num(x?.picked)], ["Упали", num(x?.fallen)]]} />;
}

function Chance(p: BoardProps & { disabled: boolean }) {
  const { v, disabled, run, ask } = p;
  const c = rec(v.chance);
  const done = v.stage === "done";
  const returned = arr(c?.returned).map(String);
  return <section className="math-sec">
    <Timer v={v} serverNow={p.serverNow} pausedAt={p.pausedAt} />
    <Metrics items={[["Могут ответить", num(c?.eligible)], ["Нужно вернуть", num(c?.count)], ["Ответили", num(c?.answered)]]} />
    {done ? <div className="math-note"><b>Возвращаются: {returned.length}</b><p>Каждый получает 1 сердечко. Монеты прошлого вылета остаются в Копилке.</p></div> : <p className="small muted">Верный ответ и чужие варианты пульт не раскрывает до итога.</p>}
    {done && returned.length > 0 && <div className="math-names">{returned.map((pid) => <span key={pid}>{playerName(v, pid)} · 1 сердечко</span>)}</div>}
    {v.can.next && <button type="button" className="btn btn--block" disabled={disabled} onClick={() => void run("next")}>{nextLabel(v)}</button>}
    {v.can.return && <button type="button" className="btn btn--secondary btn--block" disabled={disabled} onClick={() => p.openPlayers(true)}>Вернуть игрока</button>}
    {v.can["to-final"] && <button type="button" className="btn btn--secondary btn--block" disabled={disabled} onClick={() => void run("to-final")}>К финалу</button>}
    {v.can.back && <button type="button" className="btn btn--quiet btn--block" disabled={disabled} onClick={() => ask({ title: "Отменить «Второй шанс»?", text: "Вернёмся к итогам третьего испытания. Вернувшиеся снова станут болельщиками; при повторе будет следующий вопрос.", label: "К итогам испытания", cmd: "back" })}>↶ Назад к итогам третьего испытания</button>}
  </section>;
}

function Dobivka(p: BoardProps & { disabled: boolean }) {
  const { v, disabled, run, ask } = p;
  const d = rec(v.dobivka);
  return <section className="math-sec">
    <Timer v={v} serverNow={p.serverNow} pausedAt={p.pausedAt} />
    <Metrics items={[["Нужно убрать", num(d?.need)], ["Рядов", num(d?.rows)], ["Выбрали", num(d?.picked)], ["Выбыли", arr(d?.out).length]]} />
    {v.can.next && <button type="button" className="btn btn--block" disabled={disabled} onClick={() => void run("next")}>К сетке финала</button>}
    {v.can.back && <button type="button" className="btn btn--quiet btn--block" disabled={disabled} onClick={() => ask({ title: "Переиграть добивку?", text: "Результаты всех рядов добивки будут отменены.", label: "Переиграть добивку", cmd: "back" })}>↶ Назад — переиграть добивку</button>}
  </section>;
}

function Final(p: BoardProps & { disabled: boolean }) {
  const { v, disabled, run, ask } = p;
  const f = rec(v.final);
  const d = rec(f?.duel);
  if (!f) return null;
  if (f.stage === "bracket") return <section className="math-sec"><Bracket v={v} f={f} />{v.can.duel && <button type="button" className="btn btn--block" disabled={disabled} onClick={() => void run("duel")}>{duelLabel(v)}</button>}{v.can.back && <button type="button" className="btn btn--quiet btn--block" disabled={disabled} onClick={() => ask({ title: "Вернуться к последнему испытанию?", text: "Сетка отменится, последнее испытание начнётся заново с полным отсчётом и новой случайностью.", label: "Назад к испытанию", cmd: "back" })}>↶ Назад</button>}</section>;
  if (f.stage === "champion") {
    const champion = str(f.champion);
    return <section className="math-sec"><div className="math-champion"><span>Чемпион двора</span><strong>{champion ? playerName(v, champion) : "Без чемпиона"}</strong></div>{v.can.podium && <button type="button" className="btn btn--block" disabled={disabled} onClick={() => void run("podium")}>Пьедестал</button>}</section>;
  }
  if (!d) return null;
  const a = str(d.a), b = str(d.b);
  const wins = arr(d.wins).map((x) => num(x));
  const over = d.stage === "over";
  return <section className="math-sec">
    <Timer v={v} serverNow={p.serverNow} pausedAt={p.pausedAt} />
    <div className="math-duel"><Duelist v={v} pid={a} score={wins[0] ?? 0} online={arr(d.online)[0] !== false} /><strong>{wins[0] ?? 0} : {wins[1] ?? 0}</strong><Duelist v={v} pid={b} score={wins[1] ?? 0} online={arr(d.online)[1] !== false} /></div>
    <p className="small muted">Раунд {num(d.roundNo)} · {over ? `победил ${playerName(v, str(d.winner))}` : d.stage === "show" ? "жесты показаны" : d.stage === "bets" ? "ставки болельщиков" : "жесты скрыты"}</p>
    {v.can.duel && <button type="button" className="btn btn--block" disabled={disabled} onClick={() => void run("duel")}>{duelLabel(v)}</button>}
    {v.can.rerun && <button type="button" className="btn btn--secondary btn--block" disabled={disabled} onClick={() => ask({ title: "Переиграть раунд?", text: "Текущий раунд и его показанный итог будут отменены. Ставки перед дуэлью сохранятся.", label: "Переиграть раунд", cmd: "rerun" })}>Переиграть раунд</button>}
    {v.can.forfeit && <div className="math-forfeit"><span>Если игрок не может продолжить — он проиграет всю дуэль:</span><div><button type="button" className="btn btn--quiet" disabled={disabled} onClick={() => ask({ title: `Засчитать победу: ${playerName(v, b)}?`, text: `${playerName(v, a)} проиграет всю дуэль, не только текущий раунд.`, label: "Засчитать победу", cmd: "forfeit", args: { pid: a } })}>Победа: {playerName(v, b)}</button><button type="button" className="btn btn--quiet" disabled={disabled} onClick={() => ask({ title: `Засчитать победу: ${playerName(v, a)}?`, text: `${playerName(v, b)} проиграет всю дуэль, не только текущий раунд.`, label: "Засчитать победу", cmd: "forfeit", args: { pid: b } })}>Победа: {playerName(v, a)}</button></div></div>}
  </section>;
}

function Duelist({ v, pid, score, online }: { v: HostView; pid: string; score: number; online: boolean }) {
  return <div className="math-duelist"><strong>{playerName(v, pid)}</strong><span>побед: {score} · {online ? "на связи" : "нет связи"}</span></div>;
}

function Bracket({ v, f }: { v: HostView; f: Record<string, unknown> }) {
  const rounds = arr(f.rounds);
  const winners = arr(f.winners);
  return <div className="math-bracket">{rounds.map((round, ri) => <div key={ri} className="math-bracket-round"><span>{ri === rounds.length - 1 ? "Финал" : ri === rounds.length - 2 ? "Полуфиналы" : `Круг ${ri + 1}`}</span>{arr(round).map((match, mi) => {
    const pair = arr(match);
    const winner = arr(winners[ri])[mi];
    return <div className="math-match" key={mi}><small>Матч {mi + 1}</small>{pair.map((pid, side) => <strong className={typeof winner === "string" && winner === pid ? "is-winner" : undefined} key={side}>{typeof pid === "string" ? playerName(v, pid) : "Без соперника"}</strong>)}</div>;
  })}</div>)}</div>;
}

function Podium({ v, busy, onFinish, finishing }: { v: HostView; busy: boolean; onFinish?: () => void; finishing: boolean }) {
  const rows = Array.isArray(v.standings) ? v.standings.filter((x) => !x.removed && x.place <= 3) : [];
  const f = rec(v.final);
  const bestFan = str(f?.bestFan);
  return <section className="math-sec">
    <ol className="math-podium">{rows.map((row) => <li key={row.pid}><span>{row.place}</span><strong>№ {String(row.num).padStart(3, "0")} {row.name}</strong><small>{row.points} очков</small></li>)}</ol>
    {bestFan && <p className="math-note">Лучший болельщик: {playerName(v, bestFan)}</p>}
    <button type="button" className="btn btn--block" disabled={busy || !onFinish} onClick={onFinish}>{finishing ? "Сохраняем итоги…" : "Сохранить итоги и завершить"}</button>
  </section>;
}

function isDuelist(v: HostView, pid: string): boolean {
  const d = rec(rec(v.final)?.duel);
  return d?.stage !== "over" && (d?.a === pid || d?.b === pid);
}

function PlayerPanel({ v, busy, filter, setFilter, onClose, onReturn, onRemove }: {
  v: HostView;
  busy: boolean;
  filter: PlayerFilter;
  setFilter: (filter: PlayerFilter) => void;
  onClose: () => void;
  onReturn: (pid: string) => void;
  onRemove: (player: HostView["players"][number]) => void;
}) {
  const [query, setQuery] = useState("");
  const players = useMemo(() => v.players.filter((p) => {
    if (!`${p.num} ${p.name}`.toLowerCase().includes(query.trim().toLowerCase())) return false;
    if (filter === "offline") return !p.online;
    if (filter === "returnable") return v.returnable.includes(p.pid);
    return true;
  }), [v.players, v.returnable, query, filter]);
  return <section className="math-sec math-player-panel">
    <div className="math-panel-title"><strong>Игроки и болельщики</strong><button type="button" className="btn btn--quiet" onClick={onClose}>К текущему этапу</button></div>
    <label className="field"><span>Найти по имени или номеру</span><input value={query} onChange={(e) => setQuery(e.target.value)} /></label>
    <div className="math-filters">{([["all", "Все"], ["offline", "Без связи"], ["returnable", "Можно вернуть"]] as const).map(([id, label]) => <button type="button" key={id} className={filter === id ? "btn btn--secondary is-on" : "btn btn--quiet"} onClick={() => setFilter(id)}>{label}</button>)}</div>
    <div className="math-player-list">{players.map((p) => <div className="math-player" key={p.pid}>
      <span>№ {String(p.num).padStart(3, "0")}</span>
      <div><strong>{p.name}</strong><small>{p.late ? "Опоздавший болельщик" : p.role === "player" ? `В игре · сердечек ${p.hearts}` : `Болельщик${p.outAt ? ` · выбыл: ${p.outAt}` : ""}`} · {p.online ? "на связи" : "нет связи"}</small></div>
      {p.role === "player" && v.can.remove && <button type="button" className="btn btn--quiet math-danger" disabled={busy} onClick={() => onRemove(p)}>Убрать</button>}
      {p.role !== "player" && v.can.return && v.returnable.includes(p.pid) && <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => onReturn(p.pid)}>Вернуть</button>}
    </div>)}</div>
    {players.length === 0 && <p className="muted">Никого не нашли — измените запрос или фильтр.</p>}
  </section>;
}
