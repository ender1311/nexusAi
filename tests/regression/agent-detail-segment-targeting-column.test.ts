// tests/regression/agent-detail-segment-targeting-column.test.ts
//
// REGRESSION: every agent detail page crashed with a Prisma P2022
// "column does not exist" error. The `segmentTargeting` column (and
// `lockedByAgentId` on User) were added to the Prisma schema and committed
// as migrations (20260528010000_add_segment_targeting,
// 20260528000000_add_locked_by_agent_id) but were never applied to the
// production database — the migration history had drifted.
//
// The agent LIST page survived because it uses an explicit `select` that
// omits the column, but the detail page loads the agent via getCachedAgent,
// which selects ALL columns (full include). That query threw P2022 and the
// [id] error boundary rendered "Something went wrong".
//
// This test exercises the exact include shape used by getCachedAgent
// (src/lib/cache.ts) and reads the segmentTargeting field. If the column is
// ever missing from the connected DB again, this query throws here in CI
// instead of silently on production.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant, createGoal } from "../helpers/builders";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("regression: agent detail crashed on missing segmentTargeting column", () => {
  it("loads an agent with the full getCachedAgent include shape without throwing", async () => {
    const agent = await createAgent({
      name: "Trinity",
      funnelStage: "lapsed_dau4",
      segmentTargeting: { includes: ["seg_a", "seg_b"], excludes: ["seg_c"] },
    });
    const msg = await createMessage(agent.id);
    await createVariant(msg.id);
    await createGoal(agent.id);

    // Exact include shape from getCachedAgent() in src/lib/cache.ts.
    // A missing "segmentTargeting" column makes this throw P2022.
    const loaded = await prisma.agent.findUnique({
      where: { id: agent.id },
      include: {
        goals: true,
        messages: { include: { variants: true } },
        schedulingRule: true,
        personaTargets: { include: { persona: true } },
        _count: { select: { decisions: true } },
      },
    });

    expect(loaded).not.toBeNull();
    // Field must be selectable and round-trip the stored JSON.
    expect(loaded!.segmentTargeting).toEqual({ includes: ["seg_a", "seg_b"], excludes: ["seg_c"] });
    expect(loaded!.goals).toHaveLength(1);
    expect(loaded!.messages[0].variants).toHaveLength(1);
  });

  it("loads an agent with null segmentTargeting (legacy / funnel-stage mode)", async () => {
    const agent = await createAgent({ name: "Legacy Agent", segmentTargeting: null });

    const loaded = await prisma.agent.findUnique({
      where: { id: agent.id },
      include: {
        goals: true,
        messages: { include: { variants: true } },
        schedulingRule: true,
        personaTargets: { include: { persona: true } },
        _count: { select: { decisions: true } },
      },
    });

    expect(loaded).not.toBeNull();
    expect(loaded!.segmentTargeting).toBeNull();
  });
});
