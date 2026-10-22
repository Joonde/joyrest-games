/**
 * «Клиенты» → вкладка «Мои контакты» (только владелец; решение владельца 21 октября 2026). Владелец выгружает контакты
 * телефона файлом .vcf — файл читается здесь, в браузере: находятся контакты со словами мероприятия или датой в подписи
 * («Аня квиз 17.10»), владелец отмечает, кто был клиентом, и они попадают в «Клиенты» (статус «Провели», источник
 * «Прежний клиент»). Остальная книжка на сервер не уходит. Ниже — прежние клиенты с кнопками «Написать» (WhatsApp или
 * Telegram с готовым сообщением) и «Ответил «да»» (согласие на новости, дальше кнопки — сообщение со скидкой).
 */
import { useMemo, useRef, useState } from "react";
import { phoneKey, phoneLabel, telegramPhoneHref, whatsappHref } from "../../core/clients";
import { cleanName, pastClientMessage, pastClientYesMessage, scanContacts, type ContactMatch } from "../../core/contactsImport";
import { clientsRepo, useLoad, type ClientRecord, type UserProfile } from "../../data";
import { useConfirm } from "../../components/ConfirmDialog";
import { ListSkeleton } from "../../components/Skeleton";
import { LoadFailedInline } from "../../components/Status";
import { Toast, useToast } from "../../components/Toast";
import { AVITO_URL, SITE_CALC_URL } from "../../components/live/Finale";
import { brand } from "../../themes/brand";
import { newId, Pill, useLastReady } from "./calendarParts";

const CHANNEL_URL = "https://t.me/JoyRest";
const SENT_KEY = "jr-past-sent";

/** Кому уже написали (на этом телефоне): id клиента → дата. */
function readSent(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(SENT_KEY) ?? "{}") as unknown;
    return raw && typeof raw === "object" ? (raw as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeSent(value: Record<string, number>): void {
  try {
    localStorage.setItem(SENT_KEY, JSON.stringify(value));
  } catch {
    // Не запомнилось — не страшно: отметка только для удобства.
  }
}

function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

export function ContactsTab({ profile }: { profile: UserProfile }) {
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
  const [sent, setSent] = useState<Record<string, number>>(readSent);
  const [toast, showToast] = useToast(4000);
  const [confirm, ask] = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const sender = profile.name.trim().split(/\s+/)[0] ?? "";

  /** Номера, которые уже есть в «Клиентах» (с архивом) — их второй раз не добавляем. */
  const known = useMemo(() => new Set((clients ?? []).map((c) => phoneKey(c.phone)).filter(Boolean)), [clients]);
  const past = useMemo(() => (clients ?? []).filter((c) => c.origin === "past" && !c.archived && phoneKey(c.phone)), [clients]);

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

  function markSent(id: string) {
    const next = { ...sent, [id]: Date.now() };
    setSent(next);
    writeSent(next);
  }

  /** Лишний контакт — в архив: из списка пропадает, при следующей загрузке контактов не добавится снова. */
  function removePast(c: ClientRecord) {
    ask({
      title: `Убрать «${c.name || phoneLabel(c.phone)}» из прежних клиентов?`,
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
      title: `${c.name || phoneLabel(c.phone)} ответил(а) «да»?`,
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

  const message = pastClientMessage(sender, { channel: CHANNEL_URL, calc: SITE_CALC_URL, avito: AVITO_URL });
  const yesMessage = pastClientYesMessage(SITE_CALC_URL);

  return (
    <>
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
        Касание «WhatsApp» или «Telegram» откроет чат с готовым сообщением: спасибо, ссылки на канал, калькулятор и Авито и вопрос «можно
        присылать новости?». Цен и скидок в нём нет. Отправляйте по одному — не массовой рассылкой. Ответил «да» — нажмите «Ответил «да»»:
        отметим согласие, и кнопки откроют сообщение со скидкой 10%.
      </p>
      {state.status === "loading" && !clients ? (
        <ListSkeleton />
      ) : state.status === "error" && !clients ? (
        <LoadFailedInline onRetry={retry} />
      ) : past.length === 0 ? (
        <p className="muted">Пока никого. Добавьте прежних клиентов из контактов — они появятся здесь.</p>
      ) : (
        <ul className="contacts-list">
          {past.map((c) => {
            // Согласился на новости — сообщение со скидкой, иначе — первое сообщение (спасибо, ссылки, вопрос о новостях).
            const yes = c.marketing === "yes";
            const text = yes ? yesMessage : message;
            return (
              <li key={c.id} className="card contacts-past">
                <span className="contacts-row__name">{c.name || "Без имени"}</span>
                <span className="muted small">
                  {phoneLabel(c.phone)}
                  {sent[c.id] ? ` · написали ${dayLabel(sent[c.id] ?? 0)}` : ""}
                  {yes ? " · согласие на новости ✓" : ""}
                </span>
                {yes && <span className="small">Сообщение со скидкой 10%:</span>}
                <div className="contacts-past__actions" role="group" aria-label={`Написать: ${c.name}`}>
                  <a className="btn btn--secondary" href={whatsappHref(c.phone, text)} target="_blank" rel="noopener noreferrer" onClick={() => !yes && markSent(c.id)}>
                    WhatsApp
                  </a>
                  <a className="btn btn--secondary" href={telegramPhoneHref(c.phone, text)} target="_blank" rel="noopener noreferrer" onClick={() => !yes && markSent(c.id)}>
                    Telegram
                  </a>
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
