/**
 * Испытания на экране зала: «Замри!» (поле, песенка словами, поворот головы по часам экрана), «Пряник» (коробки и сетка пряников),
 * «Стулья» (пляска и стулья), «Канат» (две стороны, узел, счёт), «Классики» (ледяные ряды, смельчаки, трещина).
 */
import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { Cookie, Jar, Stool, TinBox } from "../art/bits";
import { Doll, TurningDoll } from "../art/Doll";
import { SHAPE_DIFFICULTY, SHAPE_TITLES } from "../rules/shapes";
import type { Side } from "../rules/types";
import { playMat } from "./audio";
import { doneCount, folkProps, Frame, gridOf, jarFill, trialEyebrow, TRIAL_TITLES, type BoardProps } from "./boards";
import { Crowd, type CrowdItem } from "./crowd";
import { F_DONE, F_FAIL, F_HOLD, F_OFFLINE, fieldTokens, freezeLook, has, laneCount, leaders, leftMs, placeTags, markOf, numText, plainName, secs, type FreezeLook } from "./model";
import { at, Chip, Counters, Head, Plate, plural, px, Strip, Tag, Timer, Who, WhoList } from "./parts";
import type { ChairsV, FreezeV, GingerV } from "./view";

// ------------------------------------------------------------------ «Замри!»

/** Поле макета: старт, финиш и ряды дорожек (px макета). */
const FIELD = { x: 150, y: 380, w: 1420, h: 480, run: 1300, finishX: 1406, doneX: 1350 };
const DOM_MAX = 60;

function useFreezeClock(f: FreezeV, getNow: () => number, still: boolean) {
  const dollRef = useRef<HTMLDivElement | null>(null);
  const wordsRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const phrase = useRef(f.phrase);
  phrase.current = f.phrase;
  const nowRef = useRef(getNow);
  nowRef.current = getNow;
  useEffect(() => {
    let raf = 0;
    let last: FreezeLook | null = null;
    const frame = () => {
      const look = freezeLook(phrase.current, nowRef.current());
      const d = dollRef.current;
      const w = wordsRef.current;
      const r = rootRef.current;
      if (d) {
        d.dataset.pose = look.pose;
        d.dataset.look = look.look ? "1" : "0";
        d.dataset.twitch = look.twitch && !still ? "1" : "0";
      }
      if (w) {
        w.dataset.words = String(look.words);
        w.dataset.zamri = look.zamri ? "1" : "0";
      }
      if (r) r.dataset.zamri = look.zamri ? "1" : "0";
      // Звуки — только когда момент наступил при открытом экране (первый кадр — без звука).
      if (last) {
        if (last.pose === "back" && look.pose !== "back" && !last.look) playMat("shuh");
        if (!last.twitch && look.twitch) playMat("decoy");
      }
      last = look;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [still]);
  return { dollRef, wordsRef, rootRef };
}

export function FreezeBoard({ m, v, code, getNow, still }: BoardProps) {
  const t = v.trial;
  const f = t?.play?.kind === "freeze" ? t.play : null;
  const { folk, glow } = folkProps(v);
  const empty: FreezeV = { kind: "freeze", runEnds: null, speed: 0, phrase: null, caught: null, players: [] };
  const refs = useFreezeClock(f ?? empty, getNow, still);
  const players = f?.players ?? [];
  const tokens = useMemo(() => fieldTokens(players), [players]);
  const lanes = laneCount(players.length);
  const gap = FIELD.h / lanes;
  const chip = Math.max(26, Math.min(46, Math.floor(gap * 0.86)));
  const tags = useMemo(() => leaders(players, v.names), [players, v.names]);
  const items = useMemo<CrowdItem[]>(
    () =>
      tokens.map((tk) => ({
        num: tk.num,
        mark: markOf(tk.num, m.marks),
        // Соседи по дорожке: ±0,22 дорожки по высоте и до ±0,7 фишки по пути — толпа, а не стопка фишек.
        x: (tk.done ? FIELD.doneX + (tk.lane % 2) * 32 : 20 + tk.x * FIELD.run + (((tk.slot * 3) % 5) - 2) * chip * 0.35) / FIELD.w,
        y: (gap * (tk.lane + 0.5 + ((tk.slot % 3) - 1) * 0.22)) / FIELD.h,
        caught: tk.caught,
        done: tk.done,
        hold: tk.hold,
        offline: tk.offline,
      })),
    [tokens, m.marks, gap, chip],
  );
  const tagY = useMemo(
    () =>
      placeTags(
        tags.flatMap((n) => {
          const it = items.find((x) => x.num === n);
          return it ? [{ num: n, x: it.x * FIELD.w, y: it.y * FIELD.h - chip / 2 - 40 }] : [];
        }),
      ),
    [tags, items, chip],
  );
  if (!t || !f) return null;
  const now = getNow();
  const left = leftMs(f.runEnds, now);
  const total = t.stageAt !== null && f.runEnds !== null ? Math.round((f.runEnds - t.stageAt) / 1000) : 80;
  const done = doneCount(players);
  const caught = f.caught && f.caught.count > 0 ? f.caught : null;
  const night = v.style === "night";
  return (
    <Frame className="mts-freeze">
      <div ref={refs.rootRef} className="mts-freeze__root" data-zamri="0">
        <Head eyebrow={trialEyebrow(t)} title={TRIAL_TITLES.freeze} />
        <Counters
          style={{ right: px(200), top: "calc(var(--px) * 36 - var(--band))" }}
          items={[
            { n: v.inGame, text: "в игре" },
            { n: done, text: "добежали", tone: "good" },
            { n: v.out, text: "в сугробе", tone: v.out > 0 ? "bad" : undefined },
          ]}
        />
        <Timer left={secs(left)} total={total} />
        <div ref={refs.wordsRef} className="mts-chant" style={at(560, 168, 1060)} data-words="0" data-zamri="0" aria-live="off">
          <span className="mts-chant__w w1">Раз…</span>
          <span className="mts-chant__w w2">два…</span>
          <span className="mts-chant__w w3">три…</span>
          <span className="mts-chant__zamri">Замри!</span>
        </div>
        <div className="mts-chalk" style={at(FIELD.x, 334)}>
          Старт
        </div>
        <div className="mts-chalk" style={at(FIELD.x + FIELD.finishX + 11, 334)}>
          Финиш
        </div>
        <svg className="mts-lines" style={at(FIELD.x, FIELD.y, FIELD.w, FIELD.h)} viewBox={`0 0 ${FIELD.w} ${FIELD.h}`} preserveAspectRatio="none" aria-hidden="true">
          <path d={`M4 0 V${FIELD.h}`} className="mts-lines__start" />
          <path d={`M${FIELD.finishX} 0 V${FIELD.h}`} className="mts-lines__finish" />
          <path d={`M${FIELD.finishX + 22} 0 V${FIELD.h}`} className="mts-lines__finish2" />
        </svg>
        <div className="mts-field" style={at(FIELD.x, FIELD.y, FIELD.w, FIELD.h)}>
          {items.length > DOM_MAX ? (
            <Crowd items={items} chip={chip / FIELD.w} night={night} still={still} />
          ) : (
            items.map((it) => (
              <span
                key={it.num}
                className={`mts-runner${it.caught ? " is-caught" : ""}${it.done ? " is-done" : ""}${it.hold && !it.done ? " is-hold" : ""}${it.offline ? " is-offline" : ""}`}
                style={{ transform: `translate(calc(var(--px) * ${(it.x * FIELD.w - chip / 2).toFixed(1)}), calc(var(--px) * ${(it.y * FIELD.h - chip / 2).toFixed(1)}))` }}
              >
                <Chip n={it.num} m={m} size={chip} />
              </span>
            ))
          )}
          {tags.map((n) => {
            const it = items.find((x) => x.num === n);
            if (!it) return null;
            const y = tagY.get(n) ?? it.y * FIELD.h - chip / 2 - 40;
            return (
              <Tag key={`t${n}`} tone="lead" style={{ transform: `translate(calc(var(--px) * ${(it.x * FIELD.w).toFixed(1)} - 50%), calc(var(--px) * ${y.toFixed(1)}))` }}>
                {numText(n)} {plainName(v.names[n] ?? "")}
              </Tag>
            );
          })}
        </div>
        <div className="mts-abs mts-freeze__doll" style={at(1590, 330, 300)}>
          <TurningDoll ref={refs.dollRef} folk={folk} glow={glow} pose="back" />
        </div>
        {caught ? (
          <Plate className="mts-caught" style={at(40, 872, 1160)}>
            <span className="mts-dot-bad" />
            Поймала: <WhoList nums={caught.nums} m={m} max={2} />
            {caught.count > caught.nums.length ? ` и ещё ${caught.count - Math.min(2, caught.nums.length)}` : ""} — минус сердечко и назад
          </Plate>
        ) : (
          <Plate className="mts-hint" style={at(40, 872, 1160)}>
            Матрёшка поёт — бегите! Обернулась — замрите. Добежали: <b>{done}</b>
          </Plate>
        )}
        <div className="mts-abs" style={at(1660, 800, 128)}>
          <Jar count={v.piggy} fill={jarFill(v)} style={v.style} />
        </div>
        <Strip m={m} code={code} />
      </div>
    </Frame>
  );
}

// ------------------------------------------------------------------ «Пряник»

function GingerBoxes({ g }: { g: GingerV }) {
  const shown = g.boxes;
  const counts = g.counts;
  const last = shown.length - 1;
  return (
    <Plate className="mts-boxes" style={at(120, 400, 1680)}>
      {[0, 1, 2, 3].map((i) => {
        const shape = shown[i] ?? null;
        const d = shape ? SHAPE_DIFFICULTY[shape] : 0;
        return (
          <div key={i} className={`mts-box${i === last && g.sub === "unbox" ? " is-last" : ""}${shape ? " is-open" : ""}`}>
            <TinBox n={i + 1} shape={shape} open={shape !== null} />
            <div className="mts-box__name">{shape ? SHAPE_TITLES[shape].toLowerCase() : "?"}</div>
            <div className="mts-diff" aria-label={shape ? `сложность ${d} из 4` : "фигура — тайна"}>
              {[1, 2, 3, 4].map((k) => (
                <i key={k} className={shape && k <= d ? "" : "o"} />
              ))}
            </div>
            {counts && (
              <div className="mts-cap">
                выбрали <b className="mts-num mts-box__n">{counts[i] ?? 0}</b>
              </div>
            )}
          </div>
        );
      })}
    </Plate>
  );
}

function GingerGrid({ m, v, g }: { m: BoardProps["m"]; v: BoardProps["v"]; g: GingerV }) {
  const list = [...g.players].sort((a, b) => a[0] - b[0]);
  const box = { w: 1840, h: 640 };
  const grid = gridOf(list.length, box.w, box.h, 128);
  const size = Math.floor(grid.size);
  const night = v.style === "night";
  return (
    <div className="mts-abs mts-cookies" style={{ ...at(40, 236, box.w, box.h), gridTemplateColumns: `repeat(${grid.cols}, 1fr)`, "--cell": px(size) } as CSSProperties}>
      {list.map(([n, c, f]) => {
        const done = has(f, F_DONE);
        const cracked = has(f, F_FAIL);
        return (
          <div key={n} className={`mts-gc${cracked ? " is-cracked" : ""}${done ? " is-done" : ""}`}>
            <div className="mts-gc__pic">
              <Cookie shape="circle" prog={done ? 1 : c / 200} cracked={cracked} night={night} className="mts-gc__cookie" />
              {!cracked && <span className="mts-gc__chip">{markOf(n, m.marks)}</span>}
              {done && <i className="mts-gc__ok">✓</i>}
            </div>
            <span className="mts-gc__no">{numText(n)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function GingerBoard({ m, v, code, getNow }: BoardProps) {
  const t = v.trial;
  const g = t?.play?.kind === "ginger" ? t.play : null;
  if (!t || !g) return null;
  const now = getNow();
  if (g.sub === "trace" || g.sub === "over") {
    const left = leftMs(g.traceEnds, now);
    const total = g.unboxEnds !== null && g.traceEnds !== null ? Math.round((g.traceEnds - g.unboxEnds) / 1000) : 45;
    return (
      <Frame className="mts-ginger">
        <Head eyebrow={trialEyebrow(t, "обводка")} title={TRIAL_TITLES.ginger} />
        <Counters
          style={{ right: px(200), top: "calc(var(--px) * 36 - var(--band))" }}
          items={[
            { n: g.whole, text: "целых", tone: "good" },
            { n: g.cracked, text: "треснули", tone: "bad" },
            { n: Math.max(0, g.players.length - g.whole - g.cracked), text: "обводят" },
          ]}
        />
        <Timer left={secs(left)} total={total} />
        <GingerGrid m={m} v={v} g={g} />
        <Strip m={m} code={code} />
      </Frame>
    );
  }
  const pickLeft = leftMs(g.sub === "pick" ? g.pickEnds : g.unboxEnds, now);
  const lastShape = g.boxes[g.boxes.length - 1];
  const title = g.sub === "pick" ? "Выберите коробку на телефоне" : g.boxes.length === 0 ? "Открываем коробки…" : `…а в ${["первой", "второй", "третьей", "четвёртой"][g.boxes.length - 1] ?? "этой"} — ${lastShape ? SHAPE_TITLES[lastShape].toLowerCase() : "?"}!`;
  return (
    <Frame className="mts-ginger">
      <Head eyebrow={trialEyebrow(t, "коробки")} title={TRIAL_TITLES.ginger} />
      <Counters items={[{ n: v.inGame, text: "в игре" }, { n: g.picked, text: "выбрали" }]} />
      {g.sub === "pick" && <Timer left={secs(pickLeft)} total={10} style={{ right: px(40), top: "calc(var(--px) * 200 - var(--band))" }} />}
      <div className="mts-abs mts-center" style={at(380, 220, 1160)}>
        <div className="mts-title mts-title--l">{title}</div>
        <div className="mts-cap">{g.sub === "pick" ? "Какая фигура в какой коробке — тайна до открытия. Не выбрали — коробка по жребию" : "Чем больше точек, тем труднее обвести"}</div>
      </div>
      <GingerBoxes g={g} />
      <Strip m={m} code={code} />
    </Frame>
  );
}

// ------------------------------------------------------------------ «Стулья»

function useCross(at0: number | null, getNow: () => number, fire: () => void) {
  const nowRef = useRef(getNow);
  nowRef.current = getNow;
  const fireRef = useRef(fire);
  fireRef.current = fire;
  useEffect(() => {
    if (at0 === null) return;
    let was = nowRef.current() >= at0;
    if (was) return;
    const h = window.setInterval(() => {
      const now = nowRef.current() >= at0;
      if (now && !was) {
        fireRef.current();
        window.clearInterval(h);
      }
      was = now;
    }, 30);
    return () => window.clearInterval(h);
  }, [at0]);
}

function ChairsDance({ m, c, still }: { m: BoardProps["m"]; c: ChairsV; still: boolean }) {
  const dancers = c.players.filter((p) => has(p[2], F_HOLD)).map((p) => p[0]);
  const n = dancers.length;
  const size = n > 60 ? 34 : n > 36 ? 40 : 48;
  return (
    <div className={still ? "mts-dance" : "mts-dance is-on"} style={at(160, 230, 1360, 680)} aria-hidden="true">
      <div className="mts-dance__ring">
        {dancers.map((num, i) => {
          const ring = n > 40 ? (i % 2) : 0;
          const a = (i / n) * Math.PI * 2;
          const rx = 600 - ring * 110;
          const ry = 290 - ring * 70;
          const x = 680 + Math.cos(a) * rx - size / 2;
          const y = 340 + Math.sin(a) * ry - size / 2;
          return (
            <span key={num} className="mts-dance__chip" style={{ ...at(x, y), animationDelay: `${(i % 5) * -0.12}s` }}>
              <Chip n={num} m={m} size={size} />
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ChairsSeats({ m, c, appeared }: { m: BoardProps["m"]; c: ChairsV; appeared: boolean }) {
  const seated = c.seated ?? [];
  const g = gridOf(c.chairs, 1260, 520, 150);
  const cell = Math.floor(g.size);
  const stand = c.players.filter((p) => has(p[2], F_HOLD) && !seated.includes(p[0])).map((p) => p[0]);
  return (
    <>
      <div className="mts-abs mts-panel" style={at(60, 285, 1300, 550)} aria-hidden="true" />
      <div className={appeared ? "mts-abs mts-stools is-in" : "mts-abs mts-stools"} style={{ ...at(80, 300, 1260, 520), gridTemplateColumns: `repeat(${g.cols}, 1fr)`, "--cell": px(cell) } as CSSProperties}>
        {Array.from({ length: c.chairs }, (_, i) => {
          const who = seated[i];
          return (
            <div key={i} className="mts-stool">
              {who !== undefined && <Chip n={who} m={m} size={Math.round(cell * 0.42)} className="mts-stool__chip" />}
              <Stool />
              <span className="mts-stool__n">{i + 1}</span>
            </div>
          );
        })}
      </div>
      {c.seated !== null && stand.length > 0 && (
        <Plate className="mts-nochair" style={at(1400, 300, 480)}>
          <div className="mts-eyebrow">Стула не хватило</div>
          <div className="mts-nochair__chips">
            {stand.slice(0, 12).map((n) => (
              <Chip key={n} n={n} m={m} size={52} className="is-out is-static" />
            ))}
            {stand.length > 12 && <span className="mts-more">+{stand.length - 12}</span>}
          </div>
          <div className="mts-cap">
            <WhoList nums={stand} m={m} max={2} />
          </div>
        </Plate>
      )}
    </>
  );
}

export function ChairsBoard({ m, v, code, getNow, still }: BoardProps) {
  const t = v.trial;
  const c = t?.play?.kind === "chairs" ? t.play : null;
  const { folk, glow } = folkProps(v);
  useCross(c?.stopAt ?? null, getNow, () => playMat("stop"));
  useCross(c?.appearAt ?? null, getNow, () => playMat("chairs"));
  if (!t || !c) return null;
  const now = getNow();
  const appeared = c.appearAt !== null && now >= c.appearAt;
  const stopped = c.stopAt !== null && now >= c.stopAt;
  const eyebrow = trialEyebrow(t, `заход ${c.round + 1} из 3`);
  const seatedN = c.seated?.length ?? 0;
  if (!stopped && c.sub === "music")
    return (
      <Frame className="mts-chairs">
        <Head eyebrow={eyebrow} title={TRIAL_TITLES.chairs} />
        <Counters items={[{ n: c.inRound, text: "танцуют" }, { n: c.chairs, text: plural(c.chairs, "стул", "стула", "стульев") }]} />
        <ChairsDance m={m} c={c} still={still} />
        <div className="mts-abs mts-center" style={at(160, 470, 1360)}>
          <div className="mts-mega mts-mega--m">Танцуйте!</div>
        </div>
        {[
          [300, 300],
          [1500, 280],
          [260, 700],
          [1300, 760],
          [760, 340],
          [1100, 700],
        ].map(([x, y], i) => (
          <span key={i} className={still ? "mts-note" : "mts-note is-on"} style={{ ...at(x ?? 0, y ?? 0), animationDelay: `${i * 0.3}s` }} aria-hidden="true">
            {i % 2 ? "♫" : "♪"}
          </span>
        ))}
        <div className="mts-abs mts-chairs__doll" style={at(1640, 480, 220)}>
          <Doll folk={folk} glow={glow} view="face" nest={null} />
        </div>
        <Plate className="mts-hint" style={at(40, 850, 1000)}>
          Музыка остановится — на телефонах появятся стулья
        </Plate>
        <Strip m={m} code={code} />
      </Frame>
    );
  return (
    <Frame className="mts-chairs">
      <Head eyebrow={eyebrow} title={TRIAL_TITLES.chairs} />
      <Counters
        items={
          c.seated
            ? [
                { n: seatedN, text: "сели", tone: "good" },
                { n: Math.max(0, c.chairs - seatedN), text: "свободно" },
                { n: Math.max(0, c.inRound - seatedN), text: "без стула", tone: "bad" },
              ]
            : [
                { n: c.inRound, text: "в заходе" },
                { n: c.chairs, text: plural(c.chairs, "стул", "стула", "стульев") },
              ]
        }
      />
      <div className="mts-abs mts-center" style={at(580, 160, 820)}>
        <div className="mts-mega mts-mega--s">{c.seated ? "Кто где сел" : appeared ? "Садитесь!" : "Стоп!"}</div>
      </div>
      {appeared && <ChairsSeats m={m} c={c} appeared={appeared} />}
      <Plate className="mts-hint" style={at(40, 862, 1320)}>
        {c.seated ? `Сели по скорости касания. Без стула — минус сердечко${c.round < 2 ? ". Дальше — только севшие" : ""}` : "Стулья — на телефонах. Касайтесь быстрее!"}
      </Plate>
      <Strip m={m} code={code} />
    </Frame>
  );
}

// ------------------------------------------------------------------ «Канат»

function SideChips({ m, nums, x, style }: { m: BoardProps["m"]; nums: number[]; x: number; style?: CSSProperties }) {
  const shown = nums.slice(0, 16);
  return (
    <div className="mts-abs mts-side-chips" style={{ ...at(x, 470, 300), ...style }}>
      {shown.map((n) => (
        <Chip key={n} n={n} m={m} size={50} className="is-static" />
      ))}
      {nums.length > shown.length && <span className="mts-more">+{nums.length - shown.length}</span>}
    </div>
  );
}

export function RopeBoard({ m, v, code, getNow }: BoardProps) {
  const t = v.trial;
  const r = t?.play?.kind === "rope" ? t.play : null;
  const lastKnot = useRef<{ k: number; at: number } | null>(null);
  useEffect(() => {
    if (!r || r.sub !== "pull") return;
    const now = performance.now();
    const prev = lastKnot.current;
    lastKnot.current = { k: r.knot, at: now };
    if (prev && Math.abs(r.knot - prev.k) >= 6 && now - prev.at < 1500) playMat("strain");
  }, [r?.knot, r?.sub, r]);
  if (!t || !r) return null;
  const now = getNow();
  const left = r.sub === "pull" ? leftMs(r.attemptEnds, now) : r.sub === "rest" ? leftMs(r.restEnds, now) : leftMs(r.splitEnds, now);
  const coral = r.sides.filter((p) => p[1] === 0).map((p) => p[0]);
  const sage = r.sides.filter((p) => p[1] === 1).map((p) => p[0]);
  const pw = r.power[0] + r.power[1];
  const share = pw > 0 ? r.power[0] / pw : 0.5;
  const knotX = 960 - Math.max(-100, Math.min(100, r.knot)) * 3.2;
  const lead = r.knot > 3 ? 0 : r.knot < -3 ? 1 : null;
  const hint =
    r.sub === "split"
      ? "Матрёшка делит двор на две стороны — смотрите свой цвет на телефоне"
      : r.sub === "pull"
        ? lead === null
          ? "Узел посередине — жмите чаще! Болельщики тянут вполсилы"
          : `Узел тянется к ${lead === 0 ? "коралловой" : "шалфейной"} черте — ${lead === 0 ? "шалфейные" : "коралловые"}, жмите чаще!`
        : r.sub === "over"
          ? `Канат перетянули ${r.wins[0] > r.wins[1] ? "коралловые" : "шалфейные"}!`
          : `Передышка — счёт ${r.wins[0]} : ${r.wins[1]}. Следующая попытка через несколько секунд`;
  return (
    <Frame className="mts-rope">
      <Head eyebrow={trialEyebrow(t, r.attempt >= 0 ? `попытка ${r.attempt + 1} из 3` : "стороны")} title={TRIAL_TITLES.rope} />
      <Timer left={secs(left)} total={r.sub === "pull" ? 15 : r.sub === "rest" ? 5 : 4} />
      <div className="mts-abs mts-score mts-center" style={at(760, 40, 400)}>
        <div className="mts-num mts-score__n">
          {r.wins[0]} : {r.wins[1]}
        </div>
        <div className="mts-cap">до двух побед</div>
      </div>
      <svg className="mts-abs mts-ropeline" style={at(0, 0, 1920, 1080)} viewBox="0 0 1920 1080" aria-hidden="true">
        <path d="M150 600 C 700 588 1200 612 1770 600" fill="none" stroke="#9A7444" strokeWidth="22" strokeLinecap="round" />
        <path d="M150 600 C 700 588 1200 612 1770 600" fill="none" stroke="#E3C68C" strokeWidth="14" strokeDasharray="10 12" strokeLinecap="round" />
        <path d="M960 410 V790" stroke="var(--g-text)" strokeWidth="5" strokeDasharray="14 12" opacity=".7" />
        <path d="M640 430 V770 M1280 430 V770" stroke="var(--g-muted)" strokeWidth="4" opacity=".55" />
      </svg>
      <svg className="mts-abs mts-knot" style={{ ...at(0, 0, 1920, 1080), transform: `translateX(calc(var(--px) * ${(knotX - 960).toFixed(1)}))` }} viewBox="0 0 1920 1080" aria-hidden="true">
        <path d="M960 598 l-26 70 l22 -8 l8 22 z M960 598 l26 70 l-22 -8 l-8 22 z" fill="#E3AA9C" stroke="#5A3A2E" strokeWidth="3" />
        <circle cx="960" cy="598" r="30" fill="#C9A15F" stroke="#FBF6F1" strokeWidth="5" />
        <path d="M942 586 q18 24 36 0 M942 610 q18 -24 36 0" fill="none" stroke="#5A3A2E" strokeWidth="4" strokeLinecap="round" />
      </svg>
      <Plate className="mts-side is-coral" style={at(40, 220, 560)}>
        <div className="mts-side__name">← Коралловые</div>
        <div className="mts-cap">
          {r.players[0]} {plural(r.players[0], "игрок", "игрока", "игроков")} + {r.fans[0]} {plural(r.fans[0], "болельщик", "болельщика", "болельщиков")}
        </div>
        <div className="mts-force">
          <i style={{ transform: `scaleX(${share.toFixed(3)})` }} />
        </div>
        <div className="mts-cap">сила {Math.round(share * 100)}%</div>
      </Plate>
      <Plate className="mts-side is-sage" style={at(1320, 220, 560)}>
        <div className="mts-side__name">Шалфейные →</div>
        <div className="mts-cap">
          {r.players[1]} {plural(r.players[1], "игрок", "игрока", "игроков")} + {r.fans[1]} {plural(r.fans[1], "болельщик", "болельщика", "болельщиков")}
        </div>
        <div className="mts-force is-r">
          <i style={{ transform: `scaleX(${(1 - share).toFixed(3)})` }} />
        </div>
        <div className="mts-cap">сила {Math.round((1 - share) * 100)}%</div>
      </Plate>
      <SideChips m={m} nums={coral} x={60} />
      <SideChips m={m} nums={sage} x={1560} />
      <Plate className="mts-hint" style={at(40, 840, 1180)}>
        {hint}
      </Plate>
      <Strip m={m} code={code} out={false} />
    </Frame>
  );
}

// ------------------------------------------------------------------ «Классики» (и лёд «Добивки»)

const ROWS_Y = [940, 840, 745, 660, 585, 520, 465];
const half = (y: number) => 200 + (y - 465) * 0.62;

export interface IceRow {
  /** Крепкая клетка (если ряд сыгран). */
  solid: Side | null;
  /** Где провалились (дыра) и где трещина-вспышка. */
  holes: Side[];
  crack: Side | null;
  arrows: boolean;
}

/** Ледяные классики в перспективе: 6 рядов, ближний внизу. */
export function IceGrid({ rows, night }: { rows: readonly IceRow[]; night: boolean }) {
  return (
    <svg className="mts-abs mts-ice" style={at(0, 0, 1920, 1080)} viewBox="0 0 1920 1080" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => {
        const y1 = ROWS_Y[i] ?? 0;
        const y2 = (ROWS_Y[i + 1] ?? 0) + 10;
        const w1 = half(y1);
        const w2 = half(y2);
        const st = rows[i];
        return (["L", "R"] as const).map((side) => {
          const x1a = 960 + (side === "L" ? -w1 : 8);
          const x1b = 960 + (side === "L" ? -8 : w1);
          const x2a = 960 + (side === "L" ? -w2 : 6);
          const x2b = 960 + (side === "L" ? -6 : w2);
          const pts = `${x1a},${y1} ${x1b},${y1} ${x2b},${y2} ${x2a},${y2}`;
          const mx = (x1a + x1b + x2a + x2b) / 4;
          const my = (y1 + y2) / 2;
          const hole = st?.holes.includes(side) ?? false;
          return (
            <g key={`${i}${side}`}>
              {hole ? (
                <>
                  <polygon points={pts} fill={night ? "#0B0A09" : "#4A5F68"} stroke={night ? "#9CC3D5" : "#2F5F73"} strokeWidth="3" opacity=".9" />
                  <g fill={night ? "#9CC3D5" : "#E6F3F8"} opacity=".85">
                    <path d={`M${mx - 70} ${my - 6} l26 -10 l-6 22z`} />
                    <path d={`M${mx + 40} ${my + 4} l30 -6 l-14 20z`} />
                    <path d={`M${mx - 10} ${my + 14} l18 -4 l-4 14z`} />
                  </g>
                </>
              ) : (
                <>
                  <polygon points={pts} fill={`url(#${night ? "mtIceN" : "mtIce"})`} stroke={night ? "#9CC3D5" : "#2F5F73"} strokeWidth="3" />
                  <path d={`M${x1a + 30} ${y1 - 14} l40 -14 M${x1b - 60} ${y2 + 18} l30 -6`} stroke="#FFFFFF" strokeWidth="3" opacity=".6" strokeLinecap="round" />
                  {st?.crack === side && (
                    <g stroke={night ? "#F2A79C" : "#A6443A"} strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round">
                      <path d={`M${mx} ${my} l-46 -14 l-20 8 M${mx} ${my} l38 -24 l26 4 M${mx} ${my} l-8 26 l-22 8 M${mx} ${my} l54 16 l14 14`} />
                    </g>
                  )}
                </>
              )}
              {st?.arrows && (
                <text x={mx} y={my + 12} textAnchor="middle" className="mts-ice__arrow">
                  {side === "L" ? "← влево" : "вправо →"}
                </text>
              )}
            </g>
          );
        });
      })}
    </svg>
  );
}

/** Центр клетки ряда `row` (px макета). */
export function cellCenter(row: number, side: Side): { x: number; y: number } {
  const y1 = ROWS_Y[row] ?? 0;
  const y2 = (ROWS_Y[row + 1] ?? 0) + 10;
  const w = (half(y1) + half(y2)) / 2;
  return { x: 960 + (side === "L" ? -w / 2 : w / 2), y: (y1 + y2) / 2 };
}

export function HopBoard({ m, v, code, getNow }: BoardProps) {
  const t = v.trial;
  const h = t?.play?.kind === "hopscotch" ? t.play : null;
  if (!t || !h) return null;
  const night = v.style === "night";
  const now = getNow();
  const rows: IceRow[] = Array.from({ length: 6 }, (_, i) => {
    const r = h.rows[i];
    if (i < h.row && r) return { solid: r.solid, holes: [r.solid === "L" ? "R" : "L"], crack: null, arrows: false };
    if (i === h.row) {
      if (h.sub === "crack" && h.solid) return { solid: h.solid, holes: [h.solid === "L" ? "R" : "L"], crack: h.solid === "L" ? "R" : "L", arrows: false };
      return { solid: null, holes: [], crack: null, arrows: h.sub === "choose" || h.sub === "jump" };
    }
    return { solid: null, holes: [], crack: null, arrows: false };
  });
  const left = h.sub === "brave" ? leftMs(h.braveEnds, now) : h.sub === "jump" ? leftMs(h.jumpEnds, now) : h.sub === "choose" ? leftMs(h.chooseEnds, now) : leftMs(h.crackEnds, now);
  const total = h.sub === "brave" ? 3 : h.sub === "jump" ? 5 : h.sub === "choose" ? 10 : 3;
  const thin = h.solid === "L" ? "справа" : "слева";
  const title =
    h.sub === "brave" ? "Кто прыгнет первым?" : h.sub === "jump" ? "Смельчаки выбирают клетку" : h.sub === "choose" ? (h.braves.length > 0 ? "Смельчаки прыгнули — теперь все!" : "Прыгают все: влево или вправо?") : h.sub === "crack" ? `Тонкий лёд — ${thin}!` : "Ряды пройдены";
  const cap =
    h.sub === "brave"
      ? "Жмите «Прыгаю первым!» — трое самых быстрых прыгнут первыми"
      : h.sub === "choose"
        ? `Куда прыгнули — видно всем. Выдержал ли лёд — узнаем вместе · выбрали ${h.picked} из ${h.jumpers}`
        : h.sub === "jump"
          ? "Смельчак на крепком льду получит +3 монеты"
          : "";
  return (
    <Frame className="mts-hop">
      <IceGrid rows={rows} night={night} />
      <Head eyebrow={trialEyebrow(t, `ряд ${Math.min(6, h.row + 1)} из 6`)} title={TRIAL_TITLES.hopscotch} />
      <Counters style={{ right: px(200), top: "calc(var(--px) * 36 - var(--band))" }} items={[{ n: v.inGame, text: "в игре" }, h.sub === "crack" ? { n: h.fell?.length ?? 0, text: "упали", tone: "bad" } : { n: h.braves.length, text: plural(h.braves.length, "смельчак", "смельчака", "смельчаков") }]} />
      {h.sub !== "over" && <Timer left={secs(left)} total={total} />}
      <div className="mts-abs mts-center" style={at(580, 190, 1320)}>
        <div className="mts-title mts-title--l">{title}</div>
        {cap && <div className="mts-cap">{cap}</div>}
      </div>
      {h.braves.length > 0 && h.sub !== "brave" && (
        <Plate style={at(40, 400, 460)}>
          <div className="mts-eyebrow">{h.sub === "jump" ? "Смельчаки" : "Прыгнули"}</div>
          <ul className="mts-joined">
            {h.braves.map((b) => (
              <li key={b.num}>
                <span className="mts-chip-mini-wrap">
                  <Chip n={b.num} m={m} size={40} className="is-static" />
                </span>
                <span>
                  <Who n={b.num} m={m} />
                  {" · "}
                  <span className="mts-nowrap">{b.side ? (b.side === "L" ? "← влево" : "вправо →") : b.picked ? "выбрал(а)" : "думает…"}</span>
                </span>
              </li>
            ))}
          </ul>
        </Plate>
      )}
      {h.braves.map((b, i) => {
        if (!b.side) return null;
        const c = cellCenter(h.row, b.side);
        return (
          <span key={b.num} className="mts-abs mts-brave" style={at(c.x - 29 + (i - 1) * 46, c.y - 60)}>
            <Chip n={b.num} m={m} size={58} />
          </span>
        );
      })}
      {h.sub === "crack" && h.shares && (
        <Plate className="mts-pct" style={at(1460, 400, 420)}>
          <div className={h.solid === "L" ? "" : "is-bad"}>
            <b className="mts-num">{h.shares.L}%</b>
            <span>← влево · {h.solid === "L" ? "лёд держит" : "провалились"}</span>
          </div>
          <div className={h.solid === "R" ? "" : "is-bad"}>
            <b className="mts-num">{h.shares.R}%</b>
            <span>вправо → · {h.solid === "R" ? "лёд держит" : "провалились"}</span>
          </div>
        </Plate>
      )}
      <Strip m={m} code={code} note={h.sub === "crack" && h.fell && h.fell.length > 0 ? `· +${h.fell.length} сейчас` : undefined} />
    </Frame>
  );
}

export { F_OFFLINE };
