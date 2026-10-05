import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, limit, query, collection, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
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

describe("games", () => {
  it("личную игру создаёт ведущий для себя, общую — только admin", async () => {
    const personal = { scope: "personal", ownerId: HOST, title: "Квиз" };
    const agency = { scope: "agency", ownerId: ADMIN, title: "Общий квиз" };
    await assertSucceeds(setDoc(doc(as(HOST), "games", "g1"), personal));
    await assertFails(setDoc(doc(as(HOST), "games", "g2"), agency));
    await assertSucceeds(setDoc(doc(as(ADMIN), "games", "g2"), agency));
    await assertFails(setDoc(doc(as(GUEST), "games", "g3"), { ...personal, ownerId: GUEST }));
  });

  it("чужую личную игру не видно, общую видят все ведущие", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "games", "p"), { scope: "personal", ownerId: HOST, title: "Моя" });
      await setDoc(doc(ctx.firestore(), "games", "a"), { scope: "agency", ownerId: ADMIN, title: "Общая" });
    });
    await assertFails(getDoc(doc(as(OTHER_HOST), "games", "p")));
    await assertSucceeds(getDoc(doc(as(OTHER_HOST), "games", "a")));
    await assertFails(getDoc(doc(as(GUEST), "games", "a")));
  });
});
