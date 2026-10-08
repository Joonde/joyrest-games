// Конструктор «Бункера»: раунды, время речей и голосования, особые условия, режимы финала, очки.
import { ClampedNumber } from "../../components/ClampedNumber";
import type { EditorProps } from "../types";
import { CatastropheCard } from "./CardArt";
import { BUNKER_LIMITS, createBunker, type BunkerContent } from "./content";
import { CATASTROPHES } from "./decks";
import { SPECIALS } from "./specials";

export function BunkerEditor({ content, onChange, editable }: EditorProps<BunkerContent>) {
  const set = (patch: Partial<BunkerContent>) => onChange({ ...content, ...patch });
  const base = createBunker();
  const num = (label: string, key: keyof BunkerContent, min: number, max: number) => (
    <label className="field">
      {label}
      <ClampedNumber value={content[key] as number} min={min} max={max} fallback={base[key] as number} disabled={!editable} onChange={(v) => set({ [key]: v } as Partial<BunkerContent>)} />
    </label>
  );
  const toggle = (key: "specials" | "rebirth", title: string, hint: string) => (
    <label className="choice">
      <input type="checkbox" checked={content[key]} disabled={!editable} onChange={(e) => set({ [key]: e.target.checked })} />
      <span className="choice__text">
        <span className="choice__title">{title}</span>
        <span className="choice__hint">{hint}</span>
      </span>
    </label>
  );

  return (
    <div className="stack">
      <section className="card stack">
        <h2>Как играем</h2>
        <p className="muted small">
          Случилась катастрофа, мест в бункере — на половину игроков ({BUNKER_LIMITS.minPlayers}–{BUNKER_LIMITS.maxPlayers} человек). У каждого на телефоне тайный персонаж: профессия, биология, здоровье, хобби, багаж и факт{content.specials ? ", плюс особое условие" : ""}. Каждый раунд открывается карта бункера, игроки по очереди открывают по одной карте (в первом — профессию) и доказывают, что нужны. Потом обсуждение и тайное голосование: кого не берём. Ничья — оправдательные речи и переголосование, снова ничья — жребий.
        </p>
        <div className="row board-editor__size">
          {num("Раундов", "rounds", 3, 7)}
          {num("Речь в первом раунде, с", "firstSpeechSeconds", 10, BUNKER_LIMITS.maxSeconds)}
          {num("Речь в следующих, с", "speechSeconds", 10, BUNKER_LIMITS.maxSeconds)}
          {num("Обсуждение, с (0 — без таймера)", "discussSeconds", 0, 600)}
          {num("Голосование, с", "voteSeconds", 10, BUNKER_LIMITS.maxSeconds)}
          {num("Оправдание при ничьей, с", "justifySeconds", 10, BUNKER_LIMITS.maxSeconds)}
          {num("Пропусков голосования за игру", "skipVotes", 0, 3)}
        </div>
        <label className="field">
          Голос изгнанных
          <select value={content.exiledVote} disabled={!editable} onChange={(e) => set({ exiledVote: e.target.value === "common" ? "common" : "none" })}>
            <option value="none">Изгнанные не голосуют</option>
            <option value="common">Изгнанные вместе дают один голос</option>
          </select>
        </label>
      </section>

      <section className="card stack">
        <h2>Катастрофа</h2>
        <label className="field">
          Какая
          <select value={content.catastrophe ?? ""} disabled={!editable} onChange={(e) => set({ catastrophe: e.target.value === "" ? null : Number(e.target.value) })}>
            <option value="">Случайная</option>
            {CATASTROPHES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        {content.catastrophe !== null && (
          <div className="bk-editor__cata">
            <CatastropheCard id={content.catastrophe} years={CATASTROPHES[content.catastrophe]?.years[0] ?? 1} />
          </div>
        )}
      </section>

      <section className="card stack">
        <h2>Особые условия и финал</h2>
        {toggle("specials", "Особые условия", `У каждого одна карта — сыграть можно один раз: обмен картами, лечение, шпион, неприкосновенность, отмена голосования и ещё ${SPECIALS.length - 5}.`)}
        {toggle("rebirth", "«Возрождение»", "Бункер выживет, только если среди спасшихся есть мужчина и женщина 18–55 лет без бесплодия. Лучше от 8 игроков.")}
        <label className="field">
          «История выживания»: угроз в финале
          <select value={content.threats} disabled={!editable} onChange={(e) => set({ threats: Number(e.target.value) })}>
            <option value={0}>Без угроз</option>
            <option value={1}>1 угроза</option>
            <option value={2}>2 угрозы</option>
            <option value={3}>3 угрозы</option>
          </select>
        </label>
        <p className="muted small">Угрозы открываются в финале: пожар, болезнь, чужаки у входа… Спасшиеся решают, чем справятся, — ведущий отмечает итог.</p>
        <div className="row board-editor__size">
          {num("Очки за пережитый раунд", "roundPoints", 0, BUNKER_LIMITS.maxPoints)}
          {num("Очки спасшимся, если бункер выжил", "winPoints", 0, BUNKER_LIMITS.maxPoints)}
        </div>
      </section>
    </div>
  );
}
