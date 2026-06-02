import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { createAgent, createGoal } from "../helpers/builders";

import { POST, PUT } from "@/app/api/agents/[id]/goals/route";

function rawRequest(method: "POST" | "PUT", body: string): Request {
  return new Request("http://localhost/", {
    method,
    body,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(async () => {
  await truncateAll();
});

afterEach(async () => {
  await truncateAll();
});

describe("POST /api/agents/[id]/goals", () => {
  it("creates a goal from a valid body", async () => {
    const agent = await createAgent();
    const req = buildRequest("POST", { eventName: "plan_started", tier: "best", valueWeight: 2 });
    const res = await POST(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });

    expect(res.status).toBe(201);
    const goals = await prisma.goal.findMany({ where: { agentId: agent.id } });
    expect(goals.length).toBe(1);
    expect(goals[0]!.eventName).toBe("plan_started");
    expect(goals[0]!.valueWeight).toBe(2);
  });

  it("returns 400 on malformed JSON", async () => {
    const agent = await createAgent();
    const res = await POST(rawRequest("POST", "{bad") as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON");
  });

  it("returns 400 when eventName is missing", async () => {
    const agent = await createAgent();
    const req = buildRequest("POST", { tier: "best" });
    const res = await POST(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 when tier is missing", async () => {
    const agent = await createAgent();
    const req = buildRequest("POST", { eventName: "plan_started" });
    const res = await POST(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 when eventName is an empty string", async () => {
    const agent = await createAgent();
    const req = buildRequest("POST", { eventName: "   ", tier: "best" });
    const res = await POST(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/agents/[id]/goals", () => {
  it("replaces all goals with the provided array", async () => {
    const agent = await createAgent();
    await createGoal(agent.id, { eventName: "old_event", tier: "good" });

    const req = buildRequest("PUT", [
      { eventName: "plan_started", tier: "best" },
      { eventName: "verse_shared", tier: "good", valueWeight: 0.5 },
    ]);
    const res = await PUT(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });

    expect(res.status).toBe(200);
    const goals = await prisma.goal.findMany({ where: { agentId: agent.id }, orderBy: { eventName: "asc" } });
    expect(goals.map((g) => g.eventName)).toEqual(["plan_started", "verse_shared"]);
  });

  it("clears all goals when given an empty array", async () => {
    const agent = await createAgent();
    await createGoal(agent.id);

    const req = buildRequest("PUT", []);
    const res = await PUT(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(200);

    const goals = await prisma.goal.findMany({ where: { agentId: agent.id } });
    expect(goals.length).toBe(0);
  });

  it("returns 400 when body is not an array", async () => {
    const agent = await createAgent();
    const req = buildRequest("PUT", { eventName: "plan_started", tier: "best" });
    const res = await PUT(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(400);
  });

  // Regression: a malformed entry later in the array must NOT trigger the
  // destructive deleteMany before validation. Previously the route deleted all
  // goals first, then 500'd on the bad entry — wiping the agent's goals entirely.
  it("rejects an invalid entry WITHOUT deleting pre-existing goals (data-loss regression)", async () => {
    const agent = await createAgent();
    await createGoal(agent.id, { eventName: "keep_me", tier: "best" });

    const req = buildRequest("PUT", [
      { eventName: "valid_event", tier: "best" },
      { tier: "good" }, // missing eventName — invalid
    ]);
    const res = await PUT(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });

    expect(res.status).toBe(400);
    // The pre-existing goal must still be present — nothing was deleted.
    const goals = await prisma.goal.findMany({ where: { agentId: agent.id } });
    expect(goals.length).toBe(1);
    expect(goals[0]!.eventName).toBe("keep_me");
  });

  it("returns 400 on malformed JSON without touching existing goals", async () => {
    const agent = await createAgent();
    await createGoal(agent.id, { eventName: "keep_me", tier: "best" });

    const res = await PUT(rawRequest("PUT", "[broken") as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(400);

    const goals = await prisma.goal.findMany({ where: { agentId: agent.id } });
    expect(goals.length).toBe(1);
  });
});
