// tests/integration/agents-patch-unique-users-cap.test.ts
//
// Task 6 (Unified Agent Settings): PATCH must accept uniqueUsersCap (null or
// positive integer), reject invalid values with 400, and must NOT trigger
// cohort release when only uniqueUsersCap changes.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent, createUserAgentAssignment } from "../helpers/builders";
import { PATCH as patchAgent } from "@/app/api/agents/[id]/route";
import { NextRequest } from "next/server";

function buildRequest(body?: unknown) {
  return new NextRequest("http://localhost:3000/api/agents/test", {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-admin": "true" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("PATCH /agents/[id] — uniqueUsersCap", () => {
  it("1. sets uniqueUsersCap to a positive integer", async () => {
    const agent = await createAgent({ status: "active" });

    const res = await patchAgent(buildRequest({ uniqueUsersCap: 5000 }), {
      params: Promise.resolve({ id: agent.id }),
    });
    expect(res.status).toBe(200);

    const reloaded = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(reloaded?.uniqueUsersCap).toBe(5000);
  });

  it("2. sets uniqueUsersCap to null (unlimited)", async () => {
    const agent = await createAgent({ status: "active" });
    // First set it to a value, then clear it
    await prisma.agent.update({ where: { id: agent.id }, data: { uniqueUsersCap: 1000 } });

    const res = await patchAgent(buildRequest({ uniqueUsersCap: null }), {
      params: Promise.resolve({ id: agent.id }),
    });
    expect(res.status).toBe(200);

    const reloaded = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(reloaded?.uniqueUsersCap).toBeNull();
  });

  it("3. rejects uniqueUsersCap of 0 with 400", async () => {
    const agent = await createAgent({ status: "active" });

    const res = await patchAgent(buildRequest({ uniqueUsersCap: 0 }), {
      params: Promise.resolve({ id: agent.id }),
    });
    expect(res.status).toBe(400);
  });

  it("4. rejects negative uniqueUsersCap with 400", async () => {
    const agent = await createAgent({ status: "active" });

    const res = await patchAgent(buildRequest({ uniqueUsersCap: -5 }), {
      params: Promise.resolve({ id: agent.id }),
    });
    expect(res.status).toBe(400);
  });

  it("5. rejects non-integer uniqueUsersCap with 400", async () => {
    const agent = await createAgent({ status: "active" });

    const res = await patchAgent(buildRequest({ uniqueUsersCap: 1.5 }), {
      params: Promise.resolve({ id: agent.id }),
    });
    expect(res.status).toBe(400);
  });

  it("6. rejects string uniqueUsersCap with 400", async () => {
    const agent = await createAgent({ status: "active" });

    const res = await patchAgent(buildRequest({ uniqueUsersCap: "5000" }), {
      params: Promise.resolve({ id: agent.id }),
    });
    expect(res.status).toBe(400);
  });

  it("7. COHORT GUARD: changing only uniqueUsersCap does NOT release cohort or assignments", async () => {
    const agent = await createAgent({ status: "active" });
    const cohortDate = new Date("2026-01-01T00:00:00Z");
    await prisma.agent.update({
      where: { id: agent.id },
      data: { cohortAssignedAt: cohortDate },
    });

    // Create an active assignment (releasedAt: null)
    await createUserAgentAssignment({
      externalUserId: `cohort-guard-user-${agent.id}`,
      agentId: agent.id,
      releasedAt: null,
    });

    const res = await patchAgent(buildRequest({ uniqueUsersCap: 9999 }), {
      params: Promise.resolve({ id: agent.id }),
    });
    expect(res.status).toBe(200);

    // Assignment must NOT be released
    const assignment = await prisma.userAgentAssignment.findFirst({
      where: { agentId: agent.id },
    });
    expect(assignment?.releasedAt).toBeNull();

    // cohortAssignedAt must be unchanged
    const reloaded = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(reloaded?.cohortAssignedAt?.toISOString()).toBe(cohortDate.toISOString());
  });
});
