// «Олимп» — экран зала, как в согласованном прототипе: карточки богов с портретом и переливом, сцена
// с храмом и туманом, бросок двух d10 на алтаре со шкалой исходов, карта развилки с эмблемами
// голосов, выход босса и бой (лента, колесо судьбы или фриз), концовка и «Пантеон». Свой фон, свои
// частицы и своя музыка лиры. Экран — кадр 16:9 внутри любого экрана (телевизор, ноутбук, телефон).
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Podium } from "../../components/live/Podium";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import { QrCode } from "../../components/QrCode";
import { joinHint, playUrl } from "../../components/links";
import { formatSessionCode } from "../../core/code";
import { secondsLeft } from "../../core/session";
import { VPN_HINT } from "../../core/texts";
import type { Session } from "../../data/types";
import type { ViewProps } from "../types";
import { intentOf, turnQueue, type Battle, type Fighter, type LogEntry } from "./combat";
import { storyOf, type OlympContent } from "./content";
import { foeOf } from "./foes";
import { godOf, GODS, ROLES } from "./gods";
import { currentScene, fightViewOf, godName, hpMaxOfMember, memberStat, parseOlympResult, type Member, type OlympResult } from "./logic";
import { ELEMENT_NAMES, ELEMENTS, OUTCOME_NAMES, STAT_NAMES, levelOf, threshold, type ElementId, type Outcome } from "./rules";
import { placeOf, type Place, type Scene } from "./story";
import { Altar, decorOf, ElChip, ElIcon, Emb, FoeMedal, Icon, LiveBoss, MeanderFrame, Meter, PlaceArt, portraitOf } from "./look/art";
import { useAmbient, sfx, type Ambient } from "./look/audio";
import { diceLabels, prepDice, throwDice } from "./look/dice";
import { burst, Fx, reduceMotion, type FxMode } from "./look/fx";
import "./look/olymp.css";

export const OUTCOME_COLORS: Record<Outcome, string> = { crit: "#F3DFAE", good: "#A3C2AA", mid: "#9EC3D6", bad: "#E3AA9C", fail: "#D98A7A" };
const OUTCOME_WORDS: Record<Outcome, string> = { crit: "Критическая удача!", good: "Хорошо!", mid: "Средне", bad: "Плохо", fail: "Критическая неудача" };
const OUTCOME_SFX: Record<Outcome, "crit" | "good" | "mid" | "bad" | "fail"> = { crit: "crit", good: "good", mid: "mid", bad: "bad", fail: "fail" };

const MUSIC_AMBIENT: Record<Place["music"], Ambient> = { olympus: "scene", temple: "temple", forest: "map", river: "river", boss: "boss", spring: "spring" };
const WEATHER_FX: Record<Place["weather"], FxMode> = { snow: "snow", embers: "embers", mist: "mist", none: "motes" };

/** Эмблема бога участника. */
export function GodEmb({ god, size, className, children }: { god: string | undefined; size?: string; className?: string; children?: ReactNode }) {
  const g = godOf(god);
  return (
    <Emb god={g?.id ?? "foe"} glyph={g?.emblem ?? "foe"} size={size} className={className}>
      {children}
    </Emb>
  );
}

/** Буквы заголовка проявляются по одной (как в прототипе). */
export function Letters({ text, className, delay = 0.3, step = 45 }: { text: string; className?: string; delay?: number; step?: number }) {
  let i = 0;
  const words = text.split(" ");
  return (
    <span className={className} aria-label={text}>
      {words.map((w, wi) => {
        const word = (
          <span key={wi} className="olx-wd" aria-hidden="true">
            {[...w].map((ch, ci) => {
              const n = i++;
              return (
                <span key={ci} style={{ animationDelay: `${n * step + delay * 1000}ms` }}>
                  {ch}
                </span>
              );
            })}
          </span>
        );
        i++;
        return wi < words.length - 1 ? [word, " "] : word;
      })}
    </span>
  );
}

function teamOf(session: Session, pid: string): string {
  return session.leaderboard[pid]?.name ?? "";
}

/** Ключ момента: анимации проигрываются, только когда момент наступил при открытом экране. */
function useFresh(key: string): boolean {
  const first = useRef(key);
  return key !== first.current;
}

// ------------------------------------------------------------------ лобби, выбор богов, отряд

function Lobby({ session, content }: { session: Session; content: OlympContent }) {
  const story = storyOf(content);
  const teams = Object.entries(session.leaderboard);
  return (
    <section className="olx-view olx-lobby">
      <div className="olx-bg olx-bg--temple" />
      <PlaceArt decor="temple" />
      <div className="olx-fog" />
      <div className="olx-lobby__txt">
        <span className="olx-kicker">Олимп · 18+</span>
        <h1 className="olx-brand">ОЛИМП</h1>
        <span className="olx-lobby__story">{story.title}</span>
        <p className="olx-lobby__blurb">{story.blurb}</p>
        <p className="olx-lobby__count">
          {teams.length === 0 ? "Ждём первую команду" : `${session.playMode === "teams" ? "Команд" : "Игроков"} в отряде: ${teams.length}`}
        </p>
        <ul className={`olx-lobby__teams${teams.length > 10 ? " is-compact" : ""}`} aria-live="polite">
          {teams.map(([pid, e]) => (
            <li key={pid}>
              <NameText name={e.name} />
            </li>
          ))}
        </ul>
      </div>
      <div className="olx-lobby__qr olx-glass">
        <QrCode value={playUrl(session.code)} label={`QR-код для входа: ${formatSessionCode(session.code)}`} />
        <span className="olx-lobby__code">{formatSessionCode(session.code)}</span>
        <small>{joinHint()}</small>
        <small className="olx-lobby__vpn">{VPN_HINT}</small>
      </div>
    </section>
  );
}

function CardBack() {
  return (
    <div className="olx-face olx-face--back">
      <MeanderFrame />
      <span className="olx-laurel">J✦R</span>
    </div>
  );
}

/** Карточка бога: портрет (или большая эмблема), имя, роль и стихия, свойства полосками. */
function GodCard({ godId, member, flipped, team }: { godId: string; member?: Member; flipped: boolean; team?: string }) {
  const g = godOf(godId);
  if (!g) return null;
  const portrait = portraitOf(g.id);
  return (
    <div className={`olx-gcard${flipped ? " is-flipped" : ""}`}>
      <div className="olx-gcard__float">
        <CardBack />
        <div className="olx-face olx-face--front">
          {portrait ? <img src={portrait} alt={g.name} /> : <div className="olx-face__emb"><GodEmb god={g.id} size="16cqw" /></div>}
          <div className="olx-bolt" />
          <div className="olx-holo" />
          <div className="olx-shade" />
          <div className="olx-gcard__info">
            <span className="olx-gcard__name">{g.name}</span>
            <span className="olx-gcard__dom">
              {ROLES[g.role].name} · {ELEMENT_NAMES[g.element]}
              {team ? ` · ${team}` : ""}
            </span>
            <div className="olx-stats">
              {(["might", "influence", "wisdom", "endurance", "luck", "cunning"] as const).map((k) => {
                const v = member ? memberStat(member, k) : g.stats[k];
                return (
                  <div key={k} className="olx-stat">
                    <span>
                      {STAT_NAMES[k]} <b>{v}</b>
                    </span>
                    <span className="olx-bar">
                      <i style={{ width: flipped ? `${Math.min(100, v)}%` : 0 }} />
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          {portrait && <GodEmb god={g.id} size="4.6cqw" className="olx-gcard__emb" />}
        </div>
      </div>
    </div>
  );
}

function PickView({ session, r }: { session: Session; r: OlympResult }) {
  return (
    <section className="olx-view olx-cardview">
      <div className="olx-storm" />
      <div className="olx-pick">
        <span className="olx-kicker">Выбор богов</span>
        <h2 className="olx-h2">Капитаны выбирают бога на телефонах</h2>
        <div className="olx-pick__fan">
          {GODS.map((g, i) => (
            <div key={g.id} className="olx-pick__card" style={{ ["--i" as string]: i - (GODS.length - 1) / 2 } as CSSProperties}>
              <GodEmb god={g.id} size="5.4cqw" />
              <b>{g.name}</b>
              <small>{ROLES[g.role].name}</small>
              <ElIcon el={g.element} size="1.6cqw" />
            </div>
          ))}
        </div>
        <p className="olx-pick__count">
          Выбрали: <b>{session.state.answered}</b> из {r.order.length}
        </p>
      </div>
    </section>
  );
}

/** Боги разобраны: карточки по очереди переворачиваются, рядом — весь отряд. */
function PartyView({ session, r }: { session: Session; r: OlympResult }) {
  const pids = r.order.filter((p) => r.party[p]);
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [rows, setRows] = useState(0);
  useEffect(() => {
    const reduce = reduceMotion();
    const timers: number[] = [];
    setFlipped(false);
    timers.push(
      window.setTimeout(() => {
        setFlipped(true);
        sfx("flip");
        timers.push(
          window.setTimeout(() => {
            sfx("thunder");
            burst(0.42, 0.45, ["#F3DFAE", "#CFE3EE", "#fff"], 70);
          }, 700),
        );
      }, reduce ? 0 : 700),
    );
    // Следующая карточка через 5 секунд — по кругу, пока ведущий не продолжит.
    if (pids.length > 1) timers.push(window.setTimeout(() => setI((x) => (x + 1) % pids.length), reduce ? 6000 : 5200));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [i, pids.length]);
  useEffect(() => {
    if (rows >= pids.length) return;
    const t = window.setTimeout(() => {
      setRows((n) => n + 1);
      sfx("pop");
    }, rows === 0 ? 1400 : 450);
    return () => window.clearTimeout(t);
  }, [rows, pids.length]);
  const pid = pids[i % Math.max(1, pids.length)];
  const m = pid ? r.party[pid] : undefined;
  return (
    <section className="olx-view olx-cardview">
      <div className={`olx-storm${flipped ? " is-flash" : ""}`} key={`s${i}`} />
      <div className="olx-cardarea">
        {pid && m && <GodCard key={pid} godId={m.god} member={m} flipped={flipped} team={teamOf(session, pid)} />}
        <div className="olx-party">
          <span className="olx-kicker">Боги разобраны</span>
          {pids.map((p, k) => {
            const mm = r.party[p] as Member;
            const g = godOf(mm.god);
            return (
              <div key={p} className={`olx-party__row${k < rows ? " is-in" : ""}${p === pid ? " is-cur" : ""}`}>
                <GodEmb god={mm.god} size="4cqw" />
                <span>
                  {g?.name}
                  <small>
                    <NameText name={teamOf(session, p)} /> · {g ? ROLES[g.role].name.toLowerCase() : ""}
                  </small>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ сцена и проверка

function SceneBack({ place }: { place: Place | undefined }) {
  const decor = decorOf(place?.id);
  return (
    <>
      <div className={`olx-bg olx-bg--${decor}`} />
      <div className="olx-glow olx-glow--a" />
      <div className="olx-glow olx-glow--b" />
      {decor === "temple" && <div className="olx-shafts" />}
      <PlaceArt decor={decor} />
      {decor === "temple" && (
        <>
          <span className="olx-glint" style={{ right: "41cqw", bottom: "16cqw" }} />
          <span className="olx-glint" style={{ right: "30cqw", bottom: "20cqw", animationDelay: "-.8s" }} />
          <span className="olx-glint" style={{ right: "19cqw", bottom: "14cqw", animationDelay: "-1.7s" }} />
          <span className="olx-glint" style={{ right: "12cqw", bottom: "22cqw", animationDelay: "-2.2s" }} />
        </>
      )}
      <div className="olx-fog" />
      <div className="olx-fog olx-fog--two" />
    </>
  );
}

function TeamEmbs({ r }: { r: OlympResult }) {
  return (
    <div className="olx-team">
      {r.order
        .filter((p) => r.party[p])
        .map((p) => (
          <GodEmb key={p} god={(r.party[p] as Member).god} size="4.2cqw" />
        ))}
    </div>
  );
}

/** Сцена: место, заголовок по буквам, текст, отряд; у проверки — кто бросает и что нужно выбросить. */
function SceneView({ session, content, r, scene, place }: { session: Session; content: OlympContent; r: OlympResult; scene: Scene; place: Place | undefined }) {
  const story = storyOf(content);
  const check = r.phase === "check" && scene.kind === "check" ? r.check : null;
  const who = check?.who ? r.party[check.who] : undefined;
  const stat = who && scene.kind === "check" ? memberStat(who, scene.stat) : 0;
  const thr = threshold(stat);
  const waiting = session.state.stage === "question";
  const sentences = scene.screen.split(/(?<=[.!?…»])\s+(?=[А-ЯЁA-Z«—])/).filter(Boolean);
  const foe = scene.kind === "fight" ? foeOf(scene.foe) : undefined;
  return (
    <section className="olx-view olx-scene is-play" key={scene.id}>
      <SceneBack place={place} />
      <div className="olx-place">
        <span className="olx-pill">{story.title}</span>
        <span className="olx-pill olx-pill--warm">{place?.name ?? ""}</span>
      </div>
      <div className="olx-story">
        <h1 className="olx-story__title">
          <Letters text={scene.title} />
        </h1>
        {sentences.map((t, i) => (
          <p key={i} style={{ animationDelay: `${1.4 + i * 1}s` }}>
            {t}
          </p>
        ))}
      </div>
      {check && who && scene.kind === "check" && (
        <div className={`olx-check olx-glass${waiting ? " is-waiting" : ""}`}>
          <div className="olx-speaker">
            {portraitOf(who.god) ? <img src={portraitOf(who.god) as string} alt="" /> : <GodEmb god={who.god} size="6.5cqw" />}
            <div>
              <b>{waiting ? "Бросает" : "Говорит"} {godName(r, check.who)}</b>
              <small>
                <NameText name={teamOf(session, check.who as string)} /> · {STAT_NAMES[scene.stat]} {stat}
              </small>
            </div>
          </div>
          <div className="olx-need">
            <span className="olx-serif">{thr}+</span>
            <span>нужно выбросить</span>
          </div>
          <div className="olx-chance">
            <i style={{ width: `${Math.max(0, Math.min(100, 101 - thr))}%` }} />
          </div>
          <span className="olx-small">
            Шанс {Math.max(0, Math.min(100, 101 - thr))}% · «хорошо» от {Math.min(96, thr + 20)} · пять исходов
          </span>
          {waiting && <span className="olx-wait">Кубик — на телефоне команды</span>}
        </div>
      )}
      {foe && (
        <div className="olx-say olx-glass olx-say--foe">
          <Emb god="foe" glyph="foe" size="6cqw" />
          <div>
            <small>Впереди бой</small>
            <q>{foe.name}</q>
          </div>
        </div>
      )}
      {r.order.length > 0 && <TeamEmbs r={r} />}
    </section>
  );
}

// ------------------------------------------------------------------ бросок

function RollView({ session, r, scene, place, live }: { session: Session; r: OlympResult; scene: Scene; place: Place | undefined; live: boolean }) {
  const check = r.check;
  const roll = check?.roll ?? null;
  const outcome = check?.outcome ?? null;
  const who = check?.who ? r.party[check.who] : undefined;
  const stat = who && scene.kind === "check" ? memberStat(who, scene.stat) : 0;
  const thr = threshold(stat);
  const key = `${session.state.step}:${roll}`;
  const changed = useFresh(key);
  const [mountLive] = useState(live);
  const fresh = changed || mountLive;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<"roll" | "labels" | "done">(fresh ? "roll" : "done");
  const [labels, setLabels] = useState<Array<{ x: number; y: number }>>([]);
  const [num, setNum] = useState(fresh ? 0 : roll ?? 0);
  const [effect, setEffect] = useState<string | null>(null);
  useEffect(() => {
    void prepDice();
  }, []);
  useEffect(() => {
    if (roll === null || !outcome) return;
    if (!fresh) {
      setPhase("done");
      setNum(roll);
      return;
    }
    const reduce = reduceMotion();
    const timers: number[] = [];
    setPhase("roll");
    sfx("rattle");
    const cancel = canvas.current
      ? throwDice(canvas.current, roll, { reduce, onKnock: () => sfx("knock") }, (pos) => {
          setLabels(pos);
          setPhase("labels");
          sfx("pop");
          timers.push(
            window.setTimeout(() => {
              setPhase("done");
              const t0 = performance.now();
              const D = reduce ? 1 : 900;
              const count = (now: number) => {
                const k = Math.min(1, (now - t0) / D);
                setNum(Math.max(1, Math.round(roll * (1 - Math.pow(1 - k, 3)))));
                if (k < 1) requestAnimationFrame(count);
              };
              requestAnimationFrame(count);
              timers.push(
                window.setTimeout(() => {
                  sfx(OUTCOME_SFX[outcome]);
                  if (outcome === "crit") {
                    setEffect("flash");
                    burst(0.25, 0.55, ["#F3DFAE", "#E3C68C", "#fff"], 180);
                  }
                  if (outcome === "good") burst(0.25, 0.55, ["#A3C2AA", "#F3DFAE"], 80);
                  if (outcome === "mid") burst(0.25, 0.55, ["#9EC3D6"], 30);
                  if (outcome === "fail") setEffect("crack");
                }, reduce ? 0 : 1100),
              );
            }, reduce ? 0 : 1200),
          );
        })
      : () => undefined;
    return () => {
      cancel();
      timers.forEach((t) => window.clearTimeout(t));
    };
    // Только новый бросок: остальные обновления сессии анимацию не перезапускают.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const [tens, units] = roll !== null ? diceLabels(roll) : ["", ""];
  const done = phase === "done";
  const color = outcome ? OUTCOME_COLORS[outcome] : "#F3DFAE";
  const text = outcome && scene.kind === "check" ? scene.outcomes[outcome].text : "";
  return (
    <section className={`olx-view olx-roll${done ? " is-done" : ""}${effect === "crack" ? " is-shake" : ""}`} data-out={outcome ?? undefined} style={{ ["--oc" as string]: color }}>
      <div className="olx-rays" />
      <Altar />
      <div className="olx-floor" />
      <canvas ref={canvas} className="olx-dice" style={{ opacity: done ? 0 : 1 }} aria-hidden="true" />
      <div className="olx-rhead">
        {who && <GodEmb god={who.god} size="3cqw" />}
        <span>
          <b>{godName(r, check?.who)}</b> · {scene.kind === "check" ? `${STAT_NAMES[scene.stat]} ${stat}` : ""} · нужно {thr}+
        </span>
        <span className="olx-pill olx-pill--warm">{place?.name}</span>
      </div>
      {phase !== "roll" && labels.length === 2 && (
        <>
          <span className={`olx-dlab${phase === "labels" ? " is-show" : " is-merge"}`} style={{ left: `${labels[0]?.x}%`, top: `${labels[0]?.y}%` }}>
            {tens}
          </span>
          <span className={`olx-dlab olx-dlab--ice${phase === "labels" ? " is-show" : " is-merge"}`} style={{ left: `${labels[1]?.x}%`, top: `${labels[1]?.y}%` }}>
            {units}
          </span>
        </>
      )}
      <div className="olx-res">
        <div className="olx-meterbox">
          <Meter threshold={thr} needle={done ? roll : null} />
          <span className="olx-bignum">{done ? num : ""}</span>
        </div>
        <div className="olx-out">
          <div className="olx-word">{done && outcome ? <Letters text={OUTCOME_WORDS[outcome]} delay={0.5} step={35} /> : null}</div>
          <p className="olx-otext">{done ? text : ""}</p>
          <div className="olx-chips">
            {done &&
              (check?.chips ?? []).map((c, i) => (
                <span key={i} className={`olx-chip olx-chip--${c.k}`} style={{ animationDelay: `${i * 180 + 1600}ms` }}>
                  {c.t}
                </span>
              ))}
          </div>
        </div>
      </div>
      <div className={`olx-flashw${effect === "flash" ? " is-go" : ""}`} />
      <svg className={`olx-crack${effect === "crack" ? " is-go" : ""}`} viewBox="0 0 1600 900" preserveAspectRatio="none" aria-hidden="true">
        <path d="M400 520 L470 470 L520 500 L600 420 L650 440 L720 360" />
        <path d="M400 520 L350 600 L380 660 L330 760" />
        <path d="M470 470 L455 380 L500 300" />
      </svg>
      {outcome && done && <span className="olx-sr">{`${roll} — ${OUTCOME_NAMES[outcome]}`}</span>}
    </section>
  );
}

// ------------------------------------------------------------------ развилка

const START: [number, number] = [430, 640];
const ENDS: Record<number, Array<[number, number]>> = {
  1: [[1010, 590]],
  2: [
    [820, 380],
    [1160, 760],
  ],
  3: [
    [800, 380],
    [1010, 590],
    [1190, 800],
  ],
  4: [
    [760, 300],
    [980, 470],
    [1160, 640],
    [1300, 830],
  ],
};

function branchPath(end: [number, number]): string {
  const [sx, sy] = START;
  const [ex, ey] = end;
  return `M${sx} ${sy} C ${sx + (ex - sx) * 0.3} ${sy + (ey - sy) * 0.1 - 60}, ${sx + (ex - sx) * 0.7} ${ey + 20}, ${ex} ${ey}`;
}

/** Точка на кубической кривой — для фишки отряда. */
function bez(end: [number, number], t: number): [number, number] {
  const [sx, sy] = START;
  const [ex, ey] = end;
  const p1: [number, number] = [sx + (ex - sx) * 0.3, sy + (ey - sy) * 0.1 - 60];
  const p2: [number, number] = [sx + (ex - sx) * 0.7, ey + 20];
  const u = 1 - t;
  return [u * u * u * sx + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * ex, u * u * u * sy + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * ey];
}

function MapView({ session, content, r, scene, place }: { session: Session; content: OlympContent; r: OlympResult; scene: Scene; place: Place | undefined }) {
  const vote = r.vote;
  const now = useServerNow(500, session.state.stage === "question");
  const left = session.state.stage === "question" ? secondsLeft(session.state, now) : null;
  const n = Math.min(4, Math.max(1, vote?.options.length ?? 1));
  const ends = ENDS[n] ?? ENDS[3] ?? [];
  const picked = vote?.picked ?? null;
  const key = `${session.state.step}:${picked}`;
  const fresh = useFresh(key);
  const [tok, setTok] = useState<[number, number]>(picked !== null && !fresh ? (ends[picked] ?? START) : START);
  const [banner, setBanner] = useState(picked !== null && !fresh);
  const story = storyOf(content);
  useEffect(() => {
    if (session.state.stage === "question" && fresh) sfx("harp");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.state.step]);
  useEffect(() => {
    if (picked === null) {
      setTok(START);
      setBanner(false);
      return;
    }
    const end = ends[picked];
    if (!end) return;
    if (!fresh || reduceMotion()) {
      setTok(end);
      setBanner(true);
      return;
    }
    sfx(vote?.tie ? "rattle" : "win");
    let raf = 0;
    const t0 = performance.now() + (vote?.tie ? 1600 : 300);
    const mv = (t: number) => {
      const k = Math.max(0, Math.min(1, (t - t0) / 2400));
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      setTok(bez(end, e));
      if (k < 1) raf = requestAnimationFrame(mv);
      else {
        burst(end[0] / 1600, end[1] / 900, ["#F3DFAE", "#fff"], 60);
        setBanner(true);
      }
    };
    raf = requestAnimationFrame(mv);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!vote || scene.kind !== "vote") return null;
  const max = Math.max(0, ...vote.tally);
  return (
    <section className="olx-view olx-map is-play">
      <div className="olx-bg olx-bg--map" />
      <svg className="olx-mapsvg" viewBox="0 0 1600 900" aria-hidden="true">
        <g opacity=".5" stroke="#B5ABA2" fill="none" strokeWidth="1">
          <path d="M0 200 Q400 150 800 220 T1600 180" />
          <path d="M0 420 Q350 380 700 450 T1600 400" />
          <path d="M0 640 Q500 600 900 680 T1600 640" />
        </g>
        <path d="M880 900 C 960 760, 1080 640, 1150 470 S 1350 260, 1600 170" stroke="#5F8FA8" strokeWidth="16" fill="none" opacity=".45" />
        <path className="olx-branch" d="M880 900 C 960 760, 1080 640, 1150 470 S 1350 260, 1600 170" stroke="#9EC3D6" strokeWidth="3" fill="none" opacity=".6" />
        <g fill="#2a3a2e" opacity=".9" transform="translate(60 90)">
          <ellipse cx="640" cy="300" rx="11" ry="34" />
          <ellipse cx="672" cy="280" rx="12" ry="42" />
          <ellipse cx="700" cy="305" rx="9" ry="28" />
          <ellipse cx="860" cy="280" rx="12" ry="40" />
          <ellipse cx="890" cy="305" rx="10" ry="30" />
          <ellipse cx="612" cy="230" rx="10" ry="32" />
          <ellipse cx="925" cy="225" rx="11" ry="36" />
        </g>
        <g fill="#14110f" stroke="#6b6158" strokeWidth="2">
          <polygon points="1250,900 1380,640 1510,900" />
          <polygon points="1380,900 1480,700 1600,900" />
        </g>
        <polygon points="1380,640 1350,700 1410,700" fill="#E9F1F6" opacity=".7" />
        <text x="1380" y="608" textAnchor="middle" fontFamily="Cormorant Garamond, serif" fontWeight="700" fontSize="22" fill="#C9A15F" opacity=".85">
          Олимп
        </text>
        <path className="olx-trail" d="M150 780 C 250 760, 330 700, 430 640" stroke="#E3C68C" strokeWidth="5" fill="none" />
        {ends.slice(0, n).map((e, i) => (
          <path key={i} className={`olx-branch${picked === i ? " is-chosen" : picked !== null ? " is-faded" : ""}`} d={branchPath(e)} stroke="#B5ABA2" strokeWidth="3" fill="none" />
        ))}
        <circle cx="150" cy="780" r="10" fill="#6b6158" />
        {ends.slice(0, n).map((e, i) => (
          <g key={`d${i}`}>
            <circle cx={e[0]} cy={e[1]} r="12" fill="#E3C68C" />
            <circle className="olx-dot" cx={e[0]} cy={e[1]} r="12" fill="none" stroke="#E3C68C" strokeWidth="3" style={{ animationDelay: `${-i * 0.6}s` }} />
          </g>
        ))}
        <text x={START[0]} y={START[1] + 60} textAnchor="middle" fontFamily="Jost, sans-serif" fontSize="22" fill="#E9E1D8">
          {place?.name}
        </text>
      </svg>
      <MeanderFrame />
      <div className="olx-mhead">
        <span className="olx-kicker">
          {story.title} · {place?.name}
        </span>
        <span className="olx-serif">{scene.title}</span>
      </div>
      <div className="olx-timer">
        <span className="olx-serif">{left !== null ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : picked !== null ? "✓" : "—"}</span>
        <small>
          {session.state.stage === "question" ? `голосов ${session.state.answered} из ${r.order.length}` : picked !== null ? "голосование закрыто" : "скоро голосование"}
        </small>
      </div>
      {vote.options.map((o, i) => {
        const opt = scene.options[o];
        const e = ends[i];
        if (!opt || !e) return null;
        const voters = vote.voters?.[i] ?? [];
        return (
          <div key={o} className={`olx-node${picked === i ? " is-win" : picked !== null ? " is-dim" : ""}`} style={{ left: `${e[0] / 16}%`, top: `${e[1] / 9}%` }}>
            <span className="olx-serif">{opt.label}</span>
            <small>{opt.hint}</small>
            <span className="olx-votes">
              {picked !== null &&
                voters.map((p) => (
                  <GodEmb key={p} god={r.party[p]?.god} size="2.6cqw" className="is-pop" />
                ))}
              {picked !== null && <span className="olx-count">{vote.tally[i] ?? 0}</span>}
              {picked === null && max === 0 && <span className="olx-count" />}
            </span>
          </div>
        );
      })}
      <div className="olx-token" style={{ left: `${tok[0] / 16}%`, top: `${tok[1] / 9}%` }}>
        <GodEmb god={r.party[r.order.find((p) => r.party[p]) ?? ""]?.god ?? "zeus"} size="4.2cqw" />
      </div>
      {picked !== null && (
        <div className={`olx-banner olx-glass${banner ? " is-on" : ""}`}>
          <span className="olx-serif">{vote.tie && !banner ? "Ничья — решает кубик" : `Отряд идёт: ${scene.options[vote.options[picked] ?? 0]?.label ?? ""}`}</span>
          <small>{vote.tie ? "Голосов поровну — сервер бросил жребий" : "Выбор записан в Сагу"}</small>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ бой

const RANK_GREEK = ["Α", "Β", "Γ", "Δ", "Ε", "Ζ", "Η", "Θ", "Ι", "Κ", "Λ"];

function bossImage(image: string): string | null {
  return image === "boss" ? "/olymp/img/boss.jpg" : null;
}

function FoeArt({ b, mode, dmg, style }: { b: Battle; mode: "hit" | "roar" | null; dmg: string; style?: CSSProperties }) {
  const foe = foeOf(b.foe);
  if (!foe) return null;
  const img = bossImage(foe.image);
  return img ? <LiveBoss image={img} name={foe.name} mode={mode} dmg={dmg} style={style} /> : <FoeMedal glyphColor="#9EC3D6" name={foe.name} mode={mode} dmg={dmg} style={style} />;
}

function HpMini({ f }: { f: Fighter }) {
  const share = f.hpMax > 0 ? f.hp / f.hpMax : 0;
  return (
    <div className="olx-hp">
      <i className={share < 0.35 ? "is-low" : undefined} style={{ width: `${Math.max(0, share * 100)}%` }} />
    </div>
  );
}

function curseMark(f: Fighter): ReactNode {
  const bad = f.effects.find((e) => e.kind === "curse");
  return bad ? <span className="olx-curse">{bad.name[0]}</span> : null;
}

function FighterEmb({ f, size, cur }: { f: Fighter; size: string; cur?: boolean }) {
  if (f.side === "foe") return <Emb god="foe" glyph="foe" size={size} className={cur ? "is-cur" : ""} />;
  return (
    <GodEmb god={f.ref} size={size} className={`${cur ? "is-cur" : ""}${f.down ? " is-down" : ""}`}>
      {curseMark(f)}
    </GodEmb>
  );
}

function FoeHud({ b, wide }: { b: Battle; wide?: boolean }) {
  const foe = foeOf(b.foe);
  const f = b.fighters.find((x) => x.side === "foe");
  const [lag, setLag] = useState(f?.hp ?? 0);
  useEffect(() => {
    const t = window.setTimeout(() => setLag(f?.hp ?? 0), 700);
    return () => window.clearTimeout(t);
  }, [f?.hp]);
  if (!foe || !f) return null;
  const intent = b.over ? undefined : intentOf(b);
  const weak = (Object.entries(foe.resist) as Array<[ElementId, number]>).filter(([, v]) => v > 100).map(([k]) => ELEMENT_NAMES[k].toLowerCase());
  const actorIsFoe = b.fighters.find((x) => x.id === b.actor)?.side === "foe";
  return (
    <div className={`olx-hpwide${wide ? " is-wide" : ""}`}>
      <div className="olx-hpwide__t">
        <span className="olx-serif olx-foename">{foe.name}</span>
        <span>
          ранг {foe.rank}
          {foe.boss ? " · босс" : ""} · <b>{f.hp}</b> / {f.hpMax}
        </span>
      </div>
      <div className="olx-hptrack">
        <i className="olx-hptrack__lag" style={{ width: `${(lag / Math.max(1, f.hpMax)) * 100}%` }} />
        <i className="olx-hptrack__now" style={{ width: `${(f.hp / Math.max(1, f.hpMax)) * 100}%` }} />
      </div>
      <div className="olx-chips">
        <span className="olx-chip">◉ {foe.coins} драхм</span>
        {weak.length > 0 && <span className="olx-chip">уязвим: {weak.join(", ")}</span>}
        {f.effects.map((e) => (
          <span key={e.id} className={`olx-chip ${e.kind === "curse" ? "olx-chip--bad" : "olx-chip--good"}`}>
            {e.name} · {e.left}
          </span>
        ))}
      </div>
      <div className="olx-babs" title="Способности противника">
        {foe.abilities.map((a, i) => (
          <span key={a.id} className={`olx-bab${i === b.intent % foe.abilities.length && !b.over ? " is-next" : ""}`} aria-label={`${a.name} — ${a.hint}`}>
            <Icon name={a.kind} />
          </span>
        ))}
      </div>
      {intent && (
        <span className="olx-intent">
          Готовит: <b>{intent.name}</b> — {intent.hint}, {actorIsFoe ? "сейчас" : "своим ходом"}
        </span>
      )}
    </div>
  );
}

function FightLog({ b, title }: { b: Battle; title: ReactNode }) {
  return (
    <p className="olx-log" aria-live="polite">
      {title}
      {b.log.slice(0, 2).map((e, i) => (
        <span key={e.n} className={`olx-le${i ? " is-old" : ""}`}>
          <LogText e={e} />
        </span>
      ))}
    </p>
  );
}

export function LogText({ e }: { e: LogEntry }) {
  const names = [...new Set(e.who.filter((n) => n && n !== "все"))].sort((a, c) => c.length - a.length);
  const parts: Array<{ t: string; b: boolean }> = [];
  let rest = e.x;
  while (rest) {
    let at = -1;
    let hit = "";
    for (const n of names) {
      const i = rest.indexOf(n);
      if (i >= 0 && (at < 0 || i < at)) {
        at = i;
        hit = n;
      }
    }
    if (at < 0) {
      parts.push({ t: rest, b: false });
      break;
    }
    if (at > 0) parts.push({ t: rest.slice(0, at), b: false });
    parts.push({ t: hit, b: true });
    rest = rest.slice(at + hit.length);
  }
  return <>{parts.map((p, i) => (p.b ? <i key={i}>{p.t}</i> : <span key={i}>{p.t}</span>))}</>;
}

/** Удар по противнику или его рёв — по новой записи журнала боя. */
function useHit(b: Battle): { mode: "hit" | "roar" | null; dmg: string } {
  const foeName = foeOf(b.foe)?.name ?? "";
  const top = b.log[0];
  const [state, setState] = useState<{ mode: "hit" | "roar" | null; dmg: string; n: number }>({ mode: null, dmg: "", n: top?.n ?? 0 });
  useEffect(() => {
    if (!top || top.n === state.n) return;
    let mode: "hit" | "roar" | null = null;
    let dmg = "";
    if (top.d && top.d[1] === foeName) {
      mode = "hit";
      dmg = top.d[2] > 0 ? `−${top.d[2]}` : "мимо";
      sfx("hit");
    } else if (top.d?.[0] === foeName || top.x.startsWith(foeName)) {
      mode = "roar";
      sfx("roar");
    }
    setState({ mode: null, dmg, n: top.n });
    if (mode) {
      const m = mode;
      requestAnimationFrame(() => setState({ mode: m, dmg, n: top.n }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top?.n]);
  return { mode: state.mode, dmg: state.dmg };
}

function PartyMinis({ session, b }: { session: Session; b: Battle }) {
  return (
    <div className="olx-minis">
      {b.fighters
        .filter((f) => f.side === "god")
        .map((f) => (
          <div key={f.id} className={`olx-mini${b.actor === f.id && !b.over ? " is-cur" : ""}${f.down ? " is-down" : ""}`}>
            <FighterEmb f={f} size="3.6cqw" cur={b.actor === f.id && !b.over} />
            <div className="olx-mini__body">
              <b>
                {f.name} · <NameText name={teamOf(session, f.id)} />
              </b>
              <HpMini f={f} />
              <small>
                {f.down ? "без сил" : `${f.hp} / ${f.hpMax}`}
                {f.shield > 0 ? ` · щит ${f.shield}` : ""}
                {f.effects.length > 0 ? ` · ${f.effects.map((e) => e.name.toLowerCase()).join(", ")}` : ""}
              </small>
            </div>
          </div>
        ))}
    </div>
  );
}

function BossIntro({ b }: { b: Battle }) {
  const foe = foeOf(b.foe);
  useEffect(() => {
    const t = window.setTimeout(() => sfx("roar"), 1600);
    return () => window.clearTimeout(t);
  }, []);
  if (!foe) return null;
  const img = bossImage(foe.image);
  return (
    <section className="olx-view olx-intro is-play">
      <div className="olx-intro__art">{img ? <img src={img} alt={foe.name} className="is-emerge" /> : <Emb god="foe" glyph="foe" size="34cqw" className="is-emerge" />}</div>
      <div className="olx-flashi" />
      <div className="olx-intro__txt">
        <span className="olx-kicker olx-fade" style={{ animationDelay: ".6s" }}>
          {foe.boss ? "Из тьмы выходит" : "Путь преграждает"}
        </span>
        <h3>
          {[...foe.name].map((c, i) => (
            <span key={i} style={{ animationDelay: `${i * 55 + 1800}ms` }}>
              {c}
            </span>
          ))}
        </h3>
        <span className="olx-rank olx-fade" style={{ animationDelay: "2.8s" }}>
          <b>{foe.rank}</b> ранг{foe.boss ? " · босс" : ""}
        </span>
        <p className="olx-fade" style={{ animationDelay: "3.2s" }}>
          {foe.about}
        </p>
        <div className="olx-fade olx-resbox" style={{ animationDelay: "4s" }}>
          <span className="olx-reslg">Сколько урона проходит по нему</span>
          <div className="olx-resgrid">
            {ELEMENTS.map((k) => {
              const v = foe.resist[k] ?? 100;
              return (
                <div key={k} className={v === 0 ? "is-immune" : v > 100 ? "is-weak" : v < 100 ? "is-strong" : ""}>
                  <ElIcon el={k} size="1.8cqw" />
                  <span>{ELEMENT_NAMES[k]}</span>
                  <b>{v}%</b>
                </div>
              );
            })}
          </div>
        </div>
        <div className="olx-chips olx-fade" style={{ animationDelay: "3.6s" }}>
          <span className="olx-chip">◉ {foe.coins} драхм</span>
          <span className="olx-chip">{foe.abilities.length} способностей</span>
        </div>
      </div>
    </section>
  );
}

function FightView({ session, content, r, live }: { session: Session; content: OlympContent; r: OlympResult; live: boolean }) {
  const b = r.battle as Battle;
  const view = fightViewOf(r, content);
  const { mode, dmg } = useHit(b);
  // Выход противника: бой начался при открытом экране — 7 секунд во весь экран.
  const [intro, setIntro] = useState(b.turns <= 1 && live);
  const startKey = `${b.foe}:${r.scene}`;
  const seen = useRef(startKey);
  useEffect(() => {
    if (seen.current !== startKey && b.turns <= 1) setIntro(true);
    seen.current = startKey;
  }, [startKey, b.turns]);
  useEffect(() => {
    if (!intro) return;
    const t = window.setTimeout(() => setIntro(false), reduceMotion() ? 2500 : 7500);
    return () => window.clearTimeout(t);
  }, [intro]);
  if (intro) return <BossIntro b={b} />;
  const queue = turnQueue(b, 7).map((id) => b.fighters.find((f) => f.id === id)).filter((f): f is Fighter => !!f);
  const actor = b.fighters.find((f) => f.id === b.actor);
  const title = (
    <>
      {b.over ? (b.over === "win" ? "Противник повержен!" : "Отряд пал") : <>Ходит: <b>{actor?.name ?? "—"}</b></>}
    </>
  );
  const round = Math.floor(b.turns / Math.max(1, b.fighters.length)) + 1;
  return (
    <section className={`olx-view olx-fight olx-fight--${view}`}>
      <div className="olx-frost" />
      {view === "ribbon" && (
        <>
          <div className="olx-tla">
            <div className="olx-flow">
              {queue.map((f, i) => (
                <div key={`${f.id}-${i}`} className="olx-slot">
                  {i === 0 && !b.over && <span className="olx-arrow" />}
                  <FighterEmb f={f} size={i === 0 ? "5cqw" : i < 5 ? "3.4cqw" : "3cqw"} cur={i === 0 && !b.over} />
                  <small>{f.side === "foe" ? (foeOf(b.foe)?.name.split(" ")[0] ?? "") : f.name}</small>
                </div>
              ))}
              <span className="olx-round">раунд {round}</span>
            </div>
          </div>
          <FoeArt b={b} mode={mode} dmg={dmg} style={{ left: "38.5cqw", top: "9cqw", width: "23cqw" }} />
          <div className="olx-hpbox" style={{ left: "30cqw", right: "30cqw", top: "32cqw" }}>
            <FoeHud b={b} />
          </div>
          <PartyMinis session={session} b={b} />
          <div className="olx-logbox" style={{ right: "3cqw", top: "12cqw", width: "22cqw" }}>
            <FightLog b={b} title={title} />
          </div>
        </>
      )}
      {view === "wheel" && (
        <>
          <div className="olx-ptr">
            <span>ходит</span>
            <i />
          </div>
          <div className="olx-wheel">
            {queue.slice(0, 6).map((f, i) => {
              const a = ((-90 + i * 60) * Math.PI) / 180;
              return (
                <div key={`${f.id}-${i}`} className="olx-spoke" style={{ left: `calc(50% + ${Math.cos(a) * 22}cqw)`, top: `calc(50% + ${Math.sin(a) * 22}cqw)` }}>
                  <FighterEmb f={f} size={i === 0 ? "5cqw" : "3.6cqw"} cur={i === 0 && !b.over} />
                </div>
              );
            })}
          </div>
          <FoeArt b={b} mode={mode} dmg={dmg} style={{ left: "36cqw", top: "15cqw", width: "28cqw" }} />
          <div className="olx-hpbox olx-hpbox--wheel" style={{ left: "3.5cqw", top: "3.5cqw", width: "27cqw" }}>
            <FoeHud b={b} />
          </div>
          <div className="olx-wlist">
            {b.fighters
              .filter((f) => f.side === "god")
              .map((f) => (
                <div key={f.id} className="olx-wlist__row">
                  <FighterEmb f={f} size="3cqw" cur={b.actor === f.id && !b.over} />
                  <div className="olx-mini__body">
                    <b>{f.name}</b>
                    <HpMini f={f} />
                  </div>
                </div>
              ))}
          </div>
          <div className="olx-logbox" style={{ left: "3.5cqw", bottom: "3.5cqw", width: "28cqw" }}>
            <FightLog b={b} title={title} />
          </div>
        </>
      )}
      {view === "frieze" && (
        <>
          <div className="olx-frieze">
            <span className="olx-kicker">Очередь · раунд {round}</span>
            {queue.slice(0, 6).map((f, i) => {
              const big = i === 0 && f.side === "god" && !b.over;
              const portrait = f.side === "god" ? portraitOf(f.ref) : null;
              return (
                <div key={`${f.id}-${i}`} className={`olx-frow${i === 0 && !b.over ? " is-cur" : ""}${big ? " is-big" : ""}${f.side === "foe" ? " is-enemy" : ""}`}>
                  <span className="olx-frow__num">{RANK_GREEK[i]}</span>
                  {big && portrait ? <img src={portrait} alt="" /> : <FighterEmb f={f} size={big ? "5cqw" : "3cqw"} cur={i === 0 && !b.over} />}
                  <div className="olx-mini__body">
                    <b>{f.side === "foe" ? foeOf(b.foe)?.name : f.name}</b>
                    {big && (
                      <small>
                        <NameText name={teamOf(session, f.id)} />
                      </small>
                    )}
                    <HpMini f={f} />
                    {big && <small>ходит сейчас</small>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="olx-logbox" style={{ right: "3cqw", top: "3cqw", width: "19cqw" }}>
            <FightLog b={b} title={title} />
          </div>
          <FoeArt b={b} mode={mode} dmg={dmg} style={{ left: "40cqw", top: "1cqw", width: "34cqw" }} />
          <div className="olx-hpbox" style={{ left: "34cqw", right: "5cqw", bottom: "4cqw" }}>
            <FoeHud b={b} wide />
          </div>
        </>
      )}
      {r.lastDie && !b.over && (
        <div className="olx-lastdie" key={`${r.lastDie.pid}-${r.lastDie.roll}-${b.turns}`} style={{ ["--oc" as string]: OUTCOME_COLORS[r.lastDie.outcome] }}>
          <b>{r.lastDie.roll}</b>
          <span>
            {godName(r, r.lastDie.pid)} · «{r.lastDie.ability}» · {OUTCOME_NAMES[r.lastDie.outcome]}
          </span>
        </div>
      )}
    </section>
  );
}

function FightEndView({ session, r, live }: { session: Session; r: OlympResult; live: boolean }) {
  const fe = r.fightEnd;
  const b = r.battle;
  const foe = b ? foeOf(b.foe) : undefined;
  useEffect(() => {
    if (!live || !fe) return;
    sfx(fe.win ? "win" : "fail");
    if (fe.win) burst(0.5, 0.4, ["#F3DFAE", "#E3C68C", "#fff"], 160);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!fe) return null;
  return (
    <section className={`olx-view olx-fightend${fe.win ? " is-win" : " is-lose"}`}>
      <div className="olx-rays" />
      <div className="olx-fightend__box">
        <span className="olx-kicker">{foe?.name}</span>
        <h2 className="olx-brand olx-brand--sm">
          <Letters text={fe.win ? "Победа!" : "Отряд отступает"} />
        </h2>
        {fe.win ? (
          <ul className="olx-awards">
            {r.order
              .filter((p) => r.party[p])
              .map((p) => (
                <li key={p}>
                  <GodEmb god={(r.party[p] as Member).god} size="4cqw" />
                  <span className="olx-awards__who">
                    <b>{godName(r, p)}</b>
                    <small>
                      <NameText name={teamOf(session, p)} />
                    </small>
                  </span>
                  <span className="olx-chip olx-chip--good">+{fe.xp[p] ?? 0} опыта</span>
                  {(fe.coins[p] ?? 0) > 0 && <span className="olx-chip olx-chip--gold">◉ {fe.coins[p]}</span>}
                </li>
              ))}
          </ul>
        ) : (
          <p className="olx-otext is-on">Наград нет. История продолжается — отряд залечивает раны.</p>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ концовка, награждение, финал

function EndView({ scene, r, content, live }: { scene: Scene; r: OlympResult; content: OlympContent; live: boolean }) {
  const ending = scene.kind === "end" ? scene.ending : "mid";
  useEffect(() => {
    if (!live) return;
    sfx(ending === "good" ? "win" : ending === "bad" ? "fail" : "mid");
    if (ending === "good") burst(0.5, 0.35, ["#F3DFAE", "#A3C2AA", "#fff"], 180);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <section className={`olx-view olx-end olx-end--${ending}`}>
      <div className="olx-rays" />
      <div className="olx-end__box">
        <span className="olx-kicker">{storyOf(content).title} · концовка</span>
        <h1 className="olx-story__title">
          <Letters text={scene.title} />
        </h1>
        <p className="olx-end__text">{scene.screen}</p>
        <div className="olx-team olx-team--end">
          {r.order
            .filter((p) => r.party[p])
            .map((p) => (
              <GodEmb key={p} god={(r.party[p] as Member).god} size="5cqw" />
            ))}
        </div>
      </div>
    </section>
  );
}

function PantheonView({ session, final }: { session: Session; final: boolean }) {
  return (
    <section className="olx-view olx-pantheon">
      <div className="olx-bg olx-bg--temple" />
      <div className="olx-rays" />
      <span className="olx-kicker olx-pantheon__k">{final ? "История окончена" : "Пантеон героев"}</span>
      <div className="olx-pantheon__podium">
        <Podium session={session} final={final} />
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ экран

export function OlympScreenView({ session, content }: ViewProps<OlympContent>) {
  const r = useMemo(() => parseOlympResult(session.state.result), [session.state.result]);
  const story = storyOf(content);
  const scene = currentScene(content, r);
  const place = scene ? placeOf(story, scene.place) : undefined;
  const { phase, stage } = session.state;
  const b = r.battle;
  // Экран открыт давно (а не только что): момент наступил при зрителях — играем анимацию и звук.
  // Экран, открытый посреди игры, показывает итог сразу.
  const mountedAt = useRef(Date.now());
  const live = Date.now() - mountedAt.current > 1500;

  let view: "lobby" | "pick" | "party" | "scene" | "roll" | "map" | "fight" | "fightEnd" | "end" | "podium" | "final";
  if (phase === "lobby") view = "lobby";
  else if (phase === "finished") view = "final";
  else if (stage === "podium") view = "podium";
  else if (r.order.length === 0 || r.phase === "pick") view = "pick";
  else if (r.phase === "party") view = "party";
  else if (r.phase === "fight" && b) view = "fight";
  else if (r.phase === "fightEnd" && r.fightEnd) view = "fightEnd";
  else if (r.phase === "check" && r.check?.roll !== null && r.check?.roll !== undefined) view = "roll";
  else if (r.phase === "vote") view = "map";
  else if (r.phase === "end") view = "end";
  else view = "scene";

  const ambient: Ambient =
    view === "lobby" || view === "pick" || view === "party" || view === "podium" || view === "final"
      ? "card"
      : view === "roll"
        ? "roll"
        : view === "map"
          ? "map"
          : view === "fight" || view === "fightEnd"
            ? foeOf(b?.foe ?? "")?.boss
              ? "boss"
              : "boss"
            : view === "end"
              ? scene?.kind === "end" && scene.ending === "bad"
                ? "boss"
                : "spring"
              : MUSIC_AMBIENT[place?.music ?? "olympus"];
  useAmbient(ambient);
  const fx: FxMode =
    view === "scene" || view === "end" ? WEATHER_FX[place?.weather ?? "snow"] : view === "map" ? "dust" : view === "fight" ? (place?.weather === "snow" ? "snow" : "embers") : view === "lobby" ? "snow" : "motes";

  let body: ReactNode = null;
  if (view === "lobby") body = <Lobby session={session} content={content} />;
  else if (view === "pick") body = <PickView session={session} r={r} />;
  else if (view === "party") body = <PartyView session={session} r={r} />;
  else if (view === "fight" && b) body = <FightView session={session} content={content} r={r} live={live} />;
  else if (view === "fightEnd") body = <FightEndView session={session} r={r} live={live} />;
  else if (view === "roll" && scene) body = <RollView session={session} r={r} scene={scene} place={place} live={live} />;
  else if (view === "map" && scene) body = <MapView session={session} content={content} r={r} scene={scene} place={place} />;
  else if (view === "end" && scene) body = <EndView scene={scene} r={r} content={content} live={live} />;
  else if (view === "podium" || view === "final") body = <PantheonView session={session} final={view === "final"} />;
  else if (scene) body = <SceneView session={session} content={content} r={r} scene={scene} place={place} />;

  return (
    <div className="olx">
      <div className="olx-stage">
        {body}
        <Fx mode={fx} />
        {view !== "lobby" && view !== "final" && (
          <span className="olx-code">
            Вход: {joinHint()} · код {formatSessionCode(session.code)}
          </span>
        )}
      </div>
    </div>
  );
}

/** Уровень и здоровье члена отряда — для телефона и пульта. */
export function memberLine(m: Member): string {
  return `${levelOf(m.xp).level}-й ур. · ${m.hp}/${hpMaxOfMember(m)}`;
}

export { ElChip };
