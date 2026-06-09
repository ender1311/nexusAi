import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { createPersona } from "../helpers/builders";
import { app } from "../../apps/api/src/app";
import * as apiClient from "@/lib/api-client";
import { POST as postAgents } from "@/app/api/agents/route";
// Route handlers for [id] routes — Prisma directly
import { GET as getAgent, PATCH as patchAgent, DELETE as deleteAgent } from "@/app/api/agents/[id]/route";

const AUTH = { "Authorization": "Bearer test-secret" };

async function apiGet(path: string) {
  return app.request(path, { headers: AUTH });
}

beforeEach(async () => {
  await truncateAll();
});

afterEach(async () => {
  await truncateAll();
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

  // Regression: deleting an agent left bandit arm state / failed-send log / assignments
  // orphaned (no cascade FK on agentId). Prod accumulated 5k+ orphaned UserArmStats rows;
  // the DELETE route now clears them explicitly. See Artemis delete/recreate incident 2026-06-01.
  it("resets bandit stats, failed-send log, and assignments (non-cascading tables)", async () => {
    const agent = await prisma.agent.create({ data: { name: "Reset Me", algorithm: "thompson", epsilon: 0.1 } });
    const persona = await createPersona({ name: "Reset Persona" });
    await prisma.personaArmStats.create({ data: { personaId: persona.id, agentId: agent.id, variantId: "v1", alpha: 2, beta: 3, tries: 1, wins: 1 } });
    await prisma.userArmStats.create({ data: { userId: "u-reset", agentId: agent.id, variantId: "v1", alpha: 1, beta: 30, tries: 0, wins: 0 } });
    await prisma.linUCBArm.create({ data: { agentId: agent.id, variantId: "v1", aInv: [], b: [], tries: 0 } });
    await prisma.failedBrazeSend.create({ data: { agentId: agent.id, variantId: "v1", channel: "push", reason: "boom" } });
    await prisma.userAgentAssignment.create({ data: { externalUserId: "u-reset", agentId: agent.id } });

    const req = buildRequest("DELETE");
    const res = await deleteAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(200);

    expect(await prisma.personaArmStats.count({ where: { agentId: agent.id } })).toBe(0);
    expect(await prisma.userArmStats.count({ where: { agentId: agent.id } })).toBe(0);
    expect(await prisma.linUCBArm.count({ where: { agentId: agent.id } })).toBe(0);
    expect(await prisma.failedBrazeSend.count({ where: { agentId: agent.id } })).toBe(0);
    expect(await prisma.userAgentAssignment.count({ where: { agentId: agent.id } })).toBe(0);
    expect(await prisma.agent.findUnique({ where: { id: agent.id } })).toBeNull();
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

  it("returns 400 on malformed JSON", async () => {
    const agent = await prisma.agent.create({ data: { name: "JSON Agent", algorithm: "thompson", epsilon: 0.1 } });
    const req = new Request("http://localhost/", {
      method: "PATCH",
      body: "{not json",
      headers: { "Content-Type": "application/json" },
    });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON");
  });
});

describe("PATCH /api/agents/[id] — localizePush", () => {
  it("updates localizePush to true", async () => {
    const agent = await prisma.agent.create({ data: { name: "Loc Agent", algorithm: "thompson", epsilon: 0.1 } });
    const req = buildRequest("PATCH", { localizePush: true });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.localizePush).toBe(true);
  });

  it("updates localizePush back to false", async () => {
    const agent = await prisma.agent.create({ data: { name: "Loc Agent", algorithm: "thompson", epsilon: 0.1, localizePush: true } });
    const req = buildRequest("PATCH", { localizePush: false });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.localizePush).toBe(false);
  });

  it("returns 400 when localizePush is not a boolean", async () => {
    const agent = await prisma.agent.create({ data: { name: "Loc Agent", algorithm: "thompson", epsilon: 0.1 } });
    const req = buildRequest("PATCH", { localizePush: "yes" });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("localizePush must be a boolean");
  });

  it("leaves localizePush unchanged when omitted from the patch", async () => {
    const agent = await prisma.agent.create({ data: { name: "Loc Agent", algorithm: "thompson", epsilon: 0.1, localizePush: true } });
    const req = buildRequest("PATCH", { languageFilter: "en" });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.localizePush).toBe(true);
    expect(body.languageFilter).toBe("en");
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

// Shared spy instance whose implementation is swapped per-test.
// The wrapper is typed to match apiFetch's signature so TypeScript is happy;
// the actual spy captures calls for assertion.
let apiFetchSpy = mock((_path: string, _opts?: object) => Promise.resolve({}));
mock.module("@/lib/api-client", () => ({
  apiFetch: (path: string, opts?: object) => apiFetchSpy(path, opts),
  ApiError: apiClient.ApiError,
}));

describe("POST /api/agents — proxy behaviour", () => {
  it("forwards a created agent and returns 201", async () => {
    apiFetchSpy = mock(() => Promise.resolve({ id: "agent_1", name: "Proxied" }));

    const req = new Request("http://test/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Proxied", funnelStage: "wau" }),
    });
    const res = await postAgents(req as unknown as Parameters<typeof postAgents>[0]);
    expect(res.status).toBe(201);
    const json = await res.json() as { id: string };
    expect(json.id).toBe("agent_1");
    expect(apiFetchSpy).toHaveBeenCalled();
  });

  it("propagates an upstream 409 from the API service", async () => {
    apiFetchSpy = mock(() => Promise.reject(new apiClient.ApiError(409, "Segment taken")));

    const req = new Request("http://test/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Dup", funnelStage: "wau" }),
    });
    const res = await postAgents(req as unknown as Parameters<typeof postAgents>[0]);
    expect(res.status).toBe(409);
    const json = await res.json() as { error: string };
    expect(json.error).toBe("Segment taken");
  });

  it("returns 400 for an invalid JSON body without calling the service", async () => {
    apiFetchSpy = mock(() => Promise.resolve({}));

    const req = new Request("http://test/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await postAgents(req as unknown as Parameters<typeof postAgents>[0]);
    expect(res.status).toBe(400);
    expect(apiFetchSpy).not.toHaveBeenCalled();
  });
});

