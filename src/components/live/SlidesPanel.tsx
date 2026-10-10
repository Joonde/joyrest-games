import { useState } from "react";
import { linesFromText, slideTemplate, SLIDE_TEMPLATES } from "../../core/slides";
import { rulesFor } from "../../core/rules";
import { Icon, type IconName } from "../Icon";
import { clock, SLIDE_LIMITS, type Session, type SessionChange, type SlideKind, type SlideState } from "../../data";

const DRAFT_KEY = "joyrest.slides";

const SLIDE_ICONS: Record<SlideKind, IconName> = {
  intro: "intro",
  rules: "rules",
  round: "round",
  break: "break",
  tech: "break",
  join: "custom",
  award: "award",
  thanks: "thanks",
  custom: "custom",
};

interface Draft {
  title: string;
  text: string;
  lines: string;
  minutes: number;
}

export function slideId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

function defaultDraft(kind: SlideKind, session?: Pick<Session, "mechanic" | "playMode">): Draft {
  const d = slideTemplate(kind).defaults;
  // Правила — свои у каждого формата игры и режима (каждый сам за себя или команды).
  if (kind === "rules" && session) {
    const rules = rulesFor(session.mechanic, session.playMode);
    return { title: rules.title, text: "", lines: rules.lines.join("\n"), minutes: 10 };
  }
  return { title: d.title, text: d.text, lines: d.lines.join("\n"), minutes: d.minutes ?? 10 };
}

/** Где на устройстве лежит текст шаблона: правила — отдельно для каждого формата игры. */
function draftKey(kind: SlideKind, session: Pick<Session, "mechanic" | "playMode">): string {
  return kind === "rules" ? `rules.${session.mechanic ?? "none"}.${session.playMode}` : kind;
}

/** Тексты слайдов ведущий готовит один раз: они запоминаются на этом устройстве. */
function readDrafts(): Partial<Record<string, Draft>> {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}") as unknown;
    return typeof raw === "object" && raw !== null ? (raw as Partial<Record<string, Draft>>) : {};
  } catch {
    return {};
  }
}

function saveDrafts(drafts: Partial<Record<string, Draft>>): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
  } catch {
    // Приватный режим: тексты живут до перезагрузки.
  }
}

/**
 * Слайды на пульте (CLAUDE.md, раздел 7, «Слайды»): шаблон → поправить текст → «Показать на
 * экране»; «Убрать слайд» возвращает экран к игре.
 */
export function SlidesPanel({ session, onApply }: { session: Session; onApply: (change: SessionChange) => Promise<void> }) {
  const current = session.state.slide ?? null;
  const [kind, setKind] = useState<SlideKind>("intro");
  const [drafts, setDrafts] = useState(readDrafts);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const template = slideTemplate(kind);
  const key = draftKey(kind, session);
  const draft = drafts[key] ?? defaultDraft(kind, session);

  function edit(patch: Partial<Draft>) {
    const next = { ...drafts, [key]: { ...draft, ...patch } };
    setDrafts(next);
    saveDrafts(next);
  }

  async function send(slide: SlideState | null) {
    setBusy(true);
    setError(false);
    try {
      await onApply({ state: { slide } });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  function show() {
    const minutes = Math.min(120, Math.max(0, Math.round(draft.minutes)));
    void send({
      id: slideId(),
      kind,
      title: draft.title.trim(),
      text: draft.text.trim(),
      lines: template.fields.lines ? linesFromText(draft.lines) : [],
      endsAt: template.fields.minutes && minutes > 0 ? Date.now() + clock.offset() + minutes * 60_000 : null,
    });
  }

  return (
    <div className="stack">
      {current && (
        <div className="now-playing" aria-live="polite">
          <p className="eyebrow">Сейчас на экране</p>
          <p className="now-playing__title line-clamp">{current.title || slideTemplate(current.kind).label}</p>
          <div className="actions">
            <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void send(null)}>
              Убрать слайд — вернуть игру
            </button>
          </div>
        </div>
      )}
      <div className="tiles tiles--small" role="group" aria-label="Шаблон слайда">
        {SLIDE_TEMPLATES.map((t) => (
          <button key={t.kind} type="button" className="tile" aria-pressed={kind === t.kind} onClick={() => setKind(t.kind)}>
            <Icon name={SLIDE_ICONS[t.kind]} className="tile__icon" />
            <span className="tile__label">{t.label}</span>
          </button>
        ))}
      </div>
      <label className="field">
        {template.fields.title}
        <input maxLength={SLIDE_LIMITS.title} value={draft.title} onChange={(e) => edit({ title: e.target.value })} />
      </label>
      {template.fields.text && (
        <label className="field">
          {template.fields.text}
          <textarea rows={2} maxLength={SLIDE_LIMITS.text} value={draft.text} onChange={(e) => edit({ text: e.target.value })} />
        </label>
      )}
      {template.fields.lines && (
        <label className="field">
          {template.fields.lines}
          <textarea rows={5} value={draft.lines} onChange={(e) => edit({ lines: e.target.value })} />
        </label>
      )}
      {template.fields.minutes && (
        <label className="field">
          Обратный отсчёт, минут (0 — без отсчёта)
          <input type="number" inputMode="numeric" min={0} max={120} value={draft.minutes} onChange={(e) => edit({ minutes: Number(e.target.value) || 0 })} />
        </label>
      )}
      <div className="actions">
        <button type="button" className="btn btn--block" disabled={busy} onClick={show}>
          {current ? "Показать этот слайд вместо текущего" : "Показать на экране"}
        </button>
        <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={() => edit(defaultDraft(kind, session))}>
          {kind === "rules" ? "Вернуть правила этой игры" : "Вернуть текст шаблона"}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          Слайд не отправился. Проверьте интернет.
        </p>
      )}
      <p className="muted small">Слайд закрывает игру на экране, пока вы его не уберёте. Тексты запоминаются на этом телефоне.</p>
    </div>
  );
}
