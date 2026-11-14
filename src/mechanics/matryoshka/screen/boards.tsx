/**
 * Доски экрана зала «Игр Матрёшки» (макеты второй версии, кадр 1920×1080 в `--px`): лобби, раскрытие матрёшки, правило, отсчёт,
 * «Матрёшка всматривается…», вскрытие (в сугроб, монеты в Копилку), итоги. Испытания — `trials.tsx`, «Второй шанс», «Добивка»,
 * финал и пьедестал — `finale.tsx`.
 */
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { QrCode } from "../../../components/QrCode";
import { joinHint, playUrl } from "../../../components/links";
import { formatSessionCode } from "../../../core/code";
import { VPN_HINT } from "../../../core/texts";
import { MATRYOSHKA_TITLE } from "../../../core/matryoshkaTitle";
import { Coin, Hearts, Jar, Stool, TinBox, TrialIcon } from "../art/bits";
import { Doll, OpenDoll } from "../art/Doll";
import { folkOf, type NestKind } from "../art/folk";
import { LIVES_ADULTS, LIVES_KIDS } from "../rules/constants";
import type { TrialKind } from "../rules/types";
import { BestFanBoard, BracketBoard, ChampionBoard, ChanceBoard, DobivkaBoard, DuelBoard, PodiumBoard } from "./finale";
import { chipColor, has, F_DONE, leftMs, markOf, numText, secs, type Board, type ScreenModel } from "./model";
import { at, atTop, Chip, Counters, Foot, Head, Mini, Plate, plural, px, Strip, Who, WhoList } from "./parts";
import { ChairsBoard, FreezeBoard, GingerBoard, HopBoard, RopeBoard } from "./trials";
import type { ScreenV, TrialV } from "./view";

export interface BoardProps {
  m: ScreenModel;
  v: ScreenV;
  /** Местные часы (мс). */
  local: number;
  code: string;
  /** Время сервера сейчас (на паузе стоит). */
  getNow: () => number;
  still: boolean;
  /** Когда экран сам увидел начало этапа (анимации — только «при открытом экране»). */
  liveAt: Readonly<Record<string, number>>;
  champSince: number | null;
}

export const TRIAL_TITLES: Record<TrialKind, string> = { freeze: "«Замри!»", ginger: "«Пряник»", chairs: "«Стулья»", rope: "«Канат»", hopscotch: "«Классики»" };

export function trialEyebrow(t: TrialV, extra?: string): string {
  const head = `Испытание ${t.index + 1} из ${t.count}`;
  return extra ? `${head} · ${extra}` : head;
}

/** Фон и роспись по стилю: ночью у матрёшки свечение по контуру. */
export function folkProps(v: ScreenV): { folk: ReturnType<typeof folkOf>; glow: boolean } {
  return { folk: folkOf(v.style), glow: v.style === "night" };
}

/** Копилка: доля заполнения — сколько монет от всех, кто играл. */
export function jarFill(v: ScreenV): number {
  const all = v.piggy + v.inGame;
  return all > 0 ? Math.min(1, v.piggy / all) : 0;
}

export function BoardOf({ board, props }: { board: Board; props: BoardProps }) {
  switch (board) {
    case "lobby":
      return <LobbyBoard {...props} />;
    case "open":
      return <OpenBoard {...props} />;
    case "rules":
      return <RulesBoard {...props} />;
    case "countdown":
      return <CountdownBoard {...props} />;
    case "freeze":
      return <FreezeBoard {...props} />;
    case "ginger":
      return <GingerBoard {...props} />;
    case "chairs":
      return <ChairsBoard {...props} />;
    case "rope":
      return <RopeBoard {...props} />;
    case "hop":
      return <HopBoard {...props} />;
    case "judging":
      return <JudgingBoard {...props} />;
    case "reveal":
      return <RevealBoard {...props} />;
    case "results":
      return <ResultsBoard {...props} />;
    case "chance":
      return <ChanceBoard {...props} />;
    case "dobivka":
      return <DobivkaBoard {...props} />;
    case "bracket":
      return <BracketBoard {...props} />;
    case "duel":
      return <DuelBoard {...props} />;
    case "bestFan":
      return <BestFanBoard {...props} />;
    case "champion":
      return <ChampionBoard {...props} />;
    case "podium":
      return <PodiumBoard {...props} />;
    default:
      return null;
  }
}

/** Кадр 16:9 макета (на 4:3 — посередине экрана, шапки и нижняя полоса — у настоящих краёв). */
export function Frame({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className ? `mts-frame ${className}` : "mts-frame"}>{children}</div>;
}

// ------------------------------------------------------------------ лобби

function LobbyBoard({ m, v, code }: BoardProps) {
  const l = v.lobby;
  const count = l?.count ?? 0;
  const lives = l?.lives ?? (v.style === "night" ? LIVES_ADULTS : LIVES_KIDS);
  const { folk, glow } = folkProps(v);
  const nums = l?.nums ?? (l?.marks ?? []).map((_, i) => i + 1);
  const recent = nums.slice(-4).reverse();
  const crowd = nums.slice(0, 51);
  const rows = [crowd.slice(0, 16), crowd.slice(16, 33), crowd.slice(33, 51)];
  return (
    <Frame className="mts-lobby">
      <div className="mts-abs mts-lobby__title" style={atTop(410, 40, 1100)}>
        <div className="mts-eyebrow">JoyRest · игра на вылет · {v.style === "night" ? "«Ночной двор»" : "«Солнечный двор»"}</div>
        <div className="mts-title mts-title--xl">{MATRYOSHKA_TITLE}</div>
      </div>
      <Plate className="mts-qrbox" style={at(60, 200, 460)}>
        <QrCode value={playUrl(code)} label={`QR-код для входа: ${formatSessionCode(code)}`} className="mts-qr" />
        <div className="mts-cap">Наведите камеру телефона</div>
        <div className="mts-code-line">
          <span className="mts-cap">Код</span> <b className="mts-num mts-big-code">{formatSessionCode(code)}</b>
        </div>
        <div className="mts-body">
          <b>{joinHint()}</b>
        </div>
        <div className="mts-cap mts-vpn">{VPN_HINT}</div>
      </Plate>
      <div className="mts-abs" style={at(750, 205, 420)}>
        <Doll folk={folk} glow={glow} view="face" className="mts-lobby__doll" />
      </div>
      <Plate className="mts-lobby__count" style={at(1390, 220, 470)}>
        <div className="mts-eyebrow">Во дворе</div>
        <div className="mts-lobby__n">
          <span className="mts-cap">Уже</span> <b className="mts-num">{count}</b> <span className="mts-body">{plural(count, "игрок", "игрока", "игроков")}</span>
        </div>
        <div className="mts-cap">{count < 6 ? `Игра начнётся от 6 игроков — ещё ${6 - count}` : "Можно до 100 человек"}</div>
        {recent.length > 0 && (
          <ul className="mts-joined">
            {recent.map((n) => (
              <li key={n}>
                <Mini n={n} m={m} />
                <b>{numText(n)}</b>
              </li>
            ))}
          </ul>
        )}
        <div className="mts-cap">
          У каждого номер и {lives} {plural(lives, "сердечко", "сердечка", "сердечек")}
        </div>
        <Hearts n={lives} total={lives} style={v.style} className="mts-lobby__hearts" />
      </Plate>
      <div className="mts-lobby__crowd" style={at(560, 868, 860)}>
        {rows.map((row, i) =>
          row.length > 0 ? (
            <div key={i} className="mts-lobby__row">
              {row.map((n) => (
                <Chip key={n} n={n} m={m} size={44} />
              ))}
            </div>
          ) : null,
        )}
        {nums.length > crowd.length && <span className="mts-more">+{nums.length - crowd.length}</span>}
      </div>
      <div className="mts-abs mts-lobby__foot">
        <Foot code={code} />
      </div>
    </Frame>
  );
}

// ------------------------------------------------------------------ раскрытие матрёшки

const INSIDE: Record<TrialKind, string> = {
  freeze: "Песенка и поворот. Бегите, пока Матрёшка поёт, и замрите, когда она обернётся!",
  ginger: "Жестяные коробки и пряник с фигурой. Обведите, не сломав!",
  chairs: "Музыка и стулья. Стульев меньше, чем игроков, — кто не успел сесть?",
  rope: "Канат на две стороны. Кто перетянет?",
  hopscotch: "Ледяные классики. Где крепкий лёд, а где тонкий?",
};

function FanGuess({ t, v }: { t: TrialV; v: ScreenV }) {
  if (t.kind === "rope" || v.fans === 0) return null;
  return (
    <div className="mts-cap mts-guess">
      Болельщики угадывают на телефонах, сколько ошибутся · ответили <b>{t.guessers}</b> из {v.fans}
    </div>
  );
}

function OpenBoard({ m, v, code, liveAt, still }: BoardProps) {
  const t = v.trial;
  if (!t) return null;
  const { folk, glow } = folkProps(v);
  const opening = !still && liveAt[`open${t.index}`] !== undefined;
  return (
    <Frame className="mts-openb">
      <Head eyebrow={trialEyebrow(t)} title={TRIAL_TITLES[t.kind]} sub="Матрёшка открывает следующую игру" />
      <Counters items={[{ n: v.inGame, text: "в игре" }, { n: v.out, text: "в сугробе", tone: v.out > 0 ? "bad" : undefined }]} />
      <div className="mts-abs" style={at(760, 40, 540)}>
        <OpenDoll folk={folk} inner={t.kind as NestKind} glow={glow} opening={opening} />
      </div>
      <Plate style={at(40, 430, 560)}>
        <div className="mts-eyebrow">Что внутри</div>
        <div className="mts-body">{INSIDE[t.kind]}</div>
        {t.seeding && <div className="mts-cap mts-note">В игре не больше финалистов — испытание на посев: никто не выбывает.</div>}
        <FanGuess t={t} v={v} />
      </Plate>
      <div className="mts-abs" style={at(1560, 600, 200)}>
        <Jar count={v.piggy} fill={jarFill(v)} style={v.style} />
      </div>
      <Strip m={m} code={code} />
    </Frame>
  );
}

// ------------------------------------------------------------------ правило

const RULE: Record<TrialKind, { text: [string, string]; steps: [string, string, string]; cap: string }> = {
  freeze: {
    text: ["Держите палец на телефоне — бегите к Матрёшке.", "Обернулась — отпустите!"],
    steps: ["Палец на нижней половине экрана — фишка бежит", "Матрёшка смотрит: «Замри!»", "Отпустили — вы в безопасности"],
    cap: "Держали, когда она смотрит, — минус сердечко и назад на треть пути. Чтобы добежать, держите около 36 секунд из 80.",
  },
  ginger: {
    text: ["Выберите коробку и обведите пряник пальцем.", "Сошли с линии — «Крак!»"],
    steps: ["Коробка — на телефоне, фигура — тайна", "Обводите по линии, не торопясь", "Целый пряник — быстрее всех!"],
    cap: "Чем больше точек у коробки, тем труднее фигура. Треснул — считаем, сколько успели обвести.",
  },
  chairs: {
    text: ["Танцуйте, пока играет музыка.", "Тишина — хватайте стул на телефоне!"],
    steps: ["Музыка — танцуем", "Музыка оборвалась — на телефоне стулья", "Кто первым коснулся — тот сел"],
    cap: "Три захода, стульев каждый раз меньше. Не хватило стула — минус сердечко. Бывает обманка: музыка замрёт и заиграет снова.",
  },
  rope: {
    text: ["Две стороны — коралловые и шалфейные.", "Жмите на узел чаще — тяните к себе!"],
    steps: ["Сторону выберет Матрёшка", "Жмите на узел как можно чаще", "До двух побед"],
    cap: "Проигравшая сторона рискует сердечком. Болельщики тянут за свою сторону вполсилы.",
  },
  hopscotch: {
    text: ["В каждом ряду одна клетка крепкая, другая — тонкий лёд.", "Влево или вправо?"],
    steps: ["Смельчаки прыгают первыми", "Все видят, куда они прыгнули", "Лёд трескается у всех сразу"],
    cap: "Упали — минус сердечко и дальше не прыгаете. Смельчак на крепком льду — +3 монеты.",
  },
};

function RuleDemo({ kind, i, folk }: { kind: TrialKind; i: number; folk: ReturnType<typeof folkOf> }) {
  if (kind === "freeze") {
    if (i === 1) return <Doll folk={folk} view="face" eyes="look" motion className="mts-demo__doll" />;
    return (
      <svg className="mts-demo__btn" viewBox="0 0 170 150" aria-hidden="true">
        <circle cx="85" cy="80" r="56" fill={i === 0 ? "#C49E96" : "#E9E4DE"} stroke="#8A5148" strokeWidth="4" />
        <text x="85" y="88" textAnchor="middle" fontFamily="Jost, system-ui, sans-serif" fontWeight="600" fontSize="20" fill="#221E1B">
          {i === 0 ? "Держу" : "Стою"}
        </text>
        {i === 0 ? <path d="M85 6 v34" stroke="#8A5148" strokeWidth="10" strokeLinecap="round" /> : <path d="M85 4 v18" stroke="#8A5148" strokeWidth="10" strokeLinecap="round" opacity=".55" />}
      </svg>
    );
  }
  if (kind === "ginger") return i === 0 ? <TinBox n={2} shape={null} open={false} /> : <TinBox n={4} shape={i === 1 ? "star" : "umbrella"} open />;
  if (kind === "chairs") return i === 0 ? <span className="mts-demo__note">♪ ♫</span> : <Stool />;
  if (kind === "rope") return <TrialIcon kind="rope" className="mts-demo__ico" />;
  return <TrialIcon kind="hopscotch" className="mts-demo__ico" />;
}

function RulesBoard({ m, v, code, getNow }: BoardProps) {
  const t = v.trial;
  if (!t) return null;
  const { folk, glow } = folkProps(v);
  const left = leftMs(t.stageEnds, getNow());
  const r = RULE[t.kind];
  const total = t.stageEnds !== null && t.stageAt !== null ? t.stageEnds - t.stageAt : 10_000;
  const frac = left === null ? 0 : 1 - left / Math.max(1, total);
  return (
    <Frame className="mts-rules">
      <Head eyebrow={trialEyebrow(t, "правило")} title={TRIAL_TITLES[t.kind]} />
      <Counters items={[{ n: v.inGame, text: "в игре" }]} />
      <div className="mts-abs" style={at(80, 300, 300)}>
        <Doll folk={folk} glow={glow} view="face" nest={null} />
      </div>
      <Plate className="mts-rule" style={at(460, 230, 1400)}>
        <div className="mts-rule__text">
          {r.text[0]}
          <br />
          <span className="mts-hl">{r.text[1]}</span>
        </div>
        <div className="mts-demos">
          {r.steps.map((s, i) => (
            <div key={s} className="mts-demo">
              <div className="mts-demo__pic">
                <RuleDemo kind={t.kind} i={i} folk={folk} />
              </div>
              <div className="mts-demo__n mts-num">{i + 1}</div>
              <div className="mts-body">{s}</div>
            </div>
          ))}
        </div>
        <div className="mts-cap">{r.cap}</div>
        <FanGuess t={t} v={v} />
      </Plate>
      <Plate className="mts-progress" style={at(460, 850, 1400)}>
        <span className="mts-cap">Начинаем через {secs(left) ?? 0} с</span>
        <div className="mts-bar">
          <i style={{ transform: `scaleX(${Math.max(0, Math.min(1, frac)).toFixed(3)})` }} />
        </div>
      </Plate>
      <Strip m={m} code={code} />
    </Frame>
  );
}

// ------------------------------------------------------------------ отсчёт

function CountdownBoard({ m, v, code, getNow }: BoardProps) {
  const t = v.trial;
  if (!t) return null;
  const { folk, glow } = folkProps(v);
  const n = Math.max(1, secs(leftMs(t.stageEnds, getNow())) ?? 1);
  return (
    <Frame className="mts-countdown">
      <Head eyebrow={trialEyebrow(t)} title={TRIAL_TITLES[t.kind]} />
      <Counters items={[{ n: v.inGame, text: "в игре" }]} />
      <div className="mts-abs mts-countdown__n" style={at(0, 230, 1500)}>
        <b key={n} className="mts-num mts-mega">
          {n}
        </b>
        <div className="mts-title">Приготовились!</div>
      </div>
      <div className="mts-abs" style={at(1500, 260, 340)}>
        <Doll folk={folk} glow={glow} view={t.kind === "freeze" ? "back" : "face"} />
      </div>
      <Strip m={m} code={code} />
    </Frame>
  );
}

// ------------------------------------------------------------------ «Матрёшка всматривается…»

function JudgingBoard({ m, v, code }: BoardProps) {
  const t = v.trial;
  const { folk, glow } = folkProps(v);
  return (
    <Frame className="mts-judging">
      <div className="mts-dim" />
      <div className="mts-abs mts-judging__doll" style={at(800, 90, 320)}>
        <Doll folk={folk} glow={glow} view="face" eyes="look" />
      </div>
      <Plate className="mts-center mts-judging__plate" style={at(460, 630, 1000)}>
        <div className="mts-title mts-title--xl">Матрёшка всматривается…</div>
        <div className="mts-body mts-judging__sub">{t?.kind === "freeze" ? "Собираем последние нажатия" : "Считаем, кто как справился"}</div>
      </Plate>
      <Counters items={[{ n: v.inGame, text: "в игре" }, { n: "?", text: t?.kind === "freeze" ? "поймала" : "в сугроб" }]} />
      <Strip m={m} code={code} />
    </Frame>
  );
}

// ------------------------------------------------------------------ вскрытие: в сугроб и монеты в Копилку

/** Сетка фишек оставшихся: колонок и размер — чтобы поместились в поле. */
export function gridOf(n: number, w: number, h: number, max = 70): { cols: number; size: number } {
  let best = { cols: 1, size: 0 };
  for (let cols = 1; cols <= Math.max(1, n); cols += 1) {
    const rows = Math.ceil(n / cols);
    const size = Math.min(w / cols, h / rows, max);
    if (size > best.size) best = { cols, size };
  }
  return best;
}

function RevealBoard({ m, v, code, liveAt, still }: BoardProps) {
  const t = v.trial;
  const o = t?.outcome;
  const survivors = useMemo(() => {
    const p = t?.play;
    const all = p ? (p.kind === "rope" ? p.sides : p.kind === "hopscotch" ? [] : p.players).map((x) => x[0]) : [];
    const out = new Set(o?.out ?? []);
    return all.filter((n) => !out.has(n));
  }, [t?.play, o?.out]);
  if (!t || !o) return null;
  const live = !still && liveAt[`reveal${t.index}`] !== undefined;
  const falling = o.out.slice(0, 8);
  const g = gridOf(survivors.length, 760, 400, 96);
  const shown = survivors.slice(0, 66);
  return (
    <Frame className={live ? "mts-reveal is-live" : "mts-reveal"}>
      <Head eyebrow={trialEyebrow(t, "вскрытие")} title={o.out.length > 0 ? "В сугроб!" : "Все в игре!"} />
      <Counters items={[{ n: v.inGame, text: "в игре" }, { n: v.out, text: "в сугробе", tone: "bad" }]} />
      <Plate className="mts-reveal__who" style={at(600, 186, 760)}>
        {o.out.length > 0 ? (
          <>
            <span className="mts-cap">Теперь болельщики: </span>
            <WhoList nums={o.out} m={m} max={3} />
          </>
        ) : (
          <span className="mts-body">{t.seeding ? "Испытание на посев — никто не выбывает." : o.lost > 0 ? `Минус сердечко у ${o.lost} — но все ещё в игре!` : "Матрёшка сегодня добрая — никто не выбыл."}</span>
        )}
      </Plate>
      <Plate className="mts-center" style={at(600, 300, 760)}>
        <span className="mts-cap">Остаются в игре</span> <b className="mts-num mts-reveal__n">{v.inGame}</b>
        {o.out.length > 0 && o.lost > o.out.length && <div className="mts-cap">минус сердечко у {o.lost - o.out.length} — ещё в игре</div>}
      </Plate>
      <div className="mts-abs mts-grid" style={{ ...at(600, 395, 760, 400), gridTemplateColumns: `repeat(${g.cols}, 1fr)` }}>
        {shown.map((n) => (
          <span key={n} className="mts-grid__cell">
            <Chip n={n} m={m} size={Math.max(30, Math.floor(g.size * 0.8))} className="is-static" />
          </span>
        ))}
      </div>
      {survivors.length > shown.length && (
        <span className="mts-abs mts-more" style={at(1370, 760)}>
          +{survivors.length - shown.length}
        </span>
      )}
      <div className="mts-fall" aria-hidden="true">
        {falling.map((n, i) => (
          <span key={n} className="mts-fall__chip" style={{ ...at(560 + i * 92, 770 + (i % 3) * 50), animationDelay: `${0.3 + i * 0.22}s`, "--rot": `${(i % 2 ? 1 : -1) * (20 + i * 9)}deg` } as CSSProperties}>
            <Chip n={n} m={m} size={52} className="is-out" />
          </span>
        ))}
        {falling.slice(0, 6).map((n, i) => (
          <span key={`c${n}`} className="mts-coinfly" style={{ ...at(620 + i * 92, 940), animationDelay: `${1.1 + i * 0.22}s`, "--dx": px(1660 - (620 + i * 92)), "--dy": px(-230) } as CSSProperties}>
            <Coin />
          </span>
        ))}
      </div>
      <div className="mts-abs" style={at(1600, 600, 210)}>
        <Jar count={v.piggy} fill={jarFill(v)} style={v.style} />
      </div>
      <Strip m={m} code={code} note={o.out.length > 0 ? `· +${o.out.length} сейчас` : undefined} />
    </Frame>
  );
}

// ------------------------------------------------------------------ итоги испытания

const FAILS: Record<TrialKind, string> = { freeze: "Поймала", ginger: "Треснули", chairs: "Прозевали стул", rope: "", hopscotch: "Упали" };

function ResultsBoard({ m, v, code }: BoardProps) {
  const t = v.trial;
  if (!t) return null;
  const { folk, glow } = folkProps(v);
  const o = t.outcome;
  const outNow = o?.out.length ?? 0;
  const best = o?.top ?? [];
  const finalsNext = t.index + 1 >= t.count;
  return (
    <Frame className="mts-results">
      <Head eyebrow={trialEyebrow(t, "итоги")} title={TRIAL_TITLES[t.kind]} />
      <Plate className="mts-results__card" style={at(40, 230, 1240)}>
        {t.auto ? (
          <div className="mts-body">Испытание пропущено: в нём меньше двух игроков. Никто не выбывает.</div>
        ) : (
          <>
            <div className="mts-stats">
              <div>
                <b className="mts-num">{v.inGame}</b>
                <span>в игре</span>
              </div>
              <div className="is-bad">
                <b className="mts-num">{outNow}</b>
                <span>в сугроб сейчас</span>
              </div>
              <div className="is-gold">
                <b className="mts-num">{v.piggy}</b>
                <span>{plural(v.piggy, "монета", "монеты", "монет")} в Копилке</span>
              </div>
            </div>
            {best.length > 0 && (
              <>
                <div className="mts-eyebrow mts-results__best">Лучшие в испытании</div>
                <ol className="mts-best">
                  {best.map((n, i) => (
                    <li key={n}>
                      <span className="mts-num mts-best__place">{i + 1}</span>
                      <Mini n={n} m={m} />
                      <Who n={n} m={m} />
                    </li>
                  ))}
                </ol>
              </>
            )}
            {o && o.fails !== null && t.kind !== "rope" && (
              <div className="mts-fans-line">
                <span className="mts-eyebrow">Прогноз болельщиков</span>
                <div className="mts-body">
                  {FAILS[t.kind]}: <b>{o.fails}</b>
                  {o.guessBest.length > 0 && (
                    <>
                      {" "}
                      · точнее всех <WhoList nums={o.guessBest} m={m} max={2} /> <span className="mts-pill">+3</span>
                    </>
                  )}
                  {o.guessNear > 0 && <span className="mts-cap"> · рядом ещё {o.guessNear} (+1)</span>}
                </div>
              </div>
            )}
          </>
        )}
      </Plate>
      <div className="mts-abs" style={at(1360, 170, 300)}>
        <Doll folk={folk} glow={glow} view="face" />
      </div>
      <div className="mts-abs" style={at(1660, 560, 200)}>
        <Jar count={v.piggy} fill={jarFill(v)} style={v.style} />
      </div>
      <Plate className="mts-hint" style={at(40, 840, 1240)}>
        {o?.chance ? "Ведущий может открыть «Второй шанс» — дверцу в фартуке Матрёшки" : finalsNext ? "Ждём ведущего — скоро финал" : "Ждём ведущего — он откроет следующую матрёшку"}
      </Plate>
      <Strip m={m} code={code} />
    </Frame>
  );
}

/** Сколько добежали (флаг «финиш»). */
export function doneCount(players: ReadonlyArray<readonly [number, number, number]>): number {
  return players.filter((p) => has(p[2], F_DONE)).length;
}

export { chipColor, markOf };
