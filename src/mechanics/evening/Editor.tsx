// Конструктор «Мероприятия из блоков»: 1–5 игр по порядку, готовые программы, добавление из своих игр и библиотеки.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Fold } from "../../components/Fold";
import { blockPrepOf, prepTitle, templateBlocks } from "../../core/eveningPrep";
import { editorGuideFor } from "../../core/editorGuideSkip";
import { copyOfGame, GAME_TITLE_MAX_LENGTH } from "../../core/games";
import { guideFor } from "../../core/guide";
import { PROGRAM_LIMITS, type ProgramBlockRef } from "../../core/program";
import { gamesRepo, useAuth, type Game } from "../../data";
import { groupByCategory } from "../categories";
import { gameMediaIds, mechanicTitle } from "../registry";
import type { EditorProps } from "../types";
import { NOT_IN_EVENING, type EveningContent } from "./content";
import { fits, slotLabel, TEMPLATES, type Template } from "./templates";

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

export function EveningEditor({ gameId, content, onChange, editable, scope, gameTitle, openGame }: EditorProps<EveningContent>) {
  const { games, failed } = useAvailableGames(scope === "agency");
  const [auth] = useAuth();
  const uid = auth.status === "signedIn" ? auth.user.uid : null;
  const navigate = useNavigate();
  const [note, setNote] = useState<string | null>(null);
  /** Блок, для которого сейчас делается копия игры («✍️ Подготовить под вечер»). */
  const [preparing, setPreparing] = useState<number | null>(null);
  // Двойное касание: второе приходит раньше, чем React обновит `preparing`, — без него вышли бы две копии.
  const preparingRef = useRef(false);
  const blocks = content.blocks;
  const latest = useRef(content);
  latest.current = content;
  const room = PROGRAM_LIMITS.maxBlocks - blocks.length;
  const known = useMemo(() => new Map((games ?? []).map((g) => [g.id, g])), [games]);
  const mineIds = useMemo(() => new Set((games ?? []).filter((g) => g.scope === "personal").map((g) => g.id)), [games]);

  const set = (next: ProgramBlockRef[]) => onChange({ ...content, blocks: next.slice(0, PROGRAM_LIMITS.maxBlocks) });
  // Шаблоны библиотеки в личном вечере — вопросы стандартные, их стоит подготовить (решение владельца 11 ноября 2026).
  const templates = new Set(templateBlocks(scope ?? "personal", blocks.map((b) => known.get(b.gameId)?.scope ?? null)));

  /** Уйти со страницы программы: конструктор сначала дождётся, пока программа сохранится. */
  function go(path: string) {
    if (openGame) openGame(path);
    else navigate(path);
  }
  /** Открыть конструктор игры блока с возвратом к программе. */
  function openBlock(id: string) {
    go(`/studio/games/${id}?evening=${encodeURIComponent(gameId)}`);
  }

  /** «✍️ Подготовить под вечер»: своя копия шаблона вместо него в программе — и сразу её конструктор. */
  async function prepare(i: number, game: Game) {
    if (!uid || preparingRef.current) return;
    preparingRef.current = true;
    setPreparing(i);
    setNote(null);
    try {
      const draft = { ...copyOfGame(game, "personal", uid), title: prepTitle(game.title, gameTitle ?? "", GAME_TITLE_MAX_LENGTH) };
      const id = await gamesRepo.copy(game.id, gameMediaIds(game.mechanic, game.content), draft);
      // Пока шла копия, программу могли поменять — заменяем по свежему содержимому: тот же блок, а если он сдвинулся — первый с этой игрой.
      const now = latest.current.blocks;
      const at = now[i]?.gameId === game.id ? i : now.findIndex((b) => b.gameId === game.id);
      if (at < 0) return setNote("Блок убрали из программы — копия игры осталась в «Моих играх».");
      onChange({ ...latest.current, blocks: now.map((b, k) => (k === at ? { gameId: id, title: draft.title, mechanic: game.mechanic } : b)) });
      openBlock(id);
    } catch {
      setNote("Не удалось сделать копию игры. Проверьте интернет и нажмите ещё раз.");
    } finally {
      preparingRef.current = false;
      setPreparing(null);
    }
  }
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
      const game = sorted.find((g) => fits(g, slot) && !picked.some((p) => p.gameId === g.id));
      if (game) picked.push(refOf(game));
      else missing.push(slotLabel(slot));
    }
    set(picked);
    setNote(missing.length > 0 ? `Не нашлось игр: ${missing.join(", ")}. Добавьте их ниже или скопируйте из библиотеки.` : `Программа «${t.title}» собрана — поменяйте игры и порядок, как нужно. 👥 ${t.setup}`);
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
                  {game && templates.has(i + 1) && <span className="ev-edit__tag ev-edit__tag--template">📚 Шаблон библиотеки — вопросы стандартные</span>}
                  {game && mineIds.has(game.id) && scope !== "agency" && <span className="ev-edit__tag">✍️ Ваша игра</span>}
                  {game && editable && (
                    <span className="ev-edit__go">
                      {templates.has(i + 1) ? (
                        <button type="button" className="btn btn--secondary" disabled={preparing !== null} onClick={() => void prepare(i, game)}>
                          {preparing === i ? "Делаем копию…" : "✍️ Подготовить под вечер"}
                        </button>
                      ) : (
                        <button type="button" className="btn btn--secondary" disabled={preparing !== null} onClick={() => openBlock(game.id)}>
                          ✍️ Редактировать
                        </button>
                      )}
                    </span>
                  )}
                  {game && <BlockMemo mechanic={game.mechanic} go={go} />}
                  {lost && (
                    <span className="error small">
                      {scope === "agency" ? "Не игра библиотеки (или удалена) — ведущие её не запустят. Замените блок." : "Игра не найдена (удалена?) — уберите блок или замените."}
                    </span>
                  )}
                </span>
                {editable && (
                  <span className="ev-edit__tools">
                    <button type="button" className="btn btn--quiet" aria-label="Выше" disabled={i === 0 || preparing !== null} onClick={() => move(i, -1)}>
                      ↑
                    </button>
                    <button type="button" className="btn btn--quiet" aria-label="Ниже" disabled={i === blocks.length - 1 || preparing !== null} onClick={() => move(i, 1)}>
                      ↓
                    </button>
                    <button type="button" className="btn btn--quiet" disabled={preparing !== null} onClick={() => set(blocks.filter((_, k) => k !== i))}>
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
                        <span className="choice__hint">👥 {t.setup}</span>
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

/** «📋 Памятка» у блока: что подготовить, что сказать гостям и где подробная инструкция. */
function BlockMemo({ mechanic, go }: { mechanic: string; go: (path: string) => void }) {
  const explain = guideFor(mechanic)?.explain;
  return (
    <details className="ev-memo">
      <summary>📋 Памятка ведущему</summary>
      <p className="small">
        <strong>Подготовить заранее.</strong> {blockPrepOf(mechanic)}
      </p>
      {explain && (
        <p className="small">
          <strong>Сказать гостям.</strong> {explain}
        </p>
      )}
      <span className="ev-memo__links">
        <button type="button" className="btn btn--quiet" onClick={() => go(`/studio/guide#${mechanic}`)}>
          🎤 Как провести на празднике
        </button>
        {editorGuideFor(mechanic) && (
          <button type="button" className="btn btn--quiet" onClick={() => go(`/studio/editor-guide#${mechanic}`)}>
            ✍️ Как заполнить
          </button>
        )}
      </span>
    </details>
  );
}
