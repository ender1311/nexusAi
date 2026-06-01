import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { createAgent, createPersona, createUser, createUserAgentAssignment, linkAgentToPersona, createMessage, createVariant } from "../helpers/builders";
import { POST } from "@/app/api/cron/select-and-send/route";

const AUTH = { Authorization: "Bearer test_cron_secret" };

// Intercept Braze HTTP calls so sends succeed without a real Braze account
let _originalFetch: typeof globalThis.fetch;

async function giveVariant(agentId: string) {
  const m = await createMessage(agentId, { brazeCampaignId: `camp_${agentId}` });
  await createVariant(m.id, { brazeVariantId: `var_${agentId}` });
}

beforeEach(async () => {
  await truncateAll();
  process.env.CRON_SECRET = "test_cron_secret";
  process.env.BRAZE_API_KEY = "x";
  process.env.BRAZE_REST_URL = "https://rest.test.braze.com";

  _originalFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = async (
    input: string | URL | Request,
    init?: RequestInit
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

describe("cron lottery ownership", () => {
  it("excludes a user actively owned by another agent", async () => {
    const persona = await createPersona();
    const owner = await createAgent({ name: "Owner", funnelStage: "mau", status: "active" });
    const other = await createAgent({ name: "Other", funnelStage: "mau", status: "active" });
    await linkAgentToPersona(owner.id, persona.id);
    await linkAgentToPersona(other.id, persona.id);
    await giveVariant(owner.id);
    await giveVariant(other.id);

    await createUser("u_owned", { personaId: persona.id, funnelStage: "mau" });
    await createUserAgentAssignment({ externalUserId: "u_owned", agentId: owner.id });

    await POST(buildRequest("POST", {}, AUTH) as NextRequest);

    const assignment = await prisma.userAgentAssignment.findUnique({ where: { externalUserId: "u_owned" } });
    expect(assignment!.agentId).toBe(owner.id);
    expect(assignment!.releasedAt).toBeNull();
  });

  it("persists the lottery winner as a durable assignment with sendCount=1", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ name: "Solo", funnelStage: "mau", status: "active" });
    await linkAgentToPersona(agent.id, persona.id);
    await giveVariant(agent.id);
    await createUser("u_fresh", { personaId: persona.id, funnelStage: "mau" });

    await POST(buildRequest("POST", {}, AUTH) as NextRequest);

    const assignment = await prisma.userAgentAssignment.findUnique({ where: { externalUserId: "u_fresh" } });
    expect(assignment).not.toBeNull();
    expect(assignment!.agentId).toBe(agent.id);
    expect(assignment!.releasedAt).toBeNull();
    expect(assignment!.sendCount).toBe(1);
    expect(assignment!.lastSentAt).not.toBeNull();
  });
});
