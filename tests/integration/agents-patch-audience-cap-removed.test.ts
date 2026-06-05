// tests/integration/agents-patch-audience-cap-removed.test.ts
//
// Task 6 (Agent Cohort Assignment): PATCH must no longer validate or write the
// removed audienceCap field, and when user locks release (pause/draft/targeting
// change) it must also reset the cohort: release this agent's active
// UserAgentAssignment rows (releasedAt=now, releaseReason="manual") and clear
// Agent.cohortAssignedAt so a fresh cohort re-materializes on the next active tick.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent } from "../helpers/builders";
import { PATCH as patchAgent } from "@/app/api/agents/[id]/route";
import { NextRequest } from "next/server";

function buildRequest(body?: unknown) {
  return new NextRequest("http://localhost:3000/api/agents/test", {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-admin": "true" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function seedCohort(agentId: string, count: number) {
  for (let i = 0; i < count; i++) {
    await prisma.trackedUser.create({
      data: { externalId: `${agentId}-u${i}`, lockedByAgentId: agentId },
    });
    await prisma.userAgentAssignment.create({
      data: { externalUserId: `${agentId}-u${i}`, agentId, releasedAt: null },
    });
  }
}

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("PATCH /agents/[id] — audienceCap removed + cohort reset", () => {
  it("ignores audienceCap in the body and still applies other updates", async () => {
    const agent = await createAgent({ status: "active" });

    const res = await patchAgent(buildRequest({ audienceCap: 100, dailySendCap: 250 }), {
      params: Promise.resolve({ id: agent.id }),
    });
    expect(res.status).toBe(200);

    const reloaded = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(reloaded?.dailySendCap).toBe(250);
    // PATCH must not write audienceCap (field removed from the product). The column
    // is dropped in a later task, so today it stays at its default (null) rather
    // than the 100 supplied in the body — the key is ignored, not persisted.
    expect((reloaded as Record<string, unknown>).audienceCap ?? null).toBeNull();
  });

  it("resets cohort (cohortAssignedAt=null + releases assignments + locks) when status → paused", async () => {
    const agent = await createAgent({ status: "active" });
    await prisma.agent.update({ where: { id: agent.id }, data: { cohortAssignedAt: new Date() } });
    await seedCohort(agent.id, 5);

    const res = await patchAgent(buildRequest({ status: "paused" }), {
      params: Promise.resolve({ id: agent.id }),
    });
    expect(res.status).toBe(200);

    const reloaded = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(reloaded?.cohortAssignedAt).toBeNull();

    const stillLocked = await prisma.trackedUser.count({ where: { lockedByAgentId: agent.id } });
    expect(stillLocked).toBe(0);

    const stillActive = await prisma.userAgentAssignment.count({
      where: { agentId: agent.id, releasedAt: null },
    });
    expect(stillActive).toBe(0);
  });

  it("resets cohort when funnelStage changes", async () => {
    const agent = await createAgent({ status: "active", funnelStage: "wau" });
    await prisma.agent.update({ where: { id: agent.id }, data: { cohortAssignedAt: new Date() } });
    await seedCohort(agent.id, 5);

    const res = await patchAgent(buildRequest({ funnelStage: "mau" }), {
      params: Promise.resolve({ id: agent.id }),
    });
    expect(res.status).toBe(200);

    const reloaded = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(reloaded?.cohortAssignedAt).toBeNull();
  });
});
