// Предпросмотр игры в конструкторе: игра сама проходит по шагам с тестовыми командами — те же функции
// пульта, что в настоящей игре, сессия только в памяти. Механика даёт «водителя» (`PreviewDriver`):
// по текущему состоянию он решает, что сейчас сделает пульт или ответят телефоны.
import { awardNow, hasPodium, podiumDone, podiumNext } from "../core/podium";
import { applyChange, startState } from "../core/session";
import type { Answer, Participant, PlayMode, Session, SessionChange } from "../data/types";

export interface PreviewScene {
  /** Что произошло: «Пульт: «Показать вопрос»», «Капитаны ответили». */
  label: string;
  session: Session;
  /** Все ответы к этому моменту. */
  answers: Answer[];
}

export interface PreviewMove {
  label: string;
  /** Ответы телефонов на текущий шаг (до действия пульта). */
  answers?: Array<{ pid: string; value: unknown }>;
  /** Действие пульта. */
  change?: SessionChange | null;
}

export interface PreviewContext<Content> {
  session: Session;
  content: Content;
  /** Все участники: команды (или игроки) и телефоны команд. */
  participants: Participant[];
  /** Ответы на текущий шаг. */
  answers: Answer[];
  /** Сколько сцен уже показано. */
  n: number;
}

/** null — дальше сам ход игры не идёт (награждение покажет общий хвост). */
export type PreviewDriver<Content> = (ctx: PreviewContext<Content>) => PreviewMove | null;

const TEAM_NAMES = ["🦊 Лисы", "🐻 Медведи", "🦉 Совы", "🐯 Тигры"];
const PLAYER_NAMES = ["🦊 Аня", "🐻 Боря", "🦉 Вика", "🐯 Гоша"];

export interface PreviewPhone {
  /** Кого показывать на телефоне: игрок или телефон капитана команды. */
  participant: Participant;
  /** Кто получает очки. */
  pid: string;
  name: string;
}

/** Тестовые команды (с телефонами капитанов) или игроки. */
export function previewParticipants(playMode: PlayMode, count: number): { participants: Participant[]; phones: PreviewPhone[] } {
  const participants: Participant[] = [];
  const phones: PreviewPhone[] = [];
  for (let i = 0; i < count; i++) {
    const n = i + 1;
    if (playMode === "teams") {
      const name = TEAM_NAMES.at(i) ?? `Команда ${n}`;
      const team: Participant = { id: `team${n}`, name, kind: "team", teamId: null, captainUid: `phone${n}`, joinedAt: n };
      const phone: Participant = { id: `phone${n}`, name: `Капитан ${n}`, kind: "player", teamId: team.id, captainUid: `phone${n}`, joinedAt: n };
      participants.push(team, phone);
      phones.push({ participant: phone, pid: team.id, name });
    } else {
      const name = PLAYER_NAMES.at(i) ?? `Игрок ${n}`;
      const player: Participant = { id: `player${n}`, name, kind: "player", teamId: null, captainUid: `player${n}`, joinedAt: n };
      participants.push(player);
      phones.push({ participant: player, pid: player.id, name });
    }
  }
  return { participants, phones };
}

/** Команды (или игроки), что получают очки. */
export function scoringIds(participants: Participant[]): string[] {
  const teams = participants.filter((p) => p.kind === "team");
  return (teams.length > 0 ? teams : participants).map((p) => p.id);
}

export interface PreviewOptions<Content> {
  mechanic: string;
  content: Content;
  playMode: PlayMode;
  themeId: string;
  driver: PreviewDriver<Content>;
  teams: number;
  limit: number;
}

/** Прогон: сцены от начала игры до награждения и итогов. */
export function runPreview<Content>({ mechanic, content, playMode, themeId, driver, teams, limit }: PreviewOptions<Content>): { scenes: PreviewScene[]; phones: PreviewPhone[] } {
  const { participants, phones } = previewParticipants(playMode, teams);
  // Часы — сейчас: таймеры вопросов в предпросмотре идут как в игре.
  let clock = Date.now();
  let session: Session = {
    id: "preview",
    code: "000000",
    hostId: "",
    gameId: "preview",
    gameTitle: "",
    mechanic,
    gameSnapshot: null,
    themeId,
    playMode,
    screenMode: "laptop",
    state: { ...startState(), phase: "playing" },
    leaderboard: {},
    createdAt: clock,
  };
  const answers: Answer[] = [];
  const scenes: PreviewScene[] = [];
  const push = (label: string) => scenes.push({ label, session, answers: [...answers] });
  const apply = (change: SessionChange) => {
    clock += 4000;
    session = applyChange(session, change, clock);
  };

  for (let guard = 0; scenes.length < limit && guard < limit * 3; guard++) {
    const since = session.state.startedAt ?? 0;
    const current = answers.filter((a) => a.step === session.state.step && (a.submittedAt ?? 0) >= since);
    const move = driver({ session, content, participants, answers: current, n: scenes.length });
    if (!move) break;
    (move.answers ?? []).forEach(({ pid, value }, i) => {
      const id = `${session.state.step}_${pid}`;
      const at = answers.findIndex((a) => a.id === id);
      const answer: Answer = { id, step: session.state.step, pid, uid: pid, value, submittedAt: (session.state.startedAt ?? clock) + 1500 + i * 700 };
      if (at >= 0) answers.splice(at, 1, answer);
      else answers.push(answer);
    });
    if (move.answers?.length && !move.change) {
      // Счётчик «ответили» на экране — как его ведёт пульт.
      const now = answers.filter((a) => a.step === session.state.step && (a.submittedAt ?? 0) >= (session.state.startedAt ?? 0)).length;
      session = { ...session, state: { ...session.state, answered: now } };
    }
    if (move.change) apply(move.change);
    if (!move.change && !(move.answers?.length)) break;
    push(move.label);
  }

  // Хвост: награждение по местам и итоги.
  if (session.state.stage !== "podium" && hasPodium(session.leaderboard)) {
    apply(awardNow(session));
    push("Пульт: «Награждение»");
  }
  for (let i = 0; session.state.stage === "podium" && !podiumDone(session) && i < 5; i++) {
    apply(podiumNext(session));
    push("Пульт: «Открыть следующее место»");
  }
  apply({ state: { phase: "finished" } });
  push("Пульт: «Завершить игру» — итоги");
  return { scenes, phones };
}
