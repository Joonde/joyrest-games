// Пульт «Дурака». Пульт — главный: он тасует и раздаёт, проверяет каждый ход телефона по правилам
// (engine.ts), ходит за компьютерных игроков и по таймеру, шифрует руки ключами телефонов и пишет стол.
import { useEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "../../components/ConfirmDialog";
import { useHostRun } from "../../components/live/useHostRun";
import { PodiumHostList } from "../../components/live/Podium";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import { awardNow, podiumDone, podiumNext } from "../../core/podium";
import { resultKey, secondsLeft } from "../../core/session";
import type { Session, SessionChange } from "../../data/types";
import type { HostControlsProps } from "../types";
import { hostKey } from "../mafia/deal";
import { isKey, seal, unseal } from "../mafia/seal";
import { DECKS, deckTitle, isDeckStyle, maxSeats, type DurakContent } from "./content";
import { apply, botAction, cryptoRandom, deal, parseAction, timeoutActions, viewOf, waitingFor, type DurakAction, type Game } from "./engine";
import {
  abortParty,
  endVote,
  engineOptions,
  firstAttacker,
  keysFrom,
  lineFor,
  moreParties,
  nameOf,
  parseDurakResult,
  playChange,
  rejectChange,
  setDeck,
  startDeal,
  startVote,
  tallyOf,
  toggleBot,
  voteSync,
  voteWinner,
  type DurakResult,
  type HostPack,
} from "./logic";

const SUIT_WORD: Record<string, string> = { S: "пики", H: "червы", D: "бубны", C: "трефы" };

function rec(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** Руки — одной длины шифра: карта «10♥» на байт длиннее «A♥», по длине не угадать десятки в руке. */
const HAND_BYTES = 512;
const jsonBytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

async function sealHands(game: Game, keys: Record<string, string>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const hands = game.seats.map((pid) => ({ pid, hand: game.hands[pid] ?? [] }));
  const longest = Math.max(HAND_BYTES, ...hands.map((h) => jsonBytes({ hand: h.hand, _: "" })));
  for (const { pid, hand } of hands) {
    const key = keys[pid];
    if (key) out[pid] = await seal(key, { hand, _: ".".repeat(Math.max(0, longest - jsonBytes({ hand, _: "" }))) });
  }
  return out;
}

/** Ходы компьютера, пока он кому-то нужен. */
function runBots(game: Game, bots: Set<string>, session: Pick<Session, "leaderboard">): { game: Game; last: DurakResult["last"]; line: string | null; moved: boolean } {
  let g = game;
  let last: DurakResult["last"] = null;
  let line: string | null = null;
  let moved = false;
  for (let guard = 0; guard < 80 && !g.over; guard++) {
    const who = waitingFor(viewOf(g), g.hands).find((p) => bots.has(p));
    if (!who) break;
    const action = botAction(g, who);
    if (!action) break;
    const before = viewOf(g);
    const next = apply(g, who, action);
    if (typeof next === "string") break;
    g = next;
    moved = true;
    last = { pid: who, a: action.a, cards: cardsOf(action) };
    line = lineFor(session, who, action, before, viewOf(g)) || line;
  }
  return { game: g, last, line, moved };
}

function cardsOf(action: DurakAction): string[] {
  return action.a === "attack" || action.a === "transfer" ? action.c : action.a === "defend" ? [action.c] : [];
}

export function DurakHostControls({ session, content, answers, participants, control, rehearsal }: HostControlsProps<DurakContent>) {
  // Ходы меняют стол: касание ведущего по старому столу не повторяем — просим нажать ещё раз.
  const { busy, error, latest, run, quiet } = useHostRun(session, control, rehearsal, { moment: (s) => resultKey(s.state.result) });
  const [dialog, confirm] = useConfirm();
  const processed = useRef<Set<string>>(new Set());
  const timedOut = useRef<number | null>(null);
  // Фоновые записи (ходы телефонов и компьютера, таймер, голоса за колоду) — по одной, без «занято» на кнопках ведущего.
  const [bg, setBg] = useState(false);
  const bgRef = useRef(false);
  function background(make: (s: Session) => SessionChange | Promise<SessionChange | null> | null) {
    if (bgRef.current) return;
    bgRef.current = true;
    setBg(true);
    void quiet(make).finally(() => {
      bgRef.current = false;
      setBg(false);
    });
  }

  const { stage, step } = session.state;
  const r = parseDurakResult(session.state.result);
  const v = r.view;
  const started = session.state.result !== null && session.state.result !== undefined;
  const host = useMemo(() => hostKey(session.id), [session.id]);
  const now = useServerNow(500, stage === "question" && session.state.timeLimit !== null);
  const left = stage === "question" ? secondsLeft(session.state, now) : null;

  // Партия целиком — из hostSeal (ключ ведущего на этом устройстве).
  const [pack, setPack] = useState<HostPack | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    if (!r.hostSeal) {
      setPack(null);
      return;
    }
    void unseal(host, r.hostSeal).then((data) => {
      if (!alive) return;
      const d = rec(data);
      const game = d.game as Game | undefined;
      const keys: Record<string, string> = {};
      for (const [k, val] of Object.entries(rec(d.keys))) if (isKey(val)) keys[k] = val;
      setPack(game && Array.isArray(game.seats) ? { game, keys } : null);
    });
    return () => {
      alive = false;
    };
  }, [r.hostSeal, host]);

  /** Записать партию после ходов: стол всем, руки — ключами телефонов. */
  async function commit(g: Game, keys: Record<string, string>, patch: Partial<DurakResult>, base?: Session): Promise<SessionChange> {
    const sealed = await sealHands(g, keys);
    const hostSeal = await seal(host, { game: g, keys });
    return playChange(base ?? latest.current, content, viewOf(g), sealed, hostSeal, patch);
  }

  // ---------------------------------------------------------------- раздача

  const keys = keysFrom(answers, r.keysStep, isKey);

  async function doDeal(cur: Session): Promise<SessionChange | null> {
    const rr = parseDurakResult(cur.state.result);
    const seats = rr.seats;
    if (seats.length < 2) return null;
    const got = keysFrom(answers, rr.keysStep, isKey);
    const opts = engineOptions(content, seats);
    let g = deal(seats, { deck: content.deck, opts, first: firstAttacker(content, seats, rr.prevLoser) }, cryptoRandom);
    const bots = seats.filter((p) => !got[p]);
    const trumpWord = SUIT_WORD[g.trump] ?? "";
    let line = `Козырь — ${trumpWord}. Ходит ${nameOf(cur, g.attacker)}`;
    const auto = runBots(g, new Set(bots), cur);
    g = auto.game;
    if (auto.line) line = auto.line;
    return commit(g, got, { bots, line, last: auto.last }, cur);
  }

  /** Компьютер садится за стол (репетиция или не хватает игроков). */
  function addBot(): SessionChange {
    const cur = latest.current;
    const rr = parseDurakResult(cur.state.result);
    const id = `m${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
    const n = rr.seats.filter((p) => cur.leaderboard[p]?.name.startsWith("Компьютер")).length + 1;
    return {
      leaderboard: { [id]: { name: `Компьютер ${n}`, kind: cur.playMode === "teams" ? "team" : "player", score: 0 } },
      state: { result: { ...rr, seats: [...rr.seats, id] } },
    };
  }

  // ---------------------------------------------------------------- ходы телефонов

  const own = answers.filter((a) => a.step === step && parseAction(a.value) !== null);
  const answersKey = own.map((a) => `${a.pid}@${a.submittedAt ?? 0}`).join(",");

  useEffect(() => {
    if (!pack || busy || bg || r.mode !== "play" || !v || v.over || stage !== "question") return;
    const fresh = [...own].sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0)).filter((a) => !processed.current.has(`${step}:${a.pid}@${a.submittedAt ?? 0}`));
    if (fresh.length === 0) return;
    const cur = latest.current;
    const rr = parseDurakResult(cur.state.result);
    let g = pack.game;
    let last: DurakResult["last"] = null;
    let line: string | null = null;
    let reject: DurakResult["reject"] = null;
    let changed = false;
    for (const a of fresh) {
      processed.current.add(`${step}:${a.pid}@${a.submittedAt ?? 0}`);
      if (rr.bots.includes(a.pid)) continue;
      const action = parseAction(a.value);
      if (!action) continue;
      const before = viewOf(g);
      const next = apply(g, a.pid, action);
      if (typeof next === "string") {
        reject = { pid: a.pid, n: String(rec(a.value).n ?? ""), msg: next };
        continue;
      }
      g = next;
      changed = true;
      last = { pid: a.pid, a: action.a, cards: cardsOf(action) };
      line = lineFor(cur, a.pid, action, before, viewOf(g)) || line;
    }
    if (changed) {
      const auto = runBots(g, new Set(rr.bots), cur);
      g = auto.game;
      const patch: Partial<DurakResult> = { last: auto.last ?? last };
      const l = auto.line ?? line;
      if (l) patch.line = l;
      background((base) => commit(g, pack.keys, patch, base));
    } else if (reject) {
      const rejected = reject;
      background(() => rejectChange(cur, rejected));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- по новым ходам
  }, [answersKey, pack, busy, bg, r.mode, stage]);

  // Компьютер ходит сам (через секунду — чтобы на экране было видно).
  const botTurn = pack && r.mode === "play" && v && !v.over && stage === "question" ? waitingFor(viewOf(pack.game), pack.game.hands).some((p) => r.bots.includes(p)) : false;
  useEffect(() => {
    if (!botTurn || busy || bg || !pack) return;
    const t = window.setTimeout(() => {
      const cur = latest.current;
      const rr = parseDurakResult(cur.state.result);
      const auto = runBots(pack.game, new Set(rr.bots), cur);
      if (!auto.moved) return;
      const patch: Partial<DurakResult> = { last: auto.last };
      if (auto.line) patch.line = auto.line;
      background((base) => commit(auto.game, pack.keys, patch, base));
    }, 1100);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- по ходу
  }, [botTurn, busy, bg, pack, r.seq]);

  // Время хода вышло: защитник берёт, атакующий кладёт младшую карту, подкидывающие пасуют.
  useEffect(() => {
    if (left !== 0 || busy || bg || !pack || r.mode !== "play" || !v || v.over || timedOut.current === step) return;
    timedOut.current = step;
    const cur = latest.current;
    const rr = parseDurakResult(cur.state.result);
    let g = pack.game;
    let last: DurakResult["last"] = null;
    let line: string | null = null;
    for (const t of timeoutActions(g)) {
      const before = viewOf(g);
      const next = apply(g, t.pid, t.action);
      if (typeof next === "string") continue;
      g = next;
      last = { pid: t.pid, a: t.action.a, cards: cardsOf(t.action) };
      line = lineFor(cur, t.pid, t.action, before, viewOf(g)) || line;
    }
    const auto = runBots(g, new Set(rr.bots), cur);
    g = auto.game;
    const patch: Partial<DurakResult> = { last: auto.last ?? last };
    const l = auto.line ?? line;
    if (l) patch.line = `Время вышло. ${l}`;
    background((base) => commit(g, pack.keys, patch, base));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- по таймеру
  }, [left, busy, bg, pack, step]);

  // ---------------------------------------------------------------- голосование за колоду

  const votes = r.mode === "vote" ? tallyOf(answers, step) : null;
  const voteKey = votes ? JSON.stringify(votes) : "";
  useEffect(() => {
    if (!votes || busy || bg || !r.vote) return;
    if (votes.total === r.vote.total && JSON.stringify(votes.tally) === JSON.stringify(r.vote.tally)) return;
    const t = window.setTimeout(() => background((base) => voteSync(base, votes.tally, votes.total)), 700);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- по голосам
  }, [voteKey, busy, bg]);

  // ---------------------------------------------------------------- вид

  const name = (p: string | null) => nameOf(session, p);
  const waitingNow = v && !v.over ? waitingFor(v) : [];
  const unreadable = started && r.mode === "play" && pack === null;

  return (
    <div className="stack host-quiz dk-host">
      <p className="eyebrow">
        {content.variant === "perevodnoy" ? "Дурак переводной" : "Дурак подкидной"} · {content.deck} карт · партия {r.party}
        {content.parties > 0 ? ` из ${content.parties}` : ""} · колода «{deckTitle(r.deckStyle)}»
      </p>

      {stage === "podium" ? (
        <PodiumHostList session={session} />
      ) : !started ? (
        <p className="muted">
          Игроки заходят по QR-коду. «Собрать игроков» — все садятся за стол по порядку входа (мест по правилам: до {maxSeats(content)}). Каждый телефон получит свои карты, никто не увидит чужие.
        </p>
      ) : r.mode === "deal" ? (
        <div className="stack stack--tight">
          <p className="muted small">За столом {r.seats.length} из {maxSeats(content)}. Телефоны готовы: {Object.keys(keys).filter((p) => r.seats.includes(p)).length}. За места без телефона сыграет компьютер.</p>
          <ul className="dk-host__seats">
            {r.seats.map((p) => (
              <li key={p}>
                <NameText name={name(p)} /> <span className="muted small">{keys[p] ? "телефон готов" : "без телефона — компьютер"}</span>
              </li>
            ))}
          </ul>
          {r.waiting.length > 0 && <p className="muted small">Не поместились: {r.waiting.map(name).join(", ")} — откройте для них ещё один стол.</p>}
        </div>
      ) : r.mode === "vote" && r.vote ? (
        <div className="stack stack--tight">
          <p className="muted small">
            Голосование за колоду{left !== null ? ` · ${left} с` : ""} · проголосовали {r.vote.total}
          </p>
          <ul className="dk-host__seats">
            {DECKS.map((d) => (
              <li key={d.id}>
                {d.title} — <strong>{r.vote?.tally[d.id] ?? 0}</strong>
              </li>
            ))}
          </ul>
        </div>
      ) : v ? (
        <div className="stack stack--tight">
          {unreadable && (
            <p className="error" role="alert">
              Откройте пульт на том устройстве, где раздавали карты: этот пульт карт партии не знает, ходы ведите там. Здесь можно голосовать за колоду и завершить игру.
            </p>
          )}
          <p className="host-quiz__question">{r.line || "Игра идёт"}</p>
          {r.mode === "play" && !v.over && (
            <p className="muted small">
              Ждём: {waitingNow.map(name).join(", ") || "—"}
              {left !== null ? ` · ${left} с` : ""} · в колоде {v.deckLeft}, козырь {SUIT_WORD[v.trump]}
            </p>
          )}
          <ul className="dk-host__seats">
            {v.seats.map((p) => (
              <li key={p}>
                <span>
                  <NameText name={name(p)} /> · {v.out.includes(p) ? `вышел ${v.out.indexOf(p) + 1}-м` : `${v.counts[p] ?? 0} карт`}
                  {p === v.defender && !v.over ? " · отбивается" : p === v.attacker && !v.over ? " · ходит" : ""}
                </span>
                {r.mode === "play" && !v.over && !v.out.includes(p) && (
                  <button type="button" className="btn btn--quiet dk-host__bot" disabled={busy} onClick={() => void run((s) => toggleBot(s, p))}>
                    {r.bots.includes(p) ? "Вернуть игроку" : "Играет компьютер"}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {r.mode === "over" && (
            <p className="host-quiz__answer">
              {v.draw ? "Ничья!" : r.loser ? <>Дурак — <NameText name={name(r.loser)} />{v.pogony > 0 ? ` (погоны ×${v.pogony})` : ""}</> : "Партия остановлена"}
            </p>
          )}
        </div>
      ) : null}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="actions">
        {stage === "podium" ? (
          podiumDone(session) ? (
            <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => control.requestFinish()}>
              Завершить игру
            </button>
          ) : (
            <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run((s) => podiumNext(s))}>
              Открыть следующее место
            </button>
          )
        ) : !started ? (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run((s) => startDeal(s, participants, content))}>
            Собрать игроков за стол
          </button>
        ) : r.mode === "deal" ? (
          <>
            <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || r.seats.length < 2} onClick={() => void run(doDeal)}>
              {r.seats.length < 2 ? "Нужно хотя бы 2 игрока" : "Раздать карты"}
            </button>
            {r.seats.length < maxSeats(content) && (
              <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run(() => addBot())}>
                Посадить компьютер за стол
              </button>
            )}
            <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run((s) => startDeal(s, participants, content))}>
              Пересадить заново (новые гости)
            </button>
          </>
        ) : r.mode === "vote" ? (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run((s) => endVote(s, content, voteWinner(r.deckStyle, votes?.tally ?? r.vote?.tally ?? {})))}>
            Итог голосования — играем
          </button>
        ) : r.mode === "over" ? (
          moreParties(content, r) ? (
            <>
              <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run((s) => startDeal(s, participants, content))}>
                Следующая партия
              </button>
              <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run((s) => awardNow(s))}>
                Закончить и наградить
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run((s) => awardNow(s))}>
              Награждение
            </button>
          )
        ) : (
          <button type="button" className="btn btn--block host-quiz__primary" disabled>
            Игра идёт — ходы с телефонов
          </button>
        )}

        {started && stage !== "podium" && r.mode !== "vote" && (
          <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run((s) => startVote(s))}>
            Гости выбирают колоду (голосование)
          </button>
        )}
        {started && stage !== "podium" && (
          <label className="field dk-host__deck">
            Колода сейчас
            <select className="input" value={r.deckStyle} disabled={busy} onChange={(e) => {
                const style = e.target.value;
                if (isDeckStyle(style)) void run((s) => setDeck(s, style));
              }}>
              {DECKS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {started && r.mode === "play" && v && !v.over && (
          <button
            type="button"
            className="btn btn--quiet btn--block"
            disabled={busy}
            onClick={() =>
              confirm({
                title: "Остановить партию?",
                text: "Очков за эту партию никто не получит. Дальше — следующая партия или награждение.",
                confirmLabel: "Остановить партию",
                run: () => run((s) => abortParty(s)),
              })
            }
          >
            Остановить партию досрочно
          </button>
        )}
      </div>
      {dialog}
    </div>
  );
}
