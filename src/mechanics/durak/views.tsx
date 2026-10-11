// «Дурак»: экран зала — стол с крупье, места игроков с веером рубашек, колода с козырем, бой и бито;
// телефон — своя рука веером (касание поднимает карту), мини-стол и кнопки хода.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Confetti } from "../../components/live/Confetti";
import { playSound } from "../../components/live/sound";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import { acceptsAnswers, secondsLeft } from "../../core/session";
import type { PlayerViewProps, ViewProps } from "../types";
import { isKey, newKey, storedKey, storeKey, unseal } from "../mafia/seal";
import { BackFan, CardArt, CROUPIER_ART, suitGlyph } from "./CardArt";
import { DECKS, deckTitle, isDeckStyle, type DeckStyle, type DurakContent } from "./content";
import { beats, canTransfer, isCard, playable, rankOf, room, sortHand, suitOf, throwers, uncovered, type DurakAction, type Suit, type TableView } from "./engine";
import { nameOf, parseDurakResult, type DurakAnswerValue, type DurakResult } from "./logic";

const FELT: Record<DurakContent["table"], string> = {
  emerald: "dk-felt--emerald",
  bordeaux: "dk-felt--bordeaux",
  night: "dk-felt--night",
  graphite: "dk-felt--graphite",
};

function partyLabel(content: DurakContent, r: DurakResult): string {
  if (content.parties === 0) return `партия ${r.party}`;
  return content.parties > 1 ? `партия ${r.party} из ${content.parties}` : "";
}

const SUIT_WORD: Record<Suit, string> = { S: "пики", H: "червы", D: "бубны", C: "трефы" };
const isTrump = (card: string, trump: Suit) => suitOf(card) === trump;

/** Рука в несколько рядов: в ряду не больше 10 карт, иначе на телефоне их не различить. */
const ROW_MAX = 10;
function handRows(cards: string[]): string[][] {
  if (cards.length <= ROW_MAX) return [cards];
  const rows = Math.ceil(cards.length / ROW_MAX);
  const per = Math.ceil(cards.length / rows);
  return Array.from({ length: rows }, (_, i) => cards.slice(i * per, (i + 1) * per)).filter((row) => row.length > 0);
}

function titleOf(content: DurakContent): string {
  return content.variant === "perevodnoy" ? "Дурак переводной" : "Дурак подкидной";
}

/** Что делает игрок сейчас (подпись на месте). */
function statusOf(v: TableView, pid: string, r: DurakResult): { text: string; kind: "turn" | "defend" | "take" | "out" | "wait" | "throw" } {
  const place = v.out.indexOf(pid);
  if (place >= 0) return { text: `Вышел ${place + 1}-м`, kind: "out" };
  if (v.over) return { text: v.loser === pid ? "Дурак" : "", kind: "wait" };
  if (pid === v.defender) return v.taking ? { text: "Берёт", kind: "take" } : { text: v.table.length === 0 ? "Отбивается" : "Бьётся", kind: "defend" };
  if (v.table.length === 0 && pid === v.attacker) return { text: "Ходит", kind: "turn" };
  if (v.table.length > 0 && throwers(v).includes(pid) && !v.passed.includes(pid) && room(v) > 0) return { text: pid === v.attacker ? "Ходит" : "Может подкинуть", kind: "throw" };
  return { text: r.bots.includes(pid) ? "Компьютер" : "", kind: "wait" };
}

function useSoundOnChange(value: string, sound: Parameters<typeof playSound>[0]) {
  const prev = useRef(value);
  useEffect(() => {
    if (value && value !== prev.current) playSound(sound);
    prev.current = value;
  }, [value, sound]);
}

/** Позиция места за столом: эллипс, первое место снизу слева, по часовой. */
function seatPos(i: number, n: number): { x: number; y: number } {
  const a = ((90 + ((i + 0.5) * 360) / n) * Math.PI) / 180;
  return { x: 50 + 41 * Math.cos(a), y: 53 + 36 * Math.sin(a) };
}

// ---------------------------------------------------------------- экран зала

export function DurakScreenView({ session, content }: ViewProps<DurakContent>) {
  const r = parseDurakResult(session.state.result);
  const v = r.view;
  const deck = r.deckStyle;
  const now = useServerNow(250, session.state.stage === "question" && session.state.timeLimit !== null);
  const left = session.state.stage === "question" ? secondsLeft(session.state, now) : null;
  useSoundOnChange(r.mode === "play" && r.last ? `${r.seq}` : "", "whoosh");
  useSoundOnChange(r.mode === "over" ? `${r.party}:over` : "", "fanfare");
  const seats = v?.seats ?? r.seats;
  const n = Math.max(seats.length, 2);
  const lastFrom = useMemo(() => {
    if (!r.last) return null;
    const i = seats.indexOf(r.last.pid);
    if (i < 0) return null;
    const p = seatPos(i, n);
    return { x: (p.x - 50) * 1.6, y: (p.y - 50) * 0.9 };
  }, [r.last, seats, n]);

  return (
    <div className={`dk-hall ${FELT[content.table]}`}>
      <div className="dk-hall__top">
        <div className="dk-croupier">
          <img src={CROUPIER_ART} alt="Крупье" className="dk-croupier__img" />
          {r.line && (
            <p className="dk-croupier__line" key={r.line + r.seq}>
              {r.line}
            </p>
          )}
        </div>
        <div className="dk-hall__title">
          <span>{titleOf(content)}</span>
          <small>
            {[partyLabel(content, r), content.deck === 52 ? "52 карты" : "36 карт", v?.opts.partners ? "партнёры" : "", deckTitle(deck)].filter(Boolean).join(" · ")}
          </small>
        </div>
      </div>

      <div className="dk-table">
        <div className="dk-table__rail">
          <div className="dk-table__felt">
            <span className="dk-table__light" aria-hidden="true" />
            <span className="dk-table__inlay" aria-hidden="true" />
            <span className="dk-table__logo" aria-hidden="true">
              J✦R<small>JOYREST</small>
            </span>
            {r.mode === "deal" || !v ? (
              <div className="dk-shuffle" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                  <CardArt key={i} card={null} deck={deck} width="9cqh" className={`dk-shuffle__card dk-shuffle__card--${i}`} />
                ))}
              </div>
            ) : (
              <>
                <div className="dk-stock">
                  {v.deckLeft > 0 && <CardArt card={v.trumpCard} deck={deck} width="9cqh" trump className="dk-stock__trump" />}
                  {v.deckLeft > 1 && <CardArt card={null} deck={deck} width="9cqh" className="dk-stock__deck" />}
                  <span className="dk-stock__label">
                    {v.deckLeft > 0 ? "Колода" : "Колода пуста"}
                    <b className={`dk-stock__suit${v.trump === "H" || v.trump === "D" ? " is-red" : ""}`}>
                      Козырь <span>{suitGlyph(v.trumpCard)}</span>
                    </b>
                  </span>
                </div>
                <div className="dk-battle">
                  {v.table.map((p) => {
                    const fresh = r.last && r.last.cards.includes(p.a) && (r.last.a === "attack" || r.last.a === "transfer");
                    const freshD = r.last && p.d !== null && r.last.cards.includes(p.d);
                    const fly = lastFrom ? ({ "--fx": `${lastFrom.x}cqw`, "--fy": `${lastFrom.y}cqh` } as CSSProperties) : undefined;
                    return (
                      <div className="dk-pair" key={p.a}>
                        <CardArt card={p.a} deck={deck} width="11cqh" trump={isTrump(p.a, v.trump)} className={fresh ? "dk-fly" : undefined} style={fresh ? fly : undefined} />
                        {p.d && <CardArt card={p.d} deck={deck} width="11cqh" trump={isTrump(p.d, v.trump)} className={`dk-pair__d${freshD ? " dk-fly" : ""}`} style={freshD ? fly : undefined} />}
                      </div>
                    );
                  })}
                  {v.table.length === 0 && !v.over && (
                    <p className="dk-battle__hint">
                      Ходит <NameText name={nameOf(session, v.attacker)} /> под <NameText name={nameOf(session, v.defender)} />
                    </p>
                  )}
                </div>
                <div className="dk-bito">
                  {v.discard > 0 && (
                    <>
                      <CardArt card={null} deck={deck} width="8cqh" style={{ transform: "rotate(-16deg)" }} />
                      <CardArt card={null} deck={deck} width="8cqh" style={{ transform: "rotate(9deg)", marginLeft: "-7cqh" }} />
                    </>
                  )}
                  <span className="dk-stock__label">Бито · {v.discard}</span>
                </div>
              </>
            )}
          </div>
        </div>

        {seats.map((pid, i) => {
          const p = seatPos(i, n);
          const st = v ? statusOf(v, pid, r) : { text: r.keysStep !== null ? "За столом" : "", kind: "wait" as const };
          const active = st.kind === "turn" || st.kind === "defend";
          const team = v?.opts.partners?.findIndex((g) => g.includes(pid)) ?? -1;
          return (
            <div
              key={pid}
              className={`dk-seat dk-seat--${st.kind}${active ? " is-active" : ""}${v?.loser === pid ? " is-fool" : ""}`}
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
            >
              {v && !v.out.includes(pid) && <BackFan count={v.counts[pid] ?? 0} deck={deck} width="4cqh" />}
              <div className="dk-seat__card">
                <span className={`dk-seat__avatar${team >= 0 ? ` dk-team--${team}` : ""}`}>{(nameOf(session, pid).replace(/^\P{L}+/u, "")[0] ?? "?").toUpperCase()}</span>
                <span className="dk-seat__text">
                  <span className="dk-seat__name">
                    <NameText name={nameOf(session, pid)} />
                  </span>
                  <span className="dk-seat__meta">{v && !v.out.includes(pid) ? `${v.counts[pid] ?? 0} карт` : ""}</span>
                </span>
                {st.text && <span className="dk-seat__status">{st.text}</span>}
              </div>
              {active && left !== null && (
                <span className="dk-seat__timer" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, (left / Math.max(1, session.state.timeLimit ?? 1)) * 100)}%` }} />
                </span>
              )}
            </div>
          );
        })}
      </div>

      {r.waiting.length > 0 && r.mode !== "over" && (
        <p className="dk-hall__waiting">
          Мест за столом нет: {r.waiting.map((p) => nameOf(session, p)).join(", ")} — сыграете в следующем столе
        </p>
      )}

      {r.mode === "vote" && r.vote && <DeckVoteScreen r={r} left={left} />}

      {r.mode === "over" && session.state.stage !== "podium" && (
        <div className="dk-over" role="status">
          <Confetti burst={`dk-${r.party}`} />
          <p className="dk-over__eyebrow">Итог партии</p>
          <h2 className="dk-over__title">{v?.draw ? "Ничья — дураков нет!" : r.loser ? <>Дурак — <NameText name={nameOf(session, r.loser)} /></> : "Партия остановлена"}</h2>
          {v && v.pogony > 0 && r.loser && <p className="dk-over__pogony">с погонами ×{v.pogony}</p>}
          {r.places.length > 0 && (
            <ol className="dk-over__places">
              {r.places.map((pid, i) => (
                <li key={pid}>
                  <span>{i + 1}</span> <NameText name={nameOf(session, pid)} />
                  {session.leaderboard[pid]?.last ? <b>+{session.leaderboard[pid]?.last}</b> : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function DeckVoteScreen({ r, left }: { r: DurakResult; left: number | null }) {
  const vote = r.vote;
  if (!vote) return null;
  const top = Math.max(0, ...Object.values(vote.tally));
  return (
    <div className="dk-vote">
      <div className="dk-vote__head">
        <h2>Какой колодой играем?</h2>
        <p>Голосуйте на телефонах{left !== null ? ` · ${left} с` : ""} · проголосовали {vote.total}</p>
      </div>
      <div className="dk-vote__grid">
        {DECKS.map((d) => {
          const n = vote.tally[d.id] ?? 0;
          const pct = vote.total > 0 ? Math.round((n / vote.total) * 100) : 0;
          return (
            <div key={d.id} className={`dk-vote__tile${n > 0 && n === top ? " is-lead" : ""}${r.deckStyle === d.id ? " is-current" : ""}`}>
              <CardArt card={null} deck={d.id} width="12cqh" className="dk-bob" />
              <CardArt card="KH" deck={d.id} width="7cqh" className="dk-vote__face" />
              <span className="dk-vote__name">{d.title}</span>
              <span className="dk-vote__bar">
                <span style={{ width: `${pct}%` }} />
              </span>
              <span className="dk-vote__pct">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- телефон

function rec(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** Рука телефона: открыть своим ключом. */
function useHand(key: string | null, sealed: string | undefined): string[] | null | undefined {
  const [hand, setHand] = useState<string[] | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    if (!sealed) {
      setHand(undefined);
      return;
    }
    if (!key) {
      setHand(null);
      return;
    }
    void unseal(key, sealed).then((data) => {
      if (!alive) return;
      const cards = rec(data).hand;
      setHand(Array.isArray(cards) ? cards.filter(isCard) : null);
    });
    return () => {
      alive = false;
    };
  }, [key, sealed]);
  return hand;
}

function nonce(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function DurakPlayerView({ session, content, pid, role, myAnswer, sending, onAnswer }: PlayerViewProps<DurakContent, DurakAnswerValue>) {
  const r = parseDurakResult(session.state.result);
  const v = r.view;
  const { stage } = session.state;
  const [key, setKey] = useState<string | null>(() => storedKey(session.id, pid));
  const [noCrypto, setNoCrypto] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [target, setTarget] = useState<number | null>(null);
  const [sent, setSent] = useState<{ n: string; seq: number } | null>(null);
  // Перетаскивание карты на стол: карта летит за пальцем, отпустили над картой стола — покрыть её.
  const [drag, setDrag] = useState<{ card: string; x: number; y: number; over: number | "table" | null } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const dragRef = useRef<{ card: string; x0: number; y0: number; moved: boolean } | null>(null);
  const skipClick = useRef(false);
  const seated = r.seats.includes(pid);
  const dealing = r.mode === "deal" && stage === "question" && seated && role !== "member";
  const now = useServerNow(500, stage === "question");
  const open = acceptsAnswers(session.state, now);
  const left = stage === "question" ? secondsLeft(session.state, now) : null;

  // Раздача: телефон сам создаёт ключ и отправляет ведущему (как карты ролей в «Мафии»).
  useEffect(() => {
    if (!dealing || myAnswer === undefined || sending) return;
    const got = myAnswer ? rec(myAnswer.value).key : null;
    if (isKey(got)) {
      if (got !== key) {
        storeKey(session.id, pid, got);
        setKey(got);
      }
      return;
    }
    if (myAnswer) return;
    try {
      const k = key ?? newKey();
      storeKey(session.id, pid, k);
      setKey(k);
      onAnswer({ key: k });
    } catch {
      setNoCrypto(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только по ответу шага
  }, [dealing, myAnswer, sending]);

  const hand = useHand(key, r.sealed[pid]);
  const sorted = useMemo(() => (hand && v ? sortHand(hand, v.trump) : (hand ?? [])), [hand, v]);
  // Новый ход — выбор сбрасывается.
  useEffect(() => {
    setPicked([]);
    setTarget(null);
    setHint(null);
    setDrag(null);
    dragRef.current = null;
  }, [r.seq, r.mode]);

  const head = (
    <p className="eyebrow">
      {titleOf(content)}
      {partyLabel(content, r) ? ` · ${partyLabel(content, r)}` : ""}
      
    </p>
  );

  if (r.mode === "vote" && r.vote) return <DeckVotePhone r={r} left={left} open={open} myAnswer={myAnswer} onAnswer={onAnswer} head={head} />;

  if (r.seats.length === 0) {
    return (
      <div className="quiz-phone quiz-phone--center dk-phone">
        {head}
        <h2>Скоро раздача</h2>
        <p className="muted">Карты придут на этот телефон. Держите его так, чтобы соседи не видели.</p>
      </div>
    );
  }
  if (!seated) {
    return (
      <div className="quiz-phone quiz-phone--center dk-phone">
        {head}
        <h2>{r.waiting.includes(pid) ? "Мест за столом нет" : "Партия уже идёт"}</h2>
        <p className="muted">Смотрите на экран — сыграете в следующей партии или за следующим столом.</p>
      </div>
    );
  }
  if (role === "member") {
    return (
      <div className="quiz-phone quiz-phone--center dk-phone">
        {head}
        <h2>Карты у капитана</h2>
        <p className="muted">Ходит капитан вашего столика. Подсказывайте ему — и следите за экраном.</p>
        {v && <TrumpBar v={v} />}
        {v && <MiniTable v={v} deck={r.deckStyle} target={null} onTarget={() => undefined} />}
      </div>
    );
  }
  if (r.mode === "deal" || !v) {
    return (
      <div className="quiz-phone quiz-phone--center dk-phone">
        {head}
        <div className="dk-phone__deal">
          <BackFan count={5} deck={r.deckStyle} width="64px" />
        </div>
        <h2>{noCrypto ? "Этот браузер не умеет тайные карты" : myAnswer ? "Телефон готов — ждём раздачу" : "Готовим ваш телефон…"}</h2>
        {noCrypto && <p className="muted">Обновите браузер или скажите ведущему — за вас сыграет компьютер.</p>}
      </div>
    );
  }

  const me = statusOf(v, pid, r);
  const isDefender = pid === v.defender && !v.taking && !v.over;
  const openPairs = uncovered(v);
  // Подсветка — только когда от игрока ждут хода: в чужой ход рука не гаснет.
  const acting = !v.over && (pid === v.defender || pid === v.attacker || throwers(v).includes(pid));
  const canPlay = content.highlight && acting ? new Set(playable(v, pid, sorted)) : null;
  const pending = sent !== null && sent.seq === r.seq && (sending || myAnswer !== null);
  const rejected = r.reject && r.reject.pid === pid && sent && r.reject.n === sent.n ? r.reject.msg : null;
  const bot = r.bots.includes(pid);

  function send(action: DurakAction) {
    const n = nonce();
    setSent({ n, seq: r.seq });
    onAnswer({ ...action, n });
  }

  function toggle(card: string) {
    if (isDefender && v && v.table.length > 0) {
      // Защитник выбирает одну карту (или несколько одного достоинства — для перевода).
      setPicked((cur) => (cur.includes(card) ? cur.filter((c) => c !== card) : cur.length > 0 && rankOf(cur[0] as string) === rankOf(card) && canTransfer(v, pid, [...cur, card]) ? [...cur, card] : [card]));
      return;
    }
    setPicked((cur) => {
      if (cur.includes(card)) return cur.filter((c) => c !== card);
      // Первым ходом — только одного достоинства.
      if (v && v.table.length === 0 && cur.length > 0 && rankOf(cur[0] as string) !== rankOf(card)) return [card];
      return [...cur, card];
    });
  }

  const defendTarget = target ?? (openPairs.length === 1 ? (openPairs[0] as number) : null);
  const oneCard = picked.length === 1 ? (picked[0] as string) : null;
  const canCover = isDefender && oneCard !== null && defendTarget !== null && v.table[defendTarget] !== undefined && beats((v.table[defendTarget] as { a: string }).a, oneCard, v.trump, v.opts.spades);
  const transferOk = isDefender && picked.length > 0 && canTransfer(v, pid, picked);
  const attackStart = v.table.length === 0 && pid === v.attacker && picked.length > 0;
  const canThrowNow = v.table.length > 0 && pid !== v.defender && throwers(v).includes(pid) && room(v) > 0;
  const throwOk = canThrowNow && picked.length > 0 && picked.every((c) => playable(v, pid, sorted).includes(c)) && picked.length <= room(v);
  const allCovered = v.table.length > 0 && openPairs.length === 0;
  const canPass = v.table.length > 0 && pid !== v.defender && throwers(v).includes(pid) && !v.passed.includes(pid) && (allCovered || v.taking);
  const canDrag = open && !v.over && !pending && !bot && ((isDefender && v.table.length > 0) || (v.table.length === 0 && pid === v.attacker) || canThrowNow);
  // Куда можно положить тащимую карту: открытые карты стола, которые она бьёт.
  const beatable = drag && isDefender ? new Set(openPairs.filter((i) => beats((v.table[i] as { a: string }).a, drag.card, v.trump, v.opts.spades))) : null;

  function dropAt(x: number, y: number): number | "table" | null {
    const el = document.elementFromPoint(x, y);
    const pair = el?.closest<HTMLElement>("[data-pair]");
    if (pair) return Number(pair.dataset.pair);
    return el?.closest(".dk-mini") ? "table" : null;
  }

  function drop(card: string, at: number | "table" | null) {
    if (!v || at === null) return;
    if (isDefender) {
      if (typeof at === "number") {
        const pair = v.table[at];
        if (pair && pair.d === null && beats(pair.a, card, v.trump, v.opts.spades)) send({ a: "defend", c: card, t: at });
        else setHint(pair && pair.d !== null ? "Эта карта уже покрыта" : "Этой картой её не побить");
        return;
      }
      if (v.opts.transfer && canTransfer(v, pid, [card])) send({ a: "transfer", c: [card] });
      else setHint("Перетащите карту на ту, которую бьёте");
      return;
    }
    // Ход и подкидывание: тащили выбранную карту — уходят все выбранные (одного достоинства).
    const cards = picked.includes(card) && picked.length > 1 ? picked : [card];
    if (v.table.length === 0 && pid === v.attacker) {
      if (cards.every((c) => rankOf(c) === rankOf(card))) send({ a: "attack", c: cards });
      return;
    }
    const ok = playable(v, pid, sorted);
    if (canThrowNow && cards.every((c) => ok.includes(c)) && cards.length <= room(v)) send({ a: "attack", c: cards });
    else setHint("Подкинуть можно только карту того же достоинства, что на столе");
  }

  function onDown(e: ReactPointerEvent<HTMLButtonElement>, card: string) {
    if (!canDrag || (e.pointerType === "mouse" && e.button !== 0)) return;
    dragRef.current = { card, x0: e.clientX, y0: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 10) return;
    d.moved = true;
    setDrag({ card: d.card, x: e.clientX, y: e.clientY, over: dropAt(e.clientX, e.clientY) });
  }
  function onUp(e: ReactPointerEvent<HTMLButtonElement>) {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || !d.moved) return;
    skipClick.current = true;
    setDrag(null);
    drop(d.card, dropAt(e.clientX, e.clientY));
  }
  function onCancel() {
    dragRef.current = null;
    setDrag(null);
  }

  const rows = handRows(sorted);

  return (
    <div className={`quiz-phone dk-phone ${FELT[content.table]}`}>
      {head}
      <div className="dk-phone__opps">
        {v.seats
          .filter((p) => p !== pid)
          .map((p) => {
            const st = statusOf(v, p, r);
            return (
              <span key={p} className={`dk-opp dk-opp--${st.kind}`}>
                <span className="dk-opp__name">
                  <NameText name={nameOf(session, p)} />
                </span>
                <span className="dk-opp__n">{v.out.includes(p) ? "вышел" : `${v.counts[p] ?? 0} карт`}</span>
              </span>
            );
          })}
      </div>

      <TrumpBar v={v} />

      <MiniTable
        v={v}
        deck={r.deckStyle}
        target={isDefender && openPairs.length > 1 ? defendTarget : null}
        onTarget={(i) => setTarget(i)}
        beatable={beatable}
        over={drag?.over ?? null}
        dropping={drag !== null}
      />

      <p className={`dk-phone__status dk-phone__status--${me.kind}`} aria-live="polite">
        {v.over
          ? v.loser === pid
            ? "Вы — дурак в этой партии"
            : v.draw
              ? "Ничья!"
              : `Вы вышли ${v.out.indexOf(pid) + 1}-м`
          : bot
            ? "За вас играет компьютер — скажите ведущему, если вернулись"
            : isDefender
              ? openPairs.length > 1
                ? "Перетащите свою карту на ту, которую бьёте — или берите"
                : "Отбивайтесь: перетащите карту на стол — или берите"
              : v.table.length === 0 && pid === v.attacker
                ? `Ваш ход под ${nameOf(session, v.defender)}: перетащите карту на стол`
                : canPass
                  ? v.taking
                    ? "Защитник берёт — можно подкинуть вдогонку"
                    : "Всё покрыто — подкиньте или «Бито»"
                  : me.text || "Ждём ход"}
        {left !== null && !v.over && (me.kind === "turn" || me.kind === "defend" || canPass) ? ` · ${left} с` : ""}
      </p>
      {(rejected || hint) && (
        <p className="error" role="alert">
          {rejected ?? hint}
        </p>
      )}

      <div className={`dk-hand${rows.length > 1 ? " dk-hand--rows" : ""}${canDrag ? " is-draggable" : ""}`} role="group" aria-label="Ваши карты">
        {hand === null && <p className="buzz__plate">Карты не открыть на этом телефоне — скажите ведущему.</p>}
        {rows.map((row, ri) => (
          <div key={ri} className="dk-hand__row" style={{ "--n": Math.max(1, row.length - 1) } as CSSProperties}>
            {row.map((c, i) => {
              const k = row.length;
              const off = i - (k - 1) / 2;
              // В несколько рядов карты лежат ровно: наклон веера поднимал крайние над соседним рядом.
              const spread = rows.length > 1 ? 0 : Math.min(9, 60 / Math.max(1, k));
              const dim = canPlay !== null && !canPlay.has(c);
              const sel = picked.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  className={`dk-hand__slot${sel ? " is-picked" : ""}${dim ? " is-dim" : ""}${drag?.card === c ? " is-dragging" : ""}`}
                  style={{ "--off": off, "--rot": `${off * spread}deg`, "--lift": `${rows.length > 1 ? 0 : Math.abs(off) ** 1.6 * 2.2}px`, zIndex: i + 1 } as CSSProperties}
                  onClick={() => {
                    if (skipClick.current) {
                      skipClick.current = false;
                      return;
                    }
                    setHint(null);
                    toggle(c);
                  }}
                  onPointerDown={(e) => onDown(e, c)}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  onPointerCancel={onCancel}
                  aria-pressed={sel}
                  disabled={v.over || pending || bot}
                >
                  <CardArt card={c} deck={r.deckStyle} width="var(--cw)" trump={isTrump(c, v.trump)} />
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {drag && (
        <div className="dk-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          <CardArt card={drag.card} deck={r.deckStyle} width="var(--cw)" trump={isTrump(drag.card, v.trump)} />
        </div>
      )}

      {!v.over && !bot && (
        <div className="dk-phone__actions">
          {isDefender && v.table.length > 0 && (
            <button type="button" className="btn btn--secondary" disabled={!open || pending} onClick={() => send({ a: "take" })}>
              Взять
            </button>
          )}
          {isDefender && v.opts.transfer && v.table.length > 0 && (
            <button type="button" className="btn btn--secondary" disabled={!open || pending || !transferOk} onClick={() => send({ a: "transfer", c: picked })}>
              Перевести
            </button>
          )}
          {isDefender && v.table.length > 0 && (
            <button type="button" className="btn" disabled={!open || pending || !canCover} onClick={() => oneCard && defendTarget !== null && send({ a: "defend", c: oneCard, t: defendTarget })}>
              Покрыть
            </button>
          )}
          {v.table.length === 0 && pid === v.attacker && (
            <button type="button" className="btn" disabled={!open || pending || !attackStart} onClick={() => send({ a: "attack", c: picked })}>
              {picked.length > 1 ? `Ходить (${picked.length})` : "Ходить"}
            </button>
          )}
          {canThrowNow && (
            <button type="button" className="btn btn--secondary" disabled={!open || pending || !throwOk} onClick={() => send({ a: "attack", c: picked })}>
              Подкинуть
            </button>
          )}
          {canPass && (
            <button type="button" className="btn" disabled={!open || pending} onClick={() => send({ a: "pass" })}>
              {v.taking ? "Больше не подкидываю" : pid === v.attacker ? "Бито" : "Пас"}
            </button>
          )}
        </div>
      )}
      {pending && <p className="muted small dk-phone__pending">Отправлено — ждём крупье…</p>}
    </div>
  );
}

/** Козырь крупно: масть и слово, без счёта карт в колоде (это упрощало бы игру). */
function TrumpBar({ v }: { v: TableView }) {
  const red = v.trump === "H" || v.trump === "D";
  return (
    <p className={`dk-trumpbar${red ? " is-red" : ""}`}>
      <span className="dk-trumpbar__glyph" aria-hidden="true">
        {suitGlyph(v.trumpCard)}
      </span>
      <span>
        Козырь — <b>{SUIT_WORD[v.trump]}</b>
        <small>{v.deckLeft > 0 ? "козыри в руке — с золотой рамкой ★" : "колода пуста"}</small>
      </span>
    </p>
  );
}

function MiniTable({
  v,
  deck,
  target,
  onTarget,
  beatable = null,
  over = null,
  dropping = false,
}: {
  v: TableView;
  deck: DeckStyle;
  target: number | null;
  onTarget: (i: number) => void;
  beatable?: Set<number> | null;
  over?: number | "table" | null;
  dropping?: boolean;
}) {
  if (v.table.length === 0) {
    return (
      <div className={`dk-mini dk-mini--empty${dropping ? " is-drop" : ""}${over === "table" ? " is-over" : ""}`}>
        <span className="muted small">{dropping ? "Отпустите карту здесь" : "Стол пуст"}</span>
      </div>
    );
  }
  return (
    <div className={`dk-mini${dropping ? " is-drop" : ""}${over === "table" ? " is-over" : ""}`} role="group" aria-label="Карты на столе">
      {v.table.map((p, i) => {
        const inner = (
          <>
            <CardArt card={p.a} deck={deck} width="var(--mw)" trump={isTrump(p.a, v.trump)} />
            {p.d && <CardArt card={p.d} deck={deck} width="var(--mw)" trump={isTrump(p.d, v.trump)} className="dk-mini__d" />}
          </>
        );
        const cls = `dk-mini__pair${p.d === null ? " is-open" : ""}${target === i ? " is-target" : ""}${beatable?.has(i) ? " is-beatable" : ""}${over === i ? " is-over" : ""}${beatable && p.d === null && !beatable.has(i) ? " is-no" : ""}`;
        return target !== null && p.d === null ? (
          <button key={p.a} type="button" data-pair={i} className={cls} onClick={() => onTarget(i)} aria-pressed={target === i}>
            {inner}
          </button>
        ) : (
          <span key={p.a} data-pair={p.d === null ? i : undefined} className={cls}>
            {inner}
          </span>
        );
      })}
    </div>
  );
}

function DeckVotePhone({ r, left, open, myAnswer, onAnswer, head }: { r: DurakResult; left: number | null; open: boolean; myAnswer: { value: unknown } | null | undefined; onAnswer: (v: DurakAnswerValue) => void; head: ReactNode }) {
  const mine = myAnswer ? rec(myAnswer.value).deck : null;
  const [choice, setChoice] = useState<DeckStyle | null>(isDeckStyle(mine) ? mine : null);
  return (
    <div className="quiz-phone dk-phone">
      {head}
      <h2>Выберите колоду{left !== null ? ` · ${left} с` : ""}</h2>
      <p className="muted small">Один голос, до конца таймера можно передумать.</p>
      <div className="dk-vote-phone">
        {DECKS.map((d) => (
          <button
            key={d.id}
            type="button"
            className={`dk-vote-phone__opt${choice === d.id ? " is-picked" : ""}`}
            aria-pressed={choice === d.id}
            disabled={!open}
            onClick={() => {
              setChoice(d.id);
              onAnswer({ deck: d.id });
            }}
          >
            <CardArt card={null} deck={d.id} width="58px" />
            <span>{d.title}</span>
          </button>
        ))}
      </div>
      <p className="muted small">{isDeckStyle(mine) ? `Ваш голос: ${deckTitle(mine)}` : "Коснитесь колоды"}</p>
      <p className="muted small">Сейчас: {deckTitle(r.deckStyle)}</p>
    </div>
  );
}
