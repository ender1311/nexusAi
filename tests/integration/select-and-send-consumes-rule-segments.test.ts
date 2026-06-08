// Proves the C3 payoff: select-and-send reads UserSegment by segmentName alone
// (src/app/api/cron/select-and-send/route.ts), so rule-materialized members
// (source='rule') are picked up with NO change to that route. We assert the exact
// query select-and-send runs returns the materialized members.
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

describe("select-and-send consumes rule-materialized segments", () => {
  beforeEach(async () => {
    await prisma.userSegment.deleteMany();
    await prisma.trackedUser.deleteMany();
    await prisma.agent.deleteMany();
    await prisma.segment.deleteMany();
  });

  it("the segmentName-only membership query returns both rule and hightouch members", async () => {
    await createUser("rule-wau", { funnelStage: "wau" });
    await createUserSegment("ht-extra", "wau-seg", "hightouch");
    await prisma.segment.create({ data: { name: "wau-seg", rule: WAU_RULE as Prisma.InputJsonValue } });
    await createAgent({ segmentTargeting: { includes: ["wau-seg"], excludes: [] } });

    await materializeAllSegments({ runStart: new Date() });

    // This is exactly how select-and-send resolves an include segment:
    const rows = await prisma.userSegment.findMany({
      where: { segmentName: "wau-seg" },
      select: { externalId: true },
    });
    const members = new Set(rows.map((r) => r.externalId));
    expect(members).toEqual(new Set(["rule-wau", "ht-extra"]));
  });
});
