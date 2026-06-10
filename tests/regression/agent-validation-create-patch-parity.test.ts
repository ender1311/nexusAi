// Regression (2026-06-09 audit, A6): agent CREATE (Hono service) and PATCH
// (Next.js [id] route) validated different field sets. Create silently coerced
// an invalid algorithm to "thompson" and a non-numeric epsilon to 0.1; PATCH
// accepted any algorithm string and out-of-range epsilon straight into the DB,
// where the bandit engine would then misbehave at decision time. Both surfaces
// now reject invalid algorithm/epsilon (and PATCH rejects empty names) with 400.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { createAgent } from "../helpers/builders";
import { PATCH as patchAgent } from "@/app/api/agents/[id]/route";
import { app } from "../../apps/api/src/app";

const AUTH = { Authorization: `Bearer ${process.env.INTERNAL_API_SECRET ?? "test-secret"}` };
const ADMIN = { ...AUTH, "X-User-Role": "admin", "Content-Type": "application/json" };

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

async function patch(id: string, body: Record<string, unknown>) {
  const req = buildRequest("PATCH", body);
  return patchAgent(req as NextRequest, { params: Promise.resolve({ id }) });
}

describe("PATCH /api/agents/[id] — validation parity (A6)", () => {
  it("rejects an unknown algorithm with 400 and does not persist it", async () => {
    const agent = await createAgent({ name: "A6 Patch Agent" });
    const res = await patch(agent.id, { algorithm: "bandit_3000" });
    expect(res.status).toBe(400);
    const fresh = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(fresh!.algorithm).toBe(agent.algorithm);
  });

  it("rejects epsilon outside [0, 1] with 400", async () => {
    const agent = await createAgent({ name: "A6 Patch Epsilon" });
    for (const epsilon of [-0.1, 1.5]) {
      const res = await patch(agent.id, { epsilon });
      expect(res.status).toBe(400);
    }
    const resStr = await patch(agent.id, { epsilon: "0.5" });
    expect(resStr.status).toBe(400);
  });

  it("rejects an empty / whitespace-only name with 400", async () => {
    const agent = await createAgent({ name: "A6 Patch Name" });
    for (const name of ["", "   "]) {
      const res = await patch(agent.id, { name });
      expect(res.status).toBe(400);
    }
    const fresh = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(fresh!.name).toBe("A6 Patch Name");
  });

  it("still accepts a valid algorithm + epsilon update", async () => {
    const agent = await createAgent({ name: "A6 Patch Valid" });
    const res = await patch(agent.id, { algorithm: "epsilon_greedy", epsilon: 0.25 });
    expect(res.status).toBe(200);
    const fresh = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(fresh!.algorithm).toBe("epsilon_greedy");
    expect(fresh!.epsilon).toBe(0.25);
  });
});

describe("POST /agents (Hono service) — validation parity (A6)", () => {
  it("rejects an unknown algorithm with 400 instead of coercing to thompson", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ name: "A6 Create", algorithm: "bandit_3000", funnelStage: "wau" }),
    });
    expect(res.status).toBe(400);
    const count = await prisma.agent.count({ where: { name: "A6 Create" } });
    expect(count).toBe(0);
  });

  it("rejects non-numeric or out-of-range epsilon with 400 instead of coercing to 0.1", async () => {
    for (const epsilon of ["0.5", -1, 2]) {
      const res = await app.request("/agents", {
        method: "POST",
        headers: ADMIN,
        body: JSON.stringify({ name: "A6 Create Eps", algorithm: "thompson", epsilon, funnelStage: "wau" }),
      });
      expect(res.status).toBe(400);
    }
  });

  it("still accepts a valid algorithm + epsilon", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({
        name: "A6 Create Valid", algorithm: "linucb", epsilon: 0.3,
        funnelStage: "wau", goals: [], messages: [],
      }),
    });
    expect(res.status).toBe(201);
  });
});
