/** Предпросмотр и репетиция «Игр Матрёшки»: настоящие экран, телефон и пульт против одной комнаты в памяти с ботами. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Tabs } from "../../../components/Tabs";
import type { RoomPreviewProps } from "../../types";
import { MatryoshkaHost } from "../host/Host";
import { MatryoshkaPhone } from "../phone/Phone";
import { MatryoshkaScreen } from "../screen/Screen";
import type { MatContent } from "../rules/types";
import { autopilot, SIM_VIEWER, SimRoom } from "./room";
import "./preview.css";

type View = "screen" | "phone" | "host";
const VIEWS: Array<{ id: View; label: string }> = [{ id: "screen", label: "Экран зала" }, { id: "phone", label: "Телефон" }, { id: "host", label: "Пульт" }];
const SIZES = [{ guests: 12, label: "12 гостей" }, { guests: 24, label: "24 гостя" }, { guests: 50, label: "50 гостей" }] as const;

export function MatryoshkaPreview({ content, mode }: RoomPreviewProps<MatContent>) {
  const rehearsal = mode === "rehearsal";
  const [size, setSize] = useState(0);
  const [speed, setSpeed] = useState(rehearsal ? 1 : 4);
  const [auto, setAuto] = useState(!rehearsal);
  const [view, setView] = useState<View>(rehearsal ? "host" : "screen");
  const [run, setRun] = useState(0);
  const [over, setOver] = useState(false);
  const clock = useRef({ real: Date.now(), sim: Date.now(), speed });
  const now = useMemo(() => () => clock.current.sim + (Date.now() - clock.current.real) * clock.current.speed, []);
  useEffect(() => { clock.current = { real: Date.now(), sim: now(), speed }; }, [speed, now]);
  const pick = SIZES[size] ?? SIZES[0];
  const room = useMemo(() => new SimRoom({ content, guests: pick.guests, clock: now, seed: `preview-${run}` }),
    // Новая комната — только «Сначала» или другой размер зала.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pick.guests, run, now]);
  const links = useMemo(() => ({ screen: room.screenLink(), phone: room.phoneLink(), host: room.hostLink() }), [room]);

  useEffect(() => { room.viewerActive = view === "phone"; }, [room, view]);
  useEffect(() => {
    setOver(false);
    const h = setInterval(() => {
      room.step();
      if (auto && !room.world.paused && room.s.phase !== "podium") autopilot(room);
    }, 100);
    return () => clearInterval(h);
  }, [room, auto]);

  return <div className="stack matpv">
    <div className="matpv-tools">
      <div className="seg" role="group" aria-label="Сколько гостей">{SIZES.map((s, i) => <button type="button" key={s.label} className={i === size ? "seg__btn is-on" : "seg__btn"} aria-pressed={i === size} onClick={() => setSize(i)}>{s.label}</button>)}</div>
      <div className="seg" role="group" aria-label="Скорость времени">{[1, 4].map((x) => <button type="button" key={x} className={x === speed ? "seg__btn is-on" : "seg__btn"} aria-pressed={speed === x} onClick={() => setSpeed(x)}>{x === 1 ? "Как в игре" : "Быстрее ×4"}</button>)}</div>
      <label className="choice"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /><span className="choice__text"><span className="choice__title">Пульт нажимает сам</span><span className="choice__hint">Выключите — и ведите игру на вкладке «Пульт».</span></span></label>
      <button type="button" className="btn btn--quiet btn--block" onClick={() => setRun((r) => r + 1)}>↺ Начать сначала</button>
    </div>
    <Tabs items={VIEWS} value={view} onChange={setView} label="Что показать" idPrefix="mat-preview" />
    <div role="tabpanel" id={`mat-preview-panel-${view}`} aria-labelledby={`mat-preview-tab-${view}`} className="stack">
      {view === "screen" && <div className="preview-screen matpv-screen"><MatryoshkaScreen key={run} link={links.screen} code="000 000" fallbackStyle={content.style} now={now} synced={() => 0} /></div>}
      {view === "phone" && <div className="preview-phone matpv-phone"><MatryoshkaPhone key={run} link={links.phone} name={room.world.players.find((p) => p.pid === SIM_VIEWER)?.name ?? "Гость"} code="000 000" now={now} /></div>}
      {view === "host" && <div className="matpv-host">{over ? <div className="stack"><p>Игра окончена. В настоящей игре итоги ушли бы в «Историю игр», здесь ничего не сохраняется.</p><button type="button" className="btn btn--secondary btn--block" onClick={() => setRun((r) => r + 1)}>↺ Начать сначала</button></div> : <MatryoshkaHost key={run} link={links.host} now={now} onFinish={() => { room.command("finish"); setOver(true); }} />}</div>}
    </div>
    <p className="muted small">{rehearsal ? "Репетиция: гости тестовые, вы ведёте пультом. Ничего не сохраняется и баллы не начисляются." : "Предпросмотр: боты играют за гостей, автопилот ведёт пульт. На вкладке «Телефон» можно играть за первого гостя. Боты не заменяют проверку с людьми; обрывы настоящей сети здесь не моделируются."}</p>
  </div>;
}
