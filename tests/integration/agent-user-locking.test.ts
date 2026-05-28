// tests/integration/agent-user-locking.test.ts
//
// Tests that user locks are correctly released when agents are paused or deleted.
// The cron-side lock enforcement (eligibility filter) is tested via the SQL pattern
// in the regression test.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent } from "../helpers/builders";
import { PATCH as patchAgent, DELETE as deleteAgent } from "@/app/api/agents/[id]/route";
import { NextRequest } from "next/server";

function buildRequest(method: string, body?: unknown) {
  return new NextRequest(`http://localhost:3000/api/agents/test`, {
    method,
    headers: { "content-type": "application/json", "x-admin": "true" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("user locking: lock release on agent status change", () => {
  it("releases locks when agent is paused", async () => {
    const agent = await createAgent({ status: "active" });
    await prisma.trackedUser.create({
      data: { externalId: "u1", lockedByAgentId: agent.id },
    });

    const req = buildRequest("PATCH", { status: "paused" });
    const res = await patchAgent(req, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(200);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "u1" } });
    expect(user?.lockedByAgentId).toBeNull();
  });

  it("releases locks when agent is set to draft", async () => {
    const agent = await createAgent({ status: "active" });
    await prisma.trackedUser.create({
      data: { externalId: "u2", lockedByAgentId: agent.id },
    });

    const req = buildRequest("PATCH", { status: "draft" });
    const res = await patchAgent(req, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(200);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "u2" } });
    expect(user?.lockedByAgentId).toBeNull();
  });

  it("does NOT release locks when agent stays active", async () => {
    const agent = await createAgent({ status: "active" });
    await prisma.trackedUser.create({
      data: { externalId: "u3", lockedByAgentId: agent.id },
    });

    const req = buildRequest("PATCH", { name: "Renamed Agent" });
    const res = await patchAgent(req, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(200);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "u3" } });
    expect(user?.lockedByAgentId).toBe(agent.id); // still locked
  });

  it("releases locks when agent is deleted", async () => {
    const agent = await createAgent({ status: "active" });
    await prisma.trackedUser.create({
      data: { externalId: "u4", lockedByAgentId: agent.id },
    });

    const req = buildRequest("DELETE");
    const res = await deleteAgent(req, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(200);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "u4" } });
    expect(user?.lockedByAgentId).toBeNull();
  });
});
