/**
 * Проверка студии и кабинета владельца на test.games.joy-rest.ru (CLAUDE.md, раздел 9): всё, что
 * делают владелец агентства и ведущие, по настоящим REST-запросам — и что каждая правка
 * сохраняется (записали → прочитали заново → то же самое).
 *
 *   TEST_ADMIN_EMAIL=… TEST_ADMIN_PASSWORD=… npx tsx scripts/studio.ts
 *
 * Ведущий для проверки — studio-check@joy-rest.ru на test (создаётся при первом запуске, потом ему
 * каждый раз выдаётся новый временный пароль). Удалить ведущего нельзя — в конце он отключается.
 * Только тестовый адрес. Код выхода 1 — если хоть одна проверка не прошла.
 */
import { DEFAULTS, type QuizContent } from "../src/mechanics/quiz/content";

const BASE = (process.env.LOAD_BASE ?? "https://test.games.joy-rest.ru").replace(/\/$/, "");
const ADMIN_EMAIL = (process.env.TEST_ADMIN_EMAIL ?? "").trim();
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? "";
const HOST_EMAIL = "studio-check@joy-rest.ru";

const report: string[] = [];
let passed = 0;
const failures: string[] = [];
const statuses = { s5xx: 0, total: 0 };

function say(line: string): void {
  report.push(line);
  console.log(line);
}
function check(ok: boolean, what: string, detail = ""): boolean {
  if (ok) passed += 1;
  else {
    failures.push(detail ? `${what}: ${detail}` : what);
    say(`  ❌ ${what}${detail ? ` — ${detail}` : ""}`);
  }
  return ok;
}
function finish(code: number): never {
  if (process.env.GITHUB_ACTIONS === "true") {
    const text = report.join("\n").replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, "%0A");
    console.log(`::${code === 0 ? "notice" : "error"} title=Студия и владелец::${text.slice(0, 60000)}`);
  }
  process.exit(code);
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const uid = () => `st${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

class Device {
  cookies = new Map<string, string>();
  constructor(readonly label: string) {}

  async raw(method: string, path: string, body?: unknown, extra?: Record<string, string>): Promise<Response> {
    const write = method !== "GET";
    const headers: Record<string, string> = { Accept: "application/json" };
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    if (write) Object.assign(headers, { "Content-Type": "application/json", "X-JoyRest": "1", Origin: BASE });
    const res = await fetch(BASE + path, {
      method,
      headers: { ...headers, ...extra },
      body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
    });
    statuses.total += 1;
    if (res.status >= 500) statuses.s5xx += 1;
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const i = pair?.indexOf("=") ?? -1;
      if (pair && i > 0) {
        const value = pair.slice(i + 1);
        if (value) this.cookies.set(pair.slice(0, i), value);
        else this.cookies.delete(pair.slice(0, i));
      }
    }
    return res;
  }

  async call<T = Record<string, unknown>>(method: "GET" | "POST" | "DELETE" | "PATCH", path: string, body?: unknown): Promise<T> {
    const res = await this.raw(method, path, method === "GET" ? undefined : (body ?? {}));
    const text = await res.text();
    const data = (text ? JSON.parse(text) : null) as T & { error?: string };
    if (!res.ok) throw new Error(`${this.label} ${method} ${path}: ${res.status} ${data?.error ?? ""}`);
    return data;
  }

  async status(method: "GET" | "POST" | "DELETE" | "PATCH", path: string, body?: unknown): Promise<number> {
    const res = await this.raw(method, path, method === "GET" ? undefined : (body ?? {}));
    await res.text();
    return res.status;
  }
}

/** Маленькая «картинка» WebP: сервер проверяет тип по первым байтам. */
function webp(seed: number, size = 2048): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  for (let i = 12; i < size; i++) bytes[i] = (i * 31 + seed * 17) % 251;
  return bytes;
}
function mp3(seed: number): Uint8Array {
  const bytes = new Uint8Array(4096);
  bytes.set([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]);
  for (let i = 10; i < bytes.length; i++) bytes[i] = (i + seed) % 256;
  return bytes;
}

function content(title: string, n: number): QuizContent {
  return {
    questions: Array.from({ length: n }, (_, i) => ({
      id: `q${i}`,
      kind: "choice" as const,
      text: `${title}: вопрос ${i + 1} — «ёлка», кавычки, эмодзи 🎄 и длинный русский текст ${"абв ".repeat(20)}`,
      options: ["Первый", "Второй", "Третий"],
      correct: i % 3,
      answers: [],
      ...DEFAULTS.choice,
      imageId: i === 0 ? "img1" : null,
      round: i === 0 ? "Раунд один" : null,
    })),
  };
}

/** JSON с ключами по алфавиту: PostgreSQL (jsonb) хранит ключи в своём порядке, значения те же. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : v,
  );
}

async function login(device: Device, email: string, password: string): Promise<boolean> {
  return (await device.status("POST", "/api/auth/login", { email, password })) === 200;
}

async function main() {
  if (!/^https:\/\/test\./.test(BASE)) {
    say(`Отказ: проверка только на тестовом адресе (сейчас ${BASE}).`);
    finish(2);
  }
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    say("Нужны секреты TEST_ADMIN_EMAIL и TEST_ADMIN_PASSWORD — владелец на тестовом адресе (sudo joyrest admin-password test).");
    finish(2);
  }
  const health = await fetch(`${BASE}/health`).then((r) => r.json() as Promise<{ version?: string }>);
  say(`Студия и владелец на ${BASE}, версия ${String(health.version ?? "?").slice(0, 7)}`);

  // ------------------------------------------------ владелец: вход и ведущие
  say("\n— Владелец: вход, ведущие, пароли —");
  const admin = new Device("владелец");
  check(!(await login(admin, ADMIN_EMAIL, "неверный-пароль-123")), "неверный пароль не пускает");
  if (!check(await login(admin, ADMIN_EMAIL, ADMIN_PASSWORD), "владелец входит")) finish(1);
  const me = await admin.call<{ profile: { role: string; uid: string } }>("GET", "/api/auth/me");
  check(me.profile.role === "admin", "роль — владелец агентства");
  const adminUid = me.profile.uid;

  // Ведущий для проверки: создать или выдать новый временный пароль.
  let hostUid = "";
  let temp = "";
  const createdRes = await admin.raw("POST", "/api/users", { email: HOST_EMAIL, name: "Проверка Студии" });
  const createdText = await createdRes.text();
  if (createdRes.ok) {
    const created = JSON.parse(createdText) as { account: { uid: string }; temporaryPassword: string };
    hostUid = created.account.uid;
    temp = created.temporaryPassword;
    say("  ведущий для проверки создан");
  } else {
    check(createdRes.status === 409, "повторное создание той же почты — «уже есть»", String(createdRes.status));
    const users = await admin.call<Array<{ uid: string; email: string }>>("GET", "/api/users");
    hostUid = users.find((u) => u.email === HOST_EMAIL)?.uid ?? "";
    check(Boolean(hostUid), "ведущий для проверки в списке");
    await admin.call("POST", `/api/users/${hostUid}/active`, { active: true });
    temp = (await admin.call<{ temporaryPassword: string }>("POST", `/api/users/${hostUid}/password`)).temporaryPassword;
  }
  check(temp.length >= 8, "временный пароль выдан");
  const users = await admin.call<Array<{ uid: string; email: string; points: number; active: boolean }>>("GET", "/api/users");
  check(users.some((u) => u.uid === hostUid && u.active), "ведущий в списке и включён");

  // ------------------------------------------------ ведущий: первый вход и смена пароля
  say("\n— Ведущий: первый вход, свой пароль, сеансы —");
  const host = new Device("ведущий");
  check(await login(host, HOST_EMAIL, temp), "ведущий входит по временному паролю");
  const hostMe = await host.call<{ profile: { mustChangePassword: boolean; role: string } }>("GET", "/api/auth/me");
  check(hostMe.profile.mustChangePassword === true && hostMe.profile.role === "host", "студия просит сменить временный пароль");
  const tablet = new Device("планшет ведущего");
  await login(tablet, HOST_EMAIL, temp);
  check((await host.status("POST", "/api/auth/password", { currentPassword: temp, newPassword: "123" })) === 400, "слишком простой пароль не принимается");
  check((await host.status("POST", "/api/auth/password", { currentPassword: "не-тот", newPassword: "Новый-пароль-ведущего-2026" })) === 401, "неверный текущий пароль — отказ");
  const ownPassword = `Свой-пароль-${Date.now().toString(36)}`;
  check((await host.status("POST", "/api/auth/password", { currentPassword: temp, newPassword: ownPassword })) === 200, "ведущий задаёт свой пароль");
  check((await host.call<{ profile: { mustChangePassword: boolean } }>("GET", "/api/auth/me")).profile.mustChangePassword === false, "после смены студия больше не просит пароль");
  check((await tablet.call<{ profile: unknown }>("GET", "/api/auth/me")).profile === null, "смена пароля закрыла другие сеансы");
  check(!(await login(new Device("x"), HOST_EMAIL, temp)), "старый временный пароль больше не подходит");

  // Права: ведущий не владелец.
  check((await host.status("GET", "/api/users")) === 403, "ведущий не видит список ведущих");
  check((await host.status("POST", `/api/users/${hostUid}/level`, { level: "top", experienceSince: null })) === 403, "ведущий не меняет себе квалификацию");
  check((await host.status("GET", `/api/users/${hostUid}/points`)) === 403, "ведущий не видит баллы");
  check((await host.status("POST", "/api/users", { email: "x@joy-rest.ru", name: "Икс" })) === 403, "ведущий не создаёт ведущих");
  check((await host.status("GET", "/api/proposals?status=pending")) === 403, "ведущий не видит чужие предложения");
  check((await host.status("GET", "/api/tracks?status=pending")) === 403, "ведущий не проверяет музыку");

  // ------------------------------------------------ квалификация и баллы
  say("\n— Владелец: квалификация, стаж, баллы —");
  check((await admin.status("POST", `/api/users/${hostUid}/level`, { level: "novice", experienceSince: "2025-03-01" })) === 200, "квалификация и «опыт с» сохранены");
  const prof = await host.call<{ profile: { level: string; experienceSince: number } }>("GET", "/api/auth/me");
  check(prof.profile.level === "novice" && new Date(prof.profile.experienceSince).toISOString().startsWith("2025-03-01"), "ведущий видит свою квалификацию и стаж");
  const before = (await admin.call<{ total: number }>("GET", `/api/users/${hostUid}/points`)).total;
  const pointId = uid();
  check((await admin.status("POST", `/api/users/${hostUid}/points`, { id: pointId, points: 1.5, reason: "Проверка студии" })) === 200, "ручные баллы начислены");
  await admin.status("POST", `/api/users/${hostUid}/points`, { id: pointId, points: 1.5, reason: "Проверка студии" });
  check((await admin.status("POST", `/api/users/${hostUid}/points`, { id: uid(), points: 0.3, reason: "x" })) === 400, "баллы — только шаг 0,5");
  check((await admin.status("POST", `/api/users/${hostUid}/points`, { id: uid(), points: 1, reason: "  " })) === 400, "без комментария баллы не начисляются");
  await admin.status("POST", `/api/users/${hostUid}/points`, { id: uid(), points: -1.5, reason: "Проверка: снять обратно" });
  const after = (await admin.call<{ total: number }>("GET", `/api/users/${hostUid}/points`)).total;
  check(after === before, "повтор не начислил дважды, снятие вернуло сумму", `${before} → ${after}`);
  const listed = (await admin.call<Array<{ uid: string; points: number }>>("GET", "/api/users")).find((u) => u.uid === hostUid);
  check(listed?.points === after, "сумма баллов в списке ведущих совпадает");

  // ------------------------------------------------ профиль и команда
  say("\n— Ведущий: профиль и «Команда JoyRest» —");
  const bio = "Веду свадьбы и корпоративы 🎤 — проверка «о себе»";
  check((await host.status("POST", "/api/team/me", { bio })) === 200, "«о себе» сохранено");
  const long = await host.call<{ bio: string }>("POST", "/api/team/me", { bio: "x".repeat(400) });
  check(long.bio.length === 300, "«о себе» обрезается до 300 символов", String(long.bio.length));
  await host.call("POST", "/api/team/me", { bio });
  const avatar = await host.raw("PUT", "/api/team/me/avatar", webp(1), { "Content-Type": "image/webp" });
  await avatar.text();
  check(avatar.ok, "аватарка загружена", String(avatar.status));
  const cover = await host.raw("PUT", "/api/team/me/cover", webp(2, 4096), { "Content-Type": "image/webp" });
  await cover.text();
  check(cover.ok, "обложка загружена", String(cover.status));
  const team = await host.call<Array<{ uid: string; bio: string; avatar: string | null; cover: string | null; email?: string }>>("GET", "/api/team");
  const card = team.find((m) => m.uid === hostUid);
  check(card?.bio === bio && Boolean(card?.avatar) && Boolean(card?.cover), "карточка в «Команде JoyRest»: о себе, аватарка, обложка");
  check(!JSON.stringify(team).includes("@"), "в «Команде» нет почт");
  check(!/points|level/i.test(JSON.stringify(team)), "в «Команде» нет баллов и квалификации");
  const adminTeam = await admin.call<Array<{ uid: string }>>("GET", "/api/team");
  check(adminTeam.some((m) => m.uid === hostUid), "владелец видит карточку ведущего");
  const img = await admin.raw("GET", `/api/team/${hostUid}/avatar`);
  await img.arrayBuffer();
  check(img.ok, "аватарка открывается");

  // ------------------------------------------------ игры: создание, автосохранение, копии
  say("\n— Ведущий: игры, автосохранение, картинки, копии —");
  const gameId = uid();
  const base = { scope: "personal", ownerId: hostUid, mechanic: "quiz", themeId: "joyrest", ageRating: "0+", playMode: "solo" };
  check((await host.status("POST", "/api/games", { id: gameId, ...base, title: "Проверка: моя игра", content: content("Черновик", 3) })) === 200, "новая игра создана");
  check((await host.status("POST", "/api/games", { id: gameId, ...base, title: "Проверка: моя игра", content: content("Черновик", 3) })) === 200, "повтор после обрыва — та же игра");
  // Автосохранение: 12 правок подряд по одной, как конструктор; в конце — то же, что последняя.
  let last = content("Черновик", 3);
  for (let i = 1; i <= 12; i++) {
    last = content(`Правка ${i}`, 3 + (i % 5));
    check((await host.status("PATCH", `/api/games/${gameId}`, { content: last, title: `Проверка: правка ${i}` })) === 200, `правка ${i} сохранена`);
  }
  const saved = await host.call<{ title: string; content: QuizContent }>("GET", `/api/games/${gameId}`);
  check(saved.title === "Проверка: правка 12" && canonical(saved.content) === canonical(last), "после 12 правок сохранена последняя, текст без искажений");
  // Большая игра на русском (≈200 КБ) сохраняется целиком.
  const big = content("Большая игра", 60);
  check((await host.status("PATCH", `/api/games/${gameId}`, { content: big })) === 200, "большая игра (60 вопросов) сохраняется");
  const bigSaved = await host.call<{ content: QuizContent }>("GET", `/api/games/${gameId}`);
  check(bigSaved.content.questions.length === 60, "большая игра прочитана целиком");
  await host.status("PATCH", `/api/games/${gameId}`, { content: last });

  // Картинки: три варианта, повтор той же — успех, другая под тем же id — нельзя.
  for (const [variant, size] of [["full", 30_000], ["small", 8_000], ["hd", 60_000]] as const) {
    const put = await host.raw("PUT", `/api/media/${gameId}/img1/${variant}`, webp(variant.length, size), { "Content-Type": "image/webp", "X-Width": "800", "X-Height": "600" });
    await put.text();
    check(put.ok, `картинка ${variant} загружена`, String(put.status));
  }
  const again = await host.raw("PUT", `/api/media/${gameId}/img1/full`, webp(4, 30_000), { "Content-Type": "image/webp", "X-Width": "800", "X-Height": "600" });
  await again.text();
  check(again.status === 200, "та же картинка повторно — успех");
  const other = await host.raw("PUT", `/api/media/${gameId}/img1/full`, webp(99, 30_000), { "Content-Type": "image/webp", "X-Width": "800", "X-Height": "600" });
  await other.text();
  check(other.status === 409, "другая картинка под тем же id — нельзя", String(other.status));
  const fake = await host.raw("PUT", `/api/media/${gameId}/img2/full`, new TextEncoder().encode("<html>не картинка</html>"), { "Content-Type": "image/webp", "X-Width": "1", "X-Height": "1" });
  await fake.text();
  check(fake.status === 400, "не картинка не загружается", String(fake.status));
  const pic = await host.raw("GET", `/api/media/${gameId}/img1/full`);
  await pic.arrayBuffer();
  check(pic.ok, "картинка открывается");

  // Копия своей игры — с теми же картинками.
  const copyId = uid();
  check((await host.status("POST", `/api/games/${copyId}/copy`, { sourceId: gameId, mediaIds: ["img1"], game: { ...base, title: "Проверка: копия", content: last } })) === 200, "копия игры создана");
  const copyPic = await host.raw("GET", `/api/media/${copyId}/img1/small`);
  await copyPic.arrayBuffer();
  check(copyPic.ok, "у копии те же картинки");
  const mine = await host.call<Array<{ id: string }>>("GET", `/api/games?scope=personal&owner=${hostUid}`);
  check(mine.some((g) => g.id === gameId) && mine.some((g) => g.id === copyId), "обе игры в «Моих играх»");

  // Чужое: ведущий не видит личные игры других и не правит библиотеку.
  const agency = await admin.call<Array<{ id: string }>>("GET", "/api/games?scope=agency");
  if (agency[0]) check((await host.status("PATCH", `/api/games/${agency[0].id}`, { title: "Взлом" })) === 403, "ведущий не правит игры библиотеки");
  check((await host.status("GET", `/api/games?scope=personal&owner=${adminUid}`)) === 403, "ведущий не видит личные игры других");
  check((await host.status("POST", "/api/games", { id: uid(), ...base, scope: "agency", title: "Взлом" })) === 403, "ведущий не создаёт игры в библиотеке");

  // ------------------------------------------------ предложения в библиотеку
  say("\n— Предложения в библиотеку —");
  const propId = uid();
  const prop = await host.call<{ id: string; status: string }>("POST", "/api/proposals", { id: propId, gameId });
  check(prop.status === "pending", "игра предложена в библиотеку");
  const dup = await host.call<{ id: string }>("POST", "/api/proposals", { id: uid(), gameId });
  check(dup.id === prop.id, "повторное предложение — то же самое");
  const pending = await admin.call<Array<{ id: string }>>("GET", "/api/proposals?status=pending");
  check(pending.some((p) => p.id === prop.id), "владелец видит предложение");
  const accepted = await admin.call<{ status: string; libraryGameId: string | null }>("POST", `/api/proposals/${prop.id}/accept`);
  check(accepted.status === "accepted" && Boolean(accepted.libraryGameId), "владелец принял предложение");
  const libGameId = accepted.libraryGameId ?? "";
  const lib = await host.call<{ scope: string; title: string }>("GET", `/api/games/${libGameId}`);
  check(lib.scope === "agency" && lib.title === "Проверка: правка 12", "игра появилась в библиотеке");
  const libPic = await host.raw("GET", `/api/media/${libGameId}/img1/full`);
  await libPic.arrayBuffer();
  check(libPic.ok, "картинки игры библиотеки на месте");
  check((await host.status("GET", `/api/games/${gameId}`)) === 200, "игра ведущего осталась у него");
  // Повторное предложение после правки — обновляет ту же игру библиотеки.
  await host.status("PATCH", `/api/games/${gameId}`, { title: "Проверка: правка после принятия" });
  const prop2 = await host.call<{ id: string }>("POST", "/api/proposals", { id: uid(), gameId });
  const accepted2 = await admin.call<{ libraryGameId: string | null }>("POST", `/api/proposals/${prop2.id}/accept`);
  check(accepted2.libraryGameId === libGameId, "принятая повторно игра обновила ту же игру библиотеки, без дубля");
  check((await host.call<{ title: string }>("GET", `/api/games/${libGameId}`)).title === "Проверка: правка после принятия", "в библиотеке — новая версия");
  const prop3 = await host.call<{ id: string }>("POST", "/api/proposals", { id: uid(), gameId: copyId });
  const rejected = await admin.call<{ status: string; reason: string }>("POST", `/api/proposals/${prop3.id}/reject`, { reason: "Нужно больше вопросов" });
  check(rejected.status === "rejected" && rejected.reason === "Нужно больше вопросов", "отклонение с причиной");
  const minePr = await host.call<Array<{ id: string; status: string; reason: string | null }>>("GET", "/api/proposals?mine=1");
  check(minePr.find((p) => p.id === prop3.id)?.reason === "Нужно больше вопросов", "ведущий видит причину отказа");

  // ------------------------------------------------ музыка
  say("\n— Музыка: свои треки, общая библиотека —");
  const trackId = uid();
  check((await host.status("POST", "/api/tracks", { id: trackId, title: "Проверка: лобби", category: "lobby", license: "other" })) === 400, "«другое» без пояснения — нельзя");
  check((await host.status("POST", "/api/tracks", { id: trackId, title: "Проверка: лобби", category: "lobby", license: "pixabay" })) === 200, "трек описан");
  const put = await host.raw("PUT", `/api/tracks/${trackId}/file`, mp3(1), { "Content-Type": "audio/mpeg", "X-Duration": "61000" });
  await put.text();
  check(put.ok, "файл трека загружен", String(put.status));
  const video = await host.raw("PUT", `/api/tracks/${uid()}/file`, new TextEncoder().encode("<html>"), { "Content-Type": "audio/mpeg" });
  await video.text();
  check(video.status === 400 || video.status === 404, "не звук не загружается");
  const shared = await host.call<{ shareStatus: string }>("POST", `/api/tracks/${trackId}/share`);
  check(shared.shareStatus === "pending", "трек предложен в общую");
  const tp = await admin.call<Array<{ id: string }>>("GET", "/api/tracks?status=pending");
  check(tp.some((t) => t.id === trackId), "владелец видит трек на проверке");
  const ta = await admin.call<{ shareStatus: string; libraryTrackId?: string | null }>("POST", `/api/tracks/${trackId}/accept`);
  check(ta.shareStatus === "accepted", "трек принят в общую");
  const lists = await host.call<{ mine: Array<{ id: string }>; library: Array<{ id: string; title: string }> }>("GET", "/api/tracks");
  check(lists.mine.some((t) => t.id === trackId) && lists.library.some((t) => t.title === "Проверка: лобби"), "трек и у ведущего, и в общей");
  const t2 = uid();
  await host.status("POST", "/api/tracks", { id: t2, title: "Проверка: отклонить", category: "background", license: "own" });
  const put2 = await host.raw("PUT", `/api/tracks/${t2}/file`, mp3(2), { "Content-Type": "audio/mpeg", "X-Duration": "30000" });
  await put2.text();
  await host.call("POST", `/api/tracks/${t2}/share`);
  const tr = await admin.call<{ shareStatus: string; shareReason: string | null }>("POST", `/api/tracks/${t2}/reject`, { reason: "Плохое качество" });
  check(tr.shareStatus === "rejected", "трек отклонён с причиной");
  const libTrack = lists.library.find((t) => t.title === "Проверка: лобби");
  if (libTrack) check((await host.status("PATCH", `/api/tracks/${libTrack.id}`, { title: "Взлом" })) === 403, "ведущий не правит общий трек");

  // ------------------------------------------------ история игр
  say("\n— История игр —");
  const sessionId = uid();
  await host.call("POST", "/api/sessions", { id: sessionId, gameId, gameTitle: "Проверка: история", mechanic: "quiz", gameSnapshot: { title: "x", mechanic: "quiz", themeId: "joyrest", content: last }, themeId: "joyrest", playMode: "solo", screenMode: "laptop" });
  await host.call("POST", `/api/sessions/${sessionId}/leaderboard`, { entries: { p1: { name: "Аня", kind: "player", score: 0 } } });
  await host.call("POST", `/api/sessions/${sessionId}/apply`, { state: { phase: "playing", step: 0, stage: "ready" }, expect: { phase: "lobby" } });
  await host.call("POST", `/api/sessions/${sessionId}/apply`, { addScore: { p1: 300 } });
  await host.call("POST", `/api/sessions/${sessionId}/finish`, { participantsCount: 1 });
  const history = await host.call<Array<{ id: string; board: Array<{ name: string; score: number }> }>>("GET", `/api/results?host=${hostUid}`);
  const item = history.find((h) => h.id === sessionId);
  check(item?.board[0]?.name === "Аня" && item.board[0].score === 300, "игра в «Истории игр» с итогами");
  check((await new Device("гость по ссылке").status("GET", `/api/results/${sessionId}`)) === 200, "итоги открываются по ссылке без входа");
  check((await host.status("GET", `/api/results?host=${adminUid}`)) === 403, "ведущий не видит историю других");
  const cleanup = await admin.call<{ deleted: number }>("POST", "/api/sessions/cleanup", { cutoff: Date.now() });
  check(typeof cleanup.deleted === "number", "автоочистка владельца работает");
  check((await host.status("GET", `/api/results/${sessionId}`)) === 200, "автоочистка не тронула свежую игру");

  // ------------------------------------------------ база площадок
  say("\n— База площадок —");
  const guestPhone = new Device("площадка");
  const formsStatus = await guestPhone.call<{ open: boolean }>("GET", "/api/venue-forms/status");
  check(formsStatus.open === true, "анкеты на test открыты");
  const venueId = uid();
  const venueData = {
    name: "Проверка: Белая веранда",
    type: "Ресторан",
    address: "ул. Проверочная, 1",
    person: "Тестовый Администратор",
    phone: "+7 900 000-00-99",
    seated: 90,
    standing: 140,
    dance: true,
    layouts: ["Круглые столы"],
    features: ["Панорамные окна"],
    perGuest: 5000,
    district: "ЦАО",
    metro: "Проверочная",
  };
  const missingVenue = await guestPhone.raw("POST", "/api/venue-forms/venue", { id: venueId, data: { name: "x" }, consent: true });
  check(missingVenue.status === 400, "анкета без обязательных полей не принимается", String(missingVenue.status));
  const sentVenue = await guestPhone.call<{ uploadToken: string }>("POST", "/api/venue-forms/venue", { id: venueId, from: hostUid, data: venueData, consent: true, photoFiles: 1, menuFiles: 1 });
  check(sentVenue.uploadToken.length > 16, "анкета площадки принята без входа");
  const photoUp = await guestPhone.raw("PUT", `/api/venue-forms/venue/${venueId}/files/photo`, webp(41), { "Content-Type": "image/webp", "X-Upload-Token": sentVenue.uploadToken });
  check(photoUp.ok, "фото площадки загружено по токену анкеты", String(photoUp.status));
  const badToken = await guestPhone.raw("PUT", `/api/venue-forms/venue/${venueId}/files/menu`, webp(42), { "Content-Type": "image/webp", "X-Upload-Token": "чужой-токен-1234567890" });
  check(badToken.status === 403, "без своего токена файл не загрузить", String(badToken.status));
  const menuUp = await guestPhone.raw("PUT", `/api/venue-forms/venue/${venueId}/files/menu`, webp(43), { "Content-Type": "image/webp", "X-Upload-Token": sentVenue.uploadToken });
  check(menuUp.ok, "меню загружено", String(menuUp.status));
  const requestId = uid();
  const requestData = { name: "Тестовый Клиент", phone: "+7 900 000-00-98", eventType: "Свадьба", guests: 70, format: "banquet", budget: 6000, wishes: { dance: 2, round: 1 } };
  const sentRequest = await guestPhone.call<{ number: number }>("POST", "/api/venue-forms/request", { id: requestId, from: hostUid, data: requestData, consent: true, ack: true });
  check(sentRequest.number > 0, "заявка клиента получила номер", String(sentRequest.number));
  const requestAgain = await guestPhone.call<{ number: number }>("POST", "/api/venue-forms/request", { id: requestId, data: requestData, consent: true, ack: true });
  check(requestAgain.number === sentRequest.number, "повтор после обрыва — тот же номер");
  check((await guestPhone.status("GET", "/api/venues")) === 401, "гость не видит базу");
  check((await host.status("GET", "/api/venues")) === 403, "ведущий без доступа не видит базу");
  check((await host.status("GET", "/api/venue-requests")) === 403, "ведущий без доступа не видит заявки");
  const baseList = await admin.call<Array<{ id: string; status: string; hostName: string | null; files: Array<{ kind: string }>; data: { phone: string } }>>("GET", "/api/venues");
  const inBase = baseList.find((v) => v.id === venueId);
  check(inBase?.status === "new" && inBase.files.length === 2, "площадка в базе со статусом «Новая», фото и меню на месте");
  check(inBase?.hostName === "Проверка Студии", "видно, какой ведущий привёл площадку", String(inBase?.hostName));
  check((await admin.status("PATCH", `/api/venues/${venueId}`, { status: "checked", rating: 4, notes: "Проверочная заметка" })) === 200, "владелец меняет статус, оценку и заметки");
  const reread = await admin.call<{ status: string; rating: number; notes: string }>("GET", `/api/venues/${venueId}`);
  check(reread.status === "checked" && reread.rating === 4 && reread.notes === "Проверочная заметка", "статус, оценка и заметки сохранились");
  const reqList = await admin.call<Array<{ id: string; number: number; status: string }>>("GET", "/api/venue-requests");
  check(reqList.some((r) => r.id === requestId && r.number === sentRequest.number && r.status === "new"), "заявка во вкладке заявок с номером и статусом «Новая»");
  check((await admin.status("POST", `/api/users/${hostUid}/venue-access`, { access: true })) === 200, "владелец открыл ведущему базу");
  check((await host.status("GET", "/api/venues")) === 200, "ведущий с доступом видит базу");
  const offer = await host.call<{ id: string; items: Array<{ name: string; ok: string[] }> }>("POST", "/api/venue-offers", { requestId, venueIds: [venueId], comment: "Проверка" });
  check(offer.items[0]?.name === venueData.name && (offer.items[0]?.ok ?? []).includes("танцпол"), "предложение собрано из базы, совпадения посчитаны");
  const publicOffer = await new Device("клиент").raw("GET", `/api/offers/${offer.id}`);
  const publicText = await publicOffer.text();
  check(publicOffer.ok, "клиент открывает предложение без входа");
  check(!/000-00-9|Проверочная, 1|Тестовый|Проверочная заметка/.test(publicText), "в предложении нет телефонов, адреса, имён и наших заметок");
  const afterOffer = await admin.call<{ status: string; offers: number }>("GET", `/api/venue-requests/${requestId}`);
  check(afterOffer.status === "sent" && afterOffer.offers === 1, "заявка стала «Предложение отправлено»");
  await admin.status("POST", `/api/users/${hostUid}/venue-access`, { access: false });
  check((await host.status("GET", "/api/venues")) === 403, "доступ закрыт обратно");
  check((await admin.status("DELETE", `/api/venues/${venueId}`)) === 200, "площадка удалена");
  check((await new Device("клиент 2").status("GET", `/api/offers/${offer.id}`)) === 200, "отправленная ссылка открывается и после удаления площадки");
  check((await admin.status("DELETE", `/api/venue-requests/${requestId}`)) === 200, "заявка удалена");

  // ------------------------------------------------ отключение ведущего
  say("\n— Отключение ведущего —");
  check((await admin.status("POST", `/api/users/${adminUid}/active`, { active: false })) === 403, "владельца отключить нельзя");
  check((await admin.status("POST", `/api/users/${hostUid}/active`, { active: false })) === 200, "ведущий отключён");
  check((await host.status("GET", `/api/games?scope=personal&owner=${hostUid}`)) !== 200, "отключённый ведущий выброшен из студии");
  check(!(await login(new Device("y"), HOST_EMAIL, ownPassword)), "отключённый ведущий не входит");
  await admin.status("POST", `/api/users/${hostUid}/active`, { active: true });
  const back = new Device("ведущий снова");
  check(await login(back, HOST_EMAIL, ownPassword), "включённый снова ведущий входит своим паролем");
  const stillThere = await back.call<{ title: string }>("GET", `/api/games/${gameId}`);
  check(stillThere.title === "Проверка: правка после принятия", "игры ведущего сохранились");

  // ------------------------------------------------ уборка за собой
  await back.status("DELETE", `/api/tracks/${trackId}`);
  await back.status("DELETE", `/api/tracks/${t2}`);
  if (libTrack) await admin.status("DELETE", `/api/tracks/${libTrack.id}`);
  await back.status("DELETE", `/api/media/${copyId}/img1`);
  check((await back.status("DELETE", `/api/games/${copyId}`)) === 200, "копия удалена");
  check((await back.status("GET", `/api/games/${copyId}`)) === 404, "удалённой игры больше нет");
  await back.status("DELETE", `/api/games/${gameId}`);
  await admin.status("DELETE", `/api/games/${libGameId}`);
  await back.status("DELETE", "/api/team/me/avatar");
  await back.status("DELETE", "/api/team/me/cover");
  await admin.status("POST", `/api/users/${hostUid}/active`, { active: false });
  check((await back.status("POST", "/api/auth/logout")) === 200, "выход");
  await wait(100);

  check(statuses.s5xx === 0, "ни одного сбоя сервера (5xx)", String(statuses.s5xx));
  say(`\nИтог: проверок пройдено ${passed}, не пройдено ${failures.length}. Запросов: ${statuses.total}.`);
  if (failures.length > 0) {
    say("\nНе прошло:");
    for (const f of failures.slice(0, 40)) say(`  • ${f}`);
  }
  say(failures.length === 0 ? "\n✅ Всё работает" : "\n❌ Есть проблемы");
  finish(failures.length === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  say(`Остановлено с ошибкой: ${error instanceof Error ? error.message : String(error)}`);
  finish(1);
});
