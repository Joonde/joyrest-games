/**
 * «Инструкции» — вкладка «Команды JoyRest» (решение владельца 21 октября 2026: инструкции ушли из бокового меню студии,
 * оно стало слишком длинным). Владелец видит все: для ведущих, для менеджеров, для себя и что видит в платформе каждая
 * профессия; остальные — свои инструкции и «Мои возможности» (те же, что в `abilitiesOf(...).guides`).
 */
import { Link } from "react-router-dom";
import { abilitiesOf } from "../../core/abilities";
import { PROFESSIONS } from "../../core/professions";
import { clientsRepo, permissions, type UserProfile } from "../../data";

const GUIDE_HINTS: Record<string, string> = {
  "/studio/editor-guide": "Конструктор по шагам: где редактировать и где запускать, картинки, музыка, видео и что увидят зал и гости — для каждой игры.",
  "/studio/guide": "Как провести каждую игру: кнопки пульта, что видят гости, как объяснить правила.",
};

interface GuideCard {
  title: string;
  hint: string;
  to: string;
  button: string;
}

export function StaffGuides({ profile }: { profile: UserProfile }) {
  const owner = permissions.canManageHosts(profile);
  if (!owner) {
    const a = abilitiesOf(profile, permissions);
    const cards: GuideCard[] = [
      ...a.guides.map((g) => ({
        title: g.title,
        hint: GUIDE_HINTS[g.to] ?? "От анкеты до отзыва: сроки, шаблоны сообщений, цены.",
        to: g.to,
        button: "Открыть",
      })),
      { title: "Мои возможности", hint: "Что вы можете в платформе и где это найти. Можно скачать PDF.", to: "/studio/abilities", button: "Открыть" },
    ];
    return <Cards cards={cards} />;
  }
  const cards: GuideCard[] = [
    {
      title: "Для ведущих: конструктор",
      hint: "«Как создавать игры»: где редактировать и где запускать, картинки, музыка, видео, все поля и примеры для каждой игры.",
      to: "/studio/editor-guide",
      button: "Как создавать игры",
    },
    {
      title: "Для ведущих",
      hint: "«Как проводить игры»: схема каждой игры, кнопки пульта, что видят гости, как объяснить правила.",
      to: "/studio/guide",
      button: "Как проводить игры",
    },
    ...(clientsRepo
      ? [
          {
            title: "Для менеджеров по продажам",
            hint: "От анкеты до отзыва: первые 30 минут, проверка даты, цены, шаблоны сообщений, когда звать владельца.",
            to: "/studio/sales-guide",
            button: "Инструкция менеджера",
          },
          {
            title: "Для владельца",
            hint: "Как дать роль менеджеру и проверять его работу — последний раздел инструкции менеджера.",
            to: "/studio/sales-guide#owner",
            button: "Открыть раздел владельца",
          },
        ]
      : []),
    { title: "Мои возможности", hint: "Всё, что может владелец агентства в платформе, со ссылками «Где». Можно скачать PDF.", to: "/studio/abilities", button: "Открыть" },
  ];
  const others = PROFESSIONS.filter((p) => p.id !== "host");
  return (
    <>
      <Cards cards={cards} />
      <section className="card stack" aria-labelledby="guides-pros">
        <h2 id="guides-pros">Другие профессии</h2>
        <p className="muted small">
          Что видит в платформе новый человек этой профессии и что ему можно. Откройте, скачайте PDF и отправьте сотруднику.
        </p>
        <div className="guides-pros">
          {others.map((p) => (
            <Link key={p.id} className="btn btn--secondary" to={`/studio/abilities?profession=${p.id}`}>
              {p.title}
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}

function Cards({ cards }: { cards: GuideCard[] }) {
  return (
    <ul className="guides-list">
      {cards.map((c) => (
        <li key={c.to} className="card stack stack--tight">
          <h2>{c.title}</h2>
          <p className="muted">{c.hint}</p>
          <Link className="btn btn--secondary btn--block" to={c.to}>
            {c.button}
          </Link>
        </li>
      ))}
    </ul>
  );
}
