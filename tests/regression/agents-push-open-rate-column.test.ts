// tests/regression/agents-push-open-rate-column.test.ts
//
// REGRESSION: the /agents list page computes per-agent push open rate with a
// $queryRaw FILTER aggregate over the UserDecision table. The sent/open counts
// rely on the exact column names "channel", "pushOpenAt" and "scheduledFor". A
// rename or typo in any of these would throw a Postgres error and crash the page.
//
// SECOND BUG (denominator): future-scheduled in_local_time sends each get a
// brazeScheduleId + a scheduledFor in the future at scheduling time, but haven't
// been delivered yet, so they can't have an open. Counting them as "sends"
// deflated the push open rate to near-zero for freshly scheduled agents (e.g.
// Artemis showed ~944 "decisions" while only a couple dozen had actually gone
// out). The fix excludes rows whose scheduledFor is still in the future from the
// sends denominator. Fixed in src/app/agents/page.tsx.
//
// THIRD BUG (actual delivered): a UserDecision row is created at selection time
// regardless of whether Braze actually accepted the send. sentAt defaults to
// now() at insert and scheduledFor<=NOW() only means the delivery anchor passed —
// neither proves a send went out. The authoritative "delivered" marker is
// brazeSendId IS NOT NULL (set only after Braze accepts the send). Artemis still
// read 0/948 because the denominator counted phantom/unsent rows. The fix adds
// brazeSendId IS NOT NULL to the sends denominator in src/lib/cache/agents.ts
// (list card) and src/app/agents/[id]/performance/page.tsx (performance page).
//
// This test exercises the exact SQL shape used by the card stat so a future
// column rename — or a regression that re-counts pending or never-sent rows —
// breaks here, not silently on production.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent } from "../helpers/builders";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("regression: agents page push open rate FILTER aggregate", () => {
  it("counts push sends and opens per agent using the real column names", async () => {
    const agentA = await createAgent({ name: "Agent A" });
    const agentB = await createAgent({ name: "Agent B" });

    const opened = new Date();

    // Agent A: 3 confirmed push sends (brazeSendId set), 2 opened; plus 1 email (excluded from push sends)
    await prisma.userDecision.create({ data: { agentId: agentA.id, userId: "u-1", channel: "push", brazeSendId: "b-1", pushOpenAt: opened } });
    await prisma.userDecision.create({ data: { agentId: agentA.id, userId: "u-2", channel: "push", brazeSendId: "b-2", pushOpenAt: opened } });
    await prisma.userDecision.create({ data: { agentId: agentA.id, userId: "u-3", channel: "push", brazeSendId: "b-3" } });
    await prisma.userDecision.create({ data: { agentId: agentA.id, userId: "u-4", channel: "email", brazeSendId: "b-4", pushOpenAt: opened } });

    // Agent B: 2 confirmed push sends, 0 opened
    await prisma.userDecision.create({ data: { agentId: agentB.id, userId: "u-5", channel: "push", brazeSendId: "b-5" } });
    await prisma.userDecision.create({ data: { agentId: agentB.id, userId: "u-6", channel: "push", brazeSendId: "b-6" } });

    // Exact $queryRaw pattern used by getCachedAgentCardStats in src/lib/cache/agents.ts.
    const rows = await prisma.$queryRaw<Array<{ agentId: string; sends: bigint; opens: bigint }>>`
      SELECT "agentId",
             COUNT(*) FILTER (
               WHERE "channel" = 'push'
                 AND "brazeSendId" IS NOT NULL
                 AND ("scheduledFor" IS NULL OR "scheduledFor" <= NOW())
             ) AS sends,
             COUNT(*) FILTER (WHERE "channel" = 'push' AND "pushOpenAt" IS NOT NULL) AS opens
      FROM "UserDecision"
      GROUP BY "agentId"
    `;

    const byAgent = new Map(rows.map((r) => [r.agentId, { sends: Number(r.sends), opens: Number(r.opens) }]));

    // Email decision is excluded from push sends.
    expect(byAgent.get(agentA.id)).toEqual({ sends: 3, opens: 2 });
    expect(byAgent.get(agentB.id)).toEqual({ sends: 2, opens: 0 });

    // Rate computation mirrors page.tsx: opens/sends*100, null when no push sends.
    const a = byAgent.get(agentA.id)!;
    expect((a.opens / a.sends) * 100).toBeCloseTo(66.666, 1);
  });

  it("excludes future-scheduled (pending) push sends from the sends denominator", async () => {
    const agent = await createAgent({ name: "Artemis-like" });

    const future = new Date(Date.now() + 24 * 60 * 60 * 1000); // delivered tomorrow
    const past = new Date(Date.now() - 60 * 60 * 1000);        // already delivered

    // 1 delivered-now (no scheduledFor), 1 delivered in the past, opened. Both confirmed.
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "u-1", channel: "push", brazeSendId: "b-1", pushOpenAt: new Date() } });
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "u-2", channel: "push", brazeSendId: "b-2", scheduledFor: past } });
    // 3 still pending in the future — Braze accepted the schedule (brazeSendId set) but
    // they haven't been delivered yet, so they must NOT count as sends.
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "u-3", channel: "push", brazeSendId: "b-3", scheduledFor: future } });
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "u-4", channel: "push", brazeSendId: "b-4", scheduledFor: future } });
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "u-5", channel: "push", brazeSendId: "b-5", scheduledFor: future } });

    const rows = await prisma.$queryRaw<Array<{ agentId: string; sends: bigint; opens: bigint }>>`
      SELECT "agentId",
             COUNT(*) FILTER (
               WHERE "channel" = 'push'
                 AND "brazeSendId" IS NOT NULL
                 AND ("scheduledFor" IS NULL OR "scheduledFor" <= NOW())
             ) AS sends,
             COUNT(*) FILTER (WHERE "channel" = 'push' AND "pushOpenAt" IS NOT NULL) AS opens
      FROM "UserDecision"
      GROUP BY "agentId"
    `;

    const r = rows.find((x) => x.agentId === agent.id)!;
    // 2 delivered count as sends; the 3 future-scheduled are excluded.
    expect(Number(r.sends)).toBe(2);
    expect(Number(r.opens)).toBe(1);
    // Open rate is 50%, not 1/5 = 20% (the pre-fix, pending-inflated denominator).
    expect((Number(r.opens) / Number(r.sends)) * 100).toBe(50);
  });

  it("excludes push decisions Braze never accepted (brazeSendId null) from the sends denominator", async () => {
    // The Artemis case: hundreds of push UserDecision rows exist from selection,
    // but only a handful were actually accepted by Braze (brazeSendId set). The
    // denominator must count only confirmed sends, otherwise the open rate reads
    // near-zero (e.g. 0/948) against phantom rows.
    const agent = await createAgent({ name: "Artemis phantom rows" });

    // 2 confirmed sends (brazeSendId set), 1 opened.
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "p-1", channel: "push", brazeSendId: "b-1", pushOpenAt: new Date() } });
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "p-2", channel: "push", brazeSendId: "b-2" } });
    // 4 phantom rows — created at selection but Braze never accepted them (brazeSendId null).
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "p-3", channel: "push" } });
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "p-4", channel: "push" } });
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "p-5", channel: "push" } });
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "p-6", channel: "push" } });

    const rows = await prisma.$queryRaw<Array<{ agentId: string; sends: bigint; opens: bigint }>>`
      SELECT "agentId",
             COUNT(*) FILTER (
               WHERE "channel" = 'push'
                 AND "brazeSendId" IS NOT NULL
                 AND ("scheduledFor" IS NULL OR "scheduledFor" <= NOW())
             ) AS sends,
             COUNT(*) FILTER (WHERE "channel" = 'push' AND "pushOpenAt" IS NOT NULL) AS opens
      FROM "UserDecision"
      GROUP BY "agentId"
    `;

    const r = rows.find((x) => x.agentId === agent.id)!;
    // Only the 2 confirmed sends count; the 4 phantom rows are excluded.
    expect(Number(r.sends)).toBe(2);
    expect(Number(r.opens)).toBe(1);
    // Open rate is 50% on actual deliveries, not 1/6 ≈ 16.7% against phantom rows.
    expect((Number(r.opens) / Number(r.sends)) * 100).toBe(50);
  });

  it("splits decisions into delivered vs pending for the agent detail headline", async () => {
    // Mirrors the $queryRaw in src/app/agents/[id]/page.tsx that scopes the
    // headline so freshly-scheduled agents don't look like everything went out.
    const agent = await createAgent({ name: "Detail headline" });

    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const past = new Date(Date.now() - 60 * 60 * 1000);

    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "d-1", channel: "push" } });            // delivered (null)
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "d-2", channel: "email", scheduledFor: past } }); // delivered (past)
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "d-3", channel: "push", scheduledFor: future } }); // pending
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "d-4", channel: "push", scheduledFor: future } }); // pending

    const rows = await prisma.$queryRaw<Array<{ delivered: bigint; pending: bigint }>>`
      SELECT
        COUNT(*) FILTER (WHERE "scheduledFor" IS NULL OR "scheduledFor" <= NOW()) AS delivered,
        COUNT(*) FILTER (WHERE "scheduledFor" IS NOT NULL AND "scheduledFor" > NOW()) AS pending
      FROM "UserDecision"
      WHERE "agentId" = ${agent.id}
    `;

    expect(Number(rows[0].delivered)).toBe(2);
    expect(Number(rows[0].pending)).toBe(2);
  });
});
