// Regression: GET /api/stats previously ran unbounded full-table scans on every
// request — trackedUser.count(), an all-time userDecision.aggregate({where:{}}),
// and an all-time conversion count — over ~19M-row tables, guarded only by a 60s
// CDN cache. It now delegates the heavy counts to the DAY-cached
// getCachedControlTowerStats (shared with the dashboard) and keeps only the cheap
// indexed active-agent count live. This test pins the response shape so the
// `agents` field (which the cached helper does NOT provide) is never dropped, and
// verifies the four delegated counts stay correct.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent, createPersona, createUserDecision } from "../helpers/builders";
import { GET } from "@/app/api/stats/route";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("GET /api/stats response shape", () => {
  it("returns all five fields with correct counts, including the active-agent count", async () => {
    const active = await createAgent({ name: "Active", status: "active" });
    await createAgent({ name: "Paused", status: "paused" }); // must NOT count toward agents
    await createPersona({ name: "P1", isActive: true });
    await createPersona({ name: "P2", isActive: false }); // inactive — excluded
    await prisma.trackedUser.create({ data: { externalId: "su1" } });
    await prisma.trackedUser.create({ data: { externalId: "su2" } });
    await createUserDecision({ agentId: active.id, userId: "su1", channel: "push" });
    await createUserDecision({ agentId: active.id, userId: "su2", channel: "push", conversionAt: new Date() });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Object.keys(body)).toEqual(
      expect.arrayContaining(["trackedUsers", "personas", "agents", "totalDecisions", "totalConversions"]),
    );
    expect(body.trackedUsers).toBe(2);
    expect(body.personas).toBe(1); // only the active persona
    expect(body.agents).toBe(1); // only the active agent
    expect(body.totalDecisions).toBe(2);
    expect(body.totalConversions).toBe(1);
  });
});
