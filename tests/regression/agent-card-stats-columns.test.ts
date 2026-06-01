// tests/regression/agent-card-stats-columns.test.ts
//
// REGRESSION (Wave 5): the agents-list per-agent card stats (unique users, push
// sends/opens) and the agent-detail delivered/pending split were uncached inline
// $queryRaw in page components. Wave 5 moved them into cached helpers in
// src/lib/cache/agents.ts (getCachedAgentCardStats, getCachedAgentDecisionSplit).
//
// REGRESSION (denominator fix): the card "sends" denominator and the
// delivered/pending split used a naive `scheduledFor <= NOW()` check, which
// counted in_local_time sends still inside their 12h delivery window as
// delivered. That over-counted the push-open-rate denominator (Artemis: 1003
// naive vs 952 buffered). Both queries now mirror effectiveDeliveryDeadlineMs
// (src/lib/agent-sends/pending-deadline.ts): in_local_time sends are delivered
// only once scheduledFor is more than 12h in the past.
//
// These tests pin the exact SQL column names + buffer logic those helpers depend on:
//   - "scheduledFor" gates delivered vs pending
//   - "decisionContext"->>'inLocalTime' selects the 12h buffer branch
//   - "pushOpenAt" + channel = 'push' drives push opens
//   - "brazeSendId" IS NOT NULL gates a real send
//   - "userId" is the string user identifier (not "externalUserId")
// A future column rename will break here, not silently on the production page.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent } from "../helpers/builders";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("regression: agent card-stats / decision-split SQL column names", () => {
  it("splits delivered vs pending by scheduledFor, applying the 12h in_local_time buffer", async () => {
    const agent = await createAgent({ name: "Split Agent" });
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const thirteenHoursAgo = new Date(Date.now() - 13 * 60 * 60 * 1000);

    // delivered: scheduledFor NULL
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "u1", channel: "push" } });
    // delivered: non-local send, scheduledFor 1h in the past
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "u2", channel: "push", scheduledFor: oneHourAgo } });
    // pending: non-local send, scheduledFor in the future
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "u3", channel: "push", scheduledFor: future } });
    // pending: in_local_time send only 1h past anchor — still inside 12h window
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "u4", channel: "push", scheduledFor: oneHourAgo, decisionContext: { inLocalTime: true } } });
    // delivered: in_local_time send 13h past anchor — window closed
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "u5", channel: "push", scheduledFor: thirteenHoursAgo, decisionContext: { inLocalTime: true } } });

    // Exact SQL from getCachedAgentDecisionSplit.
    const rows = await prisma.$queryRaw<Array<{ delivered: bigint; pending: bigint }>>`
      SELECT
        COUNT(*) FILTER (
          WHERE "scheduledFor" IS NULL
            OR CASE
                 WHEN ("decisionContext"->>'inLocalTime')::boolean IS TRUE
                   THEN "scheduledFor" <= NOW() - INTERVAL '12 hours'
                 ELSE "scheduledFor" <= NOW()
               END
        ) AS delivered,
        COUNT(*) FILTER (
          WHERE "scheduledFor" IS NOT NULL
            AND CASE
                  WHEN ("decisionContext"->>'inLocalTime')::boolean IS TRUE
                    THEN "scheduledFor" > NOW() - INTERVAL '12 hours'
                  ELSE "scheduledFor" > NOW()
                END
        ) AS pending
      FROM "UserDecision"
      WHERE "agentId" = ${agent.id}
    `;
    // delivered: u1, u2, u5 ; pending: u3, u4
    expect(Number(rows[0]?.delivered ?? 0)).toBe(3);
    expect(Number(rows[0]?.pending ?? 0)).toBe(2);
  });

  it("counts push sends (delivered, buffer-aware) and opens via pushOpenAt per agent", async () => {
    const agent = await createAgent({ name: "Push Agent" });
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const thirteenHoursAgo = new Date(Date.now() - 13 * 60 * 60 * 1000);
    const openedAt = new Date();

    // delivered push, opened (scheduledFor NULL)
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "p1", channel: "push", brazeSendId: "s1", pushOpenAt: openedAt } });
    // delivered push, not opened (non-local, 1h past)
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "p2", channel: "push", brazeSendId: "s2", scheduledFor: oneHourAgo } });
    // future-scheduled push — excluded from sends
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "p3", channel: "push", brazeSendId: "s3", scheduledFor: future } });
    // in_local_time, only 1h past anchor — still inside 12h window, NOT yet a send
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "p4", channel: "push", brazeSendId: "s4", scheduledFor: oneHourAgo, decisionContext: { inLocalTime: true } } });
    // in_local_time, 13h past anchor — window closed, counts as a send
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "p5", channel: "push", brazeSendId: "s5", scheduledFor: thirteenHoursAgo, decisionContext: { inLocalTime: true } } });
    // delivered push but NO brazeSendId — never actually sent, excluded
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "p6", channel: "push" } });
    // non-push — excluded entirely
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "p7", channel: "email", brazeSendId: "s7" } });

    // Exact SQL from getCachedAgentCardStats (push portion).
    const rows = await prisma.$queryRaw<Array<{ agentId: string; sends: bigint; opens: bigint }>>`
      SELECT "agentId",
             COUNT(*) FILTER (
               WHERE "channel" = 'push'
                 AND "brazeSendId" IS NOT NULL
                 AND (
                   "scheduledFor" IS NULL
                   OR CASE
                        WHEN ("decisionContext"->>'inLocalTime')::boolean IS TRUE
                          THEN "scheduledFor" <= NOW() - INTERVAL '12 hours'
                        ELSE "scheduledFor" <= NOW()
                      END
                 )
             ) AS sends,
             COUNT(*) FILTER (WHERE "channel" = 'push' AND "pushOpenAt" IS NOT NULL) AS opens
      FROM "UserDecision"
      GROUP BY "agentId"
    `;
    const row = rows.find((r) => r.agentId === agent.id);
    // sends: p1, p2, p5 ; opens: p1
    expect(Number(row?.sends ?? 0)).toBe(3);
    expect(Number(row?.opens ?? 0)).toBe(1);
  });
});
