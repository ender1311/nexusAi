// E2E for interaction-flag targeting (spec 2026-06-09): a rule segment on
// votd_interaction_has_ever_flag is_false materializes flag-false AND
// flag-absent users (absent = false per the Hightouch default contract), and
// excludes flag-true users. Membership rows are what select-and-send consumes.
import { describe, it, expect, beforeEach } from "bun:test";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { materializeAllSegments } from "@/lib/segments/materialize";
import { createUser, createAgent } from "../helpers/builders";

const VOTD_FALSE_RULE = {
  kind: "group",
  join: "AND",
  children: [
    { kind: "condition", fieldId: "votd_interaction_has_ever_flag", operator: "is_false", value: null },
  ],
};

describe("rule segment on an interaction flag", () => {
  beforeEach(async () => {
    await prisma.userSegment.deleteMany();
    await prisma.trackedUser.deleteMany();
    await prisma.agent.deleteMany();
    await prisma.segment.deleteMany();
  });

  it("materializes flag-false and flag-absent users; excludes flag-true", async () => {
    await createUser("usr_votd_false", { attributes: { votd_interaction_has_ever_flag: false } });
    await createUser("usr_votd_absent"); // no flag attribute at all
    await createUser("usr_votd_true", { attributes: { votd_interaction_has_ever_flag: true } });
    await prisma.segment.create({
      data: { name: "votd-never-interacted", rule: VOTD_FALSE_RULE as Prisma.InputJsonValue },
    });
    // materializeAllSegments only processes segments referenced by at least one agent.
    await createAgent({ segmentTargeting: { includes: ["votd-never-interacted"], excludes: [] } });

    await materializeAllSegments({ runStart: new Date() });

    const rows = await prisma.userSegment.findMany({
      where: { segmentName: "votd-never-interacted" },
      select: { externalId: true },
    });
    expect(new Set(rows.map((r) => r.externalId))).toEqual(
      new Set(["usr_votd_false", "usr_votd_absent"]),
    );
  });
});
