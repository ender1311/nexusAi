import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../../helpers/db";
import { createAgent } from "../../helpers/builders";
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
