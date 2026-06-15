import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { createAgent, createGoal } from "../helpers/builders";

import { POST, PUT } from "@/app/api/agents/[id]/goals/route";
import { calculateReward } from "@/lib/engine/reward-calculator";
import type { Goal } from "@/types/agent";

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

  it("persists conversionType when goal is a valid interaction flag", async () => {
    const agent = await createAgent();
    const req = buildRequest("POST", {
      eventName: "plan_interaction_has_ever_flag",
      tier: "best",
      conversionType: "first_interaction",
    });
    const res = await POST(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });

    expect(res.status).toBe(201);
    const goals = await prisma.goal.findMany({ where: { agentId: agent.id } });
    expect(goals.length).toBe(1);
    expect(goals[0]!.conversionType).toBe("first_interaction");
  });

  it("returns 400 when conversionType is an invalid value", async () => {
    const agent = await createAgent();
    const req = buildRequest("POST", {
      eventName: "plan_interaction_has_ever_flag",
      tier: "best",
      conversionType: "bad_value",
    });
    const res = await POST(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("goal.conversionType must be 'first_interaction' or 'any_interaction'");
  });

  it("returns 400 when conversionType is set on a non-interaction-flag eventName", async () => {
    const agent = await createAgent();
    const req = buildRequest("POST", {
      eventName: "plan_started",
      tier: "best",
      conversionType: "first_interaction",
    });
    const res = await POST(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("conversionType is only valid for *_has_ever_flag interaction-flag goals");
  });

  it("persists null conversionType when not provided", async () => {
    const agent = await createAgent();
    const req = buildRequest("POST", { eventName: "plan_started", tier: "best" });
    const res = await POST(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });

    expect(res.status).toBe(201);
    const goals = await prisma.goal.findMany({ where: { agentId: agent.id } });
    expect(goals[0]!.conversionType).toBeNull();
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

  it("persists conversionType on flag goals in PUT array", async () => {
    const agent = await createAgent();

    const req = buildRequest("PUT", [
      {
        eventName: "votd_interaction_has_ever_flag",
        tier: "best",
        conversionType: "any_interaction",
      },
    ]);
    const res = await PUT(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });

    expect(res.status).toBe(200);
    const goals = await prisma.goal.findMany({ where: { agentId: agent.id } });
    expect(goals.length).toBe(1);
    expect(goals[0]!.conversionType).toBe("any_interaction");
  });

  it("returns 400 when an entry in PUT array has invalid conversionType", async () => {
    const agent = await createAgent();
    await createGoal(agent.id, { eventName: "keep_me", tier: "best" });

    const req = buildRequest("PUT", [
      {
        eventName: "votd_interaction_has_ever_flag",
        tier: "best",
        conversionType: "invalid_type",
      },
    ]);
    const res = await PUT(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("goal.conversionType must be 'first_interaction' or 'any_interaction'");
    // pre-existing goals must not have been touched
    const goals = await prisma.goal.findMany({ where: { agentId: agent.id } });
    expect(goals.length).toBe(1);
    expect(goals[0]!.eventName).toBe("keep_me");
  });

  it("returns 400 when conversionType set on non-flag goal in PUT array", async () => {
    const agent = await createAgent();
    await createGoal(agent.id, { eventName: "keep_me", tier: "best" });

    const req = buildRequest("PUT", [
      {
        eventName: "plan_started",
        tier: "best",
        conversionType: "first_interaction",
      },
    ]);
    const res = await PUT(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("conversionType is only valid for *_has_ever_flag interaction-flag goals");
    // pre-existing goals must not have been touched
    const goals = await prisma.goal.findMany({ where: { agentId: agent.id } });
    expect(goals.length).toBe(1);
    expect(goals[0]!.eventName).toBe("keep_me");
  });

  it("persists null conversionType for goals without it in PUT array", async () => {
    const agent = await createAgent();

    const req = buildRequest("PUT", [{ eventName: "plan_started", tier: "good" }]);
    const res = await PUT(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });

    expect(res.status).toBe(200);
    const goals = await prisma.goal.findMany({ where: { agentId: agent.id } });
    expect(goals[0]!.conversionType).toBeNull();
  });

  it("edits tier/weight on an ACTIVE agent: persists and the reward reflects the new values", async () => {
    const agent = await createAgent({ status: "active" });
    await createGoal(agent.id, { eventName: "plan_started", tier: "good", valueWeight: 5 });

    // Retune to best/10 (the inline editor PUTs the whole list).
    const res = await PUT(
      buildRequest("PUT", [{ eventName: "plan_started", tier: "best", valueWeight: 10 }]) as NextRequest,
      { params: Promise.resolve({ id: agent.id }) },
    );
    expect(res.status).toBe(200); // no status gate — active agents are editable

    const goals = await prisma.goal.findMany({ where: { agentId: agent.id } });
    expect(goals).toHaveLength(1);
    expect(goals[0]!.tier).toBe("best");
    expect(goals[0]!.valueWeight).toBe(10);

    // The bandit reads goals fresh per conversion, so the new tier/weight take
    // effect immediately: best(10) × 10 / 100 = 1.0 (was good(5) × 5 / 100 = 0.25).
    expect(calculateReward("plan_started", goals as unknown as Goal[])).toBe(1);
  });
});
