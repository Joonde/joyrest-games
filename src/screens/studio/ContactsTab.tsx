/**
 * «Клиенты» → вкладка «Мои контакты» (только владелец; решение владельца 21 октября 2026). Владелец выгружает контакты
 * телефона файлом .vcf — файл читается здесь, в браузере: находятся контакты со словами мероприятия или датой в подписи
 * («Аня квиз 17.10»), владелец отмечает, кто был клиентом, и они попадают в «Клиенты» (статус «Провели», источник
 * «Прежний клиент»). Остальная книжка на сервер не уходит. Ниже — прежние клиенты с кнопками «Написать» (WhatsApp или
 * Telegram с готовым сообщением) и «Ответил «да»» (согласие на новости, дальше кнопки — сообщение со скидкой).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { contactTitle, linkTitle, phoneKey, phoneLabel, telegramLinkOf, writeChannels } from "../../core/clients";
import { cleanName, messageVariant, pastClientMessage, pastClientYesMessage, scanContacts, type ContactMatch } from "../../core/contactsImport";
import { clientsRepo, useLoad, type ClientRecord } from "../../data";
import { useConfirm } from "../../components/ConfirmDialog";
import { ListSkeleton } from "../../components/Skeleton";
import { LoadFailedInline } from "../../components/Status";
import { Toast, useToast } from "../../components/Toast";
import { AVITO_URL, SITE_CALC_URL } from "../../components/live/Finale";
import { brand } from "../../themes/brand";
import { newId, Pill, useLastReady } from "./calendarParts";
import { ExcelImport } from "./ExcelImport";

const CHANNEL_URL = "https://t.me/JoyRest";
// Раньше «написали» и «не получилось» хранились только в браузере телефона. С 29 октября 2026 — на сервере
// (`clients.outreach_at`, `outreach_fail`): одинаково на телефоне и компьютере. Старые отметки переносятся при открытии.
const SENT_KEY = "jr-past-sent";
const FAIL_KEY = "jr-past-fail";
/** Открыли чат и ещё не ответили «получилось?» — переживает перезагрузку страницы после возврата из мессенджера. */
const PENDING_KEY = "jr-past-pending";
const PENDING_MS = 3 * 3_600_000;

function readJson(key: string): Record<string, unknown> {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "{}") as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function forget(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Нет доступа к хранилищу — нечего и убирать.
  }
}

type Pending = { id: string; kind: string; at: number };

function readPending(): Pending | null {
  const d = readJson(PENDING_KEY);
  if (typeof d.id !== "string" || typeof d.kind !== "string" || typeof d.at !== "number") return null;
  return Date.now() - d.at < PENDING_MS ? { id: d.id, kind: d.kind, at: d.at } : null;
}

function writePending(value: Pending | null): void {
  try {
    if (value) localStorage.setItem(PENDING_KEY, JSON.stringify(value));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    // Не запомнилось — вопрос пропадёт после перезагрузки, отметку можно поставить кнопкой «✓ Написал».
  }
}

/** Телефон, а без него — ник Telegram: «+7 915 241-59-99», «Telegram @anna». */
function who(c: ClientRecord): string {
  if (phoneKey(c.phone)) return phoneLabel(c.phone);
  const tg = telegramLinkOf(c.links);
  return tg ? linkTitle(tg) : "";
}

/** Текст сообщения — ещё и в буфер: Telegram по нику на части телефонов открывает чат без готового текста. */
function copyText(text: string): void {
  try {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  } catch {
    // Нет доступа к буферу — не страшно, текст и так в ссылке.
  }
}

function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

export function ContactsTab() {
  const [state, retry, update] = useLoad(async () => {
    if (!clientsRepo) return [] as ClientRecord[];
    const [active, archived] = await Promise.all([clientsRepo.list(false), clientsRepo.list(true)]);
    return [...active, ...archived];
  }, []);
  const clients = useLastReady(state);
  const [scan, setScan] = useState<{ matches: ContactMatch[]; total: number } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  // Отметки рассылки — с сервера: одинаковые на телефоне и компьютере.
  const sent = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of clients ?? []) if (c.outreachAt) out[c.id] = c.outreachAt;
    return out;
  }, [clients]);
  const fail = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const c of clients ?? []) if (c.outreachFail?.length) out[c.id] = c.outreachFail;
    return out;
  }, [clients]);
  // Порядок списка — по отметкам на момент открытия страницы: отправили — карточка остаётся на месте (тусклая),
  // список не перескакивает, пока вы ходите в мессенджер и обратно.
  const orderSnap = useRef<Record<string, number> | null>(null);
  if (clients && !orderSnap.current) orderSnap.current = { ...sent };
  // Открыли чат — ждём ответа «получилось?»: сайт не видит, что было в мессенджере (ошибка «не найден» и т. п.).
  const [pending, setPendingState] = useState<Pending | null>(readPending);
  const setPending = (value: Pending | null) => {
    setPendingState(value);
    writePending(value);
  };
  const [toast, showToast] = useToast(4000);
  const [confirm, ask] = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);

  /** Номера, которые уже есть в «Клиентах» (с архивом) — их второй раз не добавляем. */
  const known = useMemo(() => new Set((clients ?? []).map((c) => phoneKey(c.phone)).filter(Boolean)), [clients]);
  // Прежние клиенты, которым есть куда написать: телефон или ник Telegram (из таблицы Excel можно и без номера).
  const past = useMemo(() => (clients ?? []).filter((c) => c.origin === "past" && !c.archived && (phoneKey(c.phone) || telegramLinkOf(c.links))), [clients]);

  const keyOf = (m: ContactMatch) => phoneKey(m.phone);
  // Уже есть в «Клиентах» (с архивом и проведёнными мероприятиями) — не показываем: повторная загрузка — только новые.
  const fresh = (scan?.matches ?? []).filter((m) => keyOf(m) && !known.has(keyOf(m)));
  const already = (scan?.matches ?? []).filter((m) => keyOf(m) && known.has(keyOf(m))).length;
  const shown = fresh.filter((m) => showAll || m.reasons.length > 0);
  const toAdd = fresh.filter((m) => picked.has(keyOf(m)));
  const found = fresh.filter((m) => m.reasons.length > 0);

  async function onFile(file: File | undefined) {
    setFileError(null);
    if (!file) return;
    if (file.size > 150 * 1024 * 1024) {
      setFileError("Файл больше 150 МБ — это не похоже на контакты. Выгрузите контакты файлом .vcf.");
      return;
    }
    const text = await file.text();
    if (!/BEGIN:VCARD/i.test(text)) {
      setFileError("В файле нет контактов. Нужен файл контактов .vcf — как его сохранить, написано в шаге 1.");
      return;
    }
    const result = scanContacts(text);
    setScan(result);
    setShowAll(false);
    // Отмечены сразу все похожие на клиентов и ещё не добавленные — владелец снимает лишние галочки.
    setPicked(new Set(result.matches.filter((m) => m.reasons.length > 0 && keyOf(m) && !known.has(keyOf(m))).map(keyOf)));
  }

  function toggle(key: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function addPicked() {
    const list = toAdd;
    ask({
      title: `Добавить ${list.length} в «Клиенты»?`,
      text: "Они попадут в базу со статусом «Провели» и источником «Прежний клиент». Остальные контакты никуда не отправляются.",
      confirmLabel: "Добавить",
      run: async () => {
        if (!clientsRepo) return;
        let added = 0;
        let skipped = 0;
        const fresh: ClientRecord[] = [];
        for (const m of list) {
          setProgress(`Добавляем… ${added + skipped + 1} из ${list.length}`);
          try {
            const saved = await clientsRepo.save({
              id: newId(),
              name: cleanName(m.contact.name || m.label),
              phone: m.phone,
              links: [],
              status: "held",
              marketing: "unknown",
              notes: "",
              origin: "past",
              request: `Из контактов телефона: «${m.label}»`.slice(0, 300),
            });
            fresh.push(saved);
            added += 1;
          } catch (e) {
            const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "";
            if (code !== "already-exists") {
              setProgress(null);
              update((data) => [...fresh, ...data]);
              throw e;
            }
            skipped += 1;
          }
        }
        setProgress(null);
        update((data) => [...fresh, ...data]);
        setScan(null);
        setPicked(new Set());
        showToast(skipped ? `Добавлено: ${added}. Уже были в базе: ${skipped}` : `Добавлено в «Клиенты»: ${added}`);
      },
    });
  }

  /** Отметка рассылки на сервере; на экране — сразу, не дошла до сервера — возвращаем как было и говорим. */
  async function mark(id: string, change: { sent?: boolean; at?: number; fail?: "telegram" | "whatsapp" }, done: string) {
    if (!clientsRepo) return;
    const before = (clients ?? []).find((c) => c.id === id);
    update((data) =>
      data.map((x) =>
        x.id !== id
          ? x
          : {
              ...x,
              outreachAt: change.sent === true ? (change.at ?? Date.now()) : change.sent === false ? null : x.outreachAt,
              outreachFail: change.fail ? [...new Set([...(x.outreachFail ?? []), change.fail])] : x.outreachFail,
            },
      ),
    );
    try {
      const saved = await clientsRepo.outreach(id, change);
      update((data) => data.map((x) => (x.id === id ? { ...x, outreachAt: saved.outreachAt, outreachFail: saved.outreachFail } : x)));
      if (done) showToast(done);
    } catch {
      if (before) update((data) => data.map((x) => (x.id === id ? { ...x, outreachAt: before.outreachAt, outreachFail: before.outreachFail } : x)));
      showToast("Отметка не сохранилась — нет связи. Нажмите ещё раз.");
    }
  }

  function markSent(id: string) {
    setPending(null);
    void mark(id, { sent: true }, "✓ Отмечено: написали");
  }

  function unmarkSent(id: string) {
    void mark(id, { sent: false }, "Отметка «написали» снята");
  }

  function markFailed(id: string, kind: string) {
    setPending(null);
    void mark(id, { fail: kind === "whatsapp" ? "whatsapp" : "telegram" }, "");
  }

  // Отметки, поставленные раньше на этом телефоне, — на сервер (один раз, потом из браузера убираются).
  const moved = useRef(false);
  useEffect(() => {
    if (!clients || moved.current || !clientsRepo) return;
    moved.current = true;
    const repo = clientsRepo;
    const oldSent = readJson(SENT_KEY);
    const oldFail = readJson(FAIL_KEY);
    const byId = new Map(clients.map((c) => [c.id, c]));
    const jobs: Array<Promise<unknown>> = [];
    for (const [id, at] of Object.entries(oldSent)) {
      const c = byId.get(id);
      if (c && !c.outreachAt && typeof at === "number") jobs.push(repo.outreach(id, { sent: true, at }));
    }
    for (const [id, kinds] of Object.entries(oldFail)) {
      const c = byId.get(id);
      if (!c || !Array.isArray(kinds)) continue;
      for (const k of kinds) if ((k === "telegram" || k === "whatsapp") && !c.outreachFail?.includes(k)) jobs.push(repo.outreach(id, { fail: k }));
    }
    if (jobs.length === 0) {
      forget(SENT_KEY);
      forget(FAIL_KEY);
      return;
    }
    void Promise.allSettled(jobs).then(async (results) => {
      if (results.some((r) => r.status === "rejected")) return; // нет связи — перенесём при следующем открытии
      forget(SENT_KEY);
      forget(FAIL_KEY);
      retry();
      showToast(`Отметки с этого телефона перенесены: ${jobs.length}`);
    });
  }, [clients]); // eslint-disable-line react-hooks/exhaustive-deps

  function toNext(id: string | undefined) {
    if (!id) return;
    document.getElementById(`past-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /** Лишний контакт — в архив: из списка пропадает, при следующей загрузке контактов не добавится снова. */
  function removePast(c: ClientRecord) {
    ask({
      title: `Убрать «${c.name || who(c)}» из прежних клиентов?`,
      text: "Карточка уйдёт в архив «Клиентов» — ничего не стирается, вернуть можно из «Архива». При следующей загрузке контактов этот номер не добавится снова.",
      confirmLabel: "Убрать",
      run: async () => {
        if (!clientsRepo) return;
        await clientsRepo.archive(c.id);
        update((data) => data.map((x) => (x.id === c.id ? { ...x, archived: true } : x)));
        showToast("Убрано в архив");
      },
    });
  }

  function answeredYes(c: ClientRecord) {
    ask({
      title: `${c.name || who(c)} ответил(а) «да»?`,
      text: "Отметим согласие на новости («Рассылка: да»). Потом появятся кнопки с сообщением про скидку 10% на первое мероприятие.",
      confirmLabel: "Да, ответил(а)",
      run: async () => {
        if (!clientsRepo) return;
        const saved = await clientsRepo.save({
          id: c.id,
          name: c.name,
          phone: c.phone,
          links: c.links,
          status: c.status,
          marketing: "yes",
          notes: c.notes,
          expect: c.updatedAt,
        });
        update((data) => data.map((x) => (x.id === c.id ? saved : x)));
        showToast("Согласие отмечено — отправьте сообщение со скидкой");
      },
    });
  }

  const links = { channel: CHANNEL_URL, calc: SITE_CALC_URL, avito: AVITO_URL };
  // Сколько написали сегодня (по Москве — по часам этого телефона): больше 15 в день мессенджеры принимают за спам.
  const todayKey = new Date().toDateString();
  const sentToday = Object.values(sent).filter((t) => new Date(t).toDateString() === todayKey).length;
  // Сначала те, кому ещё не писали (на момент открытия), потом — кому написали (давно — выше); дальше — по имени.
  const ordered = [...past].sort(
    (a, b) => (orderSnap.current?.[a.id] ?? 0) - (orderSnap.current?.[b.id] ?? 0) || a.name.localeCompare(b.name, "ru") || a.id.localeCompare(b.id),
  );
  const notYet = past.filter((c) => !sent[c.id]).length;
  const next = ordered.find((c) => !sent[c.id] && c.marketing !== "yes" && c.id !== pending?.id);
  const pendingClient = pending ? past.find((c) => c.id === pending.id) : undefined;
  const kindTitle = (kind: string) => (kind === "whatsapp" ? "WhatsApp" : "Telegram");
  const yesMessage = pastClientYesMessage(SITE_CALC_URL);

  return (
    <>
      <ExcelImport clients={clients} onAdded={(saved) => update((data) => [...saved, ...data])} notify={showToast} />

      <h2 className="clients-section">Контакты телефона</h2>
      <p className="muted">
        Найдём в контактах вашего телефона тех, кому вы уже проводили праздники: в подписи есть «квиз», «ДР», «корпоратив», «игры» или дата
        («17.10», «17 октября», «20-е»). Файл читается прямо здесь, на телефоне, — в базу попадут только те, кого вы отметите.
      </p>

      <section className="card" aria-label="Как загрузить контакты">
        <p className="small">
          <strong>Шаг 1. Сохраните контакты файлом</strong> — браузер не может открыть контакты сам, только файл:
        </p>
        <ol className="small">
          <li>iPhone: «Контакты» → «Списки» (вверху слева) → удерживайте «Все контакты» → «Экспортировать» → «Сохранить в Файлы» → «Сохранить».</li>
          <li>Android: «Контакты» → меню → «Управление контактами» → «Экспорт» → файл .vcf.</li>
        </ol>
        <p className="small">
          <strong>Шаг 2.</strong> Нажмите кнопку ниже и выберите этот файл («Все контакты.vcf»).
        </p>
      </section>

      <button type="button" className="btn btn--block" disabled={!clients} onClick={() => fileRef.current?.click()}>
        {clients ? "Выбрать сохранённый файл контактов" : "Загружаем «Клиентов»…"}
      </button>
      <input
        ref={fileRef}
        id="contacts-file"
        type="file"
        accept=".vcf,text/vcard,text/x-vcard"
        className="visually-hidden visually-hidden--pinned"
        tabIndex={-1}
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {fileError && <p className="error small">{fileError}</p>}

      {scan && (
        <section className="card" aria-label="Найденные контакты">
          <p>
            В файле контактов: <strong>{scan.total}</strong>. Новых, похожих на прежних клиентов: <strong>{found.length}</strong>.
            {already > 0 && <> Уже в «Клиентах» — {already}, их не показываем.</>}
          </p>
          <label className="small">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Показать все контакты с телефоном
          </label>
          {shown.length === 0 ? (
            <p className="muted">Новых похожих на клиентов нет — все найденные уже в «Клиентах». Нужен кто-то ещё — включите «Показать все контакты».</p>
          ) : (
            <ul className="contacts-list">
              {shown.map((m) => {
                const key = keyOf(m);
                return (
                  <li key={key}>
                    <label className="contacts-row">
                      <input type="checkbox" checked={picked.has(key)} onChange={() => toggle(key)} />
                      <span className="contacts-row__text">
                        <span className="contacts-row__name">{m.label || "Без имени"}</span>
                        <span className="muted small">
                          {phoneLabel(m.phone)}
                        </span>
                        {m.reasons.length > 0 && (
                          <span className="contacts-row__tags">
                            {m.reasons.map((r) => (
                              <Pill key={r} color={brand.gold}>
                                {r}
                              </Pill>
                            ))}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="actions">
            <button type="button" className="btn btn--block" disabled={toAdd.length === 0 || progress !== null} onClick={addPicked}>
              {progress ?? `Добавить отмеченных в «Клиенты» (${toAdd.length})`}
            </button>
            <button type="button" className="btn btn--quiet btn--block" onClick={() => setScan(null)}>
              Закрыть список
            </button>
          </div>
        </section>
      )}

      <h2 className="clients-section">Прежние клиенты · написать</h2>
      <p className="muted small">
        Касание «Telegram» или «WhatsApp» откроет чат и скопирует готовое сообщение от команды JoyRest с именем клиента. Telegram на телефоне
        часто открывает чат без текста — подержите палец в поле сообщения → «Вставить» → «Отправить». Вернулись — ответьте «Получилось
        отправить?»: «написали» ставится только после «Да». Telegram показал ошибку («не найден») — у человека нет Telegram или номер
        скрыт: «Не получилось», дальше WhatsApp, а если и там нет — «Убрать — не клиент». Отметили по ошибке — «Снять «написали»». В сообщении: один из наших ведущих проводил у вас праздник, мы обновились, ссылки на канал, калькулятор и Авито,
        извинение, если ошиблись, и вопрос «можно присылать новости?». Пять вариантов текста чередуются. Цен и скидок нет. Отправляйте по
        одному и не больше 15 в день — иначе мессенджер может принять это за спам. Ответил «да» — нажмите «Ответил «да»»: отметим согласие, и
        кнопки откроют сообщение со скидкой 10%.
      </p>
      {past.length > 0 && (
        <p className={sentToday >= 15 ? "error small" : "small"} role="status">
          Сегодня написали: <strong>{sentToday}</strong> из 15 · ещё не писали: <strong>{notYet}</strong> из {past.length}
          {sentToday >= 15 ? " — на сегодня хватит, продолжите завтра." : ""}
        </p>
      )}
      {pendingClient && pending && (
        <section className="card contacts-last" role="status" aria-label="Получилось написать?">
          <p className="small">
            Открыли {kindTitle(pending.kind)}: <strong>{pendingClient.name || who(pendingClient)}</strong>. Текст скопирован — если его нет в
            чате, зажмите поле → «Вставить». <strong>Получилось отправить?</strong>
          </p>
          <div className="actions">
            <button type="button" className="btn btn--block" onClick={() => markSent(pendingClient.id)}>
              ✓ Да, отправил
            </button>
            <button type="button" className="btn btn--secondary btn--block" onClick={() => markFailed(pendingClient.id, pending.kind)}>
              ✗ Не получилось — ошибка или не тот человек
            </button>
          </div>
        </section>
      )}
      {!pending && next && Object.keys(sent).length > 0 && (
        <button type="button" className="btn btn--secondary btn--block" onClick={() => toNext(next.id)}>
          Следующий — {next.name || who(next)} ↓
        </button>
      )}
      {state.status === "loading" && !clients ? (
        <ListSkeleton />
      ) : state.status === "error" && !clients ? (
        <LoadFailedInline onRetry={retry} />
      ) : past.length === 0 ? (
        <p className="muted">Пока никого. Добавьте прежних клиентов таблицей Excel или из контактов — они появятся здесь.</p>
      ) : (
        <ul className="contacts-list">
          {ordered.map((c) => {
            // Согласился на новости — сообщение со скидкой, иначе — первое сообщение (спасибо, ссылки, вопрос о новостях).
            const yes = c.marketing === "yes";
            const text = yes ? yesMessage : pastClientMessage(c.name, links, messageVariant(c.id));
            const failed = fail[c.id] ?? [];
            // Где не получилось — в конец: сначала то, что ещё не пробовали.
            const channels = writeChannels(c, text)
              .filter((w) => w.kind !== "call")
              .sort((a, b) => Number(failed.includes(a.kind)) - Number(failed.includes(b.kind)));
            return (
              <li
                key={c.id}
                id={`past-${c.id}`}
                className={`card contacts-past${sent[c.id] && !yes ? " is-done" : ""}${next?.id === c.id || pending?.id === c.id ? " is-next" : ""}`}
              >
                <span className="contacts-row__name">
                  {next?.id === c.id ? "▶ " : sent[c.id] && !yes ? "✓ " : ""}
                  {c.name || "Без имени"}
                </span>
                <span className="muted small">
                  {who(c)}
                  {contactTitle(c) ? ` · связь: ${contactTitle(c)}` : ""}
                  {sent[c.id] ? ` · написали ${dayLabel(sent[c.id] ?? 0)}` : ""}
                  {yes ? " · согласие на новости ✓" : ""}
                </span>
                {failed.length > 0 && !sent[c.id] && (
                  <span className="error small">
                    {failed.map(kindTitle).join(" и ")}: не получилось.{" "}
                    {channels.some((w) => !failed.includes(w.kind)) ? "Попробуйте другой способ ниже." : "Других способов нет — уберите его кнопкой «Убрать — не клиент»."}
                  </span>
                )}
                {yes && <span className="small">Сообщение со скидкой 10%:</span>}
                <div className="contacts-past__actions" role="group" aria-label={`Написать: ${c.name}`}>
                  {/* Удобный клиенту способ — первым; без телефона — только Telegram по нику. */}
                  {channels.map((w) => (
                      <a
                        key={w.kind}
                        className="btn btn--secondary"
                        href={w.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => {
                          copyText(text);
                          if (!yes) setPending({ id: c.id, kind: w.kind, at: Date.now() });
                        }}
                      >
                        {w.label}
                      </a>
                    ))}
                  {!yes && !sent[c.id] && (
                    <button type="button" className="btn btn--quiet contacts-past__quiet" onClick={() => markSent(c.id)}>
                      ✓ Написал
                    </button>
                  )}
                  {!yes && sent[c.id] && (
                    <button type="button" className="btn btn--quiet contacts-past__quiet" onClick={() => unmarkSent(c.id)}>
                      Снять «написали»
                    </button>
                  )}
                  {!yes && (
                    <button type="button" className="btn btn--quiet contacts-past__quiet" onClick={() => answeredYes(c)}>
                      Ответил «да»
                    </button>
                  )}
                  <button type="button" className="btn btn--quiet contacts-past__quiet" onClick={() => removePast(c)}>
                    Убрать — не клиент
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Toast text={toast} />
      {confirm}
    </>
  );
}
