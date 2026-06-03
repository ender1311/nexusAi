// tests/regression/personas-kpi-persona-id-column.test.ts
//
// REGRESSION: the personas page (src/app/personas/page.tsx) was split so the
// KPI metric cards run a cheap aggregate independent of the heavy full-list
// query. That KPI query counts assigned users via
//   prisma.trackedUser.count({ where: { personaId: { not: null } } })
// which depends on the `personaId` column existing on TrackedUser. If that
// column is ever renamed/removed (or the relation drifts), this query throws
// here in CI instead of silently breaking the Total Users card on production.
//
// This test exercises the exact three queries getPersonaKpis() issues and
// asserts the derived KPI values.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createPersona, createUser } from "../helpers/builders";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("regression: personas KPI query depends on TrackedUser.personaId", () => {
  it("counts personas and persona-assigned users without throwing", async () => {
    const personaA = await createPersona({ name: "Aardvark", source: "manual" });
    await createPersona({ name: "Zebra", source: "discovered" });

    // Two users assigned to a persona, one unassigned.
    await createUser("u-assigned-1", { personaId: personaA.id });
    await createUser("u-assigned-2", { personaId: personaA.id });
    await createUser("u-unassigned", { personaId: null });

    // Exact shape from getPersonaKpis() in src/app/personas/page.tsx.
    const [totalPersonas, assignedUsers, firstPersona] = await Promise.all([
      prisma.persona.count(),
      prisma.trackedUser.count({ where: { personaId: { not: null } } }),
      prisma.persona.findFirst({ orderBy: { createdAt: "asc" }, select: { name: true } }),
    ]);

    expect(totalPersonas).toBe(2);
    expect(assignedUsers).toBe(2);
    // First persona by createdAt asc — matches the persona-list ordering.
    expect(firstPersona?.name).toBe("Aardvark");
  });

  it("reports zero assigned users when none have a personaId", async () => {
    await createPersona({ name: "Solo" });
    await createUser("u-none", { personaId: null });

    const assignedUsers = await prisma.trackedUser.count({ where: { personaId: { not: null } } });
    expect(assignedUsers).toBe(0);
  });
});
