// Конструктор «Дурака»: вариант правил, колода, рассадка, кто подкидывает, таймер хода, стол и колода
// по умолчанию, партии и очки.
import { ClampedNumber } from "../../components/ClampedNumber";
import type { EditorProps } from "../types";
import { CardArt } from "./CardArt";
import { DECKS, DURAK_LIMITS, maxSeats, TABLES, type DurakContent } from "./content";

type Option<T> = { id: T; title: string; hint: string };

export function DurakEditor({ content, onChange, editable }: EditorProps<DurakContent>) {
  const set = (patch: Partial<DurakContent>) => onChange({ ...content, ...patch });

  function radio<T extends string | number>(name: string, value: T, options: Array<Option<T>>, pick: (v: T) => void) {
    return (
      <fieldset className="stack stack--tight">
        <legend className="visually-hidden">{name}</legend>
        {options.map((o) => (
          <label key={String(o.id)} className="choice">
            <input type="radio" name={`durak-${name}`} checked={value === o.id} disabled={!editable} onChange={() => pick(o.id)} />
            <span className="choice__text">
              <span className="choice__title">{o.title}</span>
              <span className="choice__hint">{o.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
    );
  }

  function check(key: "noTransferFirst" | "spades" | "pogony" | "highlight", title: string, hint: string) {
    return (
      <label className="choice">
        <input type="checkbox" checked={content[key]} disabled={!editable} onChange={(e) => set({ [key]: e.target.checked } as Partial<DurakContent>)} />
        <span className="choice__text">
          <span className="choice__title">{title}</span>
          <span className="choice__hint">{hint}</span>
        </span>
      </label>
    );
  }

  return (
    <div className="stack">
      <section className="card stack">
        <h2>Как играем</h2>
        <p className="muted small">
          Стол с крупье на экране зала, у каждого — свои карты на телефоне веером. Пульт сам тасует, раздаёт и проверяет каждый ход по правилам. Мест за столом по правилам — до {maxSeats(content)}; гостей больше — откройте ещё одну игру-стол. За место без телефона играет компьютер.
        </p>
        {radio("variant", content.variant, [
          { id: "podkidnoy", title: "Подкидной", hint: "Классика: отбиваетесь или берёте, остальные подкидывают" },
          { id: "perevodnoy", title: "Переводной", hint: "Картой того же достоинства атаку можно перевести следующему" },
        ], (variant) => set({ variant }))}
        {radio("deck", content.deck, [
          { id: 36, title: "36 карт (6–туз)", hint: "2–6 игроков" },
          { id: 52, title: "52 карты (2–туз)", hint: "До 8 игроков — для большой компании" },
        ], (deck) => set({ deck }))}
        {radio("seating", content.seating, [
          { id: "solo", title: "Каждый сам за себя", hint: "В режиме команд сессии место за столом занимает столик: ходит капитан" },
          { id: "partners", title: "Партнёры через одного", hint: "4 или 6 игроков: 2×2 или 3×3. Партнёру не подкидывают, проигрывает команда дурака" },
        ], (seating) => set({ seating }))}
      </section>

      <section className="card stack">
        <h2>Правила</h2>
        {radio("throwers", content.throwers, [
          { id: "all", title: "Подкидывают все", hint: "Любой игрок, кроме защитника (и его партнёра)" },
          { id: "neighbors", title: "Подкидывают только соседи", hint: "Атакующий и сосед защитника с другой стороны" },
        ], (throwers) => set({ throwers }))}
        {radio("first", content.firstMove, [
          { id: "under", title: "Следующая партия — «под дурака»", hint: "Первым отбивается дурак прошлой партии" },
          { id: "from", title: "Следующая партия — «из-под дурака»", hint: "Первым ходит сосед дурака" },
        ], (firstMove) => set({ firstMove }))}
        {content.variant === "perevodnoy" && check("noTransferFirst", "В первом отбое переводить нельзя", "Как в правилах; снимите, чтобы переводить сразу")}
        {check("spades", "«Пики пиками»", "Пику бьют только пикой, даже козырем нельзя")}
        {check("pogony", "Погоны", "Дурак, которого «закрыли» шестёрками, получает погоны — крупье объявит")}
        {check("highlight", "Подсвечивать карты, которыми можно сыграть", "Удобно новичкам: остальные карты на телефоне приглушены")}
        <label className="field">
          Время на ход, секунд (0 — без таймера)
          <ClampedNumber value={content.turnSeconds} min={0} max={DURAK_LIMITS.maxSeconds} fallback={30} disabled={!editable} onChange={(turnSeconds) => set({ turnSeconds: turnSeconds === 0 ? 0 : Math.max(DURAK_LIMITS.minSeconds, turnSeconds) })} />
        </label>
        <p className="muted small">Время вышло: защитник берёт, атакующий кладёт младшую карту, остальные пасуют.</p>
      </section>

      <section className="card stack">
        <h2>Стол и колода</h2>
        <div className="dk-editor__felts" role="radiogroup" aria-label="Сукно стола">
          {TABLES.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={content.table === t.id} className={`dk-editor__felt dk-felt--${t.id}${content.table === t.id ? " is-on" : ""}`} disabled={!editable} onClick={() => set({ table: t.id })}>
              <span className="dk-editor__swatch" aria-hidden="true" />
              {t.title}
            </button>
          ))}
        </div>
        <p className="muted small">Колода по умолчанию. Во время игры ведущий меняет её на пульте или устраивает голосование гостей.</p>
        <div className="dk-editor__decks" role="radiogroup" aria-label="Колода">
          {DECKS.map((d) => (
            <button key={d.id} type="button" role="radio" aria-checked={content.deckStyle === d.id} className={`dk-editor__deck${content.deckStyle === d.id ? " is-on" : ""}`} disabled={!editable} onClick={() => set({ deckStyle: d.id })}>
              <span className="dk-editor__cards" aria-hidden="true">
                <CardArt card={null} deck={d.id} width="52px" />
                <CardArt card="KH" deck={d.id} width="52px" />
              </span>
              <span className="dk-editor__name">{d.title}</span>
              <span className="muted small">{d.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card stack">
        <h2>Партии и очки</h2>
        <div className="row board-editor__size">
          <label className="field">
            Партий (0 — пока ведущий не завершит)
            <ClampedNumber value={content.parties} min={0} max={20} fallback={3} disabled={!editable} onChange={(parties) => set({ parties })} />
          </label>
          <label className="field">
            Очки за место
            <ClampedNumber value={content.placePoints} min={0} max={1000} fallback={10} disabled={!editable} onChange={(placePoints) => set({ placePoints })} />
          </label>
          <label className="field">
            «Партнёры»: очки победителям
            <ClampedNumber value={content.teamPoints} min={0} max={1000} fallback={20} disabled={!editable} onChange={(teamPoints) => set({ teamPoints })} />
          </label>
        </div>
        <p className="muted small">Вышел первым — очки за место × (игроков − 1), следующий — на одно место меньше, дурак — 0. Очки копятся через все партии, в конце — награждение.</p>
      </section>
    </div>
  );
}
