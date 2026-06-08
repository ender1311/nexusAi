// Regression (CLAUDE.md: every new $executeRawUnsafe needs a column-name guard).
// The materialize reconcile hand-writes INSERT…SELECT / DELETE against "UserSegment"
// and "User". A rename of externalId / segmentName / source / syncedAt would break it
// silently outside this test. Running the real reconcile + reading every column back
// proves all four column names (and the "User".externalId / funnelStage refs) are valid.
import { describe, it, expect, beforeEach } from "bun:test";
import { prisma } from "@/lib/db";
import { materializeSegment } from "@/lib/segments/materialize";
import { compileSegmentRule } from "@/lib/segments/compile-sql";
import { createUser } from "../helpers/builders";
import type { SegmentRule } from "@/types/segment";

const WAU_RULE: SegmentRule = {
  kind: "group",
  join: "AND",
  children: [{ kind: "condition", fieldId: "funnelStage", operator: "eq", value: "wau" }],
};

describe("materialize reconcile SQL column names", () => {
  beforeEach(async () => {
    await prisma.userSegment.deleteMany();
    await prisma.trackedUser.deleteMany();
  });

  it("reads back every column the raw SQL writes", async () => {
    await createUser("col-1", { funnelStage: "wau" });
    const where = compileSegmentRule(WAU_RULE);
    const runStart = new Date();

    await prisma.$transaction((tx) => materializeSegment(tx, { segmentName: "cols", where, runStart }));

    // Explicit raw SELECT of each column name proves they exist post-write.
    const rows = await prisma.$queryRawUnsafe<
      Array<{ externalId: string; segmentName: string; source: string; syncedAt: Date }>
    >(`SELECT "externalId", "segmentName", "source", "syncedAt" FROM "UserSegment" WHERE "segmentName" = $1`, "cols");

    expect(rows).toHaveLength(1);
    expect(rows[0]?.externalId).toBe("col-1");
    expect(rows[0]?.segmentName).toBe("cols");
    expect(rows[0]?.source).toBe("rule");
    expect(rows[0]?.syncedAt).toBeInstanceOf(Date);
  });

  it("is idempotent: re-running with a later runStart keeps the member, no duplicate", async () => {
    await createUser("col-1", { funnelStage: "wau" });
    const where = compileSegmentRule(WAU_RULE);

    await prisma.$transaction((tx) => materializeSegment(tx, { segmentName: "cols", where, runStart: new Date(Date.now() - 1000) }));
    await prisma.$transaction((tx) => materializeSegment(tx, { segmentName: "cols", where, runStart: new Date() }));

    const rows = await prisma.userSegment.findMany({ where: { segmentName: "cols", source: "rule" } });
    expect(rows).toHaveLength(1);
  });
});
