import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../../helpers/db";
import { createAgent, createPersona } from "../../helpers/builders";
import { app } from "../../../apps/api/src/app";

// Note: PATCH and DELETE agents are still handled by the Next.js [id] route,
// not yet migrated to the Hono API service. Tests for those live in
// tests/integration/agents.test.ts.

const AUTH = { Authorization: `Bearer ${process.env.INTERNAL_API_SECRET ?? "test-secret"}` };
const ADMIN = { ...AUTH, "X-User-Role": "admin", "Content-Type": "application/json" };

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("GET /agents", () => {
  it("returns empty array when no agents exist", async () => {
    const res = await app.request("/agents", { headers: AUTH });
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it("returns all created agents", async () => {
    await createAgent({ name: "Agent A" });
    await createAgent({ name: "Agent B" });
    const res = await app.request("/agents", { headers: AUTH });
    const body = await res.json() as Array<{ name: string }>;
    expect(body.length).toBe(2);
    expect(body.map((a) => a.name)).toContain("Agent A");
    expect(body.map((a) => a.name)).toContain("Agent B");
  });

  it("returns 401 without auth header", async () => {
    const res = await app.request("/agents");
    expect(res.status).toBe(401);
  });
});

describe("POST /agents", () => {
  it("returns 403 without admin role", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X", algorithm: "thompson", epsilon: 0.1, funnelStage: "wau" }),
    });
    expect(res.status).toBe(403);
  });

  it("creates agent and returns 201", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({
        name: "New Agent",
        algorithm: "thompson",
        epsilon: 0.1,
        funnelStage: "wau",
        goals: [],
        messages: [],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string; name: string };
    expect(body.name).toBe("New Agent");
    expect(body.id).toBeTruthy();
    const dbAgent = await prisma.agent.findUnique({ where: { id: body.id } });
    expect(dbAgent).not.toBeNull();
  });

  it("returns 400 for invalid funnelStage", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ name: "X", algorithm: "thompson", funnelStage: "invalid" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X", algorithm: "thompson", funnelStage: "wau" }),
    });
    expect(res.status).toBe(401);
  });

  it("creates agent with valid funnelStage and round-trips it", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({
        name: "Funnel Agent",
        algorithm: "thompson",
        epsilon: 0.1,
        funnelStage: "lapsed_mau",
        goals: [],
        messages: [],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { funnelStage: string };
    expect(body.funnelStage).toBe("lapsed_mau");
  });

  it("creates agent with targetFilter and round-trips it", async () => {
    const filter = { attribute: "country", op: "eq", value: "US" };
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({
        name: "Filter Agent",
        algorithm: "thompson",
        epsilon: 0.1,
        funnelStage: "wau",
        targetFilter: filter,
        goals: [],
        messages: [],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { targetFilter: unknown };
    expect(body.targetFilter).toEqual(filter);
  });

  it("returns 400 for array targetFilter", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({
        name: "Bad Filter",
        algorithm: "thompson",
        funnelStage: "wau",
        targetFilter: [1, 2, 3],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("targetFilter must be a plain object");
  });
});

describe("POST /agents — caps defaults", () => {
  it("defaults uniqueUsersCap to 1000 when omitted", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ name: "Caps A", funnelStage: "wau", goals: [], messages: [] }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { uniqueUsersCap: number | null };
    expect(body.uniqueUsersCap).toBe(1000);
  });

  it("defaults dailySendCap to 500 when omitted", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ name: "Caps B", funnelStage: "wau", goals: [], messages: [] }),
    });
    const body = await res.json() as { dailySendCap: number | null };
    expect(body.dailySendCap).toBe(500);
  });

  it("accepts null uniqueUsersCap (unlimited) and persists null", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ name: "Caps C", funnelStage: "wau", uniqueUsersCap: null, goals: [], messages: [] }),
    });
    const body = await res.json() as { uniqueUsersCap: number | null };
    expect(body.uniqueUsersCap).toBeNull();
  });

  it("accepts null dailySendCap (unlimited) and persists null", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ name: "Caps F", funnelStage: "wau", dailySendCap: null, goals: [], messages: [] }),
    });
    const body = await res.json() as { dailySendCap: number | null };
    expect(body.dailySendCap).toBeNull();
  });

  it("returns 400 when uniqueUsersCap is 0", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ name: "Caps D", funnelStage: "wau", uniqueUsersCap: 0 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when dailySendCap is negative", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ name: "Caps E", funnelStage: "wau", dailySendCap: -3 }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /agents — name validation", () => {
  it("returns 400 when name is empty string", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ name: "   ", funnelStage: "wau" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("name is required");
  });
});

describe("POST /agents — targetSegmentName", () => {
  it("persists targetSegmentName when provided", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ name: "Seg A", funnelStage: "wau", targetSegmentName: "vip-users", goals: [], messages: [] }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { targetSegmentName: string | null };
    expect(body.targetSegmentName).toBe("vip-users");
  });

  it("returns 409 when targetSegmentName is already assigned to another agent", async () => {
    await createAgent({ name: "Owner", targetSegmentName: "exclusive-seg" });
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ name: "Seg B", funnelStage: "wau", targetSegmentName: "exclusive-seg" }),
    });
    expect(res.status).toBe(409);
  });

  it("returns 400 when targetSegmentName is an empty string", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ name: "Seg C", funnelStage: "wau", targetSegmentName: "  " }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /agents — segmentTargeting", () => {
  it("persists includes/excludes and bypasses funnelStage requirement", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({
        name: "MultiSeg A",
        segmentTargeting: { includes: ["seg-1", "seg-2"], excludes: ["seg-3"] },
        goals: [],
        messages: [],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { segmentTargeting: { includes: string[]; excludes: string[] } };
    expect(body.segmentTargeting.includes).toEqual(["seg-1", "seg-2"]);
    expect(body.segmentTargeting.excludes).toEqual(["seg-3"]);
  });

  it("returns 400 when an include also appears in excludes", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({
        name: "MultiSeg B",
        segmentTargeting: { includes: ["dup"], excludes: ["dup"] },
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 409 when an include segment is exclusively held by another agent", async () => {
    await createAgent({ name: "Holder", targetSegmentName: "held-seg" });
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({
        name: "MultiSeg C",
        segmentTargeting: { includes: ["held-seg"], excludes: [] },
      }),
    });
    expect(res.status).toBe(409);
  });

  it("returns 400 for a non-string include entry", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({
        name: "MultiSeg D",
        segmentTargeting: { includes: [123], excludes: [] },
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /agents — targetPersonaIds", () => {
  it("creates AgentPersonaTarget rows for each persona id", async () => {
    const p1 = await createPersona({ name: "P1" });
    const p2 = await createPersona({ name: "P2" });
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({
        name: "Persona Agent",
        funnelStage: "wau",
        targetPersonaIds: [p1.id, p2.id],
        goals: [],
        messages: [],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string };
    const targets = await prisma.agentPersonaTarget.findMany({ where: { agentId: body.id } });
    expect(targets.length).toBe(2);
  });
});

describe("POST /agents — required nested fields", () => {
  it("returns 400 when a goal is missing eventName", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({
        name: "Bad Goal",
        funnelStage: "wau",
        goals: [{ tier: "primary" }],
        messages: [],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("each goal requires a non-empty eventName");
  });

  it("returns 400 when a message is missing channel", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({
        name: "Bad Message",
        funnelStage: "wau",
        goals: [],
        messages: [{ name: "M1" }],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("each message requires a non-empty channel");
  });
});

describe("POST /agents — nested goals & messages", () => {
  it("creates goals, messages, and variants and computes testedVariables", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({
        name: "Nested Agent",
        funnelStage: "wau",
        goals: [{ eventName: "purchase", tier: "primary", valueWeight: 2 }],
        messages: [{
          name: "M1",
          channel: "push",
          variants: [
            { name: "A", body: "Hello", title: "T1" },
            { name: "B", body: "Hello", title: "T2" },
          ],
        }],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string };
    const msg = await prisma.message.findFirst({ where: { agentId: body.id } });
    expect(msg).not.toBeNull();
    expect(msg!.testedVariables).toContain("title");
    const goalCount = await prisma.goal.count({ where: { agentId: body.id } });
    expect(goalCount).toBe(1);
  });
});
