import { useCallback, useEffect, useRef, useState } from "react";
import { dataBackend, errorCodeOf, isPermanentError } from "../data";
export { draftRestoreMode } from "./draftRestore";

/**
 * saved — всё подтверждено сервером; saving — запись в пути; offline — связи нет, правки
 * ждут в очереди на устройстве; error — сервер отказал, повторяем; conflict — пока правили, это изменил
 * другой человек: запись остановлена, правки ждут решения («Открыть свежую версию» / «Сохранить мою поверх»);
 * denied — сервер отказал насовсем (игру удалили, нет доступа, вышли из аккаунта): повторять бесполезно, правки
 * остались в черновике на устройстве; slow — связь есть и сервер отвечает, но запись идёт дольше обычного (не «нет связи»).
 */
export type SaveStatus = "saved" | "saving" | "slow" | "offline" | "error" | "conflict" | "denied";

/** Через сколько после последней правки уходит запись. */
const SAVE_DELAY_MS = 700;
/** Сервер молчит дольше при живой связи — «сохраняется дольше обычного». */
const OFFLINE_AFTER_MS = 5000;
const RETRY_DELAY_MS = 4000;

const DRAFT_PREFIX = "joyrest.draft.";

/**
 * Неподтверждённые правки, оставшиеся на устройстве (вкладку закрыли без связи). `at` — когда записаны (часы телефона,
 * только чтобы показать человеку); `base` — версия на сервере, поверх которой лежат правки: `updatedAt` игры при открытии,
 * а после каждого подтверждённого сохранения — версия, которую вернул сервер (undefined — версия неизвестна: черновик
 * старого формата или сервер версию не вернул); `saved` — в том же открытии что-то уже сохранялось (только для справки).
 */
export interface Draft<Patch> {
  at: number;
  base: number | null | undefined;
  saved: boolean;
  patch: Patch;
}

export function readDraft<Patch>(key: string): Draft<Patch> | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: unknown; base?: unknown; saved?: unknown; patch?: unknown };
    if (typeof parsed.at !== "number" || typeof parsed.patch !== "object" || parsed.patch === null) return null;
    const base = typeof parsed.base === "number" || parsed.base === null ? parsed.base : undefined;
    return { at: parsed.at, base, saved: parsed.saved === true, patch: parsed.patch as Patch };
  } catch {
    return null;
  }
}

export function dropDraft(key: string): void {
  try {
    localStorage.removeItem(DRAFT_PREFIX + key);
  } catch {
    // Нет хранилища — нечего убирать.
  }
}

function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/**
 * Автосохранение правок. Правки копятся 0,7 с и уходят пачкой, не дожидаясь ответа на
 * предыдущую: слой данных сразу кладёт запись в очередь на устройстве (локальный кэш
 * Firestore), поэтому при плохом интернете и даже после закрытия вкладки ничего не теряется.
 * После отказа сервера пачка повторяется с самыми свежими значениями полей; отказ насовсем (`isPermanentError`:
 * игру удалили, нет доступа) не повторяется — статус `denied`, правки остаются в черновике.
 *
 * Свой сервер: пачки уходят по одной (следующая — после ответа на предыдущую), иначе сервер мог
 * бы записать старую пачку поверх новой.
 */
export function useAutosave<Patch extends object>(
  /** Запись на сервер; число в ответе — новая версия игры на сервере (свой сервер), её запоминает черновик. */
  save: (patch: Patch) => Promise<number | null | void>,
  /** Ключ черновика: неподтверждённые правки лежат на устройстве и переживают закрытие вкладки без связи. */
  draftKey?: string,
  /**
   * Версия на сервере при открытии (`updatedAt`): пишется в черновик, чтобы потом понять, меняли ли игру без нас. После
   * каждого подтверждённого сохранения черновик берёт версию из ответа сервера; сервер её не вернул — версия неизвестна.
   */
  draftBase?: number | null,
): {
  status: SaveStatus;
  /** Код отказа сервера при `denied` (`not-found`, `permission-denied`, `unauthenticated`…). */
  deniedCode: string | null;
  /** Есть правки, которые сервер ещё не подтвердил. */
  pendingChanges: () => boolean;
  change: (patch: Patch) => void;
  flush: (force?: unknown) => void;
  resume: () => void;
} {
  const [, rerender] = useState(0);
  const pending = useRef<Patch | null>(null);
  /** Самые свежие значения всех полей, которые меняли: для повтора после ошибки. */
  const latest = useRef<Partial<Patch>>({});
  const timer = useRef<number | null>(null);
  const inFlight = useRef(0);
  const oldestSent = useRef<number | null>(null);
  const failed = useRef(false);
  /** Сервер сказал «это изменил другой человек» — не повторяем, пока человек не решит. */
  const conflict = useRef(false);
  /** Сервер отказал насовсем — не повторяем каждые 4 с, ждём решения человека. */
  const denied = useRef<string | null>(null);
  /** В этом открытии сервер уже что-то подтвердил. */
  const confirmedAny = useRef(false);
  /** Версия на сервере, поверх которой лежат неподтверждённые правки (undefined — неизвестна). */
  const base = useRef<number | null | undefined>(draftBase);
  const [online, setOnline] = useState(isOnline);
  const [slow, setSlow] = useState(false);
  const saveRef = useRef(save);
  saveRef.current = save;
  /** Все правки, которые сервер ещё не подтвердил (для черновика на устройстве). */
  const unsent = useRef<Partial<Patch>>({});
  /** Экран открыт. После ухода со страницы — ни повторов по таймеру, ни чужого черновика (QA 22 октября 2026, третий круг). */
  const alive = useRef(true);
  /** Что этот экземпляр последним положил в черновик: после ухода трогаем черновик, только если он всё ещё наш. */
  const lastDraft = useRef<string | null>(null);
  const writeDraft = useCallback(() => {
    if (!draftKey) return;
    try {
      const key = DRAFT_PREFIX + draftKey;
      // Ушли со страницы, а ответ пришёл позже: ту же игру могли открыть снова — её черновик не стираем и не переписываем.
      if (!alive.current && localStorage.getItem(key) !== lastDraft.current) return;
      if (Object.keys(unsent.current).length === 0) {
        localStorage.removeItem(key);
        lastDraft.current = null;
      } else {
        const value = JSON.stringify({ at: Date.now(), base: base.current, saved: confirmedAny.current, patch: unsent.current });
        localStorage.setItem(key, value);
        lastDraft.current = value;
      }
    } catch {
      // Хранилище переполнено или закрыто — правки живут до закрытия вкладки.
    }
  }, [draftKey]);
  /** Черновик на устройстве всё ещё тот, что положил этот экземпляр (без черновика — да). */
  const draftStillOurs = useCallback(() => {
    if (!draftKey) return true;
    try {
      return localStorage.getItem(DRAFT_PREFIX + draftKey) === lastDraft.current;
    } catch {
      return true;
    }
  }, [draftKey]);
  /** Нет связи (сбой сети, сервер недоступен) — это не «сервер отказал». */
  const networkFail = useRef(false);

  const update = useCallback(() => rerender((n) => n + 1), []);

  const flush = useCallback((force?: unknown) => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const patch = pending.current;
    if (!patch) return;
    if (conflict.current || denied.current) return;
    // По одной: следующая пачка уйдёт, как только ответят на эту (и при сворачивании вкладки —
    // иначе старая пачка могла бы лечь поверх новой).
    void force;
    if (dataBackend() === "server" && inFlight.current > 0) return;
    pending.current = null;
    inFlight.current += 1;
    oldestSent.current ??= Date.now();
    update();
    saveRef
      .current(patch)
      .then((version) => {
        failed.current = false;
        networkFail.current = false;
        confirmedAny.current = true;
        // Версия на сервере теперь наша: черновик с оставшимися правками должен ссылаться на неё, а не на версию при
        // открытии (иначе потом не понять, правил ли игру кто-то после нас). Версию не вернули — она неизвестна.
        base.current = typeof version === "number" ? version : undefined;
        // Всё отправленное дошло — черновик на устройстве больше не нужен.
        if (!pending.current && inFlight.current <= 1) unsent.current = {};
        writeDraft();
      })
      .catch((error: unknown) => {
        failed.current = true;
        networkFail.current = errorCodeOf(error) === "unavailable";
        const retry = {} as Patch;
        for (const key of Object.keys(patch) as Array<keyof Patch>) {
          retry[key] = latest.current[key] as Patch[keyof Patch];
        }
        pending.current = { ...retry, ...pending.current };
        // Чужая правка: правки остаются в очереди и в черновике, но не уходят, пока человек не решит.
        if (errorCodeOf(error) === "failed-precondition") {
          conflict.current = true;
          return;
        }
        // Игру удалили, доступ закрыли, вышли из аккаунта: повтор не поможет — правки ждут в черновике.
        if (isPermanentError(error)) {
          denied.current = errorCodeOf(error) || "permission-denied";
          return;
        }
        // Ушли со страницы — не повторяем: правки в черновике, новый экран отправит их сам.
        if (timer.current === null && alive.current) timer.current = window.setTimeout(flush, RETRY_DELAY_MS);
      })
      .finally(() => {
        inFlight.current -= 1;
        if (inFlight.current === 0) {
          oldestSent.current = null;
          setSlow(false);
        }
        if (!alive.current) {
          // Ушли со страницы, пока ждали ответа: накопленное досылаем один раз (без повторов по таймеру) — иначе
          // последние правки остались бы только в черновике, а запуск взял бы старую версию игры (QA 22 октября, круг 4).
          // Но только если черновик всё ещё наш: игру уже открыли снова и правят — старое значение не должно лечь поверх.
          if (pending.current && !failed.current && !conflict.current && !denied.current && draftStillOurs()) flush();
          return;
        }
        update();
        // Пока ждали ответа, накопились правки — отправляем их сразу.
        if (pending.current && timer.current === null && !failed.current && !conflict.current && !denied.current) flush();
      });
  }, [update, writeDraft, draftStillOurs]);

  const change = useCallback(
    (patch: Patch) => {
      pending.current = { ...pending.current, ...patch } as Patch;
      latest.current = { ...latest.current, ...patch };
      unsent.current = { ...unsent.current, ...patch };
      writeDraft();
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
      update();
    },
    [flush, update, writeDraft],
  );

  // Сервер долго не подтверждает запись, а связь есть — «сохраняется дольше обычного» (не «нет связи»).
  useEffect(() => {
    if (oldestSent.current === null) return;
    const wait = Math.max(0, oldestSent.current + OFFLINE_AFTER_MS - Date.now());
    const t = window.setTimeout(() => setSlow(true), wait);
    return () => window.clearTimeout(t);
  });

  useEffect(() => {
    // Телефон сворачивает вкладку без предупреждения: отправляем сразу.
    const onHide = () => {
      if (document.visibilityState === "hidden") flush(true);
    };
    const onPageHide = () => flush(true);
    const onOnline = () => {
      setOnline(true);
      flush();
    };
    const onOffline = () => setOnline(false);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      flush(true);
    };
  }, [flush]);

  // Уход со страницы: последняя пачка уже ушла (flush выше), повторы по таймеру гасим.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, []);

  /** После «Сохранить мою поверх»: снять остановку и отправить правки. */
  const resume = useCallback(() => {
    conflict.current = false;
    denied.current = null;
    failed.current = false;
    update();
    flush();
  }, [flush, update]);

  const busy = pending.current !== null || inFlight.current > 0;
  let status: SaveStatus = "saved";
  if (conflict.current) status = "conflict";
  else if (denied.current) status = "denied";
  else if (busy) status = failed.current && !networkFail.current ? "error" : !online || networkFail.current ? "offline" : slow ? "slow" : "saving";

  const pendingChanges = useCallback(() => pending.current !== null || inFlight.current > 0, []);

  return { status, deniedCode: denied.current, pendingChanges, change, flush, resume };
}
