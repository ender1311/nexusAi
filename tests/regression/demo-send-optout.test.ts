// Regression: POST /api/demo/send must honor push opt-out before sending, in
// every branch (including the variant-override branch, which bypasses
// decideForUser). Bug: demo/send was admin-gated but had none of the cron's
// consent checks, so an admin could push to users who opted out of push.
// Opt-out is a hard, non-bypassable gate (unlike quiet-hours / frequency-cap).

import { describe, it, expect, beforeEach, afterAll, mock } from "bun:test";

mock.module("@/lib/auth", () => ({
  requireAdmin: async () => null, // authorized admin
}));

import { POST } from "@/app/api/demo/send/route";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createUser } from "../helpers/builders";

const OPTED_OUT = "demo_optout_user";

function sendReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/demo/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/demo/send opt-out consent gate", () => {
  beforeEach(async () => {
    await prisma.trackedUser.deleteMany({ where: { externalId: OPTED_OUT } });
    await createUser(OPTED_OUT, { attributes: { newsletter_push_enabled: false } });
  });
  afterAll(async () => {
    await prisma.trackedUser.deleteMany({ where: { externalId: OPTED_OUT } });
  });

  it("suppresses a push-opted-out user instead of sending", async () => {
    const res = await POST(sendReq({ agentId: "agent_does_not_matter", userIds: [OPTED_OUT] }));
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Array<{ userId: string; status: string; reason?: string }> };
    expect(data).toHaveLength(1);
    expect(data[0].status).toBe("suppressed");
    expect(data[0].reason).toContain("opted out");
  });

  it("suppresses opt-out even on the variantOverrideId branch", async () => {
    const res = await POST(
      sendReq({ agentId: "agent_does_not_matter", userIds: [OPTED_OUT], variantOverrideId: "v_override" }),
    );
    const { data } = (await res.json()) as { data: Array<{ status: string }> };
    expect(data[0].status).toBe("suppressed");
  });
});
