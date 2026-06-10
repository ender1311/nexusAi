// Regression (2026-06-09 audit, I2): PATCH /api/agents/[id] must release the
// cohort only when targeting/status values actually CHANGE — not whenever the
// keys are merely present. Full-object form saves echo every field back, so
// presence-based detection released the entire cohort (and cleared
// cohortAssignedAt) on every save, even a pure rename.
import { describe, it, expect, afterAll } from "bun:test";
import { prisma } from "@/lib/db";
import { createAgent } from "../helpers/builders";
import { PATCH as patchAgent } from "@/app/api/agents/[id]/route";
import { NextRequest } from "next/server";
import { buildRequest } from "../helpers/request";

const PREFIX = "echoreg-";

async function setupAgentWithCohort(overrides: Parameters<typeof createAgent>[0] = {}) {
  const agent = await createAgent({ name: `${PREFIX}${Date.now()}-${Math.random()}`, status: "active", funnelStage: "wau", ...overrides });
  const ext = `${PREFIX}user-${Date.now()}-${Math.random()}`;
  const cohortAt = new Date("2026-06-01T00:00:00Z");
  await prisma.agent.update({ where: { id: agent.id }, data: { cohortAssignedAt: cohortAt } });
  await prisma.trackedUser.create({
    data: { externalId: ext, brazeId: ext, funnelStage: "wau", lockedByAgentId: agent.id },
  });
  await prisma.userAgentAssignment.create({ data: { externalUserId: ext, agentId: agent.id } });
  return { agent, ext, cohortAt };
}

describe("PATCH same-value echo does not release cohort (regression)", () => {
  it("echoing current funnelStage/segmentTargeting/enrollmentMode/status leaves cohort intact", async () => {
    const { agent, ext, cohortAt } = await setupAgentWithCohort({
      segmentTargeting: { includes: ["seg-echo"], excludes: [] },
    });

    const req = buildRequest("PATCH", {
      name: agent.name,
      status: "active",
      funnelStage: "wau",
      targetSegmentName: null,
      segmentTargeting: { includes: ["seg-echo"], excludes: [] },
      enrollmentMode: agent.enrollmentMode,
    });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(200);

    const fresh = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(fresh!.cohortAssignedAt?.toISOString()).toBe(cohortAt.toISOString());
    const tu = await prisma.trackedUser.findUnique({ where: { externalId: ext } });
    expect(tu!.lockedByAgentId).toBe(agent.id);
    const asg = await prisma.userAgentAssignment.findUnique({ where: { externalUserId: ext } });
    expect(asg!.releasedAt).toBeNull();
  });

  it("re-sending status=paused to an already-paused agent does not release", async () => {
    const { agent, ext, cohortAt } = await setupAgentWithCohort({ status: "paused" });

    const req = buildRequest("PATCH", { status: "paused" });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(200);

    const fresh = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(fresh!.cohortAssignedAt?.toISOString()).toBe(cohortAt.toISOString());
    const asg = await prisma.userAgentAssignment.findUnique({ where: { externalUserId: ext } });
    expect(asg!.releasedAt).toBeNull();
    const tu = await prisma.trackedUser.findUnique({ where: { externalId: ext } });
    expect(tu!.lockedByAgentId).toBe(agent.id);
  });

  it("an ACTUAL funnelStage change still releases the cohort", async () => {
    const { agent, ext } = await setupAgentWithCohort();

    const req = buildRequest("PATCH", { funnelStage: "mau" });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(200);

    const fresh = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(fresh!.cohortAssignedAt).toBeNull();
    const tu = await prisma.trackedUser.findUnique({ where: { externalId: ext } });
    expect(tu!.lockedByAgentId).toBeNull();
    const asg = await prisma.userAgentAssignment.findUnique({ where: { externalUserId: ext } });
    expect(asg!.releasedAt).not.toBeNull();
    expect(asg!.releaseReason).toBe("manual");
  });

  it("an actual pause transition (active → paused) still releases the cohort", async () => {
    const { agent, ext } = await setupAgentWithCohort();

    const req = buildRequest("PATCH", { status: "paused" });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(200);

    const fresh = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(fresh!.cohortAssignedAt).toBeNull();
    const asg = await prisma.userAgentAssignment.findUnique({ where: { externalUserId: ext } });
    expect(asg!.releasedAt).not.toBeNull();
    const tu = await prisma.trackedUser.findUnique({ where: { externalId: ext } });
    expect(tu!.lockedByAgentId).toBeNull();
  });
});

afterAll(async () => {
  await prisma.userAgentAssignment.deleteMany({ where: { externalUserId: { startsWith: PREFIX } } });
  await prisma.trackedUser.deleteMany({ where: { externalId: { startsWith: PREFIX } } });
  await prisma.agent.deleteMany({ where: { name: { startsWith: PREFIX } } });
});
