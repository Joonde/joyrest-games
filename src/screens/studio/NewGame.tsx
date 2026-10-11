import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { cleanGameTitle, GAME_TITLE_MAX_LENGTH, isValidGameTitle } from "../../core/games";
import { gamesRepo, permissions, type AuthUser, type GameScope, type UserProfile } from "../../data";
import { HostGate } from "../../components/HostGate";
import { StudioSkeleton } from "../../components/Skeleton";
import { Message } from "../../components/Status";
import { Fold } from "../../components/Fold";
import { TopBar } from "../../components/TopBar";
import { CATEGORIES, categoryOf } from "../../mechanics/categories";
import { newContent, selectableMechanics } from "../../mechanics/registry";
import { DEFAULT_THEME_ID } from "../../themes/registry";

export function NewGame() {
  return (
    <HostGate skeleton={<StudioSkeleton />}>
      {(user, profile) => <NewGameForm user={user} profile={profile} />}
    </HostGate>
  );
}

function NewGameForm({ profile }: { user: AuthUser; profile: UserProfile }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const scope: GameScope = params.get("scope") === "agency" ? "agency" : "personal";
  const [title, setTitle] = useState("");
  const [mechanic, setMechanic] = useState(selectableMechanics[0]?.id ?? "quiz");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!permissions.canCreateGame(profile, scope, profile.uid)) {
    return <Message title="Нет доступа">Игры библиотеки JoyRest создаёт администратор агентства.</Message>;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const clean = cleanGameTitle(title);
    if (!isValidGameTitle(clean)) {
      setError("Введите название игры.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const id = await gamesRepo.create({
        scope,
        ownerId: profile.uid,
        title: clean,
        mechanic,
        themeId: DEFAULT_THEME_ID,
        ageRating: "0+",
        playMode: "solo",
        content: newContent(mechanic),
      });
      navigate(`/studio/games/${id}`, { replace: true });
    } catch {
      setError("Не удалось создать игру. Проверьте интернет и попробуйте снова.");
      setBusy(false);
    }
  }

  const back = scope === "agency" ? "/studio?tab=agency" : "/studio";

  return (
    <main className="page">
      <TopBar title="Новая игра" actions={[{ label: "В студию", to: back }]} />
      <form className="card" onSubmit={onSubmit}>
        <h2>{scope === "agency" ? "В библиотеку JoyRest" : "В мои игры"}</h2>
        <label className="field">
          Название
          <input
            required
            maxLength={GAME_TITLE_MAX_LENGTH}
            autoComplete="off"
            placeholder="Например, Свадьба Ани и Миши"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <fieldset>
          <legend>Формат игры</legend>
          <p className="muted small">Выбрано: {selectableMechanics.find((m) => m.id === mechanic)?.title}. Форматы собраны по разделам — коснитесь раздела.</p>
          {CATEGORIES.map((c) => {
            const list = selectableMechanics.filter((m) => categoryOf({ mechanic: m.id, content: null }) === c.id);
            if (list.length === 0) return null;
            const chosen = list.find((m) => m.id === mechanic);
            return (
              <Fold key={c.id} title={`${c.icon} ${c.title}`} value={chosen ? `✓ ${chosen.title}` : `${list.length}`} open={Boolean(chosen)}>
                {list.map((m) => (
                  <label key={m.id} className="choice">
                    <input type="radio" name="mechanic" checked={mechanic === m.id} onChange={() => setMechanic(m.id)} />
                    <span className="choice__text">
                      <span className="choice__title">{m.title}</span>
                      <span className="choice__hint">{m.hint}</span>
                    </span>
                  </label>
                ))}
              </Fold>
            );
          })}
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button className="btn btn--block" type="submit" disabled={busy}>
            {busy ? "Создаём…" : "Создать игру"}
          </button>
          <Link className="btn btn--secondary btn--block" to={back}>
            Отмена
          </Link>
        </div>
      </form>
    </main>
  );
}
