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
