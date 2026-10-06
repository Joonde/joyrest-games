import type { CSSProperties } from "react";
import { useState } from "react";
import { Logo, type LogoKind, type LogoTone } from "../components/Logo";
import { QrCode } from "../components/QrCode";
import { TopBar } from "../components/TopBar";
import { brand, teamColors } from "../themes/brand";

const PALETTE: Array<[string, string]> = [
  ["Фон", brand.espresso],
  ["Карточки", brand.cocoa],
  ["Текст", brand.cream],
  ["Второстепенный", brand.taupe],
  ["Пыльная роза", brand.rose],
  ["Коралл", brand.coral],
  ["Винный", brand.wine],
  ["Золото", brand.gold],
  ["Шалфей", brand.sage],
  ["Лаванда", brand.lavender],
  ["Светлый текст", brand.ink],
  ["Светлый второстепенный", brand.taupeDark],
];

const LOGOS: Array<{ title: string; kind: LogoKind; tone: LogoTone; light?: boolean }> = [
  { title: "Кремовый на тёмном", kind: "full", tone: "cream" },
  { title: "Тёмный на светлом", kind: "full", tone: "dark", light: true },
  { title: "Золотой градиент (свадьба)", kind: "full", tone: "gold" },
  { title: "Праздничный градиент (вечеринка)", kind: "full", tone: "festive" },
  { title: "Эмблема (заставка экрана)", kind: "emblem", tone: "cream" },
  { title: "Монограмма", kind: "monogram", tone: "cream" },
];

const tileVars = {
  "--brand-dark-bg": brand.espresso,
  "--brand-dark-text": brand.cream,
  "--brand-light-bg": brand.cream,
  "--brand-light-text": brand.espresso,
} as CSSProperties;

/** Витрина фирменного стиля: палитра, шрифты, кнопки и варианты логотипа. */
export function Brand() {
  const [choice, setChoice] = useState("solo");
  return (
    <main className="page page--wide" style={tileVars}>
      <TopBar title="Фирменный стиль" actions={[{ label: "На главную", to: "/" }]} />

      <section className="card">
        <h2>Логотип</h2>
        <div className="logo-grid">
          {LOGOS.map((l) => (
            <figure key={l.title} className={`logo-tile ${l.light ? "logo-tile--light" : "logo-tile--dark"}`} style={{ margin: 0 }}>
              <Logo kind={l.kind} tone={l.tone} />
              <figcaption>{l.title}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Палитра</h2>
        <div className="swatches">
          {PALETTE.map(([name, color]) => (
            <div key={name} className="swatch">
              <div className="swatch__color" style={{ background: color }} />
              <div className="swatch__label">
                {name}
                <br />
                <span className="muted">{color}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="eyebrow">Цвета команд</p>
        <div className="chips">
          {teamColors.map((color, i) => (
            <span key={color} className="chip chip--team" style={{ "--team-color": color } as CSSProperties}>
              Команда {i + 1}
            </span>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Шрифты и кнопки</h2>
        <h1 style={{ fontSize: 44 }}>Cormorant Garamond — заголовки</h1>
        <div className="big-code">482 915</div>
        <p>Jost — основной текст, подписи и кнопки. Радость без хлопот.</p>
        <p className="muted small">Основная, вторичная и тихая кнопки — других видов нет.</p>
        <div className="row">
          <button className="btn" type="button">
            Открыть экран зала
          </button>
          <button className="btn btn--secondary" type="button">
            Скопировать ссылку
          </button>
          <button className="btn btn--quiet" type="button">
            Выйти
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Выбор и QR-код</h2>
        <fieldset>
          <legend>Участники</legend>
          {[
            ["solo", "Каждый сам за себя", "Каждый гость играет со своего телефона."],
            ["teams", "Команды", "Отвечает капитан, остальные видят вопрос."],
          ].map(([id = "", title, hint]) => (
            <label key={id} className="choice">
              <input type="radio" name="demo" checked={choice === id} onChange={() => setChoice(id)} />
              <span className="choice__text">
                <span className="choice__title">{title}</span>
                <span className="choice__hint">{hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <QrCode value="https://games.joy-rest.ru/play/482915" label="Пример QR-кода JoyRest" />
      </section>
    </main>
  );
}
