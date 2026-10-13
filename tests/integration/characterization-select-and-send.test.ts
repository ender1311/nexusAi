// CHARACTERIZATION (P0 safety net, spec 2026-10-13 §10): one end-to-end cron
// run with seeded randomness and a frozen clock. Freezes WHICH users get
// WHICH variant via WHICH Braze call. The P2 refactor (Activator extraction,
// queue) must keep this snapshot green. Update with `bun test -u` only for
// intended, reviewed behaviour changes.
import { afterEach, beforeEach, describe, expect, it, setSystemTime } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { seedRandom } from "../helpers/seeded-random";
import {
  createAgent, createPersona, createMessage, createVariant,
  createUser, createSchedulingRule, linkAgentToPersona,
} from "../helpers/builders";
import { POST } from "@/app/api/cron/select-and-send/route";

const CRON_AUTH = { Authorization: "Bearer test_cron_secret" };
const NOW = new Date("2026-05-30T15:00:00Z");
const ID_RE = /\b(c[a-z0-9]{24}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/g;

let brazeRequests: Array<{ url: string; body: unknown }> = [];
let originalFetch: typeof globalThis.fetch;
let restoreRandom: () => void;

/** Replace generated ids with stable, first-seen-order placeholders. */
function stabilize(value: unknown, names: Map<string, string>): unknown {
  const json = JSON.stringify(value).replace(ID_RE, (id) => {
    if (!names.has(id)) names.set(id, `<id${names.size + 1}>`);
    return names.get(id)!;
  });
  return JSON.parse(json);
}

beforeEach(async () => {
  await truncateAll();
  process.env.CRON_SECRET = "test_cron_secret";
  process.env.BRAZE_API_KEY = "test_braze_key";
  process.env.BRAZE_REST_URL = "https://rest.test.braze.com";
  process.env.BRAZE_NEXUS_CAMPAIGN_ID = "nexus-campaign";
  brazeRequests = [];
  setSystemTime(NOW);
  restoreRandom = seedRandom(42);
  originalFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("rest.test.braze.com")) {
      brazeRequests.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
      return new Response(JSON.stringify({ message: "success" }), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    return originalFetch(input, init);
  };
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  restoreRandom();
  setSystemTime();
  await truncateAll();
  for (const k of ["CRON_SECRET", "BRAZE_API_KEY", "BRAZE_REST_URL", "BRAZE_NEXUS_CAMPAIGN_ID"]) delete process.env[k];
});

describe("characterization: one select-and-send run", () => {
  it("sends the same variants to the same users via the same Braze calls", async () => {
    // Setup mirrors the passing send case in tests/integration/cron-send.test.ts:85-89
    // (thompson push agent, wau users), widened to two variants and five users
    // with fixed externalIds u1..u5 and fixed brazeVariantIds "bv-A" / "bv-B".
    const persona = await createPersona({ name: "Char Persona" });
    const agent = await createAgent({ name: "Char Agent", algorithm: "thompson", funnelStage: "wau" });
    const message = await createMessage(agent.id, { channel: "push", brazeCampaignId: "camp_char" });
    await createVariant(message.id, { name: "A", body: "Variant A", brazeVariantId: "bv-A" });
    await createVariant(message.id, { name: "B", body: "Variant B", brazeVariantId: "bv-B" });
    for (const id of ["u1", "u2", "u3", "u4", "u5"]) {
      await createUser(id, { personaId: persona.id, funnelStage: "wau" });
    }
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    const res = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    expect(res.status).toBe(200);

    const decisions = await prisma.userDecision.findMany({
      where: { agentId: agent.id },
      orderBy: { userId: "asc" },
      select: { userId: true, messageVariantId: true, channel: true, brazeSendId: true, sentAt: true, scheduledFor: true, scheduledLocalHour: true },
    });
    const names = new Map<string, string>();
    const snapshot = {
      brazeRequests: brazeRequests
        .map((r) => ({ url: r.url, body: r.body }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      decisions: decisions.map((d) => ({ ...d, brazeSendId: d.brazeSendId ? "<set>" : null, sentAt: d.sentAt?.toISOString() ?? null, scheduledFor: d.scheduledFor?.toISOString() ?? null })),
    };
    expect(decisions.length).toBeGreaterThan(0);
    expect(stabilize(snapshot, names)).toMatchSnapshot();
  });
});
