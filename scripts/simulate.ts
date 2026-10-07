/**
 * Нагрузочный симулятор (CLAUDE.md, раздел 9): N виртуальных гостей проходят демо-квиз
 * против эмуляторов Firebase, пульт ведёт игру по той же логике, что и настоящий
 * (src/mechanics/quiz/flow.ts). В конце — сколько чтений и записей Firestore ушло на игру.
 *
 *   GUESTS=50 npm run simulate
 *   GUESTS=500 TEAMS=1 npm run simulate      (режим команд: по 10 телефонов в команде)
 *
 * Чтения считаются так, как их считает биллинг Firestore: документ в ответе на запрос,
 * обновление документа в подписке, а также чтения внутри правил (get/exists).
 */
import { initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously, signInWithEmailAndPassword } from "firebase/auth";
import {
  addDoc,
  collection,
  connectFirestoreEmulator,
  deleteField,
  doc,
  getDocFromServer,
  initializeFirestore,
  memoryLocalCache,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";
import { leaderboardAdditions } from "../src/core/leaderboard";
import { compactBoard } from "../src/core/results";
import type { Answer, Leaderboard, LeaderboardEntry, Participant, PlayMode, Session, SessionChange } from "../src/data/types";
import { DEMO_QUIZ } from "../src/mechanics/quiz/demo";
import { nextQuestion, reveal, showBoard, showQuestion } from "../src/mechanics/quiz/flow";

const PROJECT = "demo-joyrest";
const GUESTS = Number(process.env.GUESTS ?? 50);
const TEAMS = process.env.TEAMS === "1";
const TEAM_SIZE = 10;
const AUTH_URL = "http://127.0.0.1:9099";
const FIRESTORE_HOST = "127.0.0.1";
/** Как в пульте: счётчик ответов на экране — не чаще раза в 2 с. */
const ANSWERED_THROTTLE_MS = 2000;

// ---------- Счётчики ----------

const reads: Record<string, number> = {};
const writes: Record<string, number> = {};
const read = (what: string, n = 1) => (reads[what] = (reads[what] ?? 0) + n);
const write = (what: string, n = 1) => (writes[what] = (writes[what] ?? 0) + n);
const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
let failures = 0;

// ---------- Клиенты ----------

let appCounter = 0;
function client(): { app: FirebaseApp; db: Firestore } {
  const app = initializeApp({ apiKey: "demo", projectId: PROJECT, authDomain: "demo" }, `sim-${appCounter++}`);
  const db = initializeFirestore(app, { localCache: memoryLocalCache() });
  connectFirestoreEmulator(db, FIRESTORE_HOST, 8080);
  connectAuthEmulator(getAuth(app), AUTH_URL, { disableWarnings: true });
  return { app, db };
}

async function createHostAccount(): Promise<{ email: string; password: string; uid: string }> {
  const email = `sim-${Date.now()}@test.ru`;
  const password = "simulate123";
  const res = await fetch(`${AUTH_URL}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const { localId } = (await res.json()) as { localId: string };
  // Профиль ведущего — в обход правил (так его создаёт admin).
  await fetch(`http://${FIRESTORE_HOST}:8080/v1/projects/${PROJECT}/databases/(default)/documents/users/${localId}`, {
    method: "PATCH",
    headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: { role: { stringValue: "host" }, name: { stringValue: "Симулятор" }, active: { booleanValue: true } },
    }),
  });
  return { email, password, uid: localId };
}

/** Смещение часов: одна запись и одно чтение на устройство (как src/data/clock.ts). */
async function syncClock(db: Firestore, uid: string): Promise<void> {
  const ref = doc(db, "clock", uid);
  await setDoc(ref, { t: serverTimestamp() });
  write("часы (экран зала и пульт)");
  await getDocFromServer(ref);
  read("часы (экран зала и пульт)");
}

function toSession(id: string, data: DocumentData): Session {
  const ms = (v: unknown) => (v && typeof (v as { toMillis?: unknown }).toMillis === "function" ? (v as { toMillis(): number }).toMillis() : null);
  return {
    ...(data as Session),
    id,
    state: { ...(data.state as Session["state"]), startedAt: ms(data.state?.startedAt) },
    createdAt: ms(data.createdAt),
  };
}

function patchOf(change: SessionChange): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(change.state ?? {})) {
    patch[`state.${key}`] = key === "startedAt" && value === "server" ? serverTimestamp() : value;
  }
  for (const [pid, entry] of Object.entries(change.leaderboard ?? {})) {
    patch[`leaderboard.${pid}`] = entry === null ? deleteField() : entry;
  }
  return patch;
}

// ---------- Гость ----------

interface Guest {
  uid: string;
  pid: string;
  captain: boolean;
  db: Firestore;
  stop: () => void;
}

const OPEN_ANSWERS = ["Снегурочка", "снегурка", "Снегурочк", "ёлка", "Ель", "не знаю"];

async function startGuest(sessionId: string, index: number, teamIds: string[]): Promise<Guest> {
  const { app, db } = client();
  const { user } = await signInAnonymously(getAuth(app));
  const uid = user.uid;

  let pid = uid;
  let captain = true;
  const name = `Гость ${(index % 40) + 1}`; // повторяющиеся имена — проверка номеров
  if (TEAMS) {
    const teamIndex = Math.floor(index / TEAM_SIZE);
    if (index % TEAM_SIZE === 0) {
      const ref = await addDoc(collection(db, "sessions", sessionId, "participants"), {
        name: `Команда ${teamIndex + 1}`,
        kind: "team",
        teamId: null,
        captainUid: uid,
        joinedAt: serverTimestamp(),
      });
      write("вход гостей");
      read("правила: проверки при входе");
      teamIds[teamIndex] = ref.id;
    }
    while (!teamIds[teamIndex]) await new Promise((r) => setTimeout(r, 50));
    pid = teamIds[teamIndex] ?? uid;
    captain = index % TEAM_SIZE === 0;
  }
  await setDoc(doc(db, "sessions", sessionId, "participants", uid), {
    name,
    kind: "player",
    teamId: TEAMS ? pid : null,
    captainUid: uid,
    joinedAt: serverTimestamp(),
  });
  write("вход гостей");
  read("правила: проверки при входе", TEAMS ? 2 : 1);

  let answeredStep = -1;
  const stop = onSnapshot(doc(db, "sessions", sessionId), (snap) => {
    if (snap.metadata.fromCache) return;
    read("гости: документ сессии");
    const data = snap.data();
    if (!data) return;
    const state = data.state as Session["state"];
    if (!captain || state.phase !== "playing" || state.stage !== "question" || answeredStep === state.step) return;
    const step = state.step;
    answeredStep = step;
    const q = DEMO_QUIZ.content.questions[step];
    if (!q) return;
    const value = q.kind === "open" ? OPEN_ANSWERS[index % OPEN_ANSWERS.length] : Math.floor(Math.random() * q.options.length);
    // Гости отвечают за 0,5–5 секунд.
    setTimeout(() => {
      setDoc(doc(db, "sessions", sessionId, "answers", `${step}_${pid}`), {
        step,
        pid,
        uid,
        value,
        submittedAt: serverTimestamp(),
      })
        .then(() => {
          write("ответы гостей");
          read("правила: проверки ответа", 2);
        })
        .catch(() => failures++);
    }, 500 + Math.random() * 4500);
  });
  return { uid, pid, captain, db, stop };
}

// ---------- Пульт ----------

async function main() {
  const started = Date.now();
  console.log(`Симуляция: ${GUESTS} гостей, режим ${TEAMS ? "команды" : "каждый сам за себя"}, ${DEMO_QUIZ.content.questions.length} вопросов`);
  const account = await createHostAccount();
  const host = client();
  await signInWithEmailAndPassword(getAuth(host.app), account.email, account.password);
  await syncClock(host.db, account.uid);

  // Игра и сессия — как в студии и на экране запуска.
  const playMode: PlayMode = TEAMS ? "teams" : "solo";
  const gameRef = await addDoc(collection(host.db, "games"), {
    scope: "personal",
    ownerId: account.uid,
    title: DEMO_QUIZ.title,
    mechanic: "quiz",
    themeId: "joyrest",
    ageRating: "0+",
    playMode,
    content: DEMO_QUIZ.content,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const code = String(100000 + Math.floor(Math.random() * 900000));
  const sessionRef = await addDoc(collection(host.db, "sessions"), {
    code,
    hostId: account.uid,
    gameId: gameRef.id,
    gameTitle: DEMO_QUIZ.title,
    mechanic: "quiz",
    gameSnapshot: { title: DEMO_QUIZ.title, mechanic: "quiz", themeId: "joyrest", content: DEMO_QUIZ.content },
    themeId: "joyrest",
    playMode,
    screenMode: "laptop",
    state: { phase: "lobby", step: 0, startedAt: null, revealed: false },
    leaderboard: {},
    createdAt: serverTimestamp(),
  });
  write("подготовка (игра и сессия)", 2);
  read("подготовка (игра и сессия)", 2);
  const sessionId = sessionRef.id;

  let session: Session | null = null;
  let participants: Participant[] = [];
  let answers: Answer[] = [];
  const hostSessionStop = onSnapshot(doc(host.db, "sessions", sessionId), (snap) => {
    if (!snap.metadata.fromCache) read("пульт: документ сессии");
    const data = snap.data();
    if (data) session = toSession(snap.id, data);
  });
  const participantsStop = onSnapshot(collection(host.db, "sessions", sessionId, "participants"), (snap) => {
    if (!snap.metadata.hasPendingWrites) read("пульт: участники", Math.max(1, snap.docChanges().length));
    participants = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Participant, "id">) }));
  });

  // Экран зала: отдельное устройство, слушает только документ сессии.
  const screen = client();
  const screenUser = await signInAnonymously(getAuth(screen.app));
  await syncClock(screen.db, screenUser.user.uid);
  const screenStop = onSnapshot(doc(screen.db, "sessions", sessionId), (snap) => {
    if (!snap.metadata.fromCache) read("экран зала: документ сессии");
  });

  const apply = async (change: SessionChange, what: string) => {
    const patch = patchOf(change);
    if (Object.keys(patch).length === 0) return;
    await updateDoc(doc(host.db, "sessions", sessionId), patch);
    write(what);
  };

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (check: () => boolean, timeoutMs: number) => {
    const end = Date.now() + timeoutMs;
    while (!check() && Date.now() < end) await wait(100);
  };

  // Гости входят пачками по 25, как на мероприятии — за пару минут.
  console.log("Гости входят…");
  const teamIds: string[] = [];
  const guests: Guest[] = [];
  for (let i = 0; i < GUESTS; i += 25) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(25, GUESTS - i) }, (_, k) => startGuest(sessionId, i + k, teamIds)),
    );
    guests.push(...batch);
  }
  const scoring = TEAMS ? Math.ceil(GUESTS / TEAM_SIZE) : GUESTS;

  // Пульт переносит участников в таблицу лидеров (с номерами для одинаковых имён).
  const syncBoard = async () => {
    if (!session) return;
    const additions = leaderboardAdditions(session.leaderboard, participants, playMode);
    if (Object.keys(additions).length > 0) await apply({ leaderboard: additions as Record<string, LeaderboardEntry> }, "пульт: таблица лидеров");
  };
  await until(() => participants.filter((p) => p.kind === (TEAMS ? "team" : "player")).length >= scoring, 60_000);
  // Как пульт: таблица дописывается по мере входа гостей (пачками).
  for (let i = 0; i < 5; i++) {
    await syncBoard();
    await wait(300);
  }
  const board = (): Leaderboard => session?.leaderboard ?? {};
  const names = Object.values(board()).map((e) => e.name);
  console.log(`В таблице: ${names.length}, уникальных имён: ${new Set(names).size}`);

  await apply({ state: { phase: "playing", step: 0, stage: "ready", startedAt: null, revealed: false, timeLimit: null, answered: 0, result: null } }, "пульт: ход игры");
  const questionTimes: number[] = [];

  for (let step = 0; step < DEMO_QUIZ.content.questions.length; step++) {
    await until(() => session?.state.step === step && session.state.stage === "ready", 10_000);
    const current = session as unknown as Session;
    answers = [];
    const answersStop = onSnapshot(
      query(collection(host.db, "sessions", sessionId, "answers"), where("step", "==", step)),
      (snap) => {
        read("пульт: ответы", snap.docChanges().length);
        answers = snap.docs.map((d) => {
          const data = d.data();
          const at = data.submittedAt as { toMillis?: () => number } | null;
          return { id: d.id, step: data.step, pid: data.pid, uid: data.uid, value: data.value, submittedAt: at?.toMillis?.() ?? null } as Answer;
        });
      },
    );
    const t0 = Date.now();
    await apply(showQuestion(current, DEMO_QUIZ.content), "пульт: ход игры");
    // Счётчик ответов для экрана — не чаще раза в 2 секунды, пока не ответят все.
    let lastCount = 0;
    while (answers.length < scoring && Date.now() - t0 < 15_000) {
      await wait(ANSWERED_THROTTLE_MS);
      if (answers.length !== lastCount) {
        lastCount = answers.length;
        await apply({ state: { answered: lastCount } }, "пульт: счётчик ответов");
      }
    }
    questionTimes.push(Date.now() - t0);
    await until(() => session?.state.stage === "question", 5000);
    const open = session as unknown as Session;
    await apply(reveal(open, DEMO_QUIZ.content, answers, participants), "пульт: ход игры");
    await apply(showBoard(open, DEMO_QUIZ.content), "пульт: ход игры");
    answersStop();
    if (step < DEMO_QUIZ.content.questions.length - 1) await apply(nextQuestion({ ...open, state: { ...open.state, step } }, DEMO_QUIZ.content), "пульт: ход игры");
    process.stdout.write(`  вопрос ${step + 1}: ответов ${answers.length} из ${scoring} за ${((Date.now() - t0) / 1000).toFixed(1)} с\n`);
  }

  // Завершение: сессия и итоги одной пачкой.
  const final = session as unknown as Session;
  const batch = writeBatch(host.db);
  batch.update(doc(host.db, "sessions", sessionId), { "state.phase": "finished" });
  batch.set(doc(host.db, "results", sessionId), {
    hostId: account.uid,
    code,
    gameTitle: DEMO_QUIZ.title,
    mechanic: "quiz",
    themeId: "joyrest",
    playMode,
    playedAt: serverTimestamp(),
    participantsCount: GUESTS,
    board: compactBoard(final.leaderboard),
    savedAt: serverTimestamp(),
  });
  await batch.commit();
  write("пульт: завершение и итоги", 2);
  read("правила: проверки при входе", 1);
  await wait(3000);

  guests.forEach((g) => g.stop());
  hostSessionStop();
  participantsStop();
  screenStop();

  const top = compactBoard(final.leaderboard).slice(0, 3);
  console.log("\nТоп-3:", top.map((r) => `${r.name} — ${r.score}`).join("; "));
  console.log(`Ошибок записи: ${failures}. Время прогона: ${Math.round((Date.now() - started) / 1000)} с\n`);
  const table = (title: string, data: Record<string, number>) => {
    console.log(title);
    for (const [k, v] of Object.entries(data).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(36)} ${v}`);
    console.log(`  ${"ВСЕГО".padEnd(36)} ${sum(data)}`);
  };
  table("Чтения Firestore на игру:", reads);
  table("Записи Firestore на игру:", writes);
  console.log(`\nНа одного гостя: ${(sum(reads) / GUESTS).toFixed(1)} чтений, ${(sum(writes) / GUESTS).toFixed(1)} записей`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
