import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { app } from "../../apps/api/src/app";

// Route handlers for [id] routes — still use Prisma directly
import { GET as getAgent, PATCH as patchAgent, DELETE as deleteAgent } from "@/app/api/agents/[id]/route";

const AUTH = { "Authorization": "Bearer test-secret" };
const ADMIN = { ...AUTH, "X-User-Role": "admin", "Content-Type": "application/json" };

async function apiPost(path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: ADMIN,
    body: JSON.stringify(body),
  });
}

async function apiGet(path: string) {
  return app.request(path, { headers: AUTH });
}

beforeEach(async () => {
  await truncateAll();
});

afterEach(async () => {
  await truncateAll();
});

describe("POST /api/agents", () => {
  it("creates an agent and returns 201", async () => {
    const res = await apiPost("/agents", {
      name: "Test Campaign",
      algorithm: "thompson",
      epsilon: 0.1,
      funnelStage: "wau",
      goals: [],
      messages: [],
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.name).toBe("Test Campaign");
    expect(body.id).toBeTruthy();
  });
});

describe("GET /api/agents", () => {
  it("returns empty array when no agents", async () => {
    const res = await apiGet("/agents");
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it("returns created agents", async () => {
    await prisma.agent.create({ data: { name: "Agent A", algorithm: "thompson", epsilon: 0.1 } });
    await prisma.agent.create({ data: { name: "Agent B", algorithm: "epsilon_greedy", epsilon: 0.2 } });
    const res = await apiGet("/agents");
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
    const req = buildRequest("PATCH", { funnelStage: "dau4" });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.funnelStage).toBe("dau4");
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
    const res = await apiPost("/agents", {
      name: "Staged Agent",
      algorithm: "thompson",
      epsilon: 0.1,
      funnelStage: "lapsed_mau",
      targetFilter: filter,
      goals: [],
      messages: [],
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.funnelStage).toBe("lapsed_mau");
    expect(body.targetFilter).toEqual(filter);
  });

  it("returns 400 for invalid funnelStage", async () => {
    const res = await apiPost("/agents", {
      name: "Bad Stage Agent",
      algorithm: "thompson",
      funnelStage: "unknown",
      goals: [],
      messages: [],
    });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid funnelStage");
  });

  it("returns 400 when funnelStage is missing", async () => {
    const res = await apiPost("/agents", {
      name: "No Stage Agent",
      algorithm: "thompson",
      goals: [],
      messages: [],
    });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid funnelStage");
  });

  it("returns 400 for invalid targetFilter (array) on POST", async () => {
    const res = await apiPost("/agents", {
      name: "Bad Filter Agent",
      algorithm: "thompson",
      funnelStage: "wau",
      targetFilter: [1, 2, 3],
      goals: [],
      messages: [],
    });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("targetFilter must be a plain object");
  });
});

describe("POST /api/agents — uniqueUsersCap", () => {
  it("creates agent with uniqueUsersCap and persists it", async () => {
    const res = await apiPost("/agents", {
      name: "Capped Agent",
      algorithm: "thompson",
      funnelStage: "wau",
      uniqueUsersCap: 10000,
      goals: [],
      messages: [],
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.uniqueUsersCap).toBe(10000);

    const persisted = await prisma.agent.findUnique({ where: { id: body.id } });
    expect(persisted!.uniqueUsersCap).toBe(10000);
  });

  it("creates agent with null uniqueUsersCap (unlimited)", async () => {
    const res = await apiPost("/agents", {
      name: "Unlimited Agent",
      algorithm: "thompson",
      funnelStage: "wau",
      uniqueUsersCap: null,
      goals: [],
      messages: [],
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.uniqueUsersCap).toBeNull();
  });

  it("creates agent without uniqueUsersCap field (defaults to null)", async () => {
    const res = await apiPost("/agents", {
      name: "No Cap Agent",
      algorithm: "thompson",
      funnelStage: "wau",
      goals: [],
      messages: [],
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.uniqueUsersCap).toBeNull();
  });

  it("returns 400 when uniqueUsersCap is 0", async () => {
    const res = await apiPost("/agents", {
      name: "Bad Cap Agent",
      algorithm: "thompson",
      funnelStage: "wau",
      uniqueUsersCap: 0,
      goals: [],
      messages: [],
    });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("uniqueUsersCap must be null or a positive integer");
  });

  it("returns 400 when uniqueUsersCap is negative", async () => {
    const res = await apiPost("/agents", {
      name: "Bad Cap Agent",
      algorithm: "thompson",
      funnelStage: "wau",
      uniqueUsersCap: -500,
      goals: [],
      messages: [],
    });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("uniqueUsersCap must be null or a positive integer");
  });
});

describe("POST /api/agents — sourceTemplateId", () => {
  it("stores sourceTemplateId on variant when provided", async () => {
    // Create template data directly via Prisma for a real FK-valid ID
    const templateAgent = await prisma.agent.create({
      data: { name: "Template Agent", algorithm: "thompson", epsilon: 0.1, funnelStage: "connected" },
    });
    const templateMessage = await prisma.message.create({
      data: { agentId: templateAgent.id, name: "Template Msg", channel: "push" },
    });
    const templateVariant = await prisma.messageVariant.create({
      data: { messageId: templateMessage.id, name: "Template V1", body: "Template body" },
    });

    const res = await apiPost("/agents", {
      name: "Test Agent",
      funnelStage: "wau",
      messages: [
        {
          name: "Push Message",
          channel: "push",
          variants: [
            {
              name: "V1",
              body: "Test body",
              title: "Test title",
              deeplink: "youversion://bible",
              sourceTemplateId: templateVariant.id,
            },
          ],
        },
      ],
    });
    const agent = await res.json();

    expect(res.status).toBe(201);

    const variant = await prisma.messageVariant.findFirst({
      where: { message: { agentId: agent.id } },
    });
    expect(variant).not.toBeNull();
    expect(variant!.sourceTemplateId).toBe(templateVariant.id);
    expect(variant!.deeplink).toBe("youversion://bible");
  });
});

describe("PATCH /api/agents/[id] — uniqueUsersCap", () => {
  it("sets uniqueUsersCap to a positive integer and persists it", async () => {
    const agent = await prisma.agent.create({ data: { name: "Cap Agent", algorithm: "thompson", epsilon: 0.1 } });
    const req = buildRequest("PATCH", { uniqueUsersCap: 500 });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.uniqueUsersCap).toBe(500);

    const persisted = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(persisted!.uniqueUsersCap).toBe(500);
  });

  it("clears uniqueUsersCap to null", async () => {
    const agent = await prisma.agent.create({
      data: { name: "Cap Agent", algorithm: "thompson", epsilon: 0.1, uniqueUsersCap: 200 },
    });
    const req = buildRequest("PATCH", { uniqueUsersCap: null });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.uniqueUsersCap).toBeNull();

    const persisted = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(persisted!.uniqueUsersCap).toBeNull();
  });

  it("returns 400 when uniqueUsersCap is 0", async () => {
    const agent = await prisma.agent.create({ data: { name: "Cap Agent", algorithm: "thompson", epsilon: 0.1 } });
    const req = buildRequest("PATCH", { uniqueUsersCap: 0 });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("uniqueUsersCap must be null or a positive integer");
  });

  it("returns 400 when uniqueUsersCap is -1", async () => {
    const agent = await prisma.agent.create({ data: { name: "Cap Agent", algorithm: "thompson", epsilon: 0.1 } });
    const req = buildRequest("PATCH", { uniqueUsersCap: -1 });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("uniqueUsersCap must be null or a positive integer");
  });

  it("returns 400 when uniqueUsersCap is a float (1.5)", async () => {
    const agent = await prisma.agent.create({ data: { name: "Cap Agent", algorithm: "thompson", epsilon: 0.1 } });
    const req = buildRequest("PATCH", { uniqueUsersCap: 1.5 });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("uniqueUsersCap must be null or a positive integer");
  });

  it("GET response includes uniqueUsersCap field", async () => {
    const agent = await prisma.agent.create({
      data: { name: "Cap Agent", algorithm: "thompson", epsilon: 0.1, uniqueUsersCap: 1000 },
    });
    const req = buildRequest("GET");
    const res = await getAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.uniqueUsersCap).toBe(1000);
  });
});
