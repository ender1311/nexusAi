// Regression: pausing an agent (sendingPaused=true) must NOT release the cohort.
// Guards src/app/api/agents/[id]/route.ts — sendingPaused must stay OUT of the
// releasesCohort predicate. Spec: docs/superpowers/specs/2026-06-06-pause-kill-switch-design.md
import { describe, it, expect, afterAll } from "bun:test";
import { prisma } from "@/lib/db";
import { createAgent } from "../helpers/builders";
import { PATCH as patchAgent } from "@/app/api/agents/[id]/route";
import { NextRequest } from "next/server";
import { buildRequest } from "../helpers/request";

const PREFIX = "pausereg-";

describe("pause preserves cohort (regression)", () => {
  it("PATCH sendingPaused=true leaves locks, assignment, cohortAssignedAt, arm stats intact", async () => {
    const agent = await createAgent({ name: `${PREFIX}${Date.now()}`, status: "active" });
    const ext = `${PREFIX}user-${Date.now()}`;
    const cohortAt = new Date("2026-06-01T00:00:00Z");
    await prisma.agent.update({ where: { id: agent.id }, data: { cohortAssignedAt: cohortAt } });
    await prisma.trackedUser.create({
      data: { externalId: ext, brazeId: ext, funnelStage: "wau", lockedByAgentId: agent.id },
    });
    await prisma.userAgentAssignment.create({ data: { externalUserId: ext, agentId: agent.id } });
    await prisma.personaArmStats.create({
      data: { agentId: agent.id, personaId: "p1", variantId: "v1", alpha: 5, beta: 3 },
    });

    const req = buildRequest("PATCH", { sendingPaused: true });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(200);

    const fresh = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(fresh!.sendingPaused).toBe(true);
    expect(fresh!.cohortAssignedAt?.toISOString()).toBe(cohortAt.toISOString());

    const tu = await prisma.trackedUser.findUnique({ where: { externalId: ext } });
    expect(tu!.lockedByAgentId).toBe(agent.id);

    const asg = await prisma.userAgentAssignment.findUnique({ where: { externalUserId: ext } });
    expect(asg!.releasedAt).toBeNull();

    const arm = await prisma.personaArmStats.findFirst({ where: { agentId: agent.id } });
    expect(arm!.alpha).toBe(5);
    expect(arm!.beta).toBe(3);
  });
});

afterAll(async () => {
  await prisma.userAgentAssignment.deleteMany({ where: { externalUserId: { startsWith: PREFIX } } });
  await prisma.trackedUser.deleteMany({ where: { externalId: { startsWith: PREFIX } } });
  const agentIds = (await prisma.agent.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } })).map((a) => a.id);
  await prisma.personaArmStats.deleteMany({ where: { agentId: { in: agentIds } } });
  await prisma.agent.deleteMany({ where: { name: { startsWith: PREFIX } } });
});
