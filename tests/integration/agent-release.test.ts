import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { createAgent, createUserAgentAssignment } from "../helpers/builders";

const { POST } = await import("@/app/api/agents/[id]/release/route");

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("POST /api/agents/[id]/release", () => {
  it("releases a single user's active assignment", async () => {
    const agent = await createAgent();
    await createUserAgentAssignment({ externalUserId: "u1", agentId: agent.id });
    await createUserAgentAssignment({ externalUserId: "u2", agentId: agent.id });

    const res = await POST(
      buildRequest("POST", { userId: "u1" }) as NextRequest,
      { params: Promise.resolve({ id: agent.id }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.released).toBe(1);

    expect((await prisma.userAgentAssignment.findUnique({ where: { externalUserId: "u1" } }))!.releaseReason).toBe("manual");
    expect((await prisma.userAgentAssignment.findUnique({ where: { externalUserId: "u2" } }))!.releasedAt).toBeNull();
  });

  it("releases all active assignments on empty body", async () => {
    const agent = await createAgent();
    await createUserAgentAssignment({ externalUserId: "a", agentId: agent.id });
    await createUserAgentAssignment({ externalUserId: "b", agentId: agent.id });
    await createUserAgentAssignment({ externalUserId: "c", agentId: agent.id, releasedAt: new Date(), releaseReason: "conversion" });

    const res = await POST(
      buildRequest("POST", {}) as NextRequest,
      { params: Promise.resolve({ id: agent.id }) },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data.released).toBe(2);
  });

  it("returns 404 for a missing agent", async () => {
    const res = await POST(
      buildRequest("POST", {}) as NextRequest,
      { params: Promise.resolve({ id: "nonexistent" }) },
    );
    expect(res.status).toBe(404);
  });
});
