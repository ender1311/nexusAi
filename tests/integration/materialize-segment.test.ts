import { describe, it, expect, beforeEach } from "bun:test";
import { prisma } from "@/lib/db";
import { materializeSegment } from "@/lib/segments/materialize";
import { compileSegmentRule } from "@/lib/segments/compile-sql";
import { createUser, createUserSegment } from "../helpers/builders";
import type { SegmentRule } from "@/types/segment";

// funnelStage = 'wau' → "(u."funnelStage" = $1)" with params ["wau"]
const WAU_RULE: SegmentRule = {
  kind: "group",
  join: "AND",
  children: [{ kind: "condition", fieldId: "funnelStage", operator: "eq", value: "wau" }],
};

describe("materializeSegment", () => {
  beforeEach(async () => {
    await prisma.userSegment.deleteMany();
    await prisma.trackedUser.deleteMany();
  });

  it("inserts exactly the matching users as source='rule'", async () => {
    await createUser("match-1", { funnelStage: "wau" });
    await createUser("match-2", { funnelStage: "wau" });
    await createUser("no-match", { funnelStage: "mau" });

    const where = compileSegmentRule(WAU_RULE);
    const runStart = new Date();
    const result = await prisma.$transaction((tx) =>
      materializeSegment(tx, { segmentName: "wau-seg", where, runStart }),
    );

    expect(result.matched).toBe(2);
    const rows = await prisma.userSegment.findMany({
      where: { segmentName: "wau-seg", source: "rule" },
      orderBy: { externalId: "asc" },
    });
    expect(rows.map((r) => r.externalId)).toEqual(["match-1", "match-2"]);
  });

  it("sweeps stale rule-members who no longer match", async () => {
    await createUser("still-matches", { funnelStage: "wau" });
    await prisma.userSegment.create({
      data: {
        externalId: "gone",
        segmentName: "wau-seg",
        source: "rule",
        syncedAt: new Date("2020-01-01T00:00:00Z"),
      },
    });

    const where = compileSegmentRule(WAU_RULE);
    const runStart = new Date();
    const result = await prisma.$transaction((tx) =>
      materializeSegment(tx, { segmentName: "wau-seg", where, runStart }),
    );

    expect(result.deleted).toBe(1);
    const remaining = await prisma.userSegment.findMany({ where: { segmentName: "wau-seg", source: "rule" } });
    expect(remaining.map((r) => r.externalId)).toEqual(["still-matches"]);
  });

  it("never touches source='hightouch' rows for the same segmentName", async () => {
    await createUser("rule-match", { funnelStage: "wau" });
    await createUserSegment("ht-only", "wau-seg", "hightouch");

    const where = compileSegmentRule(WAU_RULE);
    await prisma.$transaction((tx) =>
      materializeSegment(tx, { segmentName: "wau-seg", where, runStart: new Date() }),
    );

    const ht = await prisma.userSegment.findMany({ where: { segmentName: "wau-seg", source: "hightouch" } });
    expect(ht.map((r) => r.externalId)).toEqual(["ht-only"]);
  });
});
