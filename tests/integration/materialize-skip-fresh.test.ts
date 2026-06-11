import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { materializeAllSegments } from "@/lib/segments/materialize";
import { USER_INGEST_MARKER_KEY } from "@/lib/segments/ingest-marker";
import { createUser, createAgent } from "../helpers/builders";

const WAU_RULE = {
  kind: "group",
  join: "AND",
  children: [{ kind: "condition", fieldId: "funnelStage", operator: "in", value: ["wau"] }],
};

async function createSegment(name: string, rule: unknown) {
  return prisma.segment.create({ data: { name, rule: rule as Prisma.InputJsonValue } });
}

async function setIngestMarker(at: Date) {
  await prisma.appSetting.upsert({
    where: { key: USER_INGEST_MARKER_KEY },
    create: { key: USER_INGEST_MARKER_KEY, value: at.toISOString() },
    update: { value: at.toISOString() },
  });
}

// IMPORTANT: all timestamps are relative to `new Date()` captured AFTER fixture
// creation. Fixed wall-clock timestamps would race against the real
// Segment.updatedAt (@updatedAt) values Prisma writes at test time.

describe("drift-aware materialization skip", () => {
  beforeEach(async () => {
    await prisma.userSegment.deleteMany();
    await prisma.trackedUser.deleteMany();
    await prisma.agent.deleteMany();
    await prisma.segment.deleteMany();
    await prisma.appSetting.deleteMany();
  });

  // Older materialize suites rely on the fail-open (no-marker) path and don't
  // clear AppSetting in their own beforeEach. Remove the marker after every
  // test so it can't leak into files that run later against the shared DB.
  afterEach(async () => {
    await prisma.appSetting.deleteMany({ where: { key: USER_INGEST_MARKER_KEY } });
  });

  it("skips a fresh segment and reports segmentsSkippedFresh", async () => {
    await createUser("wau-1", { funnelStage: "wau" });
    await createSegment("wau-seg", WAU_RULE);
    await createAgent({ segmentTargeting: { includes: ["wau-seg"], excludes: [] } });

    const run1 = new Date(); // after fixtures, so segment.updatedAt <= run1
    await setIngestMarker(new Date(run1.getTime() - 3_600_000)); // ingest 1h before run1
    const first = await materializeAllSegments({ runStart: run1 });
    expect(first.segmentsProcessed).toBe(1);
    expect(first.segmentsSkippedFresh).toBe(0);

    const run2 = new Date(run1.getTime() + 3_600_000); // next hourly run, no drift
    const second = await materializeAllSegments({ runStart: run2 });

    expect(second.segmentsProcessed).toBe(0);
    expect(second.segmentsSkippedFresh).toBe(1);
    expect(second.perSegment).toEqual([
      { name: "wau-seg", matched: 0, deleted: 0, skipped: "fresh" },
    ]);
  });

  it("a skipped run leaves UserSegment rows untouched (no sweep)", async () => {
    await createUser("wau-1", { funnelStage: "wau" });
    await createSegment("wau-seg", WAU_RULE);
    await createAgent({ segmentTargeting: { includes: ["wau-seg"], excludes: [] } });

    const run1 = new Date();
    await setIngestMarker(new Date(run1.getTime() - 3_600_000));
    await materializeAllSegments({ runStart: run1 });
    const before = await prisma.userSegment.findMany({
      where: { segmentName: "wau-seg" },
      orderBy: { externalId: "asc" },
    });

    await materializeAllSegments({ runStart: new Date(run1.getTime() + 3_600_000) });
    const after = await prisma.userSegment.findMany({
      where: { segmentName: "wau-seg" },
      orderBy: { externalId: "asc" },
    });

    expect(after).toEqual(before); // byte-identical incl. syncedAt
  });

  it("a newer ingest marker forces a re-scan", async () => {
    await createUser("wau-1", { funnelStage: "wau" });
    await createSegment("wau-seg", WAU_RULE);
    await createAgent({ segmentTargeting: { includes: ["wau-seg"], excludes: [] } });

    const run1 = new Date();
    await setIngestMarker(new Date(run1.getTime() - 3_600_000));
    await materializeAllSegments({ runStart: run1 });

    // Hightouch sync lands between runs; a new user now matches.
    await createUser("wau-2", { funnelStage: "wau" });
    const run2 = new Date(run1.getTime() + 3_600_000);
    await setIngestMarker(new Date(run2.getTime() - 60_000));
    const second = await materializeAllSegments({ runStart: run2 });

    expect(second.segmentsProcessed).toBe(1);
    expect(second.segmentsSkippedFresh).toBe(0);
    const rows = await prisma.userSegment.findMany({ where: { segmentName: "wau-seg" } });
    expect(rows.map((r) => r.externalId).sort()).toEqual(["wau-1", "wau-2"]);
  });

  it("a rule edit forces re-materialization even with no ingest", async () => {
    await createUser("wau-1", { funnelStage: "wau" });
    await createUser("mau-1", { funnelStage: "mau" });
    await createSegment("seg", WAU_RULE);
    await createAgent({ segmentTargeting: { includes: ["seg"], excludes: [] } });

    const run1 = new Date();
    await setIngestMarker(new Date(run1.getTime() - 3_600_000));
    await materializeAllSegments({ runStart: run1 });

    // Edit the rule. @updatedAt bumps Segment.updatedAt to real-now, which is
    // after run1 (= materializedAt), so the skip must not fire — even though
    // run2's marker is still safely old.
    await prisma.segment.update({
      where: { name: "seg" },
      data: {
        rule: {
          kind: "group",
          join: "AND",
          children: [{ kind: "condition", fieldId: "funnelStage", operator: "in", value: ["mau"] }],
        } as Prisma.InputJsonValue,
      },
    });

    const second = await materializeAllSegments({ runStart: new Date(run1.getTime() + 3_600_000) });

    expect(second.segmentsProcessed).toBe(1);
    expect(second.segmentsSkippedFresh).toBe(0);
    const rows = await prisma.userSegment.findMany({ where: { segmentName: "seg", source: "rule" } });
    expect(rows.map((r) => r.externalId)).toEqual(["mau-1"]);
  });

  it("a missing ingest marker fails open: everything re-materializes", async () => {
    await createUser("wau-1", { funnelStage: "wau" });
    await createSegment("wau-seg", WAU_RULE);
    await createAgent({ segmentTargeting: { includes: ["wau-seg"], excludes: [] } });

    const run1 = new Date();
    await setIngestMarker(new Date(run1.getTime() - 3_600_000));
    await materializeAllSegments({ runStart: run1 });

    await prisma.appSetting.deleteMany({ where: { key: USER_INGEST_MARKER_KEY } });
    const second = await materializeAllSegments({ runStart: new Date(run1.getTime() + 3_600_000) });

    expect(second.segmentsProcessed).toBe(1);
    expect(second.segmentsSkippedFresh).toBe(0);
  });

  it("REGRESSION: stamping materializedAt does not bump Segment.updatedAt", async () => {
    // If the stamp goes through prisma.segment.update, @updatedAt silently
    // bumps updatedAt past materializedAt and the skip never fires again.
    await createUser("wau-1", { funnelStage: "wau" });
    await createSegment("wau-seg", WAU_RULE);
    await createAgent({ segmentTargeting: { includes: ["wau-seg"], excludes: [] } });

    const before = await prisma.segment.findUniqueOrThrow({ where: { name: "wau-seg" } });
    const runStart = new Date(before.updatedAt.getTime() + 60_000);
    await setIngestMarker(new Date(runStart.getTime() - 3_600_000));
    await materializeAllSegments({ runStart });

    const after = await prisma.segment.findUniqueOrThrow({ where: { name: "wau-seg" } });
    expect(after.materializedAt?.toISOString()).toBe(runStart.toISOString());
    expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
  });
});
