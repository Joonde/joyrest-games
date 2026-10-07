import { EMOJIS } from "../core/emoji";

/** Выбор смайлика к имени: сетка крупных кнопок и «без смайлика». */
export function EmojiPicker({ value, onChange, label }: { value: string | null; onChange: (emoji: string | null) => void; label: string }) {
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
      </div>
      <button type="button" className="btn btn--quiet" aria-pressed={value === null} onClick={() => onChange(null)}>
        {value === null ? "Без смайлика ✓" : "Без смайлика"}
      </button>
    </fieldset>
  );
}
