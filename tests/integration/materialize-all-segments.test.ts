import { describe, it, expect, beforeEach } from "bun:test";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { materializeAllSegments } from "@/lib/segments/materialize";
import { createUser, createAgent, createUserSegment } from "../helpers/builders";

const WAU_RULE = {
  kind: "group",
  join: "AND",
  children: [{ kind: "condition", fieldId: "funnelStage", operator: "in", value: ["wau"] }],
};

async function createSegment(name: string, rule: unknown) {
  return prisma.segment.create({ data: { name, rule: rule as Prisma.InputJsonValue } });
}

describe("materializeAllSegments", () => {
  beforeEach(async () => {
    await prisma.userSegment.deleteMany();
    await prisma.trackedUser.deleteMany();
    await prisma.agent.deleteMany();
    await prisma.segment.deleteMany();
  });

  it("materializes a referenced rule-segment (happy path)", async () => {
    await createUser("wau-1", { funnelStage: "wau" });
    await createUser("mau-1", { funnelStage: "mau" });
    await createSegment("wau-seg", WAU_RULE);
    await createAgent({ segmentTargeting: { includes: ["wau-seg"], excludes: [] } });

    const summary = await materializeAllSegments({ runStart: new Date() });

    expect(summary.segmentsProcessed).toBe(1);
    const rows = await prisma.userSegment.findMany({ where: { segmentName: "wau-seg", source: "rule" } });
    expect(rows.map((r) => r.externalId)).toEqual(["wau-1"]);
  });

  it("removes stale rule-members across runs", async () => {
    await createUser("wau-1", { funnelStage: "wau" });
    await createSegment("wau-seg", WAU_RULE);
    await createAgent({ segmentTargeting: { includes: ["wau-seg"], excludes: [] } });
    await materializeAllSegments({ runStart: new Date() });

    await prisma.trackedUser.update({ where: { externalId: "wau-1" }, data: { funnelStage: "mau" } });
    await materializeAllSegments({ runStart: new Date() });

    const rows = await prisma.userSegment.findMany({ where: { segmentName: "wau-seg", source: "rule" } });
    expect(rows).toHaveLength(0);
  });

  it("leaves Hightouch rows intact under the same segmentName", async () => {
    await createUser("wau-1", { funnelStage: "wau" });
    await createUserSegment("ht-1", "wau-seg", "hightouch");
    await createSegment("wau-seg", WAU_RULE);
    await createAgent({ segmentTargeting: { includes: ["wau-seg"], excludes: [] } });

    await materializeAllSegments({ runStart: new Date() });

    const ht = await prisma.userSegment.findMany({ where: { segmentName: "wau-seg", source: "hightouch" } });
    expect(ht.map((r) => r.externalId)).toEqual(["ht-1"]);
  });

  it("does not materialize segments no agent references", async () => {
    await createUser("wau-1", { funnelStage: "wau" });
    await createSegment("unreferenced", WAU_RULE);
    await createAgent({ segmentTargeting: null, targetSegmentName: null });

    const summary = await materializeAllSegments({ runStart: new Date() });

    expect(summary.segmentsProcessed).toBe(0);
    const rows = await prisma.userSegment.findMany({ where: { segmentName: "unreferenced" } });
    expect(rows).toHaveLength(0);
  });

  it("skips a segment whose rule is unparseable (never matches everyone)", async () => {
    await createUser("anyone", { funnelStage: "wau" });
    await createSegment("broken", { kind: "condition", fieldId: "nonexistent_field", operator: "eq", value: 1 });
    await createAgent({ segmentTargeting: { includes: ["broken"], excludes: [] } });

    const summary = await materializeAllSegments({ runStart: new Date() });

    expect(summary.segmentsSkipped).toBe(1);
    expect(summary.segmentsProcessed).toBe(0);
    const rows = await prisma.userSegment.findMany({ where: { segmentName: "broken" } });
    expect(rows).toHaveLength(0);
  });

  it("skips an empty rule that would compile to match-everyone", async () => {
    await createUser("anyone", { funnelStage: "wau" });
    await createSegment("empty", { kind: "group", join: "AND", children: [] });
    await createAgent({ segmentTargeting: { includes: ["empty"], excludes: [] } });

    const summary = await materializeAllSegments({ runStart: new Date() });

    expect(summary.segmentsSkipped).toBe(1);
    const rows = await prisma.userSegment.findMany({ where: { segmentName: "empty" } });
    expect(rows).toHaveLength(0);
  });
});
