import { EMOJIS, withEmoji } from "../core/emoji";

/**
 * Выбор смайлика к имени: сетка крупных кнопок, последняя — «без смайлика», и строка
 * «Так вас увидят: 🦊 Аня» — сразу видно, что выбрано.
 */
export function EmojiPicker({
  value,
  onChange,
  label,
  preview,
  previewLabel,
}: {
  value: string | null;
  onChange: (emoji: string | null) => void;
  label: string;
  /** Имя без смайлика: для строки предпросмотра. */
  preview: string;
  previewLabel: string;
}) {
  const shown = withEmoji(value, preview.trim() || "…");
  return (
    <fieldset className="emoji-picker">
      <legend>{label}</legend>
      <div className="emoji-picker__grid">
        {EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="emoji-picker__item"
            aria-pressed={value === emoji}
            aria-label={`Смайлик ${emoji}`}
            onClick={() => onChange(emoji)}
          >
            {emoji}
          </button>
        ))}
        <button
          type="button"
          className="emoji-picker__item emoji-picker__item--none"
          aria-pressed={value === null}
          onClick={() => onChange(null)}
        >
          Без
        </button>
      </div>
      <p className="emoji-picker__preview" aria-live="polite">
        {previewLabel}: <strong>{shown}</strong>
      </p>
    </fieldset>
  );
}
