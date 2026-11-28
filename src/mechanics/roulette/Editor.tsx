// Временный конструктор «Рулетки судьбы» (этап 1): сводка тем, заданий и настроек и проверка игры. Свой «бумажный»
// конструктор с разделами «Содержание · Темы и задания · Редкость и шансы · Колесо и эффекты · Правила и очки» — этап 4
// (паспорт, п. 6). Игра скрыта от ведущих, пока он не готов.
import type { EditorProps } from "../types";
import { catalogThemes, KIND_TITLES, RARITIES, RARITY_TITLES, type RouletteContent } from "./content";
import { validateRoulette } from "./validate";

export function RouletteEditor({ content }: EditorProps<RouletteContent>) {
  const errors = validateRoulette(content);
  const ready = new Set(catalogThemes(content).map((t) => t.id));
  return (
    <section className="card stack">
      <p className="eyebrow">Рулетка судьбы</p>
      <p className="muted">Конструктор этой игры появится на следующих этапах. Сейчас — сводка шаблона и проверка.</p>
      <p className="small">
        Шансы: {RARITIES.map((r) => RARITY_TITLES[r] + " " + content.weights[r] + " %").join(" · ")}. Тем на команду: {content.themesPerTeam}. Кругов: {content.rounds}. Режим 18+:{" "}
        {content.adult ? "включён" : "выключен"}.
      </p>
      <ul className="stack stack--tight">
        {content.themes.map((t) => (
          <li key={t.id}>
            <strong>{t.name || "Тема без названия"}</strong>
            {!ready.has(t.id) && <span className="muted small"> — не попадёт в каталог</span>}
            <span className="muted small">
              {" "}
              · {t.tasks.length} заданий: {[...new Set(t.tasks.map((x) => KIND_TITLES[x.kind]))].join(", ")}
            </span>
          </li>
        ))}
      </ul>
      {errors.length > 0 ? (
        <ul className="error stack stack--tight">
          {errors.slice(0, 10).map((e) => (
            <li key={e.path + e.message}>{e.message}</li>
          ))}
        </ul>
      ) : (
        <p className="success">Ошибок нет — игру можно запускать.</p>
      )}
    </section>
  );
}
