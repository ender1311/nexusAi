/**
 * Regression test: decisions without brazeSendId must not be processed by the
 * 48h decay cron.
 *
 * Phantom decisions (brazeSendId=null) were created during the broken send_id
 * period when Braze rejected sends. These were never actually delivered and
 * should not receive rewards or penalties — applying arm stats to undelivered
 * sends would corrupt the bandit's signal.
 *
 * The cron query filters brazeSendId: { not: null } to exclude these.
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

describe("decay cron: phantom decisions (brazeSendId=null) are excluded", () => {
  it("decision with null brazeSendId is not processed", async () => {
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr-phantom");

    const sentAt = new Date(Date.now() - 60 * 60 * 60 * 1000); // 60h ago

    // Create decision without brazeSendId (phantom send)
    await prisma.userDecision.create({
      data: {
        agentId: agent.id, userId: "usr-phantom",
        messageVariantId: variant.id, channel: "push", sentAt,
        // brazeSendId intentionally omitted (null)
      },
    });

    const req = new NextRequest("http://localhost/api/cron/ingest-braze-analytics", {
      method: "POST",
      headers: AUTH,
    });
    const res  = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.processed).toBe(0); // phantom decision skipped

    const decision = await prisma.userDecision.findFirst({ where: { userId: "usr-phantom" } });
    expect(decision!.brazeAnalyticsFetchedAt).toBeNull(); // untouched
    expect(decision!.reward).toBeNull();
  });

  it("only the decision with brazeSendId is processed when both exist", async () => {
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr-phantom2");
    await createUser("usr-real");

    const sentAt = new Date(Date.now() - 60 * 60 * 60 * 1000);

    await prisma.userDecision.createMany({
      data: [
        { agentId: agent.id, userId: "usr-phantom2", messageVariantId: variant.id, channel: "push", sentAt },
        { agentId: agent.id, userId: "usr-real",     messageVariantId: variant.id, channel: "push", sentAt, brazeSendId: "send_real_001" },
      ],
    });

    const req = new NextRequest("http://localhost/api/cron/ingest-braze-analytics", {
      method: "POST",
      headers: AUTH,
    });
    const body = await (await POST(req)).json();

    expect(body.processed).toBe(1); // only the real send

    const phantom = await prisma.userDecision.findFirst({ where: { userId: "usr-phantom2" } });
    const real    = await prisma.userDecision.findFirst({ where: { userId: "usr-real" } });

    expect(phantom!.brazeAnalyticsFetchedAt).toBeNull();
    expect(real!.brazeAnalyticsFetchedAt).not.toBeNull();
  });

  it("decisions newer than 48h are not processed yet", async () => {
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr-fresh");

    const sentAt = new Date(Date.now() - 24 * 60 * 60 * 1000); // only 24h ago

    await prisma.userDecision.create({
      data: { agentId: agent.id, userId: "usr-fresh", messageVariantId: variant.id, channel: "push", sentAt, brazeSendId: "send_fresh_001" },
    });

    const req = new NextRequest("http://localhost/api/cron/ingest-braze-analytics", {
      method: "POST",
      headers: AUTH,
    });
    const body = await (await POST(req)).json();

    expect(body.processed).toBe(0);
  });
});
