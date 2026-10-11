// Конструктор «Перудо»: сколько костей, «Ровно!», «Палифико», очки, партии.
import { ClampedNumber } from "../../components/ClampedNumber";
import type { EditorProps } from "../types";
import { PERUDO_LIMITS, type PerudoContent } from "./content";

export function PerudoEditor({ content, onChange, editable }: EditorProps<PerudoContent>) {
  return (
    <div className="stack">
      <section className="card stack">
        <h2>Как играем</h2>
        <p className="muted small">
          Кости лжеца, как в «Пиратах Карибского моря». У каждого стакана (игрок или команда) кости — свои видно только на своём телефоне. По кругу ставят: «на столе не меньше N костей с гранью F», единицы — джокеры. Следующий поднимает ставку или говорит «Не верю!» — все кости открываются на экране, ошибившийся теряет кость. Последний стакан с костями побеждает. За столом до {PERUDO_LIMITS.maxCups} стаканов.
        </p>
        <div className="row board-editor__size">
          <label className="field">
            Костей у каждого
            <ClampedNumber value={content.startDice} min={PERUDO_LIMITS.minDice} max={PERUDO_LIMITS.maxDice} fallback={5} disabled={!editable} onChange={(startDice) => onChange({ ...content, startDice })} />
          </label>
          <label className="field">
            Партий
            <ClampedNumber value={content.parties} min={1} max={PERUDO_LIMITS.maxParties} fallback={1} disabled={!editable} onChange={(parties) => onChange({ ...content, parties })} />
          </label>
          <label className="field">
            Очки за каждого, кто выбыл раньше
            <ClampedNumber value={content.placePoints} min={0} max={PERUDO_LIMITS.maxPoints} fallback={50} disabled={!editable} onChange={(placePoints) => onChange({ ...content, placePoints })} />
          </label>
          <label className="field">
            Очки победителю сверху
            <ClampedNumber value={content.winPoints} min={0} max={PERUDO_LIMITS.maxPoints} fallback={200} disabled={!editable} onChange={(winPoints) => onChange({ ...content, winPoints })} />
          </label>
        </div>
        <label className="choice">
          <input type="checkbox" checked={content.calza} disabled={!editable} onChange={(e) => onChange({ ...content, calza: e.target.checked })} />
          <span className="choice__text">
            <span className="choice__title">Можно сказать «Ровно!» (Calza)</span>
            <span className="choice__hint">Угадал точно — кость назад, не угадал — минус кость</span>
          </span>
        </label>
        <label className="choice">
          <input type="checkbox" checked={content.palifico} disabled={!editable} onChange={(e) => onChange({ ...content, palifico: e.target.checked })} />
          <span className="choice__text">
            <span className="choice__title">Раунд «Палифико»</span>
            <span className="choice__hint">У кого осталась одна кость — в его раунде единицы не джокеры, грань не меняется</span>
          </span>
        </label>
      </section>
    </div>
  );
}
