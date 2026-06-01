import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { createAgent, createPersona, createUser, createUserAgentAssignment, linkAgentToPersona } from "../helpers/builders";
import { POST } from "@/app/api/cron/select-and-send/route";

const AUTH = { Authorization: "Bearer test_cron_secret" };

beforeEach(async () => {
  await truncateAll();
  process.env.CRON_SECRET = "test_cron_secret";
  process.env.BRAZE_API_KEY = "x"; process.env.BRAZE_REST_ENDPOINT = "https://example.com";
});
afterEach(async () => { await truncateAll(); });

describe("cron Phase −1 release sweep", () => {
  it("releases hold_cap_days, hold_cap_sends, and cohort_exit; keeps healthy", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ funnelStage: "lapsed_mau", holdMaxDays: 90, holdMaxSends: 24 });
    await linkAgentToPersona(agent.id, persona.id);

    await createUser("u_old", { personaId: persona.id, funnelStage: "lapsed_mau" });
    await createUser("u_sends", { personaId: persona.id, funnelStage: "lapsed_mau" });
    await createUser("u_exit", { personaId: persona.id, funnelStage: "dau4" }); // left cohort
    await createUser("u_ok", { personaId: persona.id, funnelStage: "lapsed_mau" });

    await createUserAgentAssignment({ externalUserId: "u_old", agentId: agent.id, startedAt: new Date(Date.now() - 91 * 86_400_000) });
    await createUserAgentAssignment({ externalUserId: "u_sends", agentId: agent.id, sendCount: 24 });
    await createUserAgentAssignment({ externalUserId: "u_exit", agentId: agent.id });
    await createUserAgentAssignment({ externalUserId: "u_ok", agentId: agent.id, sendCount: 1 });

    const res = await POST(buildRequest("POST", {}, AUTH) as NextRequest);
    expect([200, 500]).toContain(res.status);

    const get = (id: string) => prisma.userAgentAssignment.findUnique({ where: { externalUserId: id } });
    expect((await get("u_old"))!.releaseReason).toBe("hold_cap_days");
    expect((await get("u_sends"))!.releaseReason).toBe("hold_cap_sends");
    expect((await get("u_exit"))!.releaseReason).toBe("cohort_exit");
    expect((await get("u_ok"))!.releasedAt).toBeNull();
  });
});
