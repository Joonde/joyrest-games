/**
 * Предпросмотр и «Репетиция» «Бубликатора» (Блок 2d): игра идёт в комнате в памяти (`room.ts`, правила те же, что у сервера) с
 * тестовыми гостями-ботами. Экран зала, телефон и пульт — настоящие компоненты игры. В предпросмотре ведущего играет автопилот
 * (можно выключить и нажимать самому), время по желанию ускорено; в репетиции кнопки пульта нажимает ведущий.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Tabs } from "../../../components/Tabs";
import type { RoomPreviewProps } from "../../types";
import { BublikatorHost } from "../host/Host";
import { BublikatorPhone } from "../phone/Phone";
import { BublikatorScreen } from "../screen/Screen";
import type { BubContent } from "../rules/types";
import { autopilot, SIM_VIEWER, SimRoom } from "./room";

type View = "screen" | "phone" | "host";
const VIEWS: Array<{ id: View; label: string }> = [
  { id: "screen", label: "Экран зала" },
  { id: "phone", label: "Телефон" },
  { id: "host", label: "Пульт" },
];

const SIZES = [
  { teams: 3, guests: 12, label: "12 гостей" },
  { teams: 5, guests: 24, label: "24 гостя" },
  { teams: 10, guests: 50, label: "50 гостей" },
] as const;

export function BublikatorPreview({ content, mode }: RoomPreviewProps<BubContent>) {
  const rehearsal = mode === "rehearsal";
  const [size, setSize] = useState(1);
  const [speed, setSpeed] = useState(rehearsal ? 1 : 4);
  const [auto, setAuto] = useState(!rehearsal);
  const [view, setView] = useState<View>(rehearsal ? "host" : "screen");
  const [run, setRun] = useState(0);
  const [over, setOver] = useState(false);
  // Часы комнаты: ускоренные. Смена скорости — с того же момента игры.
  const clock = useRef({ real: Date.now(), sim: Date.now(), speed });
  const now = useMemo(() => () => clock.current.sim + (Date.now() - clock.current.real) * clock.current.speed, []);
  useEffect(() => {
    clock.current = { real: Date.now(), sim: now(), speed };
  }, [speed, now]);

  const pick = SIZES[size] ?? SIZES[1];
  const room = useMemo(
    () => new SimRoom({ content, teams: pick.teams, guests: pick.guests, clock: now, seed: `preview-${run}` }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- новая комната — только «Сначала» и другой размер зала
    [pick.teams, pick.guests, run, now],
  );
  const links = useMemo(() => ({ screen: room.screenLink(), phone: room.phoneLink(), host: room.hostLink() }), [room]);
  const stageAt = useRef({ key: "", at: 0 });

  useEffect(() => {
    room.viewerActive = view === "phone";
  }, [room, view]);

  useEffect(() => {
    setOver(false);
    const h = setInterval(() => {
      room.step();
      const key = `${room.s.phase}:${room.s.leg?.stage ?? ""}:${room.s.legIndex}`;
      if (key !== stageAt.current.key) stageAt.current = { key, at: room.now() };
      if (!auto || room.env.paused) return;
      const next = autopilot(room.s, room.now() - stageAt.current.at);
      if (next) room.command(next.cmd, next.args);
    }, 100);
    return () => clearInterval(h);
  }, [room, auto]);

  return (
    <div className="stack bkpv">
      <div className="bkpv-tools">
        <div className="seg" role="group" aria-label="Сколько гостей">
          {SIZES.map((s, i) => (
            <button key={s.label} type="button" className={i === size ? "seg__btn is-on" : "seg__btn"} aria-pressed={i === size} onClick={() => setSize(i)}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Скорость времени">
          {[1, 4].map((x) => (
            <button key={x} type="button" className={x === speed ? "seg__btn is-on" : "seg__btn"} aria-pressed={x === speed} onClick={() => setSpeed(x)}>
              {x === 1 ? "Как в игре" : "Быстрее ×4"}
            </button>
          ))}
        </div>
        <label className="choice">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          <span className="choice__text">
            <span className="choice__title">Пульт нажимает сам</span>
            <span className="choice__hint">Выключите — и ведите игру кнопками на вкладке «Пульт».</span>
          </span>
        </label>
        <button type="button" className="btn btn--quiet btn--block" onClick={() => setRun((r) => r + 1)}>
          ↺ Начать сначала
        </button>
      </div>
      <Tabs items={VIEWS} value={view} onChange={setView} label="Что показать" idPrefix="bub-preview" />
      <div role="tabpanel" id={`bub-preview-panel-${view}`} aria-labelledby={`bub-preview-tab-${view}`} className="stack">
        {view === "screen" && (
          <div className="preview-screen">
            <BublikatorScreen key={run} link={links.screen} code="000000" fallbackTheme={content.theme} now={now} />
          </div>
        )}
        {view === "phone" && (
          <div className="preview-phone bkpv-phone">
            <BublikatorPhone key={run} link={links.phone} name={room.env.players.find((p) => p.pid === SIM_VIEWER)?.name ?? "Гость"} code="000 000" now={now} />
          </div>
        )}
        {view === "host" && (
          <div className="bkpv-host">
            {over ? (
              <div className="stack">
                <p>Игра окончена — в настоящей игре итоги ушли бы в «Историю игр», а гости увидели бы карточку экипажа.</p>
                <button type="button" className="btn btn--secondary btn--block" onClick={() => setRun((r) => r + 1)}>
                  ↺ Начать сначала
                </button>
              </div>
            ) : (
              <BublikatorHost key={run} link={links.host} now={now} onFinish={() => setOver(true)} />
            )}
          </div>
        )}
      </div>
      <p className="muted small">
        {rehearsal
          ? "Репетиция: гости — тестовые, за них играют боты (крутят приборы, трясут, голосуют). Вы ведёте игру кнопками пульта; ничего не сохраняется."
          : "Игра идёт сама: команды и гости тестовые, за них играют боты. На вкладке «Телефон» можно поиграть за гостя «" +
            (room.env.players.find((p) => p.pid === SIM_VIEWER)?.name ?? "") +
            "» — пока вы на ней, боты за него не играют."}
      </p>
    </div>
  );
}
