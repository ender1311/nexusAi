import { describe, it, expect, afterAll } from "bun:test";
import { prisma } from "../helpers/db";
import { createAgent, createUser, createUserAgentAssignment } from "../helpers/builders";
import { PATCH as patchAgent } from "@/app/api/agents/[id]/route";
import { NextRequest } from "next/server";
import { buildRequest } from "../helpers/request";

const PREFIX = "enrollpatch-";

function patch(id: string, body: unknown) {
  const req = buildRequest("PATCH", body);
  return patchAgent(req as NextRequest, { params: Promise.resolve({ id }) });
}

describe("PATCH enrollmentMode (integration)", () => {
  it("round-trips continuous then fixed", async () => {
    const agent = await createAgent({ name: `${PREFIX}${Date.now()}`, status: "active" });
    expect((await patch(agent.id, { enrollmentMode: "continuous" })).status).toBe(200);
    expect((await prisma.agent.findUnique({ where: { id: agent.id } }))!.enrollmentMode).toBe("continuous");
    expect((await patch(agent.id, { enrollmentMode: "fixed" })).status).toBe(200);
    expect((await prisma.agent.findUnique({ where: { id: agent.id } }))!.enrollmentMode).toBe("fixed");
  });

  it("rejects invalid values with 400", async () => {
    const agent = await createAgent({ name: `${PREFIX}bad-${Date.now()}`, status: "active" });
    expect((await patch(agent.id, { enrollmentMode: "open" })).status).toBe(400);
    expect((await patch(agent.id, { enrollmentMode: true })).status).toBe(400);
    expect((await prisma.agent.findUnique({ where: { id: agent.id } }))!.enrollmentMode).toBe("fixed");
  });

  it("releases the cohort on mode switch: clears locks, releases assignments, resets cohortAssignedAt", async () => {
    const agent = await createAgent({ name: `${PREFIX}cohort-${Date.now()}`, status: "active" });
    await prisma.agent.update({ where: { id: agent.id }, data: { cohortAssignedAt: new Date() } });
    const uid = `${PREFIX}u-${Date.now()}`;
    await createUser(uid);
    await prisma.trackedUser.update({ where: { externalId: uid }, data: { lockedByAgentId: agent.id } });
    await createUserAgentAssignment({ externalUserId: uid, agentId: agent.id });

    expect((await patch(agent.id, { enrollmentMode: "continuous" })).status).toBe(200);

    const updated = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(updated!.enrollmentMode).toBe("continuous");
    expect(updated!.cohortAssignedAt).toBeNull();
    expect((await prisma.trackedUser.findUnique({ where: { externalId: uid } }))!.lockedByAgentId).toBeNull();
    const assignment = await prisma.userAgentAssignment.findUnique({ where: { externalUserId: uid } });
    expect(assignment!.releasedAt).not.toBeNull();
    expect(assignment!.releaseReason).toBe("manual");
  });
});

afterAll(async () => {
  await prisma.userAgentAssignment.deleteMany({ where: { externalUserId: { startsWith: PREFIX } } });
  await prisma.trackedUser.deleteMany({ where: { externalId: { startsWith: PREFIX } } });
  await prisma.agent.deleteMany({ where: { name: { startsWith: PREFIX } } });
});
