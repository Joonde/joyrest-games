import { describe, expect, it } from "vitest";
import { ADMIN_UID } from "./config";
import * as p from "./permissions";
import type { Actor } from "./permissions";

const owner: Actor = { uid: ADMIN_UID, role: "admin", active: true };
const admin2: Actor = { uid: "admin-2", role: "admin", active: true };
const host: Actor = { uid: "host-1", role: "host", active: true };
const other: Actor = { uid: "host-2", role: "host", active: true };
const off: Actor = { uid: "off", role: "host", active: false };
const offAdmin: Actor = { uid: "off-admin", role: "admin", active: false };
const guest: Actor = null;

const agencyGame = { scope: "agency" as const, ownerId: ADMIN_UID };
const myGame = { scope: "personal" as const, ownerId: "host-1" };

describe("роли", () => {
  it("владелец агентства — admin по UID даже без профиля admin", () => {
    expect(p.isAdmin({ uid: ADMIN_UID, role: "host", active: false })).toBe(true);
  });

  it("отключённый admin не admin и не ведущий", () => {
    expect(p.isAdmin(offAdmin)).toBe(false);
    expect(p.isActiveHost(offAdmin)).toBe(false);
  });

  it("активный ведущий и admin — ведущие, отключённый и гость — нет", () => {
    expect(p.isActiveHost(host)).toBe(true);
    expect(p.isActiveHost(admin2)).toBe(true);
    expect(p.isActiveHost(off)).toBe(false);
    expect(p.isActiveHost(guest)).toBe(false);
  });
});

describe("ведущие", () => {
  it("раздел /admin только для admin", () => {
    expect(p.canManageHosts(owner)).toBe(true);
    expect(p.canManageHosts(admin2)).toBe(true);
    expect(p.canManageHosts(host)).toBe(false);
    expect(p.canManageHosts(guest)).toBe(false);
  });

  it("admin отключает ведущего, но не себя и не владельца агентства", () => {
    expect(p.canSetHostActive(owner, { uid: "host-1" })).toBe(true);
    expect(p.canSetHostActive(owner, { uid: ADMIN_UID })).toBe(false);
    expect(p.canSetHostActive(admin2, { uid: ADMIN_UID })).toBe(false);
    expect(p.canSetHostActive(admin2, { uid: "admin-2" })).toBe(false);
    expect(p.canSetHostActive(host, { uid: "host-2" })).toBe(false);
  });

  it("новый временный пароль — admin ведущему, но не себе и не владельцу", () => {
    expect(p.canResetHostPassword(owner, { uid: "host-1" })).toBe(true);
    expect(p.canResetHostPassword(admin2, { uid: "host-1" })).toBe(true);
    expect(p.canResetHostPassword(owner, { uid: ADMIN_UID })).toBe(false);
    expect(p.canResetHostPassword(admin2, { uid: ADMIN_UID })).toBe(false);
    expect(p.canResetHostPassword(admin2, { uid: "admin-2" })).toBe(false);
    expect(p.canResetHostPassword(host, { uid: "host-2" })).toBe(false);
    expect(p.canResetHostPassword(offAdmin, { uid: "host-1" })).toBe(false);
    expect(p.canResetHostPassword(guest, { uid: "host-1" })).toBe(false);
  });
});

describe("предложения в библиотеку", () => {
  it("ведущий предлагает только свою личную игру", () => {
    expect(p.canProposeGame(host, myGame)).toBe(true);
    expect(p.canProposeGame(other, myGame)).toBe(false);
    expect(p.canProposeGame(host, { scope: "agency", ownerId: "host-1" })).toBe(false);
    expect(p.canProposeGame(off, { scope: "personal", ownerId: "off" })).toBe(false);
    expect(p.canProposeGame(guest, myGame)).toBe(false);
    // Владелец кладёт в библиотеку сам.
    expect(p.canProposeGame(owner, { scope: "personal", ownerId: ADMIN_UID })).toBe(false);
  });

  it("принимает и отклоняет только admin", () => {
    expect(p.canReviewProposals(owner)).toBe(true);
    expect(p.canReviewProposals(admin2)).toBe(true);
    expect(p.canReviewProposals(offAdmin)).toBe(false);
    expect(p.canReviewProposals(host)).toBe(false);
    expect(p.canReviewProposals(guest)).toBe(false);
  });
});

describe("команда", () => {
  it("карточки видят активные ведущие и владелец", () => {
    expect(p.canViewTeam(host)).toBe(true);
    expect(p.canViewTeam(owner)).toBe(true);
    expect(p.canViewTeam(off)).toBe(false);
    expect(p.canViewTeam(guest)).toBe(false);
  });
});

describe("музыка", () => {
  const mine = { scope: "personal" as const, ownerId: "host-1" };
  const lib = { scope: "agency" as const, ownerId: ADMIN_UID };
  it("загружают себе активные ведущие, в общую сразу — только admin", () => {
    expect(p.canUploadTrack(host, "personal")).toBe(true);
    expect(p.canUploadTrack(off, "personal")).toBe(false);
    expect(p.canUploadTrack(guest, "personal")).toBe(false);
    expect(p.canUploadTrack(host, "agency")).toBe(false);
    expect(p.canUploadTrack(owner, "agency")).toBe(true);
  });

  it("слушать: свои и общие; чужие личные — только admin", () => {
    expect(p.canUseTrack(host, mine)).toBe(true);
    expect(p.canUseTrack(other, lib)).toBe(true);
    expect(p.canUseTrack(other, mine)).toBe(false);
    expect(p.canUseTrack(owner, mine)).toBe(true);
    expect(p.canUseTrack(guest, lib)).toBe(false);
  });

  it("править: личный — владелец, общий — admin; предлагать — ведущий свой личный", () => {
    expect(p.canEditTrack(host, mine)).toBe(true);
    expect(p.canEditTrack(other, mine)).toBe(false);
    expect(p.canEditTrack(host, lib)).toBe(false);
    expect(p.canEditTrack(owner, lib)).toBe(true);
    expect(p.canShareTrack(host, mine)).toBe(true);
    expect(p.canShareTrack(other, mine)).toBe(false);
    expect(p.canShareTrack(owner, { scope: "personal", ownerId: ADMIN_UID })).toBe(false);
    expect(p.canReviewTracks(owner)).toBe(true);
    expect(p.canReviewTracks(host)).toBe(false);
  });
});

describe("игры", () => {
  it("общую библиотеку видят все активные ведущие", () => {
    expect(p.canReadGame(host, agencyGame)).toBe(true);
    expect(p.canReadGame(off, agencyGame)).toBe(false);
    expect(p.canReadGame(guest, agencyGame)).toBe(false);
  });

  it("личную игру видят владелец и admin", () => {
    expect(p.canReadGame(host, myGame)).toBe(true);
    expect(p.canReadGame(other, myGame)).toBe(false);
    expect(p.canReadGame(admin2, myGame)).toBe(true);
  });

  it("общую игру правит и удаляет только admin", () => {
    expect(p.canEditGame(owner, agencyGame)).toBe(true);
    expect(p.canEditGame(host, agencyGame)).toBe(false);
    expect(p.canDeleteGame(host, agencyGame)).toBe(false);
    expect(p.canDeleteGame(admin2, agencyGame)).toBe(true);
  });

  it("личную игру правит только владелец, пока он активен", () => {
    expect(p.canEditGame(host, myGame)).toBe(true);
    expect(p.canEditGame(other, myGame)).toBe(false);
    expect(p.canEditGame(owner, myGame)).toBe(false);
    expect(p.canEditGame({ uid: "host-1", role: "host", active: false }, myGame)).toBe(false);
  });

  it("создать: общую — только admin, личную — только себе", () => {
    expect(p.canCreateGame(host, "agency", "host-1")).toBe(false);
    expect(p.canCreateGame(owner, "agency", ADMIN_UID)).toBe(true);
    expect(p.canCreateGame(host, "personal", "host-1")).toBe(true);
    expect(p.canCreateGame(host, "personal", "host-2")).toBe(false);
    expect(p.canCreateGame(off, "personal", "off")).toBe(false);
  });

  it("ведущий копирует общую игру себе", () => {
    expect(p.canCopyToPersonal(host, agencyGame)).toBe(true);
    expect(p.canCopyToPersonal(other, myGame)).toBe(false);
    expect(p.canCopyToPersonal(off, agencyGame)).toBe(false);
  });
});

describe("сессии", () => {
  const session = { hostId: "host-1" };

  it("отключённый ведущий не создаёт сессии и не запускает игры", () => {
    expect(p.canCreateSession(host)).toBe(true);
    expect(p.canCreateSession(off)).toBe(false);
    expect(p.canLaunchGame(off, agencyGame)).toBe(false);
    expect(p.canLaunchGame(host, agencyGame)).toBe(true);
    expect(p.canLaunchGame(other, myGame)).toBe(false);
  });

  it("пультом управляет только владелец сессии", () => {
    expect(p.canControlSession("host-1", session)).toBe(true);
    expect(p.canControlSession("host-2", session)).toBe(false);
    expect(p.canControlSession(null, session)).toBe(false);
  });

  it("удалить сессию может владелец, а старые — admin", () => {
    expect(p.canDeleteSession(host, session)).toBe(true);
    expect(p.canDeleteSession(other, session)).toBe(false);
    expect(p.canDeleteSession(owner, session)).toBe(true);
    expect(p.canCleanupSessions(owner)).toBe(true);
    expect(p.canCleanupSessions(host)).toBe(false);
  });

  it("историю видит её ведущий и admin", () => {
    expect(p.canListResults(host, "host-1")).toBe(true);
    expect(p.canListResults(other, "host-1")).toBe(false);
    expect(p.canListResults(admin2, "host-1")).toBe(true);
    expect(p.canListResults(guest, "host-1")).toBe(false);
  });
});

describe("картинки игр", () => {
  it("смотрит любой вошедший, в том числе анонимный экран зала", () => {
    expect(p.canViewMedia("anon-screen")).toBe(true);
    expect(p.canViewMedia(null)).toBe(false);
  });

  it("добавляет и удаляет только тот, кто правит игру", () => {
    expect(p.canChangeMedia(host, myGame)).toBe(true);
    expect(p.canChangeMedia(other, myGame)).toBe(false);
    expect(p.canChangeMedia(host, agencyGame)).toBe(false);
    expect(p.canChangeMedia(owner, agencyGame)).toBe(true);
    expect(p.canChangeMedia(off, myGame)).toBe(false);
  });
});

describe("ответы", () => {
  const open = {
    phase: "playing" as const,
    step: 2,
    startedAt: 10_000,
    revealed: false,
    stage: "question" as const,
    timeLimit: 20,
    answered: 0,
    result: null,
  };

  it("только на открытый вопрос и пока идёт время (+3 с на сеть)", () => {
    expect(p.canSubmitAnswer(open, 2, 15_000)).toBe(true);
    expect(p.canSubmitAnswer(open, 2, 32_500)).toBe(true);
    expect(p.canSubmitAnswer(open, 2, 33_500)).toBe(false);
    expect(p.canSubmitAnswer(open, 3, 15_000)).toBe(false);
    expect(p.canSubmitAnswer({ ...open, stage: "ready" }, 2, 15_000)).toBe(false);
    expect(p.canSubmitAnswer({ ...open, revealed: true, stage: "reveal" }, 2, 15_000)).toBe(false);
    expect(p.canSubmitAnswer({ ...open, timeLimit: null }, 2, 1e12)).toBe(true);
  });

  it("свой ответ и ответ своей команды видно, чужой — нет", () => {
    const session = { hostId: "host-1" };
    const mine = { uid: "g1", pid: "g1" };
    const teamAnswer = { uid: "g2", pid: "t1" };
    expect(p.canReadAnswer("host-1", session, teamAnswer, null)).toBe(true);
    expect(p.canReadAnswer("g1", session, mine, { teamId: null })).toBe(true);
    expect(p.canReadAnswer("g3", session, teamAnswer, { teamId: "t1" })).toBe(true);
    expect(p.canReadAnswer("g4", session, teamAnswer, { teamId: "t2" })).toBe(false);
    expect(p.canReadAnswer("g4", session, mine, { teamId: null })).toBe(false);
    expect(p.canReadAnswer(null, session, mine, null)).toBe(false);
  });
});

describe("база площадок (только свой сервер)", () => {
  it("база и заявки — владелец и ведущие с доступом; QR-коды — любой активный ведущий", () => {
    expect(p.canManageVenues(owner)).toBe(true);
    expect(p.canManageVenues(host)).toBe(false);
    expect(p.canManageVenues(host && { ...host, venueAccess: true })).toBe(true);
    expect(p.canManageVenues(off && { ...off, venueAccess: true })).toBe(false);
    expect(p.canManageVenues(guest)).toBe(false);
    expect(p.canShowVenueQr(host)).toBe(true);
    expect(p.canShowVenueQr(off)).toBe(false);
    expect(p.canShowVenueQr(guest)).toBe(false);
  });

  it("доступ выдаёт только admin; владельцу и себе — не нужно", () => {
    expect(p.canGrantVenueAccess(owner, { uid: "host-1" })).toBe(true);
    expect(p.canGrantVenueAccess(host && { ...host, venueAccess: true }, { uid: "host-2" })).toBe(false);
    expect(p.canGrantVenueAccess(owner, { uid: ADMIN_UID })).toBe(false);
  });
});

describe("профессии команды", () => {
  const dj: Actor = { uid: "dj-1", role: "host", active: true, profession: "dj" };
  it("диджей входит, видит команду и QR, но игр, музыки и сессий у него нет", () => {
    expect(p.isActiveHost(dj)).toBe(true);
    expect(p.canViewTeam(dj)).toBe(true);
    expect(p.canShowVenueQr(dj)).toBe(true);
    expect(p.hostsGames(dj)).toBe(false);
    expect(p.canCreateGame(dj, "personal", "dj-1")).toBe(false);
    expect(p.canReadGame(dj, { scope: "agency", ownerId: ADMIN_UID })).toBe(false);
    expect(p.canCreateSession(dj)).toBe(false);
    expect(p.canUploadTrack(dj, "personal")).toBe(false);
  });
  it("ведущий без профессии (Firebase) и с профессией «ведущий» — проводит игры", () => {
    expect(p.hostsGames(host)).toBe(true);
    expect(p.hostsGames({ ...host, profession: "host" })).toBe(true);
    expect(p.hostsGames({ ...host, active: false })).toBe(false);
  });
});

describe("роли доступа помощников", () => {
  const dj = (accessRole: string | null, uid = "dj-1"): Actor => ({ uid, role: "host", active: true, profession: "dj", accessRole });
  const hostWith = (accessRole: string | null): Actor => ({ uid: "host-1", role: "host", active: true, profession: "host", accessRole });
  const track = (ownerId: string) => ({ scope: "personal" as const, ownerId });
  const agencyTrack = { scope: "agency" as const, ownerId: ADMIN_UID };

  it("роль только добавляет: ведущий с любой ролью сохраняет всё своё", () => {
    for (const role of ["creator", "music", "tester", "venues", "assistant", null]) {
      const a = hostWith(role);
      expect(p.canCreateGame(a, "personal", "host-1")).toBe(true);
      expect(p.canEditGame(a, myGame)).toBe(true);
      expect(p.canLaunchGame(a, agencyGame)).toBe(true);
      expect(p.canCreateSession(a)).toBe(true);
      expect(p.canUploadTrack(a, "personal")).toBe(true);
      expect(p.canShareTrack(a, track("host-1"))).toBe(true);
      expect(p.canProposeGame(a, myGame)).toBe(true);
      expect(p.canShowVenueQr(a)).toBe(true);
    }
  });

  it("ни одна роль не даёт прав владельца", () => {
    for (const role of ["creator", "music", "tester", "venues", "assistant", "admin", "owner"]) {
      for (const a of [dj(role), hostWith(role)]) {
        expect(p.isAdmin(a)).toBe(false);
        expect(p.canManageHosts(a)).toBe(false);
        expect(p.canSetHostActive(a, other)).toBe(false);
        expect(p.canResetHostPassword(a, other)).toBe(false);
        expect(p.canSetAccessRole(a, other)).toBe(false);
        expect(p.canGrantVenueAccess(a, other)).toBe(false);
        expect(p.canCreateGame(a, "agency", ADMIN_UID)).toBe(false);
        expect(p.canEditGame(a, agencyGame)).toBe(false);
        expect(p.canDeleteGame(a, agencyGame)).toBe(false);
        expect(p.canEditGame(a, { scope: "personal", ownerId: "host-2" })).toBe(false);
        expect(p.canUploadTrack(a, "agency")).toBe(false);
        expect(p.canEditTrack(a, agencyTrack)).toBe(false);
        expect(p.canReviewProposals(a)).toBe(false);
        expect(p.canReviewTracks(a)).toBe(false);
        expect(p.canCleanupSessions(a)).toBe(false);
        expect(p.canArchiveVenues(a)).toBe(false);
      }
    }
  });

  it("неизвестная роль и роль у отключённого ничего не дают", () => {
    expect(p.canUseGames(dj("superuser"))).toBe(false);
    const offCreator: Actor = { uid: "x", role: "host", active: false, profession: "dj", accessRole: "creator" };
    expect(p.canUseGames(offCreator)).toBe(false);
    expect(p.canCreateGame(offCreator, "personal", "x")).toBe(false);
    const offAssistant: Actor = { uid: "x", role: "host", active: false, profession: "dj", accessRole: "assistant" };
    expect(p.canSeeAllSessions(offAssistant)).toBe(false);
  });

  it("без роли другие профессии игр и музыки не видят", () => {
    const a = dj(null);
    expect(p.canUseGames(a)).toBe(false);
    expect(p.canUseTracks(a)).toBe(false);
    expect(p.canReadGame(a, agencyGame)).toBe(false);
    expect(p.canManageVenues(a)).toBe(false);
  });

  it("создатель игр: свои игры и предложения, без сессий", () => {
    const a = dj("creator");
    const own = { scope: "personal" as const, ownerId: "dj-1" };
    expect(p.canCreateGame(a, "personal", "dj-1")).toBe(true);
    expect(p.canEditGame(a, own)).toBe(true);
    expect(p.canProposeGame(a, own)).toBe(true);
    expect(p.canCopyToPersonal(a, agencyGame)).toBe(true);
    expect(p.canCreateSession(a)).toBe(false);
    expect(p.canLaunchGame(a, own)).toBe(false);
    expect(p.canUploadTrack(a, "personal")).toBe(false);
    expect(p.canUseTrack(a, agencyTrack)).toBe(true);
    expect(p.canSeeAllSessions(a)).toBe(false);
  });

  it("тестировщик: только смотрит библиотеку и музыку", () => {
    const a = dj("tester");
    expect(p.canReadGame(a, agencyGame)).toBe(true);
    expect(p.canReadGame(a, myGame)).toBe(false);
    expect(p.canCreateGame(a, "personal", "dj-1")).toBe(false);
    expect(p.canCopyToPersonal(a, agencyGame)).toBe(false);
    expect(p.canLaunchGame(a, agencyGame)).toBe(false);
    expect(p.canUseTrack(a, agencyTrack)).toBe(true);
    expect(p.canUploadTrack(a, "personal")).toBe(false);
  });

  it("музыкальный редактор: свои треки и предложения, без игр", () => {
    const a = dj("music");
    expect(p.canUploadTrack(a, "personal")).toBe(true);
    expect(p.canEditTrack(a, track("dj-1"))).toBe(true);
    expect(p.canShareTrack(a, track("dj-1"))).toBe(true);
    expect(p.canEditTrack(a, track("host-1"))).toBe(false);
    expect(p.canUseTrack(a, track("host-1"))).toBe(false);
    expect(p.canUseGames(a)).toBe(false);
  });

  it("модератор площадок: ведёт базу, но не архивирует", () => {
    const a = dj("venues");
    expect(p.canManageVenues(a)).toBe(true);
    expect(p.canArchiveVenues(a)).toBe(false);
    expect(p.canUseGames(a)).toBe(false);
  });

  it("помощник владельца: видит все игры сейчас, без прав на людей и библиотеку", () => {
    const a = dj("assistant");
    expect(p.canSeeAllSessions(a)).toBe(true);
    expect(p.canSeeAllSessions(host)).toBe(false);
    expect(p.canSeeAllSessions(owner)).toBe(true);
    expect(p.canUseGames(a)).toBe(false);
    expect(p.canDeleteSession(a, { hostId: "host-2" })).toBe(false);
  });
});
