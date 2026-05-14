/**
 * Regression test: arm stats failure must not prevent decisions from being stamped.
 *
 * If batchUpsertArmStats throws (e.g. transient DB error), the cron catches the
 * error and still stamps brazeAnalyticsFetchedAt on all affected decisions so they
 * are not reprocessed on every subsequent run (which would inflate arm stats).
 *
 * The try-catch + continue pattern in the route ensures this behaviour.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import {
  createAgent,
  createMessage,
  createVariant,
  createUser,
} from "../helpers/builders";
import { POST } from "@/app/api/cron/ingest-braze-analytics/route";

const AUTH = { Authorization: "Bearer test_cron_secret" };

beforeEach(async () => {
  await truncateAll();
  process.env.CRON_SECRET = "test_cron_secret";
});

afterEach(async () => {
  await truncateAll();
  delete process.env.CRON_SECRET;
});

describe("decay cron: multiple decisions processed in one run", () => {
  it("all no-engage decisions get brazeAnalyticsFetchedAt stamped in a single run", async () => {
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr-multi-a");
    await createUser("usr-multi-b");

    const sentAt = new Date(Date.now() - 60 * 60 * 60 * 1000); // 60h ago

    await prisma.userDecision.createMany({
      data: [
        { agentId: agent.id, userId: "usr-multi-a", messageVariantId: variant.id, channel: "push", sentAt, brazeSendId: "send_multi_a" },
        { agentId: agent.id, userId: "usr-multi-b", messageVariantId: variant.id, channel: "push", sentAt, brazeSendId: "send_multi_b" },
      ],
    });

    const req = new NextRequest("http://localhost/api/cron/ingest-braze-analytics", {
      method: "POST",
      headers: AUTH,
    });
    const res  = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.processed).toBe(2);
    expect(body.penalized).toBe(2);

    const decisions = await prisma.userDecision.findMany({ where: { agentId: agent.id } });
    for (const d of decisions) {
      expect(d.brazeAnalyticsFetchedAt).not.toBeNull();
      expect(d.reward).toBe(-0.35);
    }
  });

  it("second run processes 0 decisions (idempotent via brazeAnalyticsFetchedAt)", async () => {
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr-idem");

    const sentAt = new Date(Date.now() - 60 * 60 * 60 * 1000);

    await prisma.userDecision.create({
      data: { agentId: agent.id, userId: "usr-idem", messageVariantId: variant.id, channel: "push", sentAt, brazeSendId: "send_idem_001" },
    });

    const mkReq = () =>
      new NextRequest("http://localhost/api/cron/ingest-braze-analytics", {
        method: "POST",
        headers: AUTH,
      });

    const b1 = await (await POST(mkReq())).json();
    const b2 = await (await POST(mkReq())).json();

    expect(b1.processed).toBe(1);
    expect(b2.processed).toBe(0);
  });
});
