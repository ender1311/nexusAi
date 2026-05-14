/**
 * Regression test: persona-less users' decisions must still get brazeAnalyticsFetchedAt
 * stamped by the 48h decay cron.
 *
 * Bug (original): decisionIdsToUpdate was filtered to only users with personas.
 * Persona-less users' decisions never got brazeAnalyticsFetchedAt set, causing
 * infinite reprocessing on every cron run and inflated arm stats.
 *
 * The fix (preserved in time-decay rewrite): stamp ALL decisions regardless of
 * persona presence. Arm stats for persona-less users are written to UserArmStats
 * only; PersonaArmStats is skipped (personaCombos excludes them).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import {
  createAgent,
  createPersona,
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

describe("decay cron: persona-less users", () => {
  it("decision for user with no persona gets brazeAnalyticsFetchedAt set", async () => {
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    const user    = await createUser("usr-no-persona", { personaId: null });
    const sentAt  = new Date(Date.now() - 60 * 60 * 60 * 1000); // 60h ago

    await prisma.userDecision.create({
      data: {
        agentId: agent.id, userId: user.externalId,
        messageVariantId: variant.id, channel: "push", sentAt,
        brazeSendId: "send_no_persona_001",
      },
    });

    const req = new NextRequest("http://localhost/api/cron/ingest-braze-analytics", {
      method: "POST",
      headers: AUTH,
    });
    const res  = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.processed).toBe(1);

    const decision = await prisma.userDecision.findFirst({ where: { userId: user.externalId } });
    expect(decision!.brazeAnalyticsFetchedAt).not.toBeNull();
    expect(decision!.reward).toBe(-0.35);
  });

  it("decisions for both persona and persona-less users get stamped in the same run", async () => {
    const persona        = await createPersona();
    const agent          = await createAgent();
    const msg            = await createMessage(agent.id);
    const variant        = await createVariant(msg.id);
    const withPersona    = await createUser("usr-with-p",    { personaId: persona.id });
    const withoutPersona = await createUser("usr-without-p", { personaId: null });
    const sentAt         = new Date(Date.now() - 60 * 60 * 60 * 1000);

    await prisma.userDecision.createMany({
      data: [
        { agentId: agent.id, userId: withPersona.externalId,    messageVariantId: variant.id, channel: "push", sentAt, brazeSendId: "send_mixed_001" },
        { agentId: agent.id, userId: withoutPersona.externalId, messageVariantId: variant.id, channel: "push", sentAt, brazeSendId: "send_mixed_002" },
      ],
    });

    const req = new NextRequest("http://localhost/api/cron/ingest-braze-analytics", {
      method: "POST",
      headers: AUTH,
    });
    const body = await (await POST(req)).json();

    expect(body.processed).toBe(2);

    const decisions = await prisma.userDecision.findMany({ where: { agentId: agent.id } });
    expect(decisions).toHaveLength(2);
    for (const d of decisions) {
      expect(d.brazeAnalyticsFetchedAt).not.toBeNull();
    }
  });

  it("persona-less decisions are not reprocessed on a second run", async () => {
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    const user    = await createUser("usr-idempotent-nopersona", { personaId: null });
    const sentAt  = new Date(Date.now() - 60 * 60 * 60 * 1000);

    await prisma.userDecision.create({
      data: {
        agentId: agent.id, userId: user.externalId,
        messageVariantId: variant.id, channel: "push", sentAt,
        brazeSendId: "send_idempotent_001",
      },
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

  it("decision with pushOpenAt set → reward=0, not penalized", async () => {
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr-opened");
    const sentAt     = new Date(Date.now() - 60 * 60 * 60 * 1000);
    const pushOpenAt = new Date(Date.now() - 55 * 60 * 60 * 1000);

    await prisma.userDecision.create({
      data: {
        agentId: agent.id, userId: "usr-opened",
        messageVariantId: variant.id, channel: "push", sentAt, pushOpenAt,
        brazeSendId: "send_opened_001",
      },
    });

    const req  = new NextRequest("http://localhost/api/cron/ingest-braze-analytics", { method: "POST", headers: AUTH });
    const body = await (await POST(req)).json();

    expect(body.opens).toBe(1);
    expect(body.penalized).toBe(0);

    const decision = await prisma.userDecision.findFirst({ where: { userId: "usr-opened" } });
    expect(decision!.reward).toBe(0);
    expect(decision!.brazeAnalyticsFetchedAt).not.toBeNull();
  });
});
