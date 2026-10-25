/**
 * «Клиенты» → «Мои контакты» → «Таблица Excel» (решение владельца 25 октября 2026): шаблон виден прямо на странице и
 * скачивается файлом .xlsx; заполненную таблицу (.xlsx или .csv — шаблон или своя, с похожими колонками) файл читается
 * здесь, в браузере: каждая строка проверяется, отмеченные уходят в «Клиенты» обычным `POST /api/clients` (источник
 * «Прежний клиент», статус из таблицы — по умолчанию «Провели», способ связи, первая запись истории — что и когда проводили).
 * Клиент без телефона — можно, если есть ник Telegram. Логика — `src/core/clientsImport.ts`, Excel — `src/core/xlsx.ts`.
 */
import { useMemo, useRef, useState } from "react";
import { CLIENT_STATUS_TITLES } from "../../core/clients";
import { canImport, knownContacts, parseClientRows, TEMPLATE_COLUMNS, templateSheets, type ImportResult, type ImportRow } from "../../core/clientsImport";
import { readCsv, readXlsx, writeXlsx, XlsxError } from "../../core/xlsx";
import { clientsRepo, type ClientRecord } from "../../data";
import { useConfirm } from "../../components/ConfirmDialog";
import { brand } from "../../themes/brand";
import { newId, Pill } from "./calendarParts";

const TEMPLATE_NAME = "Шаблон клиентов JoyRest.xlsx";
const PAGE = 200;

function downloadTemplate() {
  const blob = new Blob([writeXlsx(templateSheets()) as Uint8Array<ArrayBuffer>], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = TEMPLATE_NAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Понятный текст, почему файл не прочитали. */
function fileProblemText(e: unknown, name: string): string {
  if (/\.numbers$/i.test(name)) return "Это файл Numbers. В Numbers: «Поделиться» → «Экспортировать и отправить» → «Excel» — и выберите получившийся .xlsx.";
  if (e instanceof XlsxError) {
    if (e.problem === "old-xls") return "Это старый формат .xls или файл с паролем. Откройте его в Excel или Numbers и сохраните как .xlsx (без пароля).";
    if (e.problem === "too-big") return "В таблице больше 20 000 строк — разделите её на несколько файлов.";
    if (e.problem === "no-sheet") return "В файле нет листа с таблицей.";
  }
  return "Не получилось прочитать файл. Нужна таблица Excel (.xlsx) или CSV — скачайте шаблон и заполните его.";
}

export function ExcelImport({ clients, onAdded, notify }: { clients: ClientRecord[] | null; onAdded: (saved: ClientRecord[]) => void; notify: (text: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [showTemplate, setShowTemplate] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [confirm, ask] = useConfirm();

  const known = useMemo(() => knownContacts(clients ?? []), [clients]);
  const rows = result?.rows ?? [];
  const ready = rows.filter(canImport);
  const toAdd = ready.filter((r) => picked.has(r.line));
  const bad = rows.filter((r) => r.errors.length > 0);
  const already = rows.filter((r) => r.known);
  const visible = onlyProblems ? rows.filter((r) => r.errors.length > 0 || r.warnings.length > 0) : rows;

  async function onFile(file: File | undefined) {
    setFileError(null);
    if (!file) return;
    setFileName(file.name);
    if (file.size > 20 * 1024 * 1024) {
      setFileError("Файл больше 20 МБ — это не похоже на таблицу клиентов.");
      return;
    }
    setReading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const isCsv = /\.(csv|txt)$/i.test(file.name) || /^text\//.test(file.type);
      const table = isCsv ? readCsv(bytes) : await readXlsx(bytes);
      const parsed = parseClientRows(table, known);
      if (parsed === "empty") {
        setResult(null);
        setFileError("Таблица пустая. Заполните лист «Клиенты» в шаблоне — по строке на клиента.");
        return;
      }
      if (parsed === "no-header") {
        setResult(null);
        setFileError("Не нашли шапку: нужна строка с названиями колонок, среди них «Телефон» или «Telegram». Проще всего — скачать шаблон и заполнить его.");
        return;
      }
      setResult(parsed);
      setShown(PAGE);
      setOnlyProblems(false);
      // Отмечены сразу все, кого можно добавить, — лишних владелец снимает.
      setPicked(new Set(parsed.rows.filter(canImport).map((r) => r.line)));
    } catch (e) {
      setResult(null);
      setFileError(fileProblemText(e, file.name));
    } finally {
      setReading(false);
    }
  }

  function toggle(line: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
  }

  function addPicked() {
    const list = toAdd;
    ask({
      title: `Добавить ${list.length} в «Клиенты»?`,
      text: "Они попадут в базу с источником «Прежний клиент» и статусом из таблицы (пусто — «Провели»). Что и когда проводили — первой записью в истории. Строки с ошибками не добавляются.",
      confirmLabel: "Добавить",
      run: async () => {
        if (!clientsRepo) return;
        let added = 0;
        let skipped = 0;
        const saved: ClientRecord[] = [];
        const done = new Set<number>();
        try {
          for (const r of list) {
            setProgress(`Добавляем… ${added + skipped + 1} из ${list.length}`);
            try {
              saved.push(
                await clientsRepo.save({
                  id: newId(),
                  name: r.name,
                  phone: r.phone,
                  links: r.nick ? [`https://t.me/${r.nick.slice(1)}`] : [],
                  status: r.status,
                  marketing: "unknown",
                  notes: "",
                  origin: "past",
                  contact: r.contact,
                  request: r.request,
                }),
              );
              added += 1;
            } catch (e) {
              const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "";
              if (code !== "already-exists") throw e;
              skipped += 1;
            }
            done.add(r.line);
          }
        } finally {
          setProgress(null);
          if (saved.length) onAdded(saved);
          // Добавленные и «уже были» уходят из списка; не дошедшие (нет связи) остаются отмеченными — можно нажать ещё раз.
          setResult((prev) => (prev ? { ...prev, rows: prev.rows.map((x) => (done.has(x.line) ? { ...x, known: true } : x)) } : prev));
          setPicked((prev) => new Set([...prev].filter((l) => !done.has(l))));
          if (done.size < list.length) notify(`Добавлено: ${added}. Остальные не отправились — проверьте интернет и нажмите ещё раз.`);
          else notify(skipped ? `Добавлено: ${added}. Уже были в базе: ${skipped}` : `Добавлено в «Клиенты»: ${added}`);
        }
      },
    });
  }

  return (
    <section className="card stack stack--tight" aria-label="Загрузить клиентов таблицей Excel">
      <h2 className="clients-section">Таблица Excel</h2>
      <p className="small">
        Своя таблица клиентов? Заполните шаблон — по строке на клиента — и загрузите сюда. Нужен <strong>телефон или ник Telegram</strong> (можно без
        номера). Колонки «Способ связи», «Мероприятие», «Дата», «Статус», «Заметка» — по желанию. Подойдёт и своя таблица с похожими колонками
        («Ссылка телеграм», «Интерактив», «Номер»).
      </p>
      <div className="actions">
        <button type="button" className="btn btn--secondary btn--block" onClick={downloadTemplate}>
          ⬇️ Скачать шаблон Excel
        </button>
        <button type="button" className="btn btn--quiet btn--block" aria-expanded={showTemplate} onClick={() => setShowTemplate(!showTemplate)}>
          {showTemplate ? "Скрыть шаблон ▲" : "Открыть шаблон здесь ▼"}
        </button>
      </div>
      {showTemplate && (
        <div className="stack stack--tight">
          <div className="xlsx-template" role="region" aria-label="Шаблон таблицы клиентов" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th scope="col" className="xlsx-template__n" />
                  {TEMPLATE_COLUMNS.map((c, i) => (
                    <th key={c.field} scope="col">
                      <span className="xlsx-template__letter">{String.fromCharCode(65 + i)}</span>
                      {c.title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="xlsx-template__hint">
                  <th scope="row" className="xlsx-template__n">?</th>
                  {TEMPLATE_COLUMNS.map((c) => (
                    <td key={c.field}>{c.hint}</td>
                  ))}
                </tr>
                {[0, 1, 2].map((i) => (
                  <tr key={i}>
                    <th scope="row" className="xlsx-template__n">
                      {i + 2}
                    </th>
                    {TEMPLATE_COLUMNS.map((c) => (
                      <td key={c.field}>{c.examples[i]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Так выглядит лист «Клиенты» в шаблоне (строки 2–4 — примеры, в скачанном файле их нет: там только шапка). Таблица листается вбок.
            Шапку не меняйте; «Способ связи» и «Статус» в Excel выбираются из списка. Заполнить можно в Excel, Google Таблицах или Numbers — потом
            сохраните как .xlsx.
          </p>
        </div>
      )}

      <button type="button" className="btn btn--block" disabled={!clients || reading || progress !== null} onClick={() => fileRef.current?.click()}>
        {!clients ? "Загружаем «Клиентов»…" : reading ? "Читаем таблицу…" : "📄 Выбрать заполненную таблицу (.xlsx или .csv)"}
      </button>
      <input
        ref={fileRef}
        id="clients-excel-file"
        type="file"
        accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        className="visually-hidden visually-hidden--pinned"
        tabIndex={-1}
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {fileError && (
        <p className="error small" role="alert">
          {fileError}
        </p>
      )}

      {result && (
        <div className="stack stack--tight" aria-label="Строки таблицы">
          <p className="small">
            «{fileName}»: строк с клиентами — <strong>{rows.length}</strong>. Можно добавить — <strong>{ready.length}</strong>
            {already.length > 0 && <> · уже в «Клиентах» — {already.length}</>}
            {bad.length > 0 && <> · с ошибками — {bad.length}</>}
            {result.skipped > 0 && <> · пропущено пустых и заголовков — {result.skipped}</>}.
          </p>
          <p className="muted small">
            Шапка — строка {result.header.line}. Нашли колонки: {result.found.join(", ")}.
            {result.cut && " Читаем только первые 2000 клиентов — остальных загрузите вторым файлом."}
          </p>
          {(bad.length > 0 || rows.some((r) => r.warnings.length > 0)) && (
            <label className="small">
              <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Показать только строки с замечаниями
            </label>
          )}
          {ready.length > 1 && (
            <div className="actions">
              <button type="button" className="btn btn--quiet" onClick={() => setPicked(new Set(ready.map((r) => r.line)))}>
                Отметить всех
              </button>
              <button type="button" className="btn btn--quiet" onClick={() => setPicked(new Set())}>
                Снять все
              </button>
            </div>
          )}
          {rows.length === 0 ? (
            <p className="muted">Под шапкой нет ни одного клиента.</p>
          ) : (
            <ul className="contacts-list">
              {visible.slice(0, shown).map((r) => (
                <ImportLine key={r.line} row={r} checked={picked.has(r.line)} onToggle={() => toggle(r.line)} />
              ))}
            </ul>
          )}
          {visible.length > shown && (
            <button type="button" className="btn btn--quiet btn--block" onClick={() => setShown(shown + PAGE)}>
              Показать ещё {Math.min(PAGE, visible.length - shown)}
            </button>
          )}
          <div className="actions">
            <button type="button" className="btn btn--block" disabled={toAdd.length === 0 || progress !== null} onClick={addPicked}>
              {progress ?? `Добавить отмеченных в «Клиенты» (${toAdd.length})`}
            </button>
            <button type="button" className="btn btn--quiet btn--block" disabled={progress !== null} onClick={() => setResult(null)}>
              Закрыть список
            </button>
          </div>
        </div>
      )}
      {confirm}
    </section>
  );
}

function ImportLine({ row: r, checked, onToggle }: { row: ImportRow; checked: boolean; onToggle: () => void }) {
  const possible = canImport(r);
  return (
    <li>
      <label className={possible ? "contacts-row" : "contacts-row is-off"}>
        <input type="checkbox" checked={possible && checked} disabled={!possible} onChange={onToggle} aria-label={`Строка ${r.line}: ${r.name || "без имени"}`} />
        <span className="contacts-row__text">
          <span className="contacts-row__name">
            <span className="muted small">стр. {r.line} · </span>
            {r.name || "Без имени"}
          </span>
          <span className="muted small">{[r.phone, r.nick].filter(Boolean).join(" · ") || "—"}</span>
          {r.about && <span className="small">{r.about}</span>}
          <span className="contacts-row__tags">
            {r.known && <Pill color={brand.gold}>уже в «Клиентах»</Pill>}
            {r.status !== "held" && possible && <Pill color={brand.gold}>{CLIENT_STATUS_TITLES[r.status]}</Pill>}
          </span>
          {r.errors.map((e) => (
            <span key={e} className="error small">
              ✕ {e}
            </span>
          ))}
          {r.warnings.map((w) => (
            <span key={w} className="muted small">
              ⚠️ {w}
            </span>
          ))}
        </span>
      </label>
    </li>
  );
}
