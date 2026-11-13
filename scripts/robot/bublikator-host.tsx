// Стенд пульта, конструктора и предпросмотра «Бубликатора» (Блок 2d) без сервера: настоящий пульт (`BublikatorHost`) против комнаты
// в памяти (`sim/room.ts` — те же правила, что у сервера; гостей играют боты). Время стенда — свои часы: `stand.advance(ms)` шагает
// комнату по 100 мс. Состояние комнаты после каждого шага сохраняется в sessionStorage — перезагрузка страницы посреди игры
// поднимает ту же игру (как пульт, открытый заново: сводка приходит снимком). Адрес: `?s=game|editor|preview&guests=50&teams=10`.
import "../../src/fonts.css";
import "../../src/styles.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BublikatorEditorView } from "../../src/mechanics/bublikator/editor/Editor";
import { validateBublikator } from "../../src/mechanics/bublikator/editor/validate";
import { BublikatorHost } from "../../src/mechanics/bublikator/host/Host";
import { parseContent } from "../../src/mechanics/bublikator/rules/content";
import { restore, snapshot } from "../../src/mechanics/bublikator/rules/game";
import type { BubContent } from "../../src/mechanics/bublikator/rules/types";
import { BublikatorPreview } from "../../src/mechanics/bublikator/sim/Preview";
import { SimRoom } from "../../src/mechanics/bublikator/sim/room";
import { applyTheme, getTheme } from "../../src/themes/registry";

const params = new URLSearchParams(location.search);
const scenario = params.get("s") ?? "game";
const guests = Number(params.get("guests") ?? 50);
const teams = Number(params.get("teams") ?? 10);
const long = params.get("long") === "1";
const KEY = `bub-host-stand:${guests}:${teams}:${long ? 1 : 0}`;
const LONG_TEAMS = ["🐻 Медведи из соседнего подъезда", "🚀 Ракетные войска бухгалтерии", "🦊 Хитрые лисы отдела продаж", "🌟 Звёзды корпоративного вечера"];

applyTheme(getTheme("joyrest"));
const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("нет #root");
const w = window as unknown as Record<string, unknown>;

if (scenario === "editor") {
  const kids = params.get("kids") === "1";
  function EditorStand() {
    const [content, setContent] = useState<BubContent>(() => parseContent(kids ? { difficulty: "kids" } : { saboteur: true, names: params.get("bad") === "1" ? ["Тёщемер", "тёщемер", "Салатоскоп"] : [] }));
    w.content = content;
    w.errors = validateBublikator(content);
    return (
      <main className="page">
        <BublikatorEditorView gameId="g1" themeId="joyrest" content={content} onChange={setContent} editable />
      </main>
    );
  }
  createRoot(rootEl).render(<EditorStand />);
  w.standReady = true;
} else if (scenario === "preview") {
  createRoot(rootEl).render(
    <main className="page page--wide">
      <BublikatorPreview content={parseContent({ saboteur: true, legMinutes: 3 })} mode={params.get("mode") === "rehearsal" ? "rehearsal" : "preview"} />
    </main>,
  );
  w.standReady = true;
} else {
  let t = 1_000_000;
  const room = new SimRoom({
    content: { saboteur: params.get("saboteur") !== "0", legMinutes: 3, legs: Number(params.get("legs") ?? 3) },
    teams,
    guests,
    clock: () => t,
    seed: "stand",
    teamNames: long ? (i) => `${LONG_TEAMS[i % LONG_TEAMS.length]}${i >= LONG_TEAMS.length ? ` ${i + 1}` : ""}` : undefined,
  });
  // Перезагрузка посреди игры: та же игра из сохранённого снимка.
  try {
    const saved = sessionStorage.getItem(KEY);
    if (saved && params.get("fresh") !== "1") {
      const data = JSON.parse(saved) as { snap: unknown; t: number; offline: string[] };
      const s = restore(data.snap);
      if (s) {
        room.s = s;
        t = data.t;
        room.env.now = t;
        for (const pid of data.offline) room.env.offlineSet.add(pid);
      }
    } else sessionStorage.removeItem(KEY);
  } catch {
    /* без сохранения — новая игра */
  }
  const save = () => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ snap: snapshot(room.s), t, offline: [...room.env.offlineSet] }));
    } catch {
      /* нет места — не страшно */
    }
  };
  const link = room.hostLink();
  let finished = 0;
  function Stand() {
    const [gen, setGen] = useState(0);
    w.remount = () => setGen((g) => g + 1);
    return (
      <main className="page page--pult">
        <div className="pult-panel">
          <section className="card">
            <BublikatorHost key={gen} link={link} now={() => t} onFinish={() => (finished += 1)} />
          </section>
        </div>
      </main>
    );
  }
  createRoot(rootEl).render(<Stand />);
  w.stand = {
    advance(ms: number) {
      for (let x = 0; x < ms; x += 100) {
        t += 100;
        room.step();
      }
      save();
    },
    phase: () => `${room.s.phase}:${room.s.leg?.stage ?? "-"}:${room.s.legIndex}`,
    commands: () => room.commands,
    finished: () => finished,
    crews: () => room.s.crews.filter((c) => !c.gone).length,
    offline(pid: string) {
      room.env.offlineSet.add(pid);
      save();
    },
    shift: () => room.s.leg?.shift ?? 0,
    paused: () => room.env.paused,
    event: () => room.s.leg?.event?.kind ?? null,
    stars: () => JSON.stringify(room.s.crews.map((c) => c.bonus.captain)),
    clear() {
      sessionStorage.removeItem(KEY);
    },
  };
  w.standReady = true;
}
