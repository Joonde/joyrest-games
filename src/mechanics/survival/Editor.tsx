// Конструктор «Гонки на выживание»: раунды полосками (вопрос с вариантами, открытый вопрос, задание),
// каждый 5-й — войнушка; аукционы билета (до 3, после второй войнушки) — отметкой у раунда.
import { useRef, useState } from "react";
import { ClampedNumber } from "../../components/ClampedNumber";
import { useConfirm } from "../../components/ConfirmDialog";
import { pointsLabel } from "../../core/results";
import type { EditorProps } from "../types";
import { isWar, KIND_TITLES, LETTERS, newSurvivalRound, parseSurvivalList, SURVIVAL_LIMITS, ticketAllowed, warIndex, type SurvivalContent, type SurvivalKind, type SurvivalRound } from "./content";
import { DEMO_SURVIVAL } from "./demo";
import { validateSurvival } from "./validate";

const KINDS: SurvivalKind[] = ["choice", "open", "task"];

export function SurvivalEditor({ content, onChange, editable }: EditorProps<SurvivalContent>) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [text, setText] = useState("");
  const [dialog, confirm] = useConfirm();
  const latest = useRef(content);
  latest.current = content;
  const errors = validateSurvival(content);
  const update = (id: string, patch: Partial<SurvivalRound>) => onChange({ ...latest.current, rounds: latest.current.rounds.map((r) => (r.id === id ? { ...r, ...patch } : r)) });

  function replace(rounds: SurvivalRound[], label: string) {
    confirm({
      title: `${label}?`,
      text: "Все раунды заменятся новыми. Настройки войнушек и аукционов останутся.",
      confirmLabel: "Заменить раунды",
      run: () => {
        const cur = latest.current;
        const next = { ...cur, rounds: rounds.map((r) => ({ ...r, id: newSurvivalRound().id })) };
        onChange({ ...next, tickets: cur.tickets.filter((n) => ticketAllowed(next, n)) });
        setImporting(false);
        setText("");
      },
    });
  }

  function setCount(n: number) {
    const cur = latest.current;
    const rounds = cur.rounds.slice(0, n);
    while (rounds.length < n) rounds.push(newSurvivalRound(isWar(cur, rounds.length + 1) ? "choice" : "task"));
    const next = { ...cur, rounds };
    onChange({ ...next, tickets: cur.tickets.filter((t) => ticketAllowed(next, t)) });
  }

  function toggleTicket(n: number) {
    const cur = latest.current;
    const on = cur.tickets.includes(n);
    if (!on && cur.tickets.length >= SURVIVAL_LIMITS.maxTickets) return;
    onChange({ ...cur, tickets: on ? cur.tickets.filter((t) => t !== n) : [...cur.tickets, n].sort((a, b) => a - b) });
  }

  return (
    <div className="stack">
      <section className="card stack">
        <h2>Как играем</h2>
        <p className="muted small">
          Раунды по порядку: вопрос с вариантами, открытый вопрос или активное задание (засчитывает ведущий). Никто не выбывает — побеждают очки. Каждый {content.warEvery}-й раунд — войнушка: команды ставят не меньше половины своих очков, банк (ставки + приз) забирает первая верно ответившая. После второй войнушки можно поставить до трёх аукционов «билета освобождения» — он позволяет один раз пропустить войнушку.
        </p>
        <div className="row board-editor__size">
          <label className="field">
            Раундов ({SURVIVAL_LIMITS.minRounds}–{SURVIVAL_LIMITS.maxRounds})
            <ClampedNumber value={content.rounds.length} min={SURVIVAL_LIMITS.minRounds} max={SURVIVAL_LIMITS.maxRounds} fallback={30} disabled={!editable} onChange={setCount} />
          </label>
          <label className="field">
            Приз первой войнушки
            <ClampedNumber value={content.warPrize} min={0} max={SURVIVAL_LIMITS.maxPoints} fallback={100} disabled={!editable} onChange={(warPrize) => onChange({ ...content, warPrize })} />
          </label>
          <label className="field">
            Секунд на ставки
            <ClampedNumber value={content.betSeconds} min={SURVIVAL_LIMITS.minSeconds} max={SURVIVAL_LIMITS.maxSeconds} fallback={30} disabled={!editable} onChange={(betSeconds) => onChange({ ...content, betSeconds })} />
          </label>
          <label className="field">
            Секунд на аукцион
            <ClampedNumber value={content.auctionSeconds} min={SURVIVAL_LIMITS.minSeconds} max={SURVIVAL_LIMITS.maxSeconds} fallback={30} disabled={!editable} onChange={(auctionSeconds) => onChange({ ...content, auctionSeconds })} />
          </label>
        </div>
        <p className="muted small">
          Призы войнушек растут: {Array.from({ length: Math.floor(content.rounds.length / content.warEvery) }, (_, i) => pointsLabel(content.warPrize * (i + 1))).join(", ") || "—"}. Аукционы: {content.tickets.length > 0 ? content.tickets.map((n) => `перед раундом ${n}`).join(", ") : "не поставлены"} (до {SURVIVAL_LIMITS.maxTickets}, отметка «🎟» у раунда).
        </p>
        {editable && (
          <div className="actions">
            <button type="button" className="btn btn--secondary btn--block" onClick={() => replace(DEMO_SURVIVAL.rounds, "Заполнить шаблоном")}>
              Заполнить шаблоном (30 раундов)
            </button>
            <button type="button" className="btn btn--quiet btn--block" onClick={() => setImporting((v) => !v)}>
              {importing ? "Скрыть вставку списком" : "Заполнить из списка"}
            </button>
          </div>
        )}
        {importing && editable && (
          <div className="stack stack--tight">
            <p className="muted small">Раунд с новой строки. Вопрос с вариантами — строки «- вариант» и «* верный»; открытый — «Вопрос? = ответ | ответ2»; задание — «Задание: …». «(150)» в конце — очки.</p>
            <textarea value={text} rows={10} placeholder={"Столица Франции?\n- Рим\n* Париж\n- Берлин\n- Мадрид\nЗадание: спойте гимн команды (200)"} onChange={(e) => setText(e.target.value)} />
            <button type="button" className="btn btn--block" disabled={!text.trim()} onClick={() => replace(parseSurvivalList(text), "Заменить раунды списком")}>
              Заменить раунды
            </button>
          </div>
        )}
      </section>

      <section className="stack">
        <h2>Раунды · {content.rounds.length}</h2>
        <ol className="quest-strips">
          {content.rounds.map((round, i) => {
            const n = i + 1;
            const war = isWar(content, n);
            const open = openId === round.id;
            const mine = errors.filter((e) => e.path.startsWith(`rounds/${round.id}/`));
            const ticket = content.tickets.includes(n);
            return (
              <li key={round.id} className={`quest-strip${open ? " is-open" : ""}${mine.length > 0 ? " has-error" : ""}${war ? " sv-strip--war" : ""}`}>
                <button type="button" className="quest-strip__head" aria-expanded={open} onClick={() => setOpenId(open ? null : round.id)}>
                  <span className="quest-strip__n">{n}</span>
                  <span aria-hidden="true">{war ? "⚔️" : ticket ? "🎟" : round.kind === "task" ? "⭐" : "❓"}</span>
                  <span className="quest-strip__text line-clamp">{round.text || <span className="muted">{war ? `Войнушка №${warIndex(content, n)} — вопрос` : KIND_TITLES[round.kind]} — заполните</span>}</span>
                  {!war && round.points > 0 && <span className="quest-strip__pts">{round.points}</span>}
                </button>
                {open && (
                  <div className="stack stack--tight quest-strip__body">
                    {war ? (
                      <p className="muted small">Войнушка №{warIndex(content, n)}: вопрос с вариантами, кто первый верно — забирает банк (ставки + {pointsLabel(content.warPrize * warIndex(content, n))}).</p>
                    ) : (
                      <div className="seg" role="group" aria-label="Вид раунда">
                        {KINDS.map((k) => (
                          <button key={k} type="button" className={round.kind === k ? "seg__btn is-on" : "seg__btn"} aria-pressed={round.kind === k} disabled={!editable} onClick={() => update(round.id, { kind: k, seconds: k === "task" ? 0 : round.seconds || 30 })}>
                            {KIND_TITLES[k]}
                          </button>
                        ))}
                      </div>
                    )}
                    <label className="field">
                      {round.kind === "task" && !war ? "Задание" : "Вопрос"}
                      <textarea rows={2} maxLength={SURVIVAL_LIMITS.text} value={round.text} disabled={!editable} onChange={(e) => update(round.id, { text: e.target.value })} />
                    </label>
                    {(round.kind === "choice" || war) &&
                      round.options.map((o, k) => (
                        <div key={k} className="row mil-editor-option">
                          <label className="choice mil-editor-option__right">
                            <input type="radio" name={`sv-correct-${round.id}`} checked={round.correct === k} disabled={!editable} onChange={() => update(round.id, { correct: k })} />
                            <span className="choice__text">
                              <span className="choice__title">{LETTERS[k]}</span>
                            </span>
                          </label>
                          <input aria-label={`Вариант ${LETTERS[k]}`} maxLength={SURVIVAL_LIMITS.option} value={o} disabled={!editable} onChange={(e) => update(round.id, { options: round.options.map((x, j) => (j === k ? e.target.value : x)), kind: war ? "choice" : round.kind })} />
                        </div>
                      ))}
                    {round.kind !== "choice" && !war && (
                      <label className="field">
                        {round.kind === "open" ? "Верный ответ (несколько — через «|»)" : "Подсказка ведущему (необязательно)"}
                        <input maxLength={SURVIVAL_LIMITS.answer} value={round.answer} disabled={!editable} onChange={(e) => update(round.id, { answer: e.target.value })} />
                      </label>
                    )}
                    <div className="row board-editor__size">
                      {!war && (
                        <label className="field">
                          Очки
                          <ClampedNumber value={round.points} min={0} max={SURVIVAL_LIMITS.maxPoints} fallback={100} disabled={!editable} onChange={(points) => update(round.id, { points })} />
                        </label>
                      )}
                      {(round.kind !== "task" || war) && (
                        <label className="field">
                          Секунд на ответ (0 — без таймера)
                          <ClampedNumber value={round.seconds} min={0} max={SURVIVAL_LIMITS.maxSeconds} fallback={30} disabled={!editable} onChange={(seconds) => update(round.id, { seconds })} />
                        </label>
                      )}
                    </div>
                    {ticketAllowed(content, n) && (
                      <button type="button" className="pick-chip" aria-pressed={ticket} disabled={!editable || (!ticket && content.tickets.length >= SURVIVAL_LIMITS.maxTickets)} onClick={() => toggleTicket(n)}>
                        🎟 Аукцион билета перед этим раундом
                      </button>
                    )}
                    {mine.map((e) => (
                      <p key={e.message} className="error small">
                        {e.message}
                      </p>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>
      {dialog}
    </div>
  );
}
