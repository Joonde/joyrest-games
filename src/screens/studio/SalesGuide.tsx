/**
 * «Инструкция менеджера» (`/studio/sales-guide`; решение владельца 15 октября 2026): как менеджер по продажам ведёт
 * клиента от появления анкеты до проведённого мероприятия и как проверяет себя. Текст — `src/core/salesGuide.ts`.
 * Видят менеджер (роль `sales`) и владелец (`permissions.canReadSalesGuide`); владельцу — ещё «Как дать роль» и «Как
 * проверять менеджера».
 */
import { useEffect, type CSSProperties } from "react";
import { Link, useLocation } from "react-router-dom";
import { HostGate } from "../../components/HostGate";
import { StudioSkeleton } from "../../components/Skeleton";
import { Toast, useToast } from "../../components/Toast";
import { BackButton } from "../../components/BackButton";
import { TopBar } from "../../components/TopBar";
import {
  OWNER_CHECKS,
  OWNER_SETUP,
  SALES_DEADLINES,
  SALES_ESCALATE,
  SALES_NEVER,
  SALES_PATH,
  SALES_PRICES,
  SALES_SECTIONS,
  SALES_SELF_CHECK,
  type SalesSection,
  type SalesStep,
} from "../../core/salesGuide";
import { permissions, type UserProfile } from "../../data";
import { brand } from "../../themes/brand";
import { rich } from "./Guide";
import { studioActions } from "./Studio";

const TONES: Record<(typeof SALES_PATH)[number]["tone"], string> = {
  gold: brand.gold,
  lavender: brand.lavender,
  sage: brand.sage,
  wine: brand.wine,
  coral: brand.coral,
};

const money = (n: number) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₽`;

export function SalesGuide() {
  return <HostGate skeleton={<StudioSkeleton />}>{(_user, profile) => <SalesGuidePage profile={profile} />}</HostGate>;
}

function Steps({ steps }: { steps: SalesStep[] }) {
  return (
    <ol className="guide-list">
      {steps.map((s) => (
        <li key={s.title}>
          <b>{s.title}.</b> {rich(s.text)}
        </li>
      ))}
    </ol>
  );
}

function Checks({ items }: { items: readonly string[] }) {
  return (
    <ul className="guide-list sales-checks">
      {items.map((t) => (
        <li key={t}>{rich(t)}</li>
      ))}
    </ul>
  );
}

function Section({ section, onCopy }: { section: SalesSection; onCopy: (text: string) => void }) {
  return (
    <section id={section.id} className="card stack guide-game">
      <h2>{section.title}</h2>
      {section.lead && <p className="muted">{section.lead}</p>}
      {section.steps && <Steps steps={section.steps} />}
      {section.checks && (
        <div className="stack stack--tight">
          {section.steps && <h3>Проверьте в анкете</h3>}
          <Checks items={section.checks} />
        </div>
      )}
      {section.note && <p className="guide-note">{section.note}</p>}
      {section.template && (
        <blockquote className="guide-say">
          <span className="guide-step__who">{section.template.title} — скопируйте и поправьте под себя</span>
          {section.template.text}
          <span>
            <button type="button" className="btn btn--quiet" onClick={() => onCopy(section.template?.text ?? "")}>
              Скопировать текст
            </button>
          </span>
        </blockquote>
      )}
    </section>
  );
}

function SalesGuidePage({ profile }: { profile: UserProfile }) {
  const { hash } = useLocation();
  const [toast, showToast] = useToast();
  const owner = permissions.isAdmin(profile);
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [hash]);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast("Текст скопирован");
    } catch {
      showToast("Не получилось скопировать — выделите текст пальцем");
    }
  }

  if (!permissions.canReadSalesGuide(profile)) {
    return (
      <main className="page">
        <TopBar title="Инструкция менеджера" actions={[{ label: "В студию", to: "/studio" }, ...studioActions(profile)]} />
        <p className="muted">Инструкция открыта менеджеру по продажам и владельцу агентства.</p>
      </main>
    );
  }

  return (
    <main className="page page--wide guide">
      <TopBar title="Инструкция менеджера" actions={[{ label: "В студию", to: "/studio" }, ...studioActions(profile)]} />
      <BackButton />

      <section className="card stack guide-game">
        <h2>Менеджер по продажам JoyRest</h2>
        <p>
          Вы принимаете анкеты клиентов, подбираете программу и ведущего, записываете мероприятие и ведёте клиента до отзыва. Всё — в студии на телефоне:{" "}
          <Link to="/studio/clients">«Клиенты»</Link>, <Link to="/studio/calendar">«Календарь и мероприятия»</Link>, <Link to="/venues?tab=requests">«Заявки клиентов»</Link>.
        </p>
        <h3>Путь клиента</h3>
        <ol className="sales-path" aria-label="Статусы клиента по порядку">
          {SALES_PATH.map((p) => (
            <li key={p.status} className="sales-path__step" style={{ "--sales-tone": TONES[p.tone] } as CSSProperties}>
              <span className="sales-path__status">{p.status}</span>
              <span className="sales-path__when">{p.when}</span>
            </li>
          ))}
        </ol>
        <h3>Сроки</h3>
        <div className="guide-table-wrap">
          <table className="guide-table">
            <tbody>
              {SALES_DEADLINES.map((d) => (
                <tr key={d.what}>
                  <td>{d.what}</td>
                  <td>{d.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <nav className="card guide-toc" aria-label="Разделы">
        {SALES_SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="guide-toc__item">
            {s.title}
          </a>
        ))}
        <a href="#prices" className="guide-toc__item">
          💰 Цены
        </a>
        <a href="#rules" className="guide-toc__item">
          ⛔ Нельзя и когда звать владельца
        </a>
        <a href="#check" className="guide-toc__item">
          ✅ Проверка в конце дня
        </a>
        {owner && (
          <a href="#owner" className="guide-toc__item">
            👑 Владельцу
          </a>
        )}
      </nav>

      {SALES_SECTIONS.map((s) => (
        <Section key={s.id} section={s} onCopy={(t) => void copy(t)} />
      ))}

      <section id="prices" className="card stack guide-game">
        <h2>💰 Цены пакетов</h2>
        <p className="muted">Будни, ведущий «Опытный», от 15 до 90 гостей. Точную цену с днём, гостями, форматом ведущего и допами считает калькулятор сайта.</p>
        <div className="guide-table-wrap">
          <table className="guide-table">
            <thead>
              <tr>
                <th>Пакет</th>
                <th>Цена</th>
              </tr>
            </thead>
            <tbody>
              {SALES_PRICES.map((p) => (
                <tr key={p.name}>
                  <td>
                    <b>{p.name}</b>
                    <br />
                    <span className="muted small">{p.games}</span>
                  </td>
                  <td>
                    {money(p.from)} – {money(p.to)}
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <b>Под ключ</b>, больше 90 гостей, свадьбы
                </td>
                <td>индивидуально — через владельца</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section id="rules" className="card stack guide-game">
        <h2>⛔ Нельзя</h2>
        <Checks items={SALES_NEVER} />
        <h3>Сразу зовите владельца</h3>
        <Checks items={SALES_ESCALATE} />
      </section>

      <section id="check" className="card stack guide-game">
        <h2>✅ Проверка в конце дня</h2>
        <p className="muted">То же самое смотрит владелец. Всё выполнено — день закрыт.</p>
        <Checks items={SALES_SELF_CHECK} />
      </section>

      {owner && (
        <section id="owner" className="card stack guide-game">
          <h2>👑 Владельцу</h2>
          <h3>Как сделать человека менеджером</h3>
          <Steps steps={OWNER_SETUP} />
          <h3>Как проверять работу менеджера</h3>
          <Steps steps={OWNER_CHECKS} />
        </section>
      )}
      <Toast text={toast} />
      <BackButton />
    </main>
  );
}
