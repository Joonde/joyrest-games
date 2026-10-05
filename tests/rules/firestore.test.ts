import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const ADMIN = "bmBFBi7VmqVl7oIVyntw0QYRTYJ2";
const HOST = "host-1";
const OTHER_HOST = "host-2";
const GUEST = "guest-1";
const GUEST2 = "guest-2";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-joyrest",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
});

afterAll(async () => {
  await env.cleanup();
});

/** Ведущие и одна сессия в лобби, созданная HOST. */
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", HOST), { role: "host", name: "Ведущий", active: true });
    await setDoc(doc(db, "users", OTHER_HOST), { role: "host", name: "Другой", active: true });
    await setDoc(doc(db, "users", "off"), { role: "host", name: "Отключён", active: false });
    await setDoc(doc(db, "sessions", "s1"), sessionData(HOST));
  });
});

function sessionData(hostId: string, phase = "lobby", playMode = "solo") {
  return {
    code: "123456",
    hostId,
    mechanic: null,
    gameSnapshot: null,
    themeId: "joyrest",
    playMode,
    screenMode: "laptop",
    state: { phase, step: 0, startedAt: null, revealed: false },
    leaderboard: {},
    createdAt: serverTimestamp(),
  };
}

function as(uid: string) {
  return env.authenticatedContext(uid).firestore();
}

async function setSession(patch: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), "sessions", "s1"), patch);
  });
}

async function addParticipant(pid: string, data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "sessions", "s1", "participants", pid), data);
  });
}

describe("users", () => {
  it("ведущий читает свой профиль, но не чужой", async () => {
    await assertSucceeds(getDoc(doc(as(HOST), "users", HOST)));
    await assertFails(getDoc(doc(as(HOST), "users", OTHER_HOST)));
  });

  it("ведущий не может повысить себе роль", async () => {
    await assertFails(updateDoc(doc(as(HOST), "users", HOST), { role: "admin" }));
  });

  it("admin по UID создаёт свой профиль и профиль ведущего", async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), "users", ADMIN), { role: "admin", name: "Админ", active: true }));
    await assertSucceeds(setDoc(doc(as(ADMIN), "users", "new"), { role: "host", name: "Новый", active: true }));
  });

  it("гость не может создать себе профиль ведущего", async () => {
    await assertFails(setDoc(doc(as(GUEST), "users", GUEST), { role: "host", name: "Хакер", active: true }));
  });
});

describe("sessions", () => {
  it("активный ведущий создаёт сессию", async () => {
    await assertSucceeds(setDoc(doc(as(HOST), "sessions", "s2"), sessionData(HOST)));
  });

  it("гость и отключённый ведущий сессию не создают", async () => {
    await assertFails(setDoc(doc(as(GUEST), "sessions", "s2"), sessionData(GUEST)));
    await assertFails(setDoc(doc(as("off"), "sessions", "s2"), sessionData("off")));
  });

  it("нельзя создать сессию от имени другого ведущего", async () => {
    await assertFails(setDoc(doc(as(HOST), "sessions", "s2"), sessionData(OTHER_HOST)));
  });

  it("гость читает сессию и ищет её по коду с лимитом", async () => {
    await assertSucceeds(getDoc(doc(as(GUEST), "sessions", "s1")));
    await assertSucceeds(getDocs(query(collection(as(GUEST), "sessions"), where("code", "==", "123456"), limit(5))));
    await assertFails(getDocs(query(collection(as(GUEST), "sessions"), where("code", "==", "123456"))));
  });

  it("неавторизованный не читает сессию", async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "sessions", "s1")));
  });

  it("ведущий видит список своих сессий", async () => {
    await assertSucceeds(getDocs(query(collection(as(HOST), "sessions"), where("hostId", "==", HOST))));
  });

  it("state и leaderboard меняет только владелец сессии", async () => {
    await assertSucceeds(updateDoc(doc(as(HOST), "sessions", "s1"), { "state.phase": "playing" }));
    await assertSucceeds(
      updateDoc(doc(as(HOST), "sessions", "s1"), { "leaderboard.g": { name: "Г", kind: "player", score: 1 } }),
    );
    await assertFails(updateDoc(doc(as(OTHER_HOST), "sessions", "s1"), { "state.phase": "finished" }));
    await assertFails(updateDoc(doc(as(GUEST), "sessions", "s1"), { "leaderboard.g": { score: 100 } }));
  });

  it("владелец не может сменить код и владельца сессии", async () => {
    await assertFails(updateDoc(doc(as(HOST), "sessions", "s1"), { code: "654321" }));
    await assertFails(updateDoc(doc(as(HOST), "sessions", "s1"), { hostId: OTHER_HOST }));
  });
});

describe("participants", () => {
  const player = (name = "Анна", teamId: string | null = null, captainUid = GUEST) => ({
    name,
    kind: "player",
    teamId,
    captainUid,
    joinedAt: serverTimestamp(),
  });

  it("гость входит под своим uid", async () => {
    await assertSucceeds(setDoc(doc(as(GUEST), "sessions", "s1", "participants", GUEST), player()));
  });

  it("гость не может войти за другого", async () => {
    await assertFails(setDoc(doc(as(GUEST), "sessions", "s1", "participants", GUEST2), player("Анна", null, GUEST2)));
  });

  it("пустое имя не принимается", async () => {
    await assertFails(setDoc(doc(as(GUEST), "sessions", "s1", "participants", GUEST), player("")));
  });

  it("команду можно создать только в режиме teams", async () => {
    const team = { name: "Котики", kind: "team", teamId: null, captainUid: GUEST, joinedAt: serverTimestamp() };
    await assertFails(setDoc(doc(as(GUEST), "sessions", "s1", "participants", "t1"), team));
    await setSession({ playMode: "teams" });
    await assertSucceeds(setDoc(doc(as(GUEST), "sessions", "s1", "participants", "t1"), team));
  });

  it("телефон подключается только к существующей команде", async () => {
    await setSession({ playMode: "teams" });
    await addParticipant("t1", { name: "Котики", kind: "team", teamId: null, captainUid: GUEST2 });
    await assertSucceeds(setDoc(doc(as(GUEST), "sessions", "s1", "participants", GUEST), player("Анна", "t1")));
    await assertFails(setDoc(doc(as(GUEST2), "sessions", "s1", "participants", GUEST2), player("Боря", "nope", GUEST2)));
  });

  it("гость меняет своё имя, но не капитанство", async () => {
    await addParticipant(GUEST, { name: "Анна", kind: "player", teamId: null, captainUid: GUEST });
    await assertSucceeds(updateDoc(doc(as(GUEST), "sessions", "s1", "participants", GUEST), { name: "Аня" }));
    await assertFails(updateDoc(doc(as(GUEST), "sessions", "s1", "participants", GUEST), { captainUid: GUEST2 }));
    await assertFails(updateDoc(doc(as(GUEST2), "sessions", "s1", "participants", GUEST), { name: "Чужое" }));
  });

  it("в завершённую сессию войти нельзя", async () => {
    await setSession({ "state.phase": "finished" });
    await assertFails(setDoc(doc(as(GUEST), "sessions", "s1", "participants", GUEST), player()));
  });
});

describe("answers", () => {
  const answer = (step: number, pid: string, uid: string) => ({
    step,
    pid,
    uid,
    value: "A",
    submittedAt: serverTimestamp(),
  });

  beforeEach(async () => {
    await addParticipant(GUEST, { name: "Анна", kind: "player", teamId: null, captainUid: GUEST });
    await setSession({ "state.phase": "playing", "state.step": 2 });
  });

  it("игрок отвечает на текущий шаг", async () => {
    await assertSucceeds(setDoc(doc(as(GUEST), "sessions", "s1", "answers", `2_${GUEST}`), answer(2, GUEST, GUEST)));
  });

  it("повторный ответ не перезаписывает первый", async () => {
    const ref = doc(as(GUEST), "sessions", "s1", "answers", `2_${GUEST}`);
    await assertSucceeds(setDoc(ref, answer(2, GUEST, GUEST)));
    await assertFails(setDoc(ref, answer(2, GUEST, GUEST)));
  });

  it("нельзя ответить на другой шаг или с неверным id", async () => {
    await assertFails(setDoc(doc(as(GUEST), "sessions", "s1", "answers", `3_${GUEST}`), answer(3, GUEST, GUEST)));
    await assertFails(setDoc(doc(as(GUEST), "sessions", "s1", "answers", "random"), answer(2, GUEST, GUEST)));
  });

  it("время ответа ставит только сервер", async () => {
    await assertFails(
      setDoc(doc(as(GUEST), "sessions", "s1", "answers", `2_${GUEST}`), { ...answer(2, GUEST, GUEST), submittedAt: 0 }),
    );
  });

  it("нельзя ответить за другого участника", async () => {
    await assertFails(setDoc(doc(as(GUEST2), "sessions", "s1", "answers", `2_${GUEST}`), answer(2, GUEST, GUEST2)));
  });

  it("за команду отвечает только капитан", async () => {
    await addParticipant("t1", { name: "Котики", kind: "team", teamId: null, captainUid: GUEST2 });
    await assertSucceeds(setDoc(doc(as(GUEST2), "sessions", "s1", "answers", "2_t1"), answer(2, "t1", GUEST2)));
    await assertFails(setDoc(doc(as(GUEST), "sessions", "s1", "answers", "2_t1"), answer(2, "t1", GUEST)));
  });

  it("после показа ответа отвечать нельзя", async () => {
    await setSession({ "state.revealed": true });
    await assertFails(setDoc(doc(as(GUEST), "sessions", "s1", "answers", `2_${GUEST}`), answer(2, GUEST, GUEST)));
  });

  it("ответы читает только ведущий сессии", async () => {
    await assertSucceeds(setDoc(doc(as(GUEST), "sessions", "s1", "answers", `2_${GUEST}`), answer(2, GUEST, GUEST)));
    await assertSucceeds(getDoc(doc(as(HOST), "sessions", "s1", "answers", `2_${GUEST}`)));
    await assertFails(getDoc(doc(as(GUEST), "sessions", "s1", "answers", `2_${GUEST}`)));
    await assertFails(getDoc(doc(as(OTHER_HOST), "sessions", "s1", "answers", `2_${GUEST}`)));
  });
});

describe("users: управление ведущими", () => {
  const host = (name = "Новый", active = true) => ({
    role: "host",
    name,
    active,
    email: "new@joyrest.ru",
    createdAt: serverTimestamp(),
  });

  it("admin добавляет ведущего с почтой и датой", async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), "users", "new"), host()));
  });

  it("лишние поля в профиле не принимаются", async () => {
    await assertFails(setDoc(doc(as(ADMIN), "users", "new"), { ...host(), superpower: true }));
  });

  it("admin видит список ведущих, ведущий — нет", async () => {
    await assertSucceeds(getDocs(collection(as(ADMIN), "users")));
    await assertFails(getDocs(collection(as(HOST), "users")));
  });

  it("admin отключает и включает ведущего", async () => {
    await assertSucceeds(updateDoc(doc(as(ADMIN), "users", HOST), { active: false }));
    await assertSucceeds(updateDoc(doc(as(ADMIN), "users", HOST), { active: true }));
  });

  it("ведущий не может включить себя сам", async () => {
    await assertFails(updateDoc(doc(as("off"), "users", "off"), { active: true }));
  });

  it("отключённый ведущий видит свой профиль, но не создаёт сессии", async () => {
    await assertSucceeds(getDoc(doc(as("off"), "users", "off")));
    await assertFails(setDoc(doc(as("off"), "sessions", "s2"), sessionData("off")));
  });

  it("владельца агентства нельзя отключить или удалить", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", ADMIN), { role: "admin", name: "Админ", active: true });
      await setDoc(doc(ctx.firestore(), "users", "admin2"), { role: "admin", name: "Второй", active: true });
    });
    await assertFails(updateDoc(doc(as("admin2"), "users", ADMIN), { active: false }));
    await assertFails(updateDoc(doc(as("admin2"), "users", ADMIN), { role: "host" }));
    await assertFails(deleteDoc(doc(as("admin2"), "users", ADMIN)));
  });
});

function gameData(scope: "agency" | "personal", ownerId: string, title = "Квиз") {
  return {
    scope,
    ownerId,
    title,
    mechanic: "quiz",
    themeId: "joyrest",
    ageRating: "0+",
    content: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

async function seedGames() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "games", "p"), gameData("personal", HOST, "Моя"));
    await setDoc(doc(ctx.firestore(), "games", "a"), gameData("agency", ADMIN, "Общая"));
  });
}

describe("games", () => {
  it("личную игру создаёт ведущий для себя, общую — только admin", async () => {
    await assertSucceeds(setDoc(doc(as(HOST), "games", "g1"), gameData("personal", HOST)));
    await assertFails(setDoc(doc(as(HOST), "games", "g2"), gameData("agency", HOST)));
    await assertSucceeds(setDoc(doc(as(ADMIN), "games", "g2"), gameData("agency", ADMIN)));
    await assertFails(setDoc(doc(as(GUEST), "games", "g3"), gameData("personal", GUEST)));
  });

  it("нельзя создать игру для другого ведущего", async () => {
    await assertFails(setDoc(doc(as(HOST), "games", "g1"), gameData("personal", OTHER_HOST)));
  });

  it("отключённый ведущий не создаёт и не видит игры", async () => {
    await seedGames();
    await assertFails(setDoc(doc(as("off"), "games", "g1"), gameData("personal", "off")));
    await assertFails(getDoc(doc(as("off"), "games", "a")));
  });

  it("игра без названия или с лишними полями не сохраняется", async () => {
    await assertFails(setDoc(doc(as(HOST), "games", "g1"), gameData("personal", HOST, "")));
    await assertFails(setDoc(doc(as(HOST), "games", "g1"), { ...gameData("personal", HOST), hacked: true }));
    await assertFails(setDoc(doc(as(HOST), "games", "g1"), { ...gameData("personal", HOST), ageRating: "99+" }));
  });

  it("чужую личную игру не видно, общую видят все ведущие", async () => {
    await seedGames();
    await assertFails(getDoc(doc(as(OTHER_HOST), "games", "p")));
    await assertSucceeds(getDoc(doc(as(OTHER_HOST), "games", "a")));
    await assertFails(getDoc(doc(as(GUEST), "games", "a")));
  });

  it("ведущий загружает библиотеку и свои игры списком", async () => {
    await seedGames();
    await assertSucceeds(getDocs(query(collection(as(HOST), "games"), where("scope", "==", "agency"), limit(200))));
    await assertSucceeds(
      getDocs(
        query(collection(as(HOST), "games"), where("scope", "==", "personal"), where("ownerId", "==", HOST), limit(200)),
      ),
    );
    await assertFails(
      getDocs(
        query(collection(as(OTHER_HOST), "games"), where("scope", "==", "personal"), where("ownerId", "==", HOST)),
      ),
    );
  });

  it("общую игру правит только admin, ведущий копирует её себе", async () => {
    await seedGames();
    await assertFails(updateDoc(doc(as(HOST), "games", "a"), { title: "Моя теперь", updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(as(ADMIN), "games", "a"), { title: "Новая", updatedAt: serverTimestamp() }));
    await assertSucceeds(setDoc(doc(as(HOST), "games", "copy"), gameData("personal", HOST, "Общая")));
  });

  it("владелец правит свою игру, но не переносит её в библиотеку", async () => {
    await seedGames();
    await assertSucceeds(updateDoc(doc(as(HOST), "games", "p"), { title: "Новое", updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(as(HOST), "games", "p"), { scope: "agency", updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(as(HOST), "games", "p"), { ownerId: OTHER_HOST, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(as(OTHER_HOST), "games", "p"), { title: "Чужое", updatedAt: serverTimestamp() }));
  });

  it("удаляет игру только тот, кто может её править", async () => {
    await seedGames();
    await assertFails(deleteDoc(doc(as(OTHER_HOST), "games", "p")));
    await assertFails(deleteDoc(doc(as(HOST), "games", "a")));
    await assertSucceeds(deleteDoc(doc(as(HOST), "games", "p")));
    await assertSucceeds(deleteDoc(doc(as(ADMIN), "games", "a")));
  });
});

describe("автоочистка старых сессий", () => {
  beforeEach(async () => {
    await addParticipant(GUEST, { name: "Анна", kind: "player", teamId: null, captainUid: GUEST });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "sessions", "s1", "answers", `0_${GUEST}`), {
        step: 0,
        pid: GUEST,
        uid: GUEST,
        value: "A",
        submittedAt: serverTimestamp(),
      });
    });
  });

  it("admin находит старые сессии всех ведущих", async () => {
    const cutoff = new Date(Date.now() + 60_000);
    await assertSucceeds(getDocs(query(collection(as(ADMIN), "sessions"), where("createdAt", "<", cutoff), limit(20))));
    await assertFails(getDocs(query(collection(as(HOST), "sessions"), where("createdAt", "<", cutoff), limit(20))));
  });

  it("admin удаляет сессию с участниками и ответами", async () => {
    const db = as(ADMIN);
    await assertSucceeds(getDocs(collection(db, "sessions", "s1", "answers")));
    await assertSucceeds(deleteDoc(doc(db, "sessions", "s1", "answers", `0_${GUEST}`)));
    await assertSucceeds(deleteDoc(doc(db, "sessions", "s1", "participants", GUEST)));
    await assertSucceeds(deleteDoc(doc(db, "sessions", "s1")));
  });

  it("другой ведущий и гость чужую сессию не удаляют", async () => {
    await assertFails(deleteDoc(doc(as(OTHER_HOST), "sessions", "s1")));
    await assertFails(deleteDoc(doc(as(GUEST), "sessions", "s1", "participants", GUEST)));
    await assertFails(deleteDoc(doc(as(OTHER_HOST), "sessions", "s1", "answers", `0_${GUEST}`)));
  });
});

describe("results: история игр", () => {
  const result = (hostId = HOST) => ({
    hostId,
    code: "123456",
    gameTitle: "Квиз",
    mechanic: "quiz",
    themeId: "joyrest",
    playMode: "solo",
    playedAt: new Date(),
    participantsCount: 2,
    board: [
      { name: "Анна", score: 3 },
      { name: "Боря", score: 1 },
    ],
    savedAt: serverTimestamp(),
  });

  async function seedResult() {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "results", "s1"), result());
    });
  }

  it("ведущий завершает игру и сохраняет итоги одной записью", async () => {
    const db = as(HOST);
    const batch = writeBatch(db);
    batch.update(doc(db, "sessions", "s1"), { "state.phase": "finished" });
    batch.set(doc(db, "results", "s1"), result());
    await assertSucceeds(batch.commit());
  });

  it("чужие итоги не записать", async () => {
    await assertFails(setDoc(doc(as(OTHER_HOST), "results", "s1"), result(OTHER_HOST)));
    await assertFails(setDoc(doc(as(OTHER_HOST), "results", "s1"), result(HOST)));
    await assertFails(setDoc(doc(as(GUEST), "results", "s1"), result(HOST)));
  });

  it("владелец итогов — всегда ведущий сессии", async () => {
    await assertFails(setDoc(doc(as(HOST), "results", "s1"), result(OTHER_HOST)));
    await assertFails(setDoc(doc(as(HOST), "results", "nope"), result(HOST)));
  });

  it("admin сохраняет итоги чужой сессии перед автоочисткой", async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), "results", "s1"), result(HOST)));
  });

  it("итоги по ссылке открываются без входа", async () => {
    await seedResult();
    await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), "results", "s1")));
  });

  it("историю списком видит только её ведущий и admin", async () => {
    await seedResult();
    await assertSucceeds(getDocs(query(collection(as(HOST), "results"), where("hostId", "==", HOST))));
    await assertSucceeds(getDocs(query(collection(as(ADMIN), "results"), where("hostId", "==", HOST))));
    await assertFails(getDocs(query(collection(as(OTHER_HOST), "results"), where("hostId", "==", HOST))));
    await assertFails(getDocs(collection(env.unauthenticatedContext().firestore(), "results")));
  });

  it("гость с анонимным входом читает итоги по id, но не получает их списком", async () => {
    await seedResult();
    await assertSucceeds(getDoc(doc(as(GUEST), "results", "s1")));
    await assertFails(getDocs(collection(as(GUEST), "results")));
    await assertFails(getDocs(query(collection(as(GUEST), "results"), where("hostId", "==", HOST))));
    await assertFails(getDocs(query(collection(as(GUEST), "results"), where("code", "==", "123456"), limit(1))));
  });

  it("лишние поля и подмена времени не принимаются", async () => {
    await assertFails(setDoc(doc(as(HOST), "results", "s1"), { ...result(), extra: 1 }));
    await assertFails(setDoc(doc(as(HOST), "results", "s1"), { ...result(), savedAt: new Date(0) }));
  });
});
