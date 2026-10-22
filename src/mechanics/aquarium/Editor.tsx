// Конструктор «Аквариума и Ёлки»: с какой сцены начать, готовые фигуры, выпуск рисунков, имя на боку, сколько рисунков с
// одного телефона. Автор движка раскрасок — Paper Aquarium (MrMoT9I), ссылка — здесь же.
import { ClampedNumber } from "../../components/ClampedNumber";
import type { EditorProps } from "../types";
import { CREDIT_URL, PER_GUEST, SCENE_TITLES, type AquariumContent } from "./content";

const SCENE_HINTS = {
  aqua: "Подводный мир с крабами, ракушками и пузырьками. Гости раскрашивают рыбок — те приплывают на экран и плавают, их можно покормить.",
  tree: "Ёлка в зимнем лесу с курантами, гирляндой и Дедом Морозом на санях. Гости раскрашивают игрушки — те повисают на ёлке.",
} as const;

export function AquariumEditor({ content, onChange, editable }: EditorProps<AquariumContent>) {
  const set = (patch: Partial<AquariumContent>) => onChange({ ...content, ...patch });
  return (
    <div className="stack">
      <section className="card stack">
        <h2>⚙️ Правила и настройки</h2>
        <p className="muted small">
          Перерыв с раскраской на 10–15 минут — для детей и взрослых. Гости по QR раскрашивают на телефоне рыбку или ёлочную игрушку, подписывают имя и отправляют: рисунок оживает на большом экране. Ведущий меняет сцену, кормит рыбок, переключает гирлянду и убирает неудачные рисунки.
        </p>
        <p className="eyebrow">С чего начать</p>
        {(["aqua", "tree"] as const).map((scene) => (
          <label key={scene} className="choice">
            <input type="radio" name="aq-scene" checked={content.scene === scene} disabled={!editable} onChange={() => set({ scene })} />
            <span className="choice__text">
              <span className="choice__title">{SCENE_TITLES[scene]}</span>
              <span className="choice__hint">{SCENE_HINTS[scene]}</span>
            </span>
          </label>
        ))}
        <p className="muted small">Сцену можно сменить на пульте во время игры: рисунки останутся каждый на своей.</p>
      </section>
      <section className="card stack">
        <h2>Рисунки гостей</h2>
        <label className="choice">
          <input type="radio" name="aq-mod" checked={content.moderation === "auto"} disabled={!editable} onChange={() => set({ moderation: "auto" })} />
          <span className="choice__text">
            <span className="choice__title">Сразу на экран</span>
            <span className="choice__hint">Рисунок появляется сам. Неудачный ведущий убирает с пульта одним касанием.</span>
          </span>
        </label>
        <label className="choice">
          <input type="radio" name="aq-mod" checked={content.moderation === "host"} disabled={!editable} onChange={() => set({ moderation: "host" })} />
          <span className="choice__text">
            <span className="choice__title">Сначала посмотрит ведущий</span>
            <span className="choice__hint">Рисунок ждёт на пульте: «На экран» или «Не показывать».</span>
          </span>
        </label>
        <label className="choice">
          <input type="checkbox" checked={content.names} disabled={!editable} onChange={(e) => set({ names: e.target.checked })} />
          <span className="choice__text">
            <span className="choice__title">Имя на боку рыбки или на игрушке</span>
            <span className="choice__hint">Гость сам решает, писать ли имя. При появлении над фигурой — «Рыбка от: Аня».</span>
          </span>
        </label>
        <label className="choice">
          <input type="checkbox" checked={content.starters} disabled={!editable} onChange={(e) => set({ starters: e.target.checked })} />
          <span className="choice__text">
            <span className="choice__title">Готовые рыбки и игрушки для начала</span>
            <span className="choice__hint">Экран не пустой с первой минуты. Рисунки гостей постепенно занимают их место.</span>
          </span>
        </label>
        <label className="field">
          Рисунков с одного телефона
          <ClampedNumber value={content.perGuest} min={PER_GUEST.min} max={PER_GUEST.max} fallback={PER_GUEST.default} disabled={!editable} onChange={(perGuest) => set({ perGuest })} />
        </label>
      </section>
      <p className="muted small">
        Движок раскрасок — по мотивам проекта{" "}
        <a href={CREDIT_URL} target="_blank" rel="noopener noreferrer">
          Paper Aquarium
        </a>{" "}
        (автор MrMoT9I, лицензия MIT), вдохновлён инсталляцией teamLab Sketch Aquarium. На экране зала — подпись автора.
      </p>
    </div>
  );
}
