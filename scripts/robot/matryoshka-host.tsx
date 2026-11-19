// Браузерный стенд настоящего пульта 3d: MatryoshkaHost против правил World и ботов, без HTTP.
import "../../src/fonts.css";
import "../../src/styles.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { RoomStreamEvent } from "../../src/data/types";
import { MatryoshkaEditorView } from "../../src/mechanics/matryoshka/editor/Editor";
import { validateMatryoshka } from "../../src/mechanics/matryoshka/editor/validate";
import { MatryoshkaHost } from "../../src/mechanics/matryoshka/host/Host";
import type { HostLink } from "../../src/mechanics/matryoshka/host/link";
import { parseContent } from "../../src/mechanics/matryoshka/rules/content";
import type { MatContent } from "../../src/mechanics/matryoshka/rules/types";
import { MatryoshkaPreview } from "../../src/mechanics/matryoshka/sim/Preview";
import { World } from "../../src/mechanics/matryoshka/rules/world.test-kit";
import { applyTheme, getTheme } from "../../src/themes/registry";

const params = new URLSearchParams(location.search);
const guests = Math.max(6, Math.min(100, Number(params.get("guests") ?? 12)));
const long = params.get("long") === "1";

type Listener = (event: RoomStreamEvent) => void;

class StandRoom {
  w = new World(guests, {}, "host-stand");
  listeners = new Set<Listener>();
  pausedAt = 0;
  lastHost = 0;
  auto = false;
  commands: Array<{ cmd: string; ok: boolean; error?: string }> = [];

  constructor() {
    this.w.now = 1_000_000;
    if (long) for (const p of this.w.players) p.name = `${p.name} с очень длинным именем и фамилией`;
  }

  event(): RoomStreamEvent {
    return {
      type: "host", at: this.w.now, version: this.w.changes, moment: this.w.host().moment,
      paused: this.w.paused, restored: false, players: this.w.players.length,
      online: this.w.players.length - this.w.offline.size,
      offline: this.w.players.filter((p) => this.w.offline.has(p.pid)).map((p) => ({ pid: p.pid, name: p.name })),
      loop: { lagMs: 2, maxLagMs: 4, memoryMb: 100 }, data: this.w.host(),
    };
  }

  flushHost(): void {
    this.lastHost = this.w.now;
    const event = this.event();
    for (const listener of this.listeners) listener(event);
  }

  private roomEvent(): void {
    const event: RoomStreamEvent = { type: "room", at: this.w.now, paused: this.w.paused };
    for (const listener of this.listeners) listener(event);
  }

  link: HostLink = {
    subscribe: (onEvent, _onError, _take) => {
      this.listeners.add(onEvent);
      queueMicrotask(() => { if (this.listeners.has(onEvent)) onEvent(this.event()); });
      return () => this.listeners.delete(onEvent);
    },
    command: async (cmd, args, expect) => {
      if (cmd === "pause") {
        if (!this.w.paused) { this.w.pause(); this.pausedAt = this.w.now; this.roomEvent(); }
        this.commands.push({ cmd, ok: true });
        this.flushHost();
        return null;
      }
      if (cmd === "resume") {
        if (this.w.paused) { this.w.resume(Math.max(0, this.w.now - this.pausedAt)); this.roomEvent(); }
        this.commands.push({ cmd, ok: true });
        this.flushHost();
        return null;
      }
      if (expect !== undefined && expect !== this.w.host().moment) {
        this.commands.push({ cmd, ok: false, error: "moved" });
        throw Object.assign(new Error("moved"), { code: "failed-precondition", reason: "moved" });
      }
      const out = this.w.cmd(cmd, args);
      this.commands.push(out.ok ? { cmd, ok: true } : { cmd, ok: false, error: out.error });
      this.flushHost();
      if (!out.ok) throw Object.assign(new Error(out.error), { code: "failed-precondition", reason: out.error });
      return out.result ?? null;
    },
  };

  private autopilot(): void {
    if (!this.auto || this.w.paused) return;
    const v = this.w.host();
    if (v.can.start) this.w.cmd("start");
    else if (v.can["skip-rules"]) this.w.cmd("skip-rules");
    else if (v.can.chance) this.w.cmd("chance");
    else if (v.can.next) this.w.cmd("next");
    else if (v.can.duel) this.w.cmd("duel");
    else if (v.can.podium) this.w.cmd("podium");
  }

  step(ms: number): void {
    for (let n = 0; n < ms; n += 100) {
      this.w.step(100, true);
      this.autopilot();
      if (this.w.now - this.lastHost >= 1000) this.flushHost();
      if (this.auto && this.w.s.phase === "podium") break;
    }
    this.flushHost();
  }

  driveTo(phase: string, limit = 600_000): string {
    const wasAuto = this.auto;
    this.auto = true;
    for (let n = 0; n < limit && this.w.s.phase !== phase; n += 100) this.step(100);
    this.auto = wasAuto;
    this.flushHost();
    return this.w.s.phase;
  }
}

applyTheme(getTheme("joyrest"));
const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("нет #root");
const w = window as unknown as Record<string, unknown>;
const scenario = params.get("s") ?? "game";

if (scenario === "editor") {
  function EditorStand() {
    const [content, setContent] = useState<MatContent>(() => {
      const base = parseContent(undefined);
      return params.get("bad") === "1" ? { ...base, questions: [{ q: "", options: [""], correct: 4 }] } : base;
    });
    w.content = content;
    w.errors = validateMatryoshka(content);
    return <main className="page"><MatryoshkaEditorView gameId="g1" themeId="joyrest" content={content} onChange={setContent} editable /></main>;
  }
  createRoot(rootEl).render(<EditorStand />);
} else if (scenario === "preview") {
  createRoot(rootEl).render(<main className="page page--wide"><MatryoshkaPreview content={parseContent(undefined)} mode={params.get("mode") === "rehearsal" ? "rehearsal" : "preview"} /></main>);
} else {
  const room = new StandRoom();
  let finished = 0;
  createRoot(rootEl).render(<main className="page page--pult"><div className="pult-panel"><section className="card"><MatryoshkaHost link={room.link} now={() => room.w.now} onFinish={() => { room.w.cmd("finish"); room.flushHost(); finished += 1; }} /></section></div></main>);
  w.stand = room;
  w.standStep = (ms: number) => room.step(ms);
  w.standDriveTo = (phase: string) => room.driveTo(phase);
  w.standFinished = () => finished;
}
w.standReady = true;
