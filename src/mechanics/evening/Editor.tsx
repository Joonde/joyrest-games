// Конструктор «Мероприятия из блоков»: 1–5 игр по порядку, готовые программы, добавление из своих игр и библиотеки.
import { useEffect, useMemo, useState } from "react";
import { Fold } from "../../components/Fold";
import { PROGRAM_LIMITS, type ProgramBlockRef } from "../../core/program";
import { gamesRepo, useAuth, type Game } from "../../data";
import { categoryOf, groupByCategory, type CategoryId } from "../categories";
import { mechanicTitle } from "../registry";
import type { EditorProps } from "../types";
import { NOT_IN_EVENING, type EveningContent } from "./content";

interface Template {
  id: string;
  title: string;
  hint: string;
  /** Какие игры по порядку: механика или раздел («music» — музыкальный квиз). */
  slots: Array<{ mechanic: string; category?: CategoryId }>;
}

const TEMPLATES: Template[] = [
  { id: "corp", title: "Корпоратив", hint: "Квиз → «Своя игра» → «Миллионер»", slots: [{ mechanic: "quiz", category: "quiz" }, { mechanic: "board" }, { mechanic: "millionaire" }] },
  { id: "birthday", title: "День рождения", hint: "«Давайте знакомиться» → квиз → «Правда или действие»", slots: [{ mechanic: "story" }, { mechanic: "quiz", category: "quiz" }, { mechanic: "truth" }] },
  { id: "music", title: "Музыкальный вечер", hint: "«Угадай мелодию» → музыкальное лото → танцевальный батл", slots: [{ mechanic: "quiz", category: "music" }, { mechanic: "lotto" }, { mechanic: "dance" }] },
  { id: "table", title: "Вечер настолок", hint: "«Перудо» → «Мафия»", slots: [{ mechanic: "perudo" }, { mechanic: "mafia" }] },
  { id: "show", title: "Телешоу", hint: "«Своя игра» → «Гонка на выживание» → «Миллионер»", slots: [{ mechanic: "board" }, { mechanic: "survival" }, { mechanic: "millionaire" }] },
];

function refOf(game: Game): ProgramBlockRef {
  return { gameId: game.id, title: game.title, mechanic: game.mechanic };
}

/** Свои игры и библиотека, которые можно поставить блоком (без самого вечера и «Олимпа»). */
function useAvailableGames(libraryOnly: boolean): { games: Game[] | null; failed: boolean } {
  const [auth] = useAuth();
  const uid = auth.status === "signedIn" ? auth.user.uid : null;
  const [games, setGames] = useState<Game[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    // Вечер в библиотеке запускают все ведущие — в нём только игры библиотеки (чужую личную игру они не откроют).
    Promise.all([libraryOnly ? Promise.resolve([]) : gamesRepo.listPersonal(uid), gamesRepo.listAgency()])
      .then(([mine, library]) => {
        if (cancelled) return;
        const seen = new Set<string>();
        setGames([...mine, ...library].filter((g) => !NOT_IN_EVENING.has(g.mechanic) && !seen.has(g.id) && Boolean(seen.add(g.id))));
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [uid, libraryOnly]);
  return { games, failed };
}

export function EveningEditor({ content, onChange, editable, scope }: EditorProps<EveningContent>) {
  const { games, failed } = useAvailableGames(scope === "agency");
  const [note, setNote] = useState<string | null>(null);
  const blocks = content.blocks;
  const room = PROGRAM_LIMITS.maxBlocks - blocks.length;
  const known = useMemo(() => new Map((games ?? []).map((g) => [g.id, g])), [games]);
  const mineIds = useMemo(() => new Set((games ?? []).filter((g) => g.scope === "personal").map((g) => g.id)), [games]);

  const set = (next: ProgramBlockRef[]) => onChange({ ...content, blocks: next.slice(0, PROGRAM_LIMITS.maxBlocks) });
  const move = (i: number, by: -1 | 1) => {
    const next = [...blocks];
    const [b] = next.splice(i, 1);
    if (b) next.splice(i + by, 0, b);
    set(next);
  };

  function applyTemplate(t: Template) {
    if (!games) return;
    const picked: ProgramBlockRef[] = [];
    const missing: string[] = [];
    for (const slot of t.slots) {
      // Сначала свои игры (их ведущий уже подготовил), потом библиотека.
      const sorted = [...games].sort((a, b) => Number(mineIds.has(b.id)) - Number(mineIds.has(a.id)));
      const game = sorted.find((g) => g.mechanic === slot.mechanic && (!slot.category || categoryOf(g) === slot.category) && !picked.some((p) => p.gameId === g.id));
      if (game) picked.push(refOf(game));
      else missing.push(mechanicTitle(slot.mechanic));
    }
    set(picked);
    setNote(missing.length > 0 ? `Не нашлось игр: ${missing.join(", ")}. Добавьте их ниже или скопируйте из библиотеки.` : `Программа «${t.title}» собрана — поменяйте игры и порядок, как нужно.`);
  }

  return (
    <div className="stack">
      <section className="card stack">
        <h2>Программа вечера</h2>
        <p className="muted small">
          От 1 до {PROGRAM_LIMITS.maxBlocks} игр подряд по одному коду: гости входят один раз. После каждого блока на экране — его победители и общий
          счёт вечера, а «Начать блок» на пульте переключает экран и телефоны на следующую игру. В конце — награждение по сумме всех блоков.
        </p>
        {blocks.length === 0 && <p className="muted">Добавьте игры ниже или возьмите готовую программу.</p>}
        <ol className="ev-edit">
          {blocks.map((b, i) => {
            const game = known.get(b.gameId);
            const lost = games !== null && !game;
            return (
              <li key={`${b.gameId}-${i}`} className="ev-edit__row">
                <span className="ev-edit__num">{i + 1}</span>
                <span className="ev-edit__text">
                  <span className="ev-edit__title">{game?.title ?? b.title}</span>
                  <span className="muted small">
                    {mechanicTitle(b.mechanic)}
                    {game ? (mineIds.has(game.id) ? " · мои игры" : " · библиотека") : ""}
                  </span>
                  {lost && (
                    <span className="error small">
                      {scope === "agency" ? "Не игра библиотеки (или удалена) — ведущие её не запустят. Замените блок." : "Игра не найдена (удалена?) — уберите блок или замените."}
                    </span>
                  )}
                </span>
                {editable && (
                  <span className="ev-edit__tools">
                    <button type="button" className="btn btn--quiet" aria-label="Выше" disabled={i === 0} onClick={() => move(i, -1)}>
                      ↑
                    </button>
                    <button type="button" className="btn btn--quiet" aria-label="Ниже" disabled={i === blocks.length - 1} onClick={() => move(i, 1)}>
                      ↓
                    </button>
                    <button type="button" className="btn btn--quiet" onClick={() => set(blocks.filter((_, k) => k !== i))}>
                      Убрать
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        {note && <p className="muted small" role="status">{note}</p>}
      </section>

      {editable && (
        <section className="card stack">
          <h2>Добавить блок</h2>
          {failed && <p className="error small">Не удалось загрузить игры. Проверьте интернет.</p>}
          {games === null && !failed && <p className="muted small">Загружаем игры…</p>}
          {room <= 0 && <p className="muted small">В вечере уже {PROGRAM_LIMITS.maxBlocks} блоков — уберите один, чтобы добавить другой.</p>}
          {games !== null && (
            <>
              <Fold title="Готовые программы" value={`${TEMPLATES.length}`}>
                <div className="stack stack--tight">
                  {TEMPLATES.map((t) => (
                    <button key={t.id} type="button" className="choice ev-template" onClick={() => applyTemplate(t)}>
                      <span className="choice__text">
                        <span className="choice__title">{t.title}</span>
                        <span className="choice__hint">{t.hint}</span>
                      </span>
                    </button>
                  ))}
                  <p className="muted small">Программа заменит текущий список блоков.</p>
                </div>
              </Fold>
              {groupByCategory(games).map(({ category, games: list }) => (
                <Fold key={category.id} title={`${category.icon} ${category.title}`} value={`${list.length}`}>
                  <div className="stack stack--tight">
                    {list.map((g) => (
                      <button key={g.id} type="button" className="choice ev-template" disabled={room <= 0} onClick={() => set([...blocks, refOf(g)])}>
                        <span className="choice__text">
                          <span className="choice__title">+ {g.title}</span>
                          <span className="choice__hint">
                            {mechanicTitle(g.mechanic)} · {mineIds.has(g.id) ? "мои игры" : "библиотека"}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </Fold>
              ))}
            </>
          )}
        </section>
      )}
    </div>
  );
}
