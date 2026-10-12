// Выбор оформления экрана зала телешоу в конструкторе: карточки `.choice` с миниатюрой фона.
import { SHOW_LOOK_TITLES, SHOW_LOOKS, type ShowLook } from "./showLook";

export function ShowLookPicker({
  game,
  value,
  hints,
  editable,
  onChange,
  looks = SHOW_LOOKS,
}: {
  game: "board" | "millionaire" | "survival";
  value: ShowLook;
  hints: Partial<Record<ShowLook, string>>;
  editable: boolean;
  onChange: (look: ShowLook) => void;
  looks?: readonly ShowLook[];
}) {
  return (
    <fieldset disabled={!editable}>
      <legend>Оформление экрана зала</legend>
      {looks.map((look) => (
        <label key={look} className="choice show-look">
          <input type="radio" name={`${game}-look`} checked={value === look} onChange={() => onChange(look)} />
          <span className="choice__text">
            <span className="choice__title">{SHOW_LOOK_TITLES[look]}</span>
            <span className="choice__hint">{hints[look] ?? ""}</span>
          </span>
          <span className={`show-look__thumb show-look__thumb--${look} show-look__thumb--${game}-${look}`} aria-hidden="true" />
        </label>
      ))}
    </fieldset>
  );
}
