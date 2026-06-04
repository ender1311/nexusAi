// Regression: the Personas page KPI "Total Users across all segments" must be
// derived by summing per-persona _count.trackedUsers (one indexed GROUP BY),
// NOT a standalone COUNT over the full TrackedUser table.
//
// Bug context: `trackedUser.count({ where: { personaId: { not: null } } })`
// scans ~34M rows (~22s) and exceeded the route's maxDuration=30, surfacing in
// the browser as "connection closed" and leaving the personas view blank. This
// test pins the invariant that the cheap derivation equals the expensive count.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createPersona, createUser } from "../helpers/builders";

beforeEach(async () => {
  await truncateAll();
});
afterEach(async () => {
  await truncateAll();
});

describe("personas KPI derivation (regression)", () => {
  it("sum of per-persona _count equals count(personaId not null)", async () => {
    const p1 = await createPersona({ name: "Alpha" });
    const p2 = await createPersona({ name: "Beta" });

    await createUser("u1", { personaId: p1.id });
    await createUser("u2", { personaId: p1.id });
    await createUser("u3", { personaId: p2.id });
    await createUser("u4", { personaId: null }); // unassigned — must be excluded

    const personas = await prisma.persona.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, _count: { select: { trackedUsers: true } } },
    });
    const derivedAssigned = personas.reduce((s, p) => s + p._count.trackedUsers, 0);
    const directAssigned = await prisma.trackedUser.count({ where: { personaId: { not: null } } });

    expect(derivedAssigned).toBe(directAssigned);
    expect(derivedAssigned).toBe(3);
    // KPI projections the page derives from the same query
    expect(personas.length).toBe(2);
    expect(personas[0]?.name).toBe("Alpha");
  });
});
