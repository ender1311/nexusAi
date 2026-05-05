import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { createAgent } from "../helpers/builders";

import { PUT } from "@/app/api/agents/[id]/scheduling/route";

const baseRule = {
  frequencyCap: { maxSends: 3, period: "week" },
  quietHours: { start: "22:00", end: "08:00", timezone: "America/New_York" },
  blackoutDates: ["2025-12-25"],
  smartSuppress: false,
  suppressThresh: 0.5,
};

beforeEach(async () => {
  await truncateAll();
});

afterEach(async () => {
  await truncateAll();
});

describe("PUT /api/agents/[id]/scheduling", () => {
  it("creates a scheduling rule for an agent", async () => {
    const agent = await createAgent();
    const req = buildRequest("PUT", baseRule);
    const res = await PUT(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agentId).toBe(agent.id);
    expect(body.smartSuppress).toBe(false);
    expect(body.suppressThresh).toBe(0.5);

    const rule = await prisma.schedulingRule.findFirst({ where: { agentId: agent.id } });
    expect(rule).not.toBeNull();
    expect(rule!.blackoutDates).toEqual(["2025-12-25"]);
  });

  it("upserts — second PUT overwrites first, one rule in DB", async () => {
    const agent = await createAgent();

    const req1 = buildRequest("PUT", baseRule);
    await PUT(req1 as NextRequest, { params: Promise.resolve({ id: agent.id }) });

    const req2 = buildRequest("PUT", {
      ...baseRule,
      frequencyCap: { maxSends: 7, period: "month" },
      blackoutDates: [],
    });
    const res2 = await PUT(req2 as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res2.status).toBe(200);

    const rules = await prisma.schedulingRule.findMany({ where: { agentId: agent.id } });
    expect(rules.length).toBe(1);
    expect((rules[0]!.frequencyCap as { maxSends: number }).maxSends).toBe(7);
    expect(rules[0]!.blackoutDates).toEqual([]);
  });

  it("returns 400 for maxSends < 1", async () => {
    const agent = await createAgent();
    const req = buildRequest("PUT", {
      ...baseRule,
      frequencyCap: { maxSends: 0, period: "week" },
    });
    const res = await PUT(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("returns 400 for invalid period", async () => {
    const agent = await createAgent();
    const req = buildRequest("PUT", {
      ...baseRule,
      frequencyCap: { maxSends: 3, period: "quarterly" },
    });
    const res = await PUT(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 when blackoutDates is not an array", async () => {
    const agent = await createAgent();
    const req = buildRequest("PUT", { ...baseRule, blackoutDates: "2025-12-25" });
    const res = await PUT(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 when suppressThresh is out of range", async () => {
    const agent = await createAgent();
    const req = buildRequest("PUT", { ...baseRule, suppressThresh: 1.5 });
    const res = await PUT(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown agent", async () => {
    const req = buildRequest("PUT", baseRule);
    const res = await PUT(req as NextRequest, {
      params: Promise.resolve({ id: "nonexistent-id" }),
    });
    expect(res.status).toBe(404);
  });

  it("persists smartSuppress=true with custom suppressThresh", async () => {
    const agent = await createAgent();
    const req = buildRequest("PUT", {
      ...baseRule,
      smartSuppress: true,
      suppressThresh: 0.3,
    });
    const res = await PUT(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(200);

    const rule = await prisma.schedulingRule.findFirst({ where: { agentId: agent.id } });
    expect(rule!.smartSuppress).toBe(true);
    expect(rule!.suppressThresh).toBe(0.3);
  });
});
