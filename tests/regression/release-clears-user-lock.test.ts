// Regression for 2026-06-09 audit finding C1: every release path set
// UserAgentAssignment.releasedAt but left TrackedUser.lockedByAgentId pointing
// at the old agent. Eligibility queries require lockedByAgentId null/own, so a
// released user was permanently excluded from every other agent's pool —
// silently shrinking the fleet-wide recruitable audience with each release.
// Covered paths: cron Phase −1 hold-cap sweep, POST /api/agents/[id]/release,
// and release-on-conversion in applyConversion.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent,
  createPersona,
  createUser,
  createUserAgentAssignment,
  createUserDecision,
} from "../helpers/builders";
import { POST as cronPost } from "@/app/api/cron/select-and-send/route";
import { POST as releasePost } from "@/app/api/agents/[id]/release/route";
import { applyConversion } from "@/lib/services/attribution-service";

const CRON_AUTH = { Authorization: "Bearer test_cron_secret" };

let _originalFetch: typeof globalThis.fetch;

beforeEach(async () => {
  await truncateAll();
  process.env.CRON_SECRET = "test_cron_secret";
  process.env.BRAZE_API_KEY = "x";
  process.env.BRAZE_REST_URL = "https://rest.test.braze.com";
  _originalFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("rest.test.braze.com")) {
      return new Response(JSON.stringify({ message: "success" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    return _originalFetch(input, init);
  };
});

afterEach(async () => {
  globalThis.fetch = _originalFetch;
  await truncateAll();
  delete process.env.CRON_SECRET;
  delete process.env.BRAZE_API_KEY;
  delete process.env.BRAZE_REST_URL;
});

describe("release clears lockedByAgentId", () => {
  it("cron Phase −1 hold-cap release frees the user lock", async () => {
    // The agent deliberately gets no persona targets / variants: a released
    // user who is still fully eligible is re-recruited by the lottery in the
    // same run (re-locked, assignment reset), which would mask the release +
    // lock-clear this test asserts on. Phase −1 sweeps regardless.
    const persona = await createPersona();
    const agent = await createAgent({ name: "HoldCap", funnelStage: "wau", holdMaxSends: 1 });

    await createUser("c1_hold_user", { personaId: persona.id, funnelStage: "wau" });
    await prisma.trackedUser.update({
      where: { externalId: "c1_hold_user" },
      data: { lockedByAgentId: agent.id },
    });
    await createUserAgentAssignment({
      externalUserId: "c1_hold_user",
      agentId: agent.id,
      sendCount: 5, // ≥ holdMaxSends → hold_cap_sends release
    });

    const res = await cronPost(buildRequest("POST", {}, CRON_AUTH) as NextRequest);
    expect(res.status).toBe(200);

    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "c1_hold_user" },
    });
    expect(assignment?.releasedAt).not.toBeNull();
    expect(assignment?.releaseReason).toBe("hold_cap_sends");

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "c1_hold_user" } });
    expect(user?.lockedByAgentId).toBeNull();
  });

  it("manual release route frees the lock, but never another agent's lock", async () => {
    const agent = await createAgent({ name: "ManualRelease" });
    const otherAgent = await createAgent({ name: "Bystander" });

    await createUser("c1_manual_user", {});
    await prisma.trackedUser.update({
      where: { externalId: "c1_manual_user" },
      data: { lockedByAgentId: agent.id },
    });
    await createUserAgentAssignment({ externalUserId: "c1_manual_user", agentId: agent.id });

    await createUser("c1_other_user", {});
    await prisma.trackedUser.update({
      where: { externalId: "c1_other_user" },
      data: { lockedByAgentId: otherAgent.id },
    });

    const req = new NextRequest(`http://localhost:3000/api/agents/${agent.id}/release`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin": "true" },
    });
    const res = await releasePost(req, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { released: 1 } });

    const released = await prisma.trackedUser.findUnique({ where: { externalId: "c1_manual_user" } });
    expect(released?.lockedByAgentId).toBeNull();

    const bystander = await prisma.trackedUser.findUnique({ where: { externalId: "c1_other_user" } });
    expect(bystander?.lockedByAgentId).toBe(otherAgent.id);
  });

  it("release-on-conversion frees the lock", async () => {
    const agent = await createAgent({ name: "ConvRelease" });
    await createUser("c1_conv_user", {});
    await prisma.trackedUser.update({
      where: { externalId: "c1_conv_user" },
      data: { lockedByAgentId: agent.id },
    });
    await createUserAgentAssignment({ externalUserId: "c1_conv_user", agentId: agent.id });
    const decision = await createUserDecision({ agentId: agent.id, userId: "c1_conv_user" });

    await applyConversion({
      decision: {
        id: decision.id,
        agentId: agent.id,
        userId: "c1_conv_user",
        channel: "push",
        messageVariantId: null,
        decisionContext: null,
        agent: { algorithm: "thompson", goals: [] },
      },
      conversionEvent: "any_interaction",
      occurredAt: new Date(),
      personaId: null,
    });

    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "c1_conv_user" },
    });
    expect(assignment?.releasedAt).not.toBeNull();
    expect(assignment?.releaseReason).toBe("conversion");

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "c1_conv_user" } });
    expect(user?.lockedByAgentId).toBeNull();
  });
});
