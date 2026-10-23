import { useEffect, useRef, useState } from "react";
import { resultKey } from "../../core/session";
import type { Session, SessionChange, SessionState } from "../../data/types";
import type { SessionControl } from "../../mechanics/types";

/**
 * Общая запись пульта для механик (CLAUDE.md, раздел 6, «Кнопки пульта»).
 *
 * Изменение — готовая запись, null (действие сейчас недоступно) или функция от свежей сессии: её можно
 * собрать заново, если, пока ведущий нажимал, фон пульта (симпатия зала, голоса, фишки, кнопка «кто первый»)
 * успел записать итоги шага.
 */
export type HostMake = SessionChange | null | ((s: Session) => SessionChange | null | Promise<SessionChange | null>);

export interface HostRunOptions {
  /** Убрать ответы этих шагов перед записью («Назад» с открытого вопроса). */
  clear?: number[];
  /**
   * Собрать запись заново по свежей сессии и повторить один раз, если сервер отказал только из-за
   * изменившихся итогов шага (по умолчанию да — для изменений-функций). false — для действий, которые
   * нельзя повторять по другому виду (очки «Неверно» тому, кто теперь первый).
   */
  retry?: boolean;
  /** Текст, если изменение сейчас недоступно (null на первой попытке). Без него — молча. */
  emptyText?: string;
  /** Свой текст ошибки (null — общий «Не получилось…»). */
  errorText?: (error: unknown) => string | null;
  /**
   * Сколько раз всего пробовать, если сервер отказывает только из-за итогов шага (по умолчанию 2: касание и один
   * повтор). Больше — для безопасных действий, которые фон пульта перебивает часто («Ещё 10 с на ответ», пока
   * телефоны жмут кнопку и пульт пишет очередь).
   */
  attempts?: number;
  /** Свой «момент» для этого касания вместо общего `setup.moment` (см. `HostRunDeps.moment`). */
  moment?: (s: Session) => string;
}

/** Итог одной записи пульта (для проверок без React). */
export type HostRunOutcome = "done" | "none" | "empty" | "moved" | "conflict" | { error: unknown };

export interface HostRunDeps {
  /** Сессия, которую видел ведущий в момент касания. */
  seen: Session;
  /** Свежая сессия (последнее, что пришло с сервера). */
  current: () => Session;
  /** Дождаться следующего обновления сессии (не дольше 3 с). */
  nextSession: () => Promise<void>;
  apply: (change: SessionChange) => Promise<void>;
  clearAnswers: (step: number) => Promise<void>;
  rehearsal: boolean;
  /**
   * Момент игры внутри этапа (из итогов шага, без того, что пишет фон: подарки, голоса, фишки). Повтор —
   * только если момент тот же, что видел ведущий: иначе «Выполнено» второго пульта не засчитается дважды.
   */
  moment?: (s: Session) => string;
  /**
   * Дождаться фоновой записи пульта, которая уже ушла на сервер (ход с телефона, голоса), и её возвращения: иначе
   * касание ведущего сразу получит отказ из-за неё. Вызывается один раз перед первой попыткой.
   */
  settle?: () => Promise<void>;
}

export const GAME_CHANGED_TEXT = "Игра изменилась — нажмите ещё раз.";
const FAILED_TEXT = "Не получилось. Проверьте интернет и нажмите ещё раз.";

export function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? (error as { code: unknown }).code : null;
}

/** В записи нечего менять — не отправляем. */
export function isEmptyChange(change: SessionChange): boolean {
  return !change.state && !change.leaderboard && !change.addScore && !change.rename;
}

function samePlace(a: SessionState, b: SessionState): boolean {
  return a.phase === b.phase && a.step === b.step && a.stage === b.stage;
}

/**
 * Одна запись пульта с проверкой «игра там, где её видел ведущий»: этап, шаг и отпечаток итогов той сессии,
 * по которой собрана запись. Сервер отказал только из-за итогов шага (фон пульта, телефон) — ждём свежую
 * сессию, собираем запись заново и повторяем один раз; не вышло — `conflict`. Игра ушла дальше (второй
 * пульт, двойное касание) — `moved`, молча, как раньше.
 */
export async function runHostChange(make: HostMake, options: HostRunOptions, deps: HostRunDeps): Promise<HostRunOutcome> {
  const at = deps.seen.state;
  const rebuild = typeof make === "function" && options.retry !== false;
  const clear = options.clear ?? [];
  const moment = options.moment ?? deps.moment;
  const attempts = Math.max(1, options.attempts ?? 2);
  if (deps.settle) {
    await deps.settle();
    // Фон успел увести игру на другой этап или шаг (телефон уже бросил кубик) — молча, касание больше не нужно.
    if (!samePlace(deps.current().state, at)) return "moved";
  }
  for (let attempt = 0; ; attempt++) {
    const basis = typeof make === "function" ? deps.current() : deps.seen;
    const change = typeof make === "function" ? await make(basis) : make;
    if (!change) return attempt === 0 ? "none" : "moved";
    if (isEmptyChange(change)) return "empty";
    // После ожиданий (свежие ответы с сервера): игра ушла дальше — запись всё равно получит отказ.
    if (!samePlace(deps.current().state, at)) return "moved";
    const key = resultKey(basis.state.result);
    let conflict = false;
    // Ответы стираем, только если игра всё ещё та, по которой собрана запись: иначе телефон потеряет свежий ответ.
    if (clear.length > 0 && resultKey(deps.current().state.result) !== key) conflict = true;
    else {
      const arrived = deps.rehearsal ? Promise.resolve() : deps.nextSession();
      try {
        for (const s of clear) await deps.clearAnswers(s);
        await deps.apply({ ...change, expect: { phase: at.phase, step: at.step, stage: at.stage, result: key } });
      } catch (e) {
        if (errorCode(e) !== "failed-precondition") return { error: e };
        conflict = true;
      }
      if (!conflict) {
        await arrived;
        return "done";
      }
    }
    if (attempt >= attempts - 1 || !rebuild) return samePlace(deps.current().state, at) ? "conflict" : "moved";
    // Свежие итоги шага ещё не пришли — ждём их, потом собираем запись заново.
    if (resultKey(deps.current().state.result) === key) await deps.nextSession();
    if (!samePlace(deps.current().state, at)) return "moved";
    if (moment && moment(deps.current()) !== moment(deps.seen)) return "conflict";
  }
}

/**
 * Пульт механики: `run` — касание ведущего (кнопки гаснут, пока запись не вернётся, не дольше 3 с),
 * `setup.moment` — момент игры внутри этапа (см. `HostRunDeps.moment`), `quiet` — фоновая запись (ход с телефона,
 * симпатия зала, голоса на экран): без «занято» и не во время записи ведущего, чтобы не перебить его касание.
 */
export interface HostRunSetup extends Pick<HostRunOptions, "emptyText" | "errorText"> {
  /** Момент игры внутри этапа (см. `HostRunDeps.moment`). */
  moment?: (s: Session) => string;
}

export function useHostRun(session: Session, control: SessionControl, rehearsal: boolean, setup: HostRunSetup = {}) {
  const [busy, setBusy] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);
  const latest = useRef<Session>(session);
  const inFlight = useRef(false);
  const waiters = useRef<Array<() => void>>([]);
  const noticeTimer = useRef<number | undefined>(undefined);
  /** Фоновая запись, которая сейчас идёт на сервер (`quiet`). */
  const quietPending = useRef<Promise<boolean> | null>(null);
  /** Сессия, по которой фон записал своё, пока его запись ещё не вернулась потоком событий. */
  const quietEcho = useRef<Session | null>(null);

  useEffect(() => {
    latest.current = session;
    if (quietEcho.current && quietEcho.current !== session) quietEcho.current = null;
    const done = waiters.current;
    waiters.current = [];
    done.forEach((w) => w());
  }, [session]);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  function setError(text: string | null) {
    window.clearTimeout(noticeTimer.current);
    setErrorState(text);
  }

  function nextSession(): Promise<void> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(resolve, 3000);
      waiters.current.push(() => {
        window.clearTimeout(timer);
        resolve();
      });
    });
  }

  async function run(make: HostMake, options?: HostRunOptions | number[]): Promise<void> {
    if (inFlight.current) return;
    const own: HostRunOptions = Array.isArray(options) ? { clear: options } : (options ?? {});
    const opts: HostRunOptions = { emptyText: setup.emptyText, errorText: setup.errorText, ...own };
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const outcome = await runHostChange(make, opts, {
        seen: session,
        current: () => latest.current,
        nextSession,
        apply: (change) => control.apply(change),
        clearAnswers: (step) => control.clearAnswers(step),
        rehearsal,
        moment: setup.moment,
        settle: async () => {
          if (quietPending.current) await quietPending.current;
          if (!rehearsal && quietEcho.current && quietEcho.current === latest.current) await nextSession();
        },
      });
      if (outcome === "none") {
        if (opts.emptyText) setError(opts.emptyText);
      } else if (outcome === "conflict") {
        setError(GAME_CHANGED_TEXT);
        noticeTimer.current = window.setTimeout(() => setErrorState((cur) => (cur === GAME_CHANGED_TEXT ? null : cur)), 4000);
      } else if (typeof outcome === "object") {
        setError(opts.errorText?.(outcome.error) ?? FAILED_TEXT);
      }
    } catch (e) {
      // Ошибка при сборке записи (свежие ответы и т. п.).
      setError(opts.errorText?.(e) ?? FAILED_TEXT);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  /**
   * Фоновая запись по свежей сессии; пока ведущий записывает своё — пропускается (эффект повторит: у него в
   * зависимостях `busy`). Отказ сервера — молча: фон посчитает заново по свежей сессии. true — записано.
   */
  async function quiet(make: SessionChange | null | ((s: Session) => SessionChange | null | Promise<SessionChange | null>)): Promise<boolean> {
    if (inFlight.current) return false;
    const s = latest.current;
    const job = (async () => {
      try {
        const change = typeof make === "function" ? await make(s) : make;
        if (!change || isEmptyChange(change) || inFlight.current) return false;
        const { phase, step, stage } = s.state;
        await control.apply({ ...change, expect: { phase, step, stage, result: resultKey(s.state.result) } });
        // Пока запись не вернулась потоком, касание ведущего подождёт её (`settle`), а не получит отказ.
        if (latest.current === s) quietEcho.current = s;
        return true;
      } catch {
        return false;
      }
    })();
    quietPending.current = job;
    try {
      return await job;
    } finally {
      if (quietPending.current === job) quietPending.current = null;
    }
  }

  return { busy, error, setError, latest, inFlight, nextSession, run, quiet };
}
