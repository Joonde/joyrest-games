import type { PreviewDriver } from "../preview";
import type { AquariumContent, SceneId } from "./content";
import { figuresOf } from "./figures";
import { feedFish, nextGarland, parseAquaResult, pendingItems, phoneItems, releaseItems, setScene, startAquarium, type PhoneItem } from "./logic";

const NAMES = ["Аня", "Боря", "Вика", "Гоша"];

/** Предпросмотр: гости раскрашивают рыбок, ведущий кормит, потом ёлка с игрушками и гирляндой. */
export const aquariumPreview: PreviewDriver<AquariumContent> = ({ session, content, participants, answers }) => {
  if (session.state.stage === "ready") return { label: "Пульт: «Открыть раскраску»", change: startAquarium(session, content, participants) };
  const r = parseAquaResult(session.state.result, content);
  // Телефоны: игроки (или телефоны команд).
  const phones = participants.filter((p) => p.kind === "player");
  const pending = pendingItems(session, answers, content);
  if (pending.length > 0) return { label: content.moderation === "host" ? "Пульт: «На экран»" : "Рисунок появляется на экране", change: releaseItems(session, content, pending) };
  const scene: SceneId = r.scene;
  const onScene = r.items.filter((i) => i.scene === scene);
  const next = phones[onScene.length];
  if (next && onScene.length < Math.min(phones.length, content.perGuest * phones.length)) {
    const figs = figuresOf(scene);
    const fig = figs[onScene.length % figs.length];
    if (fig) {
      const prev = phoneItems(answers.find((a) => a.pid === next.id)?.value);
      const name = NAMES[onScene.length % NAMES.length] ?? "Гость";
      const item: PhoneItem = { id: `pv${scene}${onScene.length}`, scene, fig: fig.id, name, onBody: content.names, sha: null };
      return { label: `${name} раскрашивает: «${fig.name}»`, answers: [{ pid: next.id, value: { items: [...prev, item] } }] };
    }
  }
  if (scene === "aqua" && r.feed === 0) return { label: "Пульт: «Покормить рыбок»", change: feedFish(session, content) };
  if (scene === "aqua" && !r.items.some((i) => i.scene === "tree")) return { label: "Пульт: сцена «Ёлка»", change: setScene(session, content, "tree") };
  if (scene === "tree" && r.garland < 2) return { label: "Пульт: гирлянда — следующий режим", change: nextGarland(session, content) };
  return null;
};
