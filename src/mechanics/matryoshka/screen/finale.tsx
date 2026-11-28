/**
 * «Второй шанс» (дверца в фартуке), «Добивка» (лёд вслепую), финал «Камень, ножницы, бумага» (сетка, дуэль руками в рукавах
 * матрёшки — коралл и шалфей), «Лучший болельщик», чемпион (последняя матрёшка, Копилка взрывается монетами), пьедестал.
 */
import { useMemo, type CSSProperties } from "react";
import { Coin, Hand, Jar, seeded } from "../art/bits";
import { Doll, OpenDoll } from "../art/Doll";
import { folkProps, Frame, jarFill, type BoardProps } from "./boards";
import { chipColor, leftMs, numText, plainName, secs, type ScreenModel } from "./model";
import { at, Chip, Counters, Head, Mini, Plate, plural, px, Strip, Timer, Who, WhoList } from "./parts";
import { IceGrid, type IceRow } from "./trials";
import type { DuelV, FinalV, Gesture } from "./view";

// ------------------------------------------------------------------ «Второй шанс»

const LETTERS = ["А", "Б", "В", "Г"];

export function ChanceBoard({ m, v, code, getNow, liveAt, still }: BoardProps) {
  const c = v.chance;
  if (!c) return null;
  const { folk, glow } = folkProps(v);
  const left = leftMs(c.stageEnds, getNow());
  const total = c.stage === "question" ? 10 : 4;
  const open = c.stage !== "offer";
  return (
    <Frame className={`mts-chance${!still && liveAt.door !== undefined ? " is-live" : ""}`}>
      <Head eyebrow="Один раз за игру · после трёх испытаний" title="Второй шанс" />
      {c.stage !== "done" && <Timer left={secs(left)} total={total} />}
      <div className="mts-abs mts-chance__doll" style={at(90, 230, 400)}>
        <Doll folk={folk} glow={glow} view="face" door />
      </div>
      <Plate className="mts-q" style={at(560, 220, 1320)}>
        {!open ? (
          <>
            <div className="mts-eyebrow">Дверца в фартуке Матрёшки открыта</div>
            <div className="mts-q__text">Вопрос для тех, кто в сугробе</div>
            <div className="mts-cap">
              Отвечают на телефонах <b>{c.eligible}</b> {plural(c.eligible, "выбывший", "выбывших", "выбывших")} · вернутся <b>{c.count}</b> самых быстрых с верным ответом, по одному сердечку
            </div>
          </>
        ) : (
          <>
            <div className="mts-eyebrow">Вопрос для тех, кто в сугробе</div>
            <div className="mts-q__text">{c.q}</div>
            <div className="mts-opts">
              {(c.options ?? []).map((o, i) => (
                <div key={i} className={`mts-opt${c.correct === i ? " is-right" : c.correct !== null ? " is-dim" : ""}`}>
                  <span className="mts-opt__l">{LETTERS[i] ?? i + 1}</span>
                  <span className="mts-opt__t">{o}</span>
                </div>
              ))}
            </div>
            {c.stage === "question" ? (
              <div className="mts-cap">
                Ответили <b>{c.answered}</b> из {c.eligible} · вернутся <b>{c.count}</b> самых быстрых с верным ответом
              </div>
            ) : c.returned.length > 0 ? (
              <div className="mts-body">
                Возвращаются в игру: <WhoList nums={c.returned} m={m} max={4} />
              </div>
            ) : (
              <div className="mts-body">Верных ответов нет — сугроб не отпустил никого.</div>
            )}
          </>
        )}
      </Plate>
      {c.stage === "done" && (
        <Plate className="mts-hint" style={at(560, 840, 1320)}>
          Ждём ведущего — он откроет следующую матрёшку
        </Plate>
      )}
      <Strip m={m} code={code} peek note={c.stage === "question" ? "· ждут ответа" : undefined} />
    </Frame>
  );
}

// ------------------------------------------------------------------ «Добивка»

export function DobivkaBoard({ m, v, code, getNow }: BoardProps) {
  const d = v.dobivka;
  if (!d) return null;
  const night = v.style === "night";
  const now = getNow();
  const cracking = d.solid !== null && d.fell !== null;
  const rows: IceRow[] = Array.from({ length: 6 }, (_, i) => {
    if (i === d.row && d.stage === "rows") return cracking && d.solid ? { solid: d.solid, holes: [d.solid === "L" ? "R" : "L"], crack: d.solid === "L" ? "R" : "L", arrows: false } : { solid: null, holes: [], crack: null, arrows: true };
    return { solid: null, holes: [], crack: null, arrows: false };
  });
  const left = cracking ? leftMs(d.crackEnds, now) : leftMs(d.chooseEnds ?? d.stageEnds, now);
  const finalists = v.inGame - (d.stage === "results" ? 0 : d.need);
  const title = d.stage === "intro" ? "Лёд вслепую" : d.stage === "results" ? "Финалисты определены" : cracking ? `Тонкий лёд — ${d.solid === "L" ? "справа" : "слева"}!` : "Влево или вправо?";
  return (
    <Frame className="mts-dob">
      <IceGrid rows={rows} night={night} />
      <Head eyebrow="Перед финалом · добивка" title={title} />
      <Counters style={{ right: px(200), top: "calc(var(--px) * 36 - var(--band))" }} items={[{ n: v.inGame, text: "в игре" }, { n: Math.max(0, finalists), text: plural(Math.max(0, finalists), "финалист", "финалиста", "финалистов") }]} />
      {d.stage !== "results" && <Timer left={secs(left)} total={cracking ? 3 : 10} />}
      <div className="mts-abs mts-center" style={at(580, 190, 1320)}>
        <div className="mts-title mts-title--l">{d.stage === "results" ? "Кто устоял — в финале" : "Смельчаков нет — прыгают все сразу"}</div>
        <div className="mts-cap">{d.stage === "results" ? "Посев — по испытаниям" : `Где тонкий лёд, не видно никому. Ряд за рядом, пока не останется ${Math.max(0, finalists)}`}</div>
      </div>
      {d.stage === "rows" && (
        <Plate style={at(40, 420, 400)}>
          <div className="mts-eyebrow">Ряд {d.row + 1} из 3</div>
          <div className="mts-body">
            Выбрали <b>{d.picked}</b> из {v.inGame}
          </div>
          <div className="mts-cap">куда — узнаем после прыжка</div>
        </Plate>
      )}
      {cracking && d.shares && d.solid && (
        <Plate className="mts-pct" style={at(1460, 420, 420)}>
          <div className={d.solid === "L" ? "" : "is-bad"}>
            <b className="mts-num">{d.shares.L}%</b>
            <span>← влево</span>
          </div>
          <div className={d.solid === "R" ? "" : "is-bad"}>
            <b className="mts-num">{d.shares.R}%</b>
            <span>вправо →</span>
          </div>
        </Plate>
      )}
      {d.stage === "results" && d.out.length > 0 && (
        <Plate style={at(1460, 420, 420)}>
          <div className="mts-eyebrow">В сугроб</div>
          <div className="mts-body">
            <WhoList nums={d.out} m={m} max={3} />
          </div>
        </Plate>
      )}
      {d.stage === "rows" && !cracking && (
        <div className="mts-abs mts-blind" style={at(560, 760, 800)}>
          {Array.from({ length: Math.min(9, v.inGame) }, (_, i) => (
            <span key={i} className="mts-blind__q">
              ?
            </span>
          ))}
        </div>
      )}
      <Strip m={m} code={code} />
    </Frame>
  );
}

// ------------------------------------------------------------------ финал: сетка

function FCard({ m, n, note, cls }: { m: ScreenModel; n: number; note?: string; cls?: string }) {
  if (n <= 0)
    return (
      <div className={`mts-fcard is-empty${cls ? ` ${cls}` : ""}`}>
        <span className="mts-cap">{note ?? "без соперника"}</span>
      </div>
    );
  const name = m.view?.names[n];
  return (
    <div className={`mts-fcard${cls ? ` ${cls}` : ""}`}>
      <Mini n={n} m={m} big="big" />
      <div className="mts-fcard__t">
        <div className="mts-fcard__name">{name ? plainName(name) : numText(n)}</div>
        <div className="mts-cap">
          {numText(n)}
          {note ? ` · ${note}` : ""}
        </div>
      </div>
    </div>
  );
}

const ROUND_TITLES = (size: number, r: number): string => {
  const left = Math.round(Math.log2(size)) - r;
  return left <= 1 ? "Финал" : left === 2 ? "Полуфиналы" : "Четвертьфиналы";
};

export function BracketBoard({ m, v, code }: BoardProps) {
  const f = v.final;
  if (!f) return null;
  const { folk, glow } = folkProps(v);
  const seedOf = (n: number) => f.seeds.indexOf(n) + 1;
  const rounds = f.rounds.length > 0 ? f.rounds : [[]];
  const dense = f.size >= 8;
  return (
    <Frame className={dense ? "mts-bracket is-dense" : "mts-bracket"}>
      <Head eyebrow="Финал · камень, ножницы, бумага" title="Сетка финала" />
      <Counters items={[{ n: f.seeds.length, text: plural(f.seeds.length, "финалист", "финалиста", "финалистов") }, { n: v.fans, text: plural(v.fans, "болельщик", "болельщика", "болельщиков") }]} />
      <div className="mts-abs mts-bracket__cols" style={at(60, 210, 1440, 630)}>
        {rounds.map((matches, r) => (
          <div key={r} className="mts-bracket__col">
            <div className="mts-eyebrow mts-label">{ROUND_TITLES(f.size, r)}</div>
            {matches.map(([a, b], i) => {
              const now = f.at?.round === r && f.at.match === i;
              const w = f.winners[r]?.[i] ?? null;
              const cls = (n: number) => (now ? "is-now" : w !== null && w > 0 ? (w === n ? "is-win" : "is-lost") : "");
              return (
                <div key={i} className="mts-match">
                  {/* Пусто в первом круге — без соперника (финалистов меньше сетки), дальше — победитель ещё не известен. */}
                  <FCard m={m} n={a} note={a > 0 ? `посев ${seedOf(a)}` : r === 0 ? "без соперника" : "ждём победителя"} cls={cls(a)} />
                  <FCard m={m} n={b} note={b > 0 ? `посев ${seedOf(b)}` : r === 0 ? "соперник проходит без боя" : "ждём победителя"} cls={cls(b)} />
                </div>
              );
            })}
          </div>
        ))}
        {f.champion !== null && (
          <div className="mts-bracket__col">
            <div className="mts-eyebrow mts-label">Чемпион</div>
            <FCard m={m} n={f.champion} cls="is-win" />
          </div>
        )}
      </div>
      <div className="mts-abs" style={at(1540, 190, 360)}>
        <OpenDoll folk={folk} inner="final" glow={glow} sparks={false} />
      </div>
      <Plate className="mts-hint" style={at(40, 862, 1320)}>
        Две победы — дальше. Болельщики ставят на телефонах перед каждой дуэлью
      </Plate>
      <Strip m={m} code={code} out={false} />
    </Frame>
  );
}

// ------------------------------------------------------------------ финал: дуэль

const GESTURE: Record<Gesture, string> = { r: "камень", s: "ножницы", p: "бумага" };

function duelTitle(f: FinalV): string {
  const at0 = f.at;
  if (!at0) return "Дуэль";
  const left = Math.round(Math.log2(f.size)) - at0.round;
  const kind = left <= 1 ? "Финал" : left === 2 ? `Полуфинал ${at0.match + 1}` : `Четвертьфинал ${at0.match + 1}`;
  return kind;
}

export function DuelBoard({ m, v, getNow, still }: BoardProps) {
  const f = v.final;
  const d = f?.duel;
  if (!f || !d) return null;
  const left = leftMs(d.stageEnds, getNow());
  const show = d.stage === "show" || d.stage === "over";
  const g = show ? d.gestures : null;
  const shaking = !still && (d.stage === "pick" || d.stage === "bets");
  const title = d.stage === "bets" ? "Болельщики, ставки!" : d.stage === "pick" ? "Раз, два, три!" : d.winner !== null ? `Победа — ${whoName(m, d.winner)}!` : lastText(d);
  return (
    <Frame className="mts-duel">
      <Head eyebrow={`${duelTitle(f)} · раунд ${d.roundNo + 1}`} title="Камень, ножницы, бумага" />
      {(d.stage === "bets" || d.stage === "pick") && <Timer left={secs(left)} total={5} />}
      <div className="mts-abs mts-center" style={at(0, 200, 1920)}>
        <div className="mts-mega mts-mega--m">{title}</div>
      </div>
      <div className={`mts-abs mts-hand-l${shaking ? " is-shake" : ""}${show && d.last?.winner === d.a ? " is-win" : ""}`} style={at(40, 400, 560)}>
        <Hand kind={g ? g[0] : null} side="L" />
      </div>
      <div className={`mts-abs mts-hand-r${shaking ? " is-shake" : ""}${show && d.last?.winner === d.b ? " is-win" : ""}`} style={at(1320, 400, 560)}>
        <Hand kind={g ? g[1] : null} side="R" />
      </div>
      <div className="mts-abs mts-center" style={at(760, 440, 400)}>
        <div className="mts-num mts-score__n">
          {d.wins[0]} : {d.wins[1]}
        </div>
        <div className="mts-cap">до двух побед</div>
      </div>
      <Plate className="mts-duelist" style={at(60, 830, 620)}>
        <FCard m={m} n={d.a} note={g ? `${GESTURE[g[0]]}${d.auto?.[0] ? " · выбрала Матрёшка" : ""}` : d.picked[0] ? "выбрал(а)" : "думает…"} />
      </Plate>
      <Plate className="mts-duelist" style={at(1240, 830, 620)}>
        <FCard m={m} n={d.b} note={g ? `${GESTURE[g[1]]}${d.auto?.[1] ? " · выбрала Матрёшка" : ""}` : d.picked[1] ? "выбрал(а)" : "думает…"} />
      </Plate>
      <Plate className="mts-bets" style={at(720, 650, 480)}>
        <div className="mts-eyebrow">Ставки болельщиков</div>
        <div className="mts-body">
          Поставили: <b>{d.bets}</b>
        </div>
        {show && d.last?.bySpeed && <div className="mts-cap">Третья ничья — победил тот, кто выбрал быстрее</div>}
        {d.forfeit && <div className="mts-cap">Победа засчитана ведущим</div>}
      </Plate>
    </Frame>
  );
}

function whoName(m: ScreenModel, n: number): string {
  const name = m.view?.names[n];
  return name ? plainName(name) : numText(n);
}

function lastText(d: DuelV): string {
  if (!d.last) return "Раз, два, три!";
  return d.last.winner > 0 ? "Раунд сыгран" : "Ничья — переигрываем";
}

// ------------------------------------------------------------------ «Лучший болельщик»

function Confetti({ n, seed, colors }: { n: number; seed: number; colors: readonly string[] }) {
  const bits = useMemo(() => {
    const r = seeded(seed);
    return Array.from({ length: n }, (_, i) => ({ i, x: r() * 1900, y: r() * 900, a: r() * 180, c: colors[i % colors.length] ?? "#E3C68C", d: r() * 3 }));
  }, [n, seed, colors]);
  return (
    <div className="mts-confetti" aria-hidden="true">
      {bits.map((b) => (
        <i key={b.i} style={{ ...at(b.x, b.y), background: b.c, transform: `rotate(${b.a.toFixed(0)}deg)`, animationDelay: `${b.d.toFixed(2)}s` }} />
      ))}
    </div>
  );
}

const CONF_SUNNY = ["#1B3F8B", "#6E92D6", "#C9A15F", "#B9CCEC"];
const CONF_NIGHT = ["#E9B949", "#C2281E", "#F3D27A", "#E0453A"];

export function BestFanBoard({ m, v, code }: BoardProps) {
  const f = v.final;
  const bf = f?.bestFan;
  if (!f || !bf) return null;
  const { folk, glow } = folkProps(v);
  const name = v.names[bf.num];
  return (
    <Frame className="mts-bestfan">
      <Confetti n={40} seed={29} colors={v.style === "night" ? CONF_NIGHT : CONF_SUNNY} />
      <div className="mts-abs" style={at(110, 150, 380)}>
        <Doll folk={folk} glow={glow} view="face" />
      </div>
      <Plate className="mts-champ" style={at(560, 120, 900)}>
        <div className="mts-eyebrow">Лучший болельщик вечера</div>
        <div className="mts-champ__row">
          <Mini n={bf.num} m={m} big="huge" />
          <div>
            <div className="mts-title mts-title--xl">{name ? plainName(name) : numText(bf.num)}</div>
            <div className="mts-body">{numText(bf.num)} · угадывал(а), тянул(а) канат и ставил(а) в финале</div>
          </div>
        </div>
        <div className="mts-champ__bank">
          <span className="mts-num">{bf.score}</span>
          <span className="mts-body">{plural(bf.score, "очко", "очка", "очков")} болельщика — больше всех</span>
        </div>
      </Plate>
      <div className="mts-abs" style={at(1520, 300, 210)}>
        <Jar count={v.piggy} fill={jarFill(v)} style={v.style} />
      </div>
      <Plate className="mts-hint" style={at(560, 760, 900)}>
        Похлопаем! Дальше — Чемпион «Игр Матрёшки»
      </Plate>
      <Strip m={m} code={code} star={bf.num} />
    </Frame>
  );
}

// ------------------------------------------------------------------ чемпион

/** Места финала по сетке: второй — проигравший финал, третьи — проигравшие полуфиналы. */
export function finalPlaces(f: FinalV): { second: number | null; third: number[] } {
  const R = f.rounds.length;
  const last = f.rounds[R - 1]?.[0];
  const champ = f.champion;
  const second = last && champ !== null ? (last[0] === champ ? last[1] : last[1] === champ ? last[0] : null) : null;
  const third: number[] = [];
  if (R >= 2) {
    const semis = f.rounds[R - 2] ?? [];
    semis.forEach(([a, b], i) => {
      const w = f.winners[R - 2]?.[i];
      if (w && a > 0 && b > 0) third.push(w === a ? b : a);
    });
  }
  return { second: second && second > 0 ? second : null, third };
}

export function ChampionBoard({ m, v, liveAt, still }: BoardProps) {
  const coins = useMemo(() => {
    const r = seeded(23);
    return Array.from({ length: 26 }, (_, i) => {
      const a = r() * Math.PI * 2;
      const dist = 160 + r() * 360;
      return { i, dx: Math.cos(a) * dist, dy: Math.sin(a) * dist * 0.8, s: 30 + Math.round(r() * 22), rot: Math.round(r() * 90) };
    });
  }, []);
  const f = v.final;
  if (!f) return null;
  const { folk, glow } = folkProps(v);
  const champ = f.champion;
  const live = !still && liveAt.champion !== undefined;
  const places = finalPlaces(f);
  const name = champ !== null ? v.names[champ] : undefined;
  return (
    <Frame className={live ? "mts-champion is-live" : "mts-champion"}>
      <Confetti n={60} seed={41} colors={v.style === "night" ? CONF_NIGHT : ["#E3AA9C", "#E3C68C", "#A3C2AA", "#D2A0AC", "#B3AADD"]} />
      <div className="mts-burst" aria-hidden="true">
        {coins.map((c) => (
          <span key={c.i} className="mts-burst__coin" style={{ ...at(1500 + c.dx - c.s / 2, 560 + c.dy - c.s / 2, c.s, c.s), "--rot": `${c.rot}deg`, "--fx": px(-c.dx), "--fy": px(-c.dy) } as CSSProperties}>
            <Coin />
          </span>
        ))}
      </div>
      <div className="mts-abs mts-champion__jar" style={at(1390, 400, 230)}>
        <Jar count={v.piggy} fill={0.7} style={v.style} />
      </div>
      <div className="mts-abs" style={at(90, 130, 330)}>
        <OpenDoll folk={folk} inner="final" glow={glow} sparks opening={live} />
      </div>
      <Plate className="mts-champ" style={at(500, 200, 860)}>
        <div className="mts-eyebrow">Чемпион «Игр Матрёшки»</div>
        {champ !== null ? (
          <>
            <div className="mts-champ__row">
              <Mini n={champ} m={m} big="huge" />
              <div>
                <div className="mts-title mts-title--xl">{name ? plainName(name) : numText(champ)}</div>
                <div className="mts-body">{numText(champ)} · открыл(а) самую маленькую матрёшку</div>
              </div>
            </div>
            <div className="mts-champ__bank">
              <span className="mts-num">{v.piggy}</span>
              <span className="mts-body">{plural(v.piggy, "монета", "монеты", "монет")} из Копилки — твои!</span>
            </div>
            {(places.second !== null || places.third.length > 0) && (
              <div className="mts-cap">
                {places.second !== null && (
                  <>
                    2 место — <Who n={places.second} m={m} />
                  </>
                )}
                {places.third.length > 0 && (
                  <>
                    {places.second !== null ? " · " : ""}3 место — <WhoList nums={places.third} m={m} max={2} />
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="mts-title">Награждение без чемпиона</div>
        )}
      </Plate>
      <Plate className="mts-hint" style={at(500, 880, 860)}>
        Дальше — пьедестал и карточки на телефонах
      </Plate>
    </Frame>
  );
}

// ------------------------------------------------------------------ пьедестал

export function PodiumBoard({ m, v }: BoardProps) {
  const top = v.podium?.top ?? [];
  const { folk, glow } = folkProps(v);
  const steps = top.filter((x) => x.place <= 3).slice(0, 5);
  const rest = top.filter((x) => !steps.includes(x));
  const order = [2, 1, 3];
  return (
    <Frame className="mts-podium">
      <Head eyebrow="Игры Матрёшки · награждение" title="Пьедестал" />
      <Counters items={[{ n: v.piggy, text: plural(v.piggy, "монета", "монеты", "монет") + " в Копилке", tone: "gold" }]} />
      <div className="mts-abs mts-steps" style={at(360, 260, 1200, 600)}>
        {order.map((place) => {
          const who = steps.filter((x) => x.place === place);
          return (
            <div key={place} className={`mts-step is-p${place}`}>
              <div className="mts-step__who">
                {who.map((x) => (
                  <div key={x.num} className="mts-step__one">
                    <Chip n={x.num} m={m} size={place === 1 ? 110 : 84} className="is-static" />
                    <div className="mts-step__name">{v.names[x.num] ? plainName(v.names[x.num] ?? "") : numText(x.num)}</div>
                    <div className="mts-cap mts-nowrap">{numText(x.num)}</div>
                    <div className="mts-cap mts-nowrap">
                      {x.points} {plural(x.points, "очко", "очка", "очков")}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mts-step__base" style={{ "--chip": chipColor(place) } as CSSProperties}>
                <b className="mts-num">{place}</b>
              </div>
            </div>
          );
        })}
      </div>
      {rest.length > 0 && (
        <Plate className="mts-rest" style={at(1560, 260, 330)}>
          <ol>
            {rest.map((x) => (
              <li key={x.num}>
                <b className="mts-num">{x.place}</b> <Mini n={x.num} m={m} /> <span>{v.names[x.num] ? plainName(v.names[x.num] ?? "") : numText(x.num)}</span>
              </li>
            ))}
          </ol>
        </Plate>
      )}
      <div className="mts-abs" style={at(60, 300, 260)}>
        <Doll folk={folk} glow={glow} view="face" />
      </div>
    </Frame>
  );
}
