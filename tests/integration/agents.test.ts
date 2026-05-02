import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";

// Route handlers — import after env is set
import { GET as getAgents, POST as postAgent } from "@/app/api/agents/route";
import { GET as getAgent, PATCH as patchAgent, DELETE as deleteAgent } from "@/app/api/agents/[id]/route";

beforeEach(async () => {
  await truncateAll();
});

afterEach(async () => {
  await truncateAll();
});

describe("POST /api/agents", () => {
  it("creates an agent and returns 201", async () => {
    const req = buildRequest("POST", {
      name: "Test Campaign",
      algorithm: "thompson",
      epsilon: 0.1,
      funnelStage: "connected",
      goals: [],
      messages: [],
    });
    const res = await postAgent(req as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.name).toBe("Test Campaign");
    expect(body.id).toBeTruthy();
  });
});

describe("GET /api/agents", () => {
  it("returns empty array when no agents", async () => {
    const res = await getAgents();
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it("returns created agents", async () => {
    await prisma.agent.create({ data: { name: "Agent A", algorithm: "thompson", epsilon: 0.1 } });
    await prisma.agent.create({ data: { name: "Agent B", algorithm: "epsilon_greedy", epsilon: 0.2 } });
    const res = await getAgents();
    const body = await res.json();
    expect(body).toHaveLength(2);
  });
});

describe("GET /api/agents/[id]", () => {
  it("returns 404 for missing agent", async () => {
    const req = buildRequest("GET");
    const res = await getAgent(req as NextRequest, { params: Promise.resolve({ id: "nonexistent-id" }) });
    expect(res.status).toBe(404);
  });

  it("returns the agent by id", async () => {
    const agent = await prisma.agent.create({ data: { name: "Found", algorithm: "thompson", epsilon: 0.1 } });
    const req = buildRequest("GET");
    const res = await getAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.id).toBe(agent.id);
    expect(body.name).toBe("Found");
  });
});

describe("DELETE /api/agents/[id]", () => {
  it("deletes the agent and cascades goals/messages", async () => {
    const agent = await prisma.agent.create({ data: { name: "Doomed", algorithm: "thompson", epsilon: 0.1 } });
    await prisma.goal.create({ data: { agentId: agent.id, eventName: "ev", tier: "best", valueWeight: 1 } });

    const req = buildRequest("DELETE");
    const res = await deleteAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);

    const goals = await prisma.goal.findMany({ where: { agentId: agent.id } });
    expect(goals).toHaveLength(0);
  });
});

describe("PATCH /api/agents/[id]", () => {
  it("updates agent status", async () => {
    const agent = await prisma.agent.create({ data: { name: "Agent", algorithm: "thompson", epsilon: 0.1 } });
    const req = buildRequest("PATCH", { status: "active" });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("active");
  });

  it("updates funnelStage to a different valid value", async () => {
    const agent = await prisma.agent.create({ data: { name: "Stage Agent", algorithm: "thompson", epsilon: 0.1 } });
    const req = buildRequest("PATCH", { funnelStage: "engaged" });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.funnelStage).toBe("engaged");
  });

  it("returns 400 for invalid funnelStage", async () => {
    const agent = await prisma.agent.create({ data: { name: "Stage Agent", algorithm: "thompson", epsilon: 0.1 } });
    const req = buildRequest("PATCH", { funnelStage: "badstage" });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid funnelStage");
  });

  it("returns 400 for invalid targetFilter (array)", async () => {
    const agent = await prisma.agent.create({ data: { name: "Filter Agent", algorithm: "thompson", epsilon: 0.1 } });
    const req = buildRequest("PATCH", { targetFilter: ["not", "an", "object"] });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("targetFilter must be a plain object");
  });

  it("updates targetFilter when provided as a valid plain object", async () => {
    const agent = await prisma.agent.create({ data: { name: "Filter Agent", algorithm: "thompson", epsilon: 0.1 } });
    const filter = { attribute: "country", op: "eq", value: "US" };
    const req = buildRequest("PATCH", { targetFilter: filter });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.targetFilter).toEqual(filter);
  });
});

describe("POST /api/agents — funnelStage + targetFilter", () => {
  it("creates agent with valid funnelStage and targetFilter, round-trips both fields", async () => {
    const filter = { attribute: "country", op: "eq", value: "US" };
    const req = buildRequest("POST", {
      name: "Staged Agent",
      algorithm: "thompson",
      epsilon: 0.1,
      funnelStage: "lapsed",
      targetFilter: filter,
      goals: [],
      messages: [],
    });
    const res = await postAgent(req as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.funnelStage).toBe("lapsed");
    expect(body.targetFilter).toEqual(filter);
  });

  it("returns 400 for invalid funnelStage", async () => {
    const req = buildRequest("POST", {
      name: "Bad Stage Agent",
      algorithm: "thompson",
      funnelStage: "unknown",
      goals: [],
      messages: [],
    });
    const res = await postAgent(req as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid funnelStage");
  });

  it("returns 400 when funnelStage is missing", async () => {
    const req = buildRequest("POST", {
      name: "No Stage Agent",
      algorithm: "thompson",
      goals: [],
      messages: [],
    });
    const res = await postAgent(req as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid funnelStage");
  });

  it("returns 400 for invalid targetFilter (array) on POST", async () => {
    const req = buildRequest("POST", {
      name: "Bad Filter Agent",
      algorithm: "thompson",
      funnelStage: "connected",
      targetFilter: [1, 2, 3],
      goals: [],
      messages: [],
    });
    const res = await postAgent(req as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("targetFilter must be a plain object");
  });
});
