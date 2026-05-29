import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { app } from "../../apps/api/src/app";

// POST /api/agents now uses Prisma directly (no Fly.io proxy)
import { POST as createAgent } from "@/app/api/agents/route";
// Route handlers for [id] routes — Prisma directly
import { GET as getAgent, PATCH as patchAgent, DELETE as deleteAgent } from "@/app/api/agents/[id]/route";

const AUTH = { "Authorization": "Bearer test-secret" };

async function apiPost(_path: string, body: unknown) {
  const req = buildRequest("POST", body);
  return createAgent(req as NextRequest);
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

describe("POST /api/agents — dailySendCap", () => {
  it("stores dailySendCap when provided", async () => {
    const res = await apiPost("/agents", {
      name: "Capped Agent",
      funnelStage: "wau",
      dailySendCap: 500,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.dailySendCap).toBe(500);
  });

  it("dailySendCap null means unlimited", async () => {
    const res = await apiPost("/agents", {
      name: "Unlimited Agent",
      funnelStage: "wau",
      dailySendCap: null,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.dailySendCap).toBeNull();
  });

  it("rejects non-positive dailySendCap", async () => {
    const res = await apiPost("/agents", {
      name: "Bad Agent",
      funnelStage: "wau",
      dailySendCap: -1,
    });
    expect(res.status).toBe(400);
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

describe("POST /api/agents — goal weight fields", () => {
  it("weightMode property goals are preserved", async () => {
    const res = await apiPost("/agents", {
      name: "Weight Mode Agent",
      algorithm: "thompson",
      funnelStage: "wau",
      goals: [
        {
          eventName: "order_completed",
          tier: "best",
          valueWeight: 5,
          weightMode: "property",
          weightProperty: "order_value",
          weightDefault: 2.5,
        },
      ],
      messages: [],
    });
    const body = await res.json();
    expect(res.status).toBe(201);

    const goals = await prisma.goal.findMany({ where: { agentId: body.id } });
    expect(goals).toHaveLength(1);
    expect(goals[0].weightMode).toBe("property");
    expect(goals[0].weightProperty).toBe("order_value");
    expect(goals[0].weightDefault).toBe(2.5);
  });
});

describe("POST /api/agents — targetPersonaIds", () => {
  it("targetPersonaIds creates persona targets", async () => {
    const persona = await prisma.persona.create({
      data: { name: "P1", label: "p1", traits: "{}", centroid: "[]" },
    });

    const res = await apiPost("/agents", {
      name: "Persona Agent",
      algorithm: "thompson",
      funnelStage: "wau",
      goals: [],
      messages: [],
      targetPersonaIds: [persona.id],
    });
    const body = await res.json();
    expect(res.status).toBe(201);

    const targets = await prisma.agentPersonaTarget.findMany({ where: { agentId: body.id } });
    expect(targets).toHaveLength(1);
    expect(targets[0].personaId).toBe(persona.id);
  });
});

describe("POST /api/agents — validation", () => {
  it("returns 400 when name is empty string", async () => {
    const res = await apiPost("/agents", {
      name: "",
      algorithm: "thompson",
      funnelStage: "wau",
      goals: [],
      messages: [],
    });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("name is required");
  });
});

describe("POST /api/agents — targetSegmentName", () => {
  it("creates agent with targetSegmentName and persists it", async () => {
    const res = await apiPost("/agents", {
      name: "Segment Agent",
      algorithm: "thompson",
      funnelStage: "wau",
      targetSegmentName: "bible_readers",
      goals: [],
      messages: [],
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.targetSegmentName).toBe("bible_readers");

    const persisted = await prisma.agent.findUnique({ where: { id: body.id } });
    expect(persisted!.targetSegmentName).toBe("bible_readers");
  });

  it("returns 400 when targetSegmentName is an empty string", async () => {
    const res = await apiPost("/agents", {
      name: "Bad Segment Agent",
      algorithm: "thompson",
      funnelStage: "wau",
      targetSegmentName: "",
      goals: [],
      messages: [],
    });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("targetSegmentName must be null or a non-empty string");
  });

  it("creates agent with null targetSegmentName (funnel stage mode)", async () => {
    const res = await apiPost("/agents", {
      name: "Null Segment Agent",
      algorithm: "thompson",
      funnelStage: "wau",
      targetSegmentName: null,
      goals: [],
      messages: [],
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.targetSegmentName).toBeNull();
  });
});

describe("PATCH /api/agents/[id] — targetSegmentName", () => {
  it("sets targetSegmentName to a new segment value and persists it", async () => {
    const agent = await prisma.agent.create({ data: { name: "Segment Agent", algorithm: "thompson", epsilon: 0.1 } });
    const req = buildRequest("PATCH", { targetSegmentName: "new_segment" });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.targetSegmentName).toBe("new_segment");

    const persisted = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(persisted!.targetSegmentName).toBe("new_segment");
  });

  it("returns 400 when targetSegmentName is an empty string", async () => {
    const agent = await prisma.agent.create({ data: { name: "Segment Agent", algorithm: "thompson", epsilon: 0.1 } });
    const req = buildRequest("PATCH", { targetSegmentName: "" });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("targetSegmentName must be null or a non-empty string");
  });

  it("clears targetSegmentName to null", async () => {
    const agent = await prisma.agent.create({
      data: { name: "Segment Agent", algorithm: "thompson", epsilon: 0.1, targetSegmentName: "old_segment" },
    });
    const req = buildRequest("PATCH", { targetSegmentName: null });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.targetSegmentName).toBeNull();

    const persisted = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(persisted!.targetSegmentName).toBeNull();
  });
});

describe("PATCH /api/agents/[id] — uniqueUsersCap", () => {
  it("silently ignores uniqueUsersCap in PATCH (read-only after creation)", async () => {
    const agent = await prisma.agent.create({
      data: { name: "Cap Agent", algorithm: "thompson", epsilon: 0.1, uniqueUsersCap: 1000 },
    });
    const req = buildRequest("PATCH", { uniqueUsersCap: 500 });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(200);

    // Field must remain unchanged — PATCH does not update uniqueUsersCap
    const persisted = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(persisted!.uniqueUsersCap).toBe(1000);
  });

  it("silently ignores uniqueUsersCap: null in PATCH", async () => {
    const agent = await prisma.agent.create({
      data: { name: "Cap Agent", algorithm: "thompson", epsilon: 0.1, uniqueUsersCap: 200 },
    });
    const req = buildRequest("PATCH", { uniqueUsersCap: null });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(200);

    const persisted = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(persisted!.uniqueUsersCap).toBe(200);
  });

  it("silently ignores invalid uniqueUsersCap values in PATCH (no 400)", async () => {
    const agent = await prisma.agent.create({ data: { name: "Cap Agent", algorithm: "thompson", epsilon: 0.1 } });
    for (const val of [0, -1, 1.5]) {
      const req = buildRequest("PATCH", { uniqueUsersCap: val });
      const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
      expect(res.status).toBe(200);
    }
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

  it("clears targetFilter when set to null", async () => {
    const agent = await prisma.agent.create({
      data: { name: "Filter Agent", algorithm: "thompson", epsilon: 0.1, targetFilter: { attribute: "country", op: "eq", value: "US" } },
    });
    const req = buildRequest("PATCH", { targetFilter: null });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.targetFilter).toBeNull();
  });

  it("returns 400 for invalid status value", async () => {
    const agent = await prisma.agent.create({ data: { name: "Agent", algorithm: "thompson", epsilon: 0.1 } });
    const req = buildRequest("PATCH", { status: "published" });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid status");
  });

  it("accepts valid status values: active, paused, draft", async () => {
    const agent = await prisma.agent.create({ data: { name: "Agent", algorithm: "thompson", epsilon: 0.1 } });
    for (const status of ["active", "paused", "draft"] as const) {
      const req = buildRequest("PATCH", { status });
      const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
      expect(res.status).toBe(200);
    }
  });
});

describe("PATCH /api/agents/:id — segmentTargeting", () => {
  it("accepts valid segmentTargeting", async () => {
    const agent = await prisma.agent.create({ data: { name: "Segment Agent", algorithm: "thompson", epsilon: 0.1 } });
    const req = buildRequest("PATCH", {
      segmentTargeting: { includes: ["seg_a", "seg_b"], excludes: ["seg_c"] },
    });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.segmentTargeting).toEqual({ includes: ["seg_a", "seg_b"], excludes: ["seg_c"] });
  });

  it("accepts null segmentTargeting (clear)", async () => {
    const agent = await prisma.agent.create({ data: { name: "Segment Agent", algorithm: "thompson", epsilon: 0.1 } });
    const req = buildRequest("PATCH", { segmentTargeting: null });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(200);
  });

  it("rejects invalid segmentTargeting shape — includes not an array", async () => {
    const agent = await prisma.agent.create({ data: { name: "Segment Agent", algorithm: "thompson", epsilon: 0.1 } });
    const req = buildRequest("PATCH", { segmentTargeting: { includes: "not_array", excludes: [] } });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(400);
  });

  it("rejects invalid segmentTargeting shape — missing excludes", async () => {
    const agent = await prisma.agent.create({ data: { name: "Segment Agent", algorithm: "thompson", epsilon: 0.1 } });
    const req = buildRequest("PATCH", { segmentTargeting: { includes: ["seg_a"] } });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(400);
  });

  it("rejects segmentTargeting with empty string in includes", async () => {
    const agent = await prisma.agent.create({ data: { name: "Segment Agent", algorithm: "thompson", epsilon: 0.1 } });
    const req = buildRequest("PATCH", { segmentTargeting: { includes: ["", "seg_b"], excludes: [] } });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(400);
  });

  it("releases user locks when segmentTargeting changes", async () => {
    const agent = await prisma.agent.create({
      data: { name: "Segment Agent", algorithm: "thompson", epsilon: 0.1, status: "active" },
    });
    await prisma.trackedUser.create({ data: { externalId: "u_seg1", lockedByAgentId: agent.id } });
    const req = buildRequest("PATCH", { segmentTargeting: { includes: ["seg_x"], excludes: [] } });
    await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const user = await prisma.trackedUser.findUnique({ where: { externalId: "u_seg1" } });
    expect(user?.lockedByAgentId).toBeNull();
  });

  it("rejects segmentTargeting with overlap between includes and excludes", async () => {
    const agent = await prisma.agent.create({ data: { name: "Segment Agent", algorithm: "thompson", epsilon: 0.1 } });
    const req = buildRequest("PATCH", { segmentTargeting: { includes: ["seg_a", "seg_b"], excludes: ["seg_b"] } });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("seg_b");
  });
});

describe("POST /api/agents — segmentTargeting", () => {
  function basePayload(overrides: Record<string, unknown> = {}) {
    return {
      name: "Segment Agent",
      algorithm: "thompson",
      epsilon: 0.1,
      goals: [],
      messages: [],
      ...overrides,
    };
  }

  it("creates agent with segmentTargeting (no funnelStage required)", async () => {
    const res = await apiPost("/agents", basePayload({
      segmentTargeting: { includes: ["seg_a", "seg_b"], excludes: ["seg_c"] },
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.segmentTargeting).toEqual({ includes: ["seg_a", "seg_b"], excludes: ["seg_c"] });
  });

  it("creates agent with excludes-only segmentTargeting + funnelStage", async () => {
    const res = await apiPost("/agents", basePayload({
      funnelStage: "wau",
      segmentTargeting: { includes: [], excludes: ["seg_c"] },
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.segmentTargeting).toEqual({ includes: [], excludes: ["seg_c"] });
  });

  it("still requires funnelStage when includes is empty", async () => {
    const res = await apiPost("/agents", basePayload({
      segmentTargeting: { includes: [], excludes: [] },
      // no funnelStage
    }));
    expect(res.status).toBe(400);
  });

  it("rejects segmentTargeting with overlap between includes and excludes", async () => {
    const res = await apiPost("/agents", basePayload({
      segmentTargeting: { includes: ["seg_a"], excludes: ["seg_a"] },
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("seg_a");
  });

  it("rejects segmentTargeting with invalid shape", async () => {
    const res = await apiPost("/agents", basePayload({
      segmentTargeting: { includes: "not_array", excludes: [] },
    }));
    expect(res.status).toBe(400);
  });

  it("rejects when include segment is exclusively assigned to another agent via targetSegmentName", async () => {
    await prisma.agent.create({
      data: { name: "Other Agent", algorithm: "thompson", epsilon: 0.1, targetSegmentName: "seg_taken" },
    });
    const res = await apiPost("/agents", basePayload({
      segmentTargeting: { includes: ["seg_taken"], excludes: [] },
    }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("seg_taken");
  });
});
